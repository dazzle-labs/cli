import { useState } from "react";
import { Link } from "react-router-dom";
import { SignIn } from "@clerk/react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Command,
  Copy,
  Globe,
  Layers,
  Monitor,
  Radio,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const STEPS = [
  {
    num: "01",
    title: "Create a stage",
    desc: "Spin up a cloud Chrome instance in seconds. Each stage is a full, isolated browser environment.",
    icon: Layers,
  },
  {
    num: "02",
    title: "Connect your agent",
    desc: "Push scripts, sync files, or let your AI agent drive the browser directly — all via CLI.",
    icon: Terminal,
  },
  {
    num: "03",
    title: "Go live",
    desc: "Broadcast to Twitch, YouTube, Kick, or any RTMP destination. Share preview links with anyone.",
    icon: Radio,
  },
];

const FEATURES = [
  {
    title: "Cloud Browsers",
    desc: "Full Chrome instances in the cloud. Your agent gets its own isolated environment — no local resources.",
    icon: Globe,
  },
  {
    title: "Real-time Dashboard",
    desc: "Screenshots, console output, and stream status. Watch your agent work from anywhere.",
    icon: Monitor,
  },
  {
    title: "Multi-platform Streaming",
    desc: "Twitch, YouTube, Kick, Restream, or custom RTMP. Stream to multiple destinations simultaneously.",
    icon: Radio,
  },
  {
    title: "CLI-First",
    desc: "Create stages, deploy content, manage broadcasts — entirely from your terminal. No GUI needed.",
    icon: Command,
  },
];

const FRAMEWORKS = [
  "Claude Code",
  "OpenAI Agents SDK",
  "CrewAI",
  "LangGraph",
  "AutoGen",
  "OpenClaw",
];

const ease = [0.25, 0.1, 0.25, 1] as const;

function LlmsTxtCallout() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const resp = await fetch("/llms.txt");
    const text = await resp.text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white mb-1">
            Building with an AI agent?
          </h3>
          <p className="text-sm text-zinc-400 leading-relaxed mb-4">
            Copy our setup prompt — paste it into Claude, GPT, or any agent and
            it handles the rest.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy setup prompt
                </>
              )}
            </button>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-500 hover:text-zinc-300 font-mono transition-colors"
            >
              view llms.txt
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = () => setSignInOpen(true);

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
      {/* ── Ambient background ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 backdrop-blur-xl bg-zinc-950/60 border-b border-white/[0.04]">
        <span className="text-base font-semibold tracking-tight text-white font-display">
          Dazzle
        </span>
        <div className="flex items-center gap-5">
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 text-sm font-mono transition-colors"
          >
            llms.txt
          </a>
          <Link
            to="/docs"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Docs
          </Link>
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

      {/* ── Hero ── */}
      <section className="relative z-10 flex flex-col items-center px-6 pt-28 pb-12 md:pt-40 md:pb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <Badge
            variant="outline"
            className="border-emerald-500/30 text-emerald-400 mb-8 text-xs px-3 py-1 h-auto"
          >
            Free during beta
          </Badge>
        </motion.div>

        <motion.h1
          className="font-display text-[clamp(2.8rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em] text-white max-w-4xl"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease }}
        >
          Put your AI agent
          <br />
          <span className="text-emerald-400">on stage.</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl leading-relaxed font-light"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease }}
        >
          Cloud browser environments for AI agents. Watch from your dashboard,
          stream to Twitch and YouTube, control everything from your terminal.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col sm:flex-row gap-4 items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease }}
        >
          <Button
            size="lg"
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
            onClick={openSignIn}
          >
            Get Started
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <button
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            onClick={() =>
              document
                .getElementById("how-it-works")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            How it works
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      </section>

      {/* ── Terminal demo ── */}
      <section className="relative z-10 px-6 pb-28 md:pb-36">
        <motion.div
          className="relative mx-auto max-w-3xl"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6, ease }}
        >
          <div className="rounded-xl border border-white/[0.08] overflow-hidden transition-all duration-500 hover:border-emerald-500/15">
            <video
              src="/static/demo.webm"
              autoPlay
              loop
              muted
              playsInline
              className="w-full"
            />
          </div>
          {/* Glow reflection beneath terminal */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-2/3 h-12 bg-emerald-500/[0.04] blur-2xl rounded-full pointer-events-none" />
        </motion.div>
      </section>

      {/* ── llms.txt callout ── */}
      <section className="relative z-10 px-6 pb-16 md:pb-20">
        <motion.div
          className="mx-auto max-w-2xl"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7 }}
        >
          <LlmsTxtCallout />
        </motion.div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative z-10 px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.4 }}
          >
            <h2 className="font-display text-3xl md:text-4xl text-white tracking-[-0.01em]">
              Three commands to live
            </h2>
            <p className="mt-3 text-zinc-500 text-sm">
              From zero to broadcasting in under a minute.
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.015] p-8 transition-all duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.02]"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <span className="font-display text-5xl text-emerald-500/[0.12] block mb-5 leading-none">
                  {step.num}
                </span>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/15">
                  <step.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-400 font-light">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section divider ── */}
      <div className="relative z-10 flex justify-center">
        <div className="w-24 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      {/* ── Features ── */}
      <section className="relative z-10 px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.4 }}
          >
            <h2 className="font-display text-3xl md:text-4xl text-white tracking-[-0.01em]">
              Everything you need
            </h2>
            <p className="mt-3 text-zinc-500 text-sm">
              A complete platform for AI agent streaming.
            </p>
          </motion.div>

          <div className="grid gap-6 sm:grid-cols-2">
            {FEATURES.map((feat, i) => (
              <motion.div
                key={feat.title}
                className="group rounded-2xl border border-white/[0.06] bg-white/[0.015] p-8 transition-all duration-300 hover:border-white/[0.1]"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
              >
                <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400 transition-colors group-hover:text-emerald-400 group-hover:bg-emerald-500/10">
                  <feat.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  {feat.title}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-400 font-light">
                  {feat.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Frameworks ── */}
      <section className="relative z-10 px-6 py-20 md:py-28">
        <motion.div
          className="mx-auto max-w-3xl text-center"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
        >
          <h3 className="font-display text-2xl md:text-3xl text-white mb-3">
            Works with your stack
          </h3>
          <p className="text-sm text-zinc-500 mb-8">
            Framework agnostic. If your agent can run code, it can use Dazzle.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {FRAMEWORKS.map((name, i) => (
              <motion.span
                key={name}
                className="rounded-full border border-white/[0.08] bg-white/[0.02] px-5 py-2 text-sm text-zinc-400 transition-colors hover:border-emerald-500/20 hover:text-zinc-300"
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
              >
                {name}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 px-6 py-28 md:py-36 text-center">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="font-display text-[clamp(1.8rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-white max-w-2xl mx-auto">
            Ready to go <span className="text-emerald-400">live?</span>
          </h2>
          <p className="mt-4 text-zinc-500 text-sm">
            Free during beta. No credit card required.
          </p>
          <Button
            size="lg"
            className="mt-8 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
            onClick={openSignIn}
          >
            Create your first stage
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8">
        <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
          <span>dazzle.fm &middot; &copy; 2026 Dazzle</span>
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
  );
}
