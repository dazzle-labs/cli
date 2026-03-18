import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommandLine, TerminalBlock, CodeBlock } from "@/components/CommandLine";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  INSTALL_TABS,
  QUICK_START_STEPS,
  MULTI_STAGE_SNIPPET,
  EVENTS_HTML_SNIPPET,
  EVENTS_CLI_SNIPPET,
  PERSISTENCE_SNIPPET,
} from "./docs-content";
import type { InstallTab } from "./docs-content";
import { cli } from "@/lib/cli-commands";

function detectDefaultTab(): InstallTab {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  return "unix";
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0">
      {n}
    </span>
  );
}

export function Docs() {
  const [installTab, setInstallTab] = useState<InstallTab>(detectDefaultTab);
  const activeInstall = INSTALL_TABS.find((t) => t.id === installTab)!;

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
        <Button
          variant="outline"
          size="sm"
          className="text-xs text-muted-foreground hover:text-primary hover:border-primary/20 hover:bg-primary/[0.03]"
          asChild
        >
          <a href="/llms.txt" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            llms.txt
          </a>
        </Button>
      </div>

      {/* Install */}
      <section className="mb-10">
        <h2 className="text-xl tracking-[-0.02em] text-foreground font-display mb-4">
          Installing the CLI
        </h2>
        <div className="flex gap-1 mb-3">
          {INSTALL_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setInstallTab(tab.id)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer",
                installTab === tab.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CommandLine cmd={activeInstall.cmd} />
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
              {step.cmd && <CommandLine cmd={step.cmd} />}
              {step.note && <p className="text-sm text-muted-foreground mt-2 mb-2">{step.note}</p>}
              {step.code && <CodeBlock code={step.code} language={step.language} />}
              {step.n === 1 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Opens your browser to sign in with your Dazzle account.
                </p>
              )}
            </AnimatedListItem>
          ))}
        </AnimatedList>
      </section>

      {/* Next Steps: Events + Persistence */}
      <section className="mb-10">
        <h2 className="text-xl tracking-[-0.02em] text-foreground font-display mb-3">
          Next Steps: Live Events &amp; Persistence
        </h2>
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          Push real-time data to your stage without re-syncing, and persist state across restarts with localStorage.
        </p>

        <AnimatedList className="flex flex-col gap-5" delay={0.06}>
          <AnimatedListItem>
            <div className="flex items-center gap-2.5 mb-2">
              <StepBadge n={1} />
              <span className="text-base text-foreground">Add event handling to your page</span>
            </div>
            <CodeBlock code={EVENTS_HTML_SNIPPET} language="html" />
          </AnimatedListItem>

          <AnimatedListItem>
            <div className="flex items-center gap-2.5 mb-2">
              <StepBadge n={2} />
              <span className="text-base text-foreground">Sync and send events</span>
            </div>
            <TerminalBlock code={EVENTS_CLI_SNIPPET} />
          </AnimatedListItem>

          <AnimatedListItem>
            <div className="flex items-center gap-2.5 mb-2">
              <StepBadge n={3} />
              <span className="text-base text-foreground">State survives restarts</span>
            </div>
            <TerminalBlock code={PERSISTENCE_SNIPPET} />
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.04] px-4 py-3">
              <p className="text-sm text-foreground leading-relaxed">
                <span className="font-mono text-primary text-xs">localStorage</span> and <span className="font-mono text-primary text-xs">IndexedDB</span> are automatically backed up to cloud storage and restored when a stage comes back up — your app state survives across restarts without any extra work.
              </p>
            </div>
          </AnimatedListItem>
        </AnimatedList>
      </section>

      {/* Multi-stage — collapsible */}
      <CollapsibleSection title="Working with multiple stages">
        <TerminalBlock code={MULTI_STAGE_SNIPPET} />
      </CollapsibleSection>

      {/* CLI reference — collapsible */}
      <CollapsibleSection title="Full CLI reference">
        <TerminalBlock code={`# All top-level commands\n${cli.help.full}\n\n# Stage commands\n${cli.stageHelp.full}\n\n# Sync commands\n${cli.stageSyncHelp.full}`} />
      </CollapsibleSection>
    </AnimatedPage>
  );
}
