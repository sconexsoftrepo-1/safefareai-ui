import type { AlarmDto, DeviceDto, DeviceStateDto, GroupDto } from "@/features/drive-vision/api/types";
import type { Reminder, ReminderKind } from "@/features/drive-vision/selectors";
import { DAY, HOUR, MINUTE } from "@/features/drive-vision/utils/time";

/**
 * Pure derivations for the live dashboard. Every number comes from API fields with a
 * defined meaning; undocumented codes (statusCode, positionMode, severity scale) are not
 * interpreted. Thresholds are listed here so the UI can state them.
 */

/** A report newer than this counts as current for "moving now". */
export const CURRENT_REPORT_MS = 5 * MINUTE;
/** A device whose latest report is older than this is flagged as stale GPS. */
export const STALE_REPORT_MS = HOUR;
/** batteryPct below this is "low battery". */
export const LOW_BATTERY_PCT = 20;
/** Service expiry within this many days counts as "expiring". */
export const EXPIRING_DAYS = 30;

const time = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);

export function deviceStats(devices: DeviceDto[], states: DeviceStateDto[], now: Date) {
  const n = now.getTime();
  let expired = 0;
  let expiringSoon = 0;
  for (const d of devices) {
    const t = time(d.expiresAt);
    if (Number.isNaN(t)) continue;
    if (t < n) expired++;
    else if (t - n <= EXPIRING_DAYS * DAY) expiringSoon++;
  }
  const reportTimes = states.map((s) => time(s.deviceTime)).filter((t) => !Number.isNaN(t));
  const latestReport = reportTimes.length ? new Date(Math.max(...reportTimes)) : null;
  return {
    expired,
    expiringSoon,
    latestReport,
    /** States with no report or a report older than STALE_REPORT_MS. */
    staleGps: states.filter((s) => {
      const t = time(s.deviceTime);
      return Number.isNaN(t) || n - t > STALE_REPORT_MS;
    }).length,
    movingNow: states.filter((s) => (s.speedKmh ?? 0) > 0 && n - time(s.deviceTime) <= CURRENT_REPORT_MS).length,
    lowBattery: states.filter((s) => typeof s.batteryPct === "number" && s.batteryPct < LOW_BATTERY_PCT).length,
  };
}

/** Service / insurance / maintenance dates from DeviceDto within the window (overdue included). Driver licence dates aren't in the API. */
export function deviceReminders(devices: DeviceDto[], windowDays: number, now: Date): Reminder[] {
  const fields: { key: "expiresAt" | "insuranceDueAt" | "maintenanceDueAt"; kind: ReminderKind; label: string }[] = [
    { key: "expiresAt", kind: "service", label: "Service expiry" },
    { key: "insuranceDueAt", kind: "insurance", label: "Insurance due" },
    { key: "maintenanceDueAt", kind: "maintenance", label: "Maintenance due" },
  ];
  const out: Reminder[] = [];
  for (const d of devices) {
    for (const f of fields) {
      const due = d[f.key];
      if (!due) continue;
      const daysLeft = Math.floor((time(due) - now.getTime()) / DAY);
      if (daysLeft > windowDays) continue;
      out.push({ id: `${d.id}-${f.key}`, kind: f.kind, label: f.label, subject: d.name ?? d.terminalNo ?? `Device ${d.id}`, href: "/drive-vision/vehicles", dueDate: due, daysLeft });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export interface LiveAlarm extends AlarmDto {
  kind: "ai" | "routine";
}

export function mergeAlarms(ai: AlarmDto[] | undefined, routine: AlarmDto[] | undefined): LiveAlarm[] {
  return [...(ai ?? []).map((a) => ({ ...a, kind: "ai" as const })), ...(routine ?? []).map((a) => ({ ...a, kind: "routine" as const }))].sort(
    (a, b) => time(b.alarmTime) - time(a.alarmTime)
  );
}

export interface GroupCardData {
  id: string;
  name: string;
  deviceCount: number;
  /** Alarms in range for this group's devices; null when alarm data failed to load. */
  events: number | null;
}

export function groupCards(groups: GroupDto[], devices: DeviceDto[], alarms: LiveAlarm[] | null): GroupCardData[] {
  return groups.map((g) => {
    const ids = new Set(devices.filter((d) => d.groupId === g.id).map((d) => d.id));
    return {
      id: String(g.id),
      name: g.name ?? `Group ${g.id}`,
      deviceCount: ids.size,
      events: alarms ? alarms.filter((a) => ids.has(a.deviceId)).length : null,
    };
  });
}
