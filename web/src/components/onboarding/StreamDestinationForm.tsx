import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className={cn("flex flex-col", !compact && "items-center")}>
      {!compact && (
        <>
          <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display">
            Custom destination
          </h2>
          <div className="flex items-center gap-1.5 mb-6">
            <p className="text-sm text-muted-foreground text-center">
              {verbose
                ? "Enter your custom RTMP destination details. You can skip this for now."
                : "Enter your custom RTMP destination details."}
            </p>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="What is RTMP?"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
          {showHelp && (
            <div className="rounded-lg border border-border bg-card p-3 mb-4 max-w-md">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">RTMP</span> is the standard protocol for live streaming.
                Your streaming platform gives you an RTMP URL and a stream key.
                Dazzle uses these to send your stage's screen to that platform in real time.
              </p>
            </div>
          )}
        </>
      )}

      <form onSubmit={handleSubmit} className={cn("w-full", !compact && "max-w-md mt-4")}>
        <div className={cn("flex flex-col gap-5", !compact && "rounded-xl border border-border bg-card p-6")}>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5">
              Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My RTMP destination"
              required
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5">
              RTMP URL
            </Label>
            <Input
              type="password"
              value={rtmpUrl}
              onChange={(e) => setRtmpUrl(e.target.value)}
              placeholder="rtmp://..."
              required
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5">
              Stream key
            </Label>
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
            className="mt-1 font-semibold w-full"
          >
            {submitLabel}
            {!compact && <ArrowRight className="h-4 w-4 ml-1" />}
          </Button>
        </div>

        {!hideSkip && !compact && (
          <Button
            variant="link"
            type="button"
            onClick={() => onNext(null)}
            className="mt-4 w-full text-center text-sm text-muted-foreground"
          >
            Skip &mdash; I'll set this up later
          </Button>
        )}
      </form>
    </div>
  );
}
