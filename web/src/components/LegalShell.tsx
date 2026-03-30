import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SignIn } from "@clerk/react";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const ease = [0.25, 0.1, 0.25, 1] as const;

export function LegalShell({ children }: { children: React.ReactNode }) {
  const [signInOpen, setSignInOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="dark">
      <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
        {/* Ambient background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="landing-orb landing-orb-1 !opacity-50" />
          <div className="landing-orb landing-orb-2 !opacity-50" />
        </div>

        {/* Nav */}
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
              className="text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Live
            </Link>
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
              onClick={() => setSignInOpen(true)}
            >
              Sign In
            </Button>
          </div>
        </nav>

        {/* Content */}
        <motion.div
          className="relative z-10 mx-auto max-w-3xl px-6 py-16 md:py-24"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-8 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="legal-content">{children}</div>
        </motion.div>

        {/* Footer */}
        <footer className="relative z-10 border-t border-white/[0.04] py-8">
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
          </div>
        </footer>

        {/* Sign In Dialog */}
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
