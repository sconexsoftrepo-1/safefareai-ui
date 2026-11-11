/**
 * Alerts & Events API (GET /api/v1/alerts) timestamps ONLY. That API sends IST wall-clock digits with a wrong "Z"
 * suffix ("2026-11-10T21:15:24Z" means 21:15:24 IST). Reading the Z as UTC adds 5 h 30 m a second time, so the
 * digits are re-read with an explicit +05:30 offset. Not for any other API: generic helpers are unchanged.
 */
import { formatRelative } from "./format";

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(?:Z|[+-]00:?00)?$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The real instant (epoch ms) of an Alerts API timestamp, read as IST; null when missing or invalid. */
export function alertIstInstant(v: string | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = WALL.exec(v.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const days = mo >= 1 && mo <= 12 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
  if (d < 1 || d > days || h > 23 || mi > 59 || s > 59) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${pad(s)}+05:30`);
  return Number.isNaN(t) ? null : t;
}

/** The corrected instant as ISO UTC (for <time dateTime>), or undefined when missing or invalid. */
export function alertIstIso(v: string | null | undefined): string | undefined {
  const t = alertIstInstant(v);
  return t === null ? undefined : new Date(t).toISOString();
}

/** "10 Nov 2026, 09:15:24 PM IST" (Asia/Kolkata), or "—" when missing or invalid. */
export function formatAlertIstTime(v: string | null | undefined): string {
  const t = alertIstInstant(v);
  if (t === null) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value])
  );
  const h = Number(p.hour);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${pad(h % 12 === 0 ? 12 : h % 12)}:${p.minute}:${p.second} ${h < 12 ? "AM" : "PM"} IST`;
}

/** "10 h ago" label (the app's usual wording, formatRelative) from the correctly read instant; "—" when invalid. */
export function alertIstRelative(v: string | null | undefined, now: Date = new Date()): string {
  const t = alertIstInstant(v);
  return t === null ? "—" : formatRelative(new Date(t), now);
}
