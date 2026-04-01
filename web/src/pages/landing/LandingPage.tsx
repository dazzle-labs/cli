import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { SignIn, SignUp } from "@clerk/react";
import { motion } from "motion/react";
import {
  ArrowRight,
  ChevronDown,
  Gpu,
  Zap,
  RefreshCw,
  Wifi,
  HardDrive,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFeaturedStreams, FeaturedCarousel } from "@/components/FeaturedStream";
import { useLiveCount } from "@/hooks/use-live-count";
import { LiveText } from "./LiveText";
import { DemoSection } from "./DemoSection";
import { PERSONAS, DEFAULT_PERSONA } from "./personas";
import type { PersonaConfig } from "./personas";

const ease = [0.25, 0.1, 0.25, 1] as const;

/** Resolve headline JSX per persona (needs LiveText component). */
function getHeadline(id: string) {
  switch (id) {
    case "creative":
      return <>Generative art, always <LiveText>live</LiveText></>;
    case "data":
      return <>Real-time data, always <LiveText>live</LiveText></>;
    case "vtuber":
      return <>Your AI character, <LiveText>live</LiveText></>;
    case "signage":
      return <>Any screen, always <LiveText>live</LiveText></>;
    default:
      return <>Your AI agent, <LiveText>live</LiveText></>;
  }
}

export function LandingPage() {
  const { personaId } = useParams<{ personaId?: string }>();
  const [searchParams] = useSearchParams();
  const id = personaId || searchParams.get("for") || DEFAULT_PERSONA;
  const persona: PersonaConfig = PERSONAS[id] || PERSONAS[DEFAULT_PERSONA];

  const [signUpOpen, setSignUpOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignUp = () => setSignUpOpen(true);
  const openSignIn = () => setSignInOpen(true);
  const featuredStreams = useFeaturedStreams();
  const liveCount = useLiveCount();

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
      {/* ── Ambient background ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
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
        <Link to="/" className="text-base font-semibold tracking-tight text-white font-display">
          Dazzle
        </Link>
        <div className="flex items-center gap-5">
          <Link to="/live" className="text-zinc-400 hover:text-white text-sm transition-colors inline-flex items-center gap-1.5">
            Live
            {liveCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
                </span>
                <span className="text-emerald-400 text-xs">{liveCount}</span>
              </span>
            )}
          </Link>
          <Link to="/docs" className="text-zinc-400 hover:text-white text-sm transition-colors">
            Docs
          </Link>
          <a
            href="https://discord.gg/pHpAaSqtWK"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Discord
          </a>
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

      {/* ── Hero ── */}
      <section className="relative z-10 flex flex-col items-center px-6 pt-14 pb-8 md:pt-40 md:pb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <Badge
            variant="outline"
            className="border-emerald-500/30 text-emerald-400 mb-4 md:mb-8 text-xs px-3 py-1 h-auto"
          >
            Free during beta — stages are limited
          </Badge>
        </motion.div>

        <motion.h1
          className="font-display text-[clamp(2.2rem,5.5vw,4.5rem)] leading-[1.08] tracking-[-0.03em] text-white"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease }}
        >
          {getHeadline(persona.id)}
        </motion.h1>

        <motion.p
          className="mt-3 md:mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl leading-relaxed font-light"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease }}
        >
          {persona.subtitle}
        </motion.p>

        <motion.div
          className="mt-5 md:mt-10 flex flex-col sm:flex-row gap-4 items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease }}
        >
          <Button
            size="lg"
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
            onClick={openSignUp}
          >
            {persona.ctaText}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <button
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            onClick={() =>
              document
                .getElementById("under-the-hood")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            How it works
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </motion.div>

        <motion.div
          className="mt-7 md:mt-14 w-full max-w-5xl text-left"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.55, ease }}
        >
          <DemoSection persona={persona} />
        </motion.div>
      </section>

      {/* ── How It Works ── */}
      <section id="under-the-hood" className="relative z-10 px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          {/* ── Under the Hood ── */}
          <motion.div
            className="text-center mt-24 mb-14"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4 }}
          >
            <h2 className="font-display text-3xl md:text-4xl text-white tracking-[-0.01em]">
              Under the hood
            </h2>
            <p className="mt-3 text-zinc-500 text-sm max-w-xl mx-auto">
              Every stage is a full browser in the cloud, captured directly to a live stream. Add a GPU when you need it.
            </p>
          </motion.div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 mb-16">
            {[
              {
                icon: Gpu,
                title: "GPU when you need it",
                desc: "Stages run on CPU by default. Need WebGL, shaders, or three.js? Upgrade to a GPU stage for hardware-accelerated rendering.",
              },
              {
                icon: Zap,
                title: "Live events",
                desc: "Push JSON events from your agent to the browser in real time. No reload, no polling \u2014 the stream updates instantly.",
                code: `dazzle stage event emit my-stage '{"score": 42}'`,
              },
              {
                icon: RefreshCw,
                title: "Sync, don't deploy",
                desc: "Sync any folder to your stage. The browser auto-refreshes on every sync. Works with any build tool or none at all.",
                code: "dazzle stage sync ./dist --stage my-stage",
              },
              {
                icon: HardDrive,
                title: "Persistent state",
                desc: "localStorage and IndexedDB survive stage restarts. Your content picks up exactly where it left off \u2014 no cold starts.",
              },
              {
                icon: Wifi,
                title: "Unrestricted network",
                desc: "Fetch any API without CORS errors. WebSockets, SSE, and REST all work out of the box. Your stage has full internet access.",
              },
              {
                icon: Monitor,
                title: "Multi-platform streaming",
                desc: "Stream to Twitch, YouTube, Kick, or any custom RTMP server. Or share a dazzle.fm link \u2014 no streaming platform required.",
              },
            ].map((feature, i) => (
              <motion.div
                key={feature.title}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-6 transition-all duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.02]"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: i * 0.06, ease }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <feature.icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-white">
                    {feature.title}
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-zinc-400 font-light">
                  {feature.desc}
                </p>
                {feature.code && (
                  <pre className="mt-3 text-[11px] font-mono text-emerald-400/70 bg-emerald-500/[0.04] rounded-md px-3 py-2 overflow-x-auto feature-scroll">
                    {feature.code}
                  </pre>
                )}
              </motion.div>
            ))}
          </div>

          {/* Framework pills */}
          <motion.div
            className="mt-14 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4 }}
          >
            <p className="text-sm text-zinc-500 mb-4">
              {persona.frameworksLabel}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {persona.frameworks.map((name, i) => (
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
        </div>
      </section>

      {/* ── Featured live streams ── */}
      {featuredStreams.length > 0 && (
        <section className="relative z-10 px-6 pb-28 md:pb-36">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4 }}
          >
            <h2 className="font-display text-3xl md:text-4xl text-white tracking-[-0.01em]">
              See what people are building
            </h2>
            <p className="mt-3 text-zinc-500 text-sm">
              Live right now on Dazzle
            </p>
          </motion.div>
          <motion.div
            className="relative mx-auto max-w-5xl"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 1, ease }}
          >
            <FeaturedCarousel streams={featuredStreams} />
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-2/3 h-12 bg-emerald-500/[0.04] blur-2xl rounded-full pointer-events-none" />
          </motion.div>
        </section>
      )}

      {/* ── Final CTA ── */}
      <section className="relative z-10 px-6 py-28 md:py-36 text-center">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="font-display text-[clamp(1.8rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-white max-w-2xl mx-auto">
            Ready to go <LiveText>live?</LiveText>
          </h2>
          <p className="mt-4 text-zinc-500 text-sm">
            Free during beta. No credit card required.
          </p>
          <Button
            size="lg"
            className="mt-8 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
            onClick={openSignUp}
          >
            {persona.ctaFinalText}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8">
        <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
          <span>dazzle.fm &middot; &copy; 2026 Dazzle</span>
          <span className="text-zinc-800">&middot;</span>
          <Link to="/live" className="hover:text-zinc-400 transition-colors">Live</Link>
          <Link to="/docs" className="hover:text-zinc-400 transition-colors">Docs</Link>
          <Link to="/terms" className="hover:text-zinc-400 transition-colors">Terms</Link>
          <Link to="/privacy" className="hover:text-zinc-400 transition-colors">Privacy</Link>
          <a href="/llms.txt" target="_blank" rel="noopener noreferrer" className="font-mono hover:text-zinc-400 transition-colors">
            llms.txt
          </a>
        </div>
      </footer>

      {/* ── Sign Up Dialog (CTAs) ── */}
      <Dialog open={signUpOpen} onOpenChange={setSignUpOpen}>
        <DialogContent
          className="bg-transparent ring-0 shadow-none p-0 gap-0 sm:max-w-fit max-w-fit max-h-[90vh] overflow-y-auto"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Sign up for Dazzle</DialogTitle>
          <SignUp routing="hash" />
        </DialogContent>
      </Dialog>

      {/* ── Sign In Dialog (nav) ── */}
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
