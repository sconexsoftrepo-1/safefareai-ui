/**
 * Pure derivations over store data. Every number on the dashboard and analytics
 * screens is computed here from the underlying records, so totals stay consistent
 * across screens and react to local CRUD.
 */
import type { Alarm, AlarmCategory, DateRange, Driver, Severity, Trip, Vehicle } from "./types";
import { ALARM_TYPES, DEMO_NOW } from "./mock-data/catalog";
import { isOpen } from "./services/alarm-service";
import { DAY, HOUR, startOfFleetDay } from "./utils/time";
import { dayKey, formatShortDate, formatWeekday } from "./utils/format";

/* ───────────── Fleet status ───────────── */

export function fleetCounts(vehicles: Vehicle[], now = DEMO_NOW) {
  const c = { total: vehicles.length, online: 0, offline: 0, moving: 0, idle: 0, parked: 0, expired: 0, expiringSoon: 0, healthy: 0, alarming: 0 };
  for (const v of vehicles) {
    const s = v.telemetry.vehicleState;
    c[s]++;
    if (s !== "offline") c.online++;
    const days = (new Date(v.expireDate).getTime() - now.getTime()) / DAY;
    if (days < 0) c.expired++;
    else if (days <= 30) c.expiringSoon++;
    if (s !== "offline" && v.telemetry.posState && v.telemetry.power >= 20 && v.telemetry.gsmSin >= 2) c.healthy++;
    if (v.telemetry.alarm) c.alarming++;
  }
  return c;
}

/** Device health issues (BFF "Fleet health card"): long offline, low power, no GPS fix, expired. */
export function deviceHealthIssues(vehicles: Vehicle[], now = DEMO_NOW) {
  return {
    offlineOver24h: vehicles.filter((v) => v.telemetry.vehicleState === "offline" && now.getTime() - new Date(v.telemetry.lastReportTime).getTime() > 24 * HOUR).length,
    lowPower: vehicles.filter((v) => v.telemetry.power < 20).length,
    noGps: vehicles.filter((v) => v.telemetry.vehicleState !== "offline" && !v.telemetry.posState).length,
    expired: vehicles.filter((v) => new Date(v.expireDate) < now).length,
  };
}

export function isSafetyEvent(a: Alarm) {
  return a.alarmType !== "device_offline";
}

export function alarmsInRange(alarms: Alarm[], range: DateRange) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  return alarms.filter((a) => a.alarmTime >= from && a.alarmTime <= to);
}

export function tripsInRange(trips: Trip[], range: DateRange) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  return trips.filter((t) => t.startTime >= from && t.startTime <= to);
}

/* ───────────── Trends ───────────── */

export interface TrendBucket {
  key: string;
  label: string;
  ai: number;
  general: number;
  total: number;
}

/** Alarm & AI-event trend: hourly for "today", daily otherwise (vendor 5.1 + 5.8, BFF-aggregated). */
export function alarmTrend(alarms: Alarm[], range: DateRange): TrendBucket[] {
  return bucketTrend(
    alarmsInRange(alarms, range).map((a) => ({ time: a.alarmTime, ai: ALARM_TYPES[a.alarmType].aiEvent })),
    range
  );
}

/** Hourly (today) or daily buckets of AI vs routine events in a range. Items outside the range are ignored. */
export function bucketTrend(items: { time: string; ai: boolean }[], range: DateRange): TrendBucket[] {
  const inRange = items.filter((i) => {
    const t = new Date(i.time).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  });
  if (range.key === "today") {
    const start = startOfFleetDay(range.to).getTime();
    const hours = Math.max(1, Math.ceil((range.to.getTime() - start) / HOUR));
    const buckets: TrendBucket[] = Array.from({ length: hours }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, "0")}:00`, ai: 0, general: 0, total: 0 }));
    for (const item of inRange) {
      const b = buckets[Math.min(hours - 1, Math.floor((new Date(item.time).getTime() - start) / HOUR))];
      if (!b) continue;
      if (item.ai) b.ai++;
      else b.general++;
      b.total++;
    }
    return buckets;
  }
  const days = Math.round((startOfFleetDay(range.to).getTime() - range.from.getTime()) / DAY) + 1;
  const buckets: TrendBucket[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(range.from.getTime() + i * DAY + 12 * HOUR);
    return { key: dayKey(d), label: days <= 7 ? formatWeekday(d) : formatShortDate(d), ai: 0, general: 0, total: 0 };
  });
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const item of inRange) {
    const i = index.get(dayKey(item.time));
    if (i === undefined) continue;
    if (item.ai) buckets[i].ai++;
    else buckets[i].general++;
    buckets[i].total++;
  }
  return buckets;
}

/* ───────────── Rankings (vendor 5.5 driving time, 5.6 mileage) ───────────── */

export interface VehicleUsage {
  vehicleId: string;
  distanceKm: number;
  drivingMin: number;
  idleMin: number;
  trips: number;
}

export function vehicleUsage(trips: Trip[], range: DateRange): Map<string, VehicleUsage> {
  const map = new Map<string, VehicleUsage>();
  for (const t of tripsInRange(trips, range)) {
    const u = map.get(t.vehicleId) ?? { vehicleId: t.vehicleId, distanceKm: 0, drivingMin: 0, idleMin: 0, trips: 0 };
    u.distanceKm += t.distanceKm;
    u.drivingMin += t.durationMin - t.idleMin;
    u.idleMin += t.idleMin;
    u.trips++;
    map.set(t.vehicleId, u);
  }
  return map;
}

export function topBy(usage: Map<string, VehicleUsage>, key: "distanceKm" | "drivingMin", n = 5) {
  return [...usage.values()].sort((a, b) => b[key] - a[key]).slice(0, n);
}

/* ───────────── Reminders (BFF: expiry 3/7/30 days, insurance, maintenance, licence) ───────────── */

export type ReminderKind = "service" | "insurance" | "maintenance" | "licence";

export interface Reminder {
  id: string;
  kind: ReminderKind;
  label: string;
  subject: string;
  href: string;
  dueDate: string;
  daysLeft: number;
}

export function upcomingReminders(vehicles: Vehicle[], drivers: Driver[], windowDays = 30, now = DEMO_NOW): Reminder[] {
  const list: Reminder[] = [];
  const push = (kind: ReminderKind, label: string, subject: string, href: string, due?: string) => {
    if (!due) return;
    const daysLeft = Math.ceil((new Date(due).getTime() - now.getTime()) / DAY);
    if (daysLeft <= windowDays) list.push({ id: `${kind}-${href}`, kind, label, subject, href, dueDate: due, daysLeft });
  };
  for (const v of vehicles) {
    const subject = `${v.vehicleName} · ${v.plate}`;
    const href = `/drive-vision/vehicles/${v.vehicleId}`;
    push("service", "Device service", subject, href, v.expireDate);
    push("insurance", "Insurance", subject, `${href}#insurance`, v.insuranceDueDate);
    push("maintenance", "Maintenance", subject, `${href}#maintenance`, v.maintainDate);
  }
  for (const d of drivers) push("licence", "Driving licence", d.name, `/drive-vision/drivers?driver=${d.driverId}`, d.licenceExpiry);
  return list.sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ───────────── Safety scoring (illustrative formula — not real telemetry) ───────────── */

export const SEVERITY_WEIGHTS: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1 };

/**
 * Illustrative safety score (0–100), documented in the UI:
 *   weighted events = Σ severity weight (critical 10, high 6, medium 3, low 1),
 *                     excluding false positives and device-offline events
 *   rate            = weighted events per 100 km (distance floored at 50 km)
 *   score           = clamp(100 − 3 × rate, 0, 100)
 */
export function safetyScore(weightedEvents: number, distanceKm: number) {
  const rate = (weightedEvents / Math.max(distanceKm, 50)) * 100;
  return Math.max(0, Math.min(100, Math.round(100 - 3 * rate)));
}

export interface ScoreRow {
  id: string;
  events: number;
  weighted: number;
  distanceKm: number;
  score: number;
  critical: number;
}

function scoreBy(alarms: Alarm[], trips: Trip[], range: DateRange, key: (x: { vehicleId: string; driverId?: string }) => string | undefined) {
  const rows = new Map<string, ScoreRow>();
  const get = (id: string) => rows.get(id) ?? rows.set(id, { id, events: 0, weighted: 0, distanceKm: 0, score: 100, critical: 0 }).get(id)!;
  for (const t of tripsInRange(trips, range)) {
    const id = key(t);
    if (id) get(id).distanceKm += t.distanceKm;
  }
  for (const a of alarmsInRange(alarms, range)) {
    if (!isSafetyEvent(a) || a.status === "false_positive") continue;
    const id = key(a);
    if (!id) continue;
    const row = get(id);
    row.events++;
    row.weighted += SEVERITY_WEIGHTS[a.severity];
    if (a.severity === "critical") row.critical++;
  }
  for (const row of rows.values()) row.score = safetyScore(row.weighted, row.distanceKm);
  return [...rows.values()];
}

export const vehicleScores = (alarms: Alarm[], trips: Trip[], range: DateRange) => scoreBy(alarms, trips, range, (x) => x.vehicleId);
export const driverScores = (alarms: Alarm[], trips: Trip[], range: DateRange) => scoreBy(alarms, trips, range, (x) => x.driverId);

export function fleetScore(rows: ScoreRow[]) {
  const weighted = rows.reduce((s, r) => s + r.weighted, 0);
  const distance = rows.reduce((s, r) => s + r.distanceKm, 0);
  return safetyScore(weighted, distance);
}

export function scoreBand(score: number): { label: string; tone: "success" | "warning" | "serious" | "danger" } {
  if (score >= 85) return { label: "Good", tone: "success" };
  if (score >= 70) return { label: "Fair", tone: "warning" };
  if (score >= 50) return { label: "At risk", tone: "serious" };
  return { label: "High risk", tone: "danger" };
}

/* ───────────── Distributions ───────────── */

export function categoryDistribution(alarms: Alarm[]) {
  const counts: Record<AlarmCategory, number> = { ADAS: 0, DSM: 0, BSD: 0, General: 0 };
  for (const a of alarms) if (isSafetyEvent(a)) counts[a.category]++;
  return counts;
}

export function typeRanking(alarms: Alarm[]) {
  const counts = new Map<string, number>();
  for (const a of alarms) if (isSafetyEvent(a)) counts.set(a.alarmType, (counts.get(a.alarmType) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, label: ALARM_TYPES[type as keyof typeof ALARM_TYPES].label, count })).sort((a, b) => b.count - a.count);
}

/** Weekly severity trend for the last N weeks ending at range end. */
export function weeklySeverity(alarms: Alarm[], weeks: number, now = DEMO_NOW) {
  const end = startOfFleetDay(now).getTime() + DAY;
  return Array.from({ length: weeks }, (_, i) => {
    const wEnd = end - (weeks - 1 - i) * 7 * DAY;
    const wStart = wEnd - 7 * DAY;
    const row = { label: `${formatShortDate(new Date(wStart + HOUR * 12))}`, critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of alarms) {
      const t = new Date(a.alarmTime).getTime();
      if (t >= wStart && t < wEnd && isSafetyEvent(a) && a.status !== "false_positive") row[a.severity]++;
    }
    return row;
  });
}

/** Open = new, acknowledged or in progress (all alarm types, matching the Alerts screen). */
export function openAlarmCount(alarms: Alarm[]) {
  return alarms.filter(isOpen).length;
}
