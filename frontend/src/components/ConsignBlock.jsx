import { useState } from "react";
import { createConsignment } from "../services/api.js";

// "Consign This Card" affordance for the card sidebar. Three states:
//   collapsed → button only.
//   expanded  → form (type, asking price, notes) + submit.
//   submitted → success message; no further action.
//
// Hidden entirely for admin users (they shouldn't be consigning to themselves)
// and for users where role is unknown (loading state — fail closed).
export default function ConsignBlock({ cardId, role }) {
  const [stage, setStage]   = useState("collapsed"); // collapsed | form | submitted
  const [type, setType]     = useState("auction");
  const [price, setPrice]   = useState("");
  const [notes, setNotes]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  if (role !== "collector") return null;

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
      setStage("submitted");
    } catch (err) {
      setError(err?.message ?? "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "submitted") {
    return (
      <div style={st.successBlock}>
        <div style={st.successIcon}>✓</div>
        <div>
          <div style={st.successTitle}>Consignment submitted</div>
          <div style={st.successSub}>
            We've received your request. The team will reach out shortly to discuss next steps.
          </div>
        </div>
      </div>
    );
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

  successBlock: {
    display: "flex", gap: "0.85rem",
    background: "rgba(16,185,129,0.08)",
    border: "1px solid rgba(16,185,129,0.32)",
    borderRadius: 12,
    padding: "1rem 1.1rem",
    marginTop: "1.5rem",
  },
  successIcon: {
    width: 32, height: 32,
    borderRadius: "50%",
    background: "rgba(16,185,129,0.18)",
    color: "#6ee7b7",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: "1.05rem",
    flexShrink: 0,
  },
  successTitle: {
    color: "#a7f3d0", fontWeight: 700,
    fontSize: "0.9rem", letterSpacing: "-0.01em",
  },
  successSub: {
    color: "#94a3b8", fontSize: "0.78rem",
    marginTop: "0.25rem", lineHeight: 1.5,
  },
};
