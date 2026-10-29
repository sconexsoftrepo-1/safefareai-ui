import type { DeviceStateDto } from "@/features/drive-vision/api/types";
import { CURRENT_REPORT_MS, STALE_REPORT_MS } from "../dashboard/live-dashboard-model";

/**
 * Display rules for live positions from GET /monitor/realtime. Report age is derived from
 * `deviceTime`; the undocumented `statusCode` is never used to colour or filter devices.
 */

export type ReportAge = "current" | "recent" | "stale" | "none";

export const REPORT_AGE_META: Record<ReportAge, { label: string; short: string; color: string }> = {
  current: { label: `Reported ≤ ${CURRENT_REPORT_MS / 60_000} min ago`, short: `≤ ${CURRENT_REPORT_MS / 60_000} min`, color: "var(--dv-success)" },
  recent: { label: `Reported ≤ ${STALE_REPORT_MS / 3_600_000} h ago`, short: `≤ ${STALE_REPORT_MS / 3_600_000} h`, color: "var(--dv-warning)" },
  stale: { label: `Last report over ${STALE_REPORT_MS / 3_600_000} h ago`, short: "Stale", color: "var(--dv-ink-subtle)" },
  none: { label: "No report time", short: "No time", color: "var(--dv-ink-subtle)" },
};

export function reportAge(state: DeviceStateDto, now: Date): ReportAge {
  const t = state.deviceTime ? new Date(state.deviceTime).getTime() : NaN;
  if (Number.isNaN(t)) return "none";
  const age = now.getTime() - t;
  return age <= CURRENT_REPORT_MS ? "current" : age <= STALE_REPORT_MS ? "recent" : "stale";
}

export type PositionCheck = { ok: true; lat: number; lon: number } | { ok: false; reason: string };

/**
 * A position is plotted only when both coordinates are finite numbers within WGS84 ranges.
 * Exactly (0, 0) is also excluded: it is the usual "no fix" placeholder and plotting it would put
 * the vehicle in the Gulf of Guinea.
 */
export function checkPosition(p: { lat?: number | null; lon?: number | null }): PositionCheck {
  const { lat, lon } = p;
  if (typeof lat !== "number" || typeof lon !== "number") return { ok: false, reason: "No coordinates reported" };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, reason: `Invalid coordinates (${lat}, ${lon})` };
  if (lat === 0 && lon === 0) return { ok: false, reason: "Coordinates 0, 0 (no fix)" };
  return { ok: true, lat, lon };
}

/** `sensors` is a free-form JsonNode: show flat primitive entries only, raw (units aren't documented). */
export function sensorEntries(sensors: unknown): [string, string][] {
  if (!sensors || typeof sensors !== "object" || Array.isArray(sensors)) return [];
  return Object.entries(sensors as Record<string, unknown>)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => [k, String(v)]);
}

const parsedPoll = Number(process.env.NEXT_PUBLIC_REALTIME_POLL_MS);
/**
 * Realtime polling interval (NEXT_PUBLIC_REALTIME_POLL_MS, default 30 s, minimum 10 s). The vendor
 * feed is polling-only and answers 503 when called too often, so the floor is deliberate.
 */
export const REALTIME_POLL_MS = Number.isFinite(parsedPoll) && parsedPoll > 0 ? Math.max(10_000, parsedPoll) : 30_000;
