/**
 * Schemas added to the BFF spec after 2026-10-27 (/v3/api-docs, 172 operations, re-downloaded
 * 2026-10-29): dashboard, trips, drivers, dispatch, driver app, workforce, safety, alerts,
 * notifications, search, assistant, geofence events. Same rules as types.ts: field names and
 * optionality follow the spec; response fields are optional because the spec marks none required.
 * Where the spec uses a generic schema name (Row, Check, Hit, Count…) the TS name is qualified
 * and the spec name is noted. Status strings are typed as `string` unless the spec lists an enum.
 */

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface VehicleCounts {
  total?: number;
  online?: number;
  offline?: number;
  neverOnline?: number;
  expired?: number;
  driving?: number;
  idling?: number;
  parked?: number;
}

export interface ActiveTrips {
  tripsInProgress?: number;
  dispatchesInProgress?: number;
  dispatchesToday?: number;
  /** Keys are dispatch status codes (undocumented set). */
  dispatchesTodayByStatus?: Record<string, number>;
  tripsToday?: number;
  distanceTodayKm?: number;
}

export interface SafetySummary {
  from?: string;
  to?: string;
  total?: number;
  open?: number;
  severe?: number;
  ai?: number;
  routine?: number;
  /** Keys are severity integers as strings; the scale is undocumented. */
  bySeverity?: Record<string, number>;
  latestOpen?: AlertRow[];
}

export interface DeviceHealth {
  online?: number;
  offline?: number;
  neverOnline?: number;
  expired?: number;
  staleOver24h?: number;
  lowBattery?: number;
  videoCapable?: number;
  serviceExpiring30Days?: number;
  insuranceDue30Days?: number;
  maintenanceDue30Days?: number;
}

export interface DashboardOperations {
  pendingLeaveRequests?: number;
  pendingSwapRequests?: number;
  driversOnLeaveToday?: number;
  activeDrivers?: number;
  licencesExpiring30Days?: number;
  unreadNotifications?: number;
}

/** `OverviewDto`. */
export interface DashboardOverviewDto {
  generatedAt?: string;
  vehicles?: VehicleCounts;
  trips?: ActiveTrips;
  safety?: SafetySummary;
  health?: DeviceHealth;
  operations?: DashboardOperations;
}

export interface TrendDay {
  day?: string;
  alarms?: number;
  severeAlarms?: number;
  trips?: number;
  distanceKm?: number;
}

export interface StatusSlice {
  status?: string;
  label?: string;
  count?: number;
  percent?: number;
}

export interface TimeWindowQuery {
  from?: string;
  to?: string;
}

/** `VehicleSummaryDto` (GET /devices/{id}/summary). `vehicle`, `state` and `today` are free-form maps. */
export interface VehicleSummaryDto {
  vehicle?: Record<string, unknown>;
  status?: string;
  statusLabel?: string;
  state?: Record<string, unknown>;
  currentDriver?: AssignmentDto;
  vendorDriverName?: string;
  today?: Record<string, unknown>;
  openAlerts?: number;
  recentAlerts?: AlertRow[];
  currentDispatch?: DispatchDto;
}

// ── Trips ────────────────────────────────────────────────────────────────────

export interface TripDto {
  id?: number;
  deviceId?: number;
  deviceName?: string;
  terminalNo?: string;
  driverId?: number;
  driverName?: string;
  startTime?: string;
  endTime?: string;
  inProgress?: boolean;
  startLat?: number;
  startLon?: number;
  endLat?: number;
  endLon?: number;
  distanceKm?: number;
  durationSeconds?: number;
  drivingSeconds?: number;
  idleSeconds?: number;
  maxSpeedKmh?: number;
  avgSpeedKmh?: number;
  stopCount?: number;
  alarmCount?: number;
}

export interface StopDto {
  id?: number;
  stopType?: string;
  startTime?: string;
  endTime?: string;
  lat?: number;
  lon?: number;
  address?: string;
}

export interface TripDetailDto {
  trip?: TripDto;
  stops?: StopDto[];
}

export interface RoutePointDto {
  deviceTime?: string;
  lat?: number;
  lon?: number;
  speedKmh?: number;
  directionDeg?: number;
  mileageKm?: number;
}

export interface RouteDto {
  trip?: TripDto;
  points?: RoutePointDto[];
  truncated?: boolean;
  stops?: StopDto[];
  events?: AlertRow[];
}

export interface DaySummary {
  day?: string;
  tripCount?: number;
  distanceKm?: number;
  drivingSeconds?: number;
}

/** `SummaryDto` (GET /trips/summary). */
export interface TripSummaryDto {
  from?: string;
  to?: string;
  tripCount?: number;
  inProgressCount?: number;
  totalDistanceKm?: number;
  totalDurationSeconds?: number;
  totalDrivingSeconds?: number;
  totalIdleSeconds?: number;
  avgDistanceKm?: number;
  avgDurationSeconds?: number;
  maxSpeedKmh?: number;
  alarmCount?: number;
  days?: DaySummary[];
}

export interface TripListQuery {
  from?: string;
  to?: string;
  deviceId?: number;
  driverId?: number;
  pageNumber?: number;
  pageSize?: number;
}

// ── Drivers & assignments ────────────────────────────────────────────────────

export type LicenceStatus = "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";

export interface LicenceDto {
  number?: string;
  licenceClass?: string;
  issuedOn?: string;
  expiresOn?: string;
  status?: LicenceStatus;
  daysToExpiry?: number;
}

export interface AssignmentDto {
  id?: number;
  deviceId?: number;
  deviceName?: string;
  terminalNo?: string;
  driverId?: number;
  driverName?: string;
  assignedFrom?: string;
  assignedTo?: string;
  source?: string;
  active?: boolean;
}

export interface DriverDto {
  id?: number;
  /** Login user linked to this record. Not proof of the current user's driver identity. */
  userId?: number;
  name?: string;
  status?: string;
  phone?: string;
  email?: string;
  gender?: string;
  address?: string;
  dateOfBirth?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  hiredOn?: string;
  icCardNo?: string;
  remark?: string;
  licence?: LicenceDto;
  currentAssignment?: AssignmentDto;
  createdAt?: string;
  updatedAt?: string;
}

/** POST /drivers, PUT /drivers/{id}. Dates are `YYYY-MM-DD`. */
export interface DriverRequest {
  /** Required, ≤ 150. */
  name: string;
  userId?: number;
  licenceNo?: string;
  licenceClass?: string;
  licenceIssuedOn?: string;
  licenceExpiresOn?: string;
  icCardNo?: string;
  phone?: string;
  email?: string;
  /** Pattern `M|F|U`. */
  gender?: "M" | "F" | "U";
  address?: string;
  dateOfBirth?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  hiredOn?: string;
  remark?: string;
  /** Pattern `ACTIVE|INACTIVE`. */
  status?: "ACTIVE" | "INACTIVE";
}

export interface DriverListQuery {
  keyword?: string;
  status?: string;
  pageNumber?: number;
  pageSize?: number;
}

/** `AssignRequest` (POST /drivers/{id}/assignments). */
export interface AssignDriverRequest {
  deviceId: number;
  from?: string;
  to?: string;
  replaceCurrent?: boolean;
}

export interface EndAssignmentRequest {
  at?: string;
}

// ── Safety ───────────────────────────────────────────────────────────────────

/** `ScoreDto`. The scoring formula is the backend's; the UI only displays it. */
export interface ScoreDto {
  id?: number;
  name?: string;
  alarmCount?: number;
  severeCount?: number;
  penaltyPoints?: number;
  distanceKm?: number;
  tripCount?: number;
  score?: number;
  grade?: string;
}

/** `Count`. */
export interface KeyedCount {
  key?: string;
  label?: string;
  count?: number;
}

export interface DayCount {
  day?: string;
  count?: number;
  severe?: number;
}

/** `Ranked`. */
export interface RankedEntity {
  id?: number;
  name?: string;
  count?: number;
  penaltyPoints?: number;
}

/** `Totals`. */
export interface SafetyTotals {
  total?: number;
  open?: number;
  resolved?: number;
  dismissed?: number;
  ai?: number;
  routine?: number;
  severe?: number;
  avgResolutionMinutes?: number;
}

/** `AnalyticsDto`. */
export interface SafetyAnalyticsDto {
  from?: string;
  to?: string;
  totals?: SafetyTotals;
  bySeverity?: KeyedCount[];
  byType?: KeyedCount[];
  byDay?: DayCount[];
  byHour?: KeyedCount[];
  topVehicles?: RankedEntity[];
  topDrivers?: RankedEntity[];
}

export interface DriverScoreDto {
  from?: string;
  to?: string;
  score?: ScoreDto;
  byType?: KeyedCount[];
}

export interface PagedWindowQuery extends TimeWindowQuery {
  pageNumber?: number;
  pageSize?: number;
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export interface AlertRow {
  id?: number;
  vendorAlarmId?: string;
  alarmTime?: string;
  endedAt?: string;
  deviceId?: number;
  deviceName?: string;
  terminalNo?: string;
  alarmTypeId?: number;
  alarmName?: string;
  kind?: string;
  /** Integer scale undocumented. */
  severity?: number;
  speedKmh?: number;
  lat?: number;
  lon?: number;
  address?: string;
  durationSeconds?: number;
  mediaStatus?: string;
  /** Values undocumented. */
  handlingStatus?: string;
  handlingOutcome?: string;
  handledBy?: number;
  handledAt?: string;
  driverId?: number;
  driverName?: string;
  assigneeUserId?: number;
  assigneeName?: string;
}

export interface EvidenceRow {
  id?: number;
  mediaType?: string;
  channel?: number;
  url?: string;
  status?: string;
  contentType?: string;
  sizeBytes?: number;
  durationMs?: number;
  storedAt?: string;
  createdAt?: string;
}

export interface ActionRow {
  id?: number;
  actionType?: string;
  actorUserId?: number;
  actorName?: string;
  assigneeUserId?: number;
  assigneeName?: string;
  note?: string;
  automatic?: boolean;
  createdAt?: string;
}

export interface AlertDetailDto {
  alert?: AlertRow;
  actions?: ActionRow[];
  evidence?: EvidenceRow[];
}

export interface AlertListQuery {
  from?: string;
  to?: string;
  status?: string[];
  openOnly?: boolean;
  severity?: number[];
  alarmTypeIds?: number[];
  deviceIds?: number[];
  driverId?: number;
  assigneeUserId?: number;
  kind?: string;
  keyword?: string;
  pageNumber?: number;
  pageSize?: number;
}

/** `ResolveRequest.outcome` — the spec's pattern. */
export const RESOLVE_OUTCOMES = ["CONFIRMED_ALARM", "FALSE_POSITIVE", "TEST", "DISPATCH_EMERGENCY", "DISPATCH_TERMINAL", "VOICE_COMMAND"] as const;
export type ResolveOutcome = (typeof RESOLVE_OUTCOMES)[number];

export interface ResolveRequest {
  outcome: ResolveOutcome;
  note?: string;
}

/** `NoteRequest` (acknowledge, dismiss, reopen). */
export interface NoteRequest {
  note?: string;
}

/** `CommentRequest`: note required, 1–1000. */
export interface CommentRequest {
  note: string;
}

/**
 * Body of POST /alerts/{id}/assign. The spec references the shared `AssignRequest` schema
 * ({ deviceId*, from, to, replaceCurrent }) — a driver-assignment shape with no assignee field —
 * so the action is not sent from the UI (see docs/missing-backend-apis.md #32).
 */
export type AlertAssignRequest = AssignDriverRequest;

// ── Notifications ────────────────────────────────────────────────────────────

export interface NotificationDto {
  id?: number;
  type?: string;
  severity?: number;
  title?: string;
  body?: string;
  refType?: string;
  refId?: string;
  createdAt?: string;
  readAt?: string;
  read?: boolean;
}

export interface NotificationListQuery {
  unreadOnly?: boolean;
  type?: string;
  pageNumber?: number;
  pageSize?: number;
}

// ── Search & assistant ───────────────────────────────────────────────────────

/** `Hit`. GET /search returns `Record<group, Hit[]>`; group keys aren't enumerated in the spec. */
export interface SearchHit {
  type?: string;
  id?: number;
  title?: string;
  subtitle?: string;
  time?: string;
}

export const ASSISTANT_INTENTS = ["LICENCE_EXPIRY", "RISKY_DRIVERS", "DRIVER_AVAILABILITY", "ACTIVE_TRIPS", "OPEN_ALERTS", "DEVICE_HEALTH", "FLEET_STATUS", "OVERVIEW", "HELP"] as const;
export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export interface AssistantPrompt {
  text?: string;
  intent?: AssistantIntent;
}

export interface AskRequest {
  /** Required, ≤ 500. */
  question: string;
}

export interface AnswerDto {
  question?: string;
  intent?: AssistantIntent;
  answer?: string;
  /** Free-form in the spec. */
  data?: unknown;
  suggestions?: string[];
  /** True when the server says the answer is simulated rather than computed. */
  simulated?: boolean;
}

// ── Geofence events ──────────────────────────────────────────────────────────

export interface GeofenceEventDto {
  id?: number;
  geofenceId?: number;
  geofenceName?: string;
  deviceId?: number;
  deviceName?: string;
  terminalNo?: string;
  /** Values undocumented. */
  eventType?: string;
  eventTime?: string;
  lat?: number;
  lon?: number;
  speedKmh?: number;
  durationSec?: number;
}

/** `EventSummary`. */
export interface GeofenceEventSummary {
  from?: string;
  to?: string;
  byType?: Record<string, number>;
}

export interface GeofenceEventQuery extends TimeWindowQuery {
  geofenceId?: number;
  deviceId?: number;
  eventType?: string;
  pageNumber?: number;
  pageSize?: number;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/** `Row` (dispatch-controller and driver-app-controller). */
export interface DispatchDto {
  id?: number;
  tenantId?: number;
  deviceId?: number;
  deviceName?: string;
  terminalNo?: string;
  driverId?: number;
  driverName?: string;
  driverUserId?: number;
  title?: string;
  origin?: string;
  destination?: string;
  routeNotes?: string;
  instructions?: string;
  reportingTime?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  /** Values undocumented. */
  status?: string;
  declineReason?: string;
  cancelReason?: string;
  respondedAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdBy?: number;
  createdAt?: string;
  updatedAt?: string;
  pendingSwapRequestId?: number;
}

export interface DispatchRequest {
  deviceId: number;
  driverId: number;
  /** Required, ≤ 150. */
  title: string;
  origin?: string;
  destination?: string;
  routeNotes?: string;
  instructions?: string;
  reportingTime?: string;
  scheduledStart: string;
  scheduledEnd: string;
}

export interface DispatchListQuery extends TimeWindowQuery {
  status?: string[];
  driverId?: number;
  deviceId?: number;
  pageNumber?: number;
  pageSize?: number;
}

/** `Check`. */
export interface DispatchCheck {
  code?: string;
  passed?: boolean;
  severity?: string;
  message?: string;
  relatedId?: number;
}

/** `CheckResultDto` (POST /dispatches/check). */
export interface DispatchCheckResult {
  ok?: boolean;
  conflicts?: DispatchCheck[];
}

export interface VerificationDto {
  dispatchId?: number;
  status?: string;
  ready?: boolean;
  checks?: DispatchCheck[];
}

export interface ConflictDto {
  dispatchId?: number;
  title?: string;
  driverId?: number;
  driverName?: string;
  deviceId?: number;
  deviceName?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  conflicts?: DispatchCheck[];
}

/** `SwapRow`. */
export interface SwapRequestDto {
  id?: number;
  dispatchId?: number;
  dispatchTitle?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  fromDriverId?: number;
  fromDriverName?: string;
  toDriverId?: number;
  toDriverName?: string;
  reason?: string;
  /** Values undocumented. */
  status?: string;
  requestedBy?: number;
  requestedByName?: string;
  decidedBy?: number;
  decidedAt?: string;
  decisionNote?: string;
  createdAt?: string;
}

/** `SwapRequest` body. */
export interface SwapCreateRequest {
  toDriverId?: number;
  reason?: string;
}

/** `DecisionRequest` (swap and leave approve/reject). */
export interface DecisionRequest {
  toDriverId?: number;
  note?: string;
}

/** `ReasonRequest` (dispatch cancel, driver decline). */
export interface ReasonRequest {
  reason?: string;
}

export interface SwapListQuery {
  status?: string;
  driverId?: number;
  pageNumber?: number;
  pageSize?: number;
}

// ── Workforce ────────────────────────────────────────────────────────────────

export interface ShiftDto {
  id?: number;
  driverId?: number;
  driverName?: string;
  deviceId?: number;
  deviceName?: string;
  startedAt?: string;
  endedAt?: string;
  open?: boolean;
  durationSeconds?: number;
  startLat?: number;
  startLon?: number;
  endLat?: number;
  endLon?: number;
  startOdometerKm?: number;
  endOdometerKm?: number;
  distanceKm?: number;
  note?: string;
}

export interface ShiftListQuery extends TimeWindowQuery {
  driverId?: number;
  pageNumber?: number;
  pageSize?: number;
}

export const LEAVE_TYPES = ["CASUAL", "SICK", "ANNUAL", "UNPAID", "OTHER"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export interface LeaveDto {
  id?: number;
  driverId?: number;
  driverName?: string;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  reason?: string;
  /** Values undocumented. */
  status?: string;
  requestedBy?: number;
  decidedBy?: number;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
  createdAt?: string;
  affectedDispatchIds?: number[];
}

/** `LeaveRequest` body. `driverId` is for the fleet endpoint; the driver app omits it. */
export interface LeaveCreateRequest {
  driverId?: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface LeaveListQuery {
  status?: string;
  driverId?: number;
  /** `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface ChecklistItem {
  key?: string;
  label?: string;
  category?: string;
  critical?: boolean;
}

export interface ChecklistItemDto extends ChecklistItem {
  passed?: boolean;
  note?: string;
}

export interface ChecklistDto {
  id?: number;
  driverId?: number;
  driverName?: string;
  deviceId?: number;
  deviceName?: string;
  dispatchId?: number;
  shiftId?: number;
  allPassed?: boolean;
  failedCount?: number;
  criticalFailed?: boolean;
  items?: ChecklistItemDto[];
  note?: string;
  submittedAt?: string;
}

/** `ItemResult`. */
export interface ChecklistItemResult {
  key: string;
  passed: boolean;
  note?: string;
}

export interface ChecklistRequest {
  deviceId?: number;
  dispatchId?: number;
  items: ChecklistItemResult[];
  note?: string;
}

export interface AvailabilityDto {
  driverId?: number;
  name?: string;
  phone?: string;
  /** Values undocumented. */
  status?: string;
  leaveType?: string;
  pendingLeave?: boolean;
  onShift?: boolean;
  dispatchesOnDay?: number;
  scheduledHours?: number;
  upcomingDispatches?: number;
}

export interface AvailabilityOverviewDto {
  date?: string;
  /** Keys are availability status codes (undocumented set). */
  counts?: Record<string, number>;
  drivers?: AvailabilityDto[];
}

// ── Driver app (/driver/*) ───────────────────────────────────────────────────

export interface AssignmentOverviewDto {
  driver?: DriverDto;
  currentVehicle?: AssignmentDto;
  activeTrip?: DispatchDto;
  nextTrip?: DispatchDto;
  today?: DispatchDto[];
  currentShift?: ShiftDto;
}

export interface WorkSummary {
  from?: string;
  to?: string;
  shiftCount?: number;
  totalSeconds?: number;
  totalHours?: number;
  averageSeconds?: number;
  longestSeconds?: number;
}

export interface ShiftHistoryDto {
  summary?: WorkSummary;
  current?: ShiftDto;
  shifts?: ShiftDto[];
}

/** `ContactRequest` (PATCH /driver/me). */
export interface DriverContactRequest {
  phone?: string;
  email?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export interface ShiftStartRequest {
  deviceId?: number;
  lat?: number;
  lon?: number;
  odometerKm?: number;
  note?: string;
}

export interface ShiftEndRequest {
  lat?: number;
  lon?: number;
  odometerKm?: number;
  note?: string;
}
