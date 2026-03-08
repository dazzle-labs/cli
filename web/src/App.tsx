import {
  Show,
  useAuth,
} from "@clerk/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { setTokenGetter } from "./client.js";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { StageDetail } from "./pages/StageDetail.js";
import { StreamConfig } from "./pages/StreamConfig.js";
import { ApiKeys } from "./pages/ApiKeys.js";
import { Docs } from "./pages/Docs.js";
import { LandingPage } from "./pages/LandingPage.js";
import { PreviewPage } from "./pages/PreviewPage.js";

function AuthSetup() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);
  return null;
}

function AuthenticatedApp() {
  return (
    <>
      <Show when="signed-out">
        <LandingPage />
      </Show>
      <Show when="signed-in">
        <AuthSetup />
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/stage/:stageId" element={<StageDetail />} />
            <Route path="/destinations" element={<StreamConfig />} />
            <Route path="/api-keys" element={<ApiKeys />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </Show>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/stage/:stageId/preview" element={<PreviewPage />} />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
