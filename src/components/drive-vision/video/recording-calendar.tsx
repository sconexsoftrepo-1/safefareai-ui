"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Month calendar marking days that have recordings (mirrors vendor 4.6
 * /video/monthlyCalendar, which returns a comma list of recorded days).
 */
export function RecordingCalendar({
  selectedKey,
  onSelect,
  recordedKeys,
  todayKey,
  month,
  onMonthChange,
  footer,
}: {
  selectedKey: string; // YYYY-MM-DD
  onSelect: (key: string) => void;
  recordedKeys: Set<string>;
  todayKey: string;
  /** Controlled month (YYYY-MM) — for callers that load recorded days one month at a time. */
  month?: string;
  onMonthChange?: (month: string) => void;
  /** Replaces the "N days with recordings" line (e.g. loading or error text). */
  footer?: React.ReactNode;
}) {
  const [year0, month0] = (month ?? selectedKey).split("-").map(Number);
  const [own, setOwn] = useState({ y: year0, m: month0 }); // m is 1-based
  const cursor = month ? { y: year0, m: month0 } : own;
  const setCursor = (next: (c: { y: number; m: number }) => { y: number; m: number }) => {
    const n = next(cursor);
    if (onMonthChange) onMonthChange(`${n.y}-${String(n.m).padStart(2, "0")}`);
    else setOwn(n);
  };
  const first = new Date(Date.UTC(cursor.y, cursor.m - 1, 1));
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: offset + daysInMonth }, (_, i) => (i < offset ? null : i - offset + 1));
  const key = (d: number) => `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const recordedThisMonth = cells.filter((d) => d && recordedKeys.has(key(d))).length;

  function shift(delta: number) {
    setCursor((c) => {
      const m = c.m + delta;
      if (m < 1) return { y: c.y - 1, m: 12 };
      if (m > 12) return { y: c.y + 1, m: 1 };
      return { y: c.y, m };
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-lg hover:bg-surface-muted" aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-[13px] font-semibold" aria-live="polite">
          {MONTHS[cursor.m - 1]} {cursor.y}
        </p>
        <button type="button" onClick={() => shift(1)} className="grid size-7 place-items-center rounded-lg hover:bg-surface-muted" aria-label="Next month" disabled={`${cursor.y}-${String(cursor.m).padStart(2, "0")}` >= todayKey.slice(0, 7)}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Recording calendar">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1 text-[10px] font-semibold text-ink-subtle uppercase" role="columnheader">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e-${i}`} />;
          const k = key(d);
          const has = recordedKeys.has(k);
          const sel = k === selectedKey;
          const future = k > todayKey;
          return (
            <button
              key={k}
              type="button"
              disabled={!has || future}
              onClick={() => onSelect(k)}
              aria-pressed={sel}
              aria-label={`${d} ${MONTHS[cursor.m - 1]}${has ? ", recordings available" : ", no recordings"}`}
              className={cn(
                "relative grid aspect-square place-items-center rounded-lg text-xs tabular transition-colors",
                sel ? "bg-ink font-semibold text-white" : has ? "font-medium text-ink hover:bg-brand-tint" : "text-ink-subtle/70",
                k === todayKey && !sel && "ring-1 ring-ink/30"
              )}
            >
              {d}
              {has && !sel ? <span className="absolute bottom-1 size-1 rounded-full bg-brand" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-ink-muted">
        {footer ?? (
          <>
            <span className="mr-1 inline-block size-1.5 rounded-full bg-brand align-middle" aria-hidden /> {recordedThisMonth} day{recordedThisMonth === 1 ? "" : "s"} with recordings
          </>
        )}
      </div>
    </div>
  );
}
