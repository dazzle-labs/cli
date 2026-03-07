import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";

export function Docs() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  const installSnippet = `go install github.com/dazzle-labs/cli/cmd/dazzle@latest`;

  const quickStartSnippet = `# Authenticate
dazzle login

# Create and activate a stage
dazzle s new my-stage
dazzle s up

# Push content (JS or JSX, hot-swapped via HMR)
dazzle s sc set ./my-overlay.jsx

# Take a screenshot to verify
dazzle s ss -o preview.png

# Go live
dazzle s live on`;

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1
            className="text-3xl tracking-[-0.02em] text-white mb-1"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Docs
          </h1>
          <p className="text-sm text-zinc-500">
            Control your stages with the Dazzle CLI.
          </p>
        </div>
        <CopyAgentPromptButton variant="compact" />
      </div>

      {/* Install CLI */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-4">
        <p className="text-xs font-medium text-zinc-400 mb-3">Install the CLI</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
            {installSnippet}
          </code>
          <button
            onClick={() => copy(installSnippet, "install")}
            className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
          >
            {copiedId === "install" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-3">
          Or download a binary from the <a href="https://github.com/dazzle-labs/cli/releases" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors underline underline-offset-2">releases page</a>. Source: <a href="https://github.com/dazzle-labs/cli" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-emerald-400 transition-colors underline underline-offset-2">github.com/dazzle-labs/cli</a>
        </p>
      </div>

      {/* Env var */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-6">
        <p className="text-xs font-medium text-zinc-400 mb-2">Authenticate</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
            dazzle login
          </code>
          <button
            onClick={() => copy("dazzle login", "login")}
            className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
          >
            {copiedId === "login" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Create an API key in Settings {">"} API Keys, then paste it when prompted. Or set <code className="text-zinc-500">export DAZZLE_API_KEY=bstr_...</code> in your shell profile.
        </p>
      </div>

      {/* Quick start */}
      <h2
        className="text-xl tracking-[-0.02em] text-white mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Quick Start
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Create a stage, push content, and go live.
      </p>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
          <span className="text-sm font-medium text-zinc-300">Shell</span>
          <CopyBtn id="quickstart" text={quickStartSnippet} />
        </div>
        <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {quickStartSnippet}
        </pre>
      </div>

      {/* Multi-stage usage */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-6">
        <p className="text-xs font-medium text-zinc-400 mb-3">Working with multiple stages</p>
        <pre className="text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-3 border border-white/[0.06] overflow-x-auto leading-relaxed whitespace-pre-wrap">{`# List all stages
dazzle s ls

# Target a specific stage
dazzle s up -s my-stage
dazzle s sc set app.jsx -s my-stage

# Set a default stage for all commands
dazzle s default my-stage`}</pre>
      </div>

      {/* CLI reference link */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-8">
        <p className="text-xs font-medium text-zinc-400 mb-2">Full CLI reference</p>
        <pre className="text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06] overflow-x-auto">
          dazzle --help
        </pre>
        <p className="text-xs text-zinc-600 mt-2">
          Run <code className="text-zinc-500">dazzle s --help</code> for stage commands, or <code className="text-zinc-500">dazzle s sc --help</code> for script commands.
        </p>
      </div>

      {/* llms.txt link */}
      <div className="mt-8 text-center">
        <a
          href="/llms.txt"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-600 hover:text-emerald-400 transition-colors"
        >
          View llms.txt for AI agent consumption
        </a>
      </div>
    </div>
  );
}
