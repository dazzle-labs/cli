import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { stageClient, userClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import type { GetProfileResponse } from "../gen/api/v1/user_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Cpu, Globe, Radio, ArrowUpRight, X, ChevronRight, Copy, Check, Loader2 } from "lucide-react";
import { FRAMEWORKS } from "@/components/onboarding/frameworks";
import { StreamPreview } from "@/components/StreamPreview";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export function Dashboard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [profile, setProfile] = useState<GetProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [creatingStage, setCreatingStage] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Panel state
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [activeFramework, setActiveFramework] = useState(FRAMEWORKS[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Streaming banner
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem("dazzle-stream-banner-dismissed") === "true"
  );

  async function refresh() {
    try {
      const [stageResp, profResp, streamResp] = await Promise.all([
        stageClient.listStages({}),
        userClient.getProfile({}),
        streamClient.listStreamDestinations({}),
      ]);
      setStages(stageResp.stages);
      setProfile(profResp);
      setDestinations(streamResp.destinations);
      return { stages: stageResp.stages, ok: true };
    } catch {
      return { stages: [], ok: false };
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    refresh();
  }, []);

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  function openPanel(id: string) {
    setSelectedStageId(id);
    setPanelMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPanelOpen(true));
    });
  }

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setConfirmingDelete(false);
    setTimeout(() => {
      setSelectedStageId(null);
      setPanelMounted(false);
    }, 200);
  }, []);

  useEffect(() => {
    if (!panelMounted) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [panelMounted]);

  useEffect(() => {
    if (!panelMounted) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelMounted, closePanel]);

  async function handleDeleteStage(id: string) {
    try {
      await stageClient.deleteStage({ id });
    } catch {
      // ignore
    }
    await refresh();
  }

  async function handleCopy(text: string, id: string) {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard not available
    }
  }

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
      const resp = await stageClient.createStage({ name: "" });
      await refresh();
      if (resp.stage) {
        openPanel(resp.stage.id);
      }
    } catch {
      // ignore
    } finally {
      setCreatingStage(false);
    }
  }

  const activeStageCount = stages.filter((s) => s.status !== "inactive").length;
  const hasStreamDests = destinations.length > 0;
  const showStreamBanner = activeStageCount > 0 && !hasStreamDests && !bannerDismissed;

  // Panel data
  const selectedStage = stages.find((s) => s.id === selectedStageId);
  const mcpUrl = selectedStageId ? `${window.location.origin}/stage/${selectedStageId}/mcp` : "";
  const activeFw = FRAMEWORKS.find((fw) => fw.id === activeFramework) ?? FRAMEWORKS[0];
  const snippet = selectedStageId ? activeFw.getSnippet(mcpUrl, "") : "";

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
            <Button
              size="sm"
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-xs"
              onClick={() => {
                if (stages.length > 0) openPanel(stages[0].id);
              }}
            >
              Set up streaming
            </Button>
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
          {profile && (
            <p className="text-sm text-zinc-500">
              {stages.length} stage{stages.length !== 1 ? "s" : ""} &middot; {profile.apiKeyCount} API key{profile.apiKeyCount !== 1 ? "s" : ""}
            </p>
          )}
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

      {/* Stages list */}
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
        <div className="flex flex-col gap-2">
          {stages.map((stage) => (
            <button
              type="button"
              key={stage.id}
              onClick={() => openPanel(stage.id)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-emerald-500/15 hover:bg-emerald-500/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <code className="text-sm font-mono text-zinc-300">{stage.id.slice(0, 8)}</code>
                {stage.name && stage.name !== "default" && (
                  <span className="text-xs text-zinc-500">{stage.name}</span>
                )}
                <Badge variant={stage.status === "running" ? "success" : stage.status === "starting" ? "warning" : "default"}>
                  {stage.status === "running" ? "active" : stage.status || "inactive"}
                </Badge>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-600" />
            </button>
          ))}
        </div>
      )}

      {/* Slide-over panel */}
      {panelMounted && selectedStage && createPortal(
        <div
          className={`fixed inset-0 z-50 transition-all duration-200 ${panelOpen ? "backdrop-blur-sm bg-zinc-950/80" : "bg-zinc-950/0"}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePanel();
          }}
        >
          <div className={`fixed right-0 top-0 h-full w-[480px] max-w-full bg-zinc-900 border-l border-white/[0.06] overflow-y-auto p-6 z-50 transition-transform duration-200 ease-out ${panelOpen ? "translate-x-0" : "translate-x-full"}`}>
            {/* Close button */}
            <button
              onClick={closePanel}
              className="absolute top-4 right-4 text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Section 1: Header */}
            <div className="flex items-center gap-3 pr-8">
              <code className="text-sm font-mono text-zinc-300 bg-white/[0.04] px-2 py-0.5 rounded">
                {selectedStage.id}
              </code>
              <Badge variant={selectedStage.status === "running" ? "success" : selectedStage.status === "starting" ? "warning" : "default"}>
                {selectedStage.status === "running" ? "active" : selectedStage.status || "inactive"}
              </Badge>
            </div>

            {/* Section 2: Details */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <div className="flex flex-col gap-2">
                {selectedStage.podName && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Cpu className="h-3.5 w-3.5" />
                    <span className="font-mono">{selectedStage.podName}</span>
                  </div>
                )}
                {selectedStage.directPort > 0 && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Globe className="h-3.5 w-3.5" />
                    <span>Port {selectedStage.directPort}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-600 w-[52px]">Created</span>
                  <span>{selectedStage.createdAt ? timestampDate(selectedStage.createdAt).toLocaleDateString() : "—"}</span>
                </div>
              </div>
            </div>

            {/* Section 3: Stream Preview */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Preview</p>
              <StreamPreview
                stageId={selectedStageId!}
                status={selectedStage.status === "running" ? "running" : selectedStage.status === "starting" ? "starting" : "stopped"}
              />
            </div>

            {/* Section 4: Stream Destination */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Streaming</p>
              {destinations.length > 0 ? (
                <>
                  <select
                    value={selectedStage?.destinationId || ""}
                    onChange={async (e) => {
                      try {
                        await stageClient.setStageDestination({ stageId: selectedStageId!, destinationId: e.target.value });
                        await refresh();
                      } catch {
                        // ignore
                      }
                    }}
                    className="w-full rounded-lg border border-white/[0.06] bg-zinc-950/50 px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mb-3"
                  >
                    <option value="">Select destination...</option>
                    {destinations.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} ({d.platform})</option>
                    ))}
                  </select>
                  <Link
                    to="/destinations"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                  >
                    Manage destinations
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </>
              ) : (
                <Link
                  to="/destinations"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                >
                  No destinations yet. Create one
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
            </div>

            {/* Section 5: Connect */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Connect</p>
              <div className="flex gap-1 mb-3 overflow-x-auto">
                {FRAMEWORKS.map((fw) => (
                  <button
                    key={fw.id}
                    type="button"
                    onClick={() => { setActiveFramework(fw.id); setCopiedId(null); }}
                    className={
                      fw.id === activeFramework
                        ? "bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-md font-medium"
                        : "text-zinc-500 hover:text-zinc-300 text-xs px-2.5 py-1 rounded-md"
                    }
                  >
                    {fw.name}
                  </button>
                ))}
              </div>
              <div className="relative">
                <pre className="font-mono text-sm text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-3 border border-white/[0.06] whitespace-pre-wrap overflow-x-auto">
                  {snippet}
                </pre>
                <button
                  onClick={() => handleCopy(snippet, activeFw.id)}
                  className="absolute top-2 right-2 text-zinc-500 hover:text-emerald-400 p-1.5 rounded-md transition-colors cursor-pointer"
                >
                  {copiedId === activeFw.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Section 6: Danger Zone */}
            <div className="border-t border-red-500/10 pt-4 mt-6">
              {!confirmingDelete ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete stage
                </Button>
              ) : (
                <div>
                  <p className="text-sm text-zinc-400 mb-3">
                    Delete this stage? If active, it will be stopped.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        const id = selectedStageId!;
                        closePanel();
                        handleDeleteStage(id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
