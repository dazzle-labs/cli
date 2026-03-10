import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StepIndicator } from "./StepIndicator";
import { EndpointCreator } from "./EndpointCreator";
import { StreamDestinationForm } from "./StreamDestinationForm";
import type { StreamDestinationData } from "./StreamDestinationForm";
import type { StreamDestination } from "../../gen/api/v1/stream_pb.js";
import { stageClient, streamClient } from "../../client.js";
import { Button } from "@/components/ui/button";
import { PlatformIcon, PLATFORM_LIST, PLATFORM_HOVER_COLORS } from "@/components/PlatformIcon";
import { FlowDiagram } from "@/components/FlowDiagram";
import { springs } from "@/lib/motion";

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  skipIntro?: boolean;
}

const WIZARD_STEPS = ["Connect a platform", "Create a stage"];

const OAUTH_PLATFORMS = ["twitch", "youtube", "kick", "restream"] as const;

const stepVariants = {
  enter: { opacity: 0, y: 16 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function OnboardingWizard({ open, onClose, skipIntro }: OnboardingWizardProps) {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [showInfoScreen, setShowInfoScreen] = useState(!skipIntro);
  const [step, setStep] = useState(0);
  const [selectedDestId, setSelectedDestId] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);

  const reset = useCallback(() => {
    setShowInfoScreen(!skipIntro);
    setStep(0);
    setSelectedDestId(null);
    setDestinations([]);
    setShowCustomForm(false);
  }, [skipIntro]);

  function handleClose() {
    reset();
    onClose();
  }

  useEffect(() => {
    if (open) {
      refreshDestinations();
    }
  }, [open]);

  async function refreshDestinations() {
    try {
      const resp = await streamClient.listStreamDestinations({});
      setDestinations(resp.destinations);
      setAvailablePlatforms(resp.availablePlatforms);
    } catch {
      // ignore
    }
  }

  async function handleOAuthConnect(platform: string) {
    const token = await getToken();
    if (!token) return;
    window.location.href = `/oauth/${platform}/authorize?token=${encodeURIComponent(token)}&onboarding=true`;
  }

  async function handleCreateCustomDest(data: StreamDestinationData) {
    try {
      const resp = await streamClient.createStreamDestination({
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
      });
      setShowCustomForm(false);
      await refreshDestinations();
      if (resp.destination) {
        setSelectedDestId(resp.destination.id);
      }
    } catch {
      // ignore
    }
  }

  function handleBack() {
    if (step === 0) {
      setShowInfoScreen(true);
    } else {
      setStep(step - 1);
    }
  }

  const canGoBack = !showInfoScreen && step === 0;

  function renderInfoScreen() {
    return (
      <div className="flex flex-col items-center">
        <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-3 font-display">
          How Dazzle works
        </h2>
        <p className="text-base text-muted-foreground mb-10 text-center max-w-md">
          Your AI agent connects to a Stage — a cloud environment it can control.
          The stage streams everything to your chosen platform.
        </p>

        {/* Animated flow diagram */}
        <div className="mb-10">
          <FlowDiagram />
        </div>

        <Button
          onClick={() => setShowInfoScreen(false)}
          className="font-semibold"
        >
          Continue
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  function renderDestinationsStep() {
    return (
      <div className="flex flex-col items-center">
        <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display">
          Stream Destinations
        </h2>
        <p className="text-base text-muted-foreground mb-6 text-center max-w-md">
          Stream destinations are the platforms your stage broadcasts to.
          Connect an account or add a custom RTMP destination.
        </p>

        {/* Existing destinations */}
        {destinations.length > 0 && (
          <div className="w-full max-w-md mb-6">
            <p className="text-sm font-medium text-muted-foreground mb-3">Use an existing destination</p>
            <div className="flex flex-col gap-2">
              {destinations.map((d) => (
                <motion.button
                  key={d.id}
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedDestId(d.id)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                    selectedDestId === d.id
                      ? "border-primary/30 bg-primary/[0.06]"
                      : "border-border bg-card hover:border-border/80"
                  }`}
                >
                  <PlatformIcon platform={d.platform} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-foreground truncate">{d.name || d.platformUsername || d.platform}</p>
                    <p className="text-sm text-muted-foreground">{d.platform}</p>
                  </div>
                  {selectedDestId === d.id && (
                    <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Connect new destination */}
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-3 text-center">
            {destinations.length > 0 ? "Connect a new one" : "Platforms"}
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {OAUTH_PLATFORMS.filter(p => availablePlatforms.includes(p)).map((platform) => {
              const label = PLATFORM_LIST.find((p) => p.value === platform)?.label ?? platform;
              const hoverColor = PLATFORM_HOVER_COLORS[platform] ?? "";
              return (
                <motion.div
                  key={platform}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.quick}
                >
                  <Button
                    variant="outline"
                    onClick={() => handleOAuthConnect(platform)}
                    className={`rounded-xl h-auto px-4 py-3 ${hoverColor}`}
                  >
                    <PlatformIcon platform={platform} size="sm" />
                    <span className="text-sm">{label}</span>
                  </Button>
                </motion.div>
              );
            })}
            <motion.div
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              transition={springs.quick}
            >
              <Button
                variant="outline"
                onClick={() => setShowCustomForm(!showCustomForm)}
                className={`rounded-xl h-auto px-4 py-3 ${PLATFORM_HOVER_COLORS.custom} ${showCustomForm ? "border-primary/30 bg-primary/[0.06]" : ""}`}
              >
                <PlatformIcon platform="custom" size="sm" />
                <span className="text-sm">Custom</span>
              </Button>
            </motion.div>
          </div>
        </div>

        {/* Custom form inline */}
        <AnimatePresence>
          {showCustomForm && (
            <motion.div
              className="w-full max-w-md mb-6"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={springs.snappy}
            >
              <StreamDestinationForm
                compact
                hideSkip
                submitLabel="Add Destination"
                onNext={(data) => {
                  if (data) handleCreateCustomDest(data);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setStep(1)}
            className="font-semibold"
          >
            Skip
          </Button>
          <Button
            disabled={!selectedDestId && destinations.length > 0}
            onClick={() => setStep(1)}
            className="font-semibold disabled:opacity-30"
          >
            Continue
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  function renderSetupStageStep() {
    return (
      <EndpointCreator
        onCreated={async (st, _apiKey) => {
          // Link destination if selected (best-effort, don't block navigation)
          if (selectedDestId && st.id) {
            stageClient.setStageDestination({ stageId: st.id, destinationId: selectedDestId }).catch(() => {});
          }
        }}
        onNavigate={(stageId) => {
          reset();
          onClose();
          navigate(`/stage/${stageId}`);
        }}
      />
    );
  }

  function renderStep() {
    switch (step) {
      case 0:
        return renderDestinationsStep();
      case 1:
        return renderSetupStageStep();
      default:
        return null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Back button + Step indicator */}
        {!showInfoScreen && (
          <div className="mb-2 flex justify-center relative">
            {canGoBack && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleBack}
                className="absolute left-0 top-0 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            )}
            <StepIndicator steps={WIZARD_STEPS} current={step} />
          </div>
        )}

        {/* Content with AnimatePresence for smooth step transitions */}
        <AnimatePresence mode="wait">
          <motion.div
            key={showInfoScreen ? "info" : `step-${step}`}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={springs.gentle}
          >
            {showInfoScreen ? renderInfoScreen() : renderStep()}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
