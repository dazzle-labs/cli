import {
  SignedIn,
  SignedOut,
  useAuth,
} from "@clerk/clerk-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { setTokenGetter } from "./client.js";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";

import { ApiKeys } from "./pages/ApiKeys.js";
import { Docs } from "./pages/Docs.js";
import { LandingPage } from "./pages/LandingPage.js";

function AuthSetup() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <SignedOut>
        <LandingPage />
      </SignedOut>
      <SignedIn>
        <AuthSetup />
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/get-started" element={<Navigate to="/" replace />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </SignedIn>
    </BrowserRouter>
  );
}
