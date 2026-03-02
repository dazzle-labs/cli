import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sessionClient, userClient, streamClient } from "../client.js";
import type { Session } from "../gen/api/v1/session_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import type { GetProfileResponse } from "../gen/api/v1/user_pb.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Overlay } from "@/components/ui/overlay";
import { Plus, Trash2, Cpu, Globe, Sparkles, ArrowRight, Radio, Pencil, ToggleLeft, ToggleRight, X } from "lucide-react";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm";

export function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [profile, setProfile] = useState<GetProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingStream, setEditingStream] = useState<{ sessionId: string; dest?: StreamDestination } | null>(null);

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

  async function handleDelete(id: string) {
    try {
      await sessionClient.deleteSession({ id });
    } catch {
      // ignore — pod may already be gone
    }
    await refresh();
  }

  async function handleToggleStream(dest: StreamDestination) {
    await streamClient.updateStreamDestination({
      id: dest.id,
      name: dest.name,
      platform: dest.platform,
      rtmpUrl: dest.rtmpUrl,
      streamKey: dest.streamKey,
      enabled: !dest.enabled,
    });
    await refresh();
  }

  async function handleStreamSave(data: StreamDestinationData) {
    if (!editingStream) return;
    if (editingStream.dest) {
      await streamClient.updateStreamDestination({
        id: editingStream.dest.id,
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
        enabled: editingStream.dest.enabled,
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
    setEditingStream(null);
    await refresh();
  }

  function getDestForSession(index: number): StreamDestination | undefined {
    if (destinations.length === 0) return undefined;
    return destinations[index % destinations.length];
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading endpoints...
      </div>
    );
  }

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

      {/* Endpoints grid */}
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
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
          {sessions.map((s, i) => {
            const dest = getDestForSession(i);
            return (
              <div
                key={s.id}
                className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-300 hover:border-emerald-500/15 hover:bg-emerald-500/[0.02]"
              >
                {/* Top row: ID + status */}
                <div className="flex items-center justify-between mb-4">
                  <code className="text-sm font-mono text-zinc-300 bg-white/[0.04] px-2 py-0.5 rounded">
                    {s.id.slice(0, 8)}
                  </code>
                  <Badge variant={s.status === "running" ? "success" : "warning"}>
                    {s.status}
                  </Badge>
                </div>

                {/* Details */}
                <div className="flex flex-col gap-2 mb-4">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Cpu className="h-3.5 w-3.5" />
                    <span className="font-mono">{s.podName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Globe className="h-3.5 w-3.5" />
                    <span>Port {s.directPort}</span>
                  </div>
                </div>

                {/* Stream destination section */}
                <div className="border-t border-white/[0.04] pt-3 mb-3">
                  {dest ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Radio className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                        <span className="text-xs font-mono text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded">
                          {dest.platform}
                        </span>
                        <span className="text-xs text-zinc-500 truncate">
                          {dest.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleToggleStream(dest)}
                          className={`flex items-center gap-1 text-xs font-medium transition-colors cursor-pointer ${
                            dest.enabled ? "text-emerald-400" : "text-zinc-600"
                          }`}
                        >
                          {dest.enabled ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => setEditingStream({ sessionId: s.id, dest })}
                          className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingStream({ sessionId: s.id })}
                      className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
                    >
                      <Radio className="h-3.5 w-3.5" />
                      Add stream destination
                    </button>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-white/[0.04]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => handleDelete(s.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stream destination edit overlay */}
      <Overlay open={!!editingStream} onClose={() => setEditingStream(null)}>
        <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.06] bg-zinc-900 p-8">
          <button
            onClick={() => setEditingStream(null)}
            className="absolute top-4 right-4 text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
          <StreamDestinationForm
            initial={
              editingStream?.dest
                ? {
                    name: editingStream.dest.name,
                    platform: editingStream.dest.platform,
                    rtmpUrl: editingStream.dest.rtmpUrl,
                    streamKey: editingStream.dest.streamKey,
                  }
                : undefined
            }
            onNext={(data) => {
              if (data) handleStreamSave(data);
              else setEditingStream(null);
            }}
            submitLabel={editingStream?.dest ? "Save" : "Create"}
            hideSkip={!!editingStream?.dest}
          />
        </div>
      </Overlay>
    </div>
  );
}
