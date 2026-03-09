import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";
import { CodeBlock } from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function useOS(): "windows" | "mac" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

export function Docs() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const os = useOS();

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function CopyIconBtn({ id, text }: { id: string; text: string }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => copy(text, id)}
            className="text-muted-foreground hover:text-primary shrink-0"
          >
            {copiedId === id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy to clipboard</TooltipContent>
      </Tooltip>
    );
  }

  const installSnippet = os === "windows"
    ? `irm https://stream.dazzle.fm/install.ps1 | iex`
    : `curl -sSL https://stream.dazzle.fm/install.sh | sh`;

  const altSnippet = os === "windows"
    ? `curl -sSL https://stream.dazzle.fm/install.sh | sh`
    : `irm https://stream.dazzle.fm/install.ps1 | iex`;

  const altLabel = os === "windows" ? "macOS / Linux" : "Windows (PowerShell)";

  const quickStartSnippet = `# Authenticate
dazzle login

# Create and activate a stage
dazzle stage create my-stage
dazzle stage activate

# Push content (JS or JSX, hot-swapped via HMR)
dazzle stage script set ./my-overlay.jsx

# Take a screenshot to verify
dazzle stage screenshot -o preview.png

# Go live
dazzle stage broadcast on`;

  const multiStageSnippet = `# List all stages
dazzle stage list

# Target a specific stage
dazzle stage activate -s my-stage
dazzle stage script set app.jsx -s my-stage

# Set a default stage for all commands
dazzle stage default my-stage`;

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-[-0.02em] text-foreground mb-1 font-display">
            Docs
          </h1>
          <p className="text-sm text-muted-foreground">
            Control your stages with the Dazzle CLI.
          </p>
        </div>
        <CopyAgentPromptButton variant="compact" />
      </div>

      {/* Install */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">Install the CLI</p>
          <CopyIconBtn id="install" text={installSnippet} />
        </div>
        <CodeBlock code={installSnippet} />
        <p className="text-xs text-muted-foreground mt-2">
          {altLabel}: <code className="text-muted-foreground">{altSnippet}</code>. Or <code className="text-muted-foreground">go install github.com/dazzle-labs/cli/cmd/dazzle@latest</code>.
        </p>
      </section>

      {/* Authenticate */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">Authenticate</p>
          <CopyIconBtn id="login" text="dazzle login" />
        </div>
        <CodeBlock code="dazzle login" />
        <p className="text-xs text-muted-foreground mt-2">
          Create an API key in Settings {">"} API Keys, then paste it when prompted. Or set <code className="text-muted-foreground">export DAZZLE_API_KEY=dzl_...</code> in your shell profile.
        </p>
      </section>

      {/* Quick Start */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl tracking-[-0.02em] text-foreground font-display">
            Quick Start
          </h2>
          <CopyIconBtn id="quickstart" text={quickStartSnippet} />
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Create a stage, push content, and go live.
        </p>
        <CodeBlock code={quickStartSnippet} />
      </section>

      {/* Multi-stage */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">Working with multiple stages</p>
          <CopyIconBtn id="multistage" text={multiStageSnippet} />
        </div>
        <CodeBlock code={multiStageSnippet} />
      </section>

      {/* CLI reference */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">Full CLI reference</p>
          <CopyIconBtn id="help" text="dazzle --help" />
        </div>
        <CodeBlock code="dazzle --help" />
        <p className="text-xs text-muted-foreground mt-2">
          Run <code className="text-muted-foreground">dazzle stage --help</code> for stage commands, or <code className="text-muted-foreground">dazzle stage script --help</code> for script commands.
        </p>
      </section>

      {/* llms.txt link */}
      <div className="text-center">
        <a
          href="/llms.txt"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          View llms.txt for AI agent consumption
        </a>
      </div>
    </div>
  );
}
