import { type ReactNode } from "react";
import * as PH from "posthog-js/react";

export type PostHog = PH.PostHog;

export namespace PostHog {
  export const use = (): PostHog | undefined => {
    const posthog = PH.usePostHog();
    return isDevelopment() ? undefined : posthog;
  };

  export const Provider = ({ children }: { children: ReactNode }) =>
    isDevelopment() ? (
      <>{children}</>
    ) : (
      <PH.PostHogProvider
        apiKey="phc_dtX6qNwjjZngNPMXrwpuk7HLuIkLFa3xAyDro0mgf0K"
        options={{
          api_host: "https://e.dazzle.fm",
          ui_host: "https://us.posthog.com",
          person_profiles: "identified_only",
          rageclick: true,
          session_recording: {
            maskAllInputs: true,
            minimum_duration: 3000,
          },
        }}
      >
        {children}
      </PH.PostHogProvider>
    );
}

function isDevelopment(): boolean {
  return (
    typeof window === "undefined" || window.location.hostname !== "dazzle.fm"
  );
}
