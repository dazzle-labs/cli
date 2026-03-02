import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { sessionClient, endpointClient, userClient, streamClient } from "../client.js";
import type { Session } from "../gen/api/v1/session_pb.js";
import type { Endpoint } from "../gen/api/v1/endpoint_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import type { GetProfileResponse } from "../gen/api/v1/user_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Cpu, Globe, Radio, ToggleLeft, ToggleRight, X, ChevronRight, Copy, Check, Loader2 } from "lucide-react";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm";
import { FRAMEWORKS } from "@/components/onboarding/frameworks";
import { StreamPreview } from "@/components/StreamPreview";

export function Dashboard() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [profile, setProfile] = useState<GetProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [creatingEndpoint, setCreatingEndpoint] = useState(false);

  // Panel state
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
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
      const [epResp, sessResp, profResp, streamResp] = await Promise.all([
        endpointClient.listEndpoints({}),
        sessionClient.listSessions({}),
        userClient.getProfile({}),
        streamClient.listStreamDestinations({}),
      ]);
      setEndpoints(epResp.endpoints);
      setSessions(sessResp.sessions);
      setProfile(profResp);
      setDestinations(streamResp.destinations);
      return { endpoints: epResp.endpoints, sessions: sessResp.sessions, ok: true };
    } catch {
      return { endpoints: [], sessions: [], ok: false };
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
    setSelectedEndpointId(id);
    setPanelMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPanelOpen(true));
    });
  }

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setConfirmingDelete(false);
    setTimeout(() => {
      setSelectedEndpointId(null);
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

  async function handleDeleteEndpoint(id: string) {
    try {
      await endpointClient.deleteEndpoint({ id });
    } catch {
      // ignore
    }
    await refresh();
  }

  async function handleToggleStream(dest: StreamDestination) {
    try {
      await streamClient.updateStreamDestination({
        id: dest.id,
        name: dest.name,
        platform: dest.platform,
        rtmpUrl: dest.rtmpUrl,
        streamKey: dest.streamKey,
        enabled: !dest.enabled,
      });
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleStreamSave(data: StreamDestinationData, existingDest?: StreamDestination) {
    try {
      if (existingDest) {
        await streamClient.updateStreamDestination({
          id: existingDest.id,
          name: data.name,
          platform: data.platform,
          rtmpUrl: data.rtmpUrl,
          streamKey: data.streamKey,
          enabled: existingDest.enabled,
        });
      } else {
        await streamClient.createStreamDestination({
          name: data.name,
          platform: data.platform,
          rtmpUrl: data.rtmpUrl,
          streamKey: data.streamKey,
          enabled: true,
        });
      }
      await refresh();
    } catch {
      // ignore
    }
  }

  function getSessionForEndpoint(endpointId: string): Session | undefined {
    return sessions.find((s) => s.id === endpointId);
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
        Loading endpoints...
      </div>
    );
  }

  // ─── Dashboard (endpoint-centric) ───────────────────────

  async function handleCreateEndpoint() {
    setCreatingEndpoint(true);
    try {
      const resp = await endpointClient.createEndpoint({ name: "" });
      await refresh();
      if (resp.endpoint) {
        openPanel(resp.endpoint.id);
      }
    } catch {
      // ignore
    } finally {
      setCreatingEndpoint(false);
    }
  }
  const hasActiveSessions = sessions.length > 0;
  const hasStreamDests = destinations.length > 0;
  const showStreamBanner = hasActiveSessions && !hasStreamDests && !bannerDismissed;

  // Panel data
  const selectedEp = endpoints.find((e) => e.id === selectedEndpointId);
  const selectedSession = selectedEndpointId ? getSessionForEndpoint(selectedEndpointId) : undefined;
  const selectedDest = destinations.length > 0 ? destinations[0] : undefined;
  const mcpUrl = selectedEndpointId ? `${window.location.origin}/mcp/${selectedEndpointId}` : "";
  const activeFw = FRAMEWORKS.find((fw) => fw.id === activeFramework) ?? FRAMEWORKS[0];
  const snippet = selectedEndpointId ? activeFw.getSnippet(mcpUrl, "") : "";

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
                if (endpoints.length > 0) openPanel(endpoints[0].id);
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
            Endpoints
          </h1>
          {profile && (
            <p className="text-sm text-zinc-500">
              {sessions.length} active session{sessions.length !== 1 ? "s" : ""} &middot; {profile.apiKeyCount} API key{profile.apiKeyCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        {endpoints.length > 0 && (
          <Button
            onClick={handleCreateEndpoint}
            disabled={creatingEndpoint}
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10"
          >
            {creatingEndpoint ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            New Endpoint
          </Button>
        )}
      </div>

      {/* Endpoints list */}
      {endpoints.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 text-sm mb-4">No endpoints yet. Create one to get started.</p>
          <Button
            onClick={handleCreateEndpoint}
            disabled={creatingEndpoint}
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          >
            {creatingEndpoint ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Create Endpoint
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {endpoints.map((ep) => {
            const sess = getSessionForEndpoint(ep.id);
            return (
              <button
                type="button"
                key={ep.id}
                onClick={() => openPanel(ep.id)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-emerald-500/15 hover:bg-emerald-500/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <code className="text-sm font-mono text-zinc-300">{ep.id.slice(0, 8)}</code>
                  {ep.name && ep.name !== "default" && (
                    <span className="text-xs text-zinc-500">{ep.name}</span>
                  )}
                  {sess ? (
                    <Badge variant={sess.status === "running" ? "success" : "warning"}>
                      {sess.status}
                    </Badge>
                  ) : (
                    <Badge variant="default">idle</Badge>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-600" />
              </button>
            );
          })}
        </div>
      )}

      {/* Slide-over panel */}
      {panelMounted && selectedEp && createPortal(
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
                {selectedEp.id}
              </code>
              {selectedSession ? (
                <Badge variant={selectedSession.status === "running" ? "success" : "warning"}>
                  {selectedSession.status}
                </Badge>
              ) : (
                <Badge variant="default">idle</Badge>
              )}
            </div>

            {/* Section 2: Details */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <div className="flex flex-col gap-2">
                {selectedSession && (
                  <>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Cpu className="h-3.5 w-3.5" />
                      <span className="font-mono">{selectedSession.podName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Globe className="h-3.5 w-3.5" />
                      <span>Port {selectedSession.directPort}</span>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-600 w-[52px]">Created</span>
                  <span>{selectedEp.createdAt ? timestampDate(selectedEp.createdAt).toLocaleDateString() : "—"}</span>
                </div>
              </div>
            </div>

            {/* Section 3: Stream Preview */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Preview</p>
              <StreamPreview
                sessionId={selectedEndpointId!}
                status={selectedSession?.status === "running" ? "running" : selectedSession?.status === "starting" ? "starting" : "stopped"}
              />
            </div>

            {/* Section 4: Stream Destination */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Streaming</p>
              {selectedDest ? (
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Radio className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-xs font-mono text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded">
                      {selectedDest.platform}
                    </span>
                    <span className="text-xs text-zinc-500">{selectedDest.name}</span>
                  </div>
                  <button
                    onClick={() => handleToggleStream(selectedDest)}
                    className={`flex items-center gap-1 text-xs font-medium transition-colors cursor-pointer ${
                      selectedDest.enabled ? "text-emerald-400" : "text-zinc-600"
                    }`}
                  >
                    {selectedDest.enabled ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-zinc-500 mb-3">
                  Open the curtains — set up streaming to go live.
                </p>
              )}
              <StreamDestinationForm
                key={selectedEndpointId}
                compact
                initial={
                  selectedDest
                    ? {
                        name: selectedDest.name,
                        platform: selectedDest.platform,
                        rtmpUrl: selectedDest.rtmpUrl,
                        streamKey: selectedDest.streamKey,
                      }
                    : undefined
                }
                submitLabel={selectedDest ? "Save" : "Create"}
                hideSkip
                onNext={(data) => {
                  if (data) handleStreamSave(data, selectedDest);
                }}
              />
            </div>

            {/* Section 4: Connect */}
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

            {/* Section 5: Danger Zone */}
            <div className="border-t border-red-500/10 pt-4 mt-6">
              {!confirmingDelete ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete endpoint
                </Button>
              ) : (
                <div>
                  <p className="text-sm text-zinc-400 mb-3">
                    Delete this endpoint? Any running session will be terminated.
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
                        const id = selectedEndpointId!;
                        closePanel();
                        handleDeleteEndpoint(id);
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
