import { useState } from "react";
import { Link } from "react-router-dom";
import { SignIn } from "@clerk/react";
import { motion } from "motion/react";
import { Check, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CommandLine, TerminalBlock } from "@/components/CommandLine";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  INSTALL_SNIPPET_UNIX,
  INSTALL_SNIPPET_WINDOWS,
  QUICK_START_STEPS,
  MULTI_STAGE_SNIPPET,
} from "./docs-content";

const ease = [0.25, 0.1, 0.25, 1] as const;

function useOS(): "windows" | "mac" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold shrink-0">
      {n}
    </span>
  );
}

function CopyPromptButton() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const resp = await fetch("/llms.txt");
    const text = await resp.text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <button
      onClick={handleCopy}
      className="group w-full rounded-xl border border-dashed border-emerald-500/20 bg-emerald-500/[0.03] p-6 text-left transition-all duration-300 hover:border-emerald-500/30 hover:bg-emerald-500/[0.05] cursor-pointer"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
          {copied ? <Check className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="text-base font-semibold text-white mb-0.5">
            {copied ? "Copied!" : "Let your AI agent figure it out"}
          </h3>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {copied
              ? "Paste the setup prompt into your AI agent's context."
              : "Copy a setup prompt to your clipboard. Paste it into any AI agent and it'll handle the rest."}
          </p>
        </div>
        {!copied && <Copy className="h-4 w-4 text-zinc-500 shrink-0 ml-auto" />}
      </div>
    </button>
  );
}

export function PublicDocs() {
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = () => setSignInOpen(true);
  const os = useOS();

  const installSnippet = os === "windows" ? INSTALL_SNIPPET_WINDOWS : INSTALL_SNIPPET_UNIX;
  const altSnippet = os === "windows" ? INSTALL_SNIPPET_UNIX : INSTALL_SNIPPET_WINDOWS;
  const primaryLabel = os === "windows" ? "Windows (PowerShell)" : "macOS / Linux";
  const altLabel = os === "windows" ? "macOS / Linux" : "Windows (PowerShell)";

  return (
    <div className="dark">
      <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
        {/* ── Ambient background ── */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="landing-orb landing-orb-1 !opacity-50" />
          <div className="landing-orb landing-orb-2 !opacity-50" />
        </div>

        {/* ── Nav ── */}
        <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 backdrop-blur-xl bg-zinc-950/60 border-b border-white/[0.04]">
          <Link
            to="/"
            className="text-base font-semibold tracking-tight text-white hover:text-white"
          >
            dazzle
          </Link>
          <div className="flex items-center gap-5">
            <Link
              to="/docs"
              className="text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Docs
            </Link>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-zinc-300 text-sm font-mono transition-colors"
            >
              llms.txt
            </a>
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 text-zinc-300 hover:text-white hover:bg-white/5"
              onClick={openSignIn}
            >
              Sign In
            </Button>
          </div>
        </nav>

        {/* ── Content ── */}
        <TooltipProvider>
          <motion.div
            className="relative z-10 mx-auto max-w-2xl px-6 py-16 md:py-24"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
          >
            {/* Header */}
            <div className="mb-10">
              <h1 className="text-3xl tracking-[-0.02em] text-white mb-2 font-display">
                Docs
              </h1>
              <p className="text-base text-zinc-400">
                Control your stages with the Dazzle CLI.
              </p>
            </div>

            {/* Copy agent prompt */}
            <div className="mb-10">
              <CopyPromptButton />
            </div>

            {/* Install */}
            <section className="mb-10">
              <h2 className="text-xl tracking-[-0.02em] text-white font-display mb-4">
                Installing the CLI
              </h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-zinc-400 mb-1.5">{primaryLabel}</p>
                  <CommandLine cmd={installSnippet} />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-400 mb-1.5">{altLabel}</p>
                  <CommandLine cmd={altSnippet} />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-400 mb-1.5">Go</p>
                  <CommandLine cmd="go install github.com/dazzle-labs/cli/cmd/dazzle@latest" />
                </div>
              </div>
            </section>

            {/* Quick Start */}
            <section className="mb-10">
              <h2 className="text-xl tracking-[-0.02em] text-white font-display mb-6">
                Quick Start
              </h2>

              <div className="flex flex-col gap-5">
                {QUICK_START_STEPS.map((step) => (
                  <motion.div
                    key={step.n}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 + step.n * 0.06, ease }}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <StepBadge n={step.n} />
                      <span className="text-base text-white">{step.label}</span>
                    </div>
                    <CommandLine cmd={step.cmd} />
                    {step.n === 1 && (
                      <p className="text-sm text-zinc-500 mt-2">
                        Create an API key in Settings, then paste it when prompted.
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>
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
                className="text-sm text-zinc-500 hover:text-emerald-400 transition-colors"
              >
                View llms.txt for AI agent consumption
              </a>
            </div>
          </motion.div>
        </TooltipProvider>

        {/* ── Footer ── */}
        <footer className="relative z-10 border-t border-white/[0.04] py-8">
          <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
            <span>stream.dazzle.fm &middot; &copy; 2026 Dazzle</span>
            <span className="text-zinc-800">&middot;</span>
            <Link to="/docs" className="hover:text-zinc-400 transition-colors">
              Docs
            </Link>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:text-zinc-400 transition-colors"
            >
              llms.txt
            </a>
          </div>
        </footer>

        {/* ── Sign In Dialog ── */}
        <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
          <DialogContent
            className="bg-transparent ring-0 shadow-none p-0 gap-0 sm:max-w-fit max-w-fit"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">Sign in to Dazzle</DialogTitle>
            <SignIn />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
