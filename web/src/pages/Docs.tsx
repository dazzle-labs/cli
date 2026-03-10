import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/CopyButton";
import { AnimatedPage } from "@/components/AnimatedPage";
import { springs } from "@/lib/motion";

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

function CollapsibleSection({
  title,
  copyText,
  children,
  defaultOpen = false,
}: {
  title: string;
  copyText: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={springs.quick}
          >
            <ChevronDown className="h-4 w-4" />
          </motion.div>
          {title}
        </button>
        <CopyButton text={copyText} tooltip="Copy to clipboard" size="icon-xs" />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.snappy}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function Docs() {
  const os = useOS();

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
          <CopyButton text={quickStartSnippet} tooltip="Copy to clipboard" size="icon-xs" />
        </div>
        <p className="text-base text-muted-foreground mb-4">
          Create a stage, push content, and go live.
        </p>
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center gap-3">
            <StepBadge n={1} />
            <span className="text-base text-foreground">Authenticate</span>
            <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">dazzle login</code>
          </div>
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <span className="text-base text-foreground">Create a stage</span>
            <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">dazzle stage create my-stage</code>
          </div>
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <span className="text-base text-foreground">Push content</span>
            <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">dazzle stage script set ./app.jsx</code>
          </div>
          <div className="flex items-center gap-3">
            <StepBadge n={4} />
            <span className="text-base text-foreground">Screenshot to verify</span>
            <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">dazzle stage screenshot</code>
          </div>
          <div className="flex items-center gap-3">
            <StepBadge n={5} />
            <span className="text-base text-foreground">Go live</span>
            <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded ml-auto">dazzle stage broadcast on</code>
          </div>
        </div>
        <CodeBlock code={quickStartSnippet} />
      </section>

      {/* Multi-stage — collapsible */}
      <CollapsibleSection
        title="Working with multiple stages"
        copyText={multiStageSnippet}
      >
        <CodeBlock code={multiStageSnippet} />
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
