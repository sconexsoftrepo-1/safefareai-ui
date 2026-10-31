"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen, ScanEye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { updatePreferences, usePreferences } from "@/features/drive-vision/hooks/use-preferences";
import { type NavItem } from "../navigation/nav-config";
import { useNavGroups } from "../navigation/use-nav";
import { activeNavHref } from "@/features/drive-vision/access/access-policy";
import { EASE_OUT, transitions } from "../shared/motion";

export const RAIL_COMPACT = 56;
export const RAIL_EXPANDED = 228;

/** Coral brand disc (reference: round mark) with the SafeFare AI eye glyph. */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-white shadow-brand", className)} aria-hidden>
      <ScanEye className="size-[18px]" strokeWidth={2.1} />
    </span>
  );
}

export function BrandMark({ compact = false, wordClassName }: { compact?: boolean; wordClassName?: string }) {
  return (
    <Link
      href="/drive-vision/overview"
      className="flex items-center gap-2.5 rounded-full focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none"
      aria-label="SafeFare AI home"
    >
      <BrandGlyph />
      {!compact ? (
        <span className={cn("min-w-0 leading-tight", wordClassName)}>
          {/* Text lockup: "SafeFare" in ink, "AI" picked out in the brand coral (reads as one name). */}
          <span className="block text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-ink">
            SafeFare <span className="text-brand-deep">AI</span>
          </span>
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Alerts badge: hidden. It used to count open alarms in the sample data. The API has no
 * unread/open-alarm count, and alarm `total` or `handlingStatus` "NEW" doesn't mean "needs
 * attention" by any documented contract, so nothing is shown until the backend provides one.
 * The badge rendering below stays wired for that endpoint.
 */
function useAlertBadge() {
  return 0;
}

/** Labelled navigation list — used by the mobile drawer. */
export function SidebarNav({ onNavigate, layoutGroup }: { onNavigate?: () => void; layoutGroup: string }) {
  const pathname = usePathname();
  const alertBadge = useAlertBadge();
  const groups = useNavGroups();
  const activeHref = activeNavHref(groups.flatMap((g) => g.items.map((i) => i.href)), pathname);

  return (
    <nav aria-label="SafeFare AI" className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[10.5px] font-semibold tracking-[0.12em] text-ink-subtle uppercase">{group.label}</p>
          <ul className="space-y-px">
            {group.items.map((item) => {
              const isActive = activeHref === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex h-10 items-center gap-3 rounded-full px-3.5 text-[13.5px] font-medium transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none",
                      isActive ? "text-white" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                    )}
                  >
                    {isActive ? <motion.span layoutId={`${layoutGroup}-active`} className="absolute inset-0 rounded-full bg-ink" transition={transitions.layout} aria-hidden /> : null}
                    <item.icon className="relative size-[18px] shrink-0" aria-hidden />
                    <span className="relative truncate">{item.label}</span>
                    {item.label === "Alerts & Events" && alertBadge > 0 ? (
                      <span className={cn("relative ml-auto rounded-full px-1.5 py-px text-[11px] font-semibold tabular", isActive ? "bg-white/20 text-white" : "bg-brand-soft text-brand-deep")} aria-label={`${alertBadge} open alerts`}>
                        {alertBadge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Icon-only tooltip wrapper for rail controls (hover and keyboard focus). */
function RailTooltip({ label, enabled, children }: { label: string; enabled: boolean; children: React.ReactElement }) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={12}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// Height tiers (see `short` / `shorter` variants in globals.css) keep all 12 destinations
// visible without an inner scrollbar on 1280×720 / 1366×768 screens.
const RAIL_ITEM =
  "relative flex h-9 shrink-0 items-center rounded-full transition-[background-color,color] duration-150 ease-dv active:scale-[0.96] focus-visible:ring-[3px] focus-visible:ring-brand/40 focus-visible:outline-none short:h-8 shorter:h-7";
const RAIL_ICON_ONLY = "mx-auto w-9 justify-center short:w-8 shorter:w-7";

function RailLink({ item, active, expanded, badge }: { item: NavItem; active: boolean; expanded: boolean; badge?: number }) {
  return (
    <RailTooltip label={item.label} enabled={!expanded}>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={expanded ? undefined : badge ? `${item.label}, ${badge} open` : item.label}
        className={cn(RAIL_ITEM, expanded ? "gap-3 px-2.5" : RAIL_ICON_ONLY, active ? "text-white" : "text-ink-muted hover:bg-surface-sunken hover:text-ink")}
      >
        {active ? <motion.span layoutId="rail-active" className="absolute inset-0 rounded-full bg-ink" transition={transitions.layout} aria-hidden /> : null}
        <item.icon className="relative size-[17px] shrink-0" strokeWidth={1.9} aria-hidden />
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.span
              key="label"
              className="relative truncate text-[13px] font-medium whitespace-nowrap"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0, transition: { delay: 0.08, duration: 0.16 } }}
              exit={{ opacity: 0, transition: { duration: 0.06 } }}
            >
              {item.label}
            </motion.span>
          ) : null}
        </AnimatePresence>
        {badge ? (
          expanded ? (
            <span className={cn("relative ml-auto rounded-full px-1.5 py-px text-[11px] font-semibold tabular", active ? "bg-white/20 text-white" : "bg-brand-soft text-brand-deep")} aria-hidden>
              {badge}
            </span>
          ) : (
            <span className="absolute -top-1 -right-1 grid min-w-[17px] place-items-center rounded-full border-2 border-surface bg-brand px-1 text-[9.5px] leading-[13px] font-bold text-white tabular" aria-hidden>
              {badge}
            </span>
          )
        ) : null}
      </Link>
    </RailTooltip>
  );
}

/**
 * Floating navigation rail (reference: separate white pills under the brand mark).
 * - Main pill: every destination, grouped by hairline separators (or small group labels
 *   when expanded on tall screens). items step down 36 → 32 → 28px on
 *   shorter viewports, so a real 1366×768 / 1280×720 browser window (≈620–680px tall) never
 *   shows an inner scrollbar. Below ~540px the pill scrolls (visible thin bar) rather than clipping.
 * - Utility pill: expand/collapse and help.
 * Hidden below `md` — the drawer takes over.
 */
export function DriveVisionRail() {
  const pathname = usePathname();
  const badge = useAlertBadge();
  const { sidebarExpanded: expanded } = usePreferences();
  const groups = useNavGroups();
  const activeHref = activeNavHref(groups.flatMap((g) => g.items.map((i) => i.href)), pathname);

  return (
    <motion.aside
      aria-label="Main navigation"
      className="fixed top-[84px] bottom-4 left-4 z-30 hidden flex-col gap-3 md:flex lg:left-5 shorter:top-20 shorter:gap-2"
      initial={false}
      animate={{ width: expanded ? RAIL_EXPANDED : RAIL_COMPACT }}
      transition={{ duration: 0.26, ease: EASE_OUT }}
      style={{ width: RAIL_COMPACT }}
    >
      <nav
        aria-label="SafeFare AI"
        className="scrollbar-thin min-h-0 shrink overflow-x-hidden overflow-y-auto rounded-[28px] border border-line/60 bg-surface p-2.5 shadow-card shorter:py-2"
      >
        <ul className="flex flex-col gap-0.5 shorter:gap-0">
          {groups.map((group, gi) => (
            <Fragment key={group.label}>
              {gi > 0 ? (
                <li aria-hidden className={cn("shrink-0", expanded ? "px-2.5 py-1 short:py-0.5 tall:pt-2" : "py-1 short:py-0.5")}>
                  {expanded ? (
                    <>
                      <span className="hidden truncate text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap text-ink-subtle uppercase tall:block">{group.label}</span>
                      <span className="mx-1 block h-px bg-line tall:hidden" />
                    </>
                  ) : (
                    <span className="mx-auto block h-px w-4 bg-line" />
                  )}
                </li>
              ) : null}
              {group.items.map((item) => (
                <li key={item.href}>
                  <RailLink item={item} active={activeHref === item.href} expanded={expanded} badge={item.label === "Alerts & Events" && badge > 0 ? badge : undefined} />
                </li>
              ))}
            </Fragment>
          ))}
        </ul>
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5 rounded-[28px] border border-line/60 bg-surface p-2.5 shadow-card shorter:py-2">
        <RailTooltip label="Expand navigation" enabled={!expanded}>
          <button
            type="button"
            onClick={() => updatePreferences({ sidebarExpanded: !expanded })}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
            className={cn(RAIL_ITEM, "text-ink-muted hover:bg-surface-sunken hover:text-ink", expanded ? "gap-3 px-2.5" : RAIL_ICON_ONLY)}
          >
            {expanded ? <PanelLeftClose className="size-[17px] shrink-0" aria-hidden /> : <PanelLeftOpen className="size-[17px] shrink-0" aria-hidden />}
            {expanded ? <span className="text-[13px] font-medium whitespace-nowrap">Collapse</span> : null}
          </button>
        </RailTooltip>
      </div>
    </motion.aside>
  );
}
