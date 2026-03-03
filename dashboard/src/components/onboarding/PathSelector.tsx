import { Zap, BookOpen } from "lucide-react";

interface PathSelectorProps {
  onSelect: (path: "experienced" | "guided") => void;
}

export function PathSelector({ onSelect }: PathSelectorProps) {
  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        How would you like to get started?
      </h2>
      <p className="text-sm text-zinc-500 mb-10">
        Choose your path based on your experience level.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <button
          onClick={() => onSelect("experienced")}
          className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-left transition-all duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
        >
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
            <Zap className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">
            I've used MCP before
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Quick setup in 3 steps. Pick your framework, set up a stage, and connect.
          </p>
        </button>

        <button
          onClick={() => onSelect("guided")}
          className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-left transition-all duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
        >
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
            <BookOpen className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">
            I'm new to this
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Guided walkthrough in 5 steps. We'll explain everything along the way.
          </p>
        </button>
      </div>
    </div>
  );
}
