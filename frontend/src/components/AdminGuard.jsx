import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes } from "aws-amplify/auth";

// Route guard for /admin routes. Three-state: while we're still loading the
// role, show a placeholder (NOT a redirect) so a logged-in admin doesn't get
// bounced to /portfolio for a frame on every refresh. Unauth → /signin.
// Auth but not admin → /portfolio. Backend endpoints enforce role
// independently — this guard is purely a UX layer to avoid a flash of
// admin chrome before the API rejects the call.
export default function AdminGuard({ children }) {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const [role, setRole] = useState("loading");

  useEffect(() => {
    if (authStatus === "configuring") return;
    if (authStatus !== "authenticated") { setRole(null); return; }
    let cancelled = false;
    fetchUserAttributes()
      .then((attrs) => { if (!cancelled) setRole(attrs["custom:role"] ?? null); })
      .catch(() => { if (!cancelled) setRole(null); });
    return () => { cancelled = true; };
  }, [authStatus]);

  if (authStatus === "configuring" || role === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Loading…</span>
      </div>
    );
  }
  if (authStatus !== "authenticated") return <Navigate to="/signin" replace />;
  if (role !== "admin") return <Navigate to="/portfolio" replace />;
  return children;
}
