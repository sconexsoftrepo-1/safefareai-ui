"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/features/drive-vision/hooks/use-preferences";
import { DriveVisionRail } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { DriveVisionTopbar } from "./topbar";
import { PageIntro } from "./page-intro";
import { isWorkspaceRoute } from "../navigation/nav-config";
import { GlobalSearch } from "./global-search";
import { ShellContext, type ShellState } from "./shell-context";
import { ToastProvider } from "../shared/toast-provider";
import { DriveVisionAIAssistant } from "../assistant/ai-assistant";
import { RouteGuard } from "../auth/route-guard";
import { canUseFeature } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";

/**
 * Root chrome for every /drive-vision route (Vertix-style reference): floating pill
 * topbar, floating split icon rail (expandable), large page intro, and Iris docked on
 * the right on wide screens — the page reflows beside it instead of being covered.
 */
export function DriveVisionAppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const prefs = usePreferences();
  // Iris answers from the in-browser sample fleet, so it's a granted feature rather than a default.
  const assistantAllowed = canUseFeature(useAccess(), "assistant");
  // Map/video workspaces fill the viewport on desktop (Iris opens from the header there), so no launcher clearance.
  const workspace = isWorkspaceRoute(usePathname());
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const expanded = prefs.sidebarExpanded;
  const docked = assistantOpen && prefs.assistantEnabled && assistantAllowed;

  const shell = useMemo<ShellState>(
    () => ({
      assistantOpen,
      setAssistantOpen,
      askAssistant: (q: string) => {
        setPendingQuestion(q);
        setAssistantOpen(true);
      },
      pendingQuestion,
      clearPendingQuestion: () => setPendingQuestion(null),
    }),
    [assistantOpen, pendingQuestion]
  );

  return (
    <ShellContext.Provider value={shell}>
      <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          <a href="#dv-main" className="sr-only z-[60] rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
            Skip to content
          </a>
          <div className="min-h-dvh bg-canvas">
            <DriveVisionRail />
            <MobileNav open={navOpen} onOpenChange={setNavOpen} />
            <div className={cn("min-w-0 transition-[padding] duration-[260ms] ease-dv", docked && "xl:pr-[404px]")}>
              <DriveVisionTopbar onOpenNav={() => setNavOpen(true)} onOpenSearch={openSearch} />
              <main
                id="dv-main"
                className={cn(
                  "min-w-0 px-4 pt-1 pb-28 transition-[padding] duration-[260ms] ease-dv lg:pr-5",
                  workspace && "lg:pb-5",
                  expanded ? "md:pl-[260px] lg:pl-[268px]" : "md:pl-[88px] lg:pl-[96px]"
                )}
              >
                <div className="@container mx-auto w-full max-w-[1680px] min-w-0">
                  <RouteGuard>
                    <PageIntro />
                    {children}
                  </RouteGuard>
                </div>
              </main>
            </div>
          </div>
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
          {prefs.assistantEnabled && assistantAllowed ? <DriveVisionAIAssistant /> : null}
          <ToastProvider />
        </TooltipProvider>
      </MotionConfig>
    </ShellContext.Provider>
  );
}
