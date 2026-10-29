/**
 * Local, rule-based assistant. Pattern-matches a question and answers from the
 * in-memory sample data. No LLM, no network. Every answer is labelled as sample data.
 */
import type { FleetState } from "@/features/drive-vision/store/fleet-store";
import { ALARM_TYPES, DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import { alarmsInRange, driverScores, fleetCounts, isSafetyEvent, tripsInRange, upcomingReminders } from "@/features/drive-vision/selectors";
import { isOpen } from "@/features/drive-vision/services/alarm-service";
import { resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatDateTime, formatKm, formatNumber, formatRelative } from "@/features/drive-vision/utils/format";

export interface AssistantItem {
  label: string;
  sub?: string;
  href?: string;
}

export interface AssistantAnswer {
  text: string;
  items?: AssistantItem[];
  link?: { label: string; href: string };
}

export const SUGGESTED_PROMPTS = [
  "Summarize today's fleet activity",
  "Show offline vehicles",
  "Which vehicles have the most safety events?",
  "Show upcoming maintenance reminders",
  "Summarize the selected vehicle",
  "Show unresolved high-severity alerts",
];

const has = (q: string, ...patterns: RegExp[]) => patterns.some((p) => p.test(q));

function vehicleLabel(s: FleetState, id: string) {
  const v = s.vehicles.find((x) => x.vehicleId === id);
  return v ? `${v.vehicleName} · ${v.plate}` : "Removed vehicle";
}

function summarizeVehicle(s: FleetState, vehicleId: string): AssistantAnswer {
  const v = s.vehicles.find((x) => x.vehicleId === vehicleId);
  if (!v) return { text: "That vehicle is no longer in the sample fleet." };
  const t = v.telemetry;
  const driver = s.drivers.find((d) => d.driverId === v.driverId);
  const group = s.groups.find((g) => g.groupId === v.groupId);
  const week = resolveDateRange("7d", DEMO_NOW);
  const events = alarmsInRange(s.alarms, week).filter((a) => a.vehicleId === v.vehicleId && isSafetyEvent(a));
  const open = events.filter(isOpen).length;
  const distance = tripsInRange(s.trips, week)
    .filter((tr) => tr.vehicleId === v.vehicleId)
    .reduce((sum, tr) => sum + tr.distanceKm, 0);
  const stateText = { moving: `moving at ${t.speed} km/h`, idle: "idling with the engine on", parked: "parked", offline: `offline since ${formatRelative(t.lastReportTime, DEMO_NOW)}` }[t.vehicleState];
  return {
    text: `${v.vehicleName} (${v.plate}) in ${group?.groupName ?? "an unassigned group"} is ${stateText} near ${t.address}. ${driver ? `Assigned driver: ${driver.name}.` : "No driver assigned."} In the last 7 days it covered ${formatKm(distance)} with ${events.length} safety events (${open} still open).`,
    items: [
      { label: "Odometer", sub: `${formatNumber(t.mileage)} km` },
      { label: "Device", sub: `${v.terminalType} · ${v.cameraNum} camera${v.cameraNum === 1 ? "" : "s"}` },
      ...(t.fuel !== undefined ? [{ label: "Fuel", sub: `${t.fuel}%` }] : []),
      ...(t.temperature !== undefined ? [{ label: "Cargo temperature", sub: `${t.temperature} °C` }] : []),
    ],
    link: { label: "Open vehicle", href: `/drive-vision/vehicles/${v.vehicleId}` },
  };
}

export function answerQuestion(question: string, s: FleetState): AssistantAnswer {
  const q = question.toLowerCase().trim();
  const today = resolveDateRange("today", DEMO_NOW);
  const week = resolveDateRange("7d", DEMO_NOW);

  if (!q) return { text: "Ask me about the sample fleet — status, offline vehicles, events, reminders or a specific vehicle." };

  // Specific vehicle mentioned by name or plate.
  const compact = q.replace(/\s+/g, "");
  const mentioned = s.vehicles.find((v) => compact.includes(v.plate.replace(/\s+/g, "").toLowerCase()) || new RegExp(`\\b${v.vehicleName.toLowerCase()}\\b`).test(q));
  if (mentioned) return summarizeVehicle(s, mentioned.vehicleId);

  // A vehicle group mentioned by name (used by the Overview group cards' "Ask Iris about it").
  const group = s.groups.find((g) => q.includes(g.groupName.toLowerCase()));
  if (group) {
    const vs = s.vehicles.filter((v) => v.groupId === group.groupId);
    const ids = new Set(vs.map((v) => v.vehicleId));
    const online = vs.filter((v) => v.telemetry.vehicleState !== "offline").length;
    const events = alarmsInRange(s.alarms, week).filter((a) => ids.has(a.vehicleId) && isSafetyEvent(a) && a.status !== "false_positive");
    const open = s.alarms.filter((a) => ids.has(a.vehicleId) && isOpen(a));
    const km = tripsInRange(s.trips, week)
      .filter((t) => ids.has(t.vehicleId))
      .reduce((sum, t) => sum + t.distanceKm, 0);
    const byType = new Map<string, number>();
    events.forEach((a) => byType.set(a.alarmType, (byType.get(a.alarmType) ?? 0) + 1));
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      text: `${group.groupName}: ${online} of ${vs.length} vehicles online. In the last 7 days the group drove ${formatKm(km)} with ${events.length} safety events${top ? `, mostly “${ALARM_TYPES[top[0] as keyof typeof ALARM_TYPES].label}”` : ""}. ${open.length} alert${open.length === 1 ? " is" : "s are"} still open.`,
      items: vs
        .filter((v) => v.telemetry.alarm || v.telemetry.vehicleState === "offline")
        .slice(0, 4)
        .map((v) => ({ label: `${v.vehicleName} · ${v.plate}`, sub: v.telemetry.alarm ? "Active alarm" : `Offline · last report ${formatRelative(v.telemetry.lastReportTime, DEMO_NOW)}`, href: `/drive-vision/vehicles/${v.vehicleId}` })),
      link: { label: "Open vehicles", href: "/drive-vision/vehicles" },
    };
  }

  if (has(q, /selected/, /this vehicle/, /current vehicle/)) {
    if (!s.selectedVehicleId) {
      return {
        text: "No vehicle is selected right now. Select one on Live Monitoring, Historical Video or a vehicle page, then ask again.",
        link: { label: "Go to Live Monitoring", href: "/drive-vision/monitoring" },
      };
    }
    return summarizeVehicle(s, s.selectedVehicleId);
  }

  if (has(q, /offline/, /disconnected/, /not reporting/)) {
    const offline = s.vehicles.filter((v) => v.telemetry.vehicleState === "offline").sort((a, b) => a.telemetry.lastReportTime.localeCompare(b.telemetry.lastReportTime));
    if (offline.length === 0) return { text: "All sample vehicles are currently reporting." };
    return {
      text: `${offline.length} of ${s.vehicles.length} vehicles are offline. The longest-silent devices are listed first.`,
      items: offline.slice(0, 6).map((v) => ({ label: `${v.vehicleName} · ${v.plate}`, sub: `Last report ${formatRelative(v.telemetry.lastReportTime, DEMO_NOW)} · ${v.telemetry.address}`, href: `/drive-vision/monitoring?vehicle=${v.vehicleId}` })),
      link: { label: "View on map", href: "/drive-vision/monitoring?status=offline" },
    };
  }

  if (has(q, /most (safety )?events/, /riskiest/, /high[- ]risk/, /most alarms/, /worst vehicle/)) {
    const counts = new Map<string, number>();
    for (const a of alarmsInRange(s.alarms, week)) if (isSafetyEvent(a) && a.status !== "false_positive") counts.set(a.vehicleId, (counts.get(a.vehicleId) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      text: "Vehicles with the most safety events in the last 7 days (false positives excluded):",
      items: ranked.map(([id, n]) => ({ label: vehicleLabel(s, id), sub: `${n} events`, href: `/drive-vision/vehicles/${id}` })),
      link: { label: "Open Safety Analytics", href: "/drive-vision/safety" },
    };
  }

  if (has(q, /maint/, /remind/, /expir/, /insurance/, /renew/, /licen[cs]e/)) {
    const reminders = upcomingReminders(s.vehicles, s.drivers, 30);
    if (reminders.length === 0) return { text: "Nothing is due in the next 30 days." };
    return {
      text: `${reminders.length} reminders fall due within 30 days (including overdue items).`,
      items: reminders.slice(0, 6).map((r) => ({ label: `${r.label} — ${r.subject}`, sub: r.daysLeft < 0 ? `Overdue by ${-r.daysLeft} d` : r.daysLeft === 0 ? "Due today" : `Due in ${r.daysLeft} d`, href: r.href })),
      link: { label: "Open Fleet Overview", href: "/drive-vision/overview" },
    };
  }

  if (has(q, /unresolved/, /high[- ]severity/, /critical/, /open alert/, /open event/, /pending/)) {
    const open = s.alarms.filter((a) => isOpen(a) && (a.severity === "high" || a.severity === "critical"));
    if (open.length === 0) return { text: "There are no unresolved high or critical events in the sample data." };
    return {
      text: `${open.length} high or critical events are still open.`,
      items: open.slice(0, 6).map((a) => ({ label: `${ALARM_TYPES[a.alarmType].label} — ${vehicleLabel(s, a.vehicleId)}`, sub: `${a.severity} · ${formatDateTime(a.alarmTime)}`, href: `/drive-vision/alerts?alarm=${a.alarmId}` })),
      link: { label: "Open Alerts & Events", href: "/drive-vision/alerts?status=open&severity=high" },
    };
  }

  if (has(q, /driver/)) {
    const rows = driverScores(s.alarms, s.trips, resolveDateRange("30d", DEMO_NOW)).sort((a, b) => a.score - b.score);
    return {
      text: "Drivers with the lowest illustrative safety scores over 30 days:",
      items: rows.slice(0, 5).map((r) => ({ label: s.drivers.find((d) => d.driverId === r.id)?.name ?? "Unknown driver", sub: `Score ${r.score} · ${r.events} events`, href: `/drive-vision/drivers?driver=${r.id}` })),
      link: { label: "Open Drivers", href: "/drive-vision/drivers" },
    };
  }

  if (has(q, /speed/)) {
    const speeding = alarmsInRange(s.alarms, week).filter((a) => a.alarmType === "overspeed");
    return {
      text: `${speeding.length} overspeed events were recorded in the last 7 days.`,
      items: speeding.slice(0, 5).map((a) => ({ label: vehicleLabel(s, a.vehicleId), sub: `${a.speed} km/h · ${formatDateTime(a.alarmTime)}`, href: `/drive-vision/alerts?alarm=${a.alarmId}` })),
    };
  }

  if (has(q, /geofence/, /zone/)) {
    return {
      text: `${s.geofences.length} geofences are configured.`,
      items: s.geofences.slice(0, 6).map((g) => ({ label: g.pathName, sub: `${g.pathType === 2 ? "Line" : g.areaType === "circle" ? "Circle" : "Polygon"} · ${g.selectIds.length} vehicles`, href: "/drive-vision/geofences" })),
    };
  }

  if (has(q, /summar/, /today/, /overview/, /status/, /how is/, /activity/)) {
    const c = fleetCounts(s.vehicles);
    const events = alarmsInRange(s.alarms, today).filter(isSafetyEvent);
    const trips = tripsInRange(s.trips, today);
    const km = trips.reduce((sum, t) => sum + t.distanceKm, 0);
    const byType = new Map<string, number>();
    events.forEach((a) => byType.set(a.alarmType, (byType.get(a.alarmType) ?? 0) + 1));
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      text: `Today so far: ${c.online} of ${c.total} vehicles online (${c.moving} moving, ${c.idle} idle, ${c.parked} parked) and ${c.offline} offline. ${trips.length} trips were completed covering ${formatKm(km)}. ${events.length} safety events were recorded${top ? `, most often “${ALARM_TYPES[top[0] as keyof typeof ALARM_TYPES].label}” (${top[1]})` : ""}.`,
      items: [
        { label: "Open alerts", sub: String(s.alarms.filter(isOpen).length), href: "/drive-vision/alerts?status=open" },
        { label: "Devices expiring in 30 days", sub: String(c.expiringSoon), href: "/drive-vision/vehicles?expiry=soon" },
      ],
    };
  }

  if (has(q, /help/, /what can you/, /hello/, /^hi\b/, /hey/)) {
    return { text: "I can summarise the sample fleet, list offline vehicles, rank vehicles or drivers by safety events, show reminders, unresolved alerts, geofences, or summarise a vehicle by plate (e.g. “TS 09 …”) or name (e.g. “NL-03”)." };
  }

  return {
    text: "I can't answer that with the sample data. Try one of the suggestions below, or ask about a vehicle by plate or name.",
  };
}
