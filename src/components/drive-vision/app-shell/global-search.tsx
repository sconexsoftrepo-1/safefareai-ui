"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Bell, CornerDownLeft, Search, Truck, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFleet } from "@/features/drive-vision/store/fleet-store";
import { ALARM_TYPES } from "@/features/drive-vision/mock-data/catalog";
import { matchesVehicleSearch } from "@/features/drive-vision/services/vehicle-service";
import { visibleSearchResults } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { ALL_NAV_ITEMS } from "../navigation/nav-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_ICON } from "./header-styles";
import { transitions } from "../shared/motion";
import { useReturnFocus } from "../shared/use-return-focus";

interface Result {
  id: string;
  group: "Pages" | "Vehicles" | "Drivers" | "Events";
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
}

/** Search control in the topbar icon pill (reference: magnifier button). Opens the palette; Ctrl/⌘ K also works. */
export function GlobalSearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onOpen} className={HEADER_ICON} aria-label="Search vehicles, drivers, events and pages" aria-keyshortcuts="Control+K">
          <Search className="size-[17px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={10}>
        Search <kbd className="ml-1 font-sans opacity-70">Ctrl K</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const vehicles = useFleet((s) => s.vehicles);
  const drivers = useFleet((s) => s.drivers);
  const alarms = useFleet((s) => s.alarms);
  const access = useAccess();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useReturnFocus(open);

  // Keyboard shortcut: Ctrl/⌘ + K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const pageMatches: Result[] = ALL_NAV_ITEMS.filter((p) => !q || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)).map((p) => ({
      id: p.href,
      group: "Pages",
      label: p.label,
      hint: p.description,
      href: p.href,
      icon: p.icon,
    }));
    if (!q) return visibleSearchResults(access, pageMatches, []).pages.slice(0, 6);
    const vs: Result[] = vehicles
      .filter((v) => matchesVehicleSearch(v, q))
      .slice(0, 6)
      .map((v) => ({ id: v.vehicleId, group: "Vehicles", label: `${v.vehicleName} · ${v.plate}`, hint: `Device ${v.terminalNo}`, href: `/drive-vision/vehicles/${v.vehicleId}`, icon: Truck }));
    const ds: Result[] = drivers
      .filter((d) => d.name.toLowerCase().includes(q) || d.licenceNo.toLowerCase().includes(q))
      .slice(0, 4)
      .map((d) => ({ id: d.driverId, group: "Drivers", label: d.name, hint: d.licenceNo, href: `/drive-vision/drivers?driver=${d.driverId}`, icon: UserRound }));
    const es: Result[] = alarms
      .filter((a) => a.alarmId.toLowerCase().includes(q) || ALARM_TYPES[a.alarmType].label.toLowerCase().includes(q))
      .slice(0, 4)
      .map((a) => ({ id: a.alarmId, group: "Events", label: ALARM_TYPES[a.alarmType].label, hint: `${a.alarmId} · ${a.address}`, href: `/drive-vision/alerts?alarm=${a.alarmId}`, icon: Bell }));
    // Record results come from the in-browser sample store, not a scoped API (see visibleSearchResults).
    const { pages, records } = visibleSearchResults(access, pageMatches, [...vs, ...ds, ...es]);
    return [...pages.slice(0, 4), ...records];
  }, [query, vehicles, drivers, alarms, access]);

  const activeIndex = Math.min(cursor, Math.max(0, results.length - 1));

  function go(result: Result | undefined) {
    if (!result) return;
    onOpenChange(false);
    setQuery("");
    router.push(result.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[activeIndex]);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.fast} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount onKeyDown={onKeyDown} onCloseAutoFocus={restoreFocus}>
              <motion.div
                className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[22px] border border-line bg-surface shadow-pop outline-none"
                initial={{ opacity: 0, scale: 0.97, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={transitions.base}
              >
                <DialogPrimitive.Title className="sr-only">Search SafeFare AI</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Search pages, vehicles, drivers and events. Use arrow keys and Enter.</DialogPrimitive.Description>
                <div className="flex items-center gap-3 border-b border-line px-5">
                  <Search className="size-4 text-ink-subtle" aria-hidden />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setCursor(0);
                    }}
                    placeholder="Search plate, device ID, driver, event ID…"
                    className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-subtle"
                    aria-label="Search query"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="dv-search-results"
                    aria-activedescendant={results[activeIndex] ? `dv-search-${activeIndex}` : undefined}
                  />
                  <kbd className="rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-muted">Esc</kbd>
                </div>
                <ul id="dv-search-results" ref={listRef} role="listbox" className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
                  {results.length === 0 ? <li className="px-3 py-10 text-center text-sm text-ink-muted">No matches for “{query}”.</li> : null}
                  {results.map((r, i) => {
                    const header = i === 0 || results[i - 1].group !== r.group ? r.group : null;
                    const Icon = r.icon;
                    return (
                      <li key={`${r.group}-${r.id}`} role="presentation">
                        {header ? <p className="px-3 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.12em] text-ink-subtle uppercase">{header}</p> : null}
                        <div
                          id={`dv-search-${i}`}
                          data-index={i}
                          role="option"
                          aria-selected={i === activeIndex}
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => go(r)}
                          className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5", i === activeIndex ? "bg-surface-muted" : "")}
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-deep">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium text-ink">{r.label}</span>
                            <span className="block truncate text-xs text-ink-muted">{r.hint}</span>
                          </span>
                          {i === activeIndex ? <CornerDownLeft className="size-3.5 text-ink-subtle" aria-hidden /> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
