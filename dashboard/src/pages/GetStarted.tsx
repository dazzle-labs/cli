import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { streamClient } from "../client.js";
import type { Session } from "../gen/api/v1/session_pb.js";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { PathSelector } from "@/components/onboarding/PathSelector";
import { ExplainerStep } from "@/components/onboarding/ExplainerStep";
import { FrameworkSelector } from "@/components/onboarding/FrameworkSelector";
import { SessionCreator } from "@/components/onboarding/SessionCreator";
import { ConnectionDetails } from "@/components/onboarding/ConnectionDetails";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm";
import type { Framework } from "@/components/onboarding/frameworks";

type OnboardingPath = "experienced" | "guided" | null;

const EXPERIENCED_STEPS = ["Choose tool", "Stream to", "Create endpoint", "Connect"];
const GUIDED_STEPS = ["What is this?", "Stream to", "Choose tool", "Endpoint", "Connect"];

export function GetStarted() {
  const navigate = useNavigate();
  const [path, setPath] = useState<OnboardingPath>(null);
  const [step, setStep] = useState(0);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [streamDest, setStreamDest] = useState<StreamDestinationData | null>(null);

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

  function finish() {
    navigate("/");
  }

  function renderExperiencedStep() {
    switch (step) {
      case 0:
        return (
          <FrameworkSelector
            selected={framework}
            onSelect={setFramework}
            onNext={() => setStep(1)}
          />
        );
      case 1:
        return (
          <StreamDestinationForm
            onNext={(dest) => {
              setStreamDest(dest);
              setStep(2);
            }}
          />
        );
      case 2:
        return (
          <SessionCreator
            skipApiKey
            onCreated={async (sess) => {
              setSession(sess);
              if (streamDest) await createStreamDestination(streamDest);
              setStep(3);
            }}
          />
        );
      case 3:
        return framework && session ? (
          <ConnectionDetails
            framework={framework}
            sessionId={session.id}
            apiKey={null}
            onDone={finish}
          />
        ) : null;
      default:
        return null;
    }
  }

  function renderGuidedStep() {
    switch (step) {
      case 0:
        return <ExplainerStep onNext={() => setStep(1)} />;
      case 1:
        return (
          <StreamDestinationForm
            verbose
            onNext={(dest) => {
              setStreamDest(dest);
              setStep(2);
            }}
          />
        );
      case 2:
        return (
          <FrameworkSelector
            selected={framework}
            onSelect={setFramework}
            onNext={() => setStep(3)}
            verbose
          />
        );
      case 3:
        return (
          <SessionCreator
            verbose
            onCreated={async (sess, key) => {
              setSession(sess);
              setApiKey(key);
              if (streamDest) await createStreamDestination(streamDest);
              setStep(4);
            }}
          />
        );
      case 4:
        return framework && session && apiKey ? (
          <ConnectionDetails
            framework={framework}
            sessionId={session.id}
            apiKey={apiKey}
            onDone={finish}
            verbose
          />
        ) : null;
      default:
        return null;
    }
  }

  const steps = path === "experienced" ? EXPERIENCED_STEPS : path === "guided" ? GUIDED_STEPS : [];

  return (
    <div className="pt-4">
      {/* Step indicator */}
      {path && (
        <div className="mb-10 flex justify-center">
          <StepIndicator steps={steps} current={step} />
        </div>
      )}

      {/* Step content */}
      <div className="flex flex-col items-center">
        {!path ? (
          <PathSelector
            onSelect={(p) => {
              setPath(p);
              setStep(0);
            }}
          />
        ) : path === "experienced" ? (
          renderExperiencedStep()
        ) : (
          renderGuidedStep()
        )}
      </div>
    </div>
  );
}
