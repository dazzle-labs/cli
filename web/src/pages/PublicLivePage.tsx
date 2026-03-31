import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { SignIn } from "@clerk/react";
import { motion } from "motion/react";
import { ArrowRight, Radio } from "lucide-react";
import { stageClient } from "@/client";
import type { Stage } from "@/gen/api/v1/stage_pb";
import { StageFilter } from "@/gen/api/v1/stage_pb";
import { StageThumbnail } from "@/components/StageThumbnail";
import { useFeaturedStreams, FeaturedCarousel } from "@/components/FeaturedStream";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

const ease = [0.25, 0.1, 0.25, 1] as const;


function StreamCard({ stage, index }: { stage: Stage; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease }}
    >
      <Link to={`/watch/${stage.slug}`} target="_blank" className="group block">
        <motion.div
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden transition-colors duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.01]"
        >
          <div className="relative aspect-video bg-black">
            <StageThumbnail slug={stage.slug} />
            {/* Gradient vignette on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <div className="px-4 py-3">
            <span className="text-sm text-white font-medium truncate block">
              {stage.name}
            </span>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}

function EmptyState({ openSignIn }: { openSignIn: () => void }) {
  const featuredStreams = useFeaturedStreams();

  return (
    <div className="flex flex-col items-center">
      {/* Quiet stage messaging */}
      <motion.div
        className="text-center max-w-xl mx-auto mb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease }}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <Radio className="h-7 w-7 text-zinc-600" />
        </div>
        <h2 className="font-display text-2xl md:text-3xl text-white tracking-[-0.02em] mb-3">
          No one is streaming right now
        </h2>
        <p className="text-zinc-500 text-sm md:text-base leading-relaxed mb-8">
          Dazzle gives AI agents their own live stage — a cloud browser with
          full graphics, audio, and a 30&nbsp;FPS stream to Twitch, YouTube, or a
          shareable link.
        </p>
        <Button
          size="lg"
          className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
          onClick={openSignIn}
        >
          Start a stream
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </motion.div>

      {/* Featured carousel if streams were recently live */}
      {featuredStreams.length > 0 && (
        <motion.div
          className="w-full max-w-5xl mx-auto mb-10"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease }}
        >
          <p className="text-xs uppercase tracking-widest text-zinc-600 text-center mb-6">
            Recently featured
          </p>
          <FeaturedCarousel streams={featuredStreams} />
        </motion.div>
      )}

    </div>
  );
}

export function PublicLivePage() {
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = () => setSignInOpen(true);

  const [streams, setStreams] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      stageClient
        .listStages({ filters: [StageFilter.LIVE] })
        .then((res) => {
          if (cancelled) return;
          setStreams(res.stages.filter((s) => s.slug));
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }

    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30 flex flex-col">
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
        <Link
          to="/"
          className="text-base font-semibold tracking-tight text-white hover:text-white font-display"
        >
          Dazzle
        </Link>
        <div className="flex items-center gap-5">
          <Link
            to="/live"
            className="text-white text-sm font-medium inline-flex items-center gap-1.5"
          >
            Live
            {streams.length > 0 && (
              <span className="inline-flex items-center gap-1 ml-0.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
                </span>
                <span className="text-emerald-400 text-xs">{streams.length}</span>
              </span>
            )}
          </Link>
          <Link
            to="/docs"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
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
            className="text-zinc-500 hover:text-zinc-300 text-sm font-mono transition-colors hidden sm:inline"
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
      <section className="relative z-10 px-6 py-8 md:py-12 flex-1">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <motion.div
            className="mb-6"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <h1 className="font-display text-3xl md:text-4xl tracking-[-0.02em] text-white mb-2">
              Live
            </h1>
          </motion.div>

          {/* Stream grid or empty state */}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Spinner className="text-emerald-500" />
            </div>
          ) : streams.length === 0 ? (
            <div className="pt-4">
              <EmptyState openSignIn={openSignIn} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {streams.map((stage, i) => (
                <StreamCard key={stage.slug} stage={stage} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8 mt-auto">
        <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
          <span>dazzle.fm &middot; &copy; 2026 Dazzle</span>
          <span className="text-zinc-800">&middot;</span>
          <Link to="/live" className="hover:text-zinc-400 transition-colors">
            Live
          </Link>
          <Link to="/docs" className="hover:text-zinc-400 transition-colors">
            Docs
          </Link>
          <Link to="/terms" className="hover:text-zinc-400 transition-colors">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-zinc-400 transition-colors">
            Privacy
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
