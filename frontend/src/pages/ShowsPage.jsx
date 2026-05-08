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
  // Filters — q is debounced into qApplied which is what the API sees.
  const [state, setStateFilter]     = useState("");
  const [fromDate, setFromDate]     = useState("");
  const [toDate, setToDate]         = useState("");
  const [q, setQ]                   = useState("");
  const [qApplied, setQApplied]     = useState("");

  // Debounce search input — 350ms after the last keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQApplied(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  // Fetch shows on filter change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getShows({
      state:    state || undefined,
      from:     fromDate || undefined,
      to:       toDate   || undefined,
      q:        qApplied || undefined,
    })
      .then((data) => { if (!cancelled) setShows(data); })
      .catch((e)   => { if (!cancelled) setError(e?.message ?? "Failed to load shows"); })
      .finally(()  => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [state, fromDate, toDate, qApplied]);

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
    const stored = localStorage.getItem(NEAR_ME_KEY);
    if (stored && STATE_NAME[stored]) {
      setStateFilter(stored);
      return;
    }
    const input = window.prompt(
      "Pick your state (2-letter code, e.g. PA, NY, CA) — we'll remember this for next time:"
    );
    if (!input) return;
    const code = input.trim().toUpperCase();
    if (!STATE_NAME[code]) { window.alert(`"${code}" isn't a valid US state code.`); return; }
    localStorage.setItem(NEAR_ME_KEY, code);
    setStateFilter(code);
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
          state={state}      setStateFilter={setStateFilter}
          fromDate={fromDate} setFromDate={setFromDate}
          toDate={toDate}     setToDate={setToDate}
          q={q}               setQ={setQ}
          onNearMe={applyNearMe}
          loading={loading}
          totalCount={shows.length}
          attendingCount={attending.length}
        />

        {/* ── Grid ── */}
        {loading ? (
          <div style={st.stateMsg}>Loading shows…</div>
        ) : shows.length === 0 ? (
          <div style={st.stateMsg}>No shows match your filters.</div>
        ) : (
          <div style={st.grid}>
            {shows.map((s) => (
              <ShowCard key={s.id} show={s} onToggle={() => toggleAttending(s)} />
            ))}
          </div>
        )}
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

  function shiftMonth(delta) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    setExpandedDate(null);
  }
  function goToday() {
    setCursor(startOfMonth(new Date()));
    setExpandedDate(toIsoDate(new Date()));
  }

  // Build the 6-week grid (always 42 cells: from prev-month leadin to
  // next-month padout).
  const cells = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const start = new Date(monthStart);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

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
                  onClick={() => setExpandedDate(isExpanded ? null : iso)}
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
                      <div
                        key={s.id}
                        style={{ ...st.dayPill, ...spanPillStyle(s) }}
                        title={s.endDate && s.endDate !== s.date
                          ? `${s.name} (${s.date} – ${s.endDate})`
                          : s.name}
                      >
                        {/* Only render the label on the first day so a
                            multi-day pill reads as one continuous block.
                            Other days show an empty pill of matching
                            colour/height for the visual span. */}
                        {s._isStart ? s.name : " "}
                      </div>
                    ))}
                    {dayShows.length > 2 && (
                      <div style={st.dayPillMore}>+{dayShows.length - 2}</div>
                    )}
                  </div>
                </button>
              );
            })}
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
    ? (isRange ? formatDateRange(start, end) : formatDateLine(show.date))
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
  state, setStateFilter,
  fromDate, setFromDate, toDate, setToDate,
  q, setQ, onNearMe,
  loading, totalCount, attendingCount,
}) {
  return (
    <section style={st.filterBar}>
      <div style={st.filterRow}>
        <div style={st.filterField}>
          <label style={st.filterLabel}>State</label>
          <select value={state} onChange={(e) => setStateFilter(e.target.value)} style={st.select}>
            <option value="">All states</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code} style={{ color: "#0f172a" }}>{name}</option>
            ))}
          </select>
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
      <div style={st.filterMeta}>
        {loading ? "Loading…" : `${totalCount} show${totalCount === 1 ? "" : "s"}`}
        {attendingCount > 0 && ` · ${attendingCount} attending`}
      </div>
    </section>
  );
}

// ─── Show card ───────────────────────────────────────────────────────
function ShowCard({ show, onToggle }) {
  const date    = show.date ? new Date(`${show.date}T00:00:00`) : null;
  const endDate = show.endDate && show.endDate !== show.date
    ? new Date(`${show.endDate}T00:00:00`)
    : null;
  const days = date ? daysFromToday(date) : null;
  const countdown =
    days == null    ? null :
    days  <  0      ? null :
    days === 0      ? "TODAY" :
    days === 1      ? "TOMORROW" :
                      `IN ${days} DAYS`;

  return (
    <article style={{ ...st.card, ...(show.attending ? st.cardAttending : {}) }}>
      <div style={st.cardTopRow}>
        <div style={st.cardDateBlock}>
          <div style={st.cardWeekday}>{date ? weekday(date).toUpperCase() : "—"}</div>
          <div style={st.cardDay}>{date ? date.getDate() : "—"}</div>
          <div style={st.cardMonth}>{date ? shortMonth(date) : ""}</div>
        </div>
        {endDate && (
          <div style={st.dateThrough} title="Multi-day show">
            <span style={st.dateThroughArrow}>→</span>
            <div style={st.dateThroughDay}>{endDate.getDate()}</div>
            <div style={st.dateThroughMonth}>
              {sameMonth(date, endDate) ? "" : shortMonth(endDate)}
            </div>
          </div>
        )}
        {show.attending && countdown && (
          <div style={st.countdown}>{countdown}</div>
        )}
      </div>

      <h3 style={st.cardName}>{show.name || "Untitled show"}</h3>
      {endDate && (
        <div style={st.cardDateRange}>
          {formatDateRange(date, endDate)}
        </div>
      )}
      {show.venue && <div style={st.cardVenue}>{show.venue}</div>}
      <div style={st.cardCity}>
        {show.city ? `${show.city}, ${show.state}` : show.state}
      </div>
      {show.startTime && (
        <div style={st.cardTime}>{formatTimeRange(show.startTime, show.endTime)}</div>
      )}

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
function sameMonth(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
// "May 9 – May 11" within a month, "May 30 – Jun 2" across months.
// Year is suffixed only if start and end are in different years.
function formatDateRange(start, end) {
  if (!start || !end) return "";
  const sameY = start.getFullYear() === end.getFullYear();
  const left  = `${shortMonth(start)} ${start.getDate()}`;
  const right = sameMonth(start, end)
    ? `${end.getDate()}`
    : `${shortMonth(end)} ${end.getDate()}`;
  const yearTail = sameY ? `, ${start.getFullYear()}` : `, ${start.getFullYear()} – ${end.getFullYear()}`;
  return `${left} – ${right}${yearTail}`;
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
  dayPill: {
    background: gradients.goldPill,
    color: "#0f172a",
    fontSize: "0.65rem", fontWeight: 800,
    padding: "0.12rem 0.4rem",
    borderRadius: 4,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    letterSpacing: "0.02em",
  },
  dayPillMore: {
    color: colors.goldLight,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.08em", textTransform: "uppercase",
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

  // ── Shows grid ──
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
    gap: "1rem",
  },
  card: {
    background: gradients.goldPanel,
    border: `1px solid ${colors.borderSoft}`,
    borderLeft: `1px solid ${colors.borderSoft}`,
    borderRadius: 12,
    padding: "1.1rem 1.2rem 1.2rem",
    display: "flex", flexDirection: "column",
    gap: "0.6rem",
    transition: "border-color 0.12s, transform 0.12s",
  },
  cardAttending: {
    borderLeft: `3px solid ${colors.gold}`,
    paddingLeft: "calc(1.2rem - 2px)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.15), 0 8px 24px rgba(245,158,11,0.08)",
  },
  cardTopRow: {
    display: "flex", alignItems: "flex-start",
    justifyContent: "space-between", gap: "0.5rem",
  },
  cardDateBlock: {
    display: "flex", flexDirection: "column",
    alignItems: "center",
    background: "rgba(15,23,42,0.6)",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 8,
    padding: "0.35rem 0.6rem",
    minWidth: 56,
  },
  cardWeekday: {
    color: colors.gold,
    fontSize: "0.6rem", fontWeight: 800,
    letterSpacing: "0.18em",
  },
  cardDay: {
    color: colors.textPrimary,
    fontSize: "1.4rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1, letterSpacing: "-0.02em",
    marginTop: "0.1rem",
  },
  cardMonth: {
    color: colors.textMuted,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginTop: "0.1rem",
  },
  // Multi-day shows pair the start-date pad with this trailing block:
  // arrow + end day (+ short month if the run crosses into a new month).
  dateThrough: {
    display: "flex", flexDirection: "column", alignItems: "center",
    color: colors.textMuted,
    minWidth: 36,
  },
  dateThroughArrow: {
    color: colors.gold,
    fontSize: "1.1rem", fontWeight: 800,
    lineHeight: 1,
    marginBottom: "0.2rem",
  },
  dateThroughDay: {
    color: colors.textPrimary,
    fontSize: "1.4rem", fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1, letterSpacing: "-0.02em",
  },
  dateThroughMonth: {
    color: colors.textMuted,
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.12em", textTransform: "uppercase",
    marginTop: "0.1rem",
  },
  // "May 9 – May 11" line under the title for multi-day shows.
  cardDateRange: {
    color: colors.goldLight,
    fontSize: "0.78rem", fontWeight: 700,
    letterSpacing: "0.04em",
    marginTop: "-0.15rem",
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
    marginTop: "0.4rem",
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
