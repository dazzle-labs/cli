import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommandLine, TerminalBlock } from "@/components/CommandLine";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  INSTALL_TABS,
  QUICK_START_STEPS,
  MULTI_STAGE_SNIPPET,
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
        <TerminalBlock code={`# All top-level commands\n${cli.help.full}\n\n# Stage commands\n${cli.stageHelp.full}\n\n# Sync commands\n${cli.stageSyncHelp.full}`} />
      </CollapsibleSection>
    </AnimatedPage>
  );
}
