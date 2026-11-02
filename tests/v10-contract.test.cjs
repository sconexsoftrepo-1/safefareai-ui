// V10 contract tests (Phase 1). Source of truth: docs/openapi/api-docs-v10.json.
//
// 1. Spec metadata: the file is the V10 contract (counts, permissions, tenant selector, public ops).
// 2. Static contract: every BFF call site in src/features/drive-vision/api, analysed with the
//    TypeScript type checker (tests/helpers/v10-contract.cjs), must match a V10 operation; its query
//    parameters, request body and response type must agree with V10 (names, required fields, value sets).
//    Known, documented deviations are listed below and must stay exact — a new deviation fails, and so
//    does a listed deviation that no longer exists (the list can't go stale).
// 3. Negative controls: the same checker run against deliberately broken copies of the spec must
//    report the breakage, so a green run can't be a vacuous pass.
// 4. Runtime requests: services not covered by operations-api.test.cjs (fleet, admin, account, auth,
//    refresh) are run against a stub fetch; the request actually built must be the V10 operation.
// 5. Coverage: every operation the frontend calls has a runtime request case here or in
//    operations-api.test.cjs.
// MOCKED: nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const contract = require("./helpers/v10-contract.cjs");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const SPEC = contract.loadSpec();
const OPS = contract.specOperations(SPEC);
const SITES = contract.collectCallSites();
const RESULT = contract.analyse(SPEC, SITES);
const same = (got, want) => assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)));
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── 1. Spec metadata ─────────────────────────────────────────────────────────

test("spec file is the V10 contract: 164 paths, 220 operations, 297 schemas", () => {
  assert.equal(Object.keys(SPEC.paths).length, 164);
  assert.equal(OPS.length, 220);
  assert.equal(Object.keys(SPEC.components.schemas).length, 297);
  assert.equal(SPEC.openapi, "3.1.0");
  same(SPEC.security, [{ bearerAuth: [] }]);
  assert.equal(SPEC.components.securitySchemes.bearerAuth.scheme, "bearer");
});

test("every V10 operation documents its required permission (or is public), with well-formed codes", () => {
  const bad = [];
  for (const o of OPS) {
    const p = contract.permissionOf(o.op);
    if (p === null) bad.push(`${o.key}: no permission text`);
    for (const code of contract.permissionCodes(p)) if (!/^[a-z]+(\.[a-z]+)*$/.test(code)) bad.push(`${o.key}: malformed code ${JSON.stringify(code)}`);
  }
  same(bad, []);
});

test("only login and refresh are public; every other operation accepts the tenant selector (X-Tenant-Id / tenantId)", () => {
  const pub = OPS.filter((o) => contract.permissionOf(o.op) === "public").map((o) => o.key);
  same(pub.sort(), ["POST /api/v1/auth/login", "POST /api/v1/auth/refresh"]);
  const missing = OPS.filter((o) => !pub.includes(o.key)).filter((o) => {
    const ps = o.op.parameters || [];
    return !ps.some((p) => p.in === "header" && p.name === "X-Tenant-Id") || !ps.some((p) => p.in === "query" && p.name === "tenantId");
  });
  same(missing.map((o) => o.key), []);
});

test("V10 identity contracts the next phases depend on are present with the documented shape", () => {
  const S = SPEC.components.schemas;
  same(S.LoginRequest.required, ["login", "password"]); // tenantCode optional: Safe-Fare Admin omits it
  for (const f of ["userId", "platform", "homeTenantId", "tenantId", "roleId", "roleCode", "permissions", "screens"]) assert.ok(S.MyPermissionsDto.properties[f], `MyPermissionsDto.${f}`);
  for (const f of ["menuKey", "title", "routePath", "icon", "parentId", "readOnly", "resources", "operations"]) assert.ok(S.MyScreenDto.properties[f], `MyScreenDto.${f}`);
  for (const f of ["id", "code", "name", "status", "timezone", "users", "devices", "drivers", "current"]) assert.ok(S.TenantDto.properties[f], `TenantDto.${f}`);
  same(S.SwitchTenantRequest.required, ["tenantId"]);
  for (const f of ["tenantId", "permissions", "roles"]) assert.ok(S.PermissionMatrixDto.properties[f], `PermissionMatrixDto.${f}`);
  assert.equal(contract.permissionOf(SPEC.paths["/api/v1/platform/tenants"].get), "tenant.all");
  assert.equal(contract.permissionOf(SPEC.paths["/api/v1/platform/switch-tenant"].post), "tenant.all");
  assert.equal(contract.permissionOf(SPEC.paths["/api/v1/roles/{id}/permissions"].put), "role.permission.update");
});

// ── 2. Static contract of every call site ────────────────────────────────────

/**
 * Documented deviations (docs/v10-compatibility-report.md). Keys: `<operation> <where>`.
 * WARN: PUT /me/preferences is a full replace; the UI sends back the object it loaded (all fields),
 * but the request type marks the V10-required fields optional.
 */
const KNOWN_WARNINGS = ["theme", "homeModules", "deviceInfoFields", "videoLayout", "trackAlarmTypeIds", "expiryReminderMode"].map((f) => `PUT /api/v1/me/preferences body.${f}`);

/**
 * V10 response fields the frontend types don't declare. Phase 2–3 mapped all 15 V10 additions
 * (CurrentUserDto.platform, RoleDto.fullAccess/tenantId/activeUsers, PermissionDto.scope, ActionRow.stepNo),
 * so the list is empty: any new V10 field the types miss fails this test until it's typed or listed here.
 */
const KNOWN_UNMAPPED_RESPONSE_FIELDS = [];

const findings = (level) => RESULT.sites.flatMap((s) => s.findings.filter((f) => f.level === level).map((f) => ({ ...f, key: `${s.operation ?? `${s.method} ${s.path}`} ${f.where}`, site: `${s.file}:${s.line}` })));

test("static analysis found the frontend's BFF call sites", () => {
  assert.ok(SITES.length >= 130, `found ${SITES.length} call sites`);
  for (const s of SITES) assert.ok(s.response || s.method === "DELETE" || s.responseTypeText === "unknown", `${s.file}:${s.line} has a response type argument`);
});

/**
 * Call sites outside V10, each with a backend-supplied contract. Exact list: a new off-spec call fails, and so
 * does a listed one that no longer exists. Their requests are checked in their own tests.
 */
const OFF_SPEC_CALLS = {
  "POST /platform/tenants": "Tenant creation — contract from the backend team 2026-11-02; tests/tenant-create.test.cjs",
};

test("every call site matches a V10 operation (method + path), except the documented off-spec calls", () => {
  const off = RESULT.sites.filter((s) => !s.operation).map((s) => `${s.method} ${s.path}`);
  same(off.filter((k) => !(k in OFF_SPEC_CALLS)).map((k) => k), []);
  same([...new Set(off)].sort(), Object.keys(OFF_SPEC_CALLS).sort());
});

test("no call site contradicts V10: query parameters, required parameters, request bodies, response fields, value sets, auth", () => {
  same(findings("error").filter((f) => !(/no V10 operation matches/.test(f.msg) && Object.keys(OFF_SPEC_CALLS).some((k) => f.key.startsWith(`${k} `)))).map((f) => `${f.key}: ${f.msg} (${f.site})`), []);
});

test("warnings are exactly the documented ones", () => {
  same([...new Set(findings("warn").map((f) => f.key))].sort(), [...KNOWN_WARNINGS].sort());
});

test("V10 response fields not mapped by the frontend are exactly the documented V10 additions", () => {
  const got = findings("info").filter((f) => f.where.startsWith("data")).map((f) => f.key);
  same([...new Set(got)].sort(), [...KNOWN_UNMAPPED_RESPONSE_FIELDS].sort());
});

test("login and refresh go without a bearer token; every other call sends it", () => {
  const unauth = RESULT.sites.filter((s) => !s.auth).map((s) => s.operation).sort();
  same(unauth, ["POST /api/v1/auth/login", "POST /api/v1/auth/refresh"]);
});

// ── 3. Negative controls ─────────────────────────────────────────────────────

function errorsWith(mutate) {
  const spec = clone(SPEC);
  mutate(spec);
  return contract.analyse(spec, SITES).sites.flatMap((s) => s.findings.filter((f) => f.level === "error").map((f) => `${s.operation ?? `${s.method} ${s.path}`} ${f.where}`));
}

test("negative control: a response field renamed in the spec is reported", () => {
  const errs = errorsWith((s) => {
    const p = s.components.schemas.RoleDto.properties;
    p.roleCode = p.code;
    delete p.code;
  });
  assert.ok(errs.includes("GET /api/v1/roles data[].code"), errs.join("\n"));
});

test("negative control: a query parameter removed from the spec is reported", () => {
  const errs = errorsWith((s) => {
    const op = s.paths["/api/v1/devices"].get;
    op.parameters = op.parameters.filter((p) => p.name !== "keyword");
  });
  assert.ok(errs.includes("GET /api/v1/devices ?keyword"), errs.join("\n"));
});

test("negative control: a new required query parameter is reported", () => {
  const errs = errorsWith((s) => s.paths["/api/v1/groups"].get.parameters.push({ in: "query", name: "scopeX", required: true, schema: { type: "string" } }));
  assert.ok(errs.includes("GET /api/v1/groups ?scopeX"), errs.join("\n"));
});

test("negative control: a removed operation is reported", () => {
  const errs = errorsWith((s) => delete s.paths["/api/v1/drivers/{id}/assignments/{assignmentId}/end"]);
  assert.ok(errs.some((e) => e.startsWith("POST /drivers/{}/assignments/{}/end")), errs.join("\n"));
});

test("negative control: a narrowed value set (pattern) is reported", () => {
  const errs = errorsWith((s) => (s.components.schemas.StatusRequest.properties.status.pattern = "ACTIVE|SUSPENDED"));
  assert.ok(errs.includes("PATCH /api/v1/users/{id}/status body.status"), errs.join("\n"));
});

test("negative control: a new required request-body field is reported", () => {
  const errs = errorsWith((s) => {
    const r = s.components.schemas.CancelRequest ?? s.components.schemas[contract.schemaName(s.paths["/api/v1/dispatches/{id}/cancel"].post.requestBody.content["application/json"].schema)];
    r.properties.approvalCode = { type: "string" };
    r.required = [...(r.required || []), "approvalCode"];
  });
  assert.ok(errs.includes("POST /api/v1/dispatches/{id}/cancel body.approvalCode"), errs.join("\n"));
});

test("negative control: a request field removed from the spec is reported", () => {
  const errs = errorsWith((s) => delete s.components.schemas.CreateUserRequest.properties.parentUserId);
  assert.ok(errs.includes("POST /api/v1/users body.parentUserId"), errs.join("\n"));
});

// ── 4. Runtime request cases (fleet, admin, account, auth, refresh) ──────────

const STORAGE_KEY = "safefare:session:v1";
const TOKENS = { accessToken: "h.eyJleHAiOjQxMDI0NDQ4MDB9.s", tokenType: "Bearer", expiresIn: 600, refreshToken: "r2", refreshExpiresIn: 3600 };

function openRealm({ signedIn = true } = {}) {
  const storage = new MemoryStorage();
  if (signedIn) storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const keys = [...new Set(u.searchParams.keys())];
    calls.push({ method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(keys.map((k) => [k, u.searchParams.getAll(k).length > 1 ? u.searchParams.getAll(k) : u.searchParams.get(k)])), body: init.body ? JSON.parse(init.body) : undefined, auth: !!init.headers?.Authorization, headers: init.headers });
    const data = /\/auth\/(login|refresh)$/.test(u.pathname) ? TOKENS : null;
    return new Response(JSON.stringify({ code: 200, msg: "Success", data }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm(
    { console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } },
    { react: { useSyncExternalStore: () => undefined } }
  );
  const r = (m) => realm.require(`features/drive-vision/api/${m}`);
  return { calls, fleet: r("fleet-service").fleetService, admin: r("admin-service").adminService, account: r("account-service").accountService, auth: r("auth-service").authService, platform: r("platform-service").platformService, roles: r("role-admin-service").roleAdminService, client: r("client") };
}

const W = { from: "2026-10-22T00:00:00.000Z", to: "2026-10-29T00:00:00.000Z" };
const PREFS = { theme: "light", nightModeEnabled: false, mapClusterEnabled: true, homeModules: ["fleet"], deviceInfoFields: ["speed"], videoLayout: "GRID_4", videoAutoStopMin: 5, trackAlarmTypeIds: [1], alarmPopupCloseSec: 10, alarmPopupMax: 10, expiryReminderDays: 30, expiryReminderMode: "BADGE" };

/** [label, (s) => promise, { method, path, query?, body?, auth? }, realm options?] */
const CASES = [
  // fleet-service
  ["groups", (s) => s.fleet.listGroups(), { method: "GET", path: "/api/v1/groups" }],
  ["devices", (s) => s.fleet.listDevices({ groupId: 2, keyword: "ab", pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/devices", query: { groupId: "2", keyword: "ab", pageNumber: "1", pageSize: "20" } }],
  ["device", (s) => s.fleet.getDevice(7), { method: "GET", path: "/api/v1/devices/7" }],
  ["track", (s) => s.fleet.track(7, { ...W, includeStops: true, minStopMinutes: 5 }), { method: "GET", path: "/api/v1/devices/7/track", query: { ...W, includeStops: "true", minStopMinutes: "5" } }],
  ["realtime", (s) => s.fleet.realtime([1, 2]), { method: "GET", path: "/api/v1/monitor/realtime", query: { deviceIds: ["1", "2"] } }],
  ["routine alarms", (s) => s.fleet.routineAlarms({ ...W, alarmTypeIds: [3], deviceIds: [1, 2], pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/alarms/routine", query: { ...W, alarmTypeIds: "3", deviceIds: ["1", "2"], pageNumber: "1", pageSize: "20" } }],
  ["ai alarms", (s) => s.fleet.aiAlarms(W), { method: "GET", path: "/api/v1/alarms/ai", query: W }],
  ["status catalogue", (s) => s.fleet.statusCatalog(), { method: "GET", path: "/api/v1/reference/statuses" }],
  ["device models", (s) => s.fleet.deviceModels(), { method: "GET", path: "/api/v1/reference/device-models" }],
  ["protocols", (s) => s.fleet.protocols(), { method: "GET", path: "/api/v1/reference/protocols" }],
  ["object types", (s) => s.fleet.objectTypes({ category: 1 }), { method: "GET", path: "/api/v1/reference/object-types", query: { category: "1" } }],
  ["alarm types", (s) => s.fleet.alarmTypes({ category: 2, active: true }), { method: "GET", path: "/api/v1/reference/alarm-types", query: { category: "2", active: "true" } }],
  ["geofences", (s) => s.fleet.listGeofences({ shape: "AREA", name: "x" }), { method: "GET", path: "/api/v1/geofences", query: { shape: "AREA", name: "x" } }],
  ["geofence delete", (s) => s.fleet.deleteGeofence(4), { method: "DELETE", path: "/api/v1/geofences/4" }],
  ["mileage report", (s) => s.fleet.mileageReport({ ...W, deviceIds: [1] }), { method: "GET", path: "/api/v1/reports/mileage", query: { ...W, deviceIds: "1" } }],
  ["driving report", (s) => s.fleet.activityReport("driving", { ...W, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/reports/driving", query: { ...W, pageNumber: "1", pageSize: "20" } }],
  ["parking report", (s) => s.fleet.activityReport("parking", W), { method: "GET", path: "/api/v1/reports/parking", query: W }],
  ["media report", (s) => s.fleet.mediaReport(W), { method: "GET", path: "/api/v1/reports/media", query: W }],
  ["recording calendar", (s) => s.fleet.recordingCalendar(7, "2026-10"), { method: "GET", path: "/api/v1/devices/7/recording-calendar", query: { month: "2026-10" } }],
  ["recordings", (s) => s.fleet.recordings(7, { ...W, channel: 1 }), { method: "GET", path: "/api/v1/devices/7/recordings", query: { ...W, channel: "1" } }],
  ["video exports", (s) => s.fleet.listExports({ deviceId: 7, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/video/exports", query: { deviceId: "7", pageNumber: "1", pageSize: "20" } }],
  ["video export request", (s) => s.fleet.requestExport({ deviceId: 7, channel: 1, ...W }), { method: "POST", path: "/api/v1/video/exports", body: { deviceId: 7, channel: 1, ...W } }],
  ["command types", (s) => s.fleet.commandTypes(), { method: "GET", path: "/api/v1/commands/types" }],
  ["commands", (s) => s.fleet.listCommands({ type: "REBOOT", deviceId: 7, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/commands", query: { type: "REBOOT", deviceId: "7", pageNumber: "1", pageSize: "20" } }],
  ["command", (s) => s.fleet.getCommand(3), { method: "GET", path: "/api/v1/commands/3" }],
  // admin-service
  ["users", (s) => s.admin.listUsers({ keyword: "a", status: "ACTIVE", roleId: 2, parentUserId: 1, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/users", query: { keyword: "a", status: "ACTIVE", roleId: "2", parentUserId: "1", pageNumber: "1", pageSize: "20" } }],
  ["user", (s) => s.admin.getUser(5), { method: "GET", path: "/api/v1/users/5" }],
  ["user tree", (s) => s.admin.userTree(), { method: "GET", path: "/api/v1/users/tree" }],
  ["user create", (s) => s.admin.createUser({ displayName: "A", password: "secret-1", roleId: 2, parentUserId: 1 }), { method: "POST", path: "/api/v1/users", body: { displayName: "A", password: "secret-1", roleId: 2, parentUserId: 1 } }],
  ["user update", (s) => s.admin.updateUser(5, { displayName: "A", roleId: 2 }), { method: "PUT", path: "/api/v1/users/5", body: { displayName: "A", roleId: 2 } }],
  ["user status", (s) => s.admin.setStatus(5, { status: "DISABLED" }), { method: "PATCH", path: "/api/v1/users/5/status", body: { status: "DISABLED" } }],
  ["user unlock", (s) => s.admin.unlock(5), { method: "POST", path: "/api/v1/users/5/unlock" }],
  ["user password reset", (s) => s.admin.resetPassword(5, { newPassword: "secret-2" }), { method: "POST", path: "/api/v1/users/5/password", body: { newPassword: "secret-2" } }],
  ["roles", (s) => s.admin.listRoles(), { method: "GET", path: "/api/v1/roles" }],
  ["permissions", (s) => s.admin.listPermissions(), { method: "GET", path: "/api/v1/permissions" }],
  // account-service
  ["update me", (s) => s.account.updateMe({ displayName: "A" }), { method: "PATCH", path: "/api/v1/me", body: { displayName: "A" } }],
  ["preferences", (s) => s.account.preferences(), { method: "GET", path: "/api/v1/me/preferences" }],
  ["save preferences", (s) => s.account.savePreferences(PREFS), { method: "PUT", path: "/api/v1/me/preferences", body: PREFS }],
  ["change password", (s) => s.account.changePassword({ currentPassword: "old-1", newPassword: "new-1" }), { method: "POST", path: "/api/v1/me/password", body: { currentPassword: "old-1", newPassword: "new-1" } }],
  // auth-service + refresh (current behaviour: the login body is sent as given; Phase 2 changes the form, not this service)
  ["login", (s) => s.auth.login({ tenantCode: "T1", login: "u", password: "p" }), { method: "POST", path: "/api/v1/auth/login", body: { tenantCode: "T1", login: "u", password: "p" }, auth: false }, { signedIn: false }],
  ["logout", (s) => s.auth.logout(), { method: "POST", path: "/api/v1/auth/logout", body: { refreshToken: "r" } }],
  ["me", (s) => s.auth.me(), { method: "GET", path: "/api/v1/me" }],
  ["my menus", (s) => s.auth.myMenus(), { method: "GET", path: "/api/v1/me/menus" }],
  ["my permissions", (s) => s.auth.myPermissions(), { method: "GET", path: "/api/v1/me/permissions" }],
  // platform-service (Phase 4): all-tenant read, no tenant selector
  ["platform tenants", (s) => s.platform.tenants(), { method: "GET", path: "/api/v1/platform/tenants" }],
  ["switch tenant", (s) => s.platform.switchTenant(7), { method: "POST", path: "/api/v1/platform/switch-tenant", body: { tenantId: 7 } }],
  // role-admin-service (Phase 7): global roles / catalogue, always without a tenant header
  ["admin roles", (s) => s.roles.listRoles(), { method: "GET", path: "/api/v1/roles" }],
  ["create role", (s) => s.roles.createRole({ code: "OPS_LEAD", description: "Ops lead" }), { method: "POST", path: "/api/v1/roles", body: { code: "OPS_LEAD", description: "Ops lead" } }],
  ["update role", (s) => s.roles.updateRole(4, { description: "x" }), { method: "PUT", path: "/api/v1/roles/4", body: { description: "x" } }],
  ["delete role", (s) => s.roles.deleteRole(4), { method: "DELETE", path: "/api/v1/roles/4" }],
  ["role permissions", (s) => s.roles.rolePermissions(4), { method: "GET", path: "/api/v1/roles/4/permissions" }],
  ["add role permissions", (s) => s.roles.addRolePermissions(4, ["device.read"]), { method: "POST", path: "/api/v1/roles/4/permissions", body: { permissionCodes: ["device.read"] } }],
  ["remove role permissions", (s) => s.roles.removeRolePermissions(4, ["device.read", "driver.read"]), { method: "DELETE", path: "/api/v1/roles/4/permissions", query: { codes: ["device.read", "driver.read"] } }],
  ["admin permissions", (s) => s.roles.listPermissions(), { method: "GET", path: "/api/v1/permissions" }],
  ["create permission", (s) => s.roles.createPermission({ code: "report.export", description: "Export", scope: "TENANT" }), { method: "POST", path: "/api/v1/permissions", body: { code: "report.export", description: "Export", scope: "TENANT" } }],
  ["update permission", (s) => s.roles.updatePermission("report.export", { description: "Export", scope: "PLATFORM" }), { method: "PUT", path: "/api/v1/permissions/report.export", body: { description: "Export", scope: "PLATFORM" } }],
  ["delete permission", (s) => s.roles.deletePermission("report.export"), { method: "DELETE", path: "/api/v1/permissions/report.export" }],
  // device edit: full DeviceRequest, never confirmChargeableChange
  ["update device", (s) => s.fleet.updateDevice(7, { groupId: 2, name: "KA-01", terminalNo: "ABC12345678", modelName: "Synthetic-M1", protocol: 1, objectTypeId: 3, cameraCount: 2, remark: "x" }), { method: "PUT", path: "/api/v1/devices/7", body: { groupId: 2, name: "KA-01", terminalNo: "ABC12345678", modelName: "Synthetic-M1", protocol: 1, objectTypeId: 3, cameraCount: 2, remark: "x" } }],
  // Safe-Fare Admin: the login body carries no tenantCode property at all.
  ["login (Safe-Fare Admin)", (s) => s.auth.login({ login: "admin", password: "p" }), { method: "POST", path: "/api/v1/auth/login", body: { login: "admin", password: "p" }, auth: false }, { signedIn: false }],
  ["refresh", (s) => s.client.refreshSession("test"), { method: "POST", path: "/api/v1/auth/refresh", body: { refreshToken: "r" }, auth: false }],
];

function specOpFor(method, pathname) {
  return contract.matchOperation(OPS, method, pathname.replace(/^\/api\/v1/, "").replace(/\/\d+(?=\/|$)/g, "/{}"));
}

for (const [label, call, want, opts] of CASES) {
  test(`request (V10): ${label} → ${want.method} ${want.path}`, async () => {
    const s = openRealm(opts);
    await call(s);
    assert.equal(s.calls.length, 1, "exactly one request");
    const got = s.calls[0];
    assert.equal(got.method, want.method);
    assert.equal(got.path, want.path);
    const op = specOpFor(got.method, got.path);
    assert.ok(op, `${got.method} ${got.path} is a V10 operation`);
    assert.equal(got.auth, want.auth ?? true, want.auth === false ? "no bearer token" : "bearer token attached");
    same(got.query, want.query ?? {});
    if ("body" in want) same(got.body, want.body);
    else assert.equal(got.body, undefined, "no body");
    // The request actually built uses only V10 names.
    const allowedQuery = new Set(contract.queryParams(op.op).map((p) => p.name));
    for (const k of Object.keys(got.query)) assert.ok(allowedQuery.has(k), `?${k} is a V10 parameter of ${op.key}`);
    for (const p of contract.queryParams(op.op)) if (p.required) assert.ok(p.name in got.query, `required ?${p.name} sent`);
    const bs = contract.bodySchema(SPEC, op.op);
    if (got.body !== undefined) {
      assert.ok(bs, `${op.key} takes a body`);
      const props = contract.deref(SPEC, bs).schema;
      for (const k of Object.keys(got.body)) assert.ok(Object.hasOwn(props.properties, k), `body.${k} is in the V10 schema`);
      for (const k of props.required || []) assert.ok(k in got.body, `required body.${k} sent`);
    } else if (op.op.requestBody?.required) assert.fail(`${op.key} requires a body`);
    assert.ok(!("X-Tenant-Id" in (got.headers || {})), "no tenant selector is sent today (Phase 5)");
  });
}

// ── 5. Coverage ──────────────────────────────────────────────────────────────

test("every operation the frontend calls has a runtime request case (here or in operations-api.test.cjs)", () => {
  const norm = (m, p) => specOpFor(m, p)?.key ?? `${m} ${p}`;
  const covered = new Set(CASES.map(([, , w]) => norm(w.method, w.path)));
  const other = fs.readFileSync(path.join(__dirname, "operations-api.test.cjs"), "utf8");
  for (const m of other.matchAll(/method: "(GET|POST|PUT|PATCH|DELETE)", path: "(\/api\/v1\/[^"]+)"/g)) covered.add(norm(m[1], m[2]));
  const called = [...new Set(RESULT.sites.filter((s) => s.operation).map((s) => s.operation))];
  same(called.filter((k) => !covered.has(k)).sort(), []);
});
