import { useEffect, useMemo, useRef, useState } from "react";
import { getShows, markAttending, unmarkAttending, getTravelTime } from "../services/api.js";
import { colors, gradients } from "../utils/theme.js";

// All 50 US states (matches the scraper).
const STATES = [
  ["AL", "Alabama"],        ["AK", "Alaska"],         ["AZ", "Arizona"],
  ["AR", "Arkansas"],       ["CA", "California"],     ["CO", "Colorado"],
  ["CT", "Connecticut"],    ["DE", "Delaware"],       ["FL", "Florida"],
  ["GA", "Georgia"],        ["HI", "Hawaii"],         ["ID", "Idaho"],
  ["IL", "Illinois"],       ["IN", "Indiana"],        ["IA", "Iowa"],
  ["KS", "Kansas"],         ["KY", "Kentucky"],       ["LA", "Louisiana"],
  ["ME", "Maine"],          ["MD", "Maryland"],       ["MA", "Massachusetts"],
  ["MI", "Michigan"],       ["MN", "Minnesota"],      ["MS", "Mississippi"],
  ["MO", "Missouri"],       ["MT", "Montana"],        ["NE", "Nebraska"],
  ["NV", "Nevada"],         ["NH", "New Hampshire"],  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],     ["NY", "New York"],       ["NC", "North Carolina"],
  ["ND", "North Dakota"],   ["OH", "Ohio"],           ["OK", "Oklahoma"],
  ["OR", "Oregon"],         ["PA", "Pennsylvania"],   ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"],   ["TN", "Tennessee"],
  ["TX", "Texas"],          ["UT", "Utah"],           ["VT", "Vermont"],
  ["VA", "Virginia"],       ["WA", "Washington"],     ["WV", "West Virginia"],
  ["WI", "Wisconsin"],      ["WY", "Wyoming"],
];
const STATE_NAME = Object.fromEntries(STATES);

const NEAR_ME_ZIP_KEY    = "scp.nearMe.zip";
const NEAR_ME_RADIUS_KEY = "scp.nearMe.radiusMiles";

// Session-scoped travel-time cache. Keyed by `${zip}|${city}|${state}` so
// re-renders, pagination, and filter changes don't refire requests for a
// show whose travel-time we already have. Module-level (not React state)
// so the cache survives ShowsPage unmount → remount within the same
// browser session — exactly what the spec asks for.
const travelTimeCache = new Map();
function travelKey(zip, city, state) {
  return `${zip}|${(city ?? "").trim()}|${(state ?? "").trim().toUpperCase()}`;
}
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Page ────────────────────────────────────────────────────────────
export default function ShowsPage() {
  const [shows, setShows]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  // gridOpacity drives the fade-out → swap → fade-in sequence on
  // filter changes. 0 = mid-transition (data being swapped), 1 = idle.
  // The grid is always rendered (not replaced with a "Loading…" string)
  // after the first successful load, so its height stays roughly stable
  // and scroll position doesn't jump when filters change.
  const [gridOpacity, setGridOpacity] = useState(1);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Filters — q is debounced into qApplied which is what the API sees.
  // states is now an array (multi-select). The API accepts a comma-
  // separated list and uses ANY($::text[]) to fan out the WHERE clause.
  const [states, setStates]         = useState([]);
  // Calendar cursor lives at this level so navigating months can drive
  // the grid's date-range filter. Initial cursor + from/to are seeded
  // to the current month so the first render is already filtered to
  // it (matches the calendar default view).
  const [cursor, setCursor]         = useState(() => startOfMonth(new Date()));
  const [fromDate, setFromDate]     = useState(() => toIsoDate(startOfMonth(new Date())));
  const [toDate, setToDate]         = useState(() => toIsoDate(endOfMonth(new Date())));
  const [q, setQ]                   = useState("");
  const [qApplied, setQApplied]     = useState("");

  // Near Me — proximity (zip → coords → Haversine radius). Holds:
  //   • whether the inline panel is mounted (Near Me button toggles it),
  //   • the active center coords + radius (drives /shows API params),
  //   • the zip the user typed (for display in the active "x" pill).
  // Declared up here (not next to the other Near Me handlers below) so
  // the fetch effect can read nearMe without hitting a temporal dead zone.
  const [nearMeOpen, setNearMeOpen] = useState(false);
  const [nearMe, setNearMe]         = useState(null);
  // { zip, radiusMiles, centerLat, centerLng }

  // Whenever the calendar moves, snap from/to to that month's bounds.
  // The user can still type custom dates afterwards; their values stick
  // until the next calendar nav. The fetch effect picks the new range
  // up via fromDate/toDate, so the grid follows automatically — and
  // the existing fade-out → swap → fade-in pipeline handles the
  // smooth transition between months.
  useEffect(() => {
    setFromDate(toIsoDate(startOfMonth(cursor)));
    setToDate(toIsoDate(endOfMonth(cursor)));
  }, [cursor]);

  // Debounce search input — 350ms after the last keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQApplied(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  // Stable serialised key so the fetch effect only fires when the
  // selected set really changes, not on every array identity change.
  const statesKey = states.slice().sort().join(",");

  // Fetch shows on filter change. Sequential fade pattern:
  //   1. opacity → 0 (200ms transition out via CSS)
  //   2. wait until BOTH the 200ms fade timer AND the API have settled
  //      (Promise.all races them — fade always completes before swap)
  //   3. swap data, opacity → 1 (200ms transition in)
  // The first load skips step 1 (no old content to fade out) and just
  // shows the loading state until data arrives.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (hasLoadedOnce) setGridOpacity(0);

    Promise.all([
      new Promise((r) => setTimeout(r, 200)),
      getShows({
        states:      states.length ? states : undefined,
        from:        fromDate || undefined,
        to:          toDate   || undefined,
        q:           qApplied || undefined,
        centerLat:   nearMe?.centerLat,
        centerLng:   nearMe?.centerLng,
        radiusMiles: nearMe?.radiusMiles,
      }),
    ])
      .then(([_, data]) => {
        if (cancelled) return;
        setShows(data);
        setGridOpacity(1);
        setLoading(false);
        setHasLoadedOnce(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load shows");
        // Fade old content back in so the user isn't stuck staring at
        // a blank panel after a network error.
        setGridOpacity(1);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesKey, fromDate, toDate, qApplied, nearMe]);

  // ── Pagination ──
  // PAGE_SIZE is fixed at 30 per spec.
  //
  // Reset to page 1 only on filters that aren't "calendar nav". States
  // and search query reset; calendar nav (which moves fromDate/toDate
  // via the cursor effect) is handled by the per-month memory below
  // instead, so coming back to a previously-visited month restores the
  // page the user was on.
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [statesKey, qApplied]);

  // Per-month pagination memory. Map<"YYYY-MM", number> kept in a ref
  // so updates don't re-render. On cursor change: stash the current
  // page under the OLD month's key, restore the NEW month's saved
  // page (defaulting to 1 on first visit). Lifetime = component (so
  // it survives navigation between months but not a page refresh).
  const pageByMonthRef = useRef(new Map());
  const prevCursorForPageRef = useRef(cursor);
  useEffect(() => {
    const oldCursor = prevCursorForPageRef.current;
    if (oldCursor.getTime() !== cursor.getTime()) {
      pageByMonthRef.current.set(monthKey(oldCursor), currentPage);
      const restored = pageByMonthRef.current.get(monthKey(cursor)) ?? 1;
      setCurrentPage(restored);
    }
    prevCursorForPageRef.current = cursor;
    // currentPage intentionally absent from deps — we only save/restore
    // when the cursor moves; mid-month page clicks shouldn't re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const PAGE_SIZE = 30;
  const totalPages = Math.max(1, Math.ceil(shows.length / PAGE_SIZE));
  const pagedShows = useMemo(
    () => shows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [shows, currentPage]
  );

  // Smooth-scroll to the top of the grid (not the page) on page change.
  const gridWrapRef = useRef(null);
  function changePage(n) {
    const next = Math.max(1, Math.min(totalPages, n));
    if (next === currentPage) return;
    setCurrentPage(next);
    // Defer until the new page renders so the scroll target exists.
    requestAnimationFrame(() => {
      gridWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleState(code) {
    setStates((prev) => prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]);
  }
  function removeState(code) {
    setStates((prev) => prev.filter((s) => s !== code));
  }
  function clearStates() { setStates([]); }

  // Optimistic attending toggle. Updates the local list immediately, then
  // reconciles via the API call. Reverts on failure.
  async function toggleAttending(show) {
    const next = !show.attending;
    setShows((prev) => prev.map((s) => s.id === show.id ? { ...s, attending: next } : s));
    try {
      if (next) await markAttending(show.id);
      else      await unmarkAttending(show.id);
    } catch (err) {
      setShows((prev) => prev.map((s) => s.id === show.id ? { ...s, attending: !next } : s));
      setError(err?.message ?? "Couldn't update attending status");
    }
  }

  // Near Me handlers — state itself lives near the top of the component
  // (alongside the other filters) so the fetch effect can read it.
  function applyNearMe(next) { setNearMe(next); setNearMeOpen(false); }
  function clearNearMe()     { setNearMe(null); }

  const attending = useMemo(() => shows.filter((s) => s.attending), [shows]);

  return (
    <div style={st.page}>
      <div className="container">
        <header style={st.header}>
          <p style={st.eyebrow}><span style={st.eyebrowMark}>◆</span> Collector's Reserve · Shows</p>
          <h1 style={st.title}>My Shows</h1>
          <p style={st.sub}>Track upcoming card shows nationwide and the ones you're attending.</p>
        </header>

        {error && <div style={st.errorBanner}>{error}</div>}

        {/* ── Calendar / list view ── */}
        <CalendarPanel
          cursor={cursor}
          setCursor={setCursor}
          attending={attending}
          onToggleAttending={toggleAttending}
          userZip={nearMe?.zip ?? null}
        />

        {/* ── Browse + filter ── */}
        <FilterBar
          states={states}     onToggleState={toggleState}
          onRemoveState={removeState} onClearStates={clearStates}
          fromDate={fromDate} setFromDate={setFromDate}
          toDate={toDate}     setToDate={setToDate}
          q={q}               setQ={setQ}
          nearMeOpen={nearMeOpen}
          onNearMeToggle={() => setNearMeOpen((o) => !o)}
          onNearMeApply={applyNearMe}
          nearMe={nearMe}
          onNearMeClear={clearNearMe}
          loading={loading}
          totalCount={shows.length}
          attendingCount={attending.length}
        />

        {/* ── Grid ──
            Wrapper has a min-height so an empty result set never
            collapses the page — that collapse is what causes the
            scroll-jump when the user filters down to a small/zero set.
            After the first successful load the grid stays mounted
            (even when shows is empty) and just transitions opacity
            during refetches, so layout stays stable. */}
        <div ref={gridWrapRef} style={st.gridWrap}>
          {/* Top pagination — same state, same handler, automatically
              in sync with the bottom bar. Lives inside gridWrap so the
              scroll-to-top on page change lands above this bar (user
              sees pagination → grid → pagination). */}
          {hasLoadedOnce && totalPages > 1 && (
            <div style={st.paginationTop}>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onChange={changePage}
              />
            </div>
          )}

          {!hasLoadedOnce ? (
            <div style={st.stateMsg}>Loading shows…</div>
          ) : (
            <div style={{ ...st.grid, opacity: gridOpacity }}>
              {shows.length === 0 ? (
                <div style={st.gridEmpty}>No shows match your filters.</div>
              ) : (
                pagedShows.map((s) => (
                  <ShowCard key={s.id} show={s} onToggle={() => toggleAttending(s)} />
                ))
              )}
            </div>
          )}

          {hasLoadedOnce && totalPages > 1 && (
            <div style={st.paginationBottom}>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onChange={changePage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar panel ──────────────────────────────────────────────────
// cursor + setCursor are controlled by ShowsPage so navigating months
// can drive the grid's date-range filter at the same time.
function CalendarPanel({ cursor, setCursor, attending, onToggleAttending, userZip }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewMode, setViewMode] = useState("month"); // month | list
  const [expandedDate, setExpandedDate] = useState(null);

  // Bucket attending shows by ISO date so the month grid lookup is O(1).
  // Multi-day shows (endDate set) are bucketed into EVERY day they span,
  // tagged with `_isStart` / `_isEnd` so the pill renderer can square the
  // inner edges and round the outer ones — visually connecting the pills
  // across the date range.
  const byDate = useMemo(() => {
    const m = new Map();
    for (const s of attending) {
      if (!s.date) continue;
      const start = new Date(`${s.date}T00:00:00`);
      const endIso = s.endDate || s.date;
      const end   = new Date(`${endIso}T00:00:00`);
      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const iso = toIsoDate(d);
        if (!m.has(iso)) m.set(iso, []);
        m.get(iso).push({
          ...s,
          _isStart: iso === s.date,
          _isEnd:   iso === endIso,
        });
      }
    }
    return m;
  }, [attending]);

  // Slide animation: when cursor changes via prev/next, capture the
  // outgoing month so we can render both simultaneously during the
  // 300ms transition. The "Today" button skips animation by direct
  // jump (would otherwise look weird if many months distant).
  const [transition, setTransition] = useState(null);
  const prevCursorRef = useRef(cursor);
  useEffect(() => {
    if (prevCursorRef.current.getTime() === cursor.getTime()) return;
    const direction = cursor > prevCursorRef.current ? "next" : "prev";
    const oldCursor = prevCursorRef.current;
    prevCursorRef.current = cursor;
    setTransition({ direction, oldCursor });
    const t = setTimeout(() => setTransition(null), 320);
    return () => clearTimeout(t);
  }, [cursor]);

  function shiftMonth(delta) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    setExpandedDate(null);
  }
  function goToday() {
    setCursor(startOfMonth(new Date()));
    setExpandedDate(toIsoDate(new Date()));
  }

  const expandedShows = expandedDate ? (byDate.get(expandedDate) ?? []) : [];

  return (
    <section style={st.calendarPanel}>
      <header style={st.calendarHeader}>
        <div style={st.calendarTitleWrap}>
          <button type="button" onClick={() => shiftMonth(-1)} style={st.calNavBtn} aria-label="Previous month">‹</button>
          <h2 style={st.calendarTitle}>
            {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
          </h2>
          <button type="button" onClick={() => shiftMonth(1)}  style={st.calNavBtn} aria-label="Next month">›</button>
          <button type="button" onClick={goToday} style={st.todayBtn}>Today</button>
        </div>
        <div style={st.viewToggle}>
          <ToggleBtn active={viewMode === "month"} onClick={() => setViewMode("month")}>Month</ToggleBtn>
          <ToggleBtn active={viewMode === "list"}  onClick={() => setViewMode("list")}>List</ToggleBtn>
        </div>
      </header>

      {viewMode === "month" ? (
        <>
          <div style={st.weekRow}>
            {DAY_LABELS.map((d) => <div key={d} style={st.weekLabel}>{d}</div>)}
          </div>
          {/* Slide-transition wrapper. Incoming month is in normal flow
              (drives container height — no jump). Outgoing month is
              absolutely positioned over it during the 300ms transition.
              Keyframes live in index.css. */}
          <div style={st.monthGridWrap}>
            <div
              key={`grid-${cursor.getTime()}`}
              style={{
                ...st.monthGridIn,
                animation: transition
                  ? (transition.direction === "next"
                      ? "scp-cal-slide-in-right 300ms ease-in-out"
                      : "scp-cal-slide-in-left  300ms ease-in-out")
                  : "none",
              }}
            >
              <MonthGrid
                cursor={cursor}
                today={today}
                byDate={byDate}
                expandedDate={expandedDate}
                onToggleExpand={(iso) => setExpandedDate(iso === expandedDate ? null : iso)}
              />
            </div>
            {transition && (
              <div
                key={`grid-out-${transition.oldCursor.getTime()}`}
                style={{
                  ...st.monthGridOut,
                  animation: transition.direction === "next"
                    ? "scp-cal-slide-out-left  300ms ease-in-out forwards"
                    : "scp-cal-slide-out-right 300ms ease-in-out forwards",
                }}
                aria-hidden
              >
                <MonthGrid
                  cursor={transition.oldCursor}
                  today={today}
                  byDate={byDate}
                  expandedDate={null}
                  onToggleExpand={() => {}}
                />
              </div>
            )}
          </div>

          {expandedDate && expandedShows.length > 0 && (
            <div style={st.expandedPane}>
              <div style={st.expandedHead}>
                {longDate(new Date(expandedDate))} — {expandedShows.length} attending
              </div>
              <div style={st.expandedList}>
                {expandedShows.map((s) => (
                  <ExpandedShowRow
                    key={s.id}
                    show={s}
                    clickedDate={expandedDate}
                    userZip={userZip}
                    onRemove={(show) => {
                      // Toggle off + close the popover. Optimistic
                      // update in onToggleAttending makes the show
                      // disappear from the calendar/byDate map on
                      // the next render; clearing expandedDate
                      // collapses the popover at the same time so
                      // the row doesn't briefly show "0 attending".
                      onToggleAttending?.(show);
                      setExpandedDate(null);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={st.listView}>
          {attending.length === 0 ? (
            <div style={st.stateMsgInline}>You haven't marked any shows as attending yet.</div>
          ) : (
            attending.map((s) => <ExpandedShowRow key={s.id} show={s} compact />)
          )}
        </div>
      )}
    </section>
  );
}

// Live countdown to the show's start time, ticking every second.
// `setInterval` is gated behind `target` (no scheduling if we can't
// build a real Date — e.g. show with no date), and the cleanup
// `clearInterval` runs on unmount and on target change so the timer
// can't leak across remounts when the popover swaps shows. The
// hh/mm/ss values are zero-padded for stable digit width; days are
// not (they grow naturally and tabular-nums handles alignment).
function Countdown({ show }) {
  const target = useMemo(() => showStartDateTime(show), [show.date, show.startTime]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target?.getTime()]);

  if (!target) return null;

  const diff = diffToCountdown(target.getTime(), now);
  if (!diff) {
    return <div style={st.countdownPassed}>Show has passed</div>;
  }

  const today = isShowToday(show);
  return (
    <div style={{ ...st.countdownRow, ...(today ? st.countdownTodayRow : {}) }}>
      <CountdownUnit value={diff.days}            unit="d" />
      <CountdownUnit value={pad2(diff.hours)}     unit="h" />
      <CountdownUnit value={pad2(diff.mins)}      unit="m" />
      <CountdownUnit value={pad2(diff.secs)}      unit="s" />
    </div>
  );
}

function CountdownUnit({ value, unit }) {
  return (
    <span style={st.countdownUnit}>
      <span style={st.countdownNum}>{value}</span>
      <span style={st.countdownLabel}>{unit}</span>
    </span>
  );
}

function pad2(n) { return String(n).padStart(2, "0"); }

// Parse "9:00 AM" / "10:30 PM" / "9 AM" → { h: 0-23, m: 0-59 }.
// Falls back to midnight on unparseable input so the countdown still
// works for shows whose start time is missing — they'll just count
// down to start-of-day.
function parseTime(timeStr) {
  if (!timeStr) return { h: 0, m: 0 };
  const m = String(timeStr).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return { h: 0, m: 0 };
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || "0", 10);
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return { h: Math.min(23, Math.max(0, h)), m: Math.min(59, Math.max(0, min)) };
}

function showStartDateTime(show) {
  if (!show?.date) return null;
  const [y, mo, d] = show.date.split("-").map(Number);
  const { h, m } = parseTime(show.startTime);
  const dt = new Date(y, mo - 1, d, h, m, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function diffToCountdown(targetMs, nowMs) {
  const ms = targetMs - nowMs;
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  return {
    days:  Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    mins:  Math.floor((totalSec % 3600) / 60),
    secs:  totalSec % 60,
  };
}

function isShowToday(show) {
  if (!show?.date) return false;
  const today = new Date();
  const [y, m, d] = show.date.split("-").map(Number);
  return y === today.getFullYear() && (m - 1) === today.getMonth() && d === today.getDate();
}

function ExpandedShowRow({ show, compact, clickedDate, userZip, onRemove }) {
  const isRange = show.endDate && show.endDate !== show.date;
  const start = show.date    ? new Date(`${show.date}T00:00:00`)    : null;
  const end   = show.endDate ? new Date(`${show.endDate}T00:00:00`) : null;

  // Find the schedule entry for the day the user clicked. Falls back
  // to the show's top-level start/end when daily_times isn't present
  // (single-day shows imported before the schema added it).
  const totalDays = show.dailyTimes?.length ?? 0;
  const dayIndex  = (totalDays > 0 && clickedDate)
    ? show.dailyTimes.findIndex((d) => d.date === clickedDate)
    : -1;
  const todaysSchedule = dayIndex >= 0 ? show.dailyTimes[dayIndex] : null;
  const showsAsMultiDay = !compact && totalDays > 1 && dayIndex >= 0;

  // Time shown in the small top-line column.
  // Compact (list view): keep the date-range label.
  // Popover with a multi-day match: show this specific day's start time.
  // Otherwise: show the show's top-level start time.
  const dateLabel = compact
    ? (isRange
        ? `${formatDateLabel(start)} → ${formatDateLabel(end)}`
        : formatDateLine(show.date))
    : (todaysSchedule?.startTime || show.startTime || "—");

  // The bottom meta line shows times only when there's a single
  // schedule. For multi-day clicked shows, the dedicated banner
  // below the name carries the per-day schedule instead so we don't
  // duplicate the info.
  const showMetaTime = !showsAsMultiDay && show.startTime;

  // Travel time — popover-only (skipped in compact list view), and only
  // when the user has Near Me active. The module-scoped cache means
  // re-opening the same popover hits memory; the API call only fires
  // for the (zip, city, state) triples we haven't seen this session.
  const [travel, setTravel] = useState(null);
  useEffect(() => {
    if (compact || !userZip || !show.city || !show.state) { setTravel(null); return; }
    const k = travelKey(userZip, show.city, show.state);
    const cached = travelTimeCache.get(k);
    if (cached) { setTravel(cached); return; }
    let cancelled = false;
    setTravel("loading");
    getTravelTime({ originZip: userZip, destCity: show.city, destState: show.state })
      .then((value) => {
        if (cancelled) return;
        travelTimeCache.set(k, value);
        setTravel(value);
      })
      .catch(() => { if (!cancelled) setTravel("error"); });
    return () => { cancelled = true; };
  }, [userZip, show.id, show.city, show.state, compact]);

  return (
    <div style={st.expandedRow}>
      <div style={st.expandedTopLine}>
        <div style={st.expandedDate}>{dateLabel}</div>
        <div style={st.expandedDetails}>
          <div style={st.expandedName}>{show.name}</div>
          {showsAsMultiDay && (
            <div style={st.expandedDayBanner}>
              <span style={st.expandedDayBadge}>Day {dayIndex + 1} of {totalDays}</span>
              <span style={st.expandedDayTime}>
                {todaysSchedule.startTime}
                {todaysSchedule.endTime ? ` to ${todaysSchedule.endTime}` : ""}
              </span>
            </div>
          )}
          <div style={st.expandedMeta}>
            {[show.venue, show.city ? `${show.city}, ${show.state}` : show.state]
              .filter(Boolean).join(" · ")}
            {showMetaTime && (
              <span> · {formatTimeRange(show.startTime, show.endTime)}</span>
            )}
          </div>
          {travel !== null && <TravelTime value={travel} />}
        </div>
      </div>
      {/* Live countdown only in the popover (not the compact list view). */}
      {!compact && <Countdown show={show} />}
      {onRemove && (
        <div style={st.expandedActions}>
          <RemoveAttendingButton onClick={() => onRemove(show)} />
        </div>
      )}
    </div>
  );
}

// Subtle red-outlined button used inside the calendar click popover
// to let the user un-attend a show without leaving the calendar.
// Hover state needs onMouseEnter/Leave (CSS :hover doesn't reach
// inline styles) — small price for the dark-aesthetic match.
function RemoveAttendingButton({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...st.removeAttendingBtn,
        ...(hover ? st.removeAttendingBtnHover : {}),
      }}
    >
      Remove from Attending
    </button>
  );
}

// ─── Month grid (used twice during a month-slide transition) ────────
//
// Strict fixed-height layout — every dimension is hardcoded and there
// are NO auto, min-height, max-height, flex, or stretch constraints
// anywhere in the cell tree:
//
//   day cell           80px fixed, overflow: hidden
//   ├─ day number      20px fixed
//   └─ event container 56px fixed, overflow: hidden
//        └─ event pill 16px fixed, 10/16 type, 2px margin-bottom
//                       overflow: hidden, text-overflow: ellipsis
//
// Adding an event cannot push anything taller because nothing in the
// chain is auto-sized. Pills past what fits in 56px are clipped.
function MonthGrid({ cursor, today, byDate, expandedDate, onToggleExpand }) {
  const cells = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const start = new Date(monthStart);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  return (
    <div style={st.monthGrid}>
      {cells.map((d) => {
        const iso = toIsoDate(d);
        const inMonth = d.getMonth() === cursor.getMonth();
        const isToday = sameDay(d, today);
        const isExpanded = iso === expandedDate;
        const dayShows = byDate.get(iso) ?? [];
        return (
          <div
            key={iso}
            role="button"
            tabIndex={0}
            onClick={() => onToggleExpand(iso)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleExpand(iso);
              }
            }}
            style={{
              ...st.dayCell,
              ...(inMonth ? {} : st.dayCellMuted),
              ...(isToday ? st.dayCellToday : {}),
              ...(isExpanded ? st.dayCellExpanded : {}),
            }}
          >
            <div style={st.dayNumber}>{d.getDate()}</div>
            <div style={st.eventContainer}>
              {dayShows.map((s) => (
                <div
                  key={s.id}
                  style={st.eventPill}
                  title={pillTitle(s)}
                >
                  {s.name}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Native multi-line tooltip for a pill — no styling control but it
// gets the full info to the user without breaking the cell's
// overflow:hidden clipping that's holding the size lock in place.
function pillTitle(s) {
  const lines = [s.name];
  if (s.venue) lines.push(s.venue);
  if (s.city) lines.push(`${s.city}, ${s.state}`);
  if (s.startTime) {
    lines.push(s.endTime ? `${s.startTime} – ${s.endTime}` : s.startTime);
  }
  if (s.endDate && s.endDate !== s.date) {
    lines.push(`${s.date} – ${s.endDate}`);
  }
  return lines.join("\n");
}


// Stacked WEEKDAY / DAY / MONTH pill — restored from the first
// ShowsPage commit (673b333). Used for both start and end dates so the
// two pills are visually identical in multi-day shows.
function DatePill({ date }) {
  return (
    <div style={st.dateBox}>
      <div style={st.dateWeekday}>{date ? weekday(date).toUpperCase() : "—"}</div>
      <div style={st.dateDay}>{date ? date.getDate() : "—"}</div>
      <div style={st.dateMonth}>{date ? shortMonth(date) : ""}</div>
    </div>
  );
}

// ─── Pagination controls ────────────────────────────────────────────
// Windowed page list — always shows first + last + the current page
// ± 1, with ellipses between disjoint sections so the bar stays
// short for portfolios with hundreds of pages. The bar hides itself
// when there's only 1 page (handled by the caller).
function Pagination({ currentPage, totalPages, onChange }) {
  const items = pageWindow(currentPage, totalPages);
  const atFirst = currentPage <= 1;
  const atLast  = currentPage >= totalPages;
  return (
    <nav style={st.pagination} aria-label="Pagination">
      <button
        type="button"
        className="scp-page-btn"
        onClick={() => onChange(1)}
        disabled={atFirst}
        style={{ ...st.pageBtn, ...(atFirst ? st.pageBtnDisabled : {}) }}
        aria-label="First page"
      >First</button>
      <button
        type="button"
        className="scp-page-btn"
        onClick={() => onChange(currentPage - 1)}
        disabled={atFirst}
        style={{ ...st.pageBtn, ...(atFirst ? st.pageBtnDisabled : {}) }}
        aria-label="Previous page"
      >‹</button>
      {items.map((it, i) =>
        it === "…" ? (
          <span key={`e${i}`} style={st.pageEllipsis}>…</span>
        ) : (
          <button
            key={it}
            type="button"
            className={`scp-page-btn${it === currentPage ? " scp-page-btn-active" : ""}`}
            onClick={() => onChange(it)}
            style={{ ...st.pageBtn, ...(it === currentPage ? st.pageBtnActive : {}) }}
            aria-current={it === currentPage ? "page" : undefined}
          >{it}</button>
        )
      )}
      <button
        type="button"
        className="scp-page-btn"
        onClick={() => onChange(currentPage + 1)}
        disabled={atLast}
        style={{ ...st.pageBtn, ...(atLast ? st.pageBtnDisabled : {}) }}
        aria-label="Next page"
      >›</button>
      <button
        type="button"
        className="scp-page-btn"
        onClick={() => onChange(totalPages)}
        disabled={atLast}
        style={{ ...st.pageBtn, ...(atLast ? st.pageBtnDisabled : {}) }}
        aria-label="Last page"
      >Last</button>
    </nav>
  );
}

function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items = [1];
  if (current > 3) items.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    items.push(i);
  }
  if (current < total - 2) items.push("…");
  items.push(total);
  return items;
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...st.toggleBtn, ...(active ? st.toggleBtnActive : {}) }}
    >
      {children}
    </button>
  );
}

// ─── Filter bar ──────────────────────────────────────────────────────
function FilterBar({
  states, onToggleState, onRemoveState, onClearStates,
  fromDate, setFromDate, toDate, setToDate,
  q, setQ,
  nearMeOpen, onNearMeToggle, onNearMeApply, nearMe, onNearMeClear,
  loading, totalCount, attendingCount,
}) {
  // Click-outside detection for the Near Me dropdown. Anchored on the
  // entire wrapper (button + panel) so a click on the trigger button
  // doesn't fire close-then-reopen — the button's own onClick handles
  // the toggle, and clicks anywhere else (including elsewhere on the
  // page) call onNearMeToggle while the panel is open, closing it
  // without resetting any panel state.
  const nearMeAnchorRef = useRef(null);
  useEffect(() => {
    if (!nearMeOpen) return;
    function handler(e) {
      if (nearMeAnchorRef.current && !nearMeAnchorRef.current.contains(e.target)) {
        onNearMeToggle();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [nearMeOpen, onNearMeToggle]);

  return (
    <section style={st.filterBar}>
      <div style={st.filterRow}>
        <div style={st.filterField}>
          <label style={st.filterLabel}>States</label>
          <MultiStateDropdown selected={states} onToggle={onToggleState} />
        </div>
        <div style={st.filterField}>
          <label style={st.filterLabel}>From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={st.input} />
        </div>
        <div style={st.filterField}>
          <label style={st.filterLabel}>To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={st.input} />
        </div>
        <div style={{ ...st.filterField, flex: 1, minWidth: 220 }}>
          <label style={st.filterLabel}>Search</label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Show name or city…"
            style={st.input}
          />
        </div>
        <div style={st.nearMeAnchor} ref={nearMeAnchorRef}>
          <button
            type="button"
            onClick={onNearMeToggle}
            style={{
              ...st.nearMeBtn,
              ...(nearMe ? st.nearMeBtnActive : {}),
              ...(nearMeOpen ? st.nearMeBtnOpen : {}),
            }}
            aria-expanded={nearMeOpen}
            aria-haspopup="dialog"
          >📍 Near Me</button>
          {/* Active proximity pill — shows the current zip + radius
              with a gold X to clear. Only renders when nearMe is set. */}
          {nearMe && (
            <span
              style={st.nearMeActivePill}
              title={nearMe.radiusMiles
                ? `Within ${nearMe.radiusMiles} mi of ${nearMe.zip}`
                : `Sorted by distance from ${nearMe.zip}`}
            >
              {nearMe.zip} · {nearMe.radiusMiles ? `${nearMe.radiusMiles}mi` : "Any"}
              <button
                type="button"
                onClick={onNearMeClear}
                style={st.nearMeActiveClose}
                aria-label="Clear Near Me filter"
              >×</button>
            </span>
          )}
          {nearMeOpen && (
            <NearMePanel onApply={onNearMeApply} onClear={onNearMeClear} />
          )}
        </div>
      </div>

      {/* Selected-state pills + Clear all. Renders only when any state
          is selected so the empty case has no extra spacing. */}
      {states.length > 0 && (
        <div style={st.pillRow}>
          {states.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onRemoveState(code)}
              style={st.statePill}
              title={`Remove ${STATE_NAME[code] ?? code}`}
            >
              <span>{STATE_NAME[code] ?? code}</span>
              <span style={st.statePillX}>×</span>
            </button>
          ))}
          <button type="button" onClick={onClearStates} style={st.clearAllBtn}>
            Clear all
          </button>
        </div>
      )}

      <div style={st.filterMeta}>
        {loading ? "Loading…" : `${totalCount} show${totalCount === 1 ? "" : "s"}`}
        {attendingCount > 0 && ` · ${attendingCount} attending`}
      </div>
    </section>
  );
}

// ─── Near Me panel ───────────────────────────────────────────────────
//
// Inline row anchored below the Near Me button: 120px zip input + 80px
// radius select, no labels, no search button. Auto-fires the zip→coords
// lookup the moment the user reaches 5 valid digits and reports back to
// the parent via onApply, which closes the panel.
//
// API note: the spec calls for the Ziptastic API at
// http://ZiptasticAPI.com/{zip}, but Ziptastic's response only contains
// {country, state, city} — no coordinates. We use zippopotam.us instead
// (free, HTTPS, returns latitude + longitude in a single call) so the
// downstream Haversine filter actually has inputs to work with.
// Radius sentinel: "any" means no distance cutoff (still sort by
// distance on the server). Numeric strings ("25", "50", ...) parse to
// the radiusMiles value sent to /shows.
function parseRadius(raw) {
  if (raw === "any") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function NearMePanel({ onApply, onClear }) {
  const [zip, setZip]       = useState(() => localStorage.getItem(NEAR_ME_ZIP_KEY) ?? "");
  // Radius is stored as a string ("any" | "25" | "50" | "100" | "250")
  // because <select> values are strings; keeps round-trip with the
  // <option value> tags clean. Default "any" per the spec — entering a
  // zip code shows every show sorted nearest-first by default.
  const [radius, setRadius] = useState(() => localStorage.getItem(NEAR_ME_RADIUS_KEY) ?? "any");
  const [error, setError]   = useState(null);
  const [zipFocused, setZipFocused] = useState(false);
  // De-dupes back-to-back fires for the same (zip, radius) pair — auto-
  // trigger on 5-digit input PLUS Enter PLUS radius change can otherwise
  // run the same network call twice in a row.
  const lastRef = useRef({ zip: "", radius: "" });

  async function runLookup(z, r) {
    if (!/^\d{5}$/.test(z)) return;
    if (z === lastRef.current.zip && r === lastRef.current.radius) return;
    setError(null);
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${z}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Zip not found." : "Lookup failed.");
        return;
      }
      const data = await res.json();
      const place = data?.places?.[0];
      const lat = parseFloat(place?.latitude);
      const lng = parseFloat(place?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setError("Couldn't read coordinates from zip.");
        return;
      }
      lastRef.current = { zip: z, radius: r };
      try {
        localStorage.setItem(NEAR_ME_ZIP_KEY,    z);
        localStorage.setItem(NEAR_ME_RADIUS_KEY, r);
      } catch {}
      onApply({
        zip: z,
        radiusMiles: parseRadius(r),  // null when r === "any"
        centerLat: lat,
        centerLng: lng,
      });
    } catch {
      setError("Network error.");
    }
  }

  function reset() {
    setZip("");
    setRadius("any");
    setError(null);
    lastRef.current = { zip: "", radius: "" };
    try {
      localStorage.removeItem(NEAR_ME_ZIP_KEY);
      localStorage.removeItem(NEAR_ME_RADIUS_KEY);
    } catch {}
    onClear?.();
  }

  return (
    <div style={st.nearMePanel} role="dialog" aria-label="Near Me">
      <input
        type="text"
        inputMode="numeric"
        maxLength={5}
        autoFocus
        value={zip}
        placeholder="Enter ZIP code"
        aria-label="Zip code"
        onFocus={() => setZipFocused(true)}
        onBlur={() => setZipFocused(false)}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d]/g, "");
          setZip(next);
          setError(null);
          // Persist on every keystroke so closing the panel by
          // clicking outside doesn't lose mid-typed digits.
          try {
            if (next) localStorage.setItem(NEAR_ME_ZIP_KEY, next);
            else      localStorage.removeItem(NEAR_ME_ZIP_KEY);
          } catch {}
          // Auto-fire as soon as the zip becomes 5 digits.
          if (next.length === 5) runLookup(next, radius);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); runLookup(zip, radius); }
        }}
        style={{ ...st.nearMeZipInput, ...(zipFocused ? st.nearMeZipInputFocus : {}) }}
      />
      <select
        value={radius}
        aria-label="Search radius"
        onChange={(e) => {
          const next = e.target.value;
          setRadius(next);
          try { localStorage.setItem(NEAR_ME_RADIUS_KEY, next); } catch {}
          // Re-fire with the new radius if we have a valid zip already.
          if (zip.length === 5) runLookup(zip, next);
        }}
        style={st.nearMeRadiusSelect}
      >
        <option value="any" style={{ background: "#0f172a", color: "#fff" }}>Any</option>
        <option value="25"  style={{ background: "#0f172a", color: "#fff" }}>25mi</option>
        <option value="50"  style={{ background: "#0f172a", color: "#fff" }}>50mi</option>
        <option value="100" style={{ background: "#0f172a", color: "#fff" }}>100mi</option>
        <option value="250" style={{ background: "#0f172a", color: "#fff" }}>250mi</option>
      </select>
      <button
        type="button"
        onClick={reset}
        style={st.nearMeResetBtn}
        aria-label="Reset Near Me filter"
      >Reset</button>
      {error && <div style={st.nearMeInlineError}>{error}</div>}
    </div>
  );
}

// ─── Multi-state dropdown ────────────────────────────────────────────
// Custom panel because <select multiple> is clunky and doesn't fit the
// dark aesthetic. Click the trigger to open; click rows to toggle;
// click outside to close.
function MultiStateDropdown({ selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const label =
    selected.length === 0       ? "All states" :
    selected.length === 1       ? (STATE_NAME[selected[0]] ?? selected[0]) :
                                  `${selected.length} states selected`;

  return (
    <div ref={wrapRef} style={st.msWrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...st.msTrigger, ...(open ? st.msTriggerOpen : {}) }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}</span>
        <span style={st.msChevron}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div role="listbox" style={st.msPanel}>
          {STATES.map(([code, name]) => {
            const checked = selected.includes(code);
            return (
              <button
                type="button"
                key={code}
                onClick={() => onToggle(code)}
                style={{ ...st.msItem, ...(checked ? st.msItemChecked : {}) }}
                role="option"
                aria-selected={checked}
              >
                <span style={{ ...st.msCheckbox, ...(checked ? st.msCheckboxChecked : {}) }}>
                  {checked ? "✓" : ""}
                </span>
                <span>{name}</span>
                <span style={st.msCode}>{code}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Show card ───────────────────────────────────────────────────────
function ShowCard({ show, onToggle }) {
  const startDate = show.date ? new Date(`${show.date}T00:00:00`) : null;
  const endDate   = show.endDate && show.endDate !== show.date
    ? new Date(`${show.endDate}T00:00:00`)
    : null;
  const days = startDate ? daysFromToday(startDate) : null;
  const countdown =
    days == null    ? null :
    days  <  0      ? null :
    days === 0      ? "TODAY" :
    days === 1      ? "TOMORROW" :
                      `IN ${days} DAYS`;

  return (
    <article style={{ ...st.card, ...(show.attending ? st.cardAttending : {}) }}>
      {/* Body fills the top with flex:1 so the action row at the bottom
          (marginTop: auto) is always pinned regardless of how short or
          long the venue/city/time content is. Combined with grid auto-
          rows: 1fr in the parent, this gives uniform tile heights. */}
      <div style={st.cardBody}>
        {show.attending && countdown && (
          <div style={st.countdownRow}>
            <span style={st.countdown}>{countdown}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <DatePill date={startDate} />
          {endDate && (
            <>
              <span style={{ color: "#f59e0b", fontSize: "1.2rem", fontWeight: 700, flex: 1, textAlign: "center" }}>→</span>
              <DatePill date={endDate} />
            </>
          )}
        </div>

        <h3 style={st.cardName}>{show.name || "Untitled show"}</h3>
        {show.venue && <div style={st.cardVenue}>{show.venue}</div>}
        <div style={st.cardCity}>
          {show.city ? `${show.city}, ${show.state}` : show.state}
        </div>
        {show.startTime && (
          <div style={st.cardTime}>
            {formatTimeRange(show.startTime, show.endTime)}
            {hasVaryingTimes(show) && (
              <span style={st.cardTimeVary}> · Times vary by day</span>
            )}
          </div>
        )}
      </div>

      <div style={st.cardActions}>
        <button
          type="button"
          onClick={onToggle}
          style={{ ...st.attendBtn, ...(show.attending ? st.attendBtnOn : {}) }}
        >
          {show.attending ? "✓ Attending" : "I'm Attending"}
        </button>
      </div>
    </article>
  );
}

// ─── Travel time row ─────────────────────────────────────────────────
// Three states:
//   "loading"  → small rotating spinner (subtle, no label)
//   "error"    → muted "—" so the layout doesn't shift
//   { mode }   → animated car or plane gliding in a fixed-width track,
//                with the duration label trailing it.
function TravelTime({ value }) {
  if (value === "loading") {
    return (
      <div style={st.travelRow}>
        <span style={st.travelSpinner} aria-label="Calculating travel time" />
        <span style={st.travelLabel}>Calculating travel time…</span>
      </div>
    );
  }
  if (value === "error" || !value) {
    return (
      <div style={st.travelRow}>
        <span style={{ ...st.travelLabel, color: "#475569" }}>Travel time unavailable</span>
      </div>
    );
  }

  const isFly = value.mode === "fly";
  const label = `${formatDuration(value.durationMinutes)} ${isFly ? "flight" : "drive"}`;
  return (
    <div style={st.travelRow}>
      <div style={st.travelTrack}>
        {isFly ? <PlaneSvg /> : <CarSvg />}
      </div>
      <span style={st.travelLabel}>{label}</span>
    </div>
  );
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function CarSvg() {
  // Tiny silhouette — gold body, slightly darker windows, two black wheels.
  // Sized to sit comfortably within the 64px-wide track so the loop reads
  // as motion rather than a series of jumps.
  return (
    <svg
      width="28" height="14" viewBox="0 0 28 14" aria-hidden="true"
      style={{ animation: "travelCarDrive 3s linear infinite", display: "block" }}
    >
      <path d="M2 9 L4 5 L18 5 L22 9 L26 9 L26 11 L2 11 Z" fill="#f59e0b" />
      <path d="M5.5 6 L9 6 L9 8 L5.5 8 Z M10 6 L17 6 L19 8 L10 8 Z" fill="#1e293b" opacity="0.6" />
      <circle cx="7" cy="11.5" r="1.5" fill="#0f172a" />
      <circle cx="20" cy="11.5" r="1.5" fill="#0f172a" />
    </svg>
  );
}

function PlaneSvg() {
  // Stylised side-view jet, gold body. The keyframe lifts it ~4px at the
  // midpoint so the trip across the track feels like a glide.
  return (
    <svg
      width="30" height="14" viewBox="0 0 30 14" aria-hidden="true"
      style={{ animation: "travelPlaneFly 3.5s ease-in-out infinite", display: "block" }}
    >
      <path d="M2 7 L8 6 L18 4 L25 5 L28 7 L25 9 L18 10 L8 8 Z" fill="#f59e0b" />
      <path d="M11 4 L13 1 L15 4 Z M11 10 L13 13 L15 10 Z" fill="#f59e0b" opacity="0.85" />
      <circle cx="22" cy="7" r="0.9" fill="#0f172a" opacity="0.5" />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
// Day 0 of the next month is the last day of the current month — used
// to compute the calendar's currently-viewed month boundary for the
// grid's date filter.
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
// "YYYY-MM" — stable key for per-month pagination memory.
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}
function toIsoDate(d) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function weekday(d)    { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]; }
function shortMonth(d) { return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]; }
function longDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function formatDateLine(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function formatTimeRange(start, end) {
  if (start && end) return `${start} – ${end}`;
  return start || end || "";
}
// True when the show has multiple per-day entries AND any pair of
// start/end times differs across them. Single-day shows and uniform
// multi-day runs return false (so the "Times vary by day" subtitle
// only appears when actually informative).
function hasVaryingTimes(show) {
  const dt = show?.dailyTimes;
  if (!Array.isArray(dt) || dt.length <= 1) return false;
  const first = dt[0];
  return dt.some((d) => d.startTime !== first.startTime || d.endTime !== first.endTime);
}
// Compact label used in both the start and end cells of the date row,
// so multi-day shows have visually identical date typography.
function formatDateLabel(d) {
  if (!d) return "—";
  return `${weekday(d)} ${shortMonth(d)} ${d.getDate()}`;
}
function daysFromToday(d) {
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// ─── Styles ──────────────────────────────────────────────────────────
const st = {
  page: {
    minHeight: "calc(100vh - 60px)",
    background: gradients.pageDark,
    marginLeft: "-1rem", marginRight: "-1rem",
    maxWidth: "calc(100% + 2rem)", boxSizing: "border-box",
    marginTop: "-2rem", marginBottom: "-2rem",
    padding: "0 0 5rem",
    color: colors.textPrimary,
  },
  header: { padding: "3rem 0 1.5rem" },
  eyebrow: {
    color: colors.gold, fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
  },
  eyebrowMark: { marginRight: "0.4rem" },
  title: {
    fontSize: "clamp(1.8rem, 3vw, 2.4rem)", fontWeight: 800,
    margin: "0.65rem 0 0.5rem", letterSpacing: "-0.02em",
    color: colors.textPrimary,
  },
  sub: { color: colors.textMuted, fontSize: "0.92rem" },

  errorBanner: {
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.3)",
    color: "#fca5a5",
    padding: "0.75rem 1rem", borderRadius: 8,
    fontSize: "0.85rem", marginBottom: "1.5rem",
  },

  stateMsg: {
    color: colors.textFaint,
    textAlign: "center",
    padding: "3rem 1rem",
    fontSize: "0.9rem",
  },
  stateMsgInline: {
    color: colors.textFaint,
    textAlign: "center",
    padding: "2rem 1rem",
    fontSize: "0.85rem",
  },

  // ── Calendar ──
  calendarPanel: {
    background: gradients.goldPanel,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 16,
    padding: "1.25rem 1.4rem 1.4rem",
    marginBottom: "2rem",
  },
  calendarHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    flexWrap: "wrap", gap: "1rem",
    marginBottom: "1rem",
  },
  calendarTitleWrap: {
    display: "flex", alignItems: "center", gap: "0.6rem",
  },
  calendarTitle: {
    margin: 0,
    fontSize: "1.2rem", fontWeight: 700,
    color: colors.textPrimary,
    letterSpacing: "-0.01em",
    minWidth: 180,
  },
  calNavBtn: {
    width: 30, height: 30,
    background: "transparent",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 6,
    color: colors.textSecondary,
    cursor: "pointer", fontSize: "1.1rem", lineHeight: 1,
    fontFamily: "inherit",
  },
  todayBtn: {
    marginLeft: "0.5rem",
    background: "transparent",
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 999,
    padding: "0.3rem 0.85rem",
    color: colors.goldLight, cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
  },
  viewToggle: {
    display: "inline-flex",
    background: "rgba(15,23,42,0.6)",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 999,
    padding: 3,
  },
  toggleBtn: {
    background: "transparent",
    border: "none",
    padding: "0.3rem 0.9rem",
    color: colors.textMuted, cursor: "pointer",
    fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    fontFamily: "inherit",
    borderRadius: 999,
  },
  toggleBtnActive: {
    background: gradients.goldPill,
    color: "#0f172a",
  },

  weekRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "0.25rem",
    marginBottom: "0.4rem",
  },
  weekLabel: {
    textAlign: "center",
    color: colors.textFaint,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    padding: "0.3rem 0",
  },
  // Wrapper around the active grid + the outgoing grid during a month
  // transition. Position relative + overflow hidden so the absolute
  // layer can slide in/out without bleeding past the panel.
  monthGridWrap: {
    position: "relative",
    overflow: "hidden",
  },
  monthGridIn: {
    position: "relative",
    zIndex: 1,
    willChange: "transform",
  },
  monthGridOut: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    zIndex: 0,
    willChange: "transform",
    pointerEvents: "none",
  },
  monthGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "0.25rem",
  },
  // Identical min + max height locks the cell — adding pills can't
  // push it taller because there's no auto-sizing dimension. The
  // pills slot below has its own fixed height so the cell's contents
  // also can't grow vertically. Cell stays position:relative so the
  // pill popover anchors against it correctly.
  // ─── STRICT fixed-height calendar cell ───────────────────────────
  // Hardcoded height: 80 (no min, no max, no auto). overflow:hidden
  // clips anything inside that would otherwise push out, so adding
  // a pill or toggling attending status cannot resize the cell. No
  // flex on the cell — day number + event container each have their
  // own fixed heights and stack via plain block flow.
  dayCell: {
    height: 80,
    background: "rgba(15,23,42,0.45)",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 8,
    padding: 0,
    color: colors.textSecondary,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "border-color 0.12s, background 0.12s",
    overflow: "hidden",
    boxSizing: "border-box",
  },
  dayCellMuted: {
    color: colors.textVeryFaint,
    background: "rgba(15,23,42,0.25)",
  },
  dayCellToday: {
    borderColor: colors.borderGold,
    boxShadow: "0 0 0 1px rgba(245,158,11,0.25)",
  },
  dayCellExpanded: {
    borderColor: colors.gold,
    background: "rgba(245,158,11,0.05)",
  },
  // ─── Day number row ───
  // Fixed 20px tall, no auto sizing. The block-flow stack inside
  // the cell places this above eventContainer naturally.
  dayNumber: {
    height: 20,
    lineHeight: "20px",
    padding: "0 6px",
    fontSize: "0.78rem", fontWeight: 700,
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums",
  },
  // ─── Event container ───
  // Hardcoded 56px tall, overflow:hidden. Pills past what fits are
  // clipped, so adding shows can never push the cell taller. No
  // flex / no auto / no min/max — single fixed dimension.
  eventContainer: {
    height: 56,
    overflow: "hidden",
    padding: "0 4px",
    boxSizing: "border-box",
  },
  // ─── Event pill (per the user spec, exactly) ───
  // height 16, font-size 10, line-height 16, padding 0 4, white-
  // space nowrap, overflow hidden, text-overflow ellipsis,
  // width 100%, display block, margin-bottom 2.
  eventPill: {
    display: "block",
    width: "100%",
    height: 16,
    fontSize: "10px",
    lineHeight: "16px",
    padding: "0 4px",
    marginBottom: 2,
    background: gradients.goldPill,
    color: "#0f172a",
    fontWeight: 800,
    letterSpacing: "0.02em",
    borderRadius: 3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    boxSizing: "border-box",
  },

  expandedPane: {
    marginTop: "1rem",
    background: "rgba(245,158,11,0.04)",
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 10,
    padding: "0.85rem 1.1rem",
  },
  expandedHead: {
    color: colors.goldLight,
    fontSize: "0.7rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
    marginBottom: "0.65rem",
  },
  expandedList: {
    display: "flex", flexDirection: "column",
    gap: "0.4rem",
  },
  // Calendar click popover row. Vertical stack: top line shows date
  // + name + meta; below sits the optional Remove from Attending
  // button (rendered only when onRemove is passed — list-view rows
  // skip it).
  expandedRow: {
    display: "flex", flexDirection: "column",
    gap: "0.6rem",
    padding: "0.7rem 0",
    borderTop: `1px solid ${colors.borderSoft}`,
  },
  expandedTopLine: {
    display: "grid",
    gridTemplateColumns: "100px 1fr",
    alignItems: "center",
    gap: "0.85rem",
  },
  expandedActions: {
    display: "flex",
    justifyContent: "flex-start",
  },
  // ── Live countdown ──
  // Big tabular gold digits + small letter labels, with a soft glow.
  // Today gets a brighter palette + the scp-countdown-pulse keyframe
  // (defined in index.css) for emphasis. countdownPassed is the muted
  // "Show has passed" fallback once the start time has elapsed.
  countdownRow: {
    display: "flex", alignItems: "baseline",
    gap: "1rem",
    color: "#fbbf24",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
    textShadow: "0 0 18px rgba(245,158,11,0.28)",
  },
  countdownTodayRow: {
    color: "#fde68a",
    animation: "scp-countdown-pulse 1.4s ease-in-out infinite",
  },
  countdownUnit: {
    display: "inline-flex", alignItems: "baseline", gap: "0.2rem",
  },
  countdownNum: {
    fontSize: "1.5rem", fontWeight: 800,
    lineHeight: 1,
  },
  countdownLabel: {
    fontSize: "0.65rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "rgba(251,191,36,0.6)",
  },
  countdownPassed: {
    color: colors.textVeryFaint,
    fontSize: "0.78rem",
    fontStyle: "italic",
  },

  // ── Remove from Attending button ──
  // Subtle red outline, fills red on hover. Spec verbatim from the
  // user request (border 1px #f87171, color #f87171, transparent bg,
  // hover state inverts to filled). State-driven hover because inline
  // styles can't address :hover.
  removeAttendingBtn: {
    background: "transparent",
    color: "#f87171",
    border: "1px solid #f87171",
    borderRadius: 6,
    padding: "0.4rem 0.85rem",
    fontSize: "0.7rem", fontWeight: 800,
    letterSpacing: "0.1em", textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.12s, color 0.12s",
  },
  removeAttendingBtnHover: {
    background: "#f87171",
    color: "#0f172a",
  },
  expandedDate: {
    color: colors.goldLight,
    fontSize: "0.74rem", fontWeight: 700,
    letterSpacing: "0.04em",
    fontVariantNumeric: "tabular-nums",
  },
  expandedDetails: { minWidth: 0 },
  expandedName: {
    color: colors.textPrimary, fontWeight: 700,
    fontSize: "0.92rem",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  // Day-of-Y banner shown in the popover when the user clicks a day
  // inside a multi-day run. "Day 2 of 3" + "10:00 AM to 6:00 PM" laid
  // out on a single line; pill + time text both gold-tinted to match
  // the rest of the popover accents.
  expandedDayBanner: {
    display: "flex", alignItems: "center", gap: "0.55rem",
    marginTop: "0.3rem",
    flexWrap: "wrap",
  },
  expandedDayBadge: {
    background: gradients.goldPill,
    color: "#0f172a",
    fontSize: "0.62rem", fontWeight: 800,
    letterSpacing: "0.14em", textTransform: "uppercase",
    padding: "0.18rem 0.55rem",
    borderRadius: 999,
    flexShrink: 0,
  },
  expandedDayTime: {
    color: colors.goldLight,
    fontSize: "0.85rem", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.01em",
  },
  expandedMeta: {
    color: colors.textMuted,
    fontSize: "0.78rem",
    marginTop: "0.15rem",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listView: {
    display: "flex", flexDirection: "column",
    gap: "0.3rem",
    marginTop: "0.5rem",
  },

  // ── Filter bar ──
  filterBar: {
    background: gradients.goldPanelSimple,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 14,
    padding: "1.1rem 1.3rem",
    marginBottom: "1.5rem",
  },
  filterRow: {
    display: "flex", flexWrap: "wrap", gap: "0.85rem",
    alignItems: "flex-end",
  },
  filterField: {
    display: "flex", flexDirection: "column", gap: "0.3rem",
  },
  filterLabel: {
    color: colors.textFaint,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  select: {
    background: "rgba(15,23,42,0.7)",
    color: colors.textSecondary,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 6,
    padding: "0.45rem 0.65rem",
    fontSize: "0.85rem",
    fontFamily: "inherit",
    minWidth: 160,
  },
  input: {
    background: "rgba(15,23,42,0.7)",
    color: colors.textSecondary,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 6,
    padding: "0.45rem 0.65rem",
    fontSize: "0.85rem",
    fontFamily: "inherit",
    // color-scheme: dark tells the browser to render native form
    // controls (including the date picker popup) in dark mode, so the
    // calendar that opens from <input type="date"> isn't a stark white
    // panel against our dark page. accent-color paints the picker's
    // selection highlight gold to match the rest of the app.
    // The trigger icon's color comes from CSS in index.css.
    colorScheme: "dark",
    accentColor: "#f59e0b",
  },
  // Wrapping anchor for the Near Me button + active pill + inline panel.
  // inline-flex so the active pill (when set) sits to the right of the
  // button on the same baseline.
  nearMeAnchor: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  nearMeBtn: {
    background: gradients.goldPill,
    color: "#0f172a",
    border: "none",
    borderRadius: 8,
    padding: "0.55rem 1.1rem",
    fontWeight: 800, fontSize: "0.78rem",
    letterSpacing: "0.04em", textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 4px 12px rgba(245,158,11,0.2)",
  },
  nearMeBtnOpen: {
    boxShadow: "0 0 0 2px rgba(245,158,11,0.55), 0 4px 12px rgba(245,158,11,0.25)",
  },
  // Stronger gold treatment when a Near Me filter is currently
  // applied — distinguishes "you have proximity sorting on" from the
  // default idle button. Composes with nearMeBtnOpen when both apply.
  nearMeBtnActive: {
    background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.7), 0 6px 18px rgba(245,158,11,0.35)",
  },
  // Active proximity pill — only renders when a Near Me filter is set.
  // "ZIP · Nmi" with a click-to-clear × in gold.
  nearMeActivePill: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.55)",
    color: colors.goldLight,
    fontSize: 12, fontWeight: 700,
    letterSpacing: "0.04em",
    padding: "4px 4px 4px 10px",
    borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
  },
  nearMeActiveClose: {
    width: 18, height: 18,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "#fbbf24",
    fontSize: 14, fontWeight: 900, lineHeight: 1,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  },
  // Stacked dropdown panel anchored below the Near Me button. 160w
  // matches the spec footprint; gold-tinted border + dark fill ties it
  // to the rest of the active-state palette without competing with the
  // pulldown contents. nearMeFadeIn keyframe lives in index.css.
  nearMePanel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: 160,
    background: "rgba(15,23,42,0.95)",
    border: "1px solid rgba(245,158,11,0.45)",
    borderRadius: 8,
    padding: 10,
    boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 70,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    animation: "nearMeFadeIn 120ms ease-out",
    transformOrigin: "top right",
  },
  nearMeZipInput: {
    width: "100%",
    height: 32,
    padding: "0 10px",
    borderRadius: 6,
    background: "rgba(15,23,42,0.85)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    fontSize: 13,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.04em",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.12s, box-shadow 0.12s",
  },
  nearMeZipInputFocus: {
    borderColor: "#f59e0b",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.5)",
  },
  nearMeRadiusSelect: {
    width: "100%",
    height: 32,
    padding: "0 10px",
    borderRadius: 6,
    background: "rgba(15,23,42,0.85)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    boxSizing: "border-box",
    outline: "none",
  },
  // Subtle dark-outlined Reset — visually de-emphasised vs. the
  // input/select above it because clearing should feel lower-weight
  // than configuring.
  nearMeResetBtn: {
    width: "100%",
    height: 30,
    borderRadius: 6,
    background: "transparent",
    color: "#e2e8f0",
    border: "1px solid rgba(255,255,255,0.18)",
    fontSize: 12, fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase",
    fontFamily: "inherit",
    cursor: "pointer",
    padding: 0,
    boxSizing: "border-box",
  },
  nearMeInlineError: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: 600,
  },
  filterMeta: {
    marginTop: "0.85rem",
    color: colors.textFaint,
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.14em", textTransform: "uppercase",
    fontVariantNumeric: "tabular-nums",
  },

  // ── Multi-state dropdown ──
  msWrap: {
    position: "relative",
  },
  msTrigger: {
    minWidth: 180,
    background: "rgba(15,23,42,0.7)",
    color: colors.textSecondary,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 6,
    padding: "0.45rem 0.75rem",
    fontSize: "0.85rem", fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "0.6rem",
    textAlign: "left",
  },
  msTriggerOpen: {
    borderColor: colors.borderGold,
    color: colors.textPrimary,
  },
  msChevron: {
    color: colors.gold,
    fontSize: "0.7rem",
  },
  msPanel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    width: 260,
    maxHeight: 320,
    overflowY: "auto",
    background: "linear-gradient(160deg, #0f172a 0%, #0a0f1f 100%)",
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 10,
    boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
    padding: 6,
    zIndex: 60,
  },
  msItem: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    width: "100%",
    padding: "0.45rem 0.6rem",
    borderRadius: 6,
    background: "transparent",
    border: "none",
    color: colors.textSecondary,
    fontFamily: "inherit",
    fontSize: "0.82rem", fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
  },
  msItemChecked: {
    color: colors.goldLight,
    background: "rgba(245,158,11,0.06)",
    fontWeight: 700,
  },
  msCheckbox: {
    width: 16, height: 16,
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 3,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: "#0f172a",
    fontSize: "0.7rem", fontWeight: 800,
    flexShrink: 0,
  },
  msCheckboxChecked: {
    background: gradients.goldPill,
    borderColor: colors.gold,
  },
  msCode: {
    marginLeft: "auto",
    color: colors.textFaint,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.74rem",
    letterSpacing: "0.04em",
  },

  // ── Selected-state pills + Clear all ──
  pillRow: {
    display: "flex", flexWrap: "wrap", gap: "0.4rem",
    marginTop: "0.85rem",
  },
  statePill: {
    display: "inline-flex", alignItems: "center", gap: "0.4rem",
    background: gradients.goldPill,
    color: "#0f172a",
    border: "none",
    borderRadius: 999,
    padding: "0.3rem 0.65rem 0.3rem 0.85rem",
    fontFamily: "inherit",
    fontSize: "0.75rem", fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(245,158,11,0.2)",
  },
  statePillX: {
    fontSize: "0.95rem", fontWeight: 800, lineHeight: 1,
    opacity: 0.8,
  },
  clearAllBtn: {
    background: "transparent",
    border: `1px solid ${colors.borderSoft}`,
    color: colors.textMuted,
    borderRadius: 999,
    padding: "0.3rem 0.85rem",
    fontFamily: "inherit",
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    cursor: "pointer",
  },

  // ── Shows grid ──
  // gridWrap reserves a minimum height so an empty result set never
  // collapses the page (which is what causes scroll-jump on filter).
  // The grid itself fades opacity on filter changes — sequential
  // 200ms fade-out, data swap, 200ms fade-in. Transition is declared
  // on the static style so React's render doesn't churn it.
  gridWrap: {
    minHeight: 480,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
    gridAutoRows: "1fr",
    gap: "1rem",
    transition: "opacity 200ms ease-in-out",
  },
  // No-results state inside the grid — spans all columns so it sits
  // centered + can't break the grid's layout commitment.
  gridEmpty: {
    gridColumn: "1 / -1",
    color: colors.textFaint,
    textAlign: "center",
    padding: "3rem 1rem",
    fontSize: "0.9rem",
  },

  // ── Pagination ──
  // Dark pill row rendered above AND below the grid. Active page picks
  // up the gold-pill gradient; inactive cells are subtle dark with a
  // hover effect handled via the .scp-page-btn class in index.css
  // (inline styles can't address :hover). Disabled prev/next dim to
  // 0.35. The wrapping divs in the render apply spacing — keeps the
  // bar's own style placement-agnostic.
  pagination: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: "0.45rem",
    flexWrap: "wrap",
  },
  paginationTop: {
    marginBottom: "1.25rem",
  },
  paginationBottom: {
    marginTop: "1.75rem",
  },
  pageBtn: {
    background: "rgba(15,23,42,0.6)",
    color: colors.textSecondary,
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 999,
    minWidth: 36, height: 36,
    padding: "0 0.75rem",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.82rem", fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
  },
  pageBtnActive: {
    background: gradients.goldPill,
    color: "#0f172a",
    borderColor: colors.gold,
    boxShadow: "0 4px 12px rgba(245,158,11,0.22)",
  },
  pageBtnDisabled: {
    // Per spec: 0.4 opacity, no hover effect (the .scp-page-btn:hover
    // rule in index.css excludes :disabled buttons via :not(:disabled),
    // so disabled cells naturally lose the gold hover treatment).
    opacity: 0.4,
    cursor: "not-allowed",
  },
  pageEllipsis: {
    color: colors.textFaint,
    fontSize: "0.85rem", fontWeight: 700,
    padding: "0 0.4rem",
    userSelect: "none",
  },
  card: {
    background: gradients.goldPanel,
    border: `1px solid ${colors.borderSoft}`,
    borderLeft: `1px solid ${colors.borderSoft}`,
    borderRadius: 12,
    padding: "1.1rem 1.2rem 1.2rem",
    display: "flex", flexDirection: "column",
    transition: "border-color 0.12s, transform 0.12s",
  },
  cardBody: {
    flex: 1,
    display: "flex", flexDirection: "column",
    gap: "0.6rem",
  },
  cardAttending: {
    borderLeft: `3px solid ${colors.gold}`,
    paddingLeft: "calc(1.2rem - 2px)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.15), 0 8px 24px rgba(245,158,11,0.08)",
  },
  // ── Date header (original stacked-pill spec, restored verbatim) ──
  // dateBox / dateWeekday / dateDay / dateMonth match the
  // cardDateBlock / cardWeekday / cardDay / cardMonth values from the
  // first ShowsPage commit (673b333) so single-day cards look exactly
  // like they did on launch. Both pills share the same style; the gold
  // arrow lives between them in multi-day shows.
  dateRow: {
    display: "flex", alignItems: "center",
    gap: "0.65rem",
  },
  dateBox: {
    display: "flex", flexDirection: "column",
    alignItems: "center",
    background: "rgba(15,23,42,0.6)",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 8,
    padding: "0.35rem 0.6rem",
    minWidth: 56,
  },
  dateWeekday: {
    color: colors.gold,
    fontSize: "0.6rem", fontWeight: 800,
    letterSpacing: "0.18em",
  },
  dateDay: {
    color: colors.textPrimary,
    fontSize: "1.4rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1, letterSpacing: "-0.02em",
    marginTop: "0.1rem",
  },
  dateMonth: {
    color: colors.textMuted,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginTop: "0.1rem",
  },
  dateArrow: {
    color: colors.gold, // #f59e0b
    fontSize: "1.25rem", fontWeight: 800,
    lineHeight: 1,
  },

  // ── Countdown ──
  // Lives on its own line above the date row so the three-element
  // date layout stays balanced. Right-aligned, small badge.
  countdownRow: {
    display: "flex", justifyContent: "flex-end",
    marginBottom: "-0.1rem",
  },
  countdown: {
    background: "rgba(245,158,11,0.14)",
    border: `1px solid ${colors.borderGold}`,
    color: colors.goldLight,
    fontSize: "0.62rem", fontWeight: 800,
    letterSpacing: "0.14em",
    padding: "0.2rem 0.55rem",
    borderRadius: 999,
  },
  cardName: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: "1.02rem", fontWeight: 700,
    letterSpacing: "-0.01em", lineHeight: 1.3,
  },
  cardVenue: {
    color: colors.textSecondary,
    fontSize: "0.85rem",
  },
  cardCity: {
    color: colors.textMuted,
    fontSize: "0.78rem",
    letterSpacing: "0.02em",
  },
  cardTime: {
    color: colors.textMuted,
    fontSize: "0.78rem",
    fontVariantNumeric: "tabular-nums",
  },
  // Subtitle appended to the time line on multi-day shows whose
  // schedules actually differ between days. Picks up the gold accent
  // so the eye catches it.
  cardTimeVary: {
    color: colors.goldLight,
    fontVariantNumeric: "normal",
    fontStyle: "italic",
  },

  // ── Travel time row ──
  // The track is fixed-width with overflow:hidden so the SVG's
  // translateX 0% → 100% loop reads as a continuous animated journey
  // rather than a popped-out element. Vertical alignment matters here:
  // SVGs have their own intrinsic baseline so the row uses align-items
  // center to keep the duration label level with the vehicle.
  travelRow: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    marginTop: "0.45rem",
  },
  travelTrack: {
    width: 64, height: 14,
    overflow: "hidden",
    flexShrink: 0,
    borderRadius: 4,
    background: "rgba(245,158,11,0.05)",
  },
  travelLabel: {
    color: colors.textMuted,
    fontSize: "0.75rem",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.01em",
  },
  travelSpinner: {
    width: 12, height: 12,
    border: "1.5px solid rgba(245,158,11,0.25)",
    borderTopColor: "#f59e0b",
    borderRadius: "50%",
    animation: "travelSpin 0.85s linear infinite",
    flexShrink: 0,
  },
  cardActions: {
    // marginTop: auto pins this to the bottom of the flex column even
    // when cardBody content is short — combined with grid auto-rows: 1fr
    // this gives all tiles in a row the same height + same button position.
    // justifyContent: center sits the (only) button at the horizontal
    // midline since the TCDB link was removed.
    marginTop: "auto",
    paddingTop: "1rem",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  attendBtn: {
    // Content-sized so cardActions' justifyContent: center actually
    // centers the button (flex:1 would stretch it to full row width).
    background: "transparent",
    color: colors.goldLight,
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 8,
    padding: "0.55rem 1.4rem",
    fontSize: "0.74rem", fontWeight: 800,
    letterSpacing: "0.08em", textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.12s, color 0.12s",
  },
  attendBtnOn: {
    background: gradients.goldPill,
    color: "#0f172a",
    boxShadow: "0 4px 12px rgba(245,158,11,0.2)",
  },
};
