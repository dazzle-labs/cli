import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, HelpCircle } from "lucide-react";

export interface StreamDestinationData {
  name: string;
  platform: string;
  rtmpUrl: string;
  streamKey: string;
}

interface StreamDestinationFormProps {
  onNext: (dest: StreamDestinationData | null) => void;
  verbose?: boolean;
  initial?: StreamDestinationData;
  submitLabel?: string;
  hideSkip?: boolean;
  compact?: boolean;
  streamKeyOptional?: boolean;
  lockedPlatform?: string;
}

const platforms = [
  { value: "custom", label: "Custom" },
  { value: "twitch", label: "Twitch" },
  { value: "youtube", label: "YouTube" },
  { value: "kick", label: "Kick" },
  { value: "restream", label: "Restream" },
];

const platformRtmpDefaults: Record<string, string> = {
  twitch: "rtmp://live.twitch.tv/app",
  youtube: "rtmp://a.rtmp.youtube.com/live2",
  kick: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app",
  restream: "rtmp://live.restream.io/live",
  custom: "",
};

const platformNamePlaceholders: Record<string, string> = {
  twitch: "e.g. My Twitch stream",
  youtube: "e.g. My YouTube stream",
  kick: "e.g. My Kick stream",
  restream: "e.g. My Restream channel",
  custom: "e.g. My RTMP destination",
};

const platformStreamKeyHelp: Record<string, string> = {
  twitch: "Find your stream key at dashboard.twitch.tv/settings/stream. Click 'Copy' next to Primary Stream Key.",
  youtube: "Go to studio.youtube.com, click 'Go live', then copy the stream key from the Stream Settings panel.",
  kick: "Go to kick.com/dashboard/settings/stream, and copy the stream key shown there.",
  restream: "Log into restream.io, go to Streaming Setup, and copy the stream key for your RTMP URL.",
  custom: "Check your streaming platform's dashboard for the RTMP URL and stream key.",
};

export function StreamDestinationForm({
  onNext,
  verbose,
  initial,
  submitLabel = "Continue",
  hideSkip,
  compact,
  streamKeyOptional,
  lockedPlatform,
}: StreamDestinationFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [platform, setPlatform] = useState(lockedPlatform ?? initial?.platform ?? "custom");
  const [rtmpUrl, setRtmpUrl] = useState(initial?.rtmpUrl || platformRtmpDefaults[lockedPlatform ?? initial?.platform ?? "custom"] || "");
  const [streamKey, setStreamKey] = useState(initial?.streamKey ?? "");
  const [showHelp, setShowHelp] = useState(!!verbose);

  function handlePlatformChange(value: string) {
    setPlatform(value);
    if (!rtmpUrl || Object.values(platformRtmpDefaults).includes(rtmpUrl)) {
      setRtmpUrl(platformRtmpDefaults[value] ?? "");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext({ name, platform, rtmpUrl, streamKey });
  }

  return (
    <div className={compact ? "flex flex-col" : "flex flex-col items-center"}>
      {!compact && (
        <>
          <h2
            className="text-2xl tracking-[-0.02em] text-white mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Stream destination
          </h2>
          <div className="flex items-center gap-1.5 mb-6">
            <p className="text-sm text-zinc-500 text-center">
              {verbose
                ? "Where should your stage stream to? You can skip this for now."
                : "Configure where your stage streams to."}
            </p>
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer shrink-0"
              title="What is RTMP?"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
          {showHelp && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-4 max-w-md">
              <p className="text-xs text-zinc-400 leading-relaxed">
                <span className="font-medium text-zinc-300">RTMP</span> is the standard protocol for live streaming.
                Your streaming platform (Twitch, YouTube, etc.) gives you an RTMP URL and a stream key.
                Dazzle uses these to send your stage's screen to that platform in real time — so viewers can watch
                your agent work live.
              </p>
            </div>
          )}
        </>
      )}

      <form onSubmit={handleSubmit} className={compact ? "w-full" : "w-full max-w-md mt-4"}>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col gap-5">
          <div className={lockedPlatform ? "" : "grid grid-cols-2 gap-4"}>
            {!lockedPlatform && (
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
                  Platform
                </label>
                <select
                  className="flex h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-colors"
                  value={platform}
                  onChange={(e) => handlePlatformChange(e.target.value)}
                >
                  {platforms.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
                Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={platformNamePlaceholders[platform] ?? "e.g. My stream"}
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
              RTMP URL
            </label>
            <Input
              type={platform === "custom" ? "password" : "text"}
              value={rtmpUrl}
              onChange={(e) => setRtmpUrl(e.target.value)}
              placeholder="rtmp://..."
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
              Stream key
            </label>
            <Input
              type="password"
              value={streamKey}
              onChange={(e) => setStreamKey(e.target.value)}
              placeholder={streamKeyOptional ? "Leave blank to keep current key" : "Your stream key"}
              required={!streamKeyOptional}
            />
            {(verbose || showHelp) && platformStreamKeyHelp[platform] && (
              <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed">
                {platformStreamKeyHelp[platform]}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="mt-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold w-full"
          >
            {submitLabel}
            {!compact && <ArrowRight className="h-4 w-4 ml-1" />}
          </Button>
        </div>

        {!hideSkip && !compact && (
          <button
            type="button"
            onClick={() => onNext(null)}
            className="mt-4 w-full text-center text-sm text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
          >
            Skip &mdash; I'll set this up later
          </button>
        )}
      </form>
    </div>
  );
}
