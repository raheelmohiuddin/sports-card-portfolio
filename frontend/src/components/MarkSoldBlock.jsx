import { useEffect, useState } from "react";
import { getShows, markCardSold } from "../services/api.js";

// "Mark as Sold" affordance for cards the user sold themselves (a friend,
// at a show, on eBay self-listed, at an auction house they used directly).
// Distinct from the consignment flow: no platform involvement, no fee,
// no sellers_net — what the user enters IS the realized exit.
//
// Visibility (locked per .agents/mark-as-sold-plan.md §4):
//   role === 'admin'                                            → null
//   cardStatus === 'sold' (already self-sold)                   → null
//   cardStatus === 'traded' (gone via trade)                    → null
//   consignmentStatus in {pending, in_review, listed, sold}     → null
//   consignmentStatus === 'declined' OR null                    → render
//
// Visual treatment intentionally subordinate to ConsignBlock's gold CTA:
// the platform-mediated path is the primary action; self-sold is the
// alternative. Slate fill on the CTA (no gold per MASTER §3.2 scarcity).
//
// Three flows:
//   collapsed → "Mark as Sold" button
//   form      → venue selector + dynamic input + price + date + submit
//   submitted → component unmounts (parent flips card.status='sold')
const OPEN_OR_SOLD_CONSIGNMENT = new Set(["pending", "in_review", "listed", "sold"]);

const AUCTION_SUGGESTIONS = [
  "eBay Auction", "PWCC", "Heritage", "Goldin",
  "Fanatics Collect", "Sotheby's", "Memory Lane",
];

export default function MarkSoldBlock({
  cardId,
  role,
  cardStatus,
  consignmentStatus,
  onMarkedSold,
}) {
  const [stage,        setStage]        = useState("collapsed"); // collapsed | form
  const [venueType,    setVenueType]    = useState("show");      // show | auction | other
  const [showId,       setShowId]       = useState("");
  const [auctionHouse, setAuctionHouse] = useState("");
  const [otherText,    setOtherText]    = useState("");
  const [price,        setPrice]        = useState("");
  const [soldAt,       setSoldAt]       = useState(() => new Date().toISOString().slice(0, 10));
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState(null);
  // Past attended shows — null = not yet fetched, [] = fetched-empty.
  // Lazy-loaded on form expand per OQ-5 (most modal opens won't hit this).
  const [userShows,    setUserShows]    = useState(null);
  const [showsLoading, setShowsLoading] = useState(false);
  const [showsError,   setShowsError]   = useState(null);

  // Lazy-fetch the user's past attended shows the first time the form
  // opens. Deferred from modal-open so most card opens don't pay the
  // network cost. Filter is client-side: attending=true AND date <= today,
  // sorted by date desc (most recent shows first).
  useEffect(() => {
    if (stage !== "form") return;
    if (userShows !== null) return;
    let cancelled = false;
    setShowsLoading(true);
    setShowsError(null);
    getShows()
      .then((all) => {
        if (cancelled) return;
        const today = new Date().toISOString().slice(0, 10);
        const past = (all ?? [])
          .filter((s) => s.attending && s.date && s.date <= today)
          .sort((a, b) => b.date.localeCompare(a.date));
        setUserShows(past);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("MarkSoldBlock: getShows failed", err);
        setShowsError(err?.message ?? "Couldn't load your shows");
        setUserShows([]); // unblock the user — they can pick auction/other instead
      })
      .finally(() => { if (!cancelled) setShowsLoading(false); });
    return () => { cancelled = true; };
  }, [stage, userShows]);

  // Visibility gates (must come AFTER all hooks per Rules of Hooks).
  if (role === "admin") return null;
  if (cardStatus === "sold" || cardStatus === "traded") return null;
  if (consignmentStatus && OPEN_OR_SOLD_CONSIGNMENT.has(consignmentStatus)) return null;

  // Auto-fill sale date from the selected show's date per OQ-2.
  // The date input remains editable — covers the "sale closed the day
  // after the show" edge case.
  function handleShowSelect(e) {
    const newId = e.target.value;
    setShowId(newId);
    if (newId) {
      const show = userShows?.find((s) => s.id === newId);
      if (show?.date) setSoldAt(show.date);
    }
  }

  function handleCancel() {
    setStage("collapsed");
    setError(null);
    // Form fields stay populated so a re-open resumes where the user left off.
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const parsedPrice = parseFloat(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setBusy(false);
      setError("Sold price must be a non-negative number");
      return;
    }

    const payload = {
      soldPrice: parsedPrice,
      soldAt,
      venueType,
    };
    if (venueType === "show")    payload.showId       = showId || null;
    if (venueType === "auction") payload.auctionHouse = auctionHouse;
    if (venueType === "other")   payload.otherText    = otherText;

    try {
      const result = await markCardSold(cardId, payload);
      // Optimistic patch — parent updates the card list, which cascades
      // into CardModal's `card` prop, which flips visibility (this
      // component returns null on the next render via the cardStatus
      // gate above). No need to reset local state.
      onMarkedSold?.({
        status:           "sold",
        soldPrice:        result.soldPrice,
        soldAt:           result.soldAt,
        soldVenueType:    result.soldVenueType,
        soldShowId:       result.soldShowId       ?? null,
        soldAuctionHouse: result.soldAuctionHouse ?? null,
        soldOtherText:    result.soldOtherText    ?? null,
      });
    } catch (err) {
      setError(err?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "collapsed") {
    return (
      <button type="button" onClick={() => setStage("form")} style={st.cta}>
        Mark as Sold
      </button>
    );
  }

  const isShow    = venueType === "show";
  const isAuction = venueType === "auction";
  const isOther   = venueType === "other";

  return (
    <form onSubmit={handleSubmit} style={st.form}>
      <div style={st.formHead}>
        <span style={st.formTitle}>Mark as Sold</span>
        <button type="button" onClick={handleCancel} style={st.formClose} aria-label="Cancel">✕</button>
      </div>

      {/* Venue type — segmented control. Three mutually-exclusive options.
          Switching tabs preserves all other field values so a user can
          experiment with the venue without retyping price/date. */}
      <div role="tablist" aria-label="Sale venue" style={st.venueTabs}>
        <VenueTab label="Show"    active={isShow}    onClick={() => setVenueType("show")} />
        <VenueTab label="Auction" active={isAuction} onClick={() => setVenueType("auction")} />
        <VenueTab label="Other"   active={isOther}   onClick={() => setVenueType("other")} />
      </div>

      {/* Venue-specific second input. Renders one of three based on venueType. */}
      {isShow && (
        <label style={st.label}>
          <span style={st.labelText}>Show</span>
          {showsLoading ? (
            <div style={st.note}>Loading your attended shows…</div>
          ) : userShows && userShows.length === 0 ? (
            <div style={st.emptyNote}>
              No past attended shows on your profile. Switch to Auction or Other.
            </div>
          ) : (
            <select value={showId} onChange={handleShowSelect} style={st.input} required>
              <option value="">— Select a show —</option>
              {(userShows ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.date}
                </option>
              ))}
            </select>
          )}
          {showsError && <span style={st.fieldErr}>{showsError}</span>}
        </label>
      )}

      {isAuction && (
        <label style={st.label}>
          <span style={st.labelText}>Auction House</span>
          <input
            type="text"
            list="mark-sold-auction-suggestions"
            value={auctionHouse}
            onChange={(e) => setAuctionHouse(e.target.value)}
            placeholder="e.g. eBay Auction, PWCC"
            style={st.input}
            required
          />
          {/* Datalist drives the autocomplete dropdown without restricting
              free input — users can type any auction house name. */}
          <datalist id="mark-sold-auction-suggestions">
            {AUCTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
          </datalist>
        </label>
      )}

      {isOther && (
        <label style={st.label}>
          <span style={st.labelText}>Description</span>
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="e.g. private sale, dealer at flea market, friend"
            style={st.input}
            required
          />
        </label>
      )}

      <label style={st.label}>
        <span style={st.labelText}>Sold Price</span>
        <input
          type="number" min="0" step="0.01" inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          style={st.input}
          required
        />
      </label>

      <label style={st.label}>
        <span style={st.labelText}>Sale Date</span>
        <input
          type="date"
          value={soldAt}
          onChange={(e) => setSoldAt(e.target.value)}
          style={st.input}
          required
        />
      </label>

      {error && <div style={st.error}>{error}</div>}

      <button type="submit" disabled={busy} style={{ ...st.submit, ...(busy ? st.submitBusy : {}) }}>
        {busy ? "Submitting…" : "Mark as Sold"}
      </button>
    </form>
  );
}

function VenueTab({ label, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{ ...st.venueTab, ...(active ? st.venueTabActive : {}) }}
    >
      {label}
    </button>
  );
}

const st = {
  // ─── CTA (collapsed state) ─────────────────────────────────────────
  // Slate fill, hairline border. Subordinate to ConsignBlock's gold CTA
  // which sits directly above per CardModal layout. Brand gold is reserved
  // for portfolio-value displays + premium tier badges per MASTER §3.2.
  cta: {
    width: "100%",
    background: "rgba(71, 85, 105, 0.55)",
    color: "#e2e8f0",
    fontWeight: 700, fontSize: "0.85rem",
    letterSpacing: "0.04em", textTransform: "uppercase",
    padding: "0.8rem 1rem",
    borderRadius: 10,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: "0.5rem", marginBottom: "0.5rem",
    transition: "background 0.15s ease",
  },

  // ─── Form chrome (expanded state) ──────────────────────────────────
  // Slate-tinted background + hairline border. Visually quieter than
  // ConsignBlock's amber form so the two affordances don't compete for
  // attention while both held-state CTAs are visible.
  form: {
    background: "rgba(148, 163, 184, 0.04)",
    border: "1px solid rgba(148, 163, 184, 0.20)",
    borderRadius: 12,
    padding: "1.1rem 1.1rem 1rem",
    marginTop: "0.5rem", marginBottom: "0.5rem",
    display: "flex", flexDirection: "column", gap: "0.85rem",
  },
  formHead: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    marginBottom: "0.1rem",
  },
  formTitle: {
    color: "#cbd5e1",
    fontSize: "0.7rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  formClose: {
    background: "transparent", border: "none",
    color: "#94a3b8", cursor: "pointer",
    fontSize: "0.85rem", padding: 4,
  },

  // ─── Venue type segmented control ──────────────────────────────────
  venueTabs: {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
    background: "rgba(15, 23, 42, 0.6)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    overflow: "hidden",
  },
  venueTab: {
    padding: "0.55rem 0.5rem",
    background: "transparent",
    border: "none", cursor: "pointer",
    color: "#94a3b8",
    fontFamily: "inherit",
    fontSize: "0.72rem", fontWeight: 700,
    letterSpacing: "0.10em", textTransform: "uppercase",
    transition: "background 0.12s ease, color 0.12s ease",
  },
  venueTabActive: {
    background: "rgba(71, 85, 105, 0.65)",
    color: "#f1f5f9",
  },

  // ─── Inputs (shared with the venue + price + date fields) ──────────
  // Same dark input shell as ConsignBlock for visual cohesion.
  label: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  labelText: {
    color: "#94a3b8",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  input: {
    width: "100%",
    background: "rgba(15,23,42,0.7)",
    color: "#e2e8f0",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "0.55rem 0.75rem",
    fontSize: "0.88rem",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },

  // ─── Status notes (shows-loading / shows-empty / field error) ─────
  note: {
    color: "#94a3b8",
    fontSize: "0.78rem",
    fontStyle: "italic",
    padding: "0.55rem 0.75rem",
  },
  emptyNote: {
    color: "#cbd5e1",
    fontSize: "0.78rem",
    padding: "0.6rem 0.75rem",
    background: "rgba(15,23,42,0.45)",
    border: "1px dashed rgba(148, 163, 184, 0.28)",
    borderRadius: 8,
    lineHeight: 1.4,
  },
  fieldErr: {
    color: "#fca5a5",
    fontSize: "0.72rem",
    marginTop: "0.2rem",
  },

  // ─── Submit (primary action inside form) ───────────────────────────
  // Slate-darker gradient — distinct from the collapsed CTA so the
  // primary-action role is visually clear once the form opens.
  submit: {
    width: "100%",
    background: "linear-gradient(135deg, #475569 0%, #334155 100%)",
    color: "#f1f5f9",
    fontWeight: 800, fontSize: "0.88rem",
    letterSpacing: "0.04em", textTransform: "uppercase",
    padding: "0.8rem 1rem",
    borderRadius: 10,
    border: "1px solid rgba(148, 163, 184, 0.28)",
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: "0.2rem",
  },
  submitBusy: { opacity: 0.7, cursor: "wait" },

  // ─── Submission error (4xx response surfaced inline) ───────────────
  error: {
    background: "rgba(248,113,113,0.1)",
    border: "1px solid rgba(248,113,113,0.35)",
    color: "#fca5a5",
    fontSize: "0.78rem",
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
  },
};
