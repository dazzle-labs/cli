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
}

export function StreamDestinationForm({
  onNext,
  verbose,
  initial,
  submitLabel = "Continue",
  hideSkip,
  compact,
  streamKeyOptional,
}: StreamDestinationFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rtmpUrl, setRtmpUrl] = useState(initial?.rtmpUrl ?? "");
  const [streamKey, setStreamKey] = useState(initial?.streamKey ?? "");
  const [showHelp, setShowHelp] = useState(!!verbose);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext({ name, platform: "custom", rtmpUrl, streamKey });
  }

  return (
    <div className={compact ? "flex flex-col" : "flex flex-col items-center"}>
      {!compact && (
        <>
          <h2
            className="text-2xl tracking-[-0.02em] text-white mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Custom destination
          </h2>
          <div className="flex items-center gap-1.5 mb-6">
            <p className="text-sm text-zinc-500 text-center">
              {verbose
                ? "Enter your custom RTMP destination details. You can skip this for now."
                : "Enter your custom RTMP destination details."}
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
                Your streaming platform gives you an RTMP URL and a stream key.
                Dazzle uses these to send your stage's screen to that platform in real time.
              </p>
            </div>
          )}
        </>
      )}

      <form onSubmit={handleSubmit} className={compact ? "w-full" : "w-full max-w-md mt-4"}>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col gap-5">
          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My RTMP destination"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
              RTMP URL
            </label>
            <Input
              type="password"
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
