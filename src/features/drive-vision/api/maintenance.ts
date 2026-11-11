/**
 * Vehicle Maintenance and Tyre Maintenance: the Python service's contracts as the frontend reads them. Pure, no
 * React: shared by the browser service (maintenance-service.ts, which calls the Python API directly) and the tests.
 *
 * Field names are the backend's own (snake_case), exactly as documented in the integration brief of 2026-11-10.
 * Parsers never invent values: a field with the wrong type reads as null, and a body that isn't the documented
 * shape is a parse failure (shown as an error), never an empty record.
 */

// ── Small readers ────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Vehicle number rule shared with Sensor Alerts and the Python path allowlist. */
const VEHICLE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/;
export function cleanMaintenanceVehicleNumber(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return VEHICLE_NUMBER.test(t) && !/^(alerts|undefined|null)$/i.test(t) ? t : null;
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" that is a real calendar date. */
export function isPlainDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** An ISO 8601 date-time with an explicit zone (Z or ±hh:mm), as the tyre write bodies document. */
export function isZonedDateTime(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && isPlainDate(v.slice(0, 10)) && !Number.isNaN(Date.parse(v));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A plain date ("2026-12-10") as "10 Dec 2026", from its own digits. It never goes through Date / a time zone, so it
 * can't shift by a day. Anything else is returned as sent.
 */
export function formatPlainDate(v: string | null | undefined): string {
  if (!v) return "—";
  if (!isPlainDate(v)) return v;
  const [y, m, d] = v.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Whether a timestamp names its zone (Z or ±hh:mm). The tyre service sends some without one. */
export const hasZone = (v: string) => /(Z|[+-]\d{2}:?\d{2})$/i.test(v);

/**
 * A server timestamp for display. With a zone: the user's locale and zone (`zoned`). Without one (the tyre
 * service's "2026-11-09T22:36:42.315000"): its own digits as sent, with no conversion, because the zone isn't
 * documented (`zoned: false`, so the UI can say "time as sent").
 */
export function readServerTimestamp(v: string | null | undefined): { text: string; zoned: boolean; iso?: string } | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  if (hasZone(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? { text: v, zoned: false } : { text: "", zoned: true, iso: new Date(t).toISOString() };
  }
  if (!m || !isPlainDate(`${m[1]}-${m[2]}-${m[3]}`)) return { text: v, zoned: false };
  return { text: `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`, zoned: false };
}

/**
 * Sort key for newest-first ordering. Zoned values are exact instants; unzoned values are compared by their own
 * digits (read as if UTC), so two unzoned values from the same service order correctly. Missing → -Infinity.
 */
export function timestampSortKey(v: string | null | undefined): number {
  if (!v) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(hasZone(v) ? v : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

// ── Vehicle Maintenance ──────────────────────────────────────────────────────

export interface ReminderScheduleItem {
  type: string;
  days_before: number | null;
  label: string | null;
  /** Plain date. */
  date: string | null;
}

/** GET /api/vehicle-maintenance/{vehicle_number} → data. Every date field except the timestamps is a plain date. */
export interface VehicleMaintenanceSchedule {
  tenant_id: number | null;
  vehicle_number: string;
  device_id: number | null;
  driver_id: number | null;
  driver_name: string | null;
  previous_vehicle_maintenance_date: string | null;
  /** Days, set by the backend (default 30). */
  maintenance_time_window: number | null;
  expected_vehicle_maintenance_date: string | null;
  postponed_date: string | null;
  postponed_reason: string | null;
  /** Null in the only sample; its type when set isn't documented. */
  postponed_by: number | string | null;
  postponed_at: string | null;
  due_date: string | null;
  done_date: string | null;
  status: string | null;
  reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Server-calculated; never recomputed in the frontend. */
  days_until_due: number | null;
  reminder_schedule: ReminderScheduleItem[];
}

export interface VehicleMaintenanceEnvelope<T> {
  success: boolean;
  message: string | null;
  data: T;
}

function readReminder(v: unknown): ReminderScheduleItem | null {
  if (!isObj(v) || !str(v.type)) return null;
  return { type: v.type as string, days_before: num(v.days_before), label: str(v.label), date: str(v.date) };
}

export function readSchedule(v: unknown): VehicleMaintenanceSchedule | null {
  if (!isObj(v)) return null;
  const vehicle = str(v.vehicle_number);
  if (!vehicle) return null;
  const postponedBy = v.postponed_by;
  return {
    tenant_id: int(v.tenant_id),
    vehicle_number: vehicle,
    device_id: int(v.device_id),
    driver_id: int(v.driver_id),
    driver_name: str(v.driver_name),
    previous_vehicle_maintenance_date: str(v.previous_vehicle_maintenance_date),
    maintenance_time_window: num(v.maintenance_time_window),
    expected_vehicle_maintenance_date: str(v.expected_vehicle_maintenance_date),
    postponed_date: str(v.postponed_date),
    postponed_reason: str(v.postponed_reason),
    postponed_by: typeof postponedBy === "number" || (typeof postponedBy === "string" && postponedBy.trim()) ? (postponedBy as number | string) : null,
    postponed_at: str(v.postponed_at),
    due_date: str(v.due_date),
    done_date: str(v.done_date),
    status: str(v.status),
    reason: str(v.reason),
    created_at: str(v.created_at),
    updated_at: str(v.updated_at),
    days_until_due: num(v.days_until_due),
    reminder_schedule: Array.isArray(v.reminder_schedule) ? v.reminder_schedule.map(readReminder).filter((r): r is ReminderScheduleItem => r !== null) : [],
  };
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: "shape" | "unsuccessful"; message?: string };

/** `{success, message, data}` with `success: true`. `success: false` is "unsuccessful" (with the server's message). */
function readEnvelope(raw: unknown): Parsed<{ message: string | null; data: unknown }> {
  if (!isObj(raw) || typeof raw.success !== "boolean") return { ok: false, reason: "shape" };
  if (!raw.success) return { ok: false, reason: "unsuccessful", message: str(raw.message) ?? undefined };
  return { ok: true, value: { message: str(raw.message), data: raw.data } };
}

export function parseScheduleResponse(raw: unknown): Parsed<VehicleMaintenanceEnvelope<VehicleMaintenanceSchedule>> {
  const env = readEnvelope(raw);
  if (!env.ok) return env;
  const data = readSchedule(env.value.data);
  return data ? { ok: true, value: { success: true, message: env.value.message, data } } : { ok: false, reason: "shape" };
}

/**
 * GET /api/vehicle-maintenance (list). No sample response was supplied, so only two shapes are accepted:
 * `data` is the array, or `data.items` is. Pagination fields are kept only when the server sends them as numbers
 * (`total`, `page`, `page_size`, `total_pages`, from `data` or the top level); nothing is assumed about the rest.
 */
export interface ScheduleList {
  items: VehicleMaintenanceSchedule[];
  pagination: Partial<Record<"total" | "page" | "page_size" | "total_pages", number>>;
}

export function parseScheduleList(raw: unknown): Parsed<ScheduleList> {
  const env = readEnvelope(raw);
  if (!env.ok) return env;
  const data = env.value.data;
  const rows = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.items) ? data.items : null;
  if (!rows) return { ok: false, reason: "shape" };
  const pagination: ScheduleList["pagination"] = {};
  for (const k of ["total", "page", "page_size", "total_pages"] as const) {
    const v = (isObj(data) ? int(data[k]) : null) ?? (isObj(raw) ? int(raw[k]) : null);
    if (v !== null) pagination[k] = v;
  }
  return { ok: true, value: { items: rows.map(readSchedule).filter((s): s is VehicleMaintenanceSchedule => s !== null), pagination } };
}

/**
 * GET /api/vehicle-maintenance/alerts?vehicle_number= — "the latest three alerts" for one vehicle (Swagger), as
 * sampled on 2026-11-11:
 *
 *   { success, message, data: { vehicle_number, driver_id, driver_name, items: [alert…], total_alerts } }
 *
 * An alert has no id of its own; the UI keys it by vehicle number, kind and its three dates (vehicleAlertKey).
 */
export interface VehicleMaintenanceAlert {
  /** The item's own vehicle_number; the enclosing data.vehicle_number is the fallback (see fromVehicleAlert). */
  vehicle_number: string | null;
  /** "overdue" in the sample; other values are kept as sent and shown humanised. */
  kind: string | null;
  title: string | null;
  /** The backend's message, shown unchanged. */
  message: string | null;
  /** Plain date "YYYY-MM-DD". */
  due_date: string | null;
  /** Plain date "YYYY-MM-DD". */
  alert_date: string | null;
  /** Timestamp without a zone ("2026-11-11T04:15:59"): shown as sent, never converted. */
  created_at: string | null;
}

/** `data` of the alerts response. */
export interface VehicleAlertsData {
  vehicle_number: string | null;
  driver_id: number | null;
  driver_name: string | null;
  items: VehicleMaintenanceAlert[];
  /** data.total_alerts as sent; items.length when the server omits it. */
  total_alerts: number;
}

export type VehicleAlertsResponse = VehicleMaintenanceEnvelope<VehicleAlertsData>;

function readVehicleAlert(v: unknown): VehicleMaintenanceAlert | null {
  if (!isObj(v)) return null;
  return {
    vehicle_number: str(v.vehicle_number),
    kind: str(v.kind),
    title: str(v.title),
    message: str(v.message),
    due_date: str(v.due_date),
    alert_date: str(v.alert_date),
    created_at: str(v.created_at),
  };
}

/** The documented envelope with `data.items` (an empty array is "no alerts"). Any other shape is a parse failure. */
export function parseVehicleAlerts(raw: unknown): Parsed<VehicleAlertsData> {
  const env = readEnvelope(raw);
  if (!env.ok) return env;
  const d = env.value.data;
  if (!isObj(d) || !Array.isArray(d.items)) return { ok: false, reason: "shape" };
  const items = d.items.map(readVehicleAlert).filter((a): a is VehicleMaintenanceAlert => a !== null);
  const total = int(d.total_alerts);
  return {
    ok: true,
    value: {
      vehicle_number: str(d.vehicle_number),
      driver_id: int(d.driver_id),
      driver_name: str(d.driver_name),
      items,
      total_alerts: total !== null && total >= 0 ? total : items.length,
    },
  };
}

/** POST /api/vehicle-maintenance. The server calculates the expected date and the interval: never sent. */
export interface CreateScheduleRequest {
  vehicle_number: string;
  /** Plain date. */
  previous_vehicle_maintenance_date: string;
  reason?: string;
}

export const REASON_MAX = 500;

/** The documented create body, or null. Unknown fields (an expected date, an interval…) are dropped. */
export function readCreateSchedule(raw: unknown): CreateScheduleRequest | null {
  if (!isObj(raw)) return null;
  const vehicle = cleanMaintenanceVehicleNumber(raw.vehicle_number);
  if (!vehicle || !isPlainDate(raw.previous_vehicle_maintenance_date)) return null;
  const out: CreateScheduleRequest = { vehicle_number: vehicle, previous_vehicle_maintenance_date: raw.previous_vehicle_maintenance_date };
  if (raw.reason !== undefined && raw.reason !== null) {
    if (typeof raw.reason !== "string" || raw.reason.length > REASON_MAX) return null;
    if (raw.reason.trim()) out.reason = raw.reason.trim();
  }
  return out;
}

/** List filters the proxy forwards (documented query parameters only). */
export interface ScheduleListQuery {
  vehicle_number?: string;
  device_id?: number;
  status?: string;
  expected_date_from?: string;
  expected_date_to?: string;
  page?: number;
  page_size?: number;
}

/** Validated list query, or null when a present parameter is invalid. Unknown parameters are dropped. */
export function readScheduleListQuery(search: URLSearchParams): ScheduleListQuery | null {
  const q: ScheduleListQuery = {};
  const get = (k: string) => search.get(k);
  if (get("vehicle_number") !== null) {
    const v = cleanMaintenanceVehicleNumber(get("vehicle_number"));
    if (!v) return null;
    q.vehicle_number = v;
  }
  for (const k of ["device_id", "page", "page_size"] as const) {
    const raw = get(k);
    if (raw === null) continue;
    if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) return null;
    q[k] = Number(raw);
  }
  if (q.page_size !== undefined && q.page_size > 100) return null;
  if (get("status") !== null) {
    const s = get("status")!;
    if (!/^[A-Za-z_]{1,32}$/.test(s)) return null;
    q.status = s;
  }
  for (const k of ["expected_date_from", "expected_date_to"] as const) {
    const raw = get(k);
    if (raw === null) continue;
    if (!isPlainDate(raw)) return null;
    q[k] = raw;
  }
  return q;
}

export function toSearch(q: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── Tyre Maintenance ─────────────────────────────────────────────────────────

/** GET /api/v1/tyre-maintenance/vehicle/{vehicle_number}. */
export interface TyreMaintenanceRecord {
  tenant_id: number | null;
  device_id: number | null;
  vehicle_number: string;
  tyre_life_limit_km: number | null;
  tyre_change_odometer_km: number | null;
  current_distance_km: number | null;
  usage_percentage: number | null;
  remaining_km: number | null;
  maintenance_status: string | null;
  /** Unzoned timestamp as sent ("2026-11-09T22:36:42.315000"). */
  last_tyre_change_date: string | null;
  last_limit_reminder_at: string | null;
}

export function readTyreRecord(v: unknown): TyreMaintenanceRecord | null {
  if (!isObj(v)) return null;
  const vehicle = str(v.vehicle_number);
  if (!vehicle) return null;
  return {
    tenant_id: int(v.tenant_id),
    device_id: int(v.device_id),
    vehicle_number: vehicle,
    tyre_life_limit_km: num(v.tyre_life_limit_km),
    tyre_change_odometer_km: num(v.tyre_change_odometer_km),
    current_distance_km: num(v.current_distance_km),
    usage_percentage: num(v.usage_percentage),
    remaining_km: num(v.remaining_km),
    maintenance_status: str(v.maintenance_status),
    last_tyre_change_date: str(v.last_tyre_change_date),
    last_limit_reminder_at: str(v.last_limit_reminder_at),
  };
}

export const parseTyreRecord = (raw: unknown): Parsed<TyreMaintenanceRecord> => {
  const r = readTyreRecord(raw);
  return r ? { ok: true, value: r } : { ok: false, reason: "shape" };
};

/** GET /api/v1/tyre-maintenance (all records). Not sampled: a bare array or `{items}` is accepted. */
export function parseTyreList(raw: unknown): Parsed<TyreMaintenanceRecord[]> {
  const rows = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.items) ? raw.items : null;
  if (!rows) return { ok: false, reason: "shape" };
  return { ok: true, value: rows.map(readTyreRecord).filter((r): r is TyreMaintenanceRecord => r !== null) };
}

/** One item of GET /api/v1/tyre-maintenance/alerts. */
export interface TyreMaintenanceAlert {
  id: number | null;
  tenant_id: number | null;
  device_id: number | null;
  vehicle_number: string;
  alert_level: number | null;
  maintenance_status: string | null;
  usage_percentage: number | null;
  current_distance_km: number | null;
  limit_km: number | null;
  /** The backend's own description; shown as is. */
  message: string | null;
  is_reminder: boolean | null;
  created_at: string | null;
}

export interface TyreAlertsResponse {
  count: number;
  items: TyreMaintenanceAlert[];
}

function readTyreAlert(v: unknown): TyreMaintenanceAlert | null {
  if (!isObj(v)) return null;
  const vehicle = str(v.vehicle_number);
  if (!vehicle) return null;
  return {
    id: int(v.id),
    tenant_id: int(v.tenant_id),
    device_id: int(v.device_id),
    vehicle_number: vehicle,
    alert_level: num(v.alert_level),
    maintenance_status: str(v.maintenance_status),
    usage_percentage: num(v.usage_percentage),
    current_distance_km: num(v.current_distance_km),
    limit_km: num(v.limit_km),
    message: str(v.message),
    is_reminder: bool(v.is_reminder),
    created_at: str(v.created_at),
  };
}

export function parseTyreAlerts(raw: unknown): Parsed<TyreAlertsResponse> {
  if (!isObj(raw) || !Array.isArray(raw.items)) return { ok: false, reason: "shape" };
  const items = raw.items.map(readTyreAlert).filter((a): a is TyreMaintenanceAlert => a !== null);
  return { ok: true, value: { count: int(raw.count) ?? items.length, items } };
}

export const TYRE_ALERT_LIMIT = { min: 1, max: 500, default: 50 } as const;

/** POST …/register: `installation_date` is required. */
export function readTyreRegister(raw: unknown): { installation_date: string } | null {
  if (!isObj(raw) || !isZonedDateTime(raw.installation_date)) return null;
  return { installation_date: raw.installation_date };
}

/** POST …/complete: `replacement_date` is optional (the backend then uses its current UTC time). */
export function readTyreComplete(raw: unknown): { replacement_date?: string } | null {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) return null;
  if (raw.replacement_date === undefined || raw.replacement_date === null) return {};
  return isZonedDateTime(raw.replacement_date) ? { replacement_date: raw.replacement_date } : null;
}

// ── Status / severity display (from backend values only) ────────────────────

export type MaintenanceTone = "success" | "warning" | "danger" | "neutral";

/**
 * Tone for a tyre `maintenance_status`. Only what the values themselves say: NORMAL → green; a value starting with
 * CRITICAL (e.g. the sampled CRITICAL_85) → red; one starting with WARNING → amber; anything else → neutral (shown
 * as sent). No thresholds are computed from the percentage.
 */
export function tyreStatusTone(status: string | null | undefined): MaintenanceTone {
  const s = (status ?? "").toUpperCase();
  if (s === "NORMAL") return "success";
  if (s.startsWith("CRITICAL")) return "danger";
  if (s.startsWith("WARNING")) return "warning";
  return "neutral";
}

/** Vehicle schedule `status` tone. Only "pending" is documented; overdue/done-like values are read literally. */
export function scheduleStatusTone(status: string | null | undefined): MaintenanceTone {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "done") return "success";
  if (s === "overdue") return "danger";
  if (s === "pending" || s === "postponed") return "warning";
  return "neutral";
}

/**
 * Tone for a vehicle-maintenance alert, from the reminder types the schedule documents: reminder_15d / reminder_7d
 * are early reminders (neutral), action_3d / action_2d / action_1d are completion checks (amber), due_today is red.
 * Unknown kinds are neutral.
 */
export function vehicleAlertTone(kind: string | null | undefined): MaintenanceTone {
  const k = (kind ?? "").toLowerCase();
  if (k === "due_today" || k === "overdue") return "danger";
  if (k.startsWith("action_")) return "warning";
  return "neutral";
}

/** "15 days before" style label for a reminder kind, from the schedule's own reminder_schedule when it has one. */
export const humaniseKind = (kind: string) => kind.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase());

// ── Unified notifications (Notifications popover → Maintenance) ─────────────

export type MaintenanceSource = "VEHICLE_MAINTENANCE" | "TYRE_MAINTENANCE";

export interface MaintenanceNotification {
  /**
   * Stable, unique across sources: "tyre:115" (the tyre alert's id), or for vehicle alerts, which have no id, a
   * composite of vehicle number, kind, due date, alert date and created_at (vehicleAlertKey).
   */
  id: string;
  source: MaintenanceSource;
  vehicleNumber: string;
  title: string;
  /** The backend's message, unchanged; null when it sent none (nothing is composed in its place). */
  message: string | null;
  tone: MaintenanceTone;
  /** e.g. "Level 2" for tyre alerts (alert_level as sent). */
  severityLabel: string | null;
  createdAt: string | null;
  /** The original alert id from its source. */
  sourceId: number | null;
  isReminder: boolean | null;
  /** Vehicle alerts: `kind` as sent ("overdue"), with its display label ("Overdue"). Null for tyre alerts. */
  kind?: string | null;
  kindLabel?: string | null;
  /** Vehicle alerts: plain dates "YYYY-MM-DD", shown from their own digits (formatPlainDate). */
  dueDate?: string | null;
  alertDate?: string | null;
  /** Vehicle alerts: from the response's enclosing `data`. */
  driverName?: string | null;
  driverId?: number | null;
}

export function fromTyreAlert(a: TyreMaintenanceAlert, index = 0): MaintenanceNotification {
  return {
    id: a.id !== null ? `tyre:${a.id}` : `tyre:${a.vehicle_number}:${a.created_at ?? "?"}:${index}`,
    source: "TYRE_MAINTENANCE",
    vehicleNumber: a.vehicle_number,
    title: a.maintenance_status ?? "Tyre maintenance alert",
    message: a.message,
    tone: tyreStatusTone(a.maintenance_status),
    severityLabel: a.alert_level !== null ? `Level ${a.alert_level}` : null,
    createdAt: a.created_at,
    sourceId: a.id,
    isReminder: a.is_reminder,
  };
}

/**
 * React key / notification id of a vehicle alert. The API sends no alert id, so none is invented: the key is built
 * from the fields that identify the alert (missing parts read as "-").
 */
export function vehicleAlertKey(a: Pick<VehicleMaintenanceAlert, "kind" | "due_date" | "alert_date" | "created_at">, vehicleNumber: string): string {
  return ["vehicle", vehicleNumber, a.kind ?? "-", a.due_date ?? "-", a.alert_date ?? "-", a.created_at ?? "-"].join(":");
}

/** The enclosing `data` of an alerts response: the vehicle and driver every item belongs to. */
export type VehicleAlertContext = Pick<VehicleAlertsData, "vehicle_number" | "driver_id" | "driver_name">;

/**
 * One vehicle alert as a notification. The vehicle number is the item's own, else the response's `data`, else the
 * vehicle that was asked for (`requestedVehicle`). Title and message are the backend's; nothing is composed.
 */
export function fromVehicleAlert(a: VehicleMaintenanceAlert, requestedVehicle: string, context: Partial<VehicleAlertContext> = {}): MaintenanceNotification {
  const vehicle = a.vehicle_number ?? context.vehicle_number ?? requestedVehicle;
  const kindLabel = a.kind ? humaniseKind(a.kind) : null;
  return {
    id: vehicleAlertKey(a, vehicle),
    source: "VEHICLE_MAINTENANCE",
    vehicleNumber: vehicle,
    title: a.title ?? kindLabel ?? "Vehicle maintenance alert",
    message: a.message,
    tone: vehicleAlertTone(a.kind),
    severityLabel: null,
    createdAt: a.created_at,
    sourceId: null,
    isReminder: null,
    kind: a.kind,
    kindLabel,
    dueDate: a.due_date,
    alertDate: a.alert_date,
    driverName: context.driver_name ?? null,
    driverId: context.driver_id ?? null,
  };
}

/** Every item of a parsed alerts response as notifications (all of them, not just the first). */
export const vehicleAlertNotifications = (data: VehicleAlertsData, requestedVehicle: string): MaintenanceNotification[] => data.items.map((a) => fromVehicleAlert(a, requestedVehicle, data));

/** Newest first by each alert's own timestamp; ties keep source order. Duplicate ids are dropped. */
export function sortNotifications(list: readonly MaintenanceNotification[]): MaintenanceNotification[] {
  const seen = new Set<string>();
  const unique = list.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  return unique.map((n, i) => ({ n, i, t: timestampSortKey(n.createdAt) })).sort((a, b) => b.t - a.t || a.i - b.i).map((x) => x.n);
}

export const SOURCE_LABELS: Record<MaintenanceSource, string> = { VEHICLE_MAINTENANCE: "Vehicle Maintenance", TYRE_MAINTENANCE: "Tyre Maintenance" };

/** /api/maintenance/notifications response (built by the proxy). */
export interface MaintenanceFeed {
  items: MaintenanceNotification[];
  /** Per-source outcome, so a failure of one source is shown instead of reading as "no alerts". */
  sources: {
    tyre: { ok: boolean; status?: number; error?: string; count: number };
    vehicle: { ok: boolean; status?: number; error?: string; vehiclesChecked: number; vehiclesWithSchedules: number; failedVehicles: number; truncated: boolean };
  };
  generatedAt: string;
}

/** Every numeric `tenant_id` in a JSON value (depth-limited); used to refuse other tenants' data. */
export { tenantIdsIn } from "./python-client";
