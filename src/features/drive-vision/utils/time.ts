import type { DateRange, DateRangeKey } from "../types";

/** IST has no DST, so a fixed offset is exact for day bucketing. */
const IST_OFFSET_MS = 5.5 * 3_600_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function startOfFleetDay(date: Date) {
  const shifted = date.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY) * DAY - IST_OFFSET_MS);
}

export function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

export function resolveDateRange(key: DateRangeKey, now: Date): DateRange {
  const today = startOfFleetDay(now);
  switch (key) {
    case "today":
      return { key, from: today, to: now, label: "Today" };
    case "7d":
      return { key, from: addMs(today, -6 * DAY), to: now, label: "Last 7 days" };
    case "30d":
      return { key, from: addMs(today, -29 * DAY), to: now, label: "Last 30 days" };
  }
}

export const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

export function inRange(iso: string, from: Date, to: Date) {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

/** Time-of-day greeting in fleet time (IST). */
export function greeting(now: Date) {
  const hour = Math.floor(((now.getTime() + IST_OFFSET_MS) % DAY) / HOUR);
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
