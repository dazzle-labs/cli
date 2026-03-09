import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Radio, X, Loader2, ArrowRight } from "lucide-react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export function Dashboard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);

  const [creatingStage, setCreatingStage] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Streaming banner
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem("dazzle-stream-banner-dismissed") === "true"
  );

  async function refresh() {
    try {
      const [stageResp, streamResp] = await Promise.all([
        stageClient.listStages({}),
        streamClient.listStreamDestinations({}),
      ]);
      setStages(stageResp.stages);
      setDestinations(streamResp.destinations);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function dismissBanner() {
    setBannerDismissed(true);
    localStorage.setItem("dazzle-stream-banner-dismissed", "true");
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading stages...
      </div>
    );
  }

  async function handleCreateStage() {
    setCreatingStage(true);
    try {
      await stageClient.createStage({ name: "" });
      await refresh();
    } catch {
      // ignore
    } finally {
      setCreatingStage(false);
    }
  }

  const activeStageCount = stages.filter((s) => s.status !== "inactive").length;
  const hasStreamDests = destinations.length > 0;
  const showStreamBanner = activeStageCount > 0 && !hasStreamDests && !bannerDismissed;

  return (
    <div>
      {/* Streaming banner */}
      {showStreamBanner && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-3">
          <div className="flex items-center gap-3">
            <Radio className="h-4 w-4 text-emerald-400" />
            <span className="text-sm text-zinc-300">
              Your agent has a stage. Ready to open the curtains?
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/destinations">
              <Button
                size="sm"
                className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-xs"
              >
                Set up streaming
              </Button>
            </Link>
            <button
              onClick={dismissBanner}
              className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl tracking-[-0.02em] text-white mb-1"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Stages
          </h1>
          <p className="text-sm text-zinc-500">
            Cloud environments your agents can control and broadcast from.
          </p>
        </div>
        {stages.length > 0 && (
          <Button
            onClick={handleCreateStage}
            disabled={creatingStage}
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10"
          >
            {creatingStage ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            New stage
          </Button>
        )}
      </div>

      {/* Onboarding wizard overlay */}
      <OnboardingWizard
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          refresh();
        }}
      />

      {/* Stages grid */}
      {stages.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 text-sm mb-4">No stages yet. Create one to get started.</p>
          <Button
            onClick={() => setWizardOpen(true)}
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          >
            Get Started
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stages.map((stage) => (
            <Link
              key={stage.id}
              to={`/stage/${stage.id}`}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-200 hover:border-emerald-500/15 hover:bg-emerald-500/[0.02]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-zinc-300">{stage.name || "default"}</span>
                <Badge variant={stage.status === "running" ? "success" : stage.status === "starting" ? "warning" : "default"}>
                  {stage.status === "running" ? "active" : stage.status || "inactive"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600">
                  {stage.createdAt ? timestampDate(stage.createdAt).toLocaleDateString() : ""}
                </span>
                <span className="flex items-center gap-1 text-xs text-zinc-600 group-hover:text-emerald-400 transition-colors">
                  View details
                  <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
