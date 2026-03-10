import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/CopyButton";
import { AnimatedPage } from "@/components/AnimatedPage";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  INSTALL_SNIPPET_UNIX,
  INSTALL_SNIPPET_WINDOWS,
  QUICK_START_SNIPPET,
  QUICK_START_STEPS,
  MULTI_STAGE_SNIPPET,
} from "./docs-content";

function useOS(): "windows" | "mac" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0">
      {n}
    </span>
  );
}

export function Docs() {
  const os = useOS();

  const installSnippet = os === "windows" ? INSTALL_SNIPPET_WINDOWS : INSTALL_SNIPPET_UNIX;
  const altSnippet = os === "windows" ? INSTALL_SNIPPET_UNIX : INSTALL_SNIPPET_WINDOWS;
  const altLabel = os === "windows" ? "macOS / Linux" : "Windows (PowerShell)";

  return (
    <AnimatedPage>
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-[-0.02em] text-foreground mb-1 font-display">
            Docs
          </h1>
          <p className="text-base text-muted-foreground">
            Control your stages with the Dazzle CLI.
          </p>
        </div>
        <CopyAgentPromptButton variant="compact" />
      </div>

      {/* Install */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground">Install the CLI</p>
          <CopyButton text={installSnippet} tooltip="Copy to clipboard" size="icon-xs" />
        </div>
        <CodeBlock code={installSnippet} />
        <p className="text-sm text-muted-foreground mt-2">
          {altLabel}: <code className="text-muted-foreground">{altSnippet}</code>. Or <code className="text-muted-foreground">go install github.com/dazzle-labs/cli/cmd/dazzle@latest</code>.
        </p>
      </section>

      {/* Authenticate */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground">Authenticate</p>
          <CopyButton text="dazzle login" tooltip="Copy to clipboard" size="icon-xs" />
        </div>
        <CodeBlock code="dazzle login" />
        <p className="text-sm text-muted-foreground mt-2">
          Create an API key in Settings {">"} API Keys, then paste it when prompted. Or set <code className="text-muted-foreground">export DAZZLE_API_KEY=dzl_...</code> in your shell profile.
        </p>
      </section>

      {/* Quick Start with numbered steps */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl tracking-[-0.02em] text-foreground font-display">
            Quick Start
          </h2>
          <CopyButton text={QUICK_START_SNIPPET} tooltip="Copy to clipboard" size="icon-xs" />
        </div>
        <p className="text-base text-muted-foreground mb-4">
          Create a stage, push content, and go live.
        </p>
        <div className="flex flex-col gap-3 mb-4">
          {QUICK_START_STEPS.map((step) => (
            <div key={step.n} className="flex items-center gap-3">
              <StepBadge n={step.n} />
              <span className="text-base text-foreground">{step.label}</span>
              <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">{step.cmd}</code>
            </div>
          ))}
        </div>
        <CodeBlock code={QUICK_START_SNIPPET} />
      </section>

      {/* Multi-stage — collapsible */}
      <CollapsibleSection
        title="Working with multiple stages"
        copyText={MULTI_STAGE_SNIPPET}
      >
        <CodeBlock code={MULTI_STAGE_SNIPPET} />
      </CollapsibleSection>

      {/* CLI reference — collapsible */}
      <CollapsibleSection
        title="Full CLI reference"
        copyText="dazzle --help"
      >
        <CodeBlock code="dazzle --help" />
        <p className="text-sm text-muted-foreground mt-2">
          Run <code className="text-muted-foreground">dazzle stage --help</code> for stage commands, or <code className="text-muted-foreground">dazzle stage script --help</code> for script commands.
        </p>
      </CollapsibleSection>

      {/* llms.txt link */}
      <div className="text-center">
        <a
          href="/llms.txt"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          View llms.txt for AI agent consumption
        </a>
      </div>
    </AnimatedPage>
  );
}
