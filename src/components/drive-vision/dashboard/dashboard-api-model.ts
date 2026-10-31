import type { StatusSlice, TrendDay } from "@/features/drive-vision/api/types";

/**
 * Mapping of the /dashboard/* aggregates onto Overview widgets. Pure: unit-tested.
 * Status codes and their meaning come from the server (`label`); colours are assigned by
 * position because the spec doesn't enumerate the statuses.
 */

const SLICE_COLORS = ["var(--dv-success)", "var(--dv-series-1)", "var(--dv-warning)", "var(--dv-ink-subtle)", "var(--dv-series-3)", "var(--dv-danger)", "var(--dv-series-4)"];

/** Known realtime statuses get the colour the rest of the app uses for them; unknown ones get the next free slot. */
const KNOWN_COLORS: Record<string, string> = { ONLINE: "var(--dv-success)", DRIVING: "var(--dv-success)", OFFLINE: "var(--dv-ink-subtle)", EXPIRED: "var(--dv-danger)" };

export interface SliceSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function statusSegments(slices: StatusSlice[] | undefined): SliceSegment[] {
  const used = new Set<string>();
  return (slices ?? [])
    .filter((s) => typeof s.count === "number" && s.count >= 0 && (s.status || s.label))
    .map((s, i) => {
      const key = s.status || s.label!;
      const known = KNOWN_COLORS[key.toUpperCase()];
      const color = known && !used.has(known) ? known : (SLICE_COLORS.find((c) => !used.has(c)) ?? SLICE_COLORS[i % SLICE_COLORS.length]);
      used.add(color);
      return { key, label: s.label || key, value: s.count!, color };
    });
}

export interface TrendRow {
  day: string;
  trips: number | null;
  distanceKm: number | null;
  alarms: number | null;
  severeAlarms: number | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Days in server order with missing values kept as null (shown "—", never as 0). Rows without a day are dropped. */
export function trendRows(days: TrendDay[] | undefined): TrendRow[] {
  return (days ?? [])
    .filter((d): d is TrendDay & { day: string } => typeof d.day === "string" && d.day !== "")
    .map((d) => ({ day: d.day, trips: num(d.trips), distanceKm: num(d.distanceKm), alarms: num(d.alarms), severeAlarms: num(d.severeAlarms) }));
}

/** Sum of a column, or null when no row has a value (so "no data" isn't shown as 0). */
export function sumColumn(rows: TrendRow[], key: "trips" | "distanceKm" | "alarms" | "severeAlarms"): number | null {
  const vals = rows.map((r) => r[key]).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** "3 PENDING · 2 ACCEPTED" from a status→count map, largest first. Empty string when nothing is counted. */
export function describeStatusCounts(map: Record<string, number> | undefined): string {
  return Object.entries(map ?? {})
    .filter(([, n]) => typeof n === "number" && n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");
}
