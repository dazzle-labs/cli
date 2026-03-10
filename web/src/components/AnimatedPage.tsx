import { motion } from "motion/react";
import { pageTransition, springs } from "@/lib/motion";
import type { ReactNode } from "react";

export function AnimatedPage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      variants={pageTransition}
      initial="hidden"
      animate="visible"
      transition={springs.gentle}
    >
      {children}
    </motion.div>
  );
}
