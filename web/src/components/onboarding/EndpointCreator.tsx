import { useRef, useState } from "react";
import { stageClient } from "../../client.js";
import type { Stage } from "../../gen/api/v1/stage_pb.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, AlertTriangle } from "lucide-react";

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
      <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display">
        Set up your stage
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
        A cloud environment your agent can control.
      </p>

      <div className="w-full max-w-md flex flex-col gap-4">
        {status === "input" && (
          <>
            <div>
              <Label htmlFor="stage-name" className="text-xs font-medium text-muted-foreground mb-1.5">
                Stage name
              </Label>
              <Input
                id="stage-name"
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder="e.g. My Stream, Demo Bot"
              />
            </div>

            <div className="flex justify-center">
              <Button
                onClick={handleCreate}
                className="font-semibold"
              >
                Create Stage
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {status === "creating" && (
          <div className="rounded-xl border border-border bg-card p-6 flex flex-col items-center gap-3">
            <Spinner className="text-primary" />
            <p className="text-sm text-muted-foreground">Creating stage...</p>
          </div>
        )}

        {status === "error" && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button
              onClick={() => {
                setStatus("input");
                setError(null);
                started.current = false;
              }}
              variant="ghost"
              size="sm"
              className="mt-2"
            >
              Try again
            </Button>
          </Alert>
        )}
      </div>
    </div>
  );
}
