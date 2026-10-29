/**
 * SafeFare AI domain types.
 *
 * Field names follow the vendor API documented in Fleet_Feature_API_Mapping.xlsx
 * (e.g. `terminalNo`, `plate`, `cameraNum`, `insuranceDueDate`, `pathType`) so the
 * mock layer can later be swapped for BFF calls with minimal mapping. Concepts the
 * vendor API does not provide (drivers, alarm handling, roles, trips, scores) are
 * marked "BFF" — they will be owned by our own backend.
 */

export type ISODateString = string;

export interface LatLon {
  lat: number;
  lon: number;
}

/* ───────────── Users & groups (vendor 6.x, 2.x) ───────────── */

/** Roles are BFF-owned — the vendor API has no permission endpoints. */
export type UserRole = "Admin" | "Manager" | "Driver";

export interface FleetUser {
  userId: string;
  userName: string;
  parentId: string | null;
  email?: string;
  phone?: string;
  role: UserRole;
  createdAt: ISODateString;
}

export interface VehicleGroup {
  groupId: string;
  groupName: string;
  userId: string;
  email?: string;
  phone?: string;
}

/* ───────────── Devices / vehicles (vendor 1.x, 3.1) ───────────── */

/** 1 = JT/T 808, 2 = GT06, 3 = V3 (vendor 1.1). */
export type DeviceProtocol = 1 | 2 | 3;

/** Object type (vendor 1.7: car / people / pets / others). */
export type ObjectType = "car" | "people" | "pets" | "others";

/** Derived live state used for map colours and filters (workbook: moving, idle, parked, offline). */
export type VehicleState = "moving" | "idle" | "parked" | "offline";

export type PlateColor = "white" | "yellow" | "blue" | "green" | "black";

export interface VehicleTelemetry extends LatLon {
  speed: number; // km/h
  direction: number; // degrees, 0 = north
  mileage: number; // odometer km
  vehicleState: VehicleState;
  accState: boolean;
  posState: boolean; // GPS fixed
  power: number; // battery / supply %
  gsmSin: number; // signal 0–5
  netModel: "4G" | "3G" | "2G";
  temperature?: number; // °C, when a probe is fitted
  fuel?: number; // %
  load?: number; // kg
  alarm: boolean;
  lastReportTime: ISODateString;
  address: string;
}

export interface Vehicle {
  vehicleId: string;
  groupId: string;
  plate: string;
  plateColor: PlateColor;
  vehicleName: string;
  vehicleType: string; // body type / model, e.g. "Tata Ultra T.7 · Light truck"
  objectType: ObjectType;
  terminalNo: string; // device ID
  terminalType: string; // device model
  protocol: DeviceProtocol;
  cameraNum: number;
  sim?: string;
  frameNo?: string;
  remark?: string;
  driverId?: string;
  activationTime: ISODateString;
  expireDate: ISODateString;
  insuranceDueDate?: ISODateString;
  maintainDate?: ISODateString;
  createTime: ISODateString;
  telemetry: VehicleTelemetry;
}

export interface VehicleInput {
  groupId: string;
  plate: string;
  plateColor: PlateColor;
  vehicleName: string;
  vehicleType: string;
  objectType: ObjectType;
  terminalNo: string;
  terminalType: string;
  protocol: DeviceProtocol;
  cameraNum: number;
  sim?: string;
  frameNo?: string;
  remark?: string;
  driverId?: string;
  insuranceDueDate?: ISODateString;
  maintainDate?: ISODateString;
}

export interface TerminalModel {
  name: string;
  protocols: DeviceProtocol[];
  maxCameras: number;
}

/* ───────────── Drivers (BFF — vendor has no driver endpoints) ───────────── */

export type DriverStatus = "active" | "off_duty" | "on_leave";

export interface Driver {
  driverId: string;
  name: string;
  gender: "male" | "female";
  phone: string;
  email?: string;
  licenceNo: string;
  licenceClass: string;
  licenceExpiry: ISODateString;
  icCardNo: string;
  joinDate: ISODateString;
  status: DriverStatus;
  assignedVehicleId?: string;
  remark?: string;
}

export type DriverInput = Omit<Driver, "driverId">;

/* ───────────── Alarms & AI events (vendor 5.1 / 5.4 / 5.8; handling is BFF) ───────────── */

/** Vendor alarm families (5.7: 2 ADAS, 3 general, 4 DSM, 5 BSD). */
export type AlarmCategory = "ADAS" | "DSM" | "BSD" | "General";

export type AlarmTypeCode =
  | "fatigue"
  | "phone"
  | "smoking"
  | "distraction"
  | "seatbelt"
  | "driver_absent"
  | "forward_collision"
  | "lane_departure"
  | "pedestrian"
  | "headway"
  | "blind_spot"
  | "overspeed"
  | "geofence"
  | "device_offline"
  | "sos";

export type Severity = "low" | "medium" | "high" | "critical";

export type AlarmStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "false_positive";

/** Handling outcomes listed in the workbook ("dispatch, voice command, test, false positive, real alarm"). */
export type AlarmOutcome = "real_alarm" | "dispatched" | "voice_command" | "test" | "false_positive";

export interface AlarmNote {
  id: string;
  author: string;
  text: string;
  createdAt: ISODateString;
}

export interface Alarm extends LatLon {
  alarmId: string;
  vehicleId: string;
  terminalNo: string;
  driverId?: string;
  groupId: string;
  alarmType: AlarmTypeCode;
  category: AlarmCategory;
  alarmTime: ISODateString;
  speed: number;
  duration: number; // seconds
  mediaType: "video" | "image" | "none";
  channel: number;
  address: string;
  severity: Severity;
  status: AlarmStatus;
  assigneeId?: string;
  outcome?: AlarmOutcome;
  notes: AlarmNote[];
}

export interface AlarmFilters {
  search?: string;
  severity?: Severity | "all";
  status?: AlarmStatus | "all" | "open";
  category?: AlarmCategory | "all";
  vehicleId?: string;
  from?: ISODateString;
  to?: ISODateString;
}

export interface AlarmUpdate {
  status?: AlarmStatus;
  assigneeId?: string | null;
  outcome?: AlarmOutcome;
  note?: string;
}

/* ───────────── Trips & tracks (vendor 3.2; trip detection is BFF) ───────────── */

export interface TrackPoint extends LatLon {
  t: ISODateString;
  speed: number;
  direction: number;
}

export interface TripStop extends LatLon {
  id: string;
  arrive: ISODateString;
  depart: ISODateString;
  durationMin: number;
  idle: boolean; // engine on while stopped
  address: string;
}

export interface Trip {
  tripId: string;
  vehicleId: string;
  driverId?: string;
  startTime: ISODateString;
  endTime: ISODateString;
  distanceKm: number;
  durationMin: number;
  idleMin: number;
  maxSpeed: number;
  avgSpeed: number;
  startAddress: string;
  endAddress: string;
  stopCount: number;
  alarmCount: number;
  /** Seed used to regenerate the track deterministically on demand. */
  routeSeed: number;
  fromAreaIndex: number;
  toAreaIndex: number;
}

export interface TripTrack {
  tripId: string;
  points: TrackPoint[];
  stops: TripStop[];
  alarms: Alarm[];
}

export interface TripFilters {
  vehicleId?: string | "all";
  from?: ISODateString;
  to?: ISODateString;
  search?: string;
}

/* ───────────── Geofences (vendor 10.x) ───────────── */

/** pathType: 1 area, 2 line (vendor 10.1). */
export type GeofencePathType = 1 | 2;
export type GeofenceAreaType = "circle" | "polygon";
export type GeofenceRule = "enter" | "exit" | "both" | "overspeed";

export interface Geofence {
  pathId: string;
  pathName: string;
  pathType: GeofencePathType;
  areaType: GeofenceAreaType | null; // null for lines
  ruleType: GeofenceRule;
  pointList: LatLon[]; // circle: [center]; polygon / line: vertices
  radius?: number; // metres, circles only
  maxSpeed?: number; // km/h
  color: string;
  selectIds: string[]; // bound vehicleIds
  voiceReminder?: string;
  createdAt: ISODateString;
}

export type GeofenceInput = Omit<Geofence, "pathId" | "createdAt">;

/* ───────────── Device commands (vendor 8.x — simulated only) ───────────── */

export type CommandRisk = "standard" | "elevated" | "high";

export type CommandResult = "PENDING" | "SUCCESS" | "FAIL";

export interface CommandRecord {
  commandNo: string;
  commandKey: string;
  commandLabel: string;
  vehicleId: string;
  terminalNo: string;
  plate: string;
  params: Record<string, string>;
  issuedBy: string;
  issuedAt: ISODateString;
  completedAt?: ISODateString;
  result: CommandResult;
  resultResponse?: string;
  failResult?: string;
}

/* ───────────── Notifications (BFF push) ───────────── */

export type NotificationKind = "alarm" | "expiry" | "offline" | "maintenance" | "system";

export interface FleetNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: ISODateString;
  read: boolean;
  href?: string;
  severity?: Severity;
}

/* ───────────── Misc ───────────── */

export type DateRangeKey = "today" | "7d" | "30d";

export interface DateRange {
  key: DateRangeKey;
  from: Date;
  to: Date;
  label: string;
}
