import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { sessionClient, userClient, streamClient } from "../client.js";
import type { Session } from "../gen/api/v1/session_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import type { GetProfileResponse } from "../gen/api/v1/user_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Cpu, Globe, Sparkles, ArrowRight, Radio, ToggleLeft, ToggleRight, X, ChevronRight, Copy, Check } from "lucide-react";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm";
import { FRAMEWORKS } from "@/components/onboarding/frameworks";

export function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [profile, setProfile] = useState<GetProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeFramework, setActiveFramework] = useState(FRAMEWORKS[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  async function refresh() {
    try {
      const [sessResp, profResp, streamResp] = await Promise.all([
        sessionClient.listSessions({}),
        userClient.getProfile({}),
        streamClient.listStreamDestinations({}),
      ]);
      setSessions(sessResp.sessions);
      setProfile(profResp);
      setDestinations(streamResp.destinations);
    } catch {
      // still show the page even if fetch fails
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const closePanel = useCallback(() => {
    setSelectedSessionId(null);
    setConfirmingDelete(false);
  }, []);

  // Close panel if selected session disappears from list
  useEffect(() => {
    if (selectedSessionId && !sessions.find(s => s.id === selectedSessionId)) {
      closePanel();
    }
  }, [sessions, selectedSessionId, closePanel]);

  // Body scroll lock when panel is open
  useEffect(() => {
    if (!selectedSessionId) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [selectedSessionId]);

  // Escape key handler for slide-over
  useEffect(() => {
    if (!selectedSessionId) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectedSessionId, closePanel]);

  async function handleDelete(id: string) {
    try {
      await sessionClient.deleteSession({ id });
    } catch {
      // ignore — pod may already be gone
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
      // ignore network errors
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
      // ignore network errors
    }
  }

  function getDestForSession(index: number): StreamDestination | undefined {
    if (destinations.length === 0) return undefined;
    return destinations[index % destinations.length];
  }

  async function handleCopy(text: string, id: string) {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard not available in insecure contexts
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading endpoints...
      </div>
    );
  }

  // Panel data
  const selectedIndex = sessions.findIndex(s => s.id === selectedSessionId);
  const selected = selectedIndex >= 0 ? sessions[selectedIndex] : null;
  const selectedDest = selectedIndex >= 0 ? getDestForSession(selectedIndex) : undefined;
  const mcpUrl = selectedSessionId ? `${window.location.origin}/mcp/${selectedSessionId}` : "";
  const activeFw = FRAMEWORKS.find(fw => fw.id === activeFramework) ?? FRAMEWORKS[0];
  const snippet = selectedSessionId ? activeFw.getSnippet(mcpUrl, "") : "";

  return (
    <div>
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
              {profile.sessionCount} active &middot; {profile.apiKeyCount} API key{profile.apiKeyCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button
          onClick={() => navigate("/get-started")}
          className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
        >
          <Plus className="h-4 w-4 mr-1" />
          Create
        </Button>
      </div>

      {/* Endpoints list */}
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
            <Sparkles className="h-7 w-7 text-emerald-400" />
          </div>
          <h2
            className="text-xl tracking-[-0.02em] text-white mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Welcome to Dazzle
          </h2>
          <p className="text-zinc-400 text-sm max-w-sm mb-2">
            Get your agent connected in under a minute.
            We'll create an endpoint, generate an API key, and give you the config snippet for your framework.
          </p>
          <p className="text-zinc-600 text-xs mb-8">
            Works with Claude Code, OpenAI Agents SDK, CrewAI, LangGraph, and more.
          </p>
          <Button
            onClick={() => navigate("/get-started")}
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-sm px-6 h-10"
          >
            Get Started
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s, i) => {
            const dest = getDestForSession(i);
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => setSelectedSessionId(s.id)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-emerald-500/15 hover:bg-emerald-500/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <code className="text-sm font-mono text-zinc-300">{s.id.slice(0, 8)}</code>
                  <Badge variant={s.status === "running" ? "success" : "warning"}>
                    {s.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {dest && (
                    <span className="text-xs font-mono text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded">
                      {dest.platform}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-zinc-600" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Slide-over panel */}
      {selectedSessionId && selected && createPortal(
        <div
          className="fixed inset-0 z-50 backdrop-blur-sm bg-zinc-950/80"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePanel();
          }}
        >
          <div className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-zinc-900 border-l border-white/[0.06] overflow-y-auto p-6 z-50">
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
                {selected.id}
              </code>
              <Badge variant={selected.status === "running" ? "success" : "warning"}>
                {selected.status}
              </Badge>
            </div>

            {/* Section 2: Details */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Cpu className="h-3.5 w-3.5" />
                  <span className="font-mono">{selected.podName}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Globe className="h-3.5 w-3.5" />
                  <span>Port {selected.directPort}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-600 w-[52px]">Created</span>
                  <span>{selected.createdAt ? timestampDate(selected.createdAt).toLocaleDateString() : "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-600 w-[52px]">Activity</span>
                  <span>{selected.lastActivity ? timestampDate(selected.lastActivity).toLocaleDateString() : "—"}</span>
                </div>
              </div>
            </div>

            {/* Section 3: Stream Destination */}
            <div className="border-t border-white/[0.06] pt-4 mt-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Stream destination</p>
              {selectedDest && (
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
              )}
              <StreamDestinationForm
                key={selectedSessionId}
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
                {FRAMEWORKS.map(fw => (
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
                    Delete this endpoint? This will terminate the running session.
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
                        const id = selectedSessionId;
                        closePanel();
                        handleDelete(id);
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
