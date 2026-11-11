/**
 * Trips API (GET /trips, /trips/{id}, /trips/{id}/route) startTime / endTime ONLY. That API sends IST wall-clock
 * digits with a wrong "Z" suffix ("2026-11-11T10:32:20Z" means 10:32:20 IST). Reading the Z as UTC adds 5 h 30 m a
 * second time, so the digits are read as IST and the original string is never passed to `new Date()`.
 *
 * Accepted suffixes: none, "Z", "+00:00" (all read as IST, the API's known mislabel) and "+05:30" (already correct,
 * same digits). Any other offset is not this API's format and reads as invalid ("—"). Generic helpers are unchanged;
 * request parameters (from / to) keep their own conversion.
 */
import { formatRelative } from "./format";

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(Z|[+-]00:?00|\+05:?30)?$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** IST wall-clock parts of a Trips API timestamp, validated as a real date and time; null when missing or invalid. */
export interface TripWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function tripWallClock(v: string | null | undefined): TripWallClock | null {
  if (typeof v !== "string") return null;
  const m = WALL.exec(v.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const days = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

/** The real instant (epoch ms) of a Trips API timestamp, read as IST (UTC+05:30, no DST); null when invalid. */
export function tripIstInstant(v: string | null | undefined): number | null {
  const w = tripWallClock(v);
  if (!w) return null;
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - 330 * 60_000;
}

/** The corrected instant as ISO UTC (for <time dateTime>), or undefined when invalid. */
export function tripIstIso(v: string | null | undefined): string | undefined {
  const t = tripIstInstant(v);
  return t === null ? undefined : new Date(t).toISOString();
}

const clock = (w: TripWallClock, seconds: boolean) =>
  `${pad(w.hour % 12 === 0 ? 12 : w.hour % 12)}:${pad(w.minute)}${seconds ? `:${pad(w.second)}` : ""} ${w.hour < 12 ? "AM" : "PM"}`;

/** "11 Nov, 10:32 AM" — the Trips screen's compact form (date and time in IST; no seconds, as before). "—" when invalid. */
export function formatTripTime(v: string | null | undefined): string {
  const w = tripWallClock(v);
  return w ? `${pad(w.day)} ${MONTHS[w.month - 1]}, ${clock(w, false)}` : "—";
}

/** "11 Nov 2026, 10:32:20 AM IST" — full form for tooltips. "—" when invalid. */
export function formatTripTimeFull(v: string | null | undefined): string {
  const w = tripWallClock(v);
  return w ? `${pad(w.day)} ${MONTHS[w.month - 1]} ${w.year}, ${clock(w, true)} IST` : "—";
}

/** "10 h ago" (the app's usual wording) from the correctly read instant; "—" when invalid. */
export function tripIstRelative(v: string | null | undefined, now: Date = new Date()): string {
  const t = tripIstInstant(v);
  return t === null ? "—" : formatRelative(new Date(t), now);
}

