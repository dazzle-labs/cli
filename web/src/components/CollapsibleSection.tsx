import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { springs } from "@/lib/motion";

export function CollapsibleSection({
  title,
  copyText,
  children,
  defaultOpen = false,
}: {
  title: string;
  copyText: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={springs.quick}
          >
            <ChevronDown className="h-4 w-4" />
          </motion.div>
          {title}
        </button>
        <CopyButton text={copyText} tooltip="Copy to clipboard" size="icon-xs" />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
