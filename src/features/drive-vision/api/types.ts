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

/**
 * LoginRequest (V10) — `login` and `password` required; `tenantCode` optional. Tenant users send their
 * tenant code; the Safe-Fare Admin signs in without one, and the property is then omitted (never "" or
 * null). tenantCode ≤ 50, login ≤ 320, password ≤ 72.
 */
export interface LoginRequest {
  tenantCode?: string;
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
  /** V10: true for the Safe-Fare Admin. Profile display only — authorisation reads GET /me/permissions. */
  platform?: boolean;
  displayName?: string;
  email?: string;
  phone?: string;
  locale?: string;
  timezone?: string;
  parentUserId?: number;
  role?: RoleRef;
  /** Permission codes (uniqueItems). Not used for authorisation (see MyPermissionsDto). */
  permissions?: string[];
  /** ISO date-time. */
  lastLoginAt?: string;
}

// ── Effective identity (V10 GET /me/permissions) ─────────────────────────────

/** Per-resource CRUD flags on a screen (`ResourceAccessDto`). */
export interface ResourceAccessDto {
  label?: string;
  read?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}

/** An operation on a screen and whether the caller may perform it (`AllowedOperationDto`). */
export interface AllowedOperationDto {
  operation?: string;
  permissionCode?: string;
  label?: string;
  allowed?: boolean;
}

/** A screen the caller may open (`MyScreenDto`). No routeKey / sortOrder / visible in V10. */
export interface MyScreenDto {
  menuKey?: string;
  title?: string;
  routePath?: string;
  icon?: string;
  parentId?: number;
  readOnly?: boolean;
  resources?: ResourceAccessDto[];
  operations?: AllowedOperationDto[];
}

/** GET /api/v1/me/permissions → the frontend's identity and authorisation source (`MyPermissionsDto`). */
export interface MyPermissionsDto {
  userId?: number;
  /** true only for the Safe-Fare Admin. */
  platform?: boolean;
  homeTenantId?: number;
  tenantId?: number;
  roleId?: number;
  roleCode?: string;
  permissions?: string[];
  screens?: MyScreenDto[];
}

/**
 * GET /api/v1/platform/tenants → `TenantDto` (Safe-Fare Admin, `tenant.all`). The list isn't paged.
 * `status` values are undocumented: the UI counts only "ACTIVE" / "INACTIVE" and reports anything else as such.
 * `users` / `devices` / `drivers` are the server's per-tenant counts.
 */
export interface TenantDto {
  id?: number;
  code?: string;
  name?: string;
  status?: string;
  timezone?: string;
  users?: number;
  devices?: number;
  drivers?: number;
  /** True for the tenant the caller currently works in. */
  current?: boolean;
}

/**
 * POST /api/v1/platform/tenants body. NOT in the V10 spec: contract supplied by the backend team (2026-11-02).
 * `code: ""` was observed to make the server generate the code. `copyRolePermissionsFromTenantId` defaults to 1.
 */
export interface CreateTenantRequest {
  code: string;
  name: string;
  timezone: string;
  status: string;
  s3Prefix: string;
  copyRolePermissionsFromTenantId: number;
}

/** POST /platform/tenants response `data` (observed): TenantDto plus s3Prefix and timestamps. */
export interface CreatedTenantDto extends TenantDto {
  s3Prefix?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One entity's valid status values (`StatusSet` in GET /api/v1/reference/statuses). Contents are server-defined. */
export interface StatusSetDto {
  name?: string;
  field?: string;
  values?: string[];
  terminal?: string[];
  transitions?: { from?: string[]; to?: string; endpoint?: string; sideEffects?: string }[];
  notes?: string;
}

/** GET /api/v1/reference/statuses → `CatalogDto` (any signed-in user). */
export interface StatusCatalogDto {
  statusSets?: StatusSetDto[];
  conventions?: Record<string, string>;
}

/** POST /api/v1/platform/switch-tenant → `TenantSelectionDto`. `header` is the header NAME (currently X-Tenant-Id), not a value or token. */
export interface TenantSelectionDto {
  tenantId?: number;
  code?: string;
  name?: string;
  header?: string;
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
  /** Vehicle registry id of the vehicle this device is fitted in; null when none (docs/contracts/vehicle-api.txt). */
  vehicleId?: number | null;
  /** Added to the spec 2026-10-29. */
  terminal?: TerminalInfo;
  vendorCreatedAt?: string;
  vendorUpdatedAt?: string;
  syncedAt?: string;
}

/**
 * PUT /api/v1/devices/{id} (and POST /devices) body — V10 `DeviceRequest`. A full replace: the 7 required
 * fields must always be sent. `confirmChargeableChange` is undocumented; the frontend never sends it.
 */
export interface DeviceRequest {
  groupId: number;
  name: string;
  terminalNo: string;
  modelName: string;
  protocol: number;
  objectTypeId: number;
  cameraCount: number;
  plateColor?: string;
  simNumber?: string;
  serviceCode?: string;
  remark?: string;
  frameNo?: string;
  insuranceDueAt?: string;
  maintenanceDueAt?: string;
  driverName?: string;
  driverCard?: string;
  driverPhone?: string;
  driverGender?: number;
  drivingLicense?: string;
  driverRemark?: string;
  confirmChargeableChange?: boolean;
  /**
   * Vehicle registry id to fit this device in (Swagger DeviceRequest; docs/contracts/vehicle-api.txt). Omitted →
   * the current vehicle is kept. Sent with `unlinkVehicle: false` when assigning.
   */
  vehicleId?: number;
  /** true → remove the device from its vehicle (sent with `vehicleId: 0`). */
  unlinkVehicle?: boolean;
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
  /** V10: the role has every permission of its tenant. */
  fullAccess?: boolean;
  /** V10: tenant the role belongs to. */
  tenantId?: number;
  /** V10: active users holding the role. */
  activeUsers?: number;
}

export interface PermissionDto {
  code?: string;
  description?: string;
  /** V10: permission scope. The request schemas allow "TENANT" | "PLATFORM" (pattern); meaning per D5. */
  scope?: string;
}

// Role menu permissions: NOT in the V10 spec; contract from the backend team, 2026-11-04
// (docs/contracts/role-menu-permission-api.txt).

/** One checkbox of the role menu grid. `null` in a parent field = no such operation (no checkbox). */
export interface RoleMenuCellDto {
  permissionCode?: string;
  /** The checkbox is ticked. */
  granted?: boolean;
  /** The signed-in user may change it. */
  editable?: boolean;
}

export interface RoleMenuActionCellDto extends RoleMenuCellDto {
  label?: string;
}

export interface RoleMenuResourceDto {
  label?: string;
  view?: RoleMenuCellDto | null;
  add?: RoleMenuCellDto | null;
  edit?: RoleMenuCellDto | null;
  delete?: RoleMenuCellDto | null;
  actions?: RoleMenuActionCellDto[];
}

export interface RoleMenuDto {
  menuId?: number;
  menuKey?: string;
  title?: string;
  icon?: string;
  parentId?: number | null;
  sortOrder?: number;
  /** Module checkbox; null = the menu needs no permission. */
  access?: RoleMenuCellDto | null;
  resources?: RoleMenuResourceDto[];
}

/** GET / PUT /api/v1/roles/{roleId}/menu-permissions. */
export interface RoleMenuPermissionsDto {
  tenantId?: number;
  roleId?: number;
  roleCode?: string;
  fullAccess?: boolean;
  /** false = the whole grid is read-only. */
  editable?: boolean;
  menus?: RoleMenuDto[];
  /** Permissions of the role that no checkbox shows; the backend keeps them on save. */
  otherPermissionCodes?: string[];
}

/** GET/POST/DELETE /api/v1/roles/{id}/permissions → `RolePermissionsDto`. */
export interface RolePermissionsDto {
  roleId?: number;
  roleCode?: string;
  tenantId?: number;
  /** The role has every permission (no explicit list to edit). */
  fullAccess?: boolean;
  /** Server flag: whether this role's permissions may be changed. */
  editable?: boolean;
  permissionCodes?: string[];
}

/** POST /api/v1/roles → `CreateRoleRequest` (code ^[A-Z][A-Z0-9_]{1,29}$, description ≤ 200; both required). */
export interface CreateRoleRequest {
  code: string;
  description: string;
}

/** PUT /api/v1/roles/{id} → `UpdateRoleRequest` (description only). */
export interface UpdateRoleRequest {
  description: string;
}

/** POST /api/v1/permissions → `CreatePermissionRequest` (code ^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$ ≤ 60, description ≤ 200, scope TENANT|PLATFORM). */
export interface CreatePermissionRequest {
  code: string;
  description: string;
  scope: "TENANT" | "PLATFORM";
}

/** PUT /api/v1/permissions/{code} → `UpdatePermissionRequest`. */
export interface UpdatePermissionRequest {
  description: string;
  scope: "TENANT" | "PLATFORM";
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
