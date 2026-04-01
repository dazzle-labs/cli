import { useState } from "react";
import { Link } from "react-router-dom";
import { SignIn } from "@clerk/react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLiveCount } from "@/hooks/use-live-count";

function LiveBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
      </span>
      <span className="text-emerald-400 text-xs">{count}</span>
    </span>
  );
}

/**
 * Shared public-facing nav with mobile hamburger menu.
 * Used by PublicLivePage, PublicDocs, and LegalShell.
 */
export function PublicNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const liveCount = useLiveCount();

  const openSignIn = () => setSignInOpen(true);

  return (
    <>
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-zinc-950/60 border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-6 py-4 md:px-10">
          <Link to="/" className="text-base font-semibold tracking-tight text-white font-display">
            Dazzle
          </Link>
          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-5">
            <Link to="/live" className="text-zinc-400 hover:text-white text-sm transition-colors inline-flex items-center gap-1.5">
              Live
              <LiveBadge count={liveCount} />
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
          {/* Mobile hamburger */}
          <button
            className="md:hidden text-zinc-400 hover:text-white transition-colors p-1 cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/[0.04] px-6 py-4 flex flex-col gap-4">
            <Link to="/live" className="text-zinc-400 hover:text-white text-sm transition-colors inline-flex items-center gap-1.5" onClick={() => setMobileMenuOpen(false)}>
              Live
              <LiveBadge count={liveCount} />
            </Link>
            <Link to="/docs" className="text-zinc-400 hover:text-white text-sm transition-colors" onClick={() => setMobileMenuOpen(false)}>
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
              className="border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 w-fit"
              onClick={() => { setMobileMenuOpen(false); openSignIn(); }}
            >
              Sign In
            </Button>
          </div>
        )}
      </nav>

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
    </>
  );
}
