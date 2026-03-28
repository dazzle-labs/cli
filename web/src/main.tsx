import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { dark } from "@clerk/ui/themes";
import { App } from "./App.js";
import { DevApp } from "./DevApp.js";
import { PostHog } from "./PostHog.js";
import { Toaster } from "./components/ui/sonner.js";
import "./index.css";

const devToken = import.meta.env.VITE_DEV_TOKEN as string | undefined;

// Prevent dev auth bypass from being used in production builds.
if (devToken && import.meta.env.PROD) {
  throw new Error(
    "VITE_DEV_TOKEN must not be set in production builds. " +
    "Remove it from your environment and rebuild."
  );
}

if (devToken) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PostHog.Provider>
        <DevApp devToken={devToken} />
        <Toaster richColors closeButton />
      </PostHog.Provider>
    </React.StrictMode>
  );
} else {
  const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
  if (!clerkPubKey) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required");
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PostHog.Provider>
        <ClerkProvider publishableKey={clerkPubKey} appearance={{ theme: dark }}>
          <App />
          <Toaster richColors closeButton />
        </ClerkProvider>
      </PostHog.Provider>
    </React.StrictMode>
  );
}
