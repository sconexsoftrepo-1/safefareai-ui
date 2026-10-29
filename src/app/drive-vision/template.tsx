"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Page-content transition (reference recording: content fades in from a soft blur
 * with a small rise). Re-mounts on every route change inside SafeFare AI.
 * Reduced motion only changes the transition timing, so SSR markup is identical.
 */
export default function DriveVisionTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: reduce ? 0.01 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );
}
