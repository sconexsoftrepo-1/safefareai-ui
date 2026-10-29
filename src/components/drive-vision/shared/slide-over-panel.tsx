"use client";

import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { transitions } from "./motion";
import { useReturnFocus } from "./use-return-focus";

/**
 * Right-hand drawer (modal) with Framer Motion slide-in / slide-out.
 * Radix handles focus trapping, Escape and aria; motion handles the transition.
 */
export function SlideOverPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
  headerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg";
  headerExtra?: React.ReactNode;
}) {
  const restoreFocus = useReturnFocus(open);
  const widthClass = width === "sm" ? "sm:max-w-sm" : width === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.base}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount onCloseAutoFocus={restoreFocus}>
              <motion.div
                className={cn(
                  "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-pop outline-none sm:inset-y-3 sm:right-3 sm:rounded-[26px] sm:border sm:border-line/60",
                  widthClass
                )}
                initial={{ x: 48, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 40, opacity: 0 }}
                transition={transitions.panel}
              >
                <div className="flex items-start justify-between gap-3 border-b border-line/70 px-6 py-5">
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="truncate text-lg font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description className="mt-0.5 text-[13px] text-ink-muted">{description}</DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description className="sr-only">Details panel</DialogPrimitive.Description>
                    )}
                    {headerExtra ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{headerExtra}</div> : null}
                  </div>
                  <DialogPrimitive.Close asChild>
                    <Button variant="outline" size="icon-sm" className="rounded-full" aria-label="Close panel">
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface-muted/60 px-6 py-4 sm:rounded-b-[26px]">{footer}</div> : null}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** Label/value row used inside detail panels. */
export function DetailRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2 text-[13px]", className)}>
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
