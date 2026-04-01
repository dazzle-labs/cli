import {
  Show,
  useAuth,
  useUser,
} from "@clerk/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";
import { setTokenGetter } from "./client.js";
import { PostHog } from "./PostHog.js";
import { LandingPage } from "./pages/LandingPage.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { useOrganizationActivation } from "./hooks/use-organization-activation.js";

// Lazy-load heavy pages — keeps landing page bundle small
const Layout = lazy(() => import("./components/Layout.js").then(m => ({ default: m.Layout })));
const Dashboard = lazy(() => import("./pages/Dashboard.js").then(m => ({ default: m.Dashboard })));
const StageDetail = lazy(() => import("./pages/StageDetail.js").then(m => ({ default: m.StageDetail })));
const StreamConfig = lazy(() => import("./pages/StreamConfig.js").then(m => ({ default: m.StreamConfig })));
const ApiKeys = lazy(() => import("./pages/ApiKeys.js").then(m => ({ default: m.ApiKeys })));
const LivePage = lazy(() => import("./pages/LivePage.js").then(m => ({ default: m.LivePage })));
const PublicLivePage = lazy(() => import("./pages/PublicLivePage.js").then(m => ({ default: m.PublicLivePage })));
const Docs = lazy(() => import("./pages/Docs.js").then(m => ({ default: m.Docs })));
const PublicDocs = lazy(() => import("./pages/PublicDocs.js").then(m => ({ default: m.PublicDocs })));
const WatchPage = lazy(() => import("./pages/WatchPage.js").then(m => ({ default: m.WatchPage })));
const CliAuth = lazy(() => import("./pages/CliAuth.js").then(m => ({ default: m.CliAuth })));
const TermsOfService = lazy(() => import("./pages/TermsOfService.js").then(m => ({ default: m.TermsOfService })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy.js").then(m => ({ default: m.PrivacyPolicy })));
const Billing = lazy(() => import("./pages/Billing.js").then(m => ({ default: m.Billing })));
const Pricing = lazy(() => import("./pages/Pricing.js").then(m => ({ default: m.Pricing })));

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

    // Fire X signup conversion once per new user.
    // Clerk sets createdAt ≈ lastSignInAt on the very first session.
    // We gate on a localStorage flag so it only fires once per browser.
    const created = user.createdAt?.getTime() ?? 0;
    const firstSignIn = user.lastSignInAt?.getTime() ?? 0;
    const isNewUser =
      created > 0 &&
      firstSignIn > 0 &&
      Math.abs(firstSignIn - created) < 120_000;
    const key = `twq_signup_${user.id}`;
    if (isNewUser && !localStorage.getItem(key)) {
      if (typeof window.twq === "function") {
        window.twq("event", "tw-rbof3-137cj0", {});
      }
      posthog?.capture("x_signup_conversion", {
        pixel_fired: typeof window.twq === "function",
      });
      localStorage.setItem(key, "1");
    }
  }, [posthog, user]);

  return null;
}

function DocsRouter() {
  return (
    <>
      <Show when="signed-out">
        <Suspense><PublicDocs /></Suspense>
      </Show>
      <Show when="signed-in">
        <AuthSetup />
        <TooltipProvider>
          <Suspense>
            <Layout>
              <Docs />
            </Layout>
          </Suspense>
        </TooltipProvider>
      </Show>
    </>
  );
}

function LiveRouter() {
  return (
    <>
      <Show when="signed-out">
        <Suspense><PublicLivePage /></Suspense>
      </Show>
      {/* Signed-in users get redirected to / which renders LivePage
          inside AuthenticatedApp's persistent Layout — no sidebar remount. */}
      <Show when="signed-in">
        <Navigate to="/" replace />
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
          <Suspense>
            <Layout>
              <Routes>
                <Route path="/" element={<LivePage />} />
                <Route path="/stages" element={<Dashboard />} />
                <Route path="/stage/:stageId" element={<StageDetail />} />
                <Route path="/destinations" element={<StreamConfig />} />
                <Route path="/api-keys" element={<ApiKeys />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </Suspense>
        </TooltipProvider>
      </Show>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense>
        <Routes>
          <Route path="/watch/:slug" element={<WatchPage />} />
          <Route path="/auth/cli/:sessionId" element={<CliAuth />} />
          <Route path="/docs" element={<DocsRouter />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/live" element={<LiveRouter />} />
          <Route path="/for/:personaId" element={<AuthenticatedApp />} />
          <Route path="*" element={<AuthenticatedApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
