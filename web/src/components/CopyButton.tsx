import { useState, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  tooltip?: string;
  className?: string;
  size?: "icon" | "icon-xs" | "sm";
  iconSize?: string;
}

export function CopyButton({
  text,
  tooltip = "Copy to clipboard",
  className,
  size = "icon",
  iconSize = "h-3.5 w-3.5",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  async function handleCopy() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          onClick={handleCopy}
          className={cn("text-muted-foreground hover:text-primary shrink-0", className)}
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="check"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={springs.quick}
              >
                <Check className={iconSize} />
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={springs.quick}
              >
                <Copy className={iconSize} />
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : tooltip}</TooltipContent>
    </Tooltip>
  );
}
