import { motion } from "motion/react";
import { fadeInUp, springs, stagger } from "@/lib/motion";
import type { ReactNode } from "react";

interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  /** Stagger delay between children */
  delay?: number;
}

export function AnimatedList({
  children,
  className,
  delay = stagger.fast,
}: AnimatedListProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: delay,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedListItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeInUp}
      transition={springs.snappy}
    >
      {children}
    </motion.div>
  );
}
