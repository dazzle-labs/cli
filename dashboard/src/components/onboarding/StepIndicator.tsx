import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  steps: string[];
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                i < current
                  ? "bg-emerald-500 text-zinc-950"
                  : i === current
                    ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                    : "bg-white/[0.04] text-zinc-600"
              )}
            >
              {i < current ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                "text-xs font-medium transition-colors duration-300 hidden sm:inline",
                i === current ? "text-zinc-300" : "text-zinc-600"
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "w-8 h-px transition-colors duration-300",
                i < current ? "bg-emerald-500/40" : "bg-white/[0.06]"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
