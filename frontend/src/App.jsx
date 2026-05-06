import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import NavHeader from "./components/Layout.jsx";
import HomePage from "./pages/HomePage.jsx";
import AboutPage from "./pages/AboutPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import PortfolioPage from "./pages/PortfolioPage.jsx";
import AddCardPage from "./pages/AddCardPage.jsx";

function ProtectedRoute({ children }) {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  if (authStatus === "configuring") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Loading…</span>
      </div>
    );
  }
  if (authStatus !== "authenticated") {
    return <Navigate to="/signin" replace />;
  }
  return (
    <main className="container" style={{ padding: "2rem 1rem" }}>
      {children}
    </main>
  );
}

export default function App() {
  return (
    <Authenticator.Provider>
      <BrowserRouter>
        <NavHeader />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/portfolio" element={<ProtectedRoute><PortfolioPage /></ProtectedRoute>} />
          <Route path="/add-card" element={<ProtectedRoute><AddCardPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Authenticator.Provider>
  );
}
