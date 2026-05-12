import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes, updateUserAttributes } from "aws-amplify/auth";

// Post-confirmation step where the user picks their preferred_username.
// Cognito refuses alias-attribute values during signUp ("cannot be provided
// for unconfirmed account") so we set it here with updateUserAttributes.
// On entry: redirect to /signin if not authed; redirect to /portfolio if
// preferred_username is already set (e.g. user navigated here manually).
export default function UsernameSetupPage() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const navigate = useNavigate();
  const [val, setVal]         = useState("");
  const [focused, setFocused] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (authStatus === "configuring") return;
    if (authStatus !== "authenticated") {
      navigate("/signin", { replace: true });
      return;
    }
    let cancelled = false;
    fetchUserAttributes()
      .then((attrs) => {
        if (cancelled) return;
        if (attrs.preferred_username) {
          navigate("/portfolio", { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [authStatus, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const trimmed = val.trim();
    if (!trimmed) return setError("Please choose a username");
    // Cognito rejects email-formatted values for preferred_username. Catch
    // the obvious case (anything with @) before hitting the API.
    if (trimmed.includes("@")) {
      return setError("Username cannot be an email address — please choose a different username.");
    }
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(trimmed)) {
      return setError("3–30 characters: letters, numbers, underscores, hyphens");
    }
    setSaving(true);
    try {
      await updateUserAttributes({
        userAttributes: { preferred_username: trimmed },
      });
      navigate("/portfolio", { replace: true });
    } catch (err) {
      const msg = err?.message ?? "";
      // Map Cognito's specific failure modes to friendly copy.
      if (/email format|email address/i.test(msg)) {
        setError("Username cannot be an email address — please choose a different username.");
      } else if (/AliasExists|already exists/i.test(msg)) {
        setError("That username is already taken");
      } else {
        setError(msg || "Failed to save username");
      }
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <div style={st.page}>
        <span style={{ color: "#64748b", fontSize: "0.9rem" }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={st.page}>
      <div style={st.card}>
        <span style={st.mark}>◆</span>
        <p style={st.eyebrow}>One Last Step</p>
        <h1 style={st.title}>Choose Your Username</h1>
        <p style={st.sub}>
          This is how you'll sign in. You can also keep using your email.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ ...st.inputWrap, ...(focused ? st.inputWrapFocused : {}) }}>
            <span style={st.at}>@</span>
            <input
              type="text"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              disabled={saving}
              placeholder="username"
              style={st.input}
              maxLength={30}
            />
          </div>
          <p style={st.hint}>3–30 characters · letters, numbers, _ and - allowed</p>

          {error && <div style={st.error}>{error}</div>}

          <button type="submit" disabled={saving} style={{ ...st.btn, ...(saving ? st.btnDisabled : {}) }}>
            {saving ? "Saving…" : "Continue →"}
          </button>
        </form>
      </div>
    </div>
  );
}

const st = {
  page: {
    minHeight: "calc(100vh - 60px)",
    background: "linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "3rem 1rem",
  },
  card: {
    width: "100%", maxWidth: 460,
    background: "linear-gradient(160deg, #0f172a 0%, #0a0f1f 100%)",
    border: "1px solid rgba(245,158,11,0.2)",
    borderRadius: 16,
    boxShadow:
      "0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.08), 0 0 80px rgba(245,158,11,0.05)",
    padding: "2.5rem 2.25rem",
    color: "#e2e8f0",
    textAlign: "center",
  },
  mark: { color: "#f59e0b", fontSize: "1.4rem", display: "block", marginBottom: "1rem" },
  eyebrow: {
    color: "#f59e0b", fontSize: "0.7rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase", margin: "0 0 0.85rem",
  },
  title: {
    fontSize: "1.6rem", fontWeight: 800, color: "#f1f5f9",
    letterSpacing: "-0.02em", margin: 0, lineHeight: 1.2,
  },
  sub: {
    color: "#94a3b8", fontSize: "0.92rem",
    margin: "0.6rem 0 1.75rem", lineHeight: 1.55,
  },
  inputWrap: {
    display: "flex", alignItems: "center",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "0 1.25rem",
    transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
  },
  inputWrapFocused: {
    borderColor: "rgba(245,158,11,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(245,158,11,0.12)",
  },
  at: { color: "#f59e0b", fontSize: "1.4rem", fontWeight: 800, marginRight: "0.5rem" },
  input: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#f1f5f9", fontSize: "1.1rem", fontWeight: 600,
    padding: "0.95rem 0", letterSpacing: "0.01em",
  },
  hint: {
    fontSize: "0.72rem", color: "#64748b",
    margin: "0.6rem 0 1.5rem", letterSpacing: "0.02em",
    textAlign: "left", paddingLeft: "0.5rem",
  },
  error: {
    background: "rgba(248,113,113,0.08)",
    border: "1px solid rgba(248,113,113,0.25)",
    color: "#fca5a5", fontSize: "0.82rem",
    padding: "0.6rem 0.9rem", borderRadius: 8,
    marginBottom: "1rem", textAlign: "left",
  },
  btn: {
    width: "100%",
    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    color: "#0f172a", border: "none", borderRadius: 10,
    fontSize: "0.95rem", fontWeight: 800,
    padding: "0.9rem 1.5rem", cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 4px 16px rgba(245,158,11,0.25), 0 0 0 1px rgba(245,158,11,0.4)",
  },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" },
};
