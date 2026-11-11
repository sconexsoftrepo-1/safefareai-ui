/**
 * Sensor Alerts API (Python service), duration-based contract supplied 2026-11-12:
 *
 *   GET <Python API base URL>/api/sensors/alerts
 *       ?tenant_id ?vehicle_number ?sensor_sub_id (1–5) ?from_time ?to_time ?max_gap_seconds (default 60)
 *
 * Each alert is one period during which a sensor was active: started_at, ended_at (null while ongoing), lasted_seconds,
 * and whether it ended because no reading arrived for max_gap_seconds (ended_after_gap). The earlier transition-based
 * schema (change, previous_value, new_value, previous_run_*, min_run, raw) is no longer the contract.
 *
 * The browser calls the service directly (temporary demo integration, sensor-alerts-service.ts), always with the
 * configured demo tenant as tenant_id. Pure and framework-free: the client and the tests share one definition.
 */

/** The Python API path (called directly from the browser: sensor-alerts-service.ts, python-client.ts). */
export const SENSOR_ALERTS_ROUTE = "/api/sensors/alerts";

/** Swagger's sensor_sub_id → sensor type. The response's own `sensor_type` is what the UI shows. */
export const SENSOR_SUB_IDS = { 1: "IR", 2: "ULT", 3: "SMK", 4: "ALC", 5: "PRS" } as const;
export type SensorSubId = keyof typeof SENSOR_SUB_IDS;
export const isSensorSubId = (v: unknown): v is SensorSubId => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;

/** Swagger default for max_gap_seconds; always sent, so the gap the UI describes is the one the service applied. */
export const SENSOR_ALERTS_DEFAULTS = { maxGapSeconds: 60 } as const;
export const MAX_GAP_LIMIT = 86_400;
export const isMaxGap = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= MAX_GAP_LIMIT;

/** One record of `alerts`. A field the service omits or sends with the wrong type is null; nothing is invented. */
export interface SensorAlert {
  tenant_id: number | null;
  vehicle_number: string | null;
  iot_kit: string | null;
  sensor_sub_id: number | null;
  /** Sensor type as sent ("ULT", "SMK", …); unknown types are kept. */
  sensor_type: string | null;
  /** "YYYY-MM-DD HH:mm:ss", IST wall-clock time without a zone. */
  started_at: string | null;
  /** Technical payload, e.g. "distance:3,reading:no_echo". Values may be non-numeric ("distance:NA"). */
  sensor_data: string | null;
  /** true = still active. Only a real boolean counts. */
  ongoing: boolean | null;
  /** true = closed because no reading arrived within max_gap_seconds. */
  ended_after_gap: boolean | null;
  /** Same format as started_at; null while ongoing (or when not reported). */
  ended_at: string | null;
  /** Non-negative seconds, as sent. */
  lasted_seconds: number | null;
}

/** One entry of summary.by_sensor. */
export interface SensorAlertsSensorSummary {
  sensor_sub_id: number | null;
  sensor_type: string | null;
  alert_count: number | null;
  total_lasted_seconds: number | null;
}

export interface SensorAlertsSummary {
  total_alerts: number | null;
  by_sensor: SensorAlertsSensorSummary[];
}

/** The filters the service says it applied (echoed back). */
export interface SensorAlertsFilters {
  tenant_id: number | null;
  vehicle_number: string | null;
  sensor_sub_id: number | null;
  from_time: string | null;
  to_time: string | null;
  max_gap_seconds: number | null;
}

export interface SensorAlertsResponse {
  success: boolean;
  filters: SensorAlertsFilters | null;
  /** Null when the service sent no (valid) summary. */
  summary: SensorAlertsSummary | null;
  /** Record count reported by the service. Not assumed to equal alerts.length. */
  count: number | null;
  /** In the order the service returned them. */
  alerts: SensorAlert[];
}

export interface SensorAlertsQuery {
  tenantId?: number | null;
  vehicleNumber?: string | null;
  sensorSubId?: number | null;
  /** "YYYY-MM-DD HH:mm:ss" (a datetime-local "T" form is accepted), IST wall-clock time like started_at. */
  fromTime?: string | null;
  toTime?: string | null;
  /** Defaults to SENSOR_ALERTS_DEFAULTS.maxGapSeconds. */
  maxGapSeconds?: number | null;
}

/** Registration numbers: 1–20 letters, digits, spaces or hyphens (the vehicle registry stores them upper-case). */
const VEHICLE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/;

export const isSensorTenantId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** A trimmed registration number the request may carry, or null (empty, "undefined", malformed). */
export function cleanVehicleNumber(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  // A stringified missing value is never a registration number.
  return VEHICLE_NUMBER.test(t) && !/^(undefined|null)$/i.test(t) ? t : null;
}

/** Fractional seconds (a datetime-local value can read "…T23:59:59.000") are accepted and dropped, never rounded. */
const SENSOR_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

/**
 * A from_time / to_time value in the service's own format, "YYYY-MM-DD HH:mm:ss", or null. A datetime-local value
 * ("2026-11-10T00:00") becomes "2026-11-10 00:00:00": the T is replaced by a space and seconds are added. It is
 * validated as a real calendar date and clock time and is never converted: no Date, no toISOString, no zone.
 */
export function cleanSensorTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = SENSOR_TIME.exec(v.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "00"].map(Number);
  const daysInMonth = mo >= 1 && mo <= 12 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
  if (d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? "00"}`;
}

/** Same format on both sides, so the strings compare in time order. */
export const isTimeRangeValid = (from: string | null, to: string | null) => !from || !to || from <= to;

/**
 * Query string for the request, built with URLSearchParams. A parameter is omitted when it has no valid value:
 * never sent empty, as "undefined" or as "null". max_gap_seconds is always sent (default 60). Only the documented
 * parameters exist here: the old min_run / raw are gone.
 */
export function sensorAlertsSearch(query: SensorAlertsQuery = {}): string {
  const params = new URLSearchParams();
  if (isSensorTenantId(query.tenantId)) params.set("tenant_id", String(query.tenantId));
  const vehicle = cleanVehicleNumber(query.vehicleNumber);
  if (vehicle) params.set("vehicle_number", vehicle);
  if (isSensorSubId(query.sensorSubId)) params.set("sensor_sub_id", String(query.sensorSubId));
  const from = cleanSensorTime(query.fromTime);
  const to = cleanSensorTime(query.toTime);
  if (from) params.set("from_time", from);
  if (to) params.set("to_time", to);
  params.set("max_gap_seconds", String(isMaxGap(query.maxGapSeconds) ? query.maxGapSeconds : SENSOR_ALERTS_DEFAULTS.maxGapSeconds));
  return `?${params.toString()}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const optStr = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const optCount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const optBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

function readAlert(raw: Record<string, unknown>): SensorAlert {
  return {
    tenant_id: optNum(raw.tenant_id),
    vehicle_number: optStr(raw.vehicle_number),
    iot_kit: optStr(raw.iot_kit),
    sensor_sub_id: optNum(raw.sensor_sub_id),
    sensor_type: optStr(raw.sensor_type),
    started_at: optStr(raw.started_at),
    sensor_data: optStr(raw.sensor_data),
    ongoing: optBool(raw.ongoing),
    ended_after_gap: optBool(raw.ended_after_gap),
    ended_at: optStr(raw.ended_at),
    lasted_seconds: optCount(raw.lasted_seconds),
  };
}

function readSensorSummary(raw: Record<string, unknown>): SensorAlertsSensorSummary {
  return {
    sensor_sub_id: optNum(raw.sensor_sub_id),
    sensor_type: optStr(raw.sensor_type),
    alert_count: optCount(raw.alert_count),
    total_lasted_seconds: optCount(raw.total_lasted_seconds),
  };
}

/** `summary`, or null when it is missing / not an object. A missing or malformed by_sensor reads as []. */
function readSummary(raw: unknown): SensorAlertsSummary | null {
  if (!isObject(raw)) return null;
  return { total_alerts: optCount(raw.total_alerts), by_sensor: Array.isArray(raw.by_sensor) ? raw.by_sensor.filter(isObject).map(readSensorSummary) : [] };
}

function readFilters(raw: unknown): SensorAlertsFilters | null {
  if (!isObject(raw)) return null;
  return {
    tenant_id: optNum(raw.tenant_id),
    vehicle_number: optStr(raw.vehicle_number),
    sensor_sub_id: optNum(raw.sensor_sub_id),
    from_time: optStr(raw.from_time),
    to_time: optStr(raw.to_time),
    max_gap_seconds: optCount(raw.max_gap_seconds),
  };
}

export type SensorAlertsParseResult = { ok: true; value: SensorAlertsResponse } | { ok: false; reason: "shape" | "unsuccessful" };

/**
 * Validates a decoded response. `success` must be exactly true; `alerts` must be an array (an empty one is a
 * valid "no records"). Non-object entries aren't records and are dropped; every object entry is kept, in the
 * service's order. `summary` and `filters` are optional.
 */
export function parseSensorAlertsResponse(raw: unknown): SensorAlertsParseResult {
  if (!isObject(raw)) return { ok: false, reason: "shape" };
  if (raw.success !== true) return { ok: false, reason: raw.success === false ? "unsuccessful" : "shape" };
  if (!Array.isArray(raw.alerts)) return { ok: false, reason: "shape" };
  const alerts = raw.alerts.filter(isObject).map(readAlert);
  return { ok: true, value: { success: true, filters: readFilters(raw.filters), summary: readSummary(raw.summary), count: optCount(raw.count), alerts } };
}
