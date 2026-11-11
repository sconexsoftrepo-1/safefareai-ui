import { identityKind, isScreenOperationAllowed, type Identity, type IdentityKind, type IdentityScreen } from "./identity";
import { isTenantId } from "../api/tenant-context";

/**
 * Frontend access policy (V10): one resolver from the signed-in user's identity (GET /api/v1/me/permissions)
 * to the screens, shell features and actions the UI offers.
 *
 * This is a convenience layer, not security: the BFF authorises every request. It is deny-by-default:
 * - Screens, features and actions open only through the **exact V10 permission codes** listed in the
 *   registries below. Each entry names the V10 operation whose documented "Required permission" it
 *   mirrors; tests/access-v10.test.cjs checks every code against docs/openapi/api-docs-v10.json.
 * - Platform access comes only from `identity.platform === true` (never from a role code). V10 merges the
 *   old PLATFORM_ADMIN / SUPER_ADMIN into ADMIN; `platform` is what separates the Safe-Fare Admin from a
 *   tenant ADMIN.
 * - A role code never grants anything. It only narrows: the driver app (My Work) is for DRIVER logins.
 * - The server's `screens` list can only narrow (read-only screens, operations with `allowed: false`) and
 *   shape navigation (titles, order). It never opens a screen the permissions don't.
 * - Several server screens can share one app screen (the driver sections are all `myWork`). That app screen is
 *   read-only only when all of them are: one read-only section says nothing about the others.
 * - The driver app's buttons ask the server per operation: see DRIVER_OPERATIONS.
 * - Missing or malformed identity data means no access.
 *
 * Pure module (no React) so tests can load it directly.
 */

export const DV_BASE = "/drive-vision";

/** Every routed screen. Nested routes (e.g. /vehicles/[id]) belong to their parent screen. */
export const SCREEN_ROUTES = {
  /** Safe-Fare Admin platform dashboard (Phase 4). First, so it is the platform admin's home screen. */
  platform: `${DV_BASE}/platform`,
  /** Safe-Fare Admin tenant management and selection (Phase 5). */
  tenants: `${DV_BASE}/tenants`,
  /** Safe-Fare Admin global roles and role-permission mapping (Phase 7; server routePath /platform/roles). */
  roles: `${DV_BASE}/platform/roles`,
  /** Permission catalogue and role menu permissions (server routePath /platform/permissions). */
  permissions: `${DV_BASE}/platform/permissions`,
  overview: `${DV_BASE}/overview`,
  monitoring: `${DV_BASE}/monitoring`,
  video: `${DV_BASE}/video`,
  trips: `${DV_BASE}/trips`,
  reports: `${DV_BASE}/reports`,
  /** Vehicle registry (server menu_key "vehicles", routePath /vehicle-registry). Not the devices screen below. */
  vehicleRegistry: `${DV_BASE}/vehicle-registry`,
  /** Sensors: stop-wise passenger counts and the sensor vs BMS reconciliation (server routePath /sensors). */
  sensors: `${DV_BASE}/sensors`,
  /** Devices ("Devices & Assets", server menu_key "vehicles_assets"; route unchanged). */
  vehicles: `${DV_BASE}/vehicles`,
  drivers: `${DV_BASE}/drivers`,
  dispatch: `${DV_BASE}/dispatch`,
  workforce: `${DV_BASE}/workforce`,
  alerts: `${DV_BASE}/alerts`,
  safety: `${DV_BASE}/safety`,
  geofences: `${DV_BASE}/geofences`,
  commands: `${DV_BASE}/devices/commands`,
  users: `${DV_BASE}/users`,
  settings: `${DV_BASE}/settings`,
  myWork: `${DV_BASE}/my-work`,
} as const;

export type ScreenKey = keyof typeof SCREEN_ROUTES;
export const ALL_SCREENS = Object.keys(SCREEN_ROUTES) as ScreenKey[];

// ── Requirements ─────────────────────────────────────────────────────────────

/**
 * What a screen, feature or action needs. `anyOf` / `allOf` are exact V10 permission codes;
 * `signedIn` = V10 "Required permission: none (any signed-in user)". `operations` are the V10
 * operations ("METHOD /api/v1/path") the requirement mirrors — the evidence, checked by tests.
 */
export interface Requirement {
  anyOf?: readonly string[];
  allOf?: readonly string[];
  signedIn?: true;
  operations: readonly string[];
  /** Codes required beyond the spec, with where they were observed (documented in the permission matrix). */
  observed?: { codes: readonly string[]; source: string };
  /**
   * Operations in `operations` that are NOT in the V10 spec, with where their contract came from. Their
   * permission is undocumented, so the requirement's codes are an explicit, documented assumption.
   */
  offSpec?: { operations: readonly string[]; source: string };
}

/**
 * Who a screen is for, besides its permissions:
 * - `all`    — anyone holding the permissions.
 * - `driver` — the driver app: only driver logins (role DRIVER, not platform). An administrator holding
 *              the same codes is not a driver; `/driver/**` answers only for a user linked to a driver profile.
 * - `staff`  — not shown to driver logins (their profile and password live in My Work).
 */
export type Audience = "all" | "driver" | "staff";

export interface ScreenDef {
  requires: Requirement;
  audience: Audience;
  /** Platform screens additionally need `identity.platform === true`. */
  platformOnly?: boolean;
  /** Replaces `requires` for tenant users, when a screen's other way in is platform-only. */
  tenantRequires?: Requirement;
}

/** Source of the off-spec sensor / passenger-count operations and their sensor.* codes. */
const SENSOR_CONTRACT = "Sensors and passenger-count API contract from the backend team, 2026-11-03 (docs/contracts/passenger-counting-api.txt; not in api-docs-v10.json)";
const SENSOR_READS = [
  "GET /api/v1/sensors/types",
  "GET /api/v1/devices/{id}/sensors/readings",
  "GET /api/v1/devices/{id}/stops",
  "GET /api/v1/devices/{id}/bms",
  "GET /api/v1/devices/{id}/stops/comparison",
  "GET /api/v1/devices/{id}/passenger-summary",
  // Alcohol detection result (docs/contracts/alcohol-detection-api.txt, 2026-11-03).
  "GET /api/v1/devices/{id}/sensors/alcohol",
];

/** Source of the off-spec role menu permission operations. */
const ROLE_MENU_CONTRACT = "Role menu permission API contract from the backend team, 2026-11-04 (docs/contracts/role-menu-permission-api.txt; not in api-docs-v10.json)";
const ROLE_MENU_READ = "GET /api/v1/roles/{id}/menu-permissions";
const ROLE_MENU_WRITE = "PUT /api/v1/roles/{id}/menu-permissions";

/** Source of the off-spec vehicle registry operations and their vehicle.* codes. */
const VEHICLE_CONTRACT = "Vehicle API contract from the backend team, 2026-11-03 (docs/contracts/vehicle-api.txt; not in api-docs-v10.json)";

export const SCREENS: Readonly<Record<ScreenKey, ScreenDef>> = {
  // Platform administration = platform === true AND tenant.all (see canAccessPlatform). Never a tenant ADMIN.
  platform: { audience: "staff", platformOnly: true, requires: { anyOf: ["tenant.all"], operations: ["GET /api/v1/platform/tenants"] } },
  tenants: { audience: "staff", platformOnly: true, requires: { anyOf: ["tenant.all"], operations: ["GET /api/v1/platform/tenants", "POST /api/v1/platform/switch-tenant"] } },
  // Phase 7. Product rule: only the Safe-Fare Admin configures global roles and the permission catalogue. Global
  // Roles is platformOnly (platform === true) on top of its V10 code — a tenant ADMIN holding it never sees it.
  roles: { audience: "staff", platformOnly: true, requires: { anyOf: ["role.read"], operations: ["GET /api/v1/roles"] } },
  // Two views. Role permissions: role.permission.read, also for tenant users, whose tenant comes from their token.
  // Catalogue: platform === true and permission.manage (see canManageCatalogue and the platformOnly actions), so
  // permission.manage alone never opens this screen for a tenant user.
  permissions: {
    audience: "staff",
    requires: {
      anyOf: ["permission.manage", "role.permission.read"],
      operations: ["GET /api/v1/permissions", ROLE_MENU_READ],
      offSpec: { operations: [ROLE_MENU_READ], source: ROLE_MENU_CONTRACT },
    },
    tenantRequires: { anyOf: ["role.permission.read"], operations: [ROLE_MENU_READ], offSpec: { operations: [ROLE_MENU_READ], source: ROLE_MENU_CONTRACT } },
  },
  overview: { audience: "all", requires: { anyOf: ["device.read"], operations: ["GET /api/v1/dashboard/overview"] } },
  monitoring: { audience: "all", requires: { anyOf: ["device.read"], operations: ["GET /api/v1/monitor/realtime"] } },
  video: { audience: "all", requires: { anyOf: ["video.playback"], operations: ["GET /api/v1/devices/{id}/recordings"] } },
  trips: { audience: "all", requires: { anyOf: ["track.read"], operations: ["GET /api/v1/trips"] } },
  reports: { audience: "all", requires: { anyOf: ["report.read"], operations: ["GET /api/v1/reports/mileage"] } },
  vehicleRegistry: {
    audience: "all",
    requires: {
      anyOf: ["vehicle.read"],
      operations: ["GET /api/v1/vehicles", "GET /api/v1/vehicles/available", "GET /api/v1/vehicles/{id}"],
      offSpec: { operations: ["GET /api/v1/vehicles", "GET /api/v1/vehicles/available", "GET /api/v1/vehicles/{id}"], source: VEHICLE_CONTRACT },
    },
  },
  sensors: { audience: "all", requires: { anyOf: ["sensor.read"], operations: SENSOR_READS, offSpec: { operations: SENSOR_READS, source: SENSOR_CONTRACT } } },
  vehicles: { audience: "all", requires: { anyOf: ["device.read"], operations: ["GET /api/v1/devices"] } },
  drivers: { audience: "all", requires: { anyOf: ["driver.read"], operations: ["GET /api/v1/drivers"] } },
  dispatch: { audience: "all", requires: { anyOf: ["dispatch.read"], operations: ["GET /api/v1/dispatches"] } },
  workforce: { audience: "all", requires: { anyOf: ["workforce.read"], operations: ["GET /api/v1/shifts", "GET /api/v1/leave-requests"] } },
  alerts: { audience: "all", requires: { anyOf: ["alarm.read"], operations: ["GET /api/v1/alerts"] } },
  safety: { audience: "all", requires: { anyOf: ["alarm.read"], operations: ["GET /api/v1/safety/analytics"] } },
  geofences: { audience: "all", requires: { anyOf: ["geofence.read"], operations: ["GET /api/v1/geofences"] } },
  // V10: even the command history needs command.send.
  commands: { audience: "all", requires: { anyOf: ["command.send"], operations: ["GET /api/v1/commands"] } },
  users: { audience: "all", requires: { anyOf: ["user.read"], operations: ["GET /api/v1/users"] } },
  settings: { audience: "staff", requires: { signedIn: true, operations: ["GET /api/v1/me/preferences", "PATCH /api/v1/me"] } },
  myWork: {
    audience: "driver",
    requires: {
      allOf: ["own.data.read", "driver.app"],
      operations: ["GET /api/v1/driver/me"],
      observed: { codes: ["driver.app"], source: "requiredPermissionCode of every driver menu in GET /me/menus, live DRIVER login 2026-10-29" },
    },
  },
};

/** Shell features that aren't routes. */
export type FeatureKey = "assistant" | "recordSearch";
export const ALL_FEATURES: FeatureKey[] = ["assistant", "recordSearch"];

export const FEATURES: Readonly<Record<FeatureKey, Requirement>> = {
  /** Application-usage help for every signed-in role. Protecting tenant data is the chat service's job. */
  assistant: {
    signedIn: true,
    operations: ["POST /api/chat/message"],
    offSpec: { operations: ["POST /api/chat/message"], source: "Iris AI chat service OpenAPI 1.0.0, see docs/iris-chatbot-integration-report.md" },
  },
  recordSearch: { anyOf: ["device.read"], operations: ["GET /api/v1/search"] },
};

/**
 * Dashboard widgets that read data on their own (Phase 4 platform dashboard). The page is gated by its
 * screen; each widget additionally needs the code its V10 operations document, so a widget the identity
 * can't read shows "no permission" instead of firing a request that would answer 403.
 */
export type WidgetKey =
  | "platform.tenants"
  | "dashboard.fleet"
  | "dashboard.safety"
  | "dashboard.groups"
  | "roles.permissions"
  | "permissions.catalog"
  | "roleMenu.roles"
  | "roleMenu.matrix"
  | "drivers.safety"
  | "drivers.deviceChoices"
  | "vehicles.driverAssignments"
  | "sensors.deviceChoices"
  | "devices.vehicleChoices";
export const ALL_WIDGETS: WidgetKey[] = ["platform.tenants", "dashboard.fleet", "dashboard.safety", "dashboard.groups", "roles.permissions", "permissions.catalog", "roleMenu.roles", "roleMenu.matrix", "drivers.safety", "drivers.deviceChoices", "vehicles.driverAssignments", "sensors.deviceChoices", "devices.vehicleChoices"];
/** Widgets that are platform administration: they also need platform === true. */
const PLATFORM_WIDGETS: ReadonlySet<WidgetKey> = new Set<WidgetKey>(["roles.permissions", "permissions.catalog"]);

export const WIDGETS: Readonly<Record<WidgetKey, Requirement>> = {
  "platform.tenants": { anyOf: ["tenant.all"], operations: ["GET /api/v1/platform/tenants"] },
  "dashboard.fleet": { anyOf: ["device.read"], operations: ["GET /api/v1/dashboard/overview", "GET /api/v1/dashboard/fleet-status", "GET /api/v1/dashboard/trends"] },
  "dashboard.safety": { anyOf: ["alarm.read"], operations: ["GET /api/v1/dashboard/safety-events"] },
  "dashboard.groups": { anyOf: ["group.read"], operations: ["GET /api/v1/groups"] },
  /** A role's assigned permissions (Global Roles → permissions). */
  "roles.permissions": { anyOf: ["role.permission.read"], operations: ["GET /api/v1/roles/{id}/permissions"] },
  /** The permission catalogue (used by the role-permission editor and the catalogue screen). */
  "permissions.catalog": { anyOf: ["role.permission.read", "permission.manage"], operations: ["GET /api/v1/permissions"] },
  /** The Select Role dropdown of the role permission grid. */
  "roleMenu.roles": { anyOf: ["role.read"], operations: ["GET /api/v1/roles"] },
  /** A role's menu permission grid. */
  "roleMenu.matrix": { anyOf: ["role.permission.read"], operations: [ROLE_MENU_READ], offSpec: { operations: [ROLE_MENU_READ], source: ROLE_MENU_CONTRACT } },
  /** Phase 8 — a driver's safety score and events (driver drawer). */
  "drivers.safety": { anyOf: ["alarm.read"], operations: ["GET /api/v1/drivers/{id}/safety-score", "GET /api/v1/drivers/{id}/safety-events"] },
  /** Phase 8 — the vehicle list behind the assign dialog's vehicle picker. */
  "drivers.deviceChoices": { anyOf: ["device.read"], operations: ["GET /api/v1/devices"] },
  /** Phase 8 — a vehicle's driver assignments (vehicle detail, assign dialog). */
  "vehicles.driverAssignments": { anyOf: ["driver.read"], operations: ["GET /api/v1/devices/{id}/driver-assignments"] },
  /**
   * The vehicle picker on the Sensors screen: GET /vehicles?assigned=true. Each entry carries the vehicle number
   * (Sensor Alerts' vehicle_number) and its device id (the device-based sensor, BMS and stops paths).
   */
  "sensors.deviceChoices": {
    anyOf: ["vehicle.read"],
    operations: ["GET /api/v1/vehicles"],
    offSpec: { operations: ["GET /api/v1/vehicles"], source: VEHICLE_CONTRACT },
  },
  /** The Assign Vehicle picker in the Add / Edit device forms: GET /vehicles (assigned and unassigned). */
  "devices.vehicleChoices": {
    anyOf: ["vehicle.read"],
    operations: ["GET /api/v1/vehicles"],
    offSpec: { operations: ["GET /api/v1/vehicles"], source: VEHICLE_CONTRACT },
  },
};

export interface ActionDef {
  /** The screen the action lives on (null = shell-level). The action is offered only where the screen is. */
  screen: ScreenKey | null;
  requires: Requirement;
  /**
   * Tenant-scoped write: V10 answers 400 TENANT_REQUIRED when the Safe-Fare Admin sends it without a
   * tenant. Informational until tenant selection exists (Phase 5) — see needsTenantSelection().
   */
  tenantWrite: boolean;
  /**
   * Phase 5 classification of a tenant write (see docs/phase5-tenant-implementation-plan.md §2):
   * A CREATE_REQUIRES_SELECTED_TENANT · B EXISTING_RECORD_UPDATE · C EXISTING_RECORD_DELETE.
   */
  tenantClass?: TenantClass;
  /** Also needs `identity.platform === true`, on a screen tenant users can open. */
  platformOnly?: boolean;
}

export type TenantClass = "CREATE_REQUIRES_SELECTED_TENANT" | "EXISTING_RECORD_UPDATE" | "EXISTING_RECORD_DELETE";

/** State-changing actions (buttons, forms). One entry per V10 permission boundary. */
export const ACTIONS = {
  "drivers.create": { screen: "drivers", tenantWrite: true, tenantClass: "CREATE_REQUIRES_SELECTED_TENANT", requires: { anyOf: ["driver.create"], operations: ["POST /api/v1/drivers"] } },
  /** Edit, assign a vehicle, end an assignment. */
  "drivers.update": {
    screen: "drivers",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: { anyOf: ["driver.update"], operations: ["PUT /api/v1/drivers/{id}", "POST /api/v1/drivers/{id}/assignments", "POST /api/v1/drivers/{id}/assignments/{assignmentId}/end"] },
  },
  "drivers.delete": { screen: "drivers", tenantWrite: true, tenantClass: "EXISTING_RECORD_DELETE", requires: { anyOf: ["driver.delete"], operations: ["DELETE /api/v1/drivers/{id}"] } },
  "dispatch.create": { screen: "dispatch", tenantWrite: true, tenantClass: "CREATE_REQUIRES_SELECTED_TENANT", requires: { anyOf: ["dispatch.create"], operations: ["POST /api/v1/dispatches"] } },
  /** Edit, cancel, request a swap. */
  "dispatch.update": {
    screen: "dispatch",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: { anyOf: ["dispatch.update"], operations: ["PUT /api/v1/dispatches/{id}", "POST /api/v1/dispatches/{id}/cancel", "POST /api/v1/dispatches/{id}/swap-requests"] },
  },
  "swaps.decide": { screen: "dispatch", tenantWrite: true, tenantClass: "EXISTING_RECORD_UPDATE", requires: { anyOf: ["dispatch.update"], operations: ["POST /api/v1/swap-requests/{id}/approve", "POST /api/v1/swap-requests/{id}/reject"] } },
  /** Request leave on behalf of a driver. */
  "leave.create": { screen: "workforce", tenantWrite: true, tenantClass: "CREATE_REQUIRES_SELECTED_TENANT", requires: { anyOf: ["workforce.create"], operations: ["POST /api/v1/leave-requests"] } },
  "leave.decide": { screen: "workforce", tenantWrite: true, tenantClass: "EXISTING_RECORD_UPDATE", requires: { anyOf: ["workforce.update"], operations: ["POST /api/v1/leave-requests/{id}/approve", "POST /api/v1/leave-requests/{id}/reject"] } },
  /** Acknowledge, comment, resolve, dismiss, reopen. */
  "alerts.handle": {
    screen: "alerts",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: {
      anyOf: ["alarm.handle"],
      operations: ["POST /api/v1/alerts/{id}/acknowledge", "POST /api/v1/alerts/{id}/comments", "POST /api/v1/alerts/{id}/resolve", "POST /api/v1/alerts/{id}/dismiss", "POST /api/v1/alerts/{id}/reopen"],
    },
  },
  "geofences.delete": { screen: "geofences", tenantWrite: true, tenantClass: "EXISTING_RECORD_DELETE", requires: { anyOf: ["geofence.delete"], operations: ["DELETE /api/v1/geofences/{id}"] } },
  "video.export": { screen: "video", tenantWrite: true, tenantClass: "CREATE_REQUIRES_SELECTED_TENANT", requires: { anyOf: ["video.playback"], operations: ["POST /api/v1/video/exports"] } },
  "users.create": { screen: "users", tenantWrite: true, tenantClass: "CREATE_REQUIRES_SELECTED_TENANT", requires: { anyOf: ["user.create"], operations: ["POST /api/v1/users"] } },
  /** Edit, enable / disable, unlock, reset password. */
  "users.update": {
    screen: "users",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: { anyOf: ["user.update"], operations: ["PUT /api/v1/users/{id}", "PATCH /api/v1/users/{id}/status", "POST /api/v1/users/{id}/unlock", "POST /api/v1/users/{id}/password"] },
  },
  /** Own profile and workspace preferences. */
  "settings.manage": { screen: "settings", tenantWrite: false, requires: { signedIn: true, operations: ["PATCH /api/v1/me", "PUT /api/v1/me/preferences"] } },
  /** Own password; offered in Settings and My Profile. */
  "account.password": { screen: null, tenantWrite: false, requires: { signedIn: true, operations: ["POST /api/v1/me/password"] } },
  // Phase 7 — platform administration. Not tenant writes (tenantWrite false): global roles and the catalogue
  // have no tenant, so they aren't blocked in all-tenants mode and are sent without a tenant header.
  "roles.create": { screen: "roles", tenantWrite: false, requires: { anyOf: ["role.manage"], operations: ["POST /api/v1/roles"] } },
  "roles.update": { screen: "roles", tenantWrite: false, requires: { anyOf: ["role.manage"], operations: ["PUT /api/v1/roles/{id}"] } },
  "roles.delete": { screen: "roles", tenantWrite: false, requires: { anyOf: ["role.manage"], operations: ["DELETE /api/v1/roles/{id}"] } },
  "rolePermissions.add": { screen: "roles", tenantWrite: false, requires: { anyOf: ["role.permission.create"], operations: ["POST /api/v1/roles/{id}/permissions"] } },
  "rolePermissions.remove": { screen: "roles", tenantWrite: false, requires: { anyOf: ["role.permission.delete"], operations: ["DELETE /api/v1/roles/{id}/permissions"] } },
  /** Save a role's whole permission list from the Permission Catalogue's role matrix (full replace). */
  /** Save a role's menu permission grid. A tenant write: role permissions belong to one tenant. */
  "roleMenuPermissions.update": {
    screen: "permissions",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: { anyOf: ["role.permission.update"], operations: [ROLE_MENU_WRITE], offSpec: { operations: [ROLE_MENU_WRITE], source: ROLE_MENU_CONTRACT } },
  },
  "permissions.create": { screen: "permissions", tenantWrite: false, platformOnly: true, requires: { anyOf: ["permission.manage"], operations: ["POST /api/v1/permissions"] } },
  "permissions.update": { screen: "permissions", tenantWrite: false, platformOnly: true, requires: { anyOf: ["permission.manage"], operations: ["PUT /api/v1/permissions/{code}"] } },
  "permissions.delete": { screen: "permissions", tenantWrite: false, platformOnly: true, requires: { anyOf: ["permission.manage"], operations: ["DELETE /api/v1/permissions/{code}"] } },
  /**
   * Create a platform tenant. Platform-wide (no tenant header, not blocked in all-tenants mode). The operation
   * isn't in V10; tenant.all (the only tenant code, required by the tenants screen) is assumed until confirmed.
   */
  "tenants.create": {
    screen: "tenants",
    tenantWrite: false,
    requires: {
      anyOf: ["tenant.all"],
      operations: ["POST /api/v1/platform/tenants"],
      offSpec: { operations: ["POST /api/v1/platform/tenants"], source: "Contract from the backend team, 2026-11-02 (not in api-docs-v10.json); permission not documented — tenant.all assumed" },
    },
  },
  /**
   * Edit a device's descriptive fields (PUT /devices/{id}; full replace). Tenant write, class B. Model, protocol,
   * cameras, terminal, group and object type are resent unchanged (possible vendor charges / transfer).
   */
  /**
   * Register a device (POST /devices). Tenant write, class A. Charges: confirmChargeableChange is sent only after the
   * server asks for confirmation and the user accepts its message (components/drive-vision/vehicles/device-create-model.ts).
   */
  "devices.create": { screen: "vehicles", tenantWrite: true, tenantClass: "CREATE_REQUIRES_SELECTED_TENANT", requires: { anyOf: ["device.create"], operations: ["POST /api/v1/devices"] } },
  "devices.update": { screen: "vehicles", tenantWrite: true, tenantClass: "EXISTING_RECORD_UPDATE", requires: { anyOf: ["device.update"], operations: ["PUT /api/v1/devices/{id}"] } },
  // Sensors (off-spec contract). Sending readings needs a tenant (TENANT_REQUIRED); recalculating works on a bus
  // the screen loaded with the same tenant header.
  "sensors.ingest": {
    screen: "sensors",
    tenantWrite: true,
    tenantClass: "CREATE_REQUIRES_SELECTED_TENANT",
    requires: { anyOf: ["sensor.ingest"], operations: ["POST /api/v1/sensors/readings"], offSpec: { operations: ["POST /api/v1/sensors/readings"], source: SENSOR_CONTRACT } },
  },
  "sensors.recalculate": {
    screen: "sensors",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: { anyOf: ["sensor.ingest"], operations: ["POST /api/v1/devices/{id}/stops/recalculate"], offSpec: { operations: ["POST /api/v1/devices/{id}/stops/recalculate"], source: SENSOR_CONTRACT } },
  },
  // Vehicle registry (off-spec contract). The contract documents TENANT_REQUIRED for all three writes.
  "vehicleRegistry.create": {
    screen: "vehicleRegistry",
    tenantWrite: true,
    tenantClass: "CREATE_REQUIRES_SELECTED_TENANT",
    requires: { anyOf: ["vehicle.create"], operations: ["POST /api/v1/vehicles"], offSpec: { operations: ["POST /api/v1/vehicles"], source: VEHICLE_CONTRACT } },
  },
  "vehicleRegistry.update": {
    screen: "vehicleRegistry",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_UPDATE",
    requires: { anyOf: ["vehicle.update"], operations: ["PUT /api/v1/vehicles/{id}"], offSpec: { operations: ["PUT /api/v1/vehicles/{id}"], source: VEHICLE_CONTRACT } },
  },
  "vehicleRegistry.delete": {
    screen: "vehicleRegistry",
    tenantWrite: true,
    tenantClass: "EXISTING_RECORD_DELETE",
    requires: { anyOf: ["vehicle.delete"], operations: ["DELETE /api/v1/vehicles/{id}"], offSpec: { operations: ["DELETE /api/v1/vehicles/{id}"], source: VEHICLE_CONTRACT } },
  },
  /** Own notification read state. */
  "notifications.markRead": {
    screen: null,
    tenantWrite: false,
    requires: { signedIn: true, operations: ["POST /api/v1/notifications/{id}/read", "POST /api/v1/notifications/{id}/unread", "POST /api/v1/notifications/read-all"] },
  },
} as const satisfies Record<string, ActionDef>;

export type ActionKey = keyof typeof ACTIONS;

/**
 * Existing-record writes (class B/C) the backend has CONFIRMED resolve the tenant from the record, so a
 * Safe-Fare Admin may send them without a selected tenant. Empty: V10 documents TENANT_REQUIRED for
 * create/update/delete, and the 2026-11-02 clarification ("where supported") names no operation.
 * Add an action here only with backend confirmation.
 */
export const RECORD_TENANT_RESOLUTION_CONFIRMED: ReadonlySet<ActionKey> = new Set<ActionKey>();
export const ALL_ACTIONS = Object.keys(ACTIONS) as ActionKey[];

/** The policy the resolver applies; tests pass their own registries (e.g. a platform-only screen). */
export interface AccessPolicy {
  screens: Readonly<Partial<Record<ScreenKey, ScreenDef>>>;
  features: Readonly<Record<FeatureKey, Requirement>>;
  actions: Readonly<Partial<Record<ActionKey, ActionDef>>>;
}

export const ACCESS_POLICY: AccessPolicy = { screens: SCREENS, features: FEATURES, actions: ACTIONS };

// ── Server screens (V10 `MyScreenDto.routePath`) → app routes ───────────────

export interface ScreenRoute {
  screen: ScreenKey;
  href: string;
}

/**
 * Backend `routePath` → app route. Only values the backend has actually returned are listed, plus the
 * app's own routes (a backend that sends `/drive-vision/…` maps 1:1). Anything else is "unmapped": it
 * opens nothing and is reported, never guessed.
 * - `/driver/*`: GET /me/menus for a live DRIVER login, 2026-10-29 (docs/evidence/phase3-new-api-integration.md).
 * - `/dashboard`, `/alarms`, `/reports`: GET /me/menus for the admin login, 2026-10-27 (docs/missing-backend-apis.md #3).
 * `null` = known path with no page in this app (driver notifications live in the header bell).
 */
export const SERVER_ROUTE_PATHS: Readonly<Record<string, ScreenRoute | null>> = {
  "/driver/work": { screen: "myWork", href: SCREEN_ROUTES.myWork },
  "/driver/shifts": { screen: "myWork", href: `${SCREEN_ROUTES.myWork}/shifts` },
  "/driver/leave": { screen: "myWork", href: `${SCREEN_ROUTES.myWork}/leave` },
  "/driver/checklist": { screen: "myWork", href: `${SCREEN_ROUTES.myWork}/checklist` },
  "/driver/safety": { screen: "myWork", href: `${SCREEN_ROUTES.myWork}/safety` },
  "/driver/profile": { screen: "myWork", href: `${SCREEN_ROUTES.myWork}/profile` },
  "/driver/notifications": null,
  "/dashboard": { screen: "overview", href: SCREEN_ROUTES.overview },
  "/alarms": { screen: "alerts", href: SCREEN_ROUTES.alerts },
  "/reports": { screen: "reports", href: SCREEN_ROUTES.reports },
  // Vehicle registry menu (menu_key "vehicles"), docs/contracts/vehicle-api.txt.
  "/vehicle-registry": { screen: "vehicleRegistry", href: SCREEN_ROUTES.vehicleRegistry },
  // Sensors menu, docs/contracts/passenger-counting-api.txt.
  "/sensors": { screen: "sensors", href: SCREEN_ROUTES.sensors },
  // Platform screens returned for the Safe-Fare Admin by GET /me/permissions (supplied 2026-11-02).
  "/platform/roles": { screen: "roles", href: SCREEN_ROUTES.roles },
  "/platform/permissions": { screen: "permissions", href: SCREEN_ROUTES.permissions },
  "/tenants": { screen: "tenants", href: SCREEN_ROUTES.tenants },
};

const normalisePath = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

/** The app route for a backend routePath; `undefined` = unmapped, `null` = known, no page. */
export function routeForServerPath(routePath: string | null): ScreenRoute | null | undefined {
  if (routePath === null) return undefined;
  const p = normalisePath(routePath);
  if (Object.hasOwn(SERVER_ROUTE_PATHS, p)) return SERVER_ROUTE_PATHS[p];
  // The app's own routes map to themselves (exact screen route or a known nested route).
  const screen = screenForPath(p);
  if (screen !== null && p.startsWith(DV_BASE)) return { screen, href: p };
  return undefined;
}

// ── Access ───────────────────────────────────────────────────────────────────

export interface ServerScreenEntry extends ScreenRoute {
  title: string | null;
  /** Server order (MyScreenDto has no sortOrder). */
  index: number;
}

export interface Access {
  identity: Identity | null;
  kind: IdentityKind;
  /** `identity.platform === true`. */
  platform: boolean;
  roleCode: string | null;
  /**
   * Effective tenant. Tenant users: identity.tenantId (from the token; a selection is ignored, so it can't be
   * overridden). Safe-Fare Admin: the selected tenant (Phase 5), null in platform-wide mode.
   */
  tenantId: number | null;
  /** Tenant writes the identity may perform but that need a selected tenant first (Safe-Fare Admin, platform-wide mode). */
  tenantBlockedActions: ReadonlySet<ActionKey>;
  permissions: ReadonlySet<string>;
  screens: ReadonlySet<ScreenKey>;
  features: ReadonlySet<FeatureKey>;
  actions: ReadonlySet<ActionKey>;
  /** Server screens that mapped to an app route the user may open, in server order. */
  serverScreens: readonly ServerScreenEntry[];
  /** Server routePaths with no app mapping (reported, never opened). */
  unmappedServerPaths: readonly string[];
}

export const NO_ACCESS: Access = {
  identity: null,
  kind: "none",
  platform: false,
  roleCode: null,
  tenantId: null,
  tenantBlockedActions: new Set(),
  permissions: new Set(),
  screens: new Set(),
  features: new Set(),
  actions: new Set(),
  serverScreens: [],
  unmappedServerPaths: [],
};

/**
 * Whether `identity` satisfies a requirement. No identity satisfies nothing; an empty requirement is
 * invalid. A `signedIn` requirement also needs *some* permission information: an identity with an empty
 * permission set (missing, malformed, or none granted) opens nothing at all, not even Settings.
 */
export function meets(identity: Identity | null, req: Requirement | undefined): boolean {
  if (!identity || !req) return false;
  const has = (c: string) => identity.permissions.has(c);
  const any = req.anyOf && req.anyOf.length ? req.anyOf.some(has) : null;
  const all = req.allOf && req.allOf.length ? req.allOf.every(has) : null;
  if (any === null && all === null) return req.signedIn === true && identity.permissions.size > 0;
  return (any ?? true) && (all ?? true);
}

/** Driver logins: role DRIVER and not platform. Narrows (to the driver app); never grants. */
const isDriverLogin = (identity: Identity) => !identity.platform && identityKind(identity) === "driver";

function audienceAllows(identity: Identity, audience: Audience) {
  if (audience === "driver") return isDriverLogin(identity);
  if (audience === "staff") return !isDriverLogin(identity);
  return true;
}

/** Frontend tenant context passed to the resolver (Phase 5). Only read for platform identities. */
export interface TenantContextInput {
  selectedTenantId?: number | null;
}

export function computeAccess(identity: Identity | null | undefined, policy: AccessPolicy = ACCESS_POLICY, tenant: TenantContextInput = {}): Access {
  if (!identity) return NO_ACCESS;
  // Platform identities work in the selected tenant (or none); tenant users always in their own.
  const tenantId = identity.platform ? (isTenantId(tenant.selectedTenantId) ? tenant.selectedTenantId : null) : identity.tenantId;

  const screens = new Set<ScreenKey>();
  for (const key of ALL_SCREENS) {
    const def = policy.screens[key];
    if (!def) continue;
    if (def.platformOnly && !identity.platform) continue;
    if (!audienceAllows(identity, def.audience)) continue;
    if (meets(identity, (!identity.platform && def.tenantRequires) || def.requires)) screens.add(key);
  }

  // Server screens: map routePaths; collect read-only screens and explicitly denied operation codes.
  const serverScreens: ServerScreenEntry[] = [];
  const unmapped: string[] = [];
  const readOnly = new Set<ScreenKey>();
  const writable = new Set<ScreenKey>();
  const denied = new Map<ScreenKey, Set<string>>();
  identity.screens.forEach((s: IdentityScreen, index) => {
    const route = routeForServerPath(s.routePath);
    if (route === undefined) {
      if (s.routePath !== null) unmapped.push(s.routePath);
      return;
    }
    if (route === null) return;
    (s.readOnly ? readOnly : writable).add(route.screen);
    for (const op of s.operations) {
      if (op.allowed || !op.permissionCode) continue;
      if (!denied.has(route.screen)) denied.set(route.screen, new Set());
      denied.get(route.screen)!.add(op.permissionCode);
    }
    if (screens.has(route.screen) && !serverScreens.some((e) => e.href === route.href)) serverScreens.push({ ...route, title: s.title, index });
  });

  const actions = new Set<ActionKey>();
  for (const key of ALL_ACTIONS) {
    const def = policy.actions[key];
    if (!def || !meets(identity, def.requires)) continue;
    if ((def as ActionDef).platformOnly && !identity.platform) continue;
    if (def.screen !== null) {
      if (!screens.has(def.screen)) continue; // an action is offered only on a screen the user can open
      if (readOnly.has(def.screen) && !writable.has(def.screen)) continue;
      const codes = [...(def.requires.anyOf ?? []), ...(def.requires.allOf ?? [])];
      const deniedHere = denied.get(def.screen);
      if (deniedHere && codes.length > 0 && codes.every((c) => deniedHere.has(c))) continue;
    }
    actions.add(key);
  }

  // Safe-Fare Admin without a tenant: tenant writes would answer 400 TENANT_REQUIRED, so they aren't offered.
  const tenantBlockedActions = new Set<ActionKey>();
  if (identity.platform && tenantId === null) {
    for (const key of [...actions]) {
      if (policy.actions[key]?.tenantWrite && !RECORD_TENANT_RESOLUTION_CONFIRMED.has(key)) {
        actions.delete(key);
        tenantBlockedActions.add(key);
      }
    }
  }

  const features = new Set<FeatureKey>(ALL_FEATURES.filter((f) => meets(identity, policy.features[f])));

  return {
    identity,
    kind: identityKind(identity),
    platform: identity.platform,
    roleCode: identity.roleCode,
    tenantId,
    tenantBlockedActions,
    permissions: identity.permissions,
    screens,
    features,
    actions,
    serverScreens,
    unmappedServerPaths: unmapped,
  };
}

// ── Driver app operations ───────────────────────────────────────────────────

/**
 * Which server operation each driver control is. This is only the mapping: whether an operation is allowed always
 * comes from `screens[].operations[].allowed` in GET /me/permissions (isScreenOperationAllowed).
 */
export const DRIVER_OPERATIONS = {
  "work.read": { menuKey: "my_work", permissionCode: "driver.app.work.read" },
  "work.respond": { menuKey: "my_work", permissionCode: "driver.app.work.respond" },
  "work.execute": { menuKey: "my_work", permissionCode: "driver.app.work.execute" },
  "swap.create": { menuKey: "my_work", permissionCode: "driver.app.swap.create" },
  "shift.read": { menuKey: "my_shifts", permissionCode: "driver.app.shift.read" },
  "shift.start": { menuKey: "my_shifts", permissionCode: "driver.app.shift.start" },
  "shift.end": { menuKey: "my_shifts", permissionCode: "driver.app.shift.end" },
  "leave.read": { menuKey: "my_leave", permissionCode: "driver.app.leave.read" },
  "leave.create": { menuKey: "my_leave", permissionCode: "driver.app.leave.create" },
  "leave.cancel": { menuKey: "my_leave", permissionCode: "driver.app.leave.cancel" },
  "checklist.read": { menuKey: "shift_checklist", permissionCode: "driver.app.checklist.read" },
  "checklist.submit": { menuKey: "shift_checklist", permissionCode: "driver.app.checklist.submit" },
  "safety.read": { menuKey: "my_safety", permissionCode: "driver.app.safety.read" },
  "profile.read": { menuKey: "my_profile", permissionCode: "driver.app.profile.read" },
  "profile.update": { menuKey: "my_profile", permissionCode: "driver.app.profile.update" },
} as const;
export type DriverOperation = keyof typeof DRIVER_OPERATIONS;

export function canDriver(access: Access, operation: DriverOperation): boolean {
  const { menuKey, permissionCode } = DRIVER_OPERATIONS[operation];
  return isScreenOperationAllowed(access.identity, menuKey, permissionCode);
}

// ── Checks (the only way components ask) ─────────────────────────────────────

export const hasPermission = (access: Access, code: string) => access.permissions.has(code);
export const canAccessScreen = (access: Access, screen: ScreenKey) => access.screens.has(screen);
export const canUseFeature = (access: Access, feature: FeatureKey) => access.features.has(feature);
export const canPerform = (access: Access, action: ActionKey) => access.actions.has(action);

/** Platform administration: Safe-Fare Admin (`platform === true`) holding `tenant.all` (GET /platform/tenants). */
export const PLATFORM_PERMISSION = "tenant.all";
export const canAccessPlatform = (access: Access) => access.platform && access.permissions.has(PLATFORM_PERMISSION);

/** The catalogue view of the Permission Catalogue screen: Safe-Fare Admin with permission.manage, never a tenant user. */
export const canManageCatalogue = (access: Access) => access.platform && access.permissions.has("permission.manage");

/**
 * Whether tenant-scoped requests have a tenant: tenant users always do (it comes from their token);
 * the Safe-Fare Admin only once `identity.tenantId` is set (tenant selection, Phase 5).
 */
export const hasTenantContext = (access: Access) => access.identity !== null && (!access.platform || access.tenantId !== null);

/** True when the action is a tenant-scoped write the server would reject (TENANT_REQUIRED) for lack of a tenant. */
export function needsTenantSelection(access: Access, action: ActionKey, policy: AccessPolicy = ACCESS_POLICY): boolean {
  return policy.actions[action]?.tenantWrite === true && !hasTenantContext(access) && !RECORD_TENANT_RESOLUTION_CONFIRMED.has(action);
}

/** Why an action isn't offered: "tenant" = permitted but needs a selected tenant; "permission" = not permitted; null = offered. */
export function actionBlock(access: Access, action: ActionKey): "tenant" | "permission" | null {
  if (access.actions.has(action)) return null;
  return access.tenantBlockedActions.has(action) ? "tenant" : "permission";
}

/** Screens with at least one tenant write the identity could perform once a tenant is selected. */
export function tenantBlockedScreens(access: Access, policy: AccessPolicy = ACCESS_POLICY): Set<ScreenKey> {
  const out = new Set<ScreenKey>();
  for (const key of access.tenantBlockedActions) {
    const screen = policy.actions[key]?.screen;
    if (screen) out.add(screen);
  }
  return out;
}

/** Whether a dashboard widget's own data may be requested. Platform widgets also need platform access. */
export function canViewWidget(access: Access, widget: WidgetKey): boolean {
  if (widget === "platform.tenants" && !canAccessPlatform(access)) return false;
  if (PLATFORM_WIDGETS.has(widget) && !access.platform) return false;
  return meets(access.identity, WIDGETS[widget]);
}

/**
 * Whose data tenant-scoped reads return, from the identity alone (no request is changed):
 * - `all-tenants` — Safe-Fare Admin with no tenant selected: V10 reads without X-Tenant-Id cover every tenant.
 * - `tenant`      — a tenant user (tenant from the token), or a Safe-Fare Admin with a tenant set.
 * - `none`        — no identity.
 */
export type DataScope = "all-tenants" | "tenant" | "none";
export function dataScope(access: Access): DataScope {
  if (!access.identity) return "none";
  return access.platform && access.tenantId === null ? "all-tenants" : "tenant";
}

/**
 * The one answer to "where does this user start?", from their identity and what they can open:
 * Safe-Fare Admin → Platform Overview; driver → the first driver section they can read; anyone else → Fleet Overview
 * if allowed, then the first screen of the server's menu, then the first allowed screen. Null = no screen at all.
 */
export function defaultLanding(access: Access): string | null {
  if (access.screens.has("platform")) return SCREEN_ROUTES.platform;
  if (access.kind === "driver" && access.screens.has("myWork")) return DRIVER_SECTIONS.find((s) => canDriver(access, DRIVER_SECTION_READ[s.routePath]))?.href ?? SCREEN_ROUTES.myWork;
  if (access.screens.has("overview")) return SCREEN_ROUTES.overview;
  const fromMenu = [...access.serverScreens].sort((a, b) => a.index - b.index)[0];
  if (fromMenu) return fromMenu.href;
  const home = homeScreen(access);
  return home ? SCREEN_ROUTES[home] : null;
}

/**
 * Where a sign-in ends up. A requested path is only a request: it is kept when this user can open it, otherwise the
 * user's own default applies, so a route left over from another account never decides the landing page.
 */
export function postLoginRoute(access: Access, requested: string | null): string | null {
  const landing = defaultLanding(access);
  if (!requested || normalisePath(requested) === DV_BASE) return landing;
  return canAccessPath(access, requested) ? requested : landing;
}

/** The screen a pathname belongs to (longest route prefix on a segment boundary), or null. */
export function screenForPath(pathname: string): ScreenKey | null {
  const path = normalisePath(pathname);
  let best: ScreenKey | null = null;
  for (const screen of ALL_SCREENS) {
    const route = SCREEN_ROUTES[screen];
    if ((path === route || path.startsWith(`${route}/`)) && (best === null || route.length > SCREEN_ROUTES[best].length)) best = screen;
  }
  return best;
}

/** A path is reachable only when it belongs to a known screen the user may open. Unknown paths are denied. */
export function canAccessPath(access: Access, pathname: string): boolean {
  const screen = screenForPath(pathname);
  return screen !== null && access.screens.has(screen);
}

/** In-app link targets that are kept only when the user may open them (profile menu, notification footer). */
export function reachableHref(access: Access, href: string | null): string | null {
  return href !== null && canAccessPath(access, href) ? href : null;
}

/** Profile-menu shortcuts, in display order; each is shown only when its screen is allowed. */
const PROFILE_MENU_LINKS = [
  { screen: "settings", label: "Profile & preferences" },
  { screen: "users", label: "Users & sub-accounts" },
] as const satisfies readonly { screen: ScreenKey; label: string }[];

export function profileMenuLinks(access: Access): { screen: ScreenKey; label: string; href: string }[] {
  return PROFILE_MENU_LINKS.filter((l) => canAccessScreen(access, l.screen)).map((l) => ({ ...l, href: SCREEN_ROUTES[l.screen] }));
}

/**
 * Search results the user may see: page results for openable screens; record results only with
 * the `recordSearch` feature and only into openable screens.
 */
export function visibleSearchResults<R extends { href: string | null }>(access: Access, pages: readonly R[], records: readonly R[]): { pages: R[]; records: R[] } {
  const reachable = (r: R) => r.href !== null && canAccessPath(access, r.href);
  return { pages: pages.filter(reachable), records: canUseFeature(access, "recordSearch") ? records.filter(reachable) : [] };
}

/** First screen the user may open, in route order — the landing page for a denied route. */
export function homeScreen(access: Access): ScreenKey | null {
  return ALL_SCREENS.find((s) => access.screens.has(s)) ?? null;
}

/** Keeps nav items whose screen is allowed and drops groups that end up empty. */
export function filterNavGroups<G extends { items: readonly { screen: ScreenKey }[] }>(groups: readonly G[], access: Access): G[] {
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => access.screens.has(i.screen)) })).filter((g) => g.items.length > 0);
}

export type AuthStatusInput = "unknown" | "authenticated" | "unauthenticated" | "error";

export type RouteDecision =
  | { kind: "checking" }
  | { kind: "login"; next: string }
  | { kind: "session-error" }
  | { kind: "allow"; screen: ScreenKey }
  | { kind: "forbidden"; screen: ScreenKey | null; reason: "unknown-route" | "no-access" | "no-permissions" };

/**
 * What a /drive-vision route renders. Authentication is decided first (AuthGate), then the screen
 * grant. Anything that can't be verified is denied. `no-permissions` = signed in, but the identity
 * opens no screen at all (missing / malformed identity, or no matching permission).
 */
export function decideRoute(status: AuthStatusInput, access: Access, pathname: string): RouteDecision {
  if (status === "unknown") return { kind: "checking" };
  if (status === "unauthenticated") return { kind: "login", next: pathname };
  if (status === "error") return { kind: "session-error" };
  const screen = screenForPath(pathname);
  if (screen === null) return { kind: "forbidden", screen: null, reason: normalisePath(pathname) === DV_BASE ? "no-permissions" : "unknown-route" };
  if (access.screens.has(screen)) return { kind: "allow", screen };
  return { kind: "forbidden", screen, reason: access.screens.size === 0 ? "no-permissions" : "no-access" };
}

/**
 * Where the generic entry points go: `/drive-vision` always resolves to the user's default, and Overview does when
 * the user can't open it. Deep links to any other screen keep showing the access-denied panel, so a typed URL is
 * never silently rewritten.
 */
export function landingRedirect(access: Access, pathname: string): string | null {
  const path = normalisePath(pathname);
  if (path === DV_BASE) return defaultLanding(access);
  if (path === SCREEN_ROUTES.overview && !access.screens.has("overview")) return defaultLanding(access);
  return null;
}

/**
 * Where to go when the page the user was on stops being available (permissions re-read after a token refresh). Only
 * for a page they had open: a deep link that was never allowed stays denied, so a denied page can't start a loop.
 */
export function revokedRouteRedirect(access: Access, pathname: string, wasOpen: boolean): string | null {
  return wasOpen && !canAccessPath(access, pathname) ? defaultLanding(access) : null;
}

// ── Driver navigation ────────────────────────────────────────────────────────

export interface DriverNavEntry {
  /** Backend routePath this entry corresponds to. */
  routePath: string;
  title: string;
  href: string;
}

/** The driver app's sections, in the order and with the titles the backend menu used (2026-10-29). */
export const DRIVER_SECTIONS: readonly DriverNavEntry[] = [
  { routePath: "/driver/work", title: "My Work", href: SCREEN_ROUTES.myWork },
  { routePath: "/driver/shifts", title: "My Shifts", href: `${SCREEN_ROUTES.myWork}/shifts` },
  { routePath: "/driver/leave", title: "My Leave", href: `${SCREEN_ROUTES.myWork}/leave` },
  { routePath: "/driver/checklist", title: "Shift Checklist", href: `${SCREEN_ROUTES.myWork}/checklist` },
  { routePath: "/driver/safety", title: "My Safety", href: `${SCREEN_ROUTES.myWork}/safety` },
  { routePath: "/driver/profile", title: "My Profile", href: `${SCREEN_ROUTES.myWork}/profile` },
];

const DRIVER_SECTION_READ: Readonly<Record<string, DriverOperation>> = {
  "/driver/work": "work.read",
  "/driver/shifts": "shift.read",
  "/driver/leave": "leave.read",
  "/driver/checklist": "checklist.read",
  "/driver/safety": "safety.read",
  "/driver/profile": "profile.read",
};

/**
 * Driver navigation. When the server's `screens` map to driver sections, those entries are used in
 * server order with the server's titles; otherwise every section is listed. Empty unless the user may
 * open My Work, so the screens list can never widen access.
 */
export function driverNavEntries(access: Access): DriverNavEntry[] {
  if (!access.screens.has("myWork")) return [];
  const fromServer: DriverNavEntry[] = [];
  for (const e of [...access.serverScreens].sort((a, b) => a.index - b.index)) {
    const section = e.screen === "myWork" ? DRIVER_SECTIONS.find((s) => s.href === e.href) : undefined;
    if (section && !fromServer.some((f) => f.href === section.href)) fromServer.push({ ...section, title: e.title ?? section.title });
  }
  return fromServer.length ? fromServer : [...DRIVER_SECTIONS];
}

/**
 * The nav item to highlight: the longest item href that equals the path or is its parent on a
 * segment boundary (query and hash ignored).
 */
export function activeNavHref(hrefs: readonly string[], pathname: string): string | null {
  const path = normalisePath(pathname);
  let best: string | null = null;
  for (const href of hrefs) {
    const h = normalisePath(href);
    if ((path === h || path.startsWith(`${h}/`)) && (best === null || h.length > normalisePath(best).length)) best = href;
  }
  return best;
}
