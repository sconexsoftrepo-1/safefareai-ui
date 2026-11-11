"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SensorsTab<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
  /** Small count shown after the label (e.g. active alerts); hidden when null/undefined. */
  badge?: number | null;
  badgeLabel?: string;
}

export const SENSORS_TABPANEL_ID = "sensors-tabpanel";
export const sensorsTabId = (value: string) => `sensors-tab-${value}`;

/**
 * The Sensors screen's main navigation: a WAI-ARIA tablist (arrow keys, Home/End, roving tabindex). The active tab is
 * coral with navy text (4.1:1, stronger than white's 3.0:1 on this coral); others take powder blue on hover.
 * Wraps on narrow screens, so every tab stays visible without horizontal scrolling.
 */
export function SensorsTabs<V extends string>({ tabs, value, onChange, label }: { tabs: SensorsTab<V>[]; value: V; onChange: (v: V) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number | "first" | "last") => {
    const next = delta === "first" ? 0 : delta === "last" ? tabs.length - 1 : (from + delta + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex flex-wrap gap-1 rounded-card border border-line bg-surface p-1.5 shadow-card">
      {tabs.map((t, i) => {
        const active = t.value === value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={sensorsTabId(t.value)}
            aria-selected={active}
            aria-controls={SENSORS_TABPANEL_ID}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? "first" : e.key === "End" ? "last" : null;
              if (delta === null) return;
              e.preventDefault();
              move(i, delta);
            }}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-control px-3.5 py-2 text-[14px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none",
              active ? "bg-brand text-ink shadow-brand-soft" : "text-ink-muted hover:bg-powder hover:text-ink"
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {t.label}
            {typeof t.badge === "number" ? (
              <span className={cn("rounded-full px-1.5 py-px text-[11px] font-bold tabular", active ? "bg-white/85 text-brand-deep" : "bg-brand-soft text-brand-deep")} aria-label={t.badgeLabel}>
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
