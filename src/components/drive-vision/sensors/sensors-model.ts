import type { SensorReadingInput, SensorWindowQuery, VehicleRow } from "@/features/drive-vision/api/types";
import type { Tone } from "../shared/status-badge";
import { dateToIstInput, istInputToDate } from "../trips/track-model";

/** Pure helpers for the Sensors screen (docs/contracts/passenger-counting-api.txt). Unit-tested. */

/**
 * A vehicle in the Sensors picker (GET /api/v1/vehicles?assigned=true). Its identifiers are never interchanged:
 * - vehicleId     — the Safe-Fare vehicle id (picker value, ?vehicle= deep link);
 * - deviceId      — device.id, the {id} of /devices/{id}/sensors/readings, /bms, /stops, /stops/comparison, …;
 * - vehicleNumber — the label, and Sensor Alerts' vehicle_number.
 */
export interface SensorVehicle {
  vehicleId: number;
  vehicleNumber: string;
  deviceId: number;
  deviceName: string | null;
  terminalNo: string | null;
  vehicleType: string | null;
}

const nonEmpty = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/**
 * Picker entries from GET /vehicles?assigned=true, sorted by vehicle number. A row without a vehicle id, number or
 * device id (or one the server marks deviceAssigned: false) is dropped: it has no device to read sensors from.
 */
export function sensorVehicles(rows: readonly VehicleRow[] | undefined): SensorVehicle[] {
  const out: SensorVehicle[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const vehicleId = posInt(r.id);
    const deviceId = posInt(r.device?.id);
    const vehicleNumber = nonEmpty(r.vehicleNumber);
    if (vehicleId === null || deviceId === null || !vehicleNumber || r.deviceAssigned === false) continue;
    out.push({ vehicleId, vehicleNumber, deviceId, deviceName: nonEmpty(r.device?.name), terminalNo: nonEmpty(r.device?.terminalNo), vehicleType: nonEmpty(r.vehicleType) });
  }
  return out.sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber));
}

/**
 * The vehicle shown: the one chosen (by vehicle id), else the deep-linked one (?vehicle= vehicle id, or the legacy
 * ?device= device id), else the first, so the screen opens with data. null when there is none.
 */
export function pickSensorVehicle(list: readonly SensorVehicle[], chosenVehicleId: number | null, link: { vehicleId?: number | null; deviceId?: number | null } = {}): SensorVehicle | null {
  if (chosenVehicleId !== null) return list.find((v) => v.vehicleId === chosenVehicleId) ?? null;
  const linked = list.find((v) => (link.vehicleId != null && v.vehicleId === link.vehicleId) || (link.deviceId != null && v.deviceId === link.deviceId));
  return linked ?? list[0] ?? null;
}

export const IR_SENSOR_SUB_ID = 3;
/** Alcohol sensor (docs/contracts/alcohol-detection-api.txt): sensorData "1" = detected, "0" = not detected. */
export const ALCOHOL_SENSOR_SUB_ID = 5;

/** NO_READING and INVALID_READING never mean "not detected" (contract), so they're shown as such. */
export const ALCOHOL_META: Record<string, { label: string; tone: Tone; detail: string }> = {
  DETECTED: { label: "Alcohol detected", tone: "danger", detail: "The latest reading reports alcohol." },
  NOT_DETECTED: { label: "Not detected", tone: "success", detail: "The latest reading reports no alcohol." },
  INVALID_READING: { label: "Invalid reading", tone: "warning", detail: "The latest reading isn't 1 or 0, so it can't be read as a result." },
  NO_READING: { label: "No reading", tone: "neutral", detail: "No active alcohol reading in this window." },
};

export function alcoholMeta(status: string | null | undefined): { label: string; tone: Tone; detail: string } {
  if (!status) return ALCOHOL_META.NO_READING;
  return ALCOHOL_META[status] ?? { label: status, tone: "neutral", detail: "Status returned by the server." };
}
export const DEFAULT_CAPACITY = 44;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Reads accept at most 31 days; recalculation at most 7. */
export const MAX_READ_WINDOW_MS = 31 * DAY;
export const MAX_RECALC_WINDOW_MS = 7 * DAY;
const IST_OFFSET_MS = 5.5 * HOUR;

export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  MATCH: { label: "Match", tone: "success" },
  /** Passenger Analytics demo journey (passenger-demo.ts): counts equal. */
  EXACT: { label: "Exact", tone: "success" },
  MISMATCH: { label: "Mismatch", tone: "warning" },
  OVER_CAPACITY: { label: "Over capacity", tone: "danger" },
  OVER_CAPACITY_MISMATCH: { label: "Over capacity · mismatch", tone: "danger" },
  NO_BMS: { label: "No BMS", tone: "neutral" },
  NO_SENSOR_COUNT: { label: "No sensor count", tone: "neutral" },
};

export function statusMeta(status: string | null | undefined): { label: string; tone: Tone } {
  if (!status) return { label: "—", tone: "neutral" };
  return STATUS_META[status] ?? { label: status, tone: "neutral" };
}

/** Why a count is unknown or a stop looks odd (contract NOTES). Unknown codes are shown as returned. */
export const NOTE_TEXT: Record<string, string> = {
  TRIP_START: "First stop of a trip — counts start from 0",
  TRIP_START_UNKNOWN: "The trip's first stop isn't in this window — counts unknown",
  BMS_MISSING: "No BMS record for this stop",
  BMS_SEQUENCE_GAP: "A BMS stop is missing before this one — actual count unknown until the next trip",
  BMS_SEQUENCE_RESTART: "BMS sequence went back without restarting at 1",
  MULTIPLE_BMS_ROWS: "Several BMS records for this stop — the latest is used",
  BMS_REPORTED_COUNT_DIFFERS: "BMS reported count differs from the calculated count",
  ACTUAL_COUNT_UNKNOWN: "Actual count unknown because of an earlier problem in this trip",
  NEGATIVE_ACTUAL_COUNT: "More alighted than on board (invalid BMS data)",
  SENSOR_READINGS_MISSING: "No IR reading for this stop",
  SENSOR_IN_OUT_MISSING: "An IR reading without in / out values",
  SENSOR_COUNT_UNKNOWN: "Sensor count unknown because of an earlier problem in this trip",
  NEGATIVE_SENSOR_COUNT: "More alighted than on board (invalid sensor data)",
};
export const noteText = (code: string) => NOTE_TEXT[code] ?? code;

/** Unknown counts are null, never 0: shown as "—". */
export const showCount = (n: number | null | undefined) => (typeof n === "number" ? String(n) : "—");
export const showSigned = (n: number | null | undefined) => (typeof n === "number" ? (n > 0 ? `+${n}` : String(n)) : "—");
export const showPct = (n: number | null | undefined) => (typeof n === "number" ? `${Math.round(n * 10) / 10}%` : "—");

// ── Time window ─────────────────────────────────────────────────────────────

export type WindowPreset = "24h" | "today" | "yesterday" | "7d" | "custom";

/** Start of the IST day containing `now`, as a UTC Date. */
function istDayStart(now: Date): Date {
  const ist = now.getTime() + IST_OFFSET_MS;
  return new Date(ist - (ist % DAY) - IST_OFFSET_MS);
}

/**
 * The fromUtc / toUtc pair for a preset (fleet time, IST) or a custom IST range, or an error.
 * Reads accept at most 31 days and need from < to.
 */
export function resolveWindow(preset: WindowPreset, custom: { from: string; to: string }, now: Date): { window: SensorWindowQuery & { fromUtc: string; toUtc: string }; error: null } | { window: null; error: string } {
  const range: Record<Exclude<WindowPreset, "custom">, () => [Date, Date]> = {
    "24h": () => [new Date(now.getTime() - DAY), now],
    "7d": () => [new Date(now.getTime() - 7 * DAY), now],
    today: () => [istDayStart(now), now],
    yesterday: () => [new Date(istDayStart(now).getTime() - DAY), istDayStart(now)],
  };
  let from: Date | null;
  let to: Date | null;
  if (preset !== "custom") [from, to] = range[preset]();
  else {
    from = istInputToDate(custom.from);
    to = istInputToDate(custom.to);
    if (!from || !to) return { window: null, error: "Choose a start and end time." };
  }
  if (from.getTime() >= to.getTime()) return { window: null, error: "The start must be before the end." };
  if (to.getTime() - from.getTime() > MAX_READ_WINDOW_MS) return { window: null, error: "The range can be at most 31 days." };
  return { window: { fromUtc: from.toISOString(), toUtc: to.toISOString() }, error: null };
}

/** Recalculation accepts at most 7 days. */
export function recalcBlock(window: { fromUtc: string; toUtc: string } | null): string | null {
  if (!window) return "Choose a valid time range.";
  return Date.parse(window.toUtc) - Date.parse(window.fromUtc) > MAX_RECALC_WINDOW_MS ? "Recalculation covers at most 7 days — narrow the range." : null;
}

// ── Add a reading (POST /sensors/readings) ──────────────────────────────────

export interface ReadingForm {
  sensorSubId: string;
  sensorId: string;
  /** IST datetime-local "YYYY-MM-DDTHH:mm". */
  time: string;
  /** IR sensor: boarded / alighted / on board. */
  inCount: string;
  outCount: string;
  count: string;
  /** Other sensors: free text. */
  data: string;
  active: boolean;
}
export type ReadingField = "sensorSubId" | "sensorId" | "time" | "inCount" | "outCount" | "count" | "data";

export const emptyReadingForm = (now: Date): ReadingForm => ({
  sensorSubId: String(IR_SENSOR_SUB_ID),
  sensorId: "",
  time: dateToIstInput(now),
  inCount: "0",
  outCount: "0",
  count: "",
  data: "",
  active: true,
});

const SENSOR_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const WHOLE = /^\d+$/;
const MAX_IR = 300;
const FUTURE_SKEW_MS = 5 * 60_000;

export function validateReading(form: ReadingForm, now: Date): Partial<Record<ReadingField, string>> {
  const e: Partial<Record<ReadingField, string>> = {};
  if (!/^\d+$/.test(form.sensorSubId)) e.sensorSubId = "Choose a sensor type.";
  if (!SENSOR_ID.test(form.sensorId.trim())) e.sensorId = "1–100 characters: letters, digits and . _ : - only.";
  const at = istInputToDate(form.time);
  if (!at) e.time = "Enter a valid time.";
  else if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) e.time = "The time can't be more than 5 minutes in the future.";
  if (Number(form.sensorSubId) === IR_SENSOR_SUB_ID) {
    for (const f of ["inCount", "outCount", "count"] as const) {
      const v = form[f].trim();
      if (!WHOLE.test(v)) e[f] = "Enter a whole number.";
      else if (Number(v) > MAX_IR) e[f] = `0–${MAX_IR}.`;
    }
  } else if (Number(form.sensorSubId) === ALCOHOL_SENSOR_SUB_ID) {
    if (form.data !== "1" && form.data !== "0") e.data = "Choose detected or not detected.";
  } else {
    const d = form.data.trim();
    if (!d) e.data = "Enter the sensor data.";
    else if (d.length > 500) e.data = "Use 500 characters or fewer.";
  }
  return e;
}

/** One reading for the selected bus. IR data is sent as the JSON string the contract describes. */
export function readingBody(form: ReadingForm, deviceId: number): SensorReadingInput {
  const ir = Number(form.sensorSubId) === IR_SENSOR_SUB_ID;
  return {
    sensorId: form.sensorId.trim(),
    sensorSubId: Number(form.sensorSubId),
    deviceId,
    timestamp: istInputToDate(form.time)!.toISOString(),
    sensorData: ir ? JSON.stringify({ in: Number(form.inCount), out: Number(form.outCount), count: Number(form.count) }) : form.data.trim(),
    activeStatus: form.active,
  };
}

/** IR sensorData ("{"in":6,"out":1,"count":17}" or "25") for display; other data as returned. */
export function describeSensorData(data: string | undefined): string {
  if (!data) return "—";
  try {
    const v = JSON.parse(data);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const parts = [typeof v.in === "number" ? `in ${v.in}` : null, typeof v.out === "number" ? `out ${v.out}` : null, typeof v.count === "number" ? `on board ${v.count}` : null].filter(Boolean);
      if (parts.length) return parts.join(" · ");
    }
  } catch {
    // not JSON: shown as returned
  }
  return data;
}
