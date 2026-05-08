import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import NavHeader from "./components/Layout.jsx";
import AdminGuard from "./components/AdminGuard.jsx";
import HomePage from "./pages/HomePage.jsx";
import AboutPage from "./pages/AboutPage.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import UsernameSetupPage from "./pages/UsernameSetupPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import PortfolioPage from "./pages/PortfolioPage.jsx";
import AddCardPage from "./pages/AddCardPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import AdminConsignmentsPage from "./pages/AdminConsignmentsPage.jsx";
import ShowsPage from "./pages/ShowsPage.jsx";

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
          {/* setup-username has its own full-bleed layout, so it isn't wrapped
              by ProtectedRoute's container. The page itself redirects to
              /signin when unauthenticated and /portfolio when already set. */}
          <Route path="/setup-username" element={<UsernameSetupPage />} />
          <Route path="/portfolio" element={<ProtectedRoute><PortfolioPage /></ProtectedRoute>} />
          <Route path="/add-card"  element={<ProtectedRoute><AddCardPage /></ProtectedRoute>} />
          <Route path="/profile"   element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/settings"  element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/shows"     element={<ProtectedRoute><ShowsPage /></ProtectedRoute>} />
          {/* Admin routes — AdminGuard handles unauth + non-admin redirects.
              Wrapped in <main className="container"> through ProtectedRoute is
              wrong here because the admin pages own a full-bleed sub-nav; we
              wrap the children in a thin <main> manually. */}
          <Route path="/admin"               element={<AdminGuard><main className="container" style={{ padding: "2rem 1rem" }}><AdminPage /></main></AdminGuard>} />
          <Route path="/admin/consignments"  element={<AdminGuard><main className="container" style={{ padding: "2rem 1rem" }}><AdminConsignmentsPage /></main></AdminGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Authenticator.Provider>
  );
}
