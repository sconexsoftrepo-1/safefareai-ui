"use client";

import { createContext, useContext } from "react";

/**
 * Shell-level UI state shared between the header, rail, page content and the
 * assistant. `askAssistant` opens Iris and sends a question (used by contextual
 * "Ask Iris about it" buttons).
 */
export interface ShellState {
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  askAssistant: (question: string) => void;
  /** Question queued by askAssistant, consumed by the assistant once open. */
  pendingQuestion: string | null;
  clearPendingQuestion: () => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside DriveVisionAppShell");
  return ctx;
}
