import { useEffect, useMemo, useRef, useState } from "react";
import { getShows, markAttending, unmarkAttending } from "../services/api.js";
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

const NEAR_ME_KEY = "scp.userState";
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
        states:   states.length ? states : undefined,
        from:     fromDate || undefined,
        to:       toDate   || undefined,
        q:        qApplied || undefined,
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
  }, [statesKey, fromDate, toDate, qApplied]);

  // ── Pagination ──
  // PAGE_SIZE is fixed at 30 per spec. currentPage resets to 1 every
  // time the active filter set changes (so a new fetch always lands
  // the user on page 1) — the existing fetch effect deps below are
  // the canonical "filter changed" signal, so we mirror them here.
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [statesKey, fromDate, toDate, qApplied]);

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

  function applyNearMe() {
    let code = localStorage.getItem(NEAR_ME_KEY);
    if (!code || !STATE_NAME[code]) {
      const input = window.prompt(
        "Pick your state (2-letter code, e.g. PA, NY, CA) — we'll remember this for next time:"
      );
      if (!input) return;
      code = input.trim().toUpperCase();
      if (!STATE_NAME[code]) { window.alert(`"${code}" isn't a valid US state code.`); return; }
      localStorage.setItem(NEAR_ME_KEY, code);
    }
    // Replace the current selection with just the user's local state —
    // matches the "show me what's nearby" intent better than appending.
    setStates([code]);
  }

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
        />

        {/* ── Browse + filter ── */}
        <FilterBar
          states={states}     onToggleState={toggleState}
          onRemoveState={removeState} onClearStates={clearStates}
          fromDate={fromDate} setFromDate={setFromDate}
          toDate={toDate}     setToDate={setToDate}
          q={q}               setQ={setQ}
          onNearMe={applyNearMe}
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
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onChange={changePage}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar panel ──────────────────────────────────────────────────
// cursor + setCursor are controlled by ShowsPage so navigating months
// can drive the grid's date-range filter at the same time.
function CalendarPanel({ cursor, setCursor, attending, onToggleAttending }) {
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

function ExpandedShowRow({ show, compact, onRemove }) {
  const isRange = show.endDate && show.endDate !== show.date;
  const start = show.date    ? new Date(`${show.date}T00:00:00`)    : null;
  const end   = show.endDate ? new Date(`${show.endDate}T00:00:00`) : null;
  const dateLabel = compact
    ? (isRange
        ? `${formatDateLabel(start)} → ${formatDateLabel(end)}`
        : formatDateLine(show.date))
    : (show.startTime || "—");
  return (
    <div style={st.expandedRow}>
      <div style={st.expandedTopLine}>
        <div style={st.expandedDate}>{dateLabel}</div>
        <div style={st.expandedDetails}>
          <div style={st.expandedName}>{show.name}</div>
          <div style={st.expandedMeta}>
            {[show.venue, show.city ? `${show.city}, ${show.state}` : show.state]
              .filter(Boolean).join(" · ")}
            {show.startTime && (
              <span> · {formatTimeRange(show.startTime, show.endTime)}</span>
            )}
          </div>
        </div>
      </div>
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
  q, setQ, onNearMe,
  loading, totalCount, attendingCount,
}) {
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
        <button type="button" onClick={onNearMe} style={st.nearMeBtn}>
          📍 Near Me
        </button>
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
          <div style={st.cardTime}>{formatTimeRange(show.startTime, show.endTime)}</div>
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
  // Dark pill row at the bottom of the grid. Active page picks up the
  // gold-pill gradient; inactive cells are subtle dark with a hover
  // effect handled via the .scp-page-btn class in index.css (inline
  // styles can't address :hover). Disabled prev/next dim to 0.35.
  pagination: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: "0.45rem",
    marginTop: "1.75rem",
    flexWrap: "wrap",
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
    opacity: 0.35,
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
