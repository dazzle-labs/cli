import {
  Show,
  useAuth,
  useUser,
} from "@clerk/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { setTokenGetter } from "./client.js";
import { PostHog } from "./PostHog.js";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { StageDetail } from "./pages/StageDetail.js";
import { StreamConfig } from "./pages/StreamConfig.js";
import { ApiKeys } from "./pages/ApiKeys.js";
import { LivePage } from "./pages/LivePage.js";
import { PublicLivePage } from "./pages/PublicLivePage.js";
import { Docs } from "./pages/Docs.js";
import { PublicDocs } from "./pages/PublicDocs.js";
import { LandingPage } from "./pages/LandingPage.js";
import { WatchPage } from "./pages/WatchPage.js";
import { CliAuth } from "./pages/CliAuth.js";
import { TermsOfService } from "./pages/TermsOfService.js";
import { PrivacyPolicy } from "./pages/PrivacyPolicy.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { useOrganizationActivation } from "./hooks/use-organization-activation.js";

function AuthSetup() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const posthog = PostHog.use();

  useOrganizationActivation();

  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  useEffect(() => {
    if (!user) return;
    posthog?.identify(user.id, {
      userID: user.id,
      ...(user.username && { handle: user.username }),
      ...(user.fullName && { displayName: user.fullName }),
      ...(user.imageUrl && { avatar: user.imageUrl }),
      ...(user.primaryEmailAddress?.emailAddress && {
        email: user.primaryEmailAddress.emailAddress,
      }),
    });

    // Fire X signup conversion for users created in the last 60 seconds
    const age = Date.now() - (user.createdAt?.getTime() ?? 0);
    if (age < 60_000 && typeof window.twq === "function") {
      window.twq("event", "tw-rbof3-137cj0", {});
    }
  }, [posthog, user]);

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

function LiveRouter() {
  return (
    <>
      <Show when="signed-out">
        <PublicLivePage />
      </Show>
      <Show when="signed-in">
        <AuthSetup />
        <TooltipProvider>
          <Layout>
            <LivePage />
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
              <Route path="/" element={<LivePage />} />
              <Route path="/stages" element={<Dashboard />} />
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
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/live" element={<LiveRouter />} />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
