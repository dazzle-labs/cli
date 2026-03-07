import { useState, useEffect, useRef } from "react";
import { SignIn } from "@clerk/react";
import { Eye, Share2, Plug, ArrowRight, X, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

const VALUE_PROPS = [
  {
    icon: Eye,
    title: "Watch your agent work",
    body: "See every action in real time on your private dashboard preview.",
  },
  {
    icon: Share2,
    title: "Stream it to the world",
    body: "Go live on Twitch, YouTube, or any RTMP destination when you're ready.",
  },
  {
    icon: Plug,
    title: "One line to connect",
    body: "Install the CLI, push content, and go live. Works with any agent framework.",
  },
];

const ECOSYSTEM = ["Claude Code", "OpenAI Agents SDK", "OpenClaw", "CrewAI", "LangGraph", "AutoGen"];

export function LandingPage() {
  const [showSignIn, setShowSignIn] = useState(false);
  const [entered, setEntered] = useState(false);
  const signInRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setEntered(true));
  }, []);

  useEffect(() => {
    if (showSignIn && signInRef.current) {
      signInRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [showSignIn]);

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
      {/* Google Font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* Atmospheric background — radial emerald glow from top center */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-[40%] left-1/2 -translate-x-1/2 w-[140%] aspect-square rounded-full opacity-[0.07]"
          style={{
            background:
              "radial-gradient(circle, oklch(0.72 0.19 163) 0%, transparent 60%)",
          }}
        />
        {/* Subtle noise overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Sticky nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 backdrop-blur-md bg-zinc-950/70 border-b border-white/[0.04]">
        <span
          className="text-[15px] font-semibold tracking-tight text-white"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          Dazzle
        </span>
        <Button
          size="sm"
          className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          style={{ fontFamily: "'Outfit', sans-serif" }}
          onClick={() => setShowSignIn(true)}
        >
          Sign In
        </Button>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center px-6 pt-28 pb-32 md:pt-40 md:pb-44 text-center">
        <div
          className="transition-all duration-[1200ms] ease-out"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? "translateY(0)" : "translateY(32px)",
          }}
        >
          <h1
            className="text-[clamp(2.5rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em] text-white max-w-4xl mx-auto"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Give your AI agent
            <br />
            <span className="text-emerald-400">a stage.</span>
          </h1>
        </div>

        <div
          className="transition-all duration-[1200ms] ease-out delay-200"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? "translateY(0)" : "translateY(24px)",
          }}
        >
          <p
            className="mt-7 text-lg md:text-xl text-zinc-400 max-w-xl mx-auto leading-relaxed"
            style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300 }}
          >
            Every agent deserves an audience. Dazzle gives yours a production
            stage — visible, streamable, controllable via CLI.
          </p>
        </div>

        <div
          className="transition-all duration-[1200ms] ease-out delay-[400ms]"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? "translateY(0)" : "translateY(20px)",
          }}
        >
          <div className="mt-10 flex gap-4">
            <Button
              size="lg"
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
              style={{ fontFamily: "'Outfit', sans-serif" }}
              onClick={() => setShowSignIn(true)}
            >
              Launch a stage
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Demo video placeholder */}
      <section className="relative z-10 px-6 pb-20 md:pb-28">
        <div className="mx-auto max-w-4xl">
          <div
            className="relative aspect-video rounded-2xl border border-white/[0.06] bg-zinc-900 flex flex-col items-center justify-center gap-4 overflow-hidden"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
              <Play className="h-7 w-7 ml-0.5" />
            </div>
            <p
              className="text-sm text-zinc-500"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              See an agent in action
            </p>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="relative z-10 px-6 pb-28 md:pb-36">
        <div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-3">
          {VALUE_PROPS.map((prop, i) => (
            <div
              key={prop.title}
              className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 transition-all duration-500 hover:border-emerald-500/20 hover:bg-emerald-500/[0.03]"
              style={{
                animationDelay: `${i * 120}ms`,
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
                <prop.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                {prop.title}
              </h3>
              <p className="text-sm leading-relaxed text-zinc-400 font-light">
                {prop.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Ecosystem strip */}
      <section className="relative z-10 px-6 pb-28 md:pb-36">
        <div className="mx-auto max-w-3xl text-center">
          <h3
            className="text-xl md:text-2xl text-white mb-3"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            One CLI. Every agent framework.
          </h3>
          <p
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-6"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            Works with your stack
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {ECOSYSTEM.map((name) => (
              <span
                key={name}
                className="rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-sm text-zinc-500"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-6 pb-32 md:pb-40 text-center">
        <h2
          className="text-[clamp(1.8rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-white max-w-2xl mx-auto"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Ready to give your agents{" "}
          <span className="text-emerald-400">a stage?</span>
        </h2>
        <p
          className="mt-4 text-zinc-500 text-sm"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          Free during beta.
        </p>
        <Button
          size="lg"
          className="mt-8 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
          style={{ fontFamily: "'Outfit', sans-serif" }}
          onClick={() => setShowSignIn(true)}
        >
          Sign In
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>

        {/* Inline Clerk sign-in */}
        {showSignIn && (
          <div ref={signInRef} className="mt-12 flex justify-center">
            <div className="relative">
              <button
                onClick={() => setShowSignIn(false)}
                className="absolute -top-3 -right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                aria-label="Close sign in"
              >
                <X className="h-4 w-4" />
              </button>
              <SignIn />
            </div>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8 text-center">
        <p
          className="text-xs text-zinc-600"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          stream.dazzle.fm &middot; &copy; 2026
        </p>
      </footer>
    </div>
  );
}
