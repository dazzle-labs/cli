// DevApp.tsx — dev-only auto-login bypass (VITE_DEV_TOKEN)
// Skips Clerk entirely and injects a static API key as the auth token.
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { setTokenGetter } from "./client.js";
import { Layout } from "./components/Layout.js";
import { LivePage } from "./pages/LivePage.js";
import { Dashboard } from "./pages/Dashboard.js";
import { StageDetail } from "./pages/StageDetail.js";
import { StreamConfig } from "./pages/StreamConfig.js";
import { ApiKeys } from "./pages/ApiKeys.js";
import { TermsOfService } from "./pages/TermsOfService.js";
import { PrivacyPolicy } from "./pages/PrivacyPolicy.js";
import { TooltipProvider } from "./components/ui/tooltip.js";

export function DevApp({ devToken }: { devToken: string }) {
  useEffect(() => {
    setTokenGetter(() => Promise.resolve(devToken));
  }, [devToken]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route
          path="*"
          element={
            <TooltipProvider>
              <Layout>
                <Routes>
                  <Route path="/" element={<LivePage />} />
                  <Route path="/stages" element={<Dashboard />} />
                  <Route path="/stage/:stageId" element={<StageDetail />} />
                  <Route path="/destinations" element={<StreamConfig />} />
                  <Route path="/api-keys" element={<ApiKeys />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </TooltipProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
