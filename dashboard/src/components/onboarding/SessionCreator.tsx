import { useEffect, useRef, useState } from "react";
import { sessionClient, apiKeyClient } from "../../client.js";
import type { Session } from "../../gen/api/v1/session_pb.js";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";

interface SessionCreatorProps {
  onCreated: (session: Session, apiKey: string | null) => void;
  verbose?: boolean;
  /** Skip API key creation (experienced users already have one) */
  skipApiKey?: boolean;
}

export function SessionCreator({ onCreated, verbose, skipApiKey }: SessionCreatorProps) {
  const [status, setStatus] = useState<"creating" | "polling" | "ready" | "error">("creating");
  const [session, setSession] = useState<Session | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function create() {
      try {
        const promises: [Promise<any>, Promise<any> | null] = [
          sessionClient.createSession({}),
          skipApiKey ? null : apiKeyClient.createApiKey({ name: `onboarding-${Date.now()}` }),
        ];

        const [sessResp, keyResp] = await Promise.all(
          promises.filter(Boolean) as Promise<any>[]
        );

        const sess = sessResp.session!;
        const secret = keyResp?.secret ?? null;
        setApiKey(secret);

        if (sess.status === "running") {
          setSession(sess);
          setStatus("ready");
          return;
        }

        setStatus("polling");
        let attempts = 0;
        const maxAttempts = 30;

        const poll = async () => {
          attempts++;
          try {
            const resp = await sessionClient.getSession({ id: sess.id });
            const updated = resp.session!;
            if (updated.status === "running") {
              setSession(updated);
              setStatus("ready");
              return;
            }
          } catch {
            // ignore polling errors
          }

          if (attempts >= maxAttempts) {
            setSession(sess);
            setStatus("ready");
            return;
          }

          setTimeout(poll, 2000);
        };

        setTimeout(poll, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create endpoint");
        setStatus("error");
      }
    }

    create();
  }, []);

  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        {verbose ? "Create an endpoint" : "Setting up your endpoint"}
      </h2>
      {verbose && (
        <p className="text-sm text-zinc-500 mb-6 max-w-md text-center">
          An endpoint is a production environment your agent can drive.
          We're spinning one up for you now.
        </p>
      )}

      <div className="w-full max-w-md mt-4">
        {(status === "creating" || status === "polling") && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-zinc-400">
              {status === "creating"
                ? skipApiKey ? "Creating endpoint..." : "Creating endpoint and API key..."
                : "Waiting for endpoint to start..."}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {status === "ready" && session && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-6 flex flex-col gap-3">
            <p className="text-sm font-medium text-emerald-400">Endpoint ready</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Endpoint ID</span>
                <code className="font-mono text-zinc-300 bg-white/[0.04] px-2 py-0.5 rounded">
                  {session.id.slice(0, 12)}
                </code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Status</span>
                <span className="text-emerald-400">{session.status}</span>
              </div>
            </div>
            <Button
              onClick={() => onCreated(session, apiKey)}
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
