/**
 * Deterministic seed data for the SafeFare AI demo.
 *
 * Everything is generated from fixed seeds relative to DEMO_NOW, so the server and
 * client produce identical records, and every dashboard total is derived from these
 * underlying entities (never hard-coded).
 */
import type {
  Alarm,
  AlarmStatus,
  AlarmTypeCode,
  CommandRecord,
  Driver,
  FleetNotification,
  FleetUser,
  Geofence,
  ObjectType,
  PlateColor,
  Severity,
  Trip,
  Vehicle,
  VehicleGroup,
  VehicleState,
} from "../types";
import { createRng } from "../utils/random";
import { addMs, DAY, HOUR, MINUTE, startOfFleetDay } from "../utils/time";
import { ALARM_TYPES, CITY_AREAS, DEMO_NOW, TERMINAL_MODELS } from "./catalog";
import { buildTrack, nearestAreaAddress, planStops, polylineKm, positionAt, routeGeometry } from "./routes";

const iso = (d: Date) => d.toISOString();
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/* ───────────── Users (vendor 6.4 user tree) ───────────── */

export const CURRENT_USER_ID = "u-100";

const seedUsers: FleetUser[] = [
  { userId: "u-100", userName: "Sconex Operations", parentId: null, email: "ops@sconex.example", phone: "+91 40 4000 1000", role: "Admin", createdAt: "2023-02-01T04:30:00.000Z" },
  { userId: "u-110", userName: "Priya Raman", parentId: "u-100", email: "priya.raman@sconex.example", phone: "+91 98480 11021", role: "Manager", createdAt: "2023-03-14T05:00:00.000Z" },
  { userId: "u-120", userName: "Arjun Mehta", parentId: "u-100", email: "arjun.mehta@sconex.example", phone: "+91 98490 22034", role: "Manager", createdAt: "2023-04-02T05:00:00.000Z" },
  { userId: "u-130", userName: "Kavya Reddy", parentId: "u-100", email: "kavya.reddy@sconex.example", phone: "+91 90000 33047", role: "Manager", createdAt: "2024-01-09T05:00:00.000Z" },
  { userId: "u-121", userName: "Sneha Iyer", parentId: "u-120", email: "sneha.iyer@sconex.example", phone: "+91 91000 44110", role: "Manager", createdAt: "2024-06-18T05:00:00.000Z" },
  { userId: "u-111", userName: "Rahul Verma", parentId: "u-110", phone: "+91 99490 55120", role: "Driver", createdAt: "2024-02-20T05:00:00.000Z" },
  { userId: "u-112", userName: "Imran Khan", parentId: "u-110", phone: "+91 99630 66231", role: "Driver", createdAt: "2024-05-11T05:00:00.000Z" },
  { userId: "u-122", userName: "Vikram Das", parentId: "u-121", phone: "+91 97010 77342", role: "Driver", createdAt: "2024-08-01T05:00:00.000Z" },
  { userId: "u-131", userName: "Farhan Ali", parentId: "u-130", phone: "+91 96660 88453", role: "Driver", createdAt: "2025-01-15T05:00:00.000Z" },
];

/* ───────────── Groups (vendor 2.5) ───────────── */

interface GroupSpec {
  group: VehicleGroup;
  prefix: string;
  count: number;
  types: string[];
  models: string[];
  homeAreas: number[];
  objectType: ObjectType;
  plateColor: PlateColor;
  sensors: { fuel?: boolean; temperature?: boolean; load?: boolean };
}

const GROUP_SPECS: GroupSpec[] = [
  {
    group: { groupId: "g-01", groupName: "North Logistics", userId: "u-110", email: "north.logistics@sconex.example", phone: "+91 40 4000 2001" },
    prefix: "NL", count: 10, types: ["Heavy truck", "Light truck"], models: ["AD-Plus 2.0 MDVR", "X3 4G Edge MDVR"],
    homeAreas: [3, 14, 2], objectType: "car", plateColor: "yellow", sensors: { fuel: true, load: true },
  },
  {
    group: { groupId: "g-02", groupName: "City Distribution", userId: "u-110", email: "city.dist@sconex.example", phone: "+91 40 4000 2002" },
    prefix: "CD", count: 10, types: ["Delivery van", "Pickup"], models: ["JC450 AI Dashcam", "AD-Plus 2.0 MDVR"],
    homeAreas: [4, 5, 7, 8], objectType: "car", plateColor: "yellow", sensors: { fuel: true },
  },
  {
    group: { groupId: "g-03", groupName: "Staff Shuttles", userId: "u-120", email: "shuttles@sconex.example", phone: "+91 40 4000 2003" },
    prefix: "SS", count: 8, types: ["Staff shuttle"], models: ["AD-Plus 2.0 MDVR"],
    homeAreas: [0, 1, 2], objectType: "car", plateColor: "yellow", sensors: { fuel: true },
  },
  {
    group: { groupId: "g-04", groupName: "City Buses", userId: "u-121", email: "buses@sconex.example", phone: "+91 40 4000 2004" },
    prefix: "CB", count: 6, types: ["City bus"], models: ["X3 4G Edge MDVR"],
    homeAreas: [6, 10, 13], objectType: "car", plateColor: "yellow", sensors: { fuel: true },
  },
  {
    group: { groupId: "g-05", groupName: "Cold Chain", userId: "u-130", email: "coldchain@sconex.example", phone: "+91 40 4000 2005" },
    prefix: "CC", count: 8, types: ["Refrigerated truck"], models: ["AD-Plus 2.0 MDVR"],
    homeAreas: [11, 12, 13], objectType: "car", plateColor: "yellow", sensors: { fuel: true, temperature: true },
  },
  {
    group: { groupId: "g-06", groupName: "Executive Pool", userId: "u-100", email: "exec.pool@sconex.example", phone: "+91 40 4000 2006" },
    prefix: "EX", count: 6, types: ["Sedan"], models: ["GT06N Tracker", "VL502 Telematics"],
    homeAreas: [7, 0, 5], objectType: "car", plateColor: "white", sensors: {},
  },
];

const seedGroups = GROUP_SPECS.map((s) => s.group);

/* ───────────── Drivers (BFF) ───────────── */

const FIRST_NAMES_M = ["Ravi", "Suresh", "Mahesh", "Naveen", "Srinivas", "Ramesh", "Anil", "Kiran", "Venkat", "Sai", "Prakash", "Ajay", "Mohammed", "Syed", "Harish", "Ganesh", "Raju", "Teja", "Nikhil", "Abdul", "Rakesh", "Vamsi", "Manoj", "Sandeep"];
const FIRST_NAMES_F = ["Lakshmi", "Swathi", "Divya", "Anitha", "Padma", "Shirisha", "Bhavana", "Ayesha"];
const LAST_NAMES = ["Reddy", "Rao", "Goud", "Naidu", "Sharma", "Kumar", "Yadav", "Chary", "Patel", "Hussain", "Varma", "Prasad", "Babu", "Shaik", "Murthy", "Pillai"];

function buildDrivers(): Driver[] {
  const rng = createRng(4242);
  const used = new Set<string>();
  const drivers: Driver[] = [];
  for (let i = 0; i < 46; i++) {
    const female = i % 7 === 3;
    let name = "";
    do {
      name = `${rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M)} ${rng.pick(LAST_NAMES)}`;
    } while (used.has(name));
    used.add(name);
    const join = addMs(DEMO_NOW, -rng.int(120, 1800) * DAY);
    const licenceYear = rng.int(2008, 2021);
    drivers.push({
      driverId: `d-${pad(i + 1, 3)}`,
      name,
      gender: female ? "female" : "male",
      phone: `+91 9${rng.int(100000000, 999999999)}`.replace(/(\+91 \d{5})(\d+)/, "$1 $2"),
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@drivers.sconex.example`,
      licenceNo: `TS${pad(rng.int(1, 36))}${licenceYear}${pad(rng.int(1, 9999999), 7)}`,
      licenceClass: rng.pick(["LMV-TR", "HMV", "HPMV", "HGMV"]),
      licenceExpiry: iso(addMs(DEMO_NOW, rng.int(200, 3200) * DAY)),
      icCardNo: `IC-${rng.int(100000, 999999)}`,
      joinDate: iso(join),
      status: "active",
    });
  }
  // A few licences close to expiry for reminder demos.
  drivers[4].licenceExpiry = iso(addMs(DEMO_NOW, 18 * DAY));
  drivers[17].licenceExpiry = iso(addMs(DEMO_NOW, 41 * DAY));
  drivers[29].licenceExpiry = iso(addMs(DEMO_NOW, -6 * DAY));
  return drivers;
}

/* ───────────── Vehicles / devices (vendor 1.4 + 3.1) ───────────── */

function digits(rng: ReturnType<typeof createRng>, count: number) {
  let s = "";
  for (let i = 0; i < count; i++) s += String(rng.int(0, 9));
  return s;
}

function buildVehicles(drivers: Driver[]): Vehicle[] {
  const rng = createRng(1337);
  const vehicles: Vehicle[] = [];
  let index = 0;
  let driverCursor = 0;

  for (const spec of GROUP_SPECS) {
    for (let n = 0; n < spec.count; n++) {
      index++;
      const modelName = rng.pick(spec.models);
      const model = TERMINAL_MODELS.find((m) => m.name === modelName)!;
      const cameraNum = model.maxCameras === 0 ? 0 : model.name.startsWith("JC450") ? 2 : rng.pick([4, 4, 6, 8].filter((c) => c <= model.maxCameras));
      const state: VehicleState = rng.weighted<VehicleState>([
        ["moving", 46],
        ["idle", 15],
        ["parked", 24],
        ["offline", 15],
      ]);
      const area = CITY_AREAS[rng.pick(spec.homeAreas)];
      const lat = area.lat + rng.float(-0.012, 0.012);
      const lon = area.lon + rng.float(-0.012, 0.012);
      const online = state !== "offline";
      const lastReport =
        state === "offline"
          ? addMs(DEMO_NOW, -rng.int(3 * 60, 5 * 24 * 60) * MINUTE)
          : addMs(DEMO_NOW, -rng.int(5, state === "parked" ? 300 : 90) * 1000);
      const activation = addMs(DEMO_NOW, -rng.int(200, 1100) * DAY);
      const vehicleType = rng.pick(spec.types);
      const hasDriver = !(spec.prefix === "EX" && n >= 4) && driverCursor < drivers.length - 4;
      const driver = hasDriver ? drivers[driverCursor++] : undefined;

      const vehicle: Vehicle = {
        vehicleId: `v-${pad(index, 3)}`,
        groupId: spec.group.groupId,
        plate: `TS ${pad(rng.pick([7, 8, 9, 10, 13, 15]))} ${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))} ${pad(rng.int(1000, 9999), 4)}`,
        plateColor: spec.plateColor,
        vehicleName: `${spec.prefix}-${pad(n + 1)}`,
        vehicleType,
        objectType: spec.objectType,
        terminalNo: `0${digits(rng, 11)}`,
        terminalType: model.name,
        protocol: model.protocols[0],
        cameraNum,
        sim: `89910${digits(rng, 14)}`,
        frameNo: `MA1${digits(rng, 3)}${String.fromCharCode(65 + rng.int(0, 25))}${digits(rng, 10)}`,
        remark: undefined,
        driverId: driver?.driverId,
        activationTime: iso(activation),
        expireDate: iso(addMs(activation, (Math.ceil((DEMO_NOW.getTime() - activation.getTime()) / (365 * DAY)) + (rng.chance(0.4) ? 1 : 0)) * 365 * DAY)),
        insuranceDueDate: iso(addMs(DEMO_NOW, rng.int(20, 340) * DAY)),
        maintainDate: iso(addMs(DEMO_NOW, rng.int(-10, 120) * DAY)),
        createTime: iso(activation),
        telemetry: {
          lat,
          lon,
          speed: state === "moving" ? rng.int(14, 72) : 0,
          direction: rng.int(0, 359),
          mileage: rng.int(12000, 240000),
          vehicleState: state,
          accState: state === "moving" || state === "idle",
          posState: state === "offline" ? rng.chance(0.4) : !rng.chance(0.04),
          power: state === "offline" ? rng.int(5, 60) : rng.int(62, 100),
          gsmSin: online ? rng.int(2, 5) : 0,
          netModel: rng.weighted<"4G" | "3G" | "2G">([["4G", 8], ["3G", 1], ["2G", 1]]),
          temperature: spec.sensors.temperature ? Math.round(rng.float(2.4, 7.6) * 10) / 10 : undefined,
          fuel: spec.sensors.fuel ? rng.int(14, 96) : undefined,
          load: spec.sensors.load ? rng.int(800, 9200) : undefined,
          alarm: false,
          lastReportTime: iso(lastReport),
          address: `${area.street}, ${area.name}`,
        },
      };
      if (driver) driver.assignedVehicleId = vehicle.vehicleId;
      vehicles.push(vehicle);
    }
  }

  // Curated edge cases so reminders and alerts have something to show.
  const tweak = (i: number, fn: (v: Vehicle) => void) => vehicles[i] && fn(vehicles[i]);
  tweak(3, (v) => (v.expireDate = iso(addMs(DEMO_NOW, 5 * DAY))));
  tweak(11, (v) => (v.expireDate = iso(addMs(DEMO_NOW, 12 * DAY))));
  tweak(20, (v) => (v.expireDate = iso(addMs(DEMO_NOW, 26 * DAY))));
  tweak(33, (v) => (v.expireDate = iso(addMs(DEMO_NOW, -4 * DAY))));
  tweak(7, (v) => (v.insuranceDueDate = iso(addMs(DEMO_NOW, 9 * DAY))));
  tweak(25, (v) => (v.insuranceDueDate = iso(addMs(DEMO_NOW, 3 * DAY))));
  tweak(14, (v) => (v.maintainDate = iso(addMs(DEMO_NOW, -3 * DAY))));
  tweak(28, (v) => (v.maintainDate = iso(addMs(DEMO_NOW, 6 * DAY))));
  tweak(2, (v) => {
    v.telemetry.vehicleState = "moving";
    v.telemetry.speed = 94;
    v.telemetry.accState = true;
  });
  tweak(37, (v) => {
    if (v.telemetry.temperature !== undefined) v.telemetry.temperature = 11.4;
  });
  tweak(40, (v) => (v.remark = "Spare unit — kept at HQ"));

  // Off-duty / on-leave drivers are the unassigned tail.
  drivers.filter((d) => !d.assignedVehicleId).forEach((d, i) => (d.status = i % 2 === 0 ? "on_leave" : "off_duty"));
  return vehicles;
}

/* ───────────── Trips (BFF trip detection from 3.1/3.2) ───────────── */

function buildTrips(vehicles: Vehicle[]): Trip[] {
  const rng = createRng(9001);
  const trips: Trip[] = [];
  const today = startOfFleetDay(DEMO_NOW);
  let tripIndex = 0;

  for (const vehicle of vehicles) {
    const spec = GROUP_SPECS.find((s) => s.group.groupId === vehicle.groupId)!;
    const lastReport = new Date(vehicle.telemetry.lastReportTime).getTime();
    for (let d = 29; d >= 0; d--) {
      const dayStart = addMs(today, -d * DAY);
      const tripsToday = rng.weighted([[0, 2], [1, 4], [2, 5], [3, 2]] as const);
      let cursor = addMs(dayStart, rng.int(6 * 60, 9 * 60) * MINUTE).getTime();
      let fromArea = rng.pick(spec.homeAreas);
      for (let t = 0; t < tripsToday; t++) {
        const toArea = rng.int(0, CITY_AREAS.length - 1);
        if (toArea === fromArea) continue;
        const routeSeed = rng.int(1, 2 ** 30);
        const geometry = routeGeometry(fromArea, toArea, routeSeed);
        const distanceKm = Math.round(polylineKm(geometry) * 1.18 * 10) / 10;
        const avgSpeed = rng.int(20, 36);
        const stopCount = rng.weighted([[0, 3], [1, 4], [2, 3], [3, 1]] as const);
        const stops = planStops(geometry.length, stopCount, routeSeed);
        const stopMin = stops.reduce((sum, s) => sum + s.durationMin, 0);
        const durationMin = Math.round((distanceKm / avgSpeed) * 60 + stopMin);
        const idleMin = stops.filter((s) => s.idle).reduce((sum, s) => sum + s.durationMin, 0) + rng.int(1, 9);
        const start = cursor;
        const end = start + durationMin * MINUTE;
        if (end > DEMO_NOW.getTime() - 10 * MINUTE || end > lastReport) break;

        tripIndex++;
        trips.push({
          tripId: `t-${pad(tripIndex, 5)}`,
          vehicleId: vehicle.vehicleId,
          driverId: vehicle.driverId,
          startTime: new Date(start).toISOString(),
          endTime: new Date(end).toISOString(),
          distanceKm,
          durationMin,
          idleMin,
          maxSpeed: Math.min(98, avgSpeed + rng.int(22, 44)),
          avgSpeed,
          startAddress: `${CITY_AREAS[fromArea].street}, ${CITY_AREAS[fromArea].name}`,
          endAddress: `${CITY_AREAS[toArea].street}, ${CITY_AREAS[toArea].name}`,
          stopCount,
          alarmCount: 0,
          routeSeed,
          fromAreaIndex: fromArea,
          toAreaIndex: toArea,
        });
        cursor = end + rng.int(25, 150) * MINUTE;
        fromArea = toArea;
      }
    }
  }
  return trips;
}

/* ───────────── Alarms (vendor 5.1 / 5.8 shape + BFF handling) ───────────── */

const OPERATOR_IDS = ["u-100", "u-110", "u-120", "u-130", "u-121"];
const NOTE_SNIPPETS = [
  "Called driver — confirmed and coached on the spot.",
  "Reviewed clip: valid event, logged for weekly coaching.",
  "Clip shows sun glare; likely sensor false trigger.",
  "Driver took a rest break at the next stop.",
  "Escalated to fleet manager for follow-up.",
];

function severityFor(code: AlarmTypeCode, speed: number, rng: ReturnType<typeof createRng>): Severity {
  const base = ALARM_TYPES[code].baseSeverity;
  if (code === "overspeed") return speed >= 95 ? "critical" : speed >= 85 ? "high" : "medium";
  if (base === "medium" && speed > 60 && rng.chance(0.35)) return "high";
  if (base === "high" && rng.chance(0.15)) return "medium";
  return base;
}

function buildAlarms(vehicles: Vehicle[], trips: Trip[]): Alarm[] {
  const rng = createRng(7777);
  const alarms: Alarm[] = [];
  const risk = new Map(vehicles.map((v, i) => [v.vehicleId, i % 9 === 0 ? 3.2 : i % 5 === 0 ? 2.1 : rng.float(0.3, 1.4)]));
  const vehicleById = new Map(vehicles.map((v) => [v.vehicleId, v]));
  const aiTypes = Object.values(ALARM_TYPES).filter((t) => t.aiEvent);
  const generalTypes = Object.values(ALARM_TYPES).filter((t) => !t.aiEvent && t.code !== "device_offline");
  const tripWeights = trips.map((t) => [t, risk.get(t.vehicleId) ?? 1] as const);
  const now = DEMO_NOW.getTime();
  let n = 0;

  const statusFor = (time: number): AlarmStatus => {
    const ageH = (now - time) / HOUR;
    if (ageH < 3) return rng.weighted<AlarmStatus>([["new", 7], ["acknowledged", 2], ["in_progress", 1]]);
    if (ageH < 24) return rng.weighted<AlarmStatus>([["new", 3], ["acknowledged", 2], ["in_progress", 3], ["resolved", 4], ["false_positive", 1]]);
    if (ageH < 72) return rng.weighted<AlarmStatus>([["in_progress", 1], ["resolved", 6], ["false_positive", 2]]);
    return rng.weighted<AlarmStatus>([["resolved", 8], ["false_positive", 2]]);
  };

  // Events that happened during recorded trips (so they line up on track playback).
  const target = 430;
  for (let i = 0; i < target; i++) {
    const trip = rng.weighted(tripWeights);
    const vehicle = vehicleById.get(trip.vehicleId)!;
    const meta = vehicle.cameraNum > 0 && rng.chance(0.78) ? rng.weighted(aiTypes.map((t) => [t, t.weight] as const)) : rng.weighted(generalTypes.map((t) => [t, t.weight] as const));
    const { points } = buildTrack(trip);
    const start = new Date(trip.startTime).getTime();
    const end = new Date(trip.endTime).getTime();
    const time = start + rng.float(0.05, 0.95) * (end - start);
    const pos = positionAt(points, time);
    const speed = meta.code === "overspeed" ? rng.int(82, 104) : Math.max(0, pos.speed + rng.int(-6, 10));
    const status = statusFor(time);
    const assigneeId = status === "in_progress" || status === "resolved" || status === "false_positive" || (status === "acknowledged" && rng.chance(0.5)) ? rng.pick(OPERATOR_IDS) : undefined;
    const alarmTime = new Date(time);
    n++;
    alarms.push({
      alarmId: `a-${pad(n, 5)}`,
      vehicleId: vehicle.vehicleId,
      terminalNo: vehicle.terminalNo,
      driverId: trip.driverId,
      groupId: vehicle.groupId,
      alarmType: meta.code,
      category: meta.category,
      alarmTime: iso(alarmTime),
      speed,
      duration: meta.code === "overspeed" ? rng.int(8, 75) : rng.int(2, 14),
      mediaType: meta.aiEvent ? (rng.chance(0.75) ? "video" : "image") : "none",
      channel: meta.category === "DSM" ? 2 : 1,
      lat: pos.lat,
      lon: pos.lon,
      address: nearestAreaAddress(pos),
      severity: severityFor(meta.code, speed, rng),
      status,
      assigneeId,
      outcome:
        status === "false_positive"
          ? "false_positive"
          : status === "resolved"
            ? rng.weighted([["real_alarm", 5], ["dispatched", 2], ["voice_command", 2], ["test", 1]] as const)
            : undefined,
      notes:
        assigneeId && rng.chance(0.55)
          ? [{ id: `a-${pad(n, 5)}-n1`, author: assigneeId, text: status === "false_positive" ? NOTE_SNIPPETS[2] : rng.pick(NOTE_SNIPPETS), createdAt: iso(addMs(alarmTime, rng.int(4, 50) * MINUTE)) }]
          : [],
    });
  }

  // One "device offline" event per offline vehicle at its last report time.
  for (const v of vehicles.filter((x) => x.telemetry.vehicleState === "offline")) {
    n++;
    const time = new Date(v.telemetry.lastReportTime);
    alarms.push({
      alarmId: `a-${pad(n, 5)}`,
      vehicleId: v.vehicleId,
      terminalNo: v.terminalNo,
      driverId: v.driverId,
      groupId: v.groupId,
      alarmType: "device_offline",
      category: "General",
      alarmTime: iso(addMs(time, 5 * MINUTE)),
      speed: 0,
      duration: 0,
      mediaType: "none",
      channel: 0,
      lat: v.telemetry.lat,
      lon: v.telemetry.lon,
      address: v.telemetry.address,
      severity: (DEMO_NOW.getTime() - time.getTime()) / HOUR > 24 ? "medium" : "low",
      status: "new",
      notes: [],
    });
  }

  // A live overspeed event for the vehicle currently travelling at 94 km/h.
  const speeding = vehicles.find((v) => v.telemetry.speed >= 90);
  if (speeding) {
    n++;
    alarms.push({
      alarmId: `a-${pad(n, 5)}`,
      vehicleId: speeding.vehicleId,
      terminalNo: speeding.terminalNo,
      driverId: speeding.driverId,
      groupId: speeding.groupId,
      alarmType: "overspeed",
      category: "General",
      alarmTime: iso(addMs(DEMO_NOW, -4 * MINUTE)),
      speed: speeding.telemetry.speed,
      duration: 38,
      mediaType: "none",
      channel: 0,
      lat: speeding.telemetry.lat,
      lon: speeding.telemetry.lon,
      address: speeding.telemetry.address,
      severity: "high",
      status: "new",
      notes: [],
    });
  }

  alarms.sort((a, b) => b.alarmTime.localeCompare(a.alarmTime));

  // Back-fill trip alarm counts and live alarm flags so every view agrees.
  const byVehicle = new Map<string, Alarm[]>();
  for (const a of alarms) byVehicle.set(a.vehicleId, [...(byVehicle.get(a.vehicleId) ?? []), a]);
  for (const trip of trips) {
    const s = trip.startTime;
    const e = trip.endTime;
    trip.alarmCount = (byVehicle.get(trip.vehicleId) ?? []).filter((a) => a.alarmTime >= s && a.alarmTime <= e).length;
  }
  for (const v of vehicles) {
    v.telemetry.alarm = (byVehicle.get(v.vehicleId) ?? []).some(
      (a) => (a.status === "new" || a.status === "acknowledged") && now - new Date(a.alarmTime).getTime() < 6 * HOUR && a.alarmType !== "device_offline"
    );
  }
  return alarms;
}

/* ───────────── Geofences (vendor 10.1) ───────────── */

function buildGeofences(vehicles: Vehicle[]): Geofence[] {
  const ids = (groupId: string) => vehicles.filter((v) => v.groupId === groupId).map((v) => v.vehicleId);
  const created = (days: number) => iso(addMs(DEMO_NOW, -days * DAY));
  return [
    { pathId: "f-01", pathName: "HITEC City Campus", pathType: 1, areaType: "circle", ruleType: "both", pointList: [{ lat: 17.4474, lon: 78.3762 }], radius: 900, maxSpeed: 30, color: "#2f73c2", selectIds: ids("g-03"), voiceReminder: "Campus zone — 30 km/h", createdAt: created(220) },
    { pathId: "f-02", pathName: "Gachibowli Depot", pathType: 1, areaType: "polygon", ruleType: "exit", pointList: [{ lat: 17.4452, lon: 78.3418 }, { lat: 17.4461, lon: 78.3542 }, { lat: 17.4366, lon: 78.3561 }, { lat: 17.4349, lon: 78.3437 }], color: "#2e8a5c", selectIds: [...ids("g-03"), ...ids("g-06")], createdAt: created(180) },
    { pathId: "f-03", pathName: "Charminar Heritage Zone", pathType: 1, areaType: "circle", ruleType: "enter", pointList: [{ lat: 17.3616, lon: 78.4747 }], radius: 700, color: "#c03a36", selectIds: ids("g-01"), voiceReminder: "Heavy vehicles restricted", createdAt: created(150) },
    { pathId: "f-04", pathName: "Secunderabad Bus Terminal", pathType: 1, areaType: "polygon", ruleType: "both", pointList: [{ lat: 17.4448, lon: 78.4932 }, { lat: 17.4441, lon: 78.5046 }, { lat: 17.4352, lon: 78.5038 }, { lat: 17.4361, lon: 78.4925 }], maxSpeed: 20, color: "#7a5bc4", selectIds: ids("g-04"), createdAt: created(90) },
    { pathId: "f-05", pathName: "Cold Store — Uppal", pathType: 1, areaType: "circle", ruleType: "both", pointList: [{ lat: 17.4058, lon: 78.5591 }], radius: 450, color: "#e0743a", selectIds: ids("g-05"), createdAt: created(60) },
    { pathId: "f-06", pathName: "ORR Speed Corridor", pathType: 2, areaType: null, ruleType: "overspeed", pointList: [{ lat: 17.4401, lon: 78.3489 }, { lat: 17.4632, lon: 78.3638 }, { lat: 17.4968, lon: 78.3614 }], maxSpeed: 80, color: "#a86b00", selectIds: [...ids("g-01"), ...ids("g-02")], createdAt: created(45) },
    { pathId: "f-07", pathName: "School Zone — Banjara Hills", pathType: 1, areaType: "circle", ruleType: "overspeed", pointList: [{ lat: 17.4156, lon: 78.4347 }], radius: 350, maxSpeed: 25, color: "#c2541f", selectIds: vehicles.map((v) => v.vehicleId), voiceReminder: "School zone — slow down", createdAt: created(20) },
  ];
}

/* ───────────── Command history (simulated 8.x) ───────────── */

function buildCommands(vehicles: Vehicle[]): CommandRecord[] {
  const rng = createRng(5150);
  const defs: { key: string; label: string; params: Record<string, string> }[] = [
    { key: "properties", label: "Query device properties", params: {} },
    { key: "wake", label: "Wake device", params: {} },
    { key: "text", label: "Send text to device", params: { text: "Please call dispatch at next stop" } },
    { key: "photo", label: "Take photo now", params: { channel: "1", resolution: "4" } },
    { key: "overspeed", label: "Overspeed setting", params: { speed: "80", duration: "10" } },
    { key: "report-interval", label: "Report interval (ACC on/off)", params: { accOn: "10", accOff: "300" } },
  ];
  const records: CommandRecord[] = [];
  for (let i = 0; i < 12; i++) {
    const v = rng.pick(vehicles.filter((x) => x.telemetry.vehicleState !== "offline"));
    const def = rng.pick(defs);
    const issued = addMs(DEMO_NOW, -rng.int(20, 60 * 24 * 6) * MINUTE);
    const ok = rng.chance(0.85);
    records.push({
      commandNo: `CMD-${rng.int(100000, 999999)}`,
      commandKey: def.key,
      commandLabel: def.label,
      vehicleId: v.vehicleId,
      terminalNo: v.terminalNo,
      plate: v.plate,
      params: def.params,
      issuedBy: rng.pick(["Sconex Operations", "Priya Raman", "Arjun Mehta"]),
      issuedAt: iso(issued),
      completedAt: iso(addMs(issued, rng.int(2, 40) * 1000)),
      result: ok ? "SUCCESS" : "FAIL",
      resultResponse: ok ? (def.key === "properties" ? `model=${v.terminalType}; ICCID=${v.sim}; fw=V2.4.${rng.int(1, 9)}` : "Device acknowledged") : undefined,
      failResult: ok ? undefined : "Device did not respond within timeout",
    });
  }
  return records.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/* ───────────── Notifications ───────────── */

function buildNotifications(vehicles: Vehicle[], alarms: Alarm[]): FleetNotification[] {
  const list: FleetNotification[] = [];
  const byId = new Map(vehicles.map((v) => [v.vehicleId, v]));
  alarms
    .filter((a) => (a.severity === "critical" || a.severity === "high") && a.status === "new")
    .slice(0, 5)
    .forEach((a, i) => {
      const v = byId.get(a.vehicleId);
      list.push({
        id: `n-a-${a.alarmId}`,
        kind: "alarm",
        title: `${ALARM_TYPES[a.alarmType].label}`,
        body: `${v?.vehicleName ?? ""} · ${v?.plate ?? ""} near ${a.address}`,
        createdAt: a.alarmTime,
        read: i > 2,
        href: `/drive-vision/alerts?alarm=${a.alarmId}`,
        severity: a.severity,
      });
    });
  vehicles
    .filter((v) => {
      const days = (new Date(v.expireDate).getTime() - DEMO_NOW.getTime()) / DAY;
      return days <= 7;
    })
    .forEach((v) =>
      list.push({
        id: `n-e-${v.vehicleId}`,
        kind: "expiry",
        title: new Date(v.expireDate) < DEMO_NOW ? "Device service expired" : "Device service expiring",
        body: `${v.vehicleName} · ${v.plate} — renewal required`,
        createdAt: iso(addMs(DEMO_NOW, -2 * HOUR)),
        read: false,
        href: `/drive-vision/vehicles/${v.vehicleId}`,
      })
    );
  vehicles
    .filter((v) => v.telemetry.vehicleState === "offline" && DEMO_NOW.getTime() - new Date(v.telemetry.lastReportTime).getTime() > 24 * HOUR)
    .slice(0, 2)
    .forEach((v) =>
      list.push({
        id: `n-o-${v.vehicleId}`,
        kind: "offline",
        title: "Device offline for over 24 h",
        body: `${v.vehicleName} · ${v.plate}`,
        createdAt: iso(addMs(DEMO_NOW, -5 * HOUR)),
        read: true,
        href: `/drive-vision/monitoring?vehicle=${v.vehicleId}`,
      })
    );
  list.push({
    id: "n-sys-demo",
    kind: "system",
    title: "Demo environment",
    body: "All vehicles, events and commands in SafeFare AI are sample data.",
    createdAt: iso(addMs(DEMO_NOW, -26 * HOUR)),
    read: true,
  });
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ───────────── Assemble ───────────── */

export interface FleetSeed {
  users: FleetUser[];
  groups: VehicleGroup[];
  drivers: Driver[];
  vehicles: Vehicle[];
  trips: Trip[];
  alarms: Alarm[];
  geofences: Geofence[];
  commands: CommandRecord[];
  notifications: FleetNotification[];
}

export function createFleetSeed(): FleetSeed {
  const drivers = buildDrivers();
  const vehicles = buildVehicles(drivers);
  const trips = buildTrips(vehicles);
  const alarms = buildAlarms(vehicles, trips);
  return {
    users: seedUsers,
    groups: seedGroups,
    drivers,
    vehicles,
    trips,
    alarms,
    geofences: buildGeofences(vehicles),
    commands: buildCommands(vehicles),
    notifications: buildNotifications(vehicles, alarms),
  };
}
