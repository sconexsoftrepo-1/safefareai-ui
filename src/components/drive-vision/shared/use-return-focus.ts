"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Focus restoration for dialogs opened from state rather than a Radix `Trigger`
 * (table rows, keyboard shortcuts, header buttons). Radix only knows how to return
 * focus to its own trigger, so without this focus falls back to <body> on close.
 *
 * The opener is captured in a layout effect — before Radix moves focus into the
 * dialog — and refocused from `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  return useCallback((event: Event) => {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
  }, []);
}
