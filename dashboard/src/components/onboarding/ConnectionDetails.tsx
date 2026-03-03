import { useEffect, useState } from "react";
import { apiKeyClient } from "../../client.js";
import type { Framework } from "./frameworks";
import { Button } from "@/components/ui/button";
import { Copy, Check, PartyPopper, Plus, Loader2 } from "lucide-react";

interface ConnectionDetailsProps {
  framework: Framework;
  endpointId: string;
  /** Pre-created API key (from guided path). If null, we check for existing keys. */
  apiKey: string | null;
  onDone: () => void;
  verbose?: boolean;
}

export function ConnectionDetails({ framework, endpointId, apiKey: initialKey, onDone, verbose }: ConnectionDetailsProps) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [hasExistingKeys, setHasExistingKeys] = useState<boolean | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  const mcpUrl = `${window.location.origin}/mcp/${endpointId}`;

  // If no key was provided, check if user has existing keys
  useEffect(() => {
    if (initialKey) {
      setHasExistingKeys(true);
      return;
    }
    async function check() {
      try {
        const resp = await apiKeyClient.listApiKeys({});
        if (resp.keys.length > 0) {
          setHasExistingKeys(true);
        } else {
          // No keys at all — auto-create one
          const keyResp = await apiKeyClient.createApiKey({ name: `endpoint-${Date.now()}` });
          setActiveKey(keyResp.secret);
          setHasExistingKeys(false);
        }
      } catch {
        setHasExistingKeys(true);
      }
    }
    check();
  }, [initialKey]);

  async function handleCreateKey() {
    setCreatingKey(true);
    try {
      const resp = await apiKeyClient.createApiKey({ name: `endpoint-${Date.now()}` });
      setActiveKey(resp.secret);
    } catch {
      // ignore
    } finally {
      setCreatingKey(false);
    }
  }

  // Snippet always uses env var — never the raw key
  const snippet = framework.getSnippet(mcpUrl, "");

  async function handleCopySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }

  async function handleCopyKey() {
    if (!activeKey) return;
    await navigator.clipboard.writeText(activeKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  // Still loading key check
  if (!initialKey && hasExistingKeys === null) {
    return (
      <div className="flex flex-col items-center">
        <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  const maskedKey = activeKey
    ? `${activeKey.slice(0, 8)}${"•".repeat(24)}`
    : null;

  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        {verbose ? "Connect your agent" : "Connect"}
      </h2>
      <p className="text-sm text-zinc-500 mb-6 max-w-md text-center">
        {verbose
          ? `Add this ${framework.name} configuration to connect your agent.`
          : `Add this to your ${framework.name} config.`}
      </p>

      <div className="w-full max-w-lg">
        {/* Code snippet */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-medium text-zinc-500">{framework.language}</span>
            <button
              onClick={handleCopySnippet}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
            >
              {copiedSnippet ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed">
            {snippet}
          </pre>
        </div>

        {/* API key section */}
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3">
            <p className="text-xs font-medium text-zinc-400 mb-1">
              Set <code className="text-emerald-400 bg-white/[0.04] px-1 py-0.5 rounded">DAZZLE_API_KEY</code> in your environment
            </p>
            <p className="text-xs text-zinc-600">
              Add <code className="text-zinc-500">export DAZZLE_API_KEY=&lt;key&gt;</code> to your shell profile, or use a <code className="text-zinc-500">.env</code> file.
            </p>
          </div>

          {activeKey ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-zinc-500 bg-zinc-950/50 rounded-lg px-3 py-2 border border-white/[0.06] truncate min-w-0">
                {maskedKey}
              </code>
              <button
                onClick={handleCopyKey}
                className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
                title="Copy API key"
              >
                {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : hasExistingKeys ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-xs text-zinc-500">
                Use an existing key from the API Keys page, or create a new one.
              </p>
              <Button
                size="sm"
                onClick={handleCreateKey}
                disabled={creatingKey}
                className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-xs shrink-0"
              >
                {creatingKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New key
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </div>

        {verbose && (
          <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs font-medium text-zinc-400 mb-2">Field reference</p>
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-start gap-2">
                <code className="text-emerald-400 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">url</code>
                <span className="text-zinc-500">MCP URL for this endpoint — routes commands to your cloud environment</span>
              </div>
              <div className="flex items-start gap-2">
                <code className="text-emerald-400 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">DAZZLE_API_KEY</code>
                <span className="text-zinc-500">Set this env var to your API key — never hardcode it</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-emerald-400">
            <PartyPopper className="h-5 w-5" />
            <span className="text-sm font-medium">You're all set!</span>
          </div>
          <Button
            onClick={onDone}
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          >
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
