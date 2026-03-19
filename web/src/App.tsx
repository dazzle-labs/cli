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
import { PublicDocs } from "./pages/PublicDocs.js";
import { LandingPage } from "./pages/LandingPage.js";
import { WatchPage } from "./pages/WatchPage.js";
import { CliAuth } from "./pages/CliAuth.js";
import { TooltipProvider } from "./components/ui/tooltip.js";

function AuthSetup() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);
  return null;
}

function DocsRouter() {
  return (
    <>
      <Show when="signed-out">
        <PublicDocs />
      </Show>
      <Show when="signed-in">
        <AuthSetup />
        <TooltipProvider>
          <Layout>
            <Docs />
          </Layout>
        </TooltipProvider>
      </Show>
    </>
  );
}

function AuthenticatedApp() {
  return (
    <>
      <Show when="signed-out">
        <LandingPage />
      </Show>
      <Show when="signed-in">
        <AuthSetup />
        <TooltipProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/stage/:stageId" element={<StageDetail />} />
              <Route path="/destinations" element={<StreamConfig />} />
              <Route path="/api-keys" element={<ApiKeys />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </TooltipProvider>
      </Show>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/watch/:slug" element={<WatchPage />} />
        <Route path="/auth/cli/:sessionId" element={<CliAuth />} />
        <Route path="/docs" element={<DocsRouter />} />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
