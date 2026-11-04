// Phase 8 — Driver Management and driver–device assignments. MOCKED / SYNTHETIC ONLY: drivers, devices,
// assignments and identities are synthetic (permission codes are real V10 codes); requests go to a stub fetch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const contract = require("./helpers/v10-contract.cjs");
const { SPEC, ALL_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const pure = createRealm({ process: { env: {} } });
const m = pure.require("components/drive-vision/drivers/drivers-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });
const iso = (s) => new Date(s).toISOString();
const future = (h) => {
  // IST datetime-local string h hours from now.
  const d = new Date(Date.now() + h * 3_600_000 + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 16);
};

// ── Assignment form, review and end ─────────────────────────────────────────

test("P8 assign form: deviceId required; from/to valid; to after from (or in the future without from); body follows AssignRequest", () => {
  assert.ok(m.validateAssignForm({ ...m.EMPTY_ASSIGN_FORM }).deviceId, "vehicle required");
  same(m.validateAssignForm({ deviceId: "7", from: "", to: "", replaceCurrent: false }), {});
  assert.ok(m.validateAssignForm({ deviceId: "7", from: "2026-11-02T10:00", to: "2026-11-02T09:00", replaceCurrent: false }).to, "end before start");
  assert.ok(m.validateAssignForm({ deviceId: "7", from: "", to: "2020-01-01T00:00", replaceCurrent: false }).to, "end in the past without a start");
  assert.ok(m.validateAssignForm({ deviceId: "7", from: "nope", to: "", replaceCurrent: false }).from);
  same(m.validateAssignForm({ deviceId: "7", from: "", to: future(2), replaceCurrent: false }), {});
  same(m.assignRequestBody({ deviceId: "7", from: "2026-11-02T10:00", to: "2026-11-02T18:30", replaceCurrent: true }), {
    deviceId: 7,
    replaceCurrent: true,
    from: "2026-11-02T04:30:00.000Z",
    to: "2026-11-02T13:00:00.000Z",
  });
  same(m.assignRequestBody({ deviceId: "7", from: "", to: "", replaceCurrent: false }), { deviceId: 7, replaceCurrent: false }, "blank times aren't sent");
});

test("P8 review: lists the driver's and the vehicle's active assignments; replacement needs acknowledgement; no rule is invented", () => {
  const driverActive = [{ id: 1, driverId: 5, deviceId: 101, deviceName: "KA-01", active: true }];
  const deviceActive = [{ id: 2, driverId: 9, driverName: "Other", deviceId: 202, active: true }];
  let r = m.reviewAssignment(driverActive, deviceActive, { deviceId: "202", from: "", to: "", replaceCurrent: false }, 5);
  same(r.conflicts.map((a) => a.id), [1, 2]);
  assert.equal(r.likelyRefused, true);
  assert.equal(r.replaces, false);
  r = m.reviewAssignment(driverActive, deviceActive, { deviceId: "202", from: "", to: "", replaceCurrent: true }, 5);
  assert.equal(r.replaces, true, "replacing an active assignment must be acknowledged");
  r = m.reviewAssignment([], [], { deviceId: "303", from: "", to: "", replaceCurrent: true }, 5);
  same({ ...r, conflicts: r.conflicts.length }, { conflicts: 0, replaces: false, likelyRefused: false });
  // The same assignment reported by both lists is counted once (duplicate assignment of the same pair).
  r = m.reviewAssignment([{ id: 3, driverId: 5, deviceId: 101, active: true }], [{ id: 3, driverId: 5, deviceId: 101, active: true }], { deviceId: "101", from: "", to: "", replaceCurrent: false }, 5);
  same(r.conflicts.map((a) => a.id), [3]);
  // Only the server's `active` flag counts — never inferred from dates.
  same(m.activeAssignments([{ id: 1, active: true }, { id: 2, active: false }, { id: 3, assignedTo: undefined }]).map((a) => a.id), [1]);
});

test("P8 end assignment: optional `at` (EndAssignmentRequest) must be after the start; blank ends it now", () => {
  const a = { id: 1, assignedFrom: iso("2026-11-02T04:30:00Z") };
  assert.equal(m.validateEndAt("", a), null);
  assert.ok(m.validateEndAt("2026-11-02T09:00", a), "09:00 IST = 03:30Z, before the start");
  assert.equal(m.validateEndAt("2026-11-02T12:00", a), null);
  assert.ok(m.validateEndAt("bad", a));
  same(m.endRequestBody(""), {});
  same(m.endRequestBody("2026-11-02T12:00"), { at: "2026-11-02T06:30:00.000Z" });
});

// ── Historical alarm → driver attribution ───────────────────────────────────

const HISTORY = [
  { id: 1, deviceId: 101, driverId: 1, driverName: "Driver A", assignedFrom: iso("2026-11-02T08:00:00Z"), assignedTo: iso("2026-11-02T12:00:00Z"), active: false },
  { id: 2, deviceId: 101, driverId: 2, driverName: "Driver B", assignedFrom: iso("2026-11-02T12:00:00Z"), active: true },
  { id: 3, deviceId: 202, driverId: 3, driverName: "Driver C", assignedFrom: iso("2026-11-01T00:00:00Z"), active: true },
];

test("P8 attribution rule: an alarm belongs to the assignment valid at its timestamp (the brief's example)", () => {
  assert.equal(m.assignmentAt(HISTORY, 101, "2026-11-02T10:30:00Z").driverName, "Driver A", "10:30 → A, not the current driver B");
  assert.equal(m.assignmentAt(HISTORY, 101, "2026-11-02T13:00:00Z").driverName, "Driver B");
  assert.equal(m.assignmentAt(HISTORY, 101, "2026-11-02T12:00:00Z").driverName, "Driver B", "[from, to): the boundary belongs to the next assignment");
});

test("P8 attribution rule: before an assignment / after it ended / other device → not that driver", () => {
  assert.equal(m.assignmentAt(HISTORY, 101, "2026-11-02T07:59:59Z"), null, "before any assignment");
  assert.equal(m.assignmentAt([HISTORY[0]], 101, "2026-11-02T12:30:00Z"), null, "after A ended (and no B in the data)");
  assert.equal(m.assignmentAt(HISTORY, 202, "2026-11-02T10:30:00Z").driverName, "Driver C");
  assert.equal(m.assignmentAt(HISTORY, 999, "2026-11-02T10:30:00Z"), null);
});

test("P8 attribution rule: a later assignment never changes a past attribution; ambiguity yields no driver", () => {
  const before = m.assignmentAt(HISTORY, 101, "2026-11-02T10:30:00Z").driverId;
  const later = [...HISTORY, { id: 9, deviceId: 101, driverId: 7, assignedFrom: iso("2026-11-03T00:00:00Z"), active: true }];
  assert.equal(m.assignmentAt(later, 101, "2026-11-02T10:30:00Z").driverId, before);
  const overlapping = [...HISTORY, { id: 10, deviceId: 101, driverId: 8, assignedFrom: iso("2026-11-02T10:00:00Z"), assignedTo: iso("2026-11-02T11:00:00Z") }];
  assert.equal(m.assignmentAt(overlapping, 101, "2026-11-02T10:30:00Z"), null, "two matches → no driver rather than a guess");
  assert.equal(m.assignmentAt([{ deviceId: 101, driverId: 1 }], 101, "2026-11-02T10:30:00Z"), null, "no start → no driver");
  assert.equal(m.assignmentAt(HISTORY, 101, "not a date"), null);
});

test("P8 no fabrication: the UI never derives an alarm's driver — only the server's AlertRow fields are shown", () => {
  const components = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && components.push(path.join(d, e.name))));
  walk(path.join(SRC, "components"));
  for (const f of components) {
    const src = fs.readFileSync(f, "utf8");
    if (!f.endsWith("drivers-model.ts")) assert.doesNotMatch(src, /assignmentAt\(/, `${path.relative(SRC, f)} uses the attribution rule to label alarms`);
  }
  const incidents = read("components/drive-vision/alerts/incidents.tsx");
  assert.match(incidents, /Driver \(server\)/);
  assert.doesNotMatch(incidents, /currentAssignment|currentDriver|deviceAssignments/, "alerts never use a vehicle's current driver");
  // The legacy sample ActivityFeed (which matched alarms to drivers) is not mounted anywhere.
  for (const f of components) if (!f.endsWith("activity-feed.tsx")) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /from "\.\/activity-feed"|<ActivityFeed\b/, path.relative(SRC, f));
  assert.match(read("components/drive-vision/drivers/drivers-page.tsx"), /attributed to this driver by the server/);
});

// ── Authorization ───────────────────────────────────────────────────────────

const SFA = { userId: 1, platform: true, homeTenantId: null, tenantId: null, roleId: 1, roleCode: "ADMIN", permissions: ALL_CODES.filter((c) => c !== "driver.app"), screens: [] };
const OPERATOR = { userId: 6, platform: false, homeTenantId: 10, tenantId: 10, roleId: 8, roleCode: "TEST_OPERATOR", permissions: ["device.read", "track.read", "alarm.read"], screens: [] };
const DRIVER_ACTIONS = ["drivers.create", "drivers.update", "drivers.delete"];

test("P8 authorization: screen and each action follow V10 codes per identity (no role-name shortcuts)", () => {
  const cases = {
    "Safe-Fare Admin, tenant selected": [access(SFA, 10), true, [true, true, true]],
    "Safe-Fare Admin, all tenants (writes need a tenant)": [access(SFA), true, [false, false, false]],
    "tenant ADMIN": [access(IDENTITIES.tenantAdmin), true, [true, true, true]],
    "Fleet Owner (synthetic codes)": [access(IDENTITIES.fleetOwner), true, [true, true, false]],
    "Operator (synthetic, no driver.read)": [access(OPERATOR), false, [false, false, false]],
    "Dispatcher (synthetic)": [access(IDENTITIES.dispatcher), true, [false, false, false]],
    "Viewer (synthetic)": [access(IDENTITIES.viewer), true, [false, false, false]],
    Driver: [access(IDENTITIES.driver), false, [false, false, false]],
  };
  for (const [label, [a, screen, actions]] of Object.entries(cases)) {
    assert.equal(p.canAccessScreen(a, "drivers"), screen, `${label}: screen`);
    assert.equal(p.decideRoute("authenticated", a, "/drive-vision/drivers").kind, screen ? "allow" : "forbidden", `${label}: route`);
    DRIVER_ACTIONS.forEach((act, i) => assert.equal(p.canPerform(a, act), actions[i], `${label}: ${act}`));
  }
  assert.equal(p.actionBlock(access(SFA), "drivers.update"), "tenant", "all-tenants mode: blocked by tenant, not permission");
  assert.equal(p.decideRoute("unauthenticated", access(null), "/drive-vision/drivers").kind, "login");
});

test("P8 authorization: secondary reads have their own codes, so they aren't requested without them", () => {
  const dispatcher = access(IDENTITIES.dispatcher); // device.read, driver.read, no alarm.read
  assert.equal(p.canViewWidget(dispatcher, "drivers.safety"), false, "no alarm.read → no safety score / events request");
  assert.equal(p.canViewWidget(dispatcher, "drivers.deviceChoices"), true);
  assert.equal(p.canViewWidget(dispatcher, "vehicles.driverAssignments"), true);
  const operator = access(OPERATOR); // device.read, no driver.read
  assert.equal(p.canViewWidget(operator, "vehicles.driverAssignments"), false, "vehicle detail skips GET /devices/{id}/driver-assignments");
  assert.equal(p.canViewWidget(access(IDENTITIES.viewer), "drivers.safety"), true);
  // The page wires the gates into its queries (no request when not allowed).
  const page = read("components/drive-vision/drivers/drivers-page.tsx");
  assert.match(page, /const scoreQ = useApiQuery\(id !== null && safetyAllowed \?/, "safety score gated");
  assert.match(page, /const eventsQ = useApiQuery\(id !== null && safetyAllowed \?/, "safety events gated");
  assert.match(page, /pending\?\.kind === "assign" && can\.devices \?/);
  assert.match(page, /chosenDevice !== null && can\.deviceAssignments \?/);
  assert.match(read("components/drive-vision/vehicles/vehicle-operations.tsx"), /useApiQuery\(canAssignments \?/);
});

test("P8 contract: the new widgets mirror V10's 'Required permission'", () => {
  const ops = new Map(contract.specOperations(SPEC).map((o) => [o.key, o.op]));
  for (const w of ["drivers.safety", "drivers.deviceChoices", "vehicles.driverAssignments"]) {
    for (const key of p.WIDGETS[w].operations) same([...p.WIDGETS[w].anyOf].sort(), [...contract.permissionCodes(contract.permissionOf(ops.get(key)))].sort());
  }
});

test("P8 contract: 'Tenant columns' are allowed only on list rows of operations that document them", () => {
  const op = (m2, p2) => SPEC.paths[p2][m2];
  same([...contract.documentedResponseFields(op("get", "/api/v1/drivers"))], ["data[].tenantId", "data[].tenantName"]);
  assert.ok(contract.documentedResponseFields(op("get", "/api/v1/drivers/licence-expiries")));
  for (const [mm, pp] of [["get", "/api/v1/drivers/{id}"], ["post", "/api/v1/drivers"], ["get", "/api/v1/driver/me"], ["get", "/api/v1/drivers/{id}/assignments"]]) assert.equal(contract.documentedResponseFields(op(mm, pp)), null, `${mm} ${pp}`);
  // DriverDto itself stays exactly the schema; the tenant columns live on DriverRow (list results only).
  const types = read("features/drive-vision/api/types-operations.ts");
  const dto = types.slice(types.indexOf("export interface DriverDto {"), types.indexOf("}", types.indexOf("export interface DriverDto {")));
  assert.doesNotMatch(dto, /tenantId|tenantName/);
  assert.match(types, /export type DriverRow = DriverDto & TenantColumns;/);
});

// ── Service: exact requests, tenant header, errors (stub fetch) ─────────────

function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 600_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = respond(u.pathname.replace("/api/v1", ""), init.method ?? "GET");
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined } });
  const r = (x) => realm.require(x);
  return { calls, ops: r("features/drive-vision/api/operations-service").operationsService, ctx: r("features/drive-vision/api/tenant-context"), errors: r("features/drive-vision/api/errors") };
}
const ok = (data, total) => [200, { code: 200, msg: "Success", data, total }];
const header = (c) => Object.entries(c.headers).find(([k]) => k.toLowerCase() === "x-tenant-id")?.[1];

test("P8 service: list / detail / assignments use the exact V10 paths, queries and bodies", async () => {
  const s = openRealm(() => ok([], 0));
  await s.ops.listDrivers({ keyword: "ann", status: "ACTIVE", pageNumber: 2, pageSize: 20 });
  await s.ops.getDriver(5);
  await s.ops.driverAssignments(5);
  await s.ops.deviceAssignments(101);
  await s.ops.assignVehicle(5, { deviceId: 101, from: "2026-11-02T04:30:00.000Z", to: "2026-11-02T13:00:00.000Z", replaceCurrent: true });
  await s.ops.endAssignment(5, 1, { at: "2026-11-02T06:30:00.000Z" });
  await s.ops.endAssignment(5, 1, {});
  same(s.calls.map((c) => `${c.method} ${c.path}`), ["GET /drivers", "GET /drivers/5", "GET /drivers/5/assignments", "GET /devices/101/driver-assignments", "POST /drivers/5/assignments", "POST /drivers/5/assignments/1/end", "POST /drivers/5/assignments/1/end"]);
  same(s.calls[0].query, { keyword: "ann", status: "ACTIVE", pageNumber: "2", pageSize: "20" });
  same(s.calls[4].body, { deviceId: 101, from: "2026-11-02T04:30:00.000Z", to: "2026-11-02T13:00:00.000Z", replaceCurrent: true });
  same(s.calls[5].body, { at: "2026-11-02T06:30:00.000Z" });
  same(s.calls[6].body, {});
});

test("P8 tenant isolation: tenant header only with a selected tenant; never ?tenantId; all-tenants list rows keep their tenant columns", async () => {
  const s = openRealm(() => ok([{ id: 1, name: "Synthetic", tenantId: 10, tenantName: "Acme" }], 1));
  const rows = await s.ops.listDrivers({ pageNumber: 1, pageSize: 20 });
  assert.equal(header(s.calls[0]), undefined, "all-tenants mode: no header");
  same({ ...rows.items[0] }, { id: 1, name: "Synthetic", tenantId: 10, tenantName: "Acme" });
  s.ctx.setTenantSelection({ tenantId: 10, code: null, name: null, header: "X-Tenant-Id" });
  await s.ops.listDrivers({ pageNumber: 1, pageSize: 20 });
  await s.ops.assignVehicle(1, { deviceId: 101, replaceCurrent: false });
  for (const c of s.calls.slice(1)) assert.equal(header(c), "10", `${c.method} ${c.path}`);
  for (const c of s.calls) assert.ok(!("tenantId" in c.query));
});

test("P8 errors: a refused assignment (409) surfaces the server msg; nothing reports success", async () => {
  const s = openRealm((pth, meth) => (meth === "POST" ? [409, { code: 409, msg: "Vehicle already assigned (synthetic)", data: null, extend: { errorCode: "OPERATION_NOT_ALLOWED" } }] : ok([], 0)));
  await assert.rejects(s.ops.assignVehicle(5, { deviceId: 101, replaceCurrent: false }), (err) => err.status === 409 && s.errors.describeApiError(err) === "Vehicle already assigned (synthetic)");
  await assert.rejects(s.ops.endAssignment(5, 1, {}), (err) => err.status === 409);
  const page = read("components/drive-vision/drivers/drivers-page.tsx");
  // Success toasts follow the awaited server call; failures rethrow so the dialog stays open.
  assert.match(page, /const a = await operationsService\.assignVehicle\([\s\S]*?toast\.success/);
  assert.match(page, /toast\.error\("The server rejected the change"[\s\S]*?throw err;/);
});
