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
export default function ConsignBlock({ cardId, role, consignmentStatus }) {
  const [stage, setStage]   = useState("collapsed"); // collapsed | form
  const [type, setType]     = useState("auction");
  const [price, setPrice]   = useState("");
  const [notes, setNotes]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  // Local-state mirror of the persisted status. Seeds from props; flips
  // to "pending" optimistically the moment a submit succeeds. The next
  // time getCards/getCard runs, props will carry the real value and
  // override this — so a server-side rejection would self-heal.
  const [status, setStatus] = useState(consignmentStatus ?? null);

  if (role === "admin") return null;

  if (status) return <StatusPill status={status} />;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createConsignment({
        cardId,
        type,
        askingPrice: price === "" ? null : parseFloat(price),
        notes: notes || null,
      });
      // Optimistically mark as pending — the API returned 201 with status
      // "pending", and we drop into the same pill render path the parent
      // would land on after a refresh.
      setStatus("pending");
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

      <label style={st.label}>
        <span style={st.labelText}>Asking Price <span style={st.optional}>· optional</span></span>
        <input
          type="number" min="0" step="0.01" inputMode="decimal"
          value={price} onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          style={st.input}
        />
      </label>

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

// ─── Read-only status pill ──────────────────────────────────────────
// Used once a consignment exists for the card. Colors per status follow
// the spec: pending=amber, in_review=blue, listed/sold=green, declined=red.
function StatusPill({ status }) {
  const variant = STATUS_VARIANTS[status];
  if (!variant) return null;
  return (
    <div style={st.statusBlock}>
      <div style={{ ...st.statusPill, ...variant.pill }}>
        <span style={{ ...st.statusDot, background: variant.dotColor }} />
        <span>{variant.label}</span>
      </div>
      {status === "declined" && (
        <p style={st.statusNote}>
          Contact us to discuss options.
        </p>
      )}
    </div>
  );
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
};
