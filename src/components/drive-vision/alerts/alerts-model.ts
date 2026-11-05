import type { AlarmDto, AlarmListQuery, AlarmTypeDto, AlertListQuery } from "@/features/drive-vision/api/types";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { resolveDateRange } from "@/features/drive-vision/utils/time";

/**
 * URL state and pure derivations for the Alerts page. Every tab is live on GET /alerts (database, polled). The AI and
 * Routine tabs also have a History view on the vendor-first GET /alarms/ai and /alarms/routine, which is never polled.
 */

export type AlarmKind = "ai" | "routine";
/** Page tab: one of the alarm feeds, or the handled-alert list. */
export type AlertsTab = AlarmKind | "incidents";
/** Spec default for both alarm lists (pageSize 1–100). */
export const ALARM_PAGE_SIZE = 20;

export interface AlertsView {
  kind: AlertsTab;
  range: DateRangeKey;
  deviceId: number | null;
  typeId: number | null;
  page: number;
  /** AlarmDto.id of the event open in the drawer. */
  alarmId: number | null;
  /** The vendor-first history of the AI or Routine tab, instead of the live list. */
  history: boolean;
}

/** GET /alerts `kind`, per tab. */
export type AlertKindParam = "AI" | "ROUTINE";
export const ALERT_KIND: Record<AlarmKind, AlertKindParam> = { ai: "AI", routine: "ROUTINE" };

const SEVERITY_LABELS: Record<number, string> = { 1: "Severe", 2: "Moderate", 3: "General", 4: "Notice" };
export const severityLabel = (severity: number) => SEVERITY_LABELS[severity] ?? `Level ${severity}`;

const RANGES: readonly DateRangeKey[] = ["today", "7d", "30d"];
const positiveInt = (v: string | null) => (v && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** Reads the view from search params. Unknown or legacy params (status, severity, mock ids) are ignored. */
export function parseAlertsView(params: { get(name: string): string | null }): AlertsView {
  const range = params.get("range");
  const kind = params.get("kind") === "routine" ? "routine" : params.get("kind") === "incidents" ? "incidents" : "ai";
  return {
    kind,
    range: RANGES.includes(range as DateRangeKey) ? (range as DateRangeKey) : "7d",
    deviceId: positiveInt(params.get("device")),
    typeId: positiveInt(params.get("type")),
    page: positiveInt(params.get("page")) ?? 1,
    alarmId: positiveInt(params.get("alarm")),
    history: kind !== "incidents" && params.get("source") === "history",
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
  if (view.history && view.kind !== "incidents") q.set("source", "history");
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

/**
 * The GET /alerts request for a view, built afresh for every poll. `to` is never sent: the server's default is now, and
 * a fixed value would hide every alert newer than it. The default range sends no `from` either: it is the server's
 * own default of the last 7 days.
 */
export function incidentQuery(view: AlertsView, now: Date, opts: { openOnly: boolean; keyword: string; kind?: AlertKindParam }): AlertListQuery {
  return {
    kind: opts.kind,
    from: view.range === "7d" ? undefined : resolveDateRange(view.range, now).from.toISOString(),
    alarmTypeIds: view.typeId !== null ? [view.typeId] : undefined,
    deviceIds: view.deviceId !== null ? [view.deviceId] : undefined,
    openOnly: opts.openOnly || undefined,
    keyword: opts.keyword.trim() || undefined,
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
