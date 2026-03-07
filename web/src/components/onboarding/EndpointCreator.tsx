import { useRef, useState } from "react";
import { stageClient } from "../../client.js";
import type { Stage } from "../../gen/api/v1/stage_pb.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2 } from "lucide-react";

interface EndpointCreatorProps {
  onCreated: (stage: Stage, apiKey: string | null) => void;
  onNavigate: (stageId: string) => void;
}

export function EndpointCreator({ onCreated, onNavigate }: EndpointCreatorProps) {
  const [stageName, setStageName] = useState("");
  const [status, setStatus] = useState<"input" | "creating" | "error">("input");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function handleCreate() {
    if (started.current) return;
    started.current = true;
    setStatus("creating");

    try {
      const name = stageName.trim() || "default";
      const stageResp = await stageClient.createStage({ name });
      const st = stageResp.stage!;
      onCreated(st, null);
      onNavigate(st.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create stage");
      setStatus("error");
      started.current = false;
    }
  }

  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Set up your stage
      </h2>
      <p className="text-sm text-zinc-500 mb-6 max-w-md text-center">
        A cloud browser your agent can control.
      </p>

      <div className="w-full max-w-md flex flex-col gap-4">
        {status === "input" && (
          <>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
                Stage name
              </label>
              <Input
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                placeholder="e.g. My Stream, Demo Bot"
              />
            </div>

            <div className="flex justify-center">
              <Button
                onClick={handleCreate}
                className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
              >
                Create Stage
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {status === "creating" && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-zinc-400">Creating stage...</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-center">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <Button
              onClick={() => {
                setStatus("input");
                setError(null);
                started.current = false;
              }}
              variant="ghost"
              size="sm"
              className="text-zinc-400 hover:text-white"
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
