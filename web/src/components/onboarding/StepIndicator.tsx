import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

interface StepIndicatorProps {
  steps: string[];
  current: number;
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ steps, current, onStepClick }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                  i < current
                    ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/80"
                    : i === current
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                )}
                onClick={i < current && onStepClick ? () => onStepClick(i) : undefined}
                role={i < current && onStepClick ? "button" : undefined}
              >
                {i < current ? (
                  <motion.svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={springs.snappy}
                  >
                    <motion.path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  </motion.svg>
                ) : (
                  i + 1
                )}
              </div>
              {/* Emerald glow on current step */}
              {i === current && (
                <motion.div
                  className="absolute inset-0 rounded-full ring-2 ring-primary/30"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={springs.gentle}
                />
              )}
            </div>
            <span
              className={cn(
                "text-sm font-medium transition-colors duration-300 hidden sm:inline",
                i === current ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "w-8 h-px transition-colors duration-300",
                i < current ? "bg-primary/40" : "bg-border"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
