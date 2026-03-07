import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { streamClient } from "../client.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm.js";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm.js";
import { Button } from "@/components/ui/button";
import { Trash2, Radio, Plus } from "lucide-react";
import { PlatformIcon, PLATFORM_LIST } from "@/components/PlatformIcon";
import { Overlay } from "@/components/ui/overlay";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

const OAUTH_PLATFORMS = ["twitch", "youtube", "kick"] as const;

export function StreamConfig() {
  const { getToken } = useAuth();
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSkipIntro, setWizardSkipIntro] = useState(false);

  async function refresh() {
    const resp = await streamClient.listStreamDestinations({});
    setDestinations(resp.destinations);
    setAvailablePlatforms(resp.availablePlatforms);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.includes("?") ? hash.split("?")[1] : "");
    const connected = searchParams.get("connected") || hashParams.get("connected");
    const error = searchParams.get("error") || hashParams.get("error");
    const onboarding = searchParams.get("onboarding") || hashParams.get("onboarding");
    if (connected) {
      setConnectSuccess(connected);
      const cleanUrl = onboarding ? "/destinations?onboarding=true" : "/destinations";
      window.history.replaceState(null, "", cleanUrl);
      setTimeout(() => setConnectSuccess(null), 5000);
    }
    if (error) {
      setConnectError(error);
      window.history.replaceState(null, "", "/destinations");
      setTimeout(() => setConnectError(null), 8000);
    }
    if (onboarding === "true") {
      setWizardSkipIntro(!!connected);
      setWizardOpen(true);
      if (!connected) {
        window.history.replaceState(null, "", "/destinations");
      }
    }
  }, []);

  async function handleCreate(data: StreamDestinationData) {
    try {
      await streamClient.createStreamDestination({
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
      });
      setShowCustomModal(false);
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await streamClient.deleteStreamDestination({ id });
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleOAuthConnect(platform: string) {
    const token = await getToken();
    if (!token) return;
    try {
      const resp = await fetch(`/oauth/${platform}/check`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!resp.ok) {
        const data = await resp.json();
        setConnectError(data.error || "Failed to connect");
        setTimeout(() => setConnectError(null), 8000);
        return;
      }
    } catch {
      // If check endpoint fails, try the flow anyway
    }
    window.location.href = `/oauth/${platform}/authorize?token=${encodeURIComponent(token)}`;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading destinations...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-3xl tracking-[-0.02em] text-white mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Stream Destinations
        </h1>
        <p className="text-sm text-zinc-500">
          The platforms your agents can stream to.
        </p>
      </div>

      {/* Success toast */}
      {connectSuccess && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 mb-6 flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-emerald-300">
            Connected to {connectSuccess.charAt(0).toUpperCase() + connectSuccess.slice(1)}!
          </span>
        </div>
      )}

      {/* Error toast */}
      {connectError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4 mb-6 flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-red-400" />
          <span className="text-sm text-red-300">{connectError}</span>
        </div>
      )}

      {/* Platforms */}
      <div className="mb-8">
        <p className="text-xs font-medium text-zinc-400 mb-3">Platforms</p>
        <div className="flex flex-wrap gap-3">
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
            onClick={() => setShowCustomModal(true)}
            className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-all hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
          >
            <PlatformIcon platform="custom" size="sm" />
            <span className="text-xs text-zinc-300">Custom</span>
          </button>
        </div>
      </div>

      {/* Custom modal */}
      <Overlay open={showCustomModal} onClose={() => setShowCustomModal(false)}>
        <div className="relative w-full max-w-md mx-4 rounded-2xl border border-white/[0.06] bg-zinc-900 p-8">
          <button
            onClick={() => setShowCustomModal(false)}
            className="absolute top-4 right-4 text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <Plus className="h-5 w-5 rotate-45" />
          </button>
          <h2
            className="text-xl tracking-[-0.02em] text-white mb-6"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Custom Destination
          </h2>
          <StreamDestinationForm
            compact
            hideSkip
            submitLabel="Add Destination"
            onNext={(data) => {
              if (data) handleCreate(data);
            }}
          />
        </div>
      </Overlay>

      {/* Onboarding wizard */}
      <OnboardingWizard
        open={wizardOpen}
        skipIntro={wizardSkipIntro}
        onClose={() => {
          setWizardOpen(false);
          setWizardSkipIntro(false);
          refresh();
        }}
      />

      {/* Destinations table */}
      {destinations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-5">
            <Radio className="h-7 w-7 text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-sm mb-1">No stream destinations</p>
          <p className="text-zinc-600 text-xs">Add one above to start streaming.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Account</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Platform</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">RTMP URL</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="py-3 px-4 text-zinc-300">{d.name || d.platformUsername || "\u2014"}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={d.platform} size="sm" />
                        <span className="text-xs text-zinc-400">{d.platform}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <code className="text-xs text-zinc-500 font-mono">{d.rtmpUrl || "\u2014"}</code>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {confirmDeleteId === d.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-zinc-400">Unlinks from stages. Delete?</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:bg-red-500/10"
                            onClick={() => { handleDelete(d.id); setConfirmDeleteId(null); }}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-zinc-500"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => setConfirmDeleteId(d.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {destinations.map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-300 font-medium">{d.name || d.platformUsername || "\u2014"}</span>
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={d.platform} size="sm" />
                    <span className="text-xs text-zinc-500">{d.platform}</span>
                  </div>
                </div>
                <code className="text-xs text-zinc-600 font-mono break-all">{d.rtmpUrl || "\u2014"}</code>
                <div className="mt-3 flex justify-end">
                  {confirmDeleteId === d.id ? (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-500/10" onClick={() => { handleDelete(d.id); setConfirmDeleteId(null); }}>
                        Delete
                      </Button>
                      <Button variant="ghost" size="sm" className="text-zinc-500" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => setConfirmDeleteId(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
