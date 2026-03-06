import { useEffect, useRef, useState } from "react";
import { stageClient, apiKeyClient } from "../../client.js";
import type { Stage } from "../../gen/api/v1/stage_pb.js";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";

interface EndpointCreatorProps {
  onCreated: (stage: Stage, apiKey: string | null) => void;
  verbose?: boolean;
  /** Skip API key creation (experienced users already have one) */
  skipApiKey?: boolean;
}

export function EndpointCreator({ onCreated, verbose, skipApiKey }: EndpointCreatorProps) {
  const [status, setStatus] = useState<"creating" | "ready" | "error">("creating");
  const [stage, setStage] = useState<Stage | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current && attempt === 0) return;
    started.current = true;

    async function create() {
      try {
        // Check if user already has API keys — only create one on first onboarding
        let shouldCreateKey = !skipApiKey;
        if (shouldCreateKey) {
          try {
            const existing = await apiKeyClient.listApiKeys({});
            if (existing.keys.length > 0) shouldCreateKey = false;
          } catch {
            // If check fails, skip key creation to be safe
            shouldCreateKey = false;
          }
        }

        const stageResp = await stageClient.createStage({ name: "" });
        const keyResp = shouldCreateKey
          ? await apiKeyClient.createApiKey({ name: `onboarding-${Date.now()}` })
          : null;

        const st = stageResp.stage!;
        const secret = keyResp?.secret ?? null;
        setStage(st);
        setApiKey(secret);
        setStatus("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create stage");
        setStatus("error");
      }
    }

    create();
  }, [attempt]);

  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        {verbose ? "Set up your stage" : "Setting up your stage"}
      </h2>
      {verbose && (
        <p className="text-sm text-zinc-500 mb-6 max-w-md text-center">
          A stage is a persistent environment your agent can drive.
          We're setting one up for you now.
        </p>
      )}

      <div className="w-full max-w-md mt-4">
        {status === "creating" && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-zinc-400">
              Creating stage...
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <Button
              onClick={() => {
                setStatus("creating");
                setError(null);
                setAttempt((a) => a + 1);
              }}
              variant="ghost"
              size="sm"
              className="text-zinc-400 hover:text-white"
            >
              Try again
            </Button>
          </div>
        )}

        {status === "ready" && stage && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-6 flex flex-col gap-3">
            <p className="text-sm font-medium text-emerald-400">Stage ready</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Stage ID</span>
                <code className="font-mono text-zinc-300 bg-white/[0.04] px-2 py-0.5 rounded">
                  {stage.id.slice(0, 12)}
                </code>
              </div>
            </div>
            <Button
              onClick={() => onCreated(stage, apiKey)}
              className="mt-2 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold w-full"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
