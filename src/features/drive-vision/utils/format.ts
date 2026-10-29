/**
 * Formatters pin the locale and time zone so server and client render identical
 * strings (avoids hydration mismatches). The demo fleet operates in Hyderabad (IST).
 */
export const FLEET_TIME_ZONE = "Asia/Kolkata";
const LOCALE = "en-IN";

const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: FLEET_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: FLEET_TIME_ZONE, day: "2-digit", month: "short" });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: FLEET_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const timeSecFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: FLEET_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: FLEET_TIME_ZONE, weekday: "short" });
const numberFmt = new Intl.NumberFormat(LOCALE);
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: FLEET_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

const toDate = (value: string | Date) => (typeof value === "string" ? new Date(value) : value);

export const formatDate = (v: string | Date) => dateFmt.format(toDate(v));
export const formatShortDate = (v: string | Date) => shortDateFmt.format(toDate(v));
export const formatTime = (v: string | Date) => timeFmt.format(toDate(v));
export const formatTimeWithSeconds = (v: string | Date) => timeSecFmt.format(toDate(v));
export const formatDateTime = (v: string | Date) => `${shortDateFmt.format(toDate(v))}, ${timeFmt.format(toDate(v))}`;
export const formatWeekday = (v: string | Date) => weekdayFmt.format(toDate(v));
export const formatNumber = (n: number) => numberFmt.format(n);
/** YYYY-MM-DD in fleet time — stable day bucketing key. */
export const dayKey = (v: string | Date) => keyFmt.format(toDate(v));

export function formatDuration(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Relative time against a reference "now" (the demo snapshot time). */
export function formatRelative(value: string | Date, now: Date) {
  const diffMin = Math.round((now.getTime() - toDate(value).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function daysUntil(value: string | Date, now: Date) {
  return Math.ceil((toDate(value).getTime() - now.getTime()) / 86_400_000);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export const formatKm = (km: number) => `${numberFmt.format(Math.round(km * 10) / 10)} km`;
