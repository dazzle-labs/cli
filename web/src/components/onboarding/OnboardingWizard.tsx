import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useGetToken } from "../../useDevToken.js";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
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

const WIZARD_STEPS = ["Where to stream", "Create a stage"];

const OAUTH_PLATFORMS = ["twitch", "youtube", "kick", "restream"] as const;

const stepVariants = {
  enter: { opacity: 0, y: 16 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function OnboardingWizard({ open, onClose, skipIntro }: OnboardingWizardProps) {
  const getToken = useGetToken();
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
      setShowInfoScreen(!skipIntro);
      setStep(0);
      setSelectedDestId(null);
      setShowCustomForm(false);
      refreshDestinations();
    }
  }, [open]);

  async function refreshDestinations() {
    try {
      const resp = await streamClient.listStreamDestinations({});
      setDestinations(resp.destinations);
      setAvailablePlatforms(resp.availablePlatforms);
      // Auto-select the most recently connected destination when returning from OAuth
      if (skipIntro && resp.destinations.length > 0 && !selectedDestId) {
        setSelectedDestId(resp.destinations[resp.destinations.length - 1].id);
      }
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

  const canGoBack = !showInfoScreen;

  function renderInfoScreen() {
    return (
      <div className="flex flex-col items-center">
        <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 sm:mb-3 font-display text-center">
          How Dazzle works
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-10 text-center max-w-md">
          Your AI agent connects to a Stage — a cloud environment it can control.
          The stage streams everything to your chosen platform.
        </p>

        {/* Animated flow diagram */}
        <div className="mb-6 sm:mb-10">
          <FlowDiagram />
        </div>

        <Button
          onClick={() => setShowInfoScreen(false)}
          className="font-semibold w-full sm:w-auto"
        >
          Continue
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  function renderDestinationsStep() {
    const hasDestinations = destinations.length > 0;

    if (hasDestinations) {
      return (
        <div className="flex flex-col items-center">
          <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display text-center">
            Where do you want to stream?
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground mb-5 sm:mb-6 text-center max-w-md">
            Pick a connected platform, or add a new one.
          </p>

          {/* Compact add-platform row */}
          <div className="flex items-center gap-1.5 mb-4">
            <Plus className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
            {OAUTH_PLATFORMS.filter(p => availablePlatforms.includes(p)).map((platform) => {
              const label = PLATFORM_LIST.find((p) => p.value === platform)?.label ?? platform;
              return (
                <Tooltip key={platform} delayDuration={500}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleOAuthConnect(platform)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <PlatformIcon platform={platform} size="sm" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Connect {label}</TooltipContent>
                </Tooltip>
              );
            })}
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowCustomForm(!showCustomForm)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <PlatformIcon platform="custom" size="sm" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add custom RTMP</TooltipContent>
            </Tooltip>
          </div>

          {/* Custom form inline */}
          <AnimatePresence>
            {showCustomForm && (
              <motion.div
                className="w-full max-w-md mb-4 overflow-hidden"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <StreamDestinationForm
                  compact
                  hideSkip
                  submitLabel="Add"
                  onNext={(data) => {
                    if (data) handleCreateCustomDest(data);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Destinations list */}
          <div className="w-full max-w-md mb-6 max-h-64 overflow-y-auto">
            <div className="flex flex-col gap-2">
              {destinations.map((d) => (
                <motion.button
                  key={d.id}
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedDestId(d.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer",
                    selectedDestId === d.id
                      ? "border-primary/30 bg-primary/[0.06]"
                      : "border-border bg-card hover:border-border/80"
                  )}
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

          {/* Footer actions */}
          <div className="flex flex-col items-center gap-2 w-full">
            <Button
              disabled={!selectedDestId}
              onClick={() => setStep(1)}
              className="font-semibold disabled:opacity-30 w-full sm:w-auto"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              Skip for now
            </button>
          </div>
        </div>
      );
    }

    // No destinations — full discovery layout
    return (
      <div className="flex flex-col items-center">
        <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display text-center">
          Where do you want to stream?
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground mb-5 sm:mb-6 text-center max-w-md">
          Connect a platform to get started.
        </p>

        {/* Platform OAuth buttons */}
        <div className="w-full max-w-md mb-5 sm:mb-6">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 sm:justify-center">
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
                    className={cn("rounded-xl h-auto px-4 py-3 w-full sm:w-auto", hoverColor)}
                  >
                    <PlatformIcon platform={platform} size="sm" />
                    <span className="text-sm">{label}</span>
                  </Button>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* "or" divider */}
        <div className="w-full max-w-md mb-5 sm:mb-6 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        {/* Custom RTMP button */}
        <div className="w-full max-w-md mb-5 sm:mb-6">
          <motion.div
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            transition={springs.quick}
          >
            <Button
              variant="outline"
              onClick={() => setShowCustomForm(!showCustomForm)}
              className={cn("rounded-xl h-auto px-4 py-3 w-full sm:w-auto", PLATFORM_HOVER_COLORS.custom, showCustomForm && "border-primary/30 bg-primary/[0.06]")}
            >
              <PlatformIcon platform="custom" size="sm" />
              <span className="text-sm">Custom RTMP</span>
            </Button>
          </motion.div>
        </div>

        {/* Custom form inline */}
        <AnimatePresence>
          {showCustomForm && (
            <motion.div
              className="w-full max-w-md mb-5 sm:mb-6 overflow-hidden"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
              <StreamDestinationForm
                compact
                hideSkip
                submitLabel="Add"
                onNext={(data) => {
                  if (data) handleCreateCustomDest(data);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer actions */}
        <div className="mt-2 sm:mt-6 flex flex-col items-center gap-2 w-full">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            Skip for now
          </button>
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
      <DialogContent mobileSheet className="sm:max-w-2xl sm:max-h-[90vh] sm:overflow-y-auto">
        {/* Back button + Step indicator */}
        {!showInfoScreen && (
          <div className="mb-1 sm:mb-2 flex justify-center relative">
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
            <StepIndicator steps={WIZARD_STEPS} current={step} onStepClick={setStep} />
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
