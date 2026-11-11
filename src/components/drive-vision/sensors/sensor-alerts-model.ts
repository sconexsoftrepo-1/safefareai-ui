import { SENSOR_SUB_IDS, cleanSensorTime, isSensorSubId, isTimeRangeValid, type SensorAlert, type SensorAlertsResponse, type SensorAlertsSummary } from "@/features/drive-vision/api/sensor-alerts";

/**
 * Pure helpers for the Sensors screen's Sensor Alerts tab (duration-based contract). Unit-tested.
 *
 * Every record is one period during which a sensor was active: started_at → ended_at (null while ongoing), lasted
 * for lasted_seconds, possibly closed by an inactivity gap. The sensor is the record's `sensor_type` (shown as sent;
 * unknown types stay displayable); `sensor_sub_id` is its numeric id. Only the ultrasonic payload is interpreted
 * ("distance:3,reading:no_echo"): its reading word gives the title and tone, and "distance:NA" is unavailable, never 0.
 * Other sensors get no status inferred from their payload; every record's `sensor_data` is shown as sent.
 */

/** Sensors with their own colours on the page. IR, PRS and unknown types use the generic style. */
export type SensorKind = "ULT" | "SMK" | "ALC";
export type UltrasonicReading = "safe" | "warning" | "no_echo";
export type ReadingTone = "success" | "warning" | "neutral";
/** ongoing → "Ongoing"; ended_after_gap → "Ended after inactivity gap"; both false → "Ended"; otherwise unknown. */
export type AlertStatus = "ongoing" | "ended_gap" | "ended" | "unknown";

export const SENSOR_KINDS: Readonly<Record<SensorKind, { name: string; short: string }>> = {
  ULT: { name: "Ultrasonic Sensor", short: "Ultrasonic" },
  SMK: { name: "Smoke Sensor", short: "Smoke" },
  ALC: { name: "Alcohol Sensor", short: "Alcohol" },
};
/** Display names of known types without their own style. PRS isn't expanded anywhere in the contract: shown by code. */
const OTHER_NAMES: Readonly<Record<string, string>> = { IR: "IR Sensor" };

const isKind = (code: string): code is SensorKind => Object.hasOwn(SENSOR_KINDS, code);

export const STATUS_LABEL: Readonly<Record<AlertStatus, string>> = { ongoing: "Ongoing", ended_gap: "Ended after inactivity gap", ended: "Ended", unknown: "Status unknown" };

/** One record as the UI shows it. `record` is the untouched API record (source of truth). */
export interface SensorAlertView {
  /** Stable within one response: API position. */
  key: string;
  record: SensorAlert;
  kind: SensorKind | null;
  /** sensor_type as returned (trimmed, upper-case), else Swagger's type for sensor_sub_id; "—" when neither. */
  code: string;
  /** Known sensor name, or null (never invented). */
  sensorName: string | null;
  subId: number | null;
  /** Plain-language headline. */
  title: string;
  /** ULT only. */
  reading: UltrasonicReading | null;
  readingTone: ReadingTone | null;
  /** ULT only: "3" / "287.07 cm" / "Distance unavailable"; null for other sensors. */
  distanceText: string | null;
  vehicle: string | null;
  iotKit: string | null;
  status: AlertStatus;
  statusLabel: string;
  /** "08 Nov 2026, 04:41:35 PM IST", or null when started_at is missing / unreadable. */
  startedText: string | null;
  /** Sortable key of started_at ("20261108164135"), or null. */
  startedKey: string | null;
  /** The formatted ended_at; "Not ended" while ongoing without one; "Not reported" otherwise. Never invented. */
  endedText: string;
  /** "27 sec", "51 min 9 sec", "2 h 5 min"; "—" when lasted_seconds is missing. */
  durationText: string;
  /** ended_after_gap as "Yes" / "No" / "—". */
  gapText: string;
  /** sensor_data as sent, or null. */
  sensorData: string | null;
}

// ── Payload ──────────────────────────────────────────────────────────────────

/** "distance:3,reading:no_echo" → { distance: "3", reading: "no_echo" }. Malformed parts are ignored. */
export function payloadFields(data: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof data !== "string") return out;
  for (const part of data.split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k && !out.has(k)) out.set(k, part.slice(i + 1).trim());
  }
  return out;
}

/** The ultrasonic distance and its unit as sent ("287.07 cm" → { 287.07, "cm" }), or null (missing, "NA", not a number). */
export function ultrasonicDistance(data: string | null | undefined): { value: number; unit: string | null } | null {
  const raw = payloadFields(data).get("distance");
  const m = raw ? /^(\d+(?:\.\d+)?)\s*([A-Za-z]{1,6})?$/.exec(raw) : null;
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: m[2] ?? null } : null;
}

/** "287.07 cm"; a number sent without a unit is shown without one; missing / "NA" → "Distance unavailable". */
export function distanceText(data: string | null | undefined): string {
  const d = ultrasonicDistance(data);
  if (!d) return "Distance unavailable";
  return d.unit ? `${d.value} ${d.unit}` : String(d.value);
}

/** The reading word of a payload, upper-case ("no_echo" → "NO_ECHO"), or null. */
export function payloadReading(data: string | null | undefined): string | null {
  return payloadFields(data).get("reading")?.toUpperCase() || null;
}

const ULT_READINGS: Readonly<Record<string, { reading: UltrasonicReading; title: string; tone: ReadingTone }>> = {
  SAFE: { reading: "safe", title: "Safe reading", tone: "success" },
  WARNING: { reading: "warning", title: "Warning reading", tone: "warning" },
  NO_ECHO: { reading: "no_echo", title: "No echo", tone: "neutral" },
};

/** The ultrasonic reading (SAFE / WARNING / NO_ECHO, any case), or null for a missing or unknown reading word. */
export function ultrasonicReading(data: string | null | undefined): (typeof ULT_READINGS)[string] | null {
  const r = payloadReading(data);
  return r && Object.hasOwn(ULT_READINGS, r) ? ULT_READINGS[r] : null;
}

// ── IST wall-clock time ─────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The service's IST wall-clock form ("2026-11-08 16:41:35"). An explicit +05:30 is also IST; any other zone isn't. */
const IST_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:\+05:?30)?$/;

function istParts(ts: string | null | undefined): [number, number, number, number, number, number] | null {
  if (typeof ts !== "string") return null;
  const m = IST_TIMESTAMP.exec(ts.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const daysInMonth = mo >= 1 && mo <= 12 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
  if (d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59) return null;
  return [y, mo, d, h, mi, s];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "2026-11-08 16:41:35" → "08 Nov 2026, 04:41:35 PM IST". The value is already IST, so it is formatted from its own
 * digits: no Date parsing, no "Z", no offset, no browser time zone involved.
 */
export function formatIstTimestamp(ts: string | null | undefined): string | null {
  const p = istParts(ts);
  if (!p) return null;
  const [y, mo, d, h, mi, s] = p;
  return `${pad(d)} ${MONTHS[mo - 1]} ${y}, ${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(mi)}:${pad(s)} ${h < 12 ? "AM" : "PM"} IST`;
}

export function istSortKey(ts: string | null | undefined): string | null {
  const p = istParts(ts);
  return p ? `${p[0]}${p.slice(1).map(pad).join("")}` : null;
}

// ── Duration ────────────────────────────────────────────────────────────────

/** 0 → "0 sec"; 27 → "27 sec"; 3069 → "51 min 9 sec"; 7500 → "2 h 5 min"; missing → "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} sec`;
  if (s < 3600) {
    const rest = s % 60;
    return rest ? `${Math.floor(s / 60)} min ${rest} sec` : `${s / 60} min`;
  }
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return min ? `${h} h ${min} min` : `${h} h`;
}

// ── Interpretation ──────────────────────────────────────────────────────────

/** The display code of a record: its sensor_type, else Swagger's type for its sensor_sub_id, else "". */
export function sensorCode(record: Pick<SensorAlert, "sensor_type" | "sensor_sub_id">): string {
  if (typeof record.sensor_type === "string" && record.sensor_type.trim()) return record.sensor_type.trim().toUpperCase();
  return isSensorSubId(record.sensor_sub_id) ? SENSOR_SUB_IDS[record.sensor_sub_id] : "";
}

export function statusOf(record: Pick<SensorAlert, "ongoing" | "ended_after_gap">): AlertStatus {
  if (record.ongoing === true) return "ongoing";
  if (record.ended_after_gap === true) return "ended_gap";
  if (record.ongoing === false && record.ended_after_gap === false) return "ended";
  if (record.ongoing === false) return "ended";
  return "unknown";
}

const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function interpretAlert(record: SensorAlert, index: number): SensorAlertView {
  const code = sensorCode(record);
  const kind = code && isKind(code) ? code : null;
  let title: string;
  let reading: UltrasonicReading | null = null;
  let readingTone: ReadingTone | null = null;
  let distance: string | null = null;

  if (kind === "ULT") {
    distance = distanceText(record.sensor_data);
    const r = ultrasonicReading(record.sensor_data);
    if (r) [title, reading, readingTone] = [r.title, r.reading, r.tone];
    else title = "Ultrasonic sensor alert";
  } else if (kind) {
    title = `${SENSOR_KINDS[kind].short} sensor alert`;
  } else {
    title = code && OTHER_NAMES[code] ? `${OTHER_NAMES[code]} alert` : "Sensor alert";
  }

  const status = statusOf(record);
  const ended = formatIstTimestamp(record.ended_at);
  return {
    key: `${index}`,
    record,
    kind,
    code: code || "—",
    sensorName: kind ? SENSOR_KINDS[kind].name : (OTHER_NAMES[code] ?? null),
    subId: typeof record.sensor_sub_id === "number" ? record.sensor_sub_id : null,
    title,
    reading,
    readingTone,
    distanceText: distance,
    vehicle: clean(record.vehicle_number),
    iotKit: clean(record.iot_kit),
    status,
    statusLabel: STATUS_LABEL[status],
    startedText: formatIstTimestamp(record.started_at),
    startedKey: istSortKey(record.started_at),
    endedText: ended ?? (status === "ongoing" ? "Not ended" : record.ended_at ? record.ended_at : "Not reported"),
    durationText: formatDuration(record.lasted_seconds),
    gapText: record.ended_after_gap === true ? "Yes" : record.ended_after_gap === false ? "No" : "—",
    sensorData: clean(record.sensor_data),
  };
}

/** Newest first by started_at; records with an unreadable time go last. Ties keep the API order (stable sort). */
export function interpretAll(records: readonly SensorAlert[]): SensorAlertView[] {
  return records
    .map(interpretAlert)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      if (a.v.startedKey === b.v.startedKey) return a.i - b.i;
      if (a.v.startedKey === null) return 1;
      if (b.v.startedKey === null) return -1;
      return a.v.startedKey < b.v.startedKey ? 1 : -1;
    })
    .map(({ v }) => v);
}

/** The newest record (the list is already newest first), or null when there is none. */
export const latestAlert = (sorted: readonly SensorAlertView[]): SensorAlertView | null => sorted[0] ?? null;

// ── Summary ─────────────────────────────────────────────────────────────────

/** One summary bucket: alert count and total duration (null when not reported). */
export interface SensorCount {
  count: number;
  seconds: number | null;
}
/** The five documented sensor types, in Swagger's sub-ID order, plus anything else. */
export const SUMMARY_TYPES = ["IR", "ULT", "SMK", "ALC", "PRS"] as const;
export type SummaryType = (typeof SUMMARY_TYPES)[number];
export interface AlertSummary {
  total: number;
  byType: Record<SummaryType, SensorCount>;
  /** Types outside the five documented ones. */
  other: SensorCount;
  /** "service" = the response's summary block; "records" = counted from the records shown. */
  source: "service" | "records";
}

const empty = (): Record<SummaryType, SensorCount> => ({ IR: zero(), ULT: zero(), SMK: zero(), ALC: zero(), PRS: zero() });
const zero = (): SensorCount => ({ count: 0, seconds: 0 });
const isSummaryType = (c: string): c is SummaryType => (SUMMARY_TYPES as readonly string[]).includes(c);
const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);

/** Counted from records: each record once, in its sensor's bucket, with its lasted_seconds. */
export function summarizeAlerts(views: readonly SensorAlertView[]): AlertSummary {
  const s: AlertSummary = { total: views.length, byType: empty(), other: zero(), source: "records" };
  for (const v of views) {
    const b = isSummaryType(v.code) ? s.byType[v.code] : s.other;
    b.count += 1;
    b.seconds = add(b.seconds, v.record.lasted_seconds);
  }
  return s;
}

/**
 * The response's own `summary` (total_alerts, by_sensor), read into the same buckets. A sensor missing from
 * by_sensor counts 0. Null when there is no usable summary (none sent, or an empty by_sensor while records exist).
 */
export function serviceSummary(summary: SensorAlertsSummary | null | undefined, recordCount: number): AlertSummary | null {
  if (!summary || (summary.by_sensor.length === 0 && recordCount > 0)) return null;
  const s: AlertSummary = { total: 0, byType: empty(), other: zero(), source: "service" };
  let sum = 0;
  for (const e of summary.by_sensor) {
    const code = e.sensor_type?.trim().toUpperCase() || (isSensorSubId(e.sensor_sub_id) ? SENSOR_SUB_IDS[e.sensor_sub_id] : "");
    const b = isSummaryType(code) ? s.byType[code] : s.other;
    const count = e.alert_count ?? 0;
    b.count += count;
    b.seconds = add(b.seconds, e.total_lasted_seconds);
    sum += count;
  }
  s.total = summary.total_alerts ?? sum;
  return s;
}

/**
 * What the summary cards show: the response's own summary (it covers exactly what this request asked for —
 * vehicle, sensor and date range are server-side), else the shown records counted here (registration search
 * applied in the browser, or no summary sent).
 */
export function alertSummary(shown: readonly SensorAlertView[], response: Pick<SensorAlertsResponse, "summary"> | null | undefined, filteredInBrowser: boolean): AlertSummary {
  return (!filteredInBrowser && serviceSummary(response?.summary, shown.length)) || summarizeAlerts(shown);
}

/** The response's alert count for the tab badge: summary.total_alerts, else count, else the records returned. */
export function totalAlerts(response: Pick<SensorAlertsResponse, "summary" | "count" | "alerts">): number {
  return response.summary?.total_alerts ?? response.count ?? response.alerts.length;
}

// ── Filters ─────────────────────────────────────────────────────────────────

/** Server-side filters (sent with the request). The date range is in the service's own "YYYY-MM-DD HH:mm:ss". */
export interface AlertQueryFilters {
  sensorSubId: number | null;
  fromTime: string | null;
  toTime: string | null;
}
export const DEFAULT_QUERY_FILTERS: AlertQueryFilters = { sensorSubId: null, fromTime: null, toTime: null };

/**
 * The date range typed into two datetime-local inputs, as the service's strings, or the reason it can't be applied.
 * An empty input means "no bound". Nothing is converted: "2026-11-10T00:00" → "2026-11-10 00:00:00".
 */
export function readDateRange(fromInput: string, toInput: string): { ok: true; fromTime: string | null; toTime: string | null } | { ok: false; error: string } {
  const from = fromInput.trim() ? cleanSensorTime(fromInput) : null;
  const to = toInput.trim() ? cleanSensorTime(toInput) : null;
  if (fromInput.trim() && !from) return { ok: false, error: "Enter a valid start date and time." };
  if (toInput.trim() && !to) return { ok: false, error: "Enter a valid end date and time." };
  if (!isTimeRangeValid(from, to)) return { ok: false, error: "The start must not be later than the end." };
  return { ok: true, fromTime: from, toTime: to };
}

/** "2026-11-10 00:00:00" → "2026-11-10T00:00:00" for a datetime-local input (step 1 shows seconds). */
export const toDateTimeInput = (v: string | null) => (v ? v.replace(" ", "T") : "");

const squash = (s: string) => s.replace(/[\s-]+/g, "").toUpperCase();

/** Registration search in the browser (All vehicles only); spaces and case are ignored. */
export function filterByVehicle(views: readonly SensorAlertView[], search: string): SensorAlertView[] {
  const q = squash(search);
  return q ? views.filter((v) => v.vehicle !== null && squash(v.vehicle).includes(q)) : [...views];
}
