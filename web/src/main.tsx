import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { dark } from "@clerk/ui/themes";
import { App } from "./App.js";
import { DevApp } from "./DevApp.js";
import { Toaster } from "./components/ui/sonner.js";
import "./index.css";

const devToken = import.meta.env.VITE_DEV_TOKEN as string | undefined;

if (devToken) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <DevApp devToken={devToken} />
      <Toaster richColors closeButton />
    </React.StrictMode>
  );
} else {
  const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
  if (!clerkPubKey) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required");
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkPubKey} appearance={{ theme: dark }}>
        <App />
        <Toaster richColors closeButton />
      </ClerkProvider>
    </React.StrictMode>
  );
}
