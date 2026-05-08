import { useState } from "react";
import { createConsignment } from "../services/api.js";

// "Consign This Card" affordance for the card sidebar. Three flows:
//   has status pill → read-only display of the current consignment state.
//   no status, collapsed → "Consign This Card" button.
//   no status, form → type / asking price / notes form, then submit.
//
// Status semantics: once a card has been consigned, the user can never
// resubmit or change the status — only an admin can. So when an existing
// consignmentStatus is present (passed from props OR set optimistically
// after a successful submit) we replace the entire CTA with a read-only
// pill. Even terminal states (sold, declined) lock the button — declined
// gets a small note pointing the collector at the admin to discuss
// next steps. The backend's partial unique index is the actual guard;
// this UI just reflects it so collectors don't try to submit twice.
//
// Hidden entirely for admin users — admins shouldn't consign their own
// collection, and they manage status via the admin portal anyway.
export default function ConsignBlock({ cardId, role, consignmentStatus, consignmentSoldPrice, consignmentBlocked, onConsigned }) {
  const [stage, setStage]       = useState("collapsed"); // collapsed | form
  const [type, setType]         = useState("auction");
  const [platform, setPlatform] = useState("fanatics");  // auction-only
  const [price, setPrice]       = useState("");          // private-only
  const [notes, setNotes]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  // Local-state mirror of the persisted status. Seeds from props; flips
  // to "pending" optimistically the moment a submit succeeds. The next
  // time getCards/getCard runs, props will carry the real value and
  // override this — so a server-side rejection would self-heal.
  const [status, setStatus] = useState(consignmentStatus ?? null);

  if (role === "admin") return null;

  // Permanent block (server-derived from consignment_blocks keyed on
  // user_id + cert_number) takes precedence over every other render path.
  // Survives card delete + re-add, and has no actionable button —
  // overrides the ordinary "declined" status pill so the wording stays
  // consistent regardless of how the user got here.
  if (consignmentBlocked) return <BlockedMessage />;

  if (status) return <StatusPill status={status} soldPrice={consignmentSoldPrice ?? null} />;

  const isAuction = type === "auction";

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createConsignment({
        cardId,
        type,
        askingPrice:     isAuction ? null     : (price === "" ? null : parseFloat(price)),
        auctionPlatform: isAuction ? platform : null,
        notes: notes || null,
      });
      // Optimistically mark as pending — the API returned 201 with status
      // "pending", and we drop into the same pill render path the parent
      // would land on after a refresh.
      setStatus("pending");
      // Tell the parent so it can patch the card in its list state, so
      // closing + re-opening the sidebar still shows the pending pill.
      onConsigned?.("pending");
    } catch (err) {
      setError(err?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "collapsed") {
    return (
      <button type="button" onClick={() => setStage("form")} style={st.cta}>
        Consign This Card
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={st.form}>
      <div style={st.formHead}>
        <span style={st.formTitle}>Consign This Card</span>
        <button
          type="button"
          onClick={() => setStage("collapsed")}
          style={st.formClose}
          aria-label="Cancel"
        >✕</button>
      </div>

      <label style={st.label}>
        <span style={st.labelText}>Consignment Type</span>
        <select value={type} onChange={(e) => setType(e.target.value)} style={st.input}>
          <option value="auction">Auction</option>
          <option value="private">Private Sale</option>
        </select>
      </label>

      {isAuction ? (
        <label style={st.label}>
          <span style={st.labelText}>Auction Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={st.input}
          >
            <option value="fanatics">Fanatics</option>
            <option value="ebay">eBay</option>
          </select>
        </label>
      ) : (
        <label style={st.label}>
          <span style={st.labelText}>Asking Price <span style={st.optional}>· optional</span></span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            style={st.input}
          />
        </label>
      )}

      <label style={st.label}>
        <span style={st.labelText}>Notes <span style={st.optional}>· optional</span></span>
        <textarea
          rows={3}
          value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything we should know about the card or your goals?"
          style={{ ...st.input, resize: "vertical", fontFamily: "inherit" }}
        />
      </label>

      {error && <div style={st.error}>{error}</div>}

      <button type="submit" disabled={busy} style={{ ...st.cta, ...(busy ? st.ctaBusy : {}) }}>
        {busy ? "Submitting…" : "Submit Request"}
      </button>
    </form>
  );
}

// ─── Permanent block message ────────────────────────────────────────
// Rendered when the (user, cert) pair has a row in consignment_blocks —
// i.e. a prior consignment for this exact PSA cert was declined by the
// admin. The block survives the card being deleted and re-added, so this
// message is intentionally final: no button, no link, no path forward
// from inside the app. Keyed on cert_number so even a fresh card row
// can't bypass it.
function BlockedMessage() {
  return (
    <div style={st.blockedBlock}>
      <div style={st.blockedPill}>
        <span style={st.blockedDot} />
        <span>Consignment unavailable for this card. Please contact us for assistance.</span>
      </div>
    </div>
  );
}

// ─── Read-only status pill ──────────────────────────────────────────
// Used once a consignment exists for the card. Colors per status follow
// the spec: pending=amber, in_review=blue, listed/sold=green, declined=red.
// When status === "sold" and the admin has entered a sold price, we show
// it prominently in gold below the pill — the realized exit value.
function StatusPill({ status, soldPrice }) {
  const variant = STATUS_VARIANTS[status];
  if (!variant) return null;
  return (
    <div style={st.statusBlock}>
      <div style={{ ...st.statusPill, ...variant.pill }}>
        <span style={{ ...st.statusDot, background: variant.dotColor }} />
        <span>{variant.label}</span>
      </div>

      {status === "sold" && soldPrice != null && (
        <div style={st.soldBlock}>
          <div style={st.soldLabel}>Sold For</div>
          <div style={st.soldValue}>{fmtUsd(soldPrice)}</div>
        </div>
      )}

      {status === "declined" && (
        <p style={st.statusNote}>
          Contact us to discuss options.
        </p>
      )}
    </div>
  );
}

function fmtUsd(n) {
  if (n == null) return "—";
  return `$${parseFloat(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_VARIANTS = {
  pending: {
    label: "Consignment Pending — Under Review",
    dotColor: "#f59e0b",
    pill: {
      background: "rgba(245,158,11,0.10)",
      border: "1px solid rgba(245,158,11,0.45)",
      color: "#fbbf24",
    },
  },
  in_review: {
    label: "In Review by Collector's Reserve",
    dotColor: "#60a5fa",
    pill: {
      background: "rgba(96,165,250,0.10)",
      border: "1px solid rgba(96,165,250,0.45)",
      color: "#93c5fd",
    },
  },
  listed: {
    label: "Listed for Sale",
    dotColor: "#10b981",
    pill: {
      background: "rgba(16,185,129,0.10)",
      border: "1px solid rgba(16,185,129,0.45)",
      color: "#6ee7b7",
    },
  },
  sold: {
    label: "Sold",
    dotColor: "#10b981",
    pill: {
      background: "rgba(16,185,129,0.12)",
      border: "1px solid rgba(16,185,129,0.5)",
      color: "#6ee7b7",
    },
  },
  declined: {
    label: "Consignment Declined",
    dotColor: "#f87171",
    pill: {
      background: "rgba(248,113,113,0.10)",
      border: "1px solid rgba(248,113,113,0.45)",
      color: "#fca5a5",
    },
  },
};

const st = {
  cta: {
    width: "100%",
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    color: "#0f172a",
    fontWeight: 800, fontSize: "0.9rem",
    letterSpacing: "0.04em", textTransform: "uppercase",
    padding: "0.85rem 1rem",
    borderRadius: 10, border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 6px 20px rgba(245,158,11,0.25)",
    marginTop: "1.5rem", marginBottom: "0.5rem",
  },
  ctaBusy: { opacity: 0.7, cursor: "wait" },

  form: {
    background: "rgba(245,158,11,0.05)",
    border: "1px solid rgba(245,158,11,0.25)",
    borderRadius: 12,
    padding: "1.1rem 1.1rem 1rem",
    marginTop: "1.5rem",
    display: "flex", flexDirection: "column", gap: "0.85rem",
  },
  formHead: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    marginBottom: "0.1rem",
  },
  formTitle: {
    color: "#fbbf24",
    fontSize: "0.7rem", fontWeight: 800,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  formClose: {
    background: "transparent", border: "none",
    color: "#94a3b8", cursor: "pointer",
    fontSize: "0.85rem", padding: 4,
  },

  label: { display: "flex", flexDirection: "column", gap: "0.35rem" },
  labelText: {
    color: "#94a3b8",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
  },
  optional: {
    color: "#475569", fontWeight: 600,
    letterSpacing: "0.04em", textTransform: "none",
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

  error: {
    background: "rgba(248,113,113,0.1)",
    border: "1px solid rgba(248,113,113,0.35)",
    color: "#fca5a5",
    fontSize: "0.78rem", padding: "0.5rem 0.75rem",
    borderRadius: 6,
  },

  // ─── Status pill ───
  statusBlock: {
    marginTop: "1.5rem", marginBottom: "0.5rem",
  },
  statusPill: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    padding: "0.7rem 1rem",
    borderRadius: 10,
    fontSize: "0.78rem", fontWeight: 700,
    letterSpacing: "0.04em",
  },
  statusDot: {
    width: 8, height: 8, borderRadius: "50%",
    flexShrink: 0,
  },
  statusNote: {
    marginTop: "0.55rem",
    color: "#94a3b8",
    fontSize: "0.78rem",
    letterSpacing: "0.01em",
  },

  // ── Permanent block ──
  blockedBlock: {
    marginTop: "1.5rem", marginBottom: "0.5rem",
  },
  blockedPill: {
    display: "flex", alignItems: "flex-start", gap: "0.6rem",
    padding: "0.85rem 1rem",
    borderRadius: 10,
    background: "rgba(148,163,184,0.06)",
    border: "1px solid rgba(148,163,184,0.28)",
    color: "#cbd5e1",
    fontSize: "0.78rem", fontWeight: 600,
    letterSpacing: "0.01em", lineHeight: 1.45,
  },
  blockedDot: {
    width: 8, height: 8, borderRadius: "50%",
    background: "#94a3b8",
    flexShrink: 0,
    marginTop: "0.4rem",
  },

  // ── Sold price block (only when status=sold + admin has entered price) ──
  soldBlock: {
    marginTop: "0.75rem",
    padding: "0.85rem 1rem",
    background: "rgba(245,158,11,0.08)",
    border: "1px solid rgba(245,158,11,0.32)",
    borderRadius: 10,
  },
  soldLabel: {
    color: "#94a3b8",
    fontSize: "0.6rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    marginBottom: "0.35rem",
  },
  soldValue: {
    fontSize: "1.65rem", fontWeight: 800,
    color: "#f59e0b",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    textShadow: "0 0 32px rgba(245,158,11,0.18)",
  },
};
