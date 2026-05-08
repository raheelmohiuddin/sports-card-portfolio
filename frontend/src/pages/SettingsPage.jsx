import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes, updatePassword } from "aws-amplify/auth";
import { gradients } from "../utils/theme.js";

const NOTIFS_KEY = "scp.notifsEnabled";

export default function SettingsPage() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const navigate = useNavigate();

  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(true);

  // Password change form
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd]         = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving]   = useState(false);
  const [pwdError, setPwdError]     = useState(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  // Notifications — stored per-device in localStorage. Replace with a backend
  // preference column when we have a server-side notifications system.
  const [notifsEnabled, setNotifsEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(NOTIFS_KEY) !== "false";
  });

  useEffect(() => {
    if (authStatus === "configuring") return;
    if (authStatus !== "authenticated") {
      navigate("/signin", { replace: true });
      return;
    }
    let cancelled = false;
    fetchUserAttributes()
      .then((a) => { if (!cancelled) setEmail(a.email ?? ""); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authStatus, navigate]);

  function toggleNotifs() {
    const next = !notifsEnabled;
    setNotifsEnabled(next);
    try { localStorage.setItem(NOTIFS_KEY, String(next)); } catch {}
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(false);
    if (!currentPwd) return setPwdError("Please enter your current password");
    if (newPwd.length < 8) return setPwdError("New password must be at least 8 characters");
    if (newPwd !== confirmPwd) return setPwdError("New passwords don't match");
    if (newPwd === currentPwd) return setPwdError("New password must differ from current");

    setPwdSaving(true);
    try {
      await updatePassword({ oldPassword: currentPwd, newPassword: newPwd });
      setPwdSuccess(true);
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      setTimeout(() => setPwdSuccess(false), 3500);
    } catch (err) {
      const msg = err?.message ?? "Failed to update password";
      if (/Incorrect/i.test(msg) || /Password attempts/i.test(msg)) {
        setPwdError("Current password is incorrect");
      } else if (/InvalidPassword/i.test(msg)) {
        setPwdError("Password doesn't meet the requirements (8+ chars, mixed case, number)");
      } else {
        setPwdError(msg);
      }
    } finally {
      setPwdSaving(false);
    }
  }

  if (loading) {
    return <div style={st.page}><div style={st.loadingMsg}>Loading…</div></div>;
  }

  return (
    <div style={st.page}>
      <div className="container" style={st.inner}>
        <header style={st.header}>
          <p style={st.eyebrow}><span style={st.mark}>◆</span> Settings</p>
          <h1 style={st.title}>Account Settings</h1>
          <p style={st.subtitle}>Manage your email, password, and notifications.</p>
        </header>

        {/* ── Email (read-only) ── */}
        <section style={st.panel}>
          <h2 style={st.panelTitle}>Email</h2>
          <p style={st.panelSub}>Your sign-in email — contact support to change.</p>
          <div style={st.readonlyField}>
            <span style={st.readonlyValue}>{email}</span>
            <span style={st.verifiedBadge}>✓ Verified</span>
          </div>
        </section>

        {/* ── Password ── */}
        <section style={st.panel}>
          <h2 style={st.panelTitle}>Change Password</h2>
          <p style={st.panelSub}>At least 8 characters, with upper, lower, and a number.</p>

          {pwdSuccess && <div style={st.successBanner}>✓ Password updated successfully</div>}
          {pwdError   && <div style={st.errorBanner}>{pwdError}</div>}

          <form onSubmit={handlePasswordSubmit}>
            <PasswordField label="Current Password"  value={currentPwd}  onChange={setCurrentPwd}  disabled={pwdSaving} autoComplete="current-password" />
            <PasswordField label="New Password"      value={newPwd}      onChange={setNewPwd}      disabled={pwdSaving} autoComplete="new-password" />
            <PasswordField label="Confirm New Password" value={confirmPwd} onChange={setConfirmPwd} disabled={pwdSaving} autoComplete="new-password" />

            <div style={st.actions}>
              <button type="submit" disabled={pwdSaving} style={st.primaryBtn}>
                {pwdSaving ? "Updating…" : "Update Password"}
              </button>
            </div>
          </form>
        </section>

        {/* ── Notifications ── */}
        <section style={st.panel}>
          <h2 style={st.panelTitle}>Email Notifications</h2>
          <p style={st.panelSub}>Get emails when target prices are hit and milestones are achieved.</p>

          <div style={st.toggleRow}>
            <div>
              <div style={st.toggleLabel}>Email me about portfolio activity</div>
              <div style={st.toggleHint}>Target hits, new rare cards, monthly summaries</div>
            </div>
            <ToggleSwitch on={notifsEnabled} onChange={toggleNotifs} />
          </div>
        </section>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, disabled, autoComplete }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={st.field}>
      <label style={st.fieldLabel}>{label}</label>
      <div style={{
        ...st.inputWrap,
        ...(focused ? st.inputWrapFocused : {}),
        ...(disabled ? st.inputWrapDisabled : {}),
      }}>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          autoComplete={autoComplete}
          style={st.input}
        />
      </div>
    </div>
  );
}

function ToggleSwitch({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      style={{ ...st.switch, ...(on ? st.switchOn : {}) }}
    >
      <span style={{ ...st.switchKnob, ...(on ? st.switchKnobOn : {}) }} />
    </button>
  );
}

const st = {
  page: {
    overflowX: "hidden",
    background: gradients.pageDark,
    minHeight: "calc(100vh - 60px)",
    // -1rem instead of calc(50% - 50vw) — see PortfolioPage st.page for the
    // full reasoning (100vw + scrollbar = right-edge overflow on mobile).
    marginLeft: "-1rem",
    marginRight: "-1rem",
    maxWidth: "calc(100% + 2rem)",
    boxSizing: "border-box",
    marginTop: "-2rem",
    marginBottom: "-2rem",
    padding: "3.5rem 0 5rem",
    color: "#e2e8f0",
  },
  inner: { maxWidth: 720 },
  loadingMsg: {
    textAlign: "center", color: "#64748b",
    padding: "5rem 1rem", fontSize: "0.9rem",
  },

  header: { marginBottom: "2.5rem" },
  eyebrow: {
    color: "#f59e0b", fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    marginBottom: "1rem",
  },
  mark: { marginRight: "0.4rem" },
  title: {
    fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
    fontWeight: 800, color: "#f1f5f9",
    letterSpacing: "-0.03em", lineHeight: 1.1,
    margin: "0 0 0.85rem",
  },
  subtitle: {
    color: "#64748b", fontSize: "0.95rem",
    lineHeight: 1.65, maxWidth: 520, margin: 0,
  },

  panel: {
    background: gradients.goldPanel,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "1.75rem 2rem",
    marginBottom: "1.5rem",
  },
  panelTitle: {
    fontSize: "1.1rem", fontWeight: 800, color: "#f1f5f9",
    margin: "0 0 0.4rem", letterSpacing: "-0.01em",
  },
  panelSub: {
    color: "#64748b", fontSize: "0.85rem",
    margin: "0 0 1.5rem", lineHeight: 1.5,
  },

  // ── Email read-only ──
  readonlyField: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: "0.85rem 1.1rem",
  },
  readonlyValue: {
    color: "#e2e8f0", fontSize: "0.92rem", fontWeight: 500,
    letterSpacing: "0.01em",
  },
  verifiedBadge: {
    color: "#10b981", fontSize: "0.7rem", fontWeight: 700,
    background: "rgba(16,185,129,0.1)",
    border: "1px solid rgba(16,185,129,0.3)",
    padding: "0.2rem 0.55rem", borderRadius: 999,
    letterSpacing: "0.04em",
  },

  // ── Banners ──
  successBanner: {
    background: "rgba(16,185,129,0.08)",
    border: "1px solid rgba(16,185,129,0.3)",
    color: "#34d399",
    fontSize: "0.85rem", fontWeight: 600,
    padding: "0.7rem 1rem", borderRadius: 8,
    marginBottom: "1.25rem",
  },
  errorBanner: {
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.25)",
    color: "#fca5a5",
    fontSize: "0.85rem",
    padding: "0.7rem 1rem", borderRadius: 8,
    marginBottom: "1.25rem",
  },

  // ── Form ──
  field: { marginBottom: "1.25rem" },
  fieldLabel: {
    display: "block",
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.16em", textTransform: "uppercase",
    color: "#64748b", marginBottom: "0.5rem",
  },
  inputWrap: {
    display: "flex", alignItems: "center",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "0 1rem",
    transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
  },
  inputWrapFocused: {
    borderColor: "rgba(245,158,11,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
  },
  inputWrapDisabled: { opacity: 0.7 },
  input: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#f1f5f9",
    fontSize: "0.95rem", fontWeight: 500,
    padding: "0.75rem 0",
    fontFamily: "inherit",
  },

  actions: {
    display: "flex", justifyContent: "flex-end",
    marginTop: "0.5rem",
  },
  primaryBtn: {
    background: gradients.goldPill,
    color: "#0f172a", border: "none", borderRadius: 999,
    fontSize: "0.88rem", fontWeight: 800,
    padding: "0.65rem 1.5rem", cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 4px 16px rgba(245,158,11,0.2)",
  },

  // ── Toggle ──
  toggleRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "1rem",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: "1rem 1.1rem",
  },
  toggleLabel: { fontSize: "0.9rem", fontWeight: 600, color: "#f1f5f9" },
  toggleHint:  { fontSize: "0.78rem", color: "#64748b", marginTop: "0.2rem" },
  switch: {
    position: "relative",
    width: 44, height: 24,
    borderRadius: 999,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.08)",
    cursor: "pointer",
    transition: "background 0.2s, border-color 0.2s",
    flexShrink: 0,
    padding: 0,
  },
  switchOn: {
    background: "rgba(245,158,11,0.45)",
    borderColor: "rgba(245,158,11,0.65)",
  },
  switchKnob: {
    position: "absolute",
    top: 2, left: 2,
    width: 18, height: 18,
    borderRadius: "50%",
    background: "#cbd5e1",
    transition: "transform 0.2s, background 0.2s",
  },
  switchKnobOn: {
    transform: "translateX(20px)",
    background: "#f59e0b",
  },
};
