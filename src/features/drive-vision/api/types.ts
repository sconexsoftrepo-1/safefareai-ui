/**
 * Types mirroring the Safe-Fare Fleet BFF OpenAPI schemas (3.1.0, /v3/api-docs).
 * Field names and optionality follow the spec exactly: the spec marks almost nothing as
 * required in responses, so response fields are optional here too. Only add schemas as
 * they are integrated; don't invent fields.
 */

/** Every endpoint wraps its payload in this envelope (`ApiResponse*` schemas). */
export interface ApiResponse<T> {
  code?: number;
  msg?: string;
  data?: T;
  total?: number;
  /** Free-form in the spec. On reads: data source (VENDOR / LOCAL). On errors: see ApiErrorExtend. */
  extend?: unknown;
}

/**
 * Error `extend` shape. Not in the spec (only 200s are documented); observed on real 400/401
 * responses from the server, e.g. { errorCode: "INVALID_CREDENTIALS", fieldErrors: [], requestId }.
 */
export interface ApiErrorExtend {
  errorCode?: string;
  fieldErrors?: ApiFieldError[];
  requestId?: string;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

/**
 * `extend` on vendor-backed reads. The spec only says "data source in `extend` (VENDOR or
 * LOCAL)"; the other keys were observed on the live server, e.g.
 * { source: "LOCAL", stale: true, fallbackReason: "VENDOR_NOT_CONFIGURED", syncedAt: null, persisted: null }.
 */
export interface DataSourceExtend {
  source?: "VENDOR" | "LOCAL" | string;
  stale?: boolean | null;
  fallbackReason?: string | null;
  /** ISO date-time of the last vendor sync. */
  syncedAt?: string | null;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

/** LoginRequest — all required. tenantCode ≤ 50, login ≤ 320, password ≤ 72. */
export interface LoginRequest {
  tenantCode: string;
  login: string;
  password: string;
}

/** RefreshRequest — used by /auth/refresh and /auth/logout. refreshToken ≤ 200. */
export interface RefreshRequest {
  refreshToken: string;
}

export interface TokenResponse {
  accessToken?: string;
  tokenType?: string;
  /** Access-token lifetime (seconds per JWT convention; the JWT `exp` claim is preferred when present). */
  expiresIn?: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  user?: CurrentUserDto;
}

// ── Current user ─────────────────────────────────────────────────────────────

export interface RoleRef {
  id?: number;
  code?: string;
  description?: string;
}

export interface CurrentUserDto {
  id?: number;
  tenantId?: number;
  tenantCode?: string;
  tenantName?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  locale?: string;
  timezone?: string;
  parentUserId?: number;
  role?: RoleRef;
  /** Permission codes (uniqueItems). */
  permissions?: string[];
  /** ISO date-time. */
  lastLoginAt?: string;
}

export interface MenuNodeDto {
  id?: number;
  parentId?: number;
  menuKey?: string;
  title?: string;
  routeKey?: string;
  routePath?: string;
  icon?: string;
  requiredPermissionCode?: string;
  sortOrder?: number;
  visible?: boolean;
  active?: boolean;
  children?: MenuNodeDto[];
}

// ── Fleet: groups, devices, realtime, alarms ─────────────────────────────────

export interface GroupDto {
  id?: number;
  vendorGroupId?: number;
  name?: string;
  email?: string;
  phone?: string;
  syncedAt?: string;
}

export interface DriverInfo {
  name?: string;
  card?: string;
  phone?: string;
  gender?: number;
  drivingLicense?: string;
  remark?: string;
}

export interface TerminalInfo {
  iccid?: string;
  model?: string;
  hardwareVersion?: string;
  firmwareVersion?: string;
  syncedAt?: string;
}

export interface DeviceDto {
  id?: number;
  vendorVehicleId?: number;
  groupId?: number;
  name?: string;
  terminalNo?: string;
  modelId?: number;
  protocolCode?: number;
  objectTypeId?: number;
  plateColor?: string;
  simNumber?: string;
  cameraCount?: number;
  cameraLines?: number[];
  frameNo?: string;
  remark?: string;
  activatedAt?: string;
  /** Service expiry. */
  expiresAt?: string;
  insuranceDueAt?: string;
  maintenanceDueAt?: string;
  driver?: DriverInfo;
  /** Added to the spec 2026-10-29. */
  terminal?: TerminalInfo;
  vendorCreatedAt?: string;
  vendorUpdatedAt?: string;
  syncedAt?: string;
}

/** GET /devices query (pageNumber ≥ 1, default 1; pageSize 1–100, default 20). No sort parameter. */
export interface DeviceListQuery {
  groupId?: number;
  keyword?: string;
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Latest reported state of a device. `statusCode`, `positionMode` and `networkType` are
 * integers whose meanings the spec doesn't document, so the UI doesn't interpret them.
 */
export interface DeviceStateDto {
  deviceId?: number;
  vendorVehicleId?: number;
  name?: string;
  terminalNo?: string;
  statusCode?: number;
  deviceTime?: string;
  lat?: number;
  lon?: number;
  speedKmh?: number;
  directionDeg?: number;
  altitudeM?: number;
  mileageKm?: number;
  positionMode?: number;
  batteryPct?: number;
  gsmSignal?: number;
  networkType?: number;
  activeAlarm?: string;
  videoCapable?: boolean;
  /** Free-form JsonNode (observed: { temperature, humidity }). */
  sensors?: unknown;
  receivedAt?: string;
}

export interface RealtimeDto {
  onlineCount?: number;
  offlineCount?: number;
  devices?: DeviceStateDto[];
}

export interface AlarmDto {
  id?: number;
  vendorAlarmId?: string;
  deviceId?: number;
  terminalNo?: string;
  deviceName?: string;
  alarmTypeId?: number;
  alarmName?: string;
  alarmTime?: string;
  vendorAlarmTime?: string;
  endedAt?: string;
  /** Integer scale not documented (observed 2–3). */
  severity?: number;
  speedKmh?: number;
  lat?: number;
  lon?: number;
  durationSeconds?: number;
  videoUrl?: string;
  imageUrl?: string;
  /** Values not documented (observed "NEW"). */
  handlingStatus?: string;
}

/** GET /alarms/routine and /alarms/ai query. from/to are required date-times. */
export interface AlarmListQuery {
  from: string;
  to: string;
  alarmTypeIds?: number[];
  deviceIds?: number[];
  pageNumber?: number;
  pageSize?: number;
}

export interface AlarmTypeDto {
  id?: number;
  code?: string;
  label?: string;
  category?: number;
  defaultSeverity?: number;
  active?: boolean;
}

// ── Reference data ───────────────────────────────────────────────────────────

export interface ProtocolDto {
  code?: number;
  name?: string;
}

export interface DeviceModelDto {
  id?: number;
  name?: string;
  protocols?: ProtocolDto[];
}

export interface ObjectTypeDto {
  id?: number;
  name?: string;
  /** 1–4 (query filter range in the spec); meanings not documented. */
  category?: number;
}

// ── Track history ────────────────────────────────────────────────────────────

/**
 * GET /devices/{id}/track query. from/to required (from < to). Observed limits (not in the spec):
 * range ≤ 7 days → otherwise 400 INVALID_VALUE; from == to or from > to → 400 INVALID_VALUE.
 */
export interface TrackQuery {
  from: string;
  to: string;
  /** Default true. */
  includeStops?: boolean;
  /** 0–1440, default 0. */
  minStopMinutes?: number;
  /** Default LOCATED. */
  positionFilter?: "LOCATED" | "ALL" | "UNLOCATED";
}

/** `runState`, `positionState` and `pointType` are integers whose meanings aren't documented. */
export interface TrackPointDto {
  deviceTime?: string;
  lat?: number;
  lon?: number;
  speedKmh?: number;
  directionDeg?: number;
  mileageKm?: number;
  runState?: number;
  positionState?: number;
  batteryPct?: number;
  stopSeconds?: number;
  pointType?: number;
  alarm?: string;
}

export interface TrackDto {
  deviceId?: number;
  name?: string;
  terminalNo?: string;
  from?: string;
  to?: string;
  pointCount?: number;
  firstTime?: string;
  lastTime?: string;
  relativeMileageKm?: number;
  points?: TrackPointDto[];
}

// ── Account: profile, preferences, password (Phase 2) ───────────────────────

/** UpdateMeRequest — all optional. displayName 1–150, phone ^[+0-9 ()-]{5,30}$, locale ^[a-z]{2}(_[A-Z]{2})?$, timezone ≤ 50. */
export interface UpdateMeRequest {
  displayName?: string;
  email?: string;
  phone?: string;
  locale?: string;
  timezone?: string;
}

/** ChangePasswordRequest — both required, each ≤ 72. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * PreferencesDto (GET and PUT /me/preferences). PUT requires deviceInfoFields, expiryReminderMode,
 * homeModules, theme, trackAlarmTypeIds, videoLayout. Spec constraints are noted per field.
 */
export interface PreferencesDto {
  /** ^[a-z0-9_]{1,30}$ — allowed values undocumented. */
  theme?: string;
  nightModeEnabled?: boolean;
  /** Format undocumented. */
  nightModeFrom?: string;
  nightModeTo?: string;
  mapClusterEnabled?: boolean;
  /** ≤ 20 items, each ^[a-z0-9_.-]{1,40}$ — allowed values undocumented. */
  homeModules?: string[];
  /** ≤ 30 items, each ^[a-z0-9_.-]{1,40}$ — allowed values undocumented. */
  deviceInfoFields?: string[];
  videoLayout?: VideoLayout;
  /** 1–120. */
  videoAutoStopMin?: number;
  /** ≤ 200 alarm type ids. */
  trackAlarmTypeIds?: number[];
  /** 0–600. */
  alarmPopupCloseSec?: number;
  /** 1–50. */
  alarmPopupMax?: number;
  /** No range documented. */
  expiryReminderDays?: number;
  expiryReminderMode?: ExpiryReminderMode;
  updatedAt?: string;
}

export type VideoLayout = "GRID_1" | "GRID_4" | "GRID_9" | "GRID_16";
export type ExpiryReminderMode = "NONE" | "BADGE" | "POPUP_AND_BADGE";

// ── Administration: users, roles, permissions (Phase 2) ──────────────────────

/** Query for GET /users. pageSize 1–100 (default 20). `sort` format is undocumented, so it isn't sent. */
export interface UserListQuery {
  keyword?: string;
  status?: UserListStatus;
  roleId?: number;
  parentUserId?: number;
  pageNumber?: number;
  pageSize?: number;
}

/** GET /users `status` filter pattern: ACTIVE|INVITED|DISABLED. */
export type UserListStatus = "ACTIVE" | "INVITED" | "DISABLED";

export interface UserSummaryDto {
  id?: number;
  displayName?: string;
  email?: string;
  phone?: string;
  status?: string;
  role?: RoleRef;
  parentUserId?: number;
  locked?: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface UserDetailDto extends UserSummaryDto {
  locale?: string;
  timezone?: string;
  failedLoginCount?: number;
  lockedUntil?: string;
  updatedAt?: string;
}

export interface UserTreeNode {
  id?: number;
  displayName?: string;
  roleCode?: string;
  status?: string;
  children?: UserTreeNode[];
}

/** CreateUserRequest — displayName, password, roleId required. displayName ≤ 150, password ≤ 72. */
export interface CreateUserRequest {
  displayName: string;
  email?: string;
  phone?: string;
  password: string;
  roleId: number;
  parentUserId?: number;
  locale?: string;
  timezone?: string;
}

/** UpdateUserRequest — displayName and roleId required. */
export interface UpdateUserRequest {
  displayName: string;
  email?: string;
  phone?: string;
  roleId: number;
  parentUserId?: number;
  locale?: string;
  timezone?: string;
}

/** StatusRequest — pattern ACTIVE|DISABLED. */
export interface StatusRequest {
  status: "ACTIVE" | "DISABLED";
}

/** PasswordResetRequest — newPassword ≤ 72. */
export interface PasswordResetRequest {
  newPassword: string;
}

export interface RoleDto {
  id?: number;
  code?: string;
  description?: string;
  permissionCodes?: string[];
  assignable?: boolean;
  protectedRole?: boolean;
}

export interface PermissionDto {
  code?: string;
  description?: string;
}

// ── Geofences (Phase 2) ─────────────────────────────────────────────────────

export interface PointDto {
  lat?: number;
  lon?: number;
}

export interface SpeedLimitDto {
  /** ^(\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2})?$ */
  timeRange?: string;
  speedLimitKmh?: number;
}

export interface BroadcastDto {
  ruleType?: number;
  mode?: "TTS" | "VOICE";
  text?: string;
  voiceId?: number;
  vendorVoiceId?: number;
  playCount?: number;
}

export interface GeofenceDto {
  id?: number;
  vendorPathId?: number;
  name?: string;
  shape?: "AREA" | "LINE";
  /** Integer codes; meanings undocumented. */
  ruleTypes?: number[];
  ruleParam?: number;
  maxSpeed?: number;
  speedLimit?: SpeedLimitDto;
  color?: string;
  /** 0–9; meanings undocumented. */
  areaType?: number;
  points?: PointDto[];
  bindType?: "GROUP" | "DEVICE";
  bindIds?: number[];
  vendorSelectIds?: string;
  threshold?: number;
  broadcasts?: BroadcastDto[];
  global?: boolean;
  syncedAt?: string;
}

// ── Reports (Phase 2) ───────────────────────────────────────────────────────

/** from/to required (date-time); deviceIds optional. Mileage takes no paging parameters. */
export interface ReportQuery {
  from: string;
  to: string;
  deviceIds?: number[];
  pageNumber?: number;
  pageSize?: number;
}

/** Driving / parking periods. */
export interface ActivityDto {
  id?: number;
  deviceId?: number;
  terminalNo?: string;
  deviceName?: string;
  deviceType?: string;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  durationText?: string;
}

export interface MileageDto {
  id?: number;
  deviceId?: number;
  terminalNo?: string;
  deviceName?: string;
  /** ISO date (no time). */
  periodStart?: string;
  periodEnd?: string;
  distanceKm?: number;
  startMileageKm?: number;
  endMileageKm?: number;
  plateColor?: string;
}

export interface MediaDto {
  id?: number;
  deviceId?: number;
  terminalNo?: string;
  deviceName?: string;
  channel?: number;
  /** Integer code; meanings undocumented. */
  mediaType?: number;
  /** Integer code; meanings undocumented. */
  triggerType?: number;
  operatorUser?: string;
  capturedAt?: string;
  lat?: number;
  lon?: number;
  startTime?: string;
  endTime?: string;
  filePath?: string;
  previewUrl?: string;
}

// ── Video (Phase 2) ─────────────────────────────────────────────────────────

export interface RecordingDto {
  id?: number;
  deviceId?: number;
  channel?: number;
  beginTime?: string;
  endTime?: string;
  /** Integer codes; meanings undocumented. */
  dataType?: number;
  streamType?: number;
  fileSizeMb?: number;
}

/** ExportRequest — deviceId, channel (1–16), from, to required; dataType 0–2 and streamType 1–2 optional (codes undocumented). */
export interface ExportRequest {
  deviceId: number;
  channel: number;
  from: string;
  to: string;
  dataType?: number;
  streamType?: number;
}

export interface ExportDto {
  id?: number;
  deviceId?: number;
  channel?: number;
  startTime?: string;
  endTime?: string;
  dataType?: number;
  streamType?: number;
  /** Values undocumented. */
  status?: string;
  vendorStatus?: number;
  url?: string;
  error?: string;
  createdAt?: string;
  readyAt?: string;
  checkedAt?: string;
}

// ── Commands (Phase 2, read-only) ───────────────────────────────────────────

/** `Definition` in the spec (GET /commands/types). */
export interface CommandDefinitionDto {
  type?: string;
  section?: string;
  vendorPath?: string;
  method?: string;
  critical?: boolean;
  singleDevice?: boolean;
  required?: string[];
  optional?: string[];
  /** Free-form in the spec. */
  formats?: Record<string, unknown>;
}

/** `TargetDto` in the spec. */
export interface CommandTargetDto {
  id?: number;
  deviceId?: number;
  terminalNo?: string;
  /** Values undocumented. */
  status?: string;
  vendorCommandNo?: string;
  failReason?: string;
  vendorResult?: string;
  vendorCmdType?: number;
  result?: unknown;
  sentAt?: string;
  finishedAt?: string;
}

export interface CommandDto {
  id?: number;
  type?: string;
  section?: string;
  /** Values undocumented. */
  status?: string;
  targetCount?: number;
  requestedBy?: number;
  params?: unknown;
  createdAt?: string;
  completedAt?: string;
  targets?: CommandTargetDto[];
}

export interface CommandListQuery {
  type?: string;
  deviceId?: number;
  pageNumber?: number;
  pageSize?: number;
}

/** GET /voices, /voices/fence. */
export interface VoiceDto {
  id?: number;
  vendorVoiceId?: number;
  name?: string;
  fileSizeMb?: number;
  path?: string;
  url?: string;
  vendorUserId?: number;
  /** Integer code, undocumented. */
  importType?: number;
  createdAt?: string;
  syncedAt?: string;
}

export * from "./types-operations";
