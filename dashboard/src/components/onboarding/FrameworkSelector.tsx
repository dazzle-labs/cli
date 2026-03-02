import { cn } from "@/lib/utils";
import { FRAMEWORKS, type Framework } from "./frameworks";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface FrameworkSelectorProps {
  selected: Framework | null;
  onSelect: (fw: Framework) => void;
  onNext: () => void;
  verbose?: boolean;
}

export function FrameworkSelector({ selected, onSelect, onNext, verbose }: FrameworkSelectorProps) {
  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Choose your tool
      </h2>
      <p className="text-sm text-zinc-500 mb-8">
        {verbose
          ? "Select the agent framework you'll use to connect. We'll generate the right config for you."
          : "Which framework is your agent built with?"}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-lg mb-8">
        {FRAMEWORKS.map((fw) => (
          <button
            key={fw.id}
            onClick={() => onSelect(fw)}
            className={cn(
              "rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer",
              selected?.id === fw.id
                ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
            )}
          >
            <p className="text-sm font-medium text-white mb-0.5">{fw.name}</p>
            <p className="text-xs text-zinc-500">{fw.language}</p>
            {verbose && (
              <p className="text-xs text-zinc-600 mt-1">{fw.description}</p>
            )}
          </button>
        ))}
      </div>

      <Button
        disabled={!selected}
        onClick={onNext}
        className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold disabled:opacity-30"
      >
        Continue
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
