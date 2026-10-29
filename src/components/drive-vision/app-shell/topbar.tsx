"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Menu, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/features/drive-vision/hooks/use-preferences";
import { canUseFeature } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { findNavGroup } from "../navigation/nav-config";
import { useNavGroups } from "../navigation/use-nav";
import { BrandMark } from "./sidebar";
import { GlobalSearchTrigger } from "./global-search";
import { NotificationCenter } from "./notification-center";
import { UserProfileMenu } from "./user-profile-menu";
import { useShell } from "./shell-context";
import { HEADER_CONTROL, HEADER_ICON, HEADER_PILL } from "./header-styles";
import { transitions } from "../shared/motion";

/**
 * Section switcher (reference: centred pill nav with a black active pill). Each section
 * opens its first page; the rail below lists every page.
 */
function SectionNav() {
  const pathname = usePathname();
  const current = findNavGroup(pathname);
  const groups = useNavGroups();
  if (groups.length === 0) return null;
  return (
    <nav aria-label="Sections" className={cn(HEADER_PILL, "hidden gap-0.5 px-1.5 @min-[960px]:flex")}>
      {groups.map((group) => {
        const active = current?.label === group.label;
        return (
          <Link
            key={group.label}
            href={group.items[0].href}
            aria-current={active ? "true" : undefined}
            className={cn(
              "relative rounded-full px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none @min-[1180px]:px-4",
              active ? "text-white" : "text-ink-muted hover:text-ink"
            )}
          >
            {active ? <motion.span layoutId="section-active" className="absolute inset-0 rounded-full bg-ink" transition={transitions.layout} aria-hidden /> : null}
            <span className="relative">{group.short ?? group.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Floating topbar (reference layout): brand pill, section pill nav, an icon pill
 * (search · Iris · notifications) and the profile pill. The page title lives in the
 * content area below (see PageIntro), so the bar stays slim.
 */
export function DriveVisionTopbar({ onOpenNav, onOpenSearch }: { onOpenNav: () => void; onOpenSearch: () => void }) {
  const prefs = usePreferences();
  const { assistantOpen, setAssistantOpen } = useShell();
  const assistantAllowed = canUseFeature(useAccess(), "assistant");

  return (
    <header className="sticky top-0 z-40 bg-canvas/80 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/65">
      <div className="@container flex h-[72px] items-center gap-2.5 px-4 lg:px-5">
        <button type="button" className={cn(HEADER_CONTROL, "md:hidden")} onClick={onOpenNav} aria-label="Open navigation">
          <Menu className="size-[18px]" />
        </button>
        <div className={cn(HEADER_PILL, "hidden pr-4 pl-1.5 md:flex")}>
          <BrandMark />
        </div>
        {/* Mobile: full lockup when there is room; glyph only on very narrow phones. */}
        <span className="md:hidden">
          <BrandMark wordClassName="max-[379px]:hidden" />
        </span>

        <div className="flex min-w-0 flex-1 justify-center">
          <SectionNav />
        </div>

        <div className={cn(HEADER_PILL, "gap-0.5 px-1.5")}>
          <GlobalSearchTrigger onOpen={onOpenSearch} />
          {prefs.assistantEnabled && assistantAllowed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(!assistantOpen)}
                  aria-pressed={assistantOpen}
                  aria-label="Toggle Iris assistant"
                  className={cn(HEADER_ICON, "hidden sm:grid", assistantOpen && "bg-ink text-white hover:bg-ink")}
                >
                  <Sparkles className="size-[17px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent sideOffset={10}>{assistantOpen ? "Close Iris" : "Ask Iris"}</TooltipContent>
            </Tooltip>
          ) : null}
          <NotificationCenter />
        </div>
        <div className="hidden md:block">
          <UserProfileMenu variant="pill" />
        </div>
        <div className="md:hidden">
          <UserProfileMenu />
        </div>
      </div>
    </header>
  );
}
