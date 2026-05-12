import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes, updateUserAttributes } from "aws-amplify/auth";
import { getAvatarUploadUrl, getAvatarViewUrl } from "../services/api.js";
import { gradients } from "../utils/theme.js";

export default function ProfilePage() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const navigate = useNavigate();

  const [attrs, setAttrs]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(false);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [username, setUsername]   = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [success, setSuccess]     = useState(false);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState(null);

  // ── Load profile + avatar on mount ──
  useEffect(() => {
    if (authStatus === "configuring") return;
    if (authStatus !== "authenticated") {
      navigate("/signin", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const a = await fetchUserAttributes();
        if (cancelled) return;
        setAttrs(a);
        setGivenName(a.given_name ?? "");
        setFamilyName(a.family_name ?? "");
        setUsername(a.preferred_username ?? "");
        // `picture` attr stores the S3 key — fetch a signed view URL
        if (a.picture) {
          try {
            const { viewUrl } = await getAvatarViewUrl(a.picture);
            if (!cancelled) setAvatarUrl(viewUrl);
          } catch {/* ignore — avatar just won't show */}
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authStatus, navigate]);

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const trimmedUsername = username.trim();
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(trimmedUsername)) {
      return setError("Username: 3–30 characters, letters/numbers/_/- only");
    }
    if (trimmedUsername.includes("@")) {
      return setError("Username cannot be an email address");
    }

    const updates = {};
    if (givenName.trim()  !== (attrs.given_name  ?? "")) updates.given_name  = givenName.trim();
    if (familyName.trim() !== (attrs.family_name ?? "")) updates.family_name = familyName.trim();
    if (trimmedUsername    !== (attrs.preferred_username ?? "")) updates.preferred_username = trimmedUsername;

    if (Object.keys(updates).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await updateUserAttributes({ userAttributes: updates });
      const fresh = await fetchUserAttributes();
      setAttrs(fresh);
      setEditing(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const msg = err?.message ?? "Failed to update profile";
      if (/AliasExists|already exists/i.test(msg)) {
        setError("That username is already taken");
      } else if (/email format|email address/i.test(msg)) {
        setError("Username cannot be an email address");
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
    setGivenName(attrs.given_name ?? "");
    setFamilyName(attrs.family_name ?? "");
    setUsername(attrs.preferred_username ?? "");
  }

  async function handleAvatarSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting same file
    if (!file) return;
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      return setAvatarError("Please use a JPG, PNG, or WebP image");
    }
    if (file.size > 2 * 1024 * 1024) {
      return setAvatarError("Image must be 2MB or smaller");
    }
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      // 1) Get signed PUT URL + S3 key
      const { uploadUrl, key, contentType } = await getAvatarUploadUrl(file.type);
      // 2) Upload directly to S3
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      // 3) Save the S3 key as Cognito picture attribute
      await updateUserAttributes({ userAttributes: { picture: key } });
      // 4) Fetch a fresh signed view URL and display it
      const { viewUrl } = await getAvatarViewUrl(key);
      setAvatarUrl(viewUrl);
    } catch (err) {
      setAvatarError(err?.message ?? "Avatar upload failed");
    } finally {
      setAvatarUploading(false);
    }
  }

  if (loading) {
    return (
      <div style={st.page}>
        <div style={st.loadingMsg}>Loading…</div>
      </div>
    );
  }

  const initials =
    ((givenName?.[0] ?? "") + (familyName?.[0] ?? "")).toUpperCase() || "?";

  return (
    <div style={st.page}>
      <div className="container" style={st.inner}>
        <header style={st.header}>
          <p style={st.eyebrow}><span style={st.mark}>◆</span> Profile</p>
          <h1 style={st.title}>My Profile</h1>
          <p style={st.subtitle}>Manage your name, username, and profile photo.</p>
        </header>

        <section style={st.panel}>
          {/* Avatar */}
          <div style={st.avatarRow}>
            <div style={st.avatar}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" style={st.avatarImg} />
              ) : (
                <span style={st.avatarInitials}>{initials}</span>
              )}
              {avatarUploading && (
                <div style={st.avatarOverlay}>
                  <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>●</span>
                </div>
              )}
            </div>
            <div style={st.avatarMeta}>
              <p style={st.avatarLabel}>Profile Photo</p>
              <label style={st.uploadBtn}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarSelect}
                  disabled={avatarUploading}
                  style={{ display: "none" }}
                />
                {avatarUploading ? "Uploading…" : avatarUrl ? "Change Photo" : "Upload Photo"}
              </label>
              <p style={st.avatarHint}>JPG, PNG, or WebP · max 2MB</p>
              {avatarError && <p style={st.fieldError}>{avatarError}</p>}
            </div>
          </div>

          <div style={st.divider} />

          {success && <div style={st.successBanner}>✓ Profile updated successfully</div>}
          {error   && <div style={st.errorBanner}>{error}</div>}

          <form onSubmit={handleSave}>
            <div style={st.fieldGrid}>
              <Field
                label="First Name"
                value={givenName}
                onChange={setGivenName}
                disabled={!editing || saving}
              />
              <Field
                label="Last Name"
                value={familyName}
                onChange={setFamilyName}
                disabled={!editing || saving}
              />
            </div>

            <Field
              label="Username"
              value={username}
              onChange={setUsername}
              disabled={!editing || saving}
              hint="3–30 characters · letters, numbers, _ and -"
              prefix="@"
            />

            <div style={st.actions}>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  style={st.primaryBtn}
                >
                  Edit Profile
                </button>
              ) : (
                <>
                  <button type="button" onClick={handleCancel} disabled={saving} style={st.secondaryBtn}>
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} style={st.primaryBtn}>
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, disabled, hint, prefix }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={st.field}>
      <label style={st.fieldLabel}>{label}</label>
      <div style={{
        ...st.inputWrap,
        ...(focused ? st.inputWrapFocused : {}),
        ...(disabled ? st.inputWrapDisabled : {}),
      }}>
        {prefix && <span style={st.inputPrefix}>{prefix}</span>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          style={st.input}
        />
      </div>
      {hint && <p style={st.fieldHint}>{hint}</p>}
    </div>
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
    textAlign: "center", color: "#64748b", padding: "5rem 1rem",
    fontSize: "0.9rem",
  },

  header: { marginBottom: "2.5rem" },
  eyebrow: {
    color: "#d4af37", fontSize: "0.7rem", fontWeight: 700,
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
    padding: "2rem",
  },

  // ── Avatar ──
  avatarRow: { display: "flex", gap: "1.5rem", alignItems: "center" },
  avatar: {
    position: "relative",
    width: 96, height: 96,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #1e293b, #0f172a)",
    border: "1px solid rgba(212,175,55,0.3)",
    overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 0 24px rgba(212,175,55,0.1), 0 4px 16px rgba(0,0,0,0.4)",
  },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  avatarInitials: {
    fontSize: "2rem", fontWeight: 800, color: "#d4af37",
    letterSpacing: "-0.02em",
  },
  avatarOverlay: {
    position: "absolute", inset: 0,
    background: "rgba(15,23,42,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#d4af37", fontSize: "1.2rem",
  },
  avatarMeta: { flex: 1, minWidth: 0 },
  avatarLabel: {
    fontSize: "0.62rem", fontWeight: 700,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: "#94a3b8", margin: "0 0 0.6rem",
  },
  uploadBtn: {
    display: "inline-block",
    background: "rgba(212,175,55,0.1)",
    border: "1px solid rgba(212,175,55,0.4)",
    color: "#e6c463",
    fontSize: "0.82rem", fontWeight: 700,
    padding: "0.5rem 1rem", borderRadius: 999,
    cursor: "pointer", letterSpacing: "0.01em",
  },
  avatarHint: {
    fontSize: "0.7rem", color: "#64748b",
    margin: "0.55rem 0 0", letterSpacing: "0.02em",
  },

  divider: {
    height: 1,
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
    margin: "1.75rem 0",
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
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1rem",
    marginBottom: "1.25rem",
  },
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
    borderColor: "rgba(212,175,55,0.65)",
    background: "rgba(15,23,42,0.95)",
    boxShadow: "0 0 0 3px rgba(212,175,55,0.12)",
  },
  inputWrapDisabled: { opacity: 0.7 },
  inputPrefix: {
    color: "#d4af37", fontSize: "0.95rem", fontWeight: 700,
    marginRight: "0.4rem",
  },
  input: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#f1f5f9",
    fontSize: "0.95rem", fontWeight: 500,
    padding: "0.75rem 0",
    fontFamily: "inherit",
  },
  fieldHint: {
    fontSize: "0.7rem", color: "#64748b",
    margin: "0.45rem 0 0", paddingLeft: "0.5rem",
    letterSpacing: "0.02em",
  },
  fieldError: {
    fontSize: "0.78rem", color: "#fca5a5",
    margin: "0.5rem 0 0",
  },

  actions: {
    display: "flex", justifyContent: "flex-end", gap: "0.75rem",
    marginTop: "1.5rem",
  },
  primaryBtn: {
    background: gradients.goldPill,
    color: "#0f172a", border: "none", borderRadius: 999,
    fontSize: "0.88rem", fontWeight: 800,
    padding: "0.65rem 1.5rem", cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 4px 16px rgba(212,175,55,0.2)",
  },
  secondaryBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#94a3b8",
    fontSize: "0.85rem", fontWeight: 600,
    padding: "0.65rem 1.25rem", borderRadius: 999,
    cursor: "pointer",
  },
};
