import type { AlarmDto, AlarmListQuery, AlarmTypeDto } from "@/features/drive-vision/api/types";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { resolveDateRange } from "@/features/drive-vision/utils/time";

/**
 * URL state and pure derivations for the Alerts page (GET /alarms/ai, /alarms/routine).
 * The API filters by time window, alarm types and devices and pages the result; it has no
 * keyword, severity or handling-status filter and no sort, so the page offers none.
 */

export type AlarmKind = "ai" | "routine";
/** Spec default for both alarm lists (pageSize 1–100). */
export const ALARM_PAGE_SIZE = 20;

export interface AlertsView {
  kind: AlarmKind;
  range: DateRangeKey;
  deviceId: number | null;
  typeId: number | null;
  page: number;
  /** AlarmDto.id of the event open in the drawer. */
  alarmId: number | null;
}

const RANGES: readonly DateRangeKey[] = ["today", "7d", "30d"];
const positiveInt = (v: string | null) => (v && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** Reads the view from search params. Unknown or legacy params (status, severity, mock ids) are ignored. */
export function parseAlertsView(params: { get(name: string): string | null }): AlertsView {
  const range = params.get("range");
  return {
    kind: params.get("kind") === "routine" ? "routine" : "ai",
    range: RANGES.includes(range as DateRangeKey) ? (range as DateRangeKey) : "7d",
    deviceId: positiveInt(params.get("device")),
    typeId: positiveInt(params.get("type")),
    page: positiveInt(params.get("page")) ?? 1,
    alarmId: positiveInt(params.get("alarm")),
  };
}

/** Search string for a view; defaults are left out so plain /alerts stays plain. */
export function alertsSearch(view: AlertsView): string {
  const q = new URLSearchParams();
  if (view.kind !== "ai") q.set("kind", view.kind);
  if (view.range !== "7d") q.set("range", view.range);
  if (view.deviceId !== null) q.set("device", String(view.deviceId));
  if (view.typeId !== null) q.set("type", String(view.typeId));
  if (view.page > 1) q.set("page", String(view.page));
  if (view.alarmId !== null) q.set("alarm", String(view.alarmId));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The list request for a view. `now` is fixed per load so the key (and request) is stable. */
export function alarmQuery(view: AlertsView, now: Date): AlarmListQuery {
  const r = resolveDateRange(view.range, now);
  return {
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    alarmTypeIds: view.typeId !== null ? [view.typeId] : undefined,
    deviceIds: view.deviceId !== null ? [view.deviceId] : undefined,
    pageNumber: view.page,
    pageSize: ALARM_PAGE_SIZE,
  };
}

export function alarmLabel(a: AlarmDto, typeById?: Map<number | undefined, AlarmTypeDto>) {
  return a.alarmName || typeById?.get(a.alarmTypeId)?.label || (a.alarmTypeId !== undefined ? `Alarm type ${a.alarmTypeId}` : "Alarm");
}

export function deviceLabel(a: Pick<AlarmDto, "deviceName" | "terminalNo" | "deviceId">) {
  return a.deviceName || a.terminalNo || (a.deviceId !== undefined ? `Device ${a.deviceId}` : "Unknown device");
}

/** Usable coordinates, or null. 0,0 is a "no fix" placeholder, never a real alarm position here. */
export function alarmPosition(a: Pick<AlarmDto, "lat" | "lon">) {
  const { lat, lon } = a;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

/** Only http(s) media links are rendered; anything else (javascript:, data:, relative) is dropped. */
export function safeMediaUrl(url: string | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Alarm types offered in the filter, sorted by label. All types are listed on both tabs: the
 * spec doesn't say which `category` values are AI and which are routine.
 */
export function typeOptions(types: AlarmTypeDto[]) {
  return types
    .filter((t) => t.id !== undefined)
    .map((t) => ({ value: String(t.id), label: t.label || t.code || `Type ${t.id}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
