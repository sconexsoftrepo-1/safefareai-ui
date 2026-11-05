import { useSyncExternalStore } from "react";

/**
 * Whether a screen holds unsaved work, for shell controls that would discard it without navigating (the tenant
 * switcher, Sign out). Holds the message to show, or null. Link and browser navigation are guarded by useUnsavedGuard.
 */
let message: string | null = null;
const listeners = new Set<() => void>();

export function setUnsavedChanges(next: string | null) {
  if (next === message) return;
  message = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnsavedChanges(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => message,
    () => null
  );
}
