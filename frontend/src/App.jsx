import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import Layout from "./components/Layout.jsx";
import PortfolioPage from "./pages/PortfolioPage.jsx";
import AddCardPage from "./pages/AddCardPage.jsx";

export default function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <BrowserRouter>
          <Layout user={user} signOut={signOut}>
            <Routes>
              <Route path="/" element={<Navigate to="/portfolio" replace />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/add-card" element={<AddCardPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      )}
    </Authenticator>
  );
}
