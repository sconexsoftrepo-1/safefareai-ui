// Device edit (PUT /api/v1/devices/{id}). MOCKED / SYNTHETIC ONLY: devices, models and identities are synthetic
// (permission codes are real V10 codes); requests go to a stub fetch. Nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const contract = require("./helpers/v10-contract.cjs");
const { SPEC, ALL_CODES, TENANT_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const pure = createRealm({ process: { env: {} } });
const m = pure.require("components/drive-vision/vehicles/device-edit-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const errorsMod = pure.require("features/drive-vision/api/errors");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });

/** SYNTHETIC stored device (GET /devices/{id}) and model catalogue. */
const DEVICE = {
  id: 7,
  vendorVehicleId: 900,
  groupId: 2,
  name: "KA-01-1001",
  terminalNo: "ABC12345678",
  modelId: 11,
  protocolCode: 1,
  objectTypeId: 3,
  plateColor: "yellow",
  simNumber: "8991000000000000001",
  cameraCount: 2,
  frameNo: "VIN0001",
  remark: "Synthetic",
  activatedAt: "2025-01-01T00:00:00Z",
  expiresAt: "2027-01-01T00:00:00Z",
  insuranceDueAt: "2026-12-31T18:30:00Z", // = 2027-01-01 00:00 IST
  maintenanceDueAt: "2026-06-15T10:20:30Z",
  driver: { name: "Synthetic Driver", card: "C-1", phone: "+91 90000 00001", gender: 1, drivingLicense: "DL-1", remark: "r" },
};
const MODELS = [{ id: 10, name: "Synthetic-M0" }, { id: 11, name: "Synthetic-M1", protocols: [{ code: 1 }] }];

// ── Baseline: resend exactly what's stored ──────────────────────────────────

test("DE baseline: the full DeviceRequest is rebuilt from the stored device; modelName from the catalogue by modelId", () => {
  const b = m.baselineRequest(DEVICE, MODELS);
  same(b.problems, []);
  same(b.body, {
    groupId: 2, name: "KA-01-1001", terminalNo: "ABC12345678", modelName: "Synthetic-M1", protocol: 1, objectTypeId: 3, cameraCount: 2,
    plateColor: "yellow", simNumber: "8991000000000000001", remark: "Synthetic", frameNo: "VIN0001",
    insuranceDueAt: "2026-12-31T18:30:00Z", maintenanceDueAt: "2026-06-15T10:20:30Z",
    driverName: "Synthetic Driver", driverCard: "C-1", driverPhone: "+91 90000 00001", drivingLicense: "DL-1", driverRemark: "r", driverGender: 1,
  });
  assert.equal("confirmChargeableChange" in b.body, false, "never sent");
});

test("DE baseline: editing is blocked (no guess) when the model can't be resolved or a required value is missing", () => {
  const cases = [
    [MODELS, { ...DEVICE, modelId: 99 }, /isn't \(uniquely\) in the device-model catalogue/],
    [undefined, DEVICE, /catalogue couldn't be loaded/],
    [[...MODELS, { id: 11, name: "Duplicate" }], DEVICE, /uniquely/],
    [[{ id: 11, name: "  " }], DEVICE, /uniquely/],
    [MODELS, { ...DEVICE, modelId: undefined }, /no model id/],
    [MODELS, { ...DEVICE, groupId: undefined }, /no group/],
    [MODELS, { ...DEVICE, terminalNo: "" }, /no terminal number/],
    [MODELS, { ...DEVICE, protocolCode: undefined }, /no protocol/],
    [MODELS, { ...DEVICE, objectTypeId: undefined }, /no object type/],
    [MODELS, { ...DEVICE, cameraCount: undefined }, /no camera count/],
  ];
  for (const [models, dev, re] of cases) {
    const b = m.baselineRequest(dev, models);
    assert.equal(b.body, null, String(re));
    assert.match(b.problems.join(" "), re);
  }
});

// ── Form ────────────────────────────────────────────────────────────────────

test("DE form: stored values load into the form; dates shown as IST calendar dates", () => {
  same({ ...m.formFromDevice(DEVICE) }, {
    name: "KA-01-1001", plateColor: "yellow", simNumber: "8991000000000000001", frameNo: "VIN0001", remark: "Synthetic",
    insuranceDueAt: "2027-01-01", maintenanceDueAt: "2026-06-15",
    driverName: "Synthetic Driver", driverCard: "C-1", driverPhone: "+91 90000 00001", drivingLicense: "DL-1", driverRemark: "r",
  });
  same({ ...m.formFromDevice({ id: 1 }) }.insuranceDueAt, "");
});

test("DE update: safe fields change; locked fields and unchanged dates are resent exactly; cleared fields omitted", () => {
  const base = m.baselineRequest(DEVICE, MODELS).body;
  const original = m.formFromDevice(DEVICE);
  const body = m.buildUpdate(base, original, { ...original, name: " KA-01-NEW ", remark: "", driverPhone: "+91 90000 00009", maintenanceDueAt: "2026-07-01" });
  assert.equal(body.name, "KA-01-NEW");
  assert.equal("remark" in body, false, "cleared optional field omitted");
  assert.equal(body.driverPhone, "+91 90000 00009");
  assert.equal(body.maintenanceDueAt, "2026-06-30T18:30:00.000Z", "new date = 00:00 IST");
  assert.equal(body.insuranceDueAt, "2026-12-31T18:30:00Z", "unchanged date resent byte-for-byte");
  for (const k of ["modelName", "protocol", "cameraCount", "terminalNo", "groupId", "objectTypeId", "driverGender"]) assert.equal(body[k], base[k], k);
  assert.equal("confirmChargeableChange" in body, false);
  same(m.lockedViolations(base, body), []);
  same([...m.changedFields(base, body)].sort(), ["driverPhone", "maintenanceDueAt", "name", "remark"]);
  same([...m.changedFields(base, m.buildUpdate(base, original, original))], [], "no edits → nothing to save");
});

test("DE charge protection: any change to a locked field (or adding confirmChargeableChange) is caught before sending", () => {
  const base = m.baselineRequest(DEVICE, MODELS).body;
  for (const [k, v] of [["modelName", "Synthetic-M0"], ["protocol", 2], ["cameraCount", 4], ["terminalNo", "XYZ12345678"], ["groupId", 3], ["objectTypeId", 4], ["driverGender", 0]]) {
    same([...m.lockedViolations(base, { ...base, [k]: v })], [k], k);
  }
  assert.ok(m.lockedViolations(base, { ...base, confirmChargeableChange: true }).length > 0, "confirmChargeableChange is never allowed");
  assert.ok(m.lockedViolations(base, { ...base, confirmChargeableChange: false }).length > 0);
  // Only descriptive fields are offered for editing.
  same([...m.EDITABLE_FIELDS].sort(), ["driverCard", "driverName", "driverPhone", "driverRemark", "drivingLicense", "frameNo", "insuranceDueAt", "maintenanceDueAt", "name", "plateColor", "remark", "simNumber"]);
  assert.match(m.LOCKED_FIELDS.modelName, /may deduct vendor coins/);
});

test("DE validation: name required; V10 max lengths; valid dates", () => {
  const ok = m.formFromDevice(DEVICE);
  same({ ...m.validateEdit(ok) }, {});
  assert.ok(m.validateEdit({ ...ok, name: "  " }).name);
  assert.ok(m.validateEdit({ ...ok, name: "x".repeat(101) }).name);
  assert.ok(m.validateEdit({ ...ok, plateColor: "x".repeat(31) }).plateColor);
  assert.ok(m.validateEdit({ ...ok, simNumber: "1".repeat(31) }).simNumber);
  assert.ok(m.validateEdit({ ...ok, remark: "x".repeat(501) }).remark);
  assert.ok(m.validateEdit({ ...ok, driverName: "x".repeat(151) }).driverName);
  assert.ok(m.validateEdit({ ...ok, insuranceDueAt: "2026-02-30" }).insuranceDueAt);
  same(m.dateInputToIso("2026-02-30"), null);
});

test("DE errors: backend field errors map to fields; chargeable refusals are never retried; unknown vendor outcome → re-read", () => {
  const E = (status, errorCode, msg, fieldErrors) => new errorsMod.ApiError({ kind: "http", status, errorCode, message: msg, fieldErrors, method: "PUT", path: "/devices/7" });
  let o = m.describeSaveError(E(400, "VALIDATION_FAILED", "Request validation failed", [{ field: "name", message: "too long (synthetic)" }]));
  same({ ...o.fieldErrors }, { name: "too long (synthetic)" });
  assert.equal(o.refetch, false);
  for (const code of ["CHARGEABLE_CHANGE", "CONFIRMATION_REQUIRED"]) {
    o = m.describeSaveError(E(409, code, "Synthetic charge"));
    assert.match(o.message, /chargeable change and refused it/);
    assert.match(o.message, /Nothing was confirmed or charged by the app/);
    assert.equal(o.refetch, true);
  }
  o = m.describeSaveError(E(504, "VENDOR_OUTCOME_UNKNOWN", ""));
  assert.match(o.message, /check whether the change was applied before trying again/);
  assert.equal(o.refetch, true);
  assert.equal(m.describeSaveError(E(400, "TENANT_REQUIRED", "x")).message, "Select a tenant first.");
  assert.equal(m.describeSaveError(E(404, "NOT_FOUND", "")).refetch, true);
  assert.equal(m.describeSaveError(E(502, "VENDOR_AUTH_FAILED", "Vendor down")).refetch, true);
});

// ── Authorization and tenant ────────────────────────────────────────────────

test("DE authorization: device.update + (Safe-Fare Admin) a selected tenant; no role names", () => {
  const SFA = { userId: 1, platform: true, homeTenantId: null, tenantId: null, roleId: 1, roleCode: "ADMIN", permissions: ALL_CODES, screens: [] };
  assert.equal(p.canPerform(access(SFA, 10), "devices.update"), true);
  assert.equal(p.actionBlock(access(SFA), "devices.update"), "tenant", "all-tenants mode: select a tenant first");
  assert.equal(p.canPerform(access(IDENTITIES.tenantAdmin), "devices.update"), true);
  for (const raw of [IDENTITIES.viewer, IDENTITIES.dispatcher, IDENTITIES.fleetOwner, IDENTITIES.driver, { ...IDENTITIES.tenantAdmin, permissions: TENANT_CODES.filter((c) => c !== "device.update") }]) {
    assert.equal(p.canPerform(access(raw), "devices.update"), false, raw.roleCode);
  }
  const op = contract.specOperations(SPEC).find((o) => o.key === "PUT /api/v1/devices/{id}").op;
  same([...p.ACTIONS["devices.update"].requires.anyOf], contract.permissionCodes(contract.permissionOf(op)));
  assert.equal(p.ACTIONS["devices.update"].tenantClass, "EXISTING_RECORD_UPDATE");
});

function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 600_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, b] = respond();
    return new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined } });
  const r = (x) => realm.require(x);
  return { calls, fleet: r("features/drive-vision/api/fleet-service").fleetService, ctx: r("features/drive-vision/api/tenant-context"), m: r("components/drive-vision/vehicles/device-edit-model") };
}
const header = (c) => Object.entries(c.headers).find(([k]) => k.toLowerCase() === "x-tenant-id")?.[1];

test("DE service: PUT /devices/{id} with the exact body; tenant header only with a selection; never ?tenantId; failures reject", async () => {
  const s = openRealm(() => [200, { code: 200, msg: "Success", data: DEVICE }]);
  const base = s.m.baselineRequest(DEVICE, MODELS).body;
  const body = s.m.buildUpdate(base, s.m.formFromDevice(DEVICE), { ...s.m.formFromDevice(DEVICE), remark: "Edited" });
  await s.fleet.updateDevice(7, body);
  s.ctx.setTenantSelection({ tenantId: 10, code: null, name: null, header: "X-Tenant-Id" });
  await s.fleet.updateDevice(7, body);
  same(s.calls.map((c) => `${c.method} ${c.path}`), ["PUT /devices/7", "PUT /devices/7"]);
  same(s.calls[0].body, body);
  assert.equal(header(s.calls[0]), undefined);
  assert.equal(header(s.calls[1]), "10");
  for (const c of s.calls) {
    assert.ok(!("tenantId" in c.query));
    assert.equal("confirmChargeableChange" in c.body, false);
  }
  const f = openRealm(() => [409, { code: 409, msg: "Synthetic", data: null, extend: { errorCode: "CONFIRMATION_REQUIRED" } }]);
  await assert.rejects(f.fleet.updateDevice(7, body), (err) => err.status === 409 && err.errorCode === "CONFIRMATION_REQUIRED");
  assert.equal(f.calls.length, 1, "no automatic retry");
});

// ── UI wiring and scope ─────────────────────────────────────────────────────

test("DE UI: Edit follows the resolver; success refreshes; failures never show success; Add / Delete / Transfer stay disabled", () => {
  const detail = read("components/drive-vision/vehicles/vehicle-detail.tsx");
  assert.match(detail, /useActionGate\("devices\.update"\)/);
  assert.match(detail, /editGate\.allowed \?[\s\S]*?editGate\.tenantBlocked \?/);
  assert.match(detail, /onSaved=\{\(\) => \{\s*setEditing\(false\);\s*deviceQ\.refetch\(\);/);
  assert.match(detail, /<Trash2 \/> Delete/);
  assert.match(detail, /disabled title=\{WRITES_PENDING\}>\s*<ArrowLeftRight \/> Transfer/);
  assert.match(detail, /disabled title=\{WRITES_PENDING\}>\s*<Trash2 \/> Delete/);
  const panel = read("components/drive-vision/vehicles/device-edit-panel.tsx");
  assert.match(panel, /await fleetService\.updateDevice\(device\.id!, body\);\s*toast\.success/, "success only after the awaited PUT");
  assert.match(panel, /if \(saving \|\| !baseline\.body \|\| !body\) return;/, "duplicate submissions blocked");
  assert.match(panel, /if \(violations\.length\)/);
  assert.doesNotMatch(panel, /confirmChargeableChange/);
  // Add vehicle not implemented: no POST /devices anywhere; the placeholder and disabled button remain.
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(SRC);
  for (const f2 of files) assert.doesNotMatch(fs.readFileSync(f2, "utf8"), /api\.post<[^>]*>\(\s*"\/devices"|\/devices\/transfer"|api\.delete<[^>]*>\(\s*`\/devices\//, path.relative(SRC, f2));
  assert.match(read("components/drive-vision/vehicles/vehicles-page.tsx"), /<Button disabled title=\{WRITES_PENDING\}>\s*<Plus \/> Add vehicle/);
  assert.match(read("components/drive-vision/vehicles/new-vehicle.tsx"), /Adding devices isn't enabled yet/);
});
