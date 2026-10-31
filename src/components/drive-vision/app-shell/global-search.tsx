"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Bell, CornerDownLeft, FileSearch, Loader2, Route, Search, Truck, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { assistantService } from "@/features/drive-vision/api/assistant-service";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { canUseFeature, visibleSearchResults } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { ALL_NAV_ITEMS } from "../navigation/nav-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HEADER_ICON } from "./header-styles";
import { transitions } from "../shared/motion";
import { useReturnFocus } from "../shared/use-return-focus";
import { flattenSearch, groupLabel } from "./search-model";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const RESULT_LIMIT = 8;

function iconFor(group: string, type?: string): LucideIcon {
  const k = `${type ?? ""} ${group}`.toLowerCase();
  if (/device|vehicle/.test(k)) return Truck;
  if (/driver/.test(k)) return UserRound;
  if (/alert|alarm/.test(k)) return Bell;
  if (/dispatch|trip/.test(k)) return Route;
  return FileSearch;
}

interface Result {
  id: string;
  /** "Pages", or a group label from GET /search. */
  group: string;
  label: string;
  hint: string;
  /** null: the server returned a result type this app has no screen for — listed, not linked. */
  href: string | null;
  icon: LucideIcon;
}

/** Search control in the topbar icon pill (reference: magnifier button). Opens the palette; Ctrl/⌘ K also works. */
export function GlobalSearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onOpen} className={HEADER_ICON} aria-label="Search pages and fleet records" aria-keyshortcuts="Control+K">
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
  const access = useAccess();
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const searchRecords = canUseFeature(access, "recordSearch");
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

  // Debounced server search (GET /search). Short queries search pages only.
  useEffect(() => {
    const next = query.trim();
    const timer = setTimeout(() => setTerm(next.length >= MIN_QUERY ? next : ""), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const searchQ = useApiQuery(open && searchRecords && term ? `search:${term}` : null, () => assistantService.search(term, RESULT_LIMIT));
  const pending = searchRecords && query.trim().length >= MIN_QUERY && (query.trim() !== term || searchQ.loading);

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
    const pagesOnly = visibleSearchResults(access, pageMatches, []).pages;
    if (!q) return pagesOnly.slice(0, 6);
    const hits = term && term.toLowerCase() === q ? flattenSearch(searchQ.data) : [];
    const records: Result[] = hits.map(({ group, hit, href }, i) => ({
      id: `${group}-${hit.id ?? i}`,
      group: groupLabel(group),
      label: hit.title!,
      hint: [hit.subtitle, hit.time ? new Date(hit.time).toLocaleString() : null].filter(Boolean).join(" · "),
      href,
      icon: iconFor(group, hit.type),
    }));
    // Linked hits must open a screen this user can open; unlinked ones are shown only with the recordSearch grant.
    const linked = visibleSearchResults(access, [], records).records;
    const unlinked = searchRecords ? records.filter((r) => r.href === null) : [];
    const shown = new Set([...linked, ...unlinked]);
    return [...pagesOnly.slice(0, 4), ...records.filter((r) => shown.has(r))];
  }, [query, term, searchQ.data, access, searchRecords]);

  const activeIndex = Math.min(cursor, Math.max(0, results.length - 1));

  function go(result: Result | undefined) {
    if (!result?.href) return;
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
                <DialogPrimitive.Description className="sr-only">Search pages and the records the server returns. Use arrow keys and Enter.</DialogPrimitive.Description>
                <div className="flex items-center gap-3 border-b border-line px-5">
                  <Search className="size-4 text-ink-subtle" aria-hidden />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setCursor(0);
                    }}
                    placeholder="Search pages and fleet records…"
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
                  {results.length === 0 && !pending && !searchQ.error ? <li className="px-3 py-10 text-center text-sm text-ink-muted">No matches for “{query}”.</li> : null}
                  {pending ? (
                    <li className="flex items-center gap-2 px-3 py-2 text-xs text-ink-muted" role="status">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching records…
                    </li>
                  ) : null}
                  {searchQ.error && term ? (
                    <li className="px-3 py-2 text-xs text-danger" role="alert">
                      Record search failed: {describeApiError(searchQ.error)}
                    </li>
                  ) : null}
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
                          aria-disabled={r.href === null || undefined}
                          onMouseEnter={() => setCursor(i)}
                          onClick={() => go(r)}
                          title={r.href === null ? "No page for this result type" : undefined}
                          className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", r.href ? "cursor-pointer" : "cursor-default opacity-70", i === activeIndex ? "bg-surface-muted" : "")}
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-deep">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium text-ink">{r.label}</span>
                            <span className="block truncate text-xs text-ink-muted">{r.hint}</span>
                          </span>
                          {i === activeIndex && r.href ? <CornerDownLeft className="size-3.5 text-ink-subtle" aria-hidden /> : null}
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
