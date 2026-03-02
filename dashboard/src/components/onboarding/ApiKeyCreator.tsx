import { useEffect, useRef, useState } from "react";
import { apiKeyClient } from "../../client.js";
import { Button } from "@/components/ui/button";
import { ArrowRight, Copy, Check, Loader2 } from "lucide-react";

interface ApiKeyCreatorProps {
  onCreated: (apiKey: string) => void;
}

export function ApiKeyCreator({ onCreated }: ApiKeyCreatorProps) {
  const [status, setStatus] = useState<"creating" | "ready" | "error">("creating");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function create() {
      try {
        const resp = await apiKeyClient.createApiKey({ name: `onboarding-${Date.now()}` });
        setSecret(resp.secret);
        setStatus("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create API key");
        setStatus("error");
      }
    }

    create();
  }, []);

  async function handleCopy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Create an API key
      </h2>
      <p className="text-sm text-zinc-500 mb-6 max-w-md text-center">
        API keys let your agent authenticate with Dazzle.
        We'll create one for you automatically.
      </p>

      <div className="w-full max-w-md">
        {status === "creating" && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-zinc-400">Creating API key...</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {status === "ready" && secret && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 flex flex-col gap-3">
            <p className="text-sm font-medium text-emerald-400">API key created — copy it now:</p>
            <div className="flex items-center gap-2">
              <pre className="flex-1 font-mono text-xs text-zinc-200 bg-zinc-950/50 rounded-lg px-3 py-2 border border-white/[0.06] overflow-hidden truncate min-w-0">
                {secret.slice(0, 12)}{"••••••••"}
              </pre>
              <button
                onClick={handleCopy}
                className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-zinc-600">Save this key — it won't be shown again.</p>
            <Button
              onClick={() => onCreated(secret)}
              className="mt-1 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold w-full"
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
