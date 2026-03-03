import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { App } from "./App.js";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

if (!clerkPubKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPubKey} appearance={{ baseTheme: dark }}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
);
