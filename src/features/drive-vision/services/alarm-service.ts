import type { Alarm, AlarmFilters, AlarmUpdate } from "../types";
import { ALARM_TYPES } from "../mock-data/catalog";
import { fleetStore } from "../store/fleet-store";
import { demoClock, localId, ServiceError, simulateLatency } from "./core";
import { CURRENT_USER_ID } from "../mock-data/seed";

export const OPEN_STATUSES = new Set(["new", "acknowledged", "in_progress"]);

export function isOpen(alarm: Alarm) {
  return OPEN_STATUSES.has(alarm.status);
}

export function filterAlarms(alarms: Alarm[], filters: AlarmFilters, vehicleLookup?: (id: string) => { plate: string; vehicleName: string } | undefined) {
  const q = filters.search?.trim().toLowerCase() ?? "";
  return alarms.filter((a) => {
    if (filters.severity && filters.severity !== "all" && a.severity !== filters.severity) return false;
    if (filters.status && filters.status !== "all") {
      if (filters.status === "open" ? !isOpen(a) : a.status !== filters.status) return false;
    }
    if (filters.category && filters.category !== "all" && a.category !== filters.category) return false;
    if (filters.vehicleId && a.vehicleId !== filters.vehicleId) return false;
    if (filters.from && a.alarmTime < filters.from) return false;
    if (filters.to && a.alarmTime > filters.to) return false;
    if (q) {
      const v = vehicleLookup?.(a.vehicleId);
      const hay = [ALARM_TYPES[a.alarmType].label, a.address, a.terminalNo, a.alarmId, v?.plate ?? "", v?.vehicleName ?? ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Alarms & AI events. Reads map to vendor 5.1 recentlyAdasList / 5.8 getAlarmInfo
 * (5.4 is limited to 24 h). Handling (status, assignee, notes, outcome) is BFF-owned:
 * the vendor API is read-only for alarms.
 */
export const alarmService = {
  async listAlarms(filters: AlarmFilters = {}) {
    await simulateLatency();
    const { vehicles, alarms } = fleetStore.getState();
    const byId = new Map(vehicles.map((v) => [v.vehicleId, v]));
    return filterAlarms(alarms, filters, (id) => byId.get(id));
  },

  async updateAlarm(id: string, update: AlarmUpdate): Promise<Alarm> {
    await simulateLatency(280);
    const existing = fleetStore.getState().alarms.find((a) => a.alarmId === id);
    if (!existing) throw new ServiceError("Event not found.");
    const next: Alarm = { ...existing };
    if (update.status) next.status = update.status;
    if (update.assigneeId !== undefined) {
      next.assigneeId = update.assigneeId ?? undefined;
      if (update.assigneeId && next.status === "new") next.status = "in_progress";
    }
    if (update.outcome) next.outcome = update.outcome;
    if (update.status === "false_positive") next.outcome = "false_positive";
    if (update.note?.trim()) {
      const author = fleetStore.getState().users.find((u) => u.userId === CURRENT_USER_ID)?.userId ?? CURRENT_USER_ID;
      next.notes = [...existing.notes, { id: localId("note"), author, text: update.note.trim(), createdAt: demoClock().toISOString() }];
    }
    fleetStore.setState((s) => ({
      alarms: s.alarms.map((a) => (a.alarmId === id ? next : a)),
      vehicles: s.vehicles.map((v) => {
        if (v.vehicleId !== existing.vehicleId) return v;
        const stillAlarming = s.alarms.some((a) => a.vehicleId === v.vehicleId && a.alarmId !== id && (a.status === "new" || a.status === "acknowledged") && a.alarmType !== "device_offline");
        const thisAlarming = next.status === "new" || next.status === "acknowledged";
        return { ...v, telemetry: { ...v.telemetry, alarm: v.telemetry.alarm && (stillAlarming || thisAlarming) } };
      }),
    }));
    return next;
  },

  async bulkUpdate(ids: string[], update: AlarmUpdate) {
    for (const id of ids) await this.updateAlarm(id, update);
    return ids.length;
  },
};
