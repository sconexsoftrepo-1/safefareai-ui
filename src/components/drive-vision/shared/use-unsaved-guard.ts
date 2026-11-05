"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setUnsavedChanges } from "@/features/drive-vision/store/unsaved-changes";
import { holdHistory, type HistoryWindow } from "./history-guard";

type HeldNavigation = { href: string } | { delta: number };

/**
 * Holds navigation while `dirty`, so the screen can ask before unsaved work is lost. The App Router has no
 * navigation-blocking API, so this works at the DOM level:
 * - reload / close: the browser's own prompt (beforeunload);
 * - in-app links: a capture-phase click listener stops the click before next/link sees it;
 * - browser Back and Forward: see holdHistory (a gate installed ahead of the router). Nothing stays behind once the
 *   work is saved or discarded.
 * `blocked` is true while a navigation waits for `stay()` or `leave()`.
 */
export function useUnsavedGuard(dirty: boolean, message: string) {
  const router = useRouter();
  const [held, setHeld] = useState<HeldNavigation | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    leaving.current = false;
    setUnsavedChanges(message);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return; // a full page load: beforeunload covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setHeld({ href: `${url.pathname}${url.search}${url.hash}` });
    };

    const release = holdHistory(window as unknown as HistoryWindow, (delta) => setHeld({ delta }), () => leaving.current);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      release();
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      setUnsavedChanges(null);
    };
  }, [dirty, message]);

  return {
    blocked: held !== null,
    stay: () => setHeld(null),
    leave: () => {
      const next = held;
      leaving.current = true;
      setHeld(null);
      setUnsavedChanges(null);
      if (next && "delta" in next) window.history.go(next.delta);
      else if (next) router.push(next.href);
    },
  };
}
