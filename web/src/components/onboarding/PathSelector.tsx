import { Zap, BookOpen } from "lucide-react";
import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";

interface PathSelectorProps {
  onSelect: (path: "experienced" | "guided") => void;
}

export function PathSelector({ onSelect }: PathSelectorProps) {
  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display">
        How would you like to get started?
      </h2>
      <p className="text-sm text-muted-foreground mb-10">
        Choose your path based on your experience level.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <button
          onClick={() => onSelect("experienced")}
          className="group rounded-xl border border-border bg-card p-6 text-left transition-all duration-300 hover:border-primary/20 hover:bg-primary/[0.02] cursor-pointer"
        >
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
            <Zap className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">
            I've used Dazzle before
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Quick setup in 3 steps. Pick your framework, set up a stage, and connect.
          </p>
        </button>

        <button
          onClick={() => onSelect("guided")}
          className="group rounded-xl border border-border bg-card p-6 text-left transition-all duration-300 hover:border-primary/20 hover:bg-primary/[0.02] cursor-pointer"
        >
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
            <BookOpen className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">
            I'm new to this
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Guided walkthrough with explanations along the way.
          </p>
        </button>
      </div>

      <div className="w-full max-w-lg mt-4">
        <CopyAgentPromptButton variant="full" />
      </div>
    </div>
  );
}
