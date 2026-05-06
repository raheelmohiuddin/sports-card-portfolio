import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";

export default function SignInPage() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const navigate = useNavigate();

  // Redirect to portfolio as soon as authentication completes
  useEffect(() => {
    if (authStatus === "authenticated") {
      navigate("/portfolio", { replace: true });
    }
  }, [authStatus, navigate]);

  return (
    <div style={st.page}>
      <div style={st.top}>
        <span style={st.mark}>◆</span>
        <h1 style={st.title}>Collector's Reserve</h1>
        <p style={st.sub}>Sign in to access your portfolio</p>
      </div>
      <Authenticator />
    </div>
  );
}

const st = {
  page: {
    minHeight: "calc(100vh - 60px)",
    background: "linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "3rem 1rem",
    gap: "2rem",
  },
  top: { textAlign: "center" },
  mark: { color: "#f59e0b", fontSize: "1.5rem", display: "block", marginBottom: "0.5rem" },
  title: { color: "#fff", fontSize: "1.6rem", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" },
  sub: { color: "#64748b", fontSize: "0.9rem", marginTop: "0.4rem" },
};
