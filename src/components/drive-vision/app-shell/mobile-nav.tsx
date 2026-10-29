"use client";

import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark, DemoNotice, SidebarNav } from "./sidebar";
import { transitions } from "../shared/motion";
import { useReturnFocus } from "../shared/use-return-focus";

/** Drawer navigation for mobile widths (< md); the icon rail covers tablet and up. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const restoreFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-overlay md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.base} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount onCloseAutoFocus={restoreFocus}>
              <motion.div
                className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[300px] flex-col bg-surface shadow-pop outline-none md:hidden"
                initial={{ x: -40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -32, opacity: 0 }}
                transition={transitions.panel}
              >
                <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">SafeFare AI sections</DialogPrimitive.Description>
                <div className="flex items-center justify-between px-5 pt-5 pb-4">
                  <BrandMark />
                  <DialogPrimitive.Close asChild>
                    <Button variant="outline" size="icon-sm" className="rounded-full" aria-label="Close navigation">
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                  <SidebarNav layoutGroup="mobile-nav" onNavigate={() => onOpenChange(false)} />
                </div>
                <div className="p-3 pt-0">
                  <DemoNotice />
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
