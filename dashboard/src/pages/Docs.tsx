import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { FRAMEWORKS } from "@/components/onboarding/frameworks";

const MCP_URL = `${window.location.origin}/mcp/YOUR_UUID`;

export function Docs() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showScoping, setShowScoping] = useState(false);

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function CopyBtn({ id, text }: { id: string; text: string }) {
    return (
      <button
        onClick={() => copy(text, id)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
      >
        {copiedId === id ? (
          <><Check className="h-3.5 w-3.5" />Copied</>
        ) : (
          <><Copy className="h-3.5 w-3.5" />Copy</>
        )}
      </button>
    );
  }

  const claudeJsonSnippet = JSON.stringify(
    { mcpServers: { dazzle: { type: "http", url: MCP_URL, headers: { Authorization: "Bearer ${DAZZLE_API_KEY}" } } } },
    null, 2
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-3xl tracking-[-0.02em] text-white mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Docs
        </h1>
        <p className="text-sm text-zinc-500">
          Connect your agent to Dazzle via MCP.
        </p>
      </div>

      {/* Endpoint format */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-4">
        <p className="text-xs font-medium text-zinc-400 mb-3">MCP endpoint format</p>
        <code className="block text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
          {window.location.origin}/mcp/<span className="text-emerald-400">&lt;agent-uuid&gt;</span>
        </code>
        <p className="text-xs text-zinc-600 mt-3">
          Each UUID maps to an isolated streaming environment. Use different UUIDs to run separate agents or projects in parallel.
        </p>
      </div>

      {/* Env var */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-6">
        <p className="text-xs font-medium text-zinc-400 mb-2">Set your API key as an environment variable</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
            export DAZZLE_API_KEY=bstr_...
          </code>
          <button
            onClick={() => copy("export DAZZLE_API_KEY=", "env")}
            className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
          >
            {copiedId === "env" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Add to your <code className="text-zinc-500">.bashrc</code>, <code className="text-zinc-500">.zshrc</code>, or project <code className="text-zinc-500">.env</code>. Never hardcode keys in config files.
        </p>
      </div>

      {/* Framework snippets */}
      <h2
        className="text-xl tracking-[-0.02em] text-white mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Client setup
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Copy the snippet for your framework. Replace <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded text-xs">YOUR_UUID</code> with a fixed UUID per project.
      </p>

      <div className="flex flex-col gap-3 mb-4">
        {FRAMEWORKS.map((fw) => {
          const snippet = fw.getSnippet(MCP_URL, "");
          return (
            <div key={fw.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-zinc-300">{fw.name}</span>
                  <span className="text-xs text-zinc-600">{fw.language}</span>
                </div>
                <CopyBtn id={fw.id} text={snippet} />
              </div>
              <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                {snippet}
              </pre>
            </div>
          );
        })}

        {/* Claude Code JSON config (additional) */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-zinc-300">Claude Code</span>
              <span className="text-xs text-zinc-600">.mcp.json</span>
            </div>
            <CopyBtn id="claude-json" text={claudeJsonSnippet} />
          </div>
          <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed">
            {claudeJsonSnippet}
          </pre>
        </div>
      </div>

      {/* Scoping section */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <button
          onClick={() => setShowScoping(!showScoping)}
          className="w-full flex items-center gap-2 px-5 py-4 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
        >
          {showScoping ? (
            <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
          )}
          <div>
            <p className="text-sm font-medium text-zinc-300">Per-project and multi-agent setups</p>
            <p className="text-xs text-zinc-600">How to scope sessions to different projects or agents</p>
          </div>
        </button>
        {showScoping && (
          <div className="px-5 pb-5 pt-0">
            <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">One UUID per project</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  The UUID in the MCP URL determines which environment your agent connects to.
                  Use a consistent UUID per project so the same agent always reconnects to the same workspace.
                  Environments persist until you explicitly stop them.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">Multiple agents in parallel</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Each UUID gets its own isolated environment. Run multiple agents simultaneously by
                  giving each a different UUID. For example, scope by project:
                </p>
                <pre className="mt-2 text-xs font-mono text-zinc-400 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06] overflow-x-auto leading-relaxed">{`# Project A — always uses the same environment
/mcp/a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Project B — separate environment
/mcp/f9e8d7c6-b5a4-3210-fedc-ba0987654321`}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">Project-scoped config</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  For Claude Code, add the MCP config to your project's <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded">.mcp.json</code> so
                  each repo gets its own Dazzle environment. The UUID stays fixed per project, and the environment
                  spins up automatically when the agent first connects.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">Shared API key</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  A single API key works across all your sessions. Or create separate keys per project or
                  team member for easier auditing — revoke one without affecting others.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
