import type { Transition } from "motion/react";

/** Shared motion vocabulary — short, restrained, no bounce. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const transitions = {
  fast: { duration: 0.16, ease: EASE_OUT } satisfies Transition,
  base: { duration: 0.22, ease: EASE_OUT } satisfies Transition,
  panel: { duration: 0.26, ease: EASE_OUT } satisfies Transition,
  layout: { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } satisfies Transition,
};

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};
