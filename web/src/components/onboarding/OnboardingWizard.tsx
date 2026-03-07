import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/react";
import { X, ArrowLeft, ArrowRight, Monitor, Tv, Cpu } from "lucide-react";
import { Overlay } from "@/components/ui/overlay";
import { StepIndicator } from "./StepIndicator";
import { EndpointCreator } from "./EndpointCreator";
import { StreamDestinationForm } from "./StreamDestinationForm";
import type { StreamDestinationData } from "./StreamDestinationForm";
import type { StreamDestination } from "../../gen/api/v1/stream_pb.js";
import { stageClient, streamClient } from "../../client.js";
import { Button } from "@/components/ui/button";
import { PlatformIcon, PLATFORM_LIST } from "@/components/PlatformIcon";

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  skipIntro?: boolean;
}

const WIZARD_STEPS = ["Set up platform", "Set up stage"];

const OAUTH_PLATFORMS = ["twitch", "youtube", "kick"] as const;

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
        <h2
          className="text-2xl tracking-[-0.02em] text-white mb-3"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          How Dazzle works
        </h2>
        <p className="text-sm text-zinc-500 mb-10 text-center max-w-md">
          Your AI agent connects to a Stage — a cloud environment it can control.
          The stage streams everything to your chosen platform.
        </p>

        {/* Data flow diagram */}
        <div className="flex items-start gap-4 sm:gap-6 mb-10 flex-wrap justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Monitor className="h-7 w-7 text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-zinc-300">Agent</p>
              <p className="text-[10px] text-zinc-600">Claude, OpenAI,</p>
              <p className="text-[10px] text-zinc-600">any AI agent</p>
            </div>
          </div>

          <div className="flex items-center mt-[26px]">
            <div className="w-8 sm:w-12 h-px bg-gradient-to-r from-blue-500/40 to-emerald-500/40" />
            <ArrowRight className="h-3 w-3 text-zinc-600 -ml-1" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Cpu className="h-7 w-7 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-zinc-300">Stage</p>
              <p className="text-[10px] text-zinc-600">Cloud environment</p>
            </div>
          </div>

          <div className="flex items-center mt-[26px]">
            <div className="w-8 sm:w-12 h-px bg-gradient-to-r from-emerald-500/40 to-purple-500/40" />
            <ArrowRight className="h-3 w-3 text-zinc-600 -ml-1" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="h-16 w-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Tv className="h-7 w-7 text-purple-400" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-zinc-300">Platform</p>
              <p className="text-[10px] text-zinc-600">Twitch, YouTube</p>
            </div>
          </div>
        </div>

        <Button
          onClick={() => setShowInfoScreen(false)}
          className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
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
        <h2
          className="text-2xl tracking-[-0.02em] text-white mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Stream Destinations
        </h2>
        <p className="text-sm text-zinc-500 mb-6 text-center max-w-md">
          Stream destinations are the platforms your stage broadcasts to.
          Connect an account or add a custom RTMP destination.
        </p>

        {/* Existing destinations */}
        {destinations.length > 0 && (
          <div className="w-full max-w-md mb-6">
            <p className="text-xs font-medium text-zinc-400 mb-3">Select a destination</p>
            <div className="flex flex-col gap-2">
              {destinations.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedDestId(d.id)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                    selectedDestId === d.id
                      ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
                  }`}
                >
                  <PlatformIcon platform={d.platform} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-300 truncate">{d.name || d.platformUsername || d.platform}</p>
                    <p className="text-xs text-zinc-600">{d.platform}</p>
                  </div>
                  {selectedDestId === d.id && (
                    <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Connect new destination */}
        <div className="mb-6">
          <p className="text-xs font-medium text-zinc-400 mb-3 text-center">
            {destinations.length > 0 ? "Connect a new one" : "Platforms"}
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {OAUTH_PLATFORMS.filter(p => availablePlatforms.includes(p)).map((platform) => {
              const label = PLATFORM_LIST.find((p) => p.value === platform)?.label ?? platform;
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => handleOAuthConnect(platform)}
                  className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-all hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
                >
                  <PlatformIcon platform={platform} size="sm" />
                  <span className="text-xs text-zinc-300">{label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowCustomForm(true)}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-all hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
            >
              <PlatformIcon platform="custom" size="sm" />
              <span className="text-xs text-zinc-300">Custom</span>
            </button>
          </div>
        </div>

        {/* Custom form inline */}
        {showCustomForm && (
          <div className="w-full max-w-md mb-6">
            <StreamDestinationForm
              compact
              hideSkip
              submitLabel="Add Destination"
              onNext={(data) => {
                if (data) handleCreateCustomDest(data);
              }}
            />
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button
            onClick={() => setStep(1)}
            className="bg-zinc-700 text-zinc-200 hover:bg-zinc-600 font-semibold"
          >
            Skip
          </Button>
          <Button
            disabled={!selectedDestId && destinations.length > 0}
            onClick={() => setStep(1)}
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold disabled:opacity-30"
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
        {!showInfoScreen && (
          <div className="mb-8 flex justify-center">
            {canGoBack && (
              <button
                onClick={handleBack}
                className="absolute left-6 top-7 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            <StepIndicator steps={WIZARD_STEPS} current={step} />
          </div>
        )}

        {/* Content */}
        <div className="transition-all duration-300">
          {showInfoScreen ? renderInfoScreen() : renderStep()}
        </div>
      </div>
    </Overlay>
  );
}
