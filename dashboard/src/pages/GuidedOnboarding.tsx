import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { ExplainerStep } from "@/components/onboarding/ExplainerStep";
import { ApiKeyCreator } from "@/components/onboarding/ApiKeyCreator";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm";
import { SessionCreator } from "@/components/onboarding/SessionCreator";
import { FrameworkSelector } from "@/components/onboarding/FrameworkSelector";
import { ConnectionDetails } from "@/components/onboarding/ConnectionDetails";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm";
import type { Framework } from "@/components/onboarding/frameworks";
import type { Session } from "@/gen/api/v1/session_pb.js";
import { streamClient } from "@/client.js";

const STEPS = ["What is this?", "API key", "Stream to", "Endpoint", "Choose tool", "Connect"];

export function GuidedOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [streamDest, setStreamDest] = useState<StreamDestinationData | null>(null);

  const handleDone = useCallback(() => {
    navigate("/");
  }, [navigate]);

  async function createStreamDestination(dest: StreamDestinationData) {
    try {
      await streamClient.createStreamDestination({
        name: dest.name,
        platform: dest.platform,
        rtmpUrl: dest.rtmpUrl,
        streamKey: dest.streamKey,
        enabled: true,
      });
    } catch {
      // best-effort
    }
  }

  function renderStep() {
    switch (step) {
      case 0:
        return <ExplainerStep onNext={() => setStep(1)} />;
      case 1:
        return (
          <ApiKeyCreator
            onCreated={(key) => {
              setApiKey(key);
              setStep(2);
            }}
          />
        );
      case 2:
        return (
          <StreamDestinationForm
            verbose
            onNext={(dest) => {
              setStreamDest(dest);
              setStep(3);
            }}
          />
        );
      case 3:
        return (
          <SessionCreator
            verbose
            onCreated={async (sess, key) => {
              setSession(sess);
              if (!apiKey) setApiKey(key);
              if (streamDest) await createStreamDestination(streamDest);
              setStep(4);
            }}
          />
        );
      case 4:
        return (
          <FrameworkSelector
            selected={framework}
            onSelect={setFramework}
            onNext={() => setStep(5)}
            verbose
          />
        );
      case 5:
        return framework && session && apiKey ? (
          <ConnectionDetails
            framework={framework}
            sessionId={session.id}
            apiKey={apiKey}
            onDone={handleDone}
            verbose
          />
        ) : null;
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col items-center pt-8">
      <div className="mb-10">
        <StepIndicator steps={STEPS} current={step} />
      </div>
      <div className="w-full max-w-2xl">{renderStep()}</div>
    </div>
  );
}
