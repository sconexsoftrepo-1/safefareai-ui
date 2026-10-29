"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertDialog as AlertPrimitive } from "radix-ui";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { transitions } from "./motion";
import { useReturnFocus } from "./use-return-focus";

/**
 * Confirmation modal (fade + scale). `onConfirm` may be async — the button shows a
 * spinner and the dialog closes when it settles.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void | Promise<void>;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const restoreFocus = useReturnFocus(open);

  async function handleConfirm(event: React.MouseEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertPrimitive.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AnimatePresence>
        {open ? (
          <AlertPrimitive.Portal forceMount>
            <AlertPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.fast} />
            </AlertPrimitive.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
              <AlertPrimitive.Content asChild forceMount onCloseAutoFocus={restoreFocus}>
                <motion.div
                  className="pointer-events-auto w-full max-w-md rounded-[26px] border border-line/60 bg-surface p-6 shadow-pop outline-none"
                  initial={{ opacity: 0, scale: 0.96, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 4 }}
                  transition={transitions.base}
                >
                  <div className="flex gap-4">
                    <div className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-brand-tint text-brand-deep")}>
                      <TriangleAlert className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <AlertPrimitive.Title className="text-base font-semibold text-ink">{title}</AlertPrimitive.Title>
                      <AlertPrimitive.Description asChild>
                        <div className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</div>
                      </AlertPrimitive.Description>
                      {children ? <div className="mt-3">{children}</div> : null}
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-2">
                    <AlertPrimitive.Cancel asChild>
                      <Button variant="outline" disabled={busy}>
                        Cancel
                      </Button>
                    </AlertPrimitive.Cancel>
                    <AlertPrimitive.Action asChild>
                      <Button variant={tone === "danger" ? "destructive" : "default"} onClick={handleConfirm} disabled={busy || confirmDisabled}>
                        {busy ? <Loader2 className="animate-spin" /> : null}
                        {confirmLabel}
                      </Button>
                    </AlertPrimitive.Action>
                  </div>
                </motion.div>
              </AlertPrimitive.Content>
            </div>
          </AlertPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </AlertPrimitive.Root>
  );
}
