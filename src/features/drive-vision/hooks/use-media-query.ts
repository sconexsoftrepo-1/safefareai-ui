"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query. Server snapshot is `false` (mobile-first, no hydration drift). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
