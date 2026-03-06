import { useState, useCallback } from "react";
import { X, ArrowLeft } from "lucide-react";
import { Overlay } from "@/components/ui/overlay";
import { StepIndicator } from "./StepIndicator";
import { PathSelector } from "./PathSelector";
import { FrameworkSelector } from "./FrameworkSelector";
import { EndpointCreator } from "./EndpointCreator";
import { ConnectionDetails } from "./ConnectionDetails";
import { StreamDestinationForm } from "./StreamDestinationForm";
import type { StreamDestinationData } from "./StreamDestinationForm";
import type { Framework } from "./frameworks";
import type { Stage } from "../../gen/api/v1/stage_pb.js";
import { stageClient, streamClient } from "../../client.js";

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
}

const EXPERIENCED_STEPS = ["Choose tool", "Stream to", "Set up stage", "Connect"];

export function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  const [mode, setMode] = useState<"experienced" | "guided" | null>(null);
  const [step, setStep] = useState(0);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [streamDest, setStreamDest] = useState<StreamDestinationData | null>(null);

  const reset = useCallback(() => {
    setMode(null);
    setStep(0);
    setFramework(null);
    setStage(null);
    setApiKey(null);
    setStreamDest(null);
  }, []);

  function handleClose() {
    reset();
    onClose();
  }

  function handleDone() {
    reset();
    onClose();
  }

  function handlePathSelect(path: "experienced" | "guided") {
    setMode(path);
    setStep(0);
  }

  function handleBack() {
    if (step === 0) {
      // Go back to path selector
      setMode(null);
    } else {
      setStep(step - 1);
    }
  }

  async function createStreamDestination(dest: StreamDestinationData): Promise<string | null> {
    try {
      const resp = await streamClient.createStreamDestination({
        name: dest.name,
        platform: dest.platform,
        rtmpUrl: dest.rtmpUrl,
        streamKey: dest.streamKey,
      });
      return resp.destination?.id ?? null;
    } catch {
      return null;
    }
  }

  const verbose = mode === "guided";

  // Back is allowed on steps 0-1, not on 2 (creating) or 3 (done)
  const canGoBack = mode !== null && step < 2;

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <FrameworkSelector
            selected={framework}
            onSelect={setFramework}
            onNext={() => setStep(1)}
            verbose={verbose}
          />
        );
      case 1:
        return (
          <StreamDestinationForm
            verbose={verbose}
            onNext={(dest) => {
              setStreamDest(dest);
              setStep(2);
            }}
          />
        );
      case 2:
        return (
          <EndpointCreator
            verbose={verbose}
            onCreated={async (st, key) => {
              setStage(st);
              setApiKey(key);
              let destId: string | null = null;
              if (streamDest) {
                destId = await createStreamDestination(streamDest);
              }
              if (destId && st.id) {
                try {
                  await stageClient.setStageDestination({ stageId: st.id, destinationId: destId });
                } catch {
                  // best-effort — user can fix in dashboard
                }
              }
              setStep(3);
            }}
          />
        );
      case 3:
        return framework && stage ? (
          <ConnectionDetails
            framework={framework}
            endpointId={stage.id}
            apiKey={apiKey}
            onDone={handleDone}
            verbose={verbose}
          />
        ) : null;
      default:
        return null;
    }
  }

  return (
    <Overlay open={open} onClose={handleClose}>
      <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.06] bg-zinc-900 p-8">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Back button + Step indicator */}
        {mode && (
          <div className="mb-8 flex items-center justify-center gap-4">
            {canGoBack ? (
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            ) : (
              <div className="w-[52px]" />
            )}
            <StepIndicator steps={EXPERIENCED_STEPS} current={step} />
          </div>
        )}

        {/* Content */}
        <div className="transition-all duration-300">
          {!mode ? (
            <PathSelector onSelect={handlePathSelect} />
          ) : (
            renderStep()
          )}
        </div>
      </div>
    </Overlay>
  );
}
