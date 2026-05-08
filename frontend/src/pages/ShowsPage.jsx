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
  const [fromDate, setFromDate]     = useState("");
  const [toDate, setToDate]         = useState("");
  const [q, setQ]                   = useState("");
  const [qApplied, setQApplied]     = useState("");

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
        <CalendarPanel attending={attending} />

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
        <div style={st.gridWrap}>
          {!hasLoadedOnce ? (
            <div style={st.stateMsg}>Loading shows…</div>
          ) : (
            <div style={{ ...st.grid, opacity: gridOpacity }}>
              {shows.length === 0 ? (
                <div style={st.gridEmpty}>No shows match your filters.</div>
              ) : (
                shows.map((s) => (
                  <ShowCard key={s.id} show={s} onToggle={() => toggleAttending(s)} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar panel ──────────────────────────────────────────────────
function CalendarPanel({ attending }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewMode, setViewMode] = useState("month"); // month | list
  const [cursor, setCursor]     = useState(() => startOfMonth(new Date()));
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
                  <ExpandedShowRow key={s.id} show={s} />
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

function ExpandedShowRow({ show, compact }) {
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
      <a
        href={`https://www.tcdb.com/CardShows.cfm?MODE=VIEW&ID=${show.tcdbId}`}
        target="_blank" rel="noreferrer"
        style={st.expandedLink}
      >TCDB ↗</a>
    </div>
  );
}

// ─── Month grid (used twice during a month-slide transition) ────────
function MonthGrid({ cursor, today, byDate, expandedDate, onToggleExpand }) {
  // 6-week (42-cell) grid, Sunday-anchored.
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
          <button
            key={iso}
            type="button"
            onClick={() => onToggleExpand(iso)}
            style={{
              ...st.dayCell,
              ...(inMonth ? {} : st.dayCellMuted),
              ...(isToday ? st.dayCellToday : {}),
              ...(isExpanded ? st.dayCellExpanded : {}),
            }}
          >
            <div style={st.dayNumber}>{d.getDate()}</div>
            <div style={st.dayPills}>
              {dayShows.slice(0, 2).map((s) => (
                <DayPill key={s.id} show={s} />
              ))}
              {dayShows.length > 2 && (
                <div style={st.dayPillMore}>+{dayShows.length - 2}</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Day pill — fixed-size + hover popover ───────────────────────────
// Pill size is locked (height + font + ellipsis) so toggling attending
// status anywhere can't reflow the day cell. The popover renders only
// on the start day of a multi-day run so a single tooltip serves the
// whole range, and uses pointer-events:none so it doesn't block the
// underlying day-cell click.
function DayPill({ show }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ ...st.dayPill, ...spanPillStyle(show) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={st.dayPillLabel}>
        {show._isStart ? show.name : " "}
      </span>
      {hover && show._isStart && (
        <div style={st.dayPillPopover} role="tooltip">
          <div style={st.popoverName}>{show.name}</div>
          {show.venue && <div style={st.popoverLine}>{show.venue}</div>}
          <div style={st.popoverLine}>
            {show.city ? `${show.city}, ${show.state}` : show.state}
          </div>
          {show.startTime && (
            <div style={st.popoverLine}>
              {formatTimeRange(show.startTime, show.endTime)}
            </div>
          )}
          {show.endDate && show.endDate !== show.date && (
            <div style={st.popoverLine}>
              {`${show.date} – ${show.endDate}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shape per-day pill corners so a multi-day pill connects visually:
// only the first day rounds its left edge and the last day rounds its
// right edge; middle days have square inner edges.
function spanPillStyle(s) {
  if (!s.endDate || s.endDate === s.date) return null;
  const left  = s._isStart ? 4 : 0;
  const right = s._isEnd   ? 4 : 0;
  return {
    borderTopLeftRadius:    left,
    borderBottomLeftRadius: left,
    borderTopRightRadius:   right,
    borderBottomRightRadius:right,
    // Negate the cell's grid gap so adjacent days' pills touch.
    marginLeft:  s._isStart ? 0 : "-0.25rem",
    marginRight: s._isEnd   ? 0 : "-0.25rem",
  };
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
        <a
          href={`https://www.tcdb.com/CardShows.cfm?MODE=VIEW&ID=${show.tcdbId}`}
          target="_blank" rel="noreferrer"
          style={st.tcdbLink}
        >View on TCDB ↗</a>
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
  dayCell: {
    background: "rgba(15,23,42,0.45)",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 8,
    minHeight: 78,
    padding: "0.4rem 0.5rem",
    color: colors.textSecondary,
    cursor: "pointer",
    display: "flex", flexDirection: "column", gap: "0.3rem",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "border-color 0.12s, background 0.12s",
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
  dayNumber: {
    fontSize: "0.78rem", fontWeight: 700,
    color: colors.textPrimary,
    fontVariantNumeric: "tabular-nums",
  },
  dayPills: {
    display: "flex", flexDirection: "column", gap: 3,
    marginTop: "auto",
  },
  // Locked-size pill — height/font/padding are fixed, label is
  // ellipsised. Toggling attending status anywhere never resizes the
  // pill or its day cell. position:relative anchors the popover.
  dayPill: {
    height: 18,
    background: gradients.goldPill,
    color: "#0f172a",
    fontSize: "0.62rem", fontWeight: 800,
    padding: "0 0.45rem",
    borderRadius: 4,
    letterSpacing: "0.02em",
    display: "flex", alignItems: "center",
    position: "relative",
    flexShrink: 0,
    overflow: "visible", // popover escapes; label has its own clip
  },
  dayPillLabel: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  dayPillMore: {
    color: colors.goldLight,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.08em", textTransform: "uppercase",
  },
  // Hover-only popover floating above the pill. pointer-events:none
  // keeps it out of click handling so the day cell underneath still
  // expands when the pill area is clicked.
  dayPillPopover: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: 0,
    minWidth: 220,
    maxWidth: 280,
    background: "rgba(10,15,31,0.97)",
    border: "1px solid rgba(245,158,11,0.45)",
    borderRadius: 8,
    padding: "0.65rem 0.8rem",
    boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
    zIndex: 50,
    pointerEvents: "none",
    textAlign: "left",
    whiteSpace: "normal",
    color: colors.textSecondary,
    fontSize: "0.78rem",
    fontWeight: 500,
    letterSpacing: "0.01em",
    lineHeight: 1.4,
    textTransform: "none",
  },
  popoverName: {
    color: colors.goldLight,
    fontWeight: 800,
    fontSize: "0.86rem",
    letterSpacing: "-0.01em",
    marginBottom: "0.3rem",
  },
  popoverLine: {
    marginTop: "0.15rem",
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
  expandedRow: {
    display: "grid",
    gridTemplateColumns: "100px 1fr auto",
    alignItems: "center",
    gap: "0.85rem",
    padding: "0.55rem 0",
    borderTop: `1px solid ${colors.borderSoft}`,
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
  expandedLink: {
    color: colors.goldLight,
    fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.08em", textTransform: "uppercase",
    textDecoration: "none",
    padding: "0.3rem 0.6rem",
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 999,
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
    marginTop: "auto",
    paddingTop: "1rem",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "0.7rem",
  },
  attendBtn: {
    flex: 1,
    background: "transparent",
    color: colors.goldLight,
    border: `1px solid ${colors.borderGold}`,
    borderRadius: 8,
    padding: "0.5rem 0.9rem",
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
  tcdbLink: {
    color: colors.textMuted,
    fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.08em",
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
};
