import type { Transition, Variants } from "motion/react";

// Spring presets
export const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 30 } as Transition,
  gentle: { type: "spring", stiffness: 200, damping: 25 } as Transition,
  bouncy: { type: "spring", stiffness: 500, damping: 15 } as Transition,
  quick: { type: "spring", stiffness: 600, damping: 35 } as Transition,
};

// Stagger configs (delay between children)
export const stagger = {
  fast: 0.03,
  medium: 0.06,
  slow: 0.1,
};

// Reusable variants
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
};

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};
