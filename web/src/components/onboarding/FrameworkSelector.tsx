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
      <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display">
        Choose your tool
      </h2>
      <p className="text-sm text-muted-foreground mb-8">
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
                ? "border-primary/30 bg-primary/[0.06]"
                : "border-border bg-card hover:border-border/80 hover:bg-muted"
            )}
          >
            <p className="text-sm font-medium text-foreground mb-0.5">{fw.name}</p>
            <p className="text-xs text-muted-foreground">{fw.language}</p>
            {verbose && (
              <p className="text-xs text-muted-foreground mt-1">{fw.description}</p>
            )}
          </button>
        ))}
      </div>

      <Button
        disabled={!selected}
        onClick={onNext}
        className="font-semibold disabled:opacity-30"
      >
        Continue
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
