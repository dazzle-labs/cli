import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";
import { CommandLine, TerminalBlock } from "@/components/CommandLine";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  INSTALL_SNIPPET_UNIX,
  INSTALL_SNIPPET_WINDOWS,
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
  const primaryLabel = os === "windows" ? "Windows (PowerShell)" : "macOS / Linux";
  const altLabel = os === "windows" ? "macOS / Linux" : "Windows (PowerShell)";

  return (
    <AnimatedPage>
      {/* Header */}
      <div className="mb-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
      <section className="mb-10">
        <h2 className="text-xl tracking-[-0.02em] text-foreground font-display mb-4">
          Installing the CLI
        </h2>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5">{primaryLabel}</p>
            <CommandLine cmd={installSnippet} />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5">{altLabel}</p>
            <CommandLine cmd={altSnippet} />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5">Go</p>
            <CommandLine cmd="go install github.com/dazzle-labs/cli/cmd/dazzle@latest" />
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section className="mb-10">
        <h2 className="text-xl tracking-[-0.02em] text-foreground font-display mb-6">
          Quick Start
        </h2>

        <AnimatedList className="flex flex-col gap-5" delay={0.06}>
          {QUICK_START_STEPS.map((step) => (
            <AnimatedListItem key={step.n}>
              <div className="flex items-center gap-2.5 mb-2">
                <StepBadge n={step.n} />
                <span className="text-base text-foreground">{step.label}</span>
              </div>
              <CommandLine cmd={step.cmd} />
              {step.n === 1 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Create an API key in <a href="/api-keys" className="text-primary hover:text-primary/80">API Keys</a>, then paste it when prompted.
                </p>
              )}
            </AnimatedListItem>
          ))}
        </AnimatedList>
      </section>

      {/* Multi-stage — collapsible */}
      <CollapsibleSection title="Working with multiple stages">
        <TerminalBlock code={MULTI_STAGE_SNIPPET} />
      </CollapsibleSection>

      {/* CLI reference — collapsible */}
      <CollapsibleSection title="Full CLI reference">
        <TerminalBlock code={`# All top-level commands\ndazzle --help\n\n# Stage commands\ndazzle stage --help\n\n# Script commands\ndazzle stage script --help`} />
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
