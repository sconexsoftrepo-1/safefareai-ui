// Vehicle registry (/api/v1/vehicles). The contract was supplied by the backend team on 2026-11-03
// (docs/contracts/vehicle-api.txt) and is NOT in api-docs-v10.json. MOCKED / SYNTHETIC ONLY: vehicles,
// identities and responses are synthetic, and requests go to a stub fetch. Nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { SPEC, IDENTITIES, VEHICLE_CODES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const pure = createRealm({ process: { env: {} } }, { react: { useSyncExternalStore: () => null } });
const m = pure.require("components/drive-vision/vehicle-registry/vehicle-registry-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });

const NOW = new Date("2026-11-03T08:00:00Z");
/** SYNTHETIC vehicle in the contract's shape. */
const VEHICLE = {
  id: 12,
  vehicleNumber: "TS09AB1234",
  vehicleType: "BUS",
  make: "Synthetic Make",
  model: "Synthetic Model",
  yearOfManufacture: 2022,
  chassisNumber: "CH123X",
  engineNumber: "EN98765",
  color: "White",
  status: "ACTIVE",
  remarks: "Route 4",
  deviceAssigned: true,
  device: { id: 345, name: "Bus 4", terminalNo: "13265326521" },
  createdAt: "2026-11-03T08:15:30.123Z",
  updatedAt: "2026-11-03T08:15:30.123Z",
};

// ── Form, validation and request body ───────────────────────────────────────

test("VR validation: number required (1–20); max lengths; year 1900..next year", () => {
  const ok = { ...m.EMPTY_VEHICLE_FORM, vehicleNumber: "TS09AB1234" };
  same(m.validateVehicleForm(ok, NOW), {});
  assert.ok(m.validateVehicleForm({ ...ok, vehicleNumber: "   " }, NOW).vehicleNumber);
  assert.ok(m.validateVehicleForm({ ...ok, vehicleNumber: "X".repeat(21) }, NOW).vehicleNumber);
  assert.equal(m.validateVehicleForm({ ...ok, vehicleNumber: "X".repeat(20) }, NOW).vehicleNumber, undefined);
  for (const [f, max] of Object.entries({ vehicleType: 50, make: 100, model: 100, chassisNumber: 60, engineNumber: 60, color: 30, remarks: 500 })) {
    assert.ok(m.validateVehicleForm({ ...ok, [f]: "a".repeat(max + 1) }, NOW)[f], f);
    assert.equal(m.validateVehicleForm({ ...ok, [f]: "a".repeat(max) }, NOW)[f], undefined, f);
  }
  assert.equal(m.maxYear(NOW), 2027);
  for (const y of ["1900", "2022", "2027", ""]) assert.equal(m.validateVehicleForm({ ...ok, yearOfManufacture: y }, NOW).yearOfManufacture, undefined, y);
  for (const y of ["1899", "2028", "2101", "22", "20x2", "2022.5"]) assert.ok(m.validateVehicleForm({ ...ok, yearOfManufacture: y }, NOW).yearOfManufacture, y);
});

test("VR request: trimmed; number, chassis and engine upper-cased; blanks omitted (PUT clears them); status always sent", () => {
  const body = m.vehicleRequestBody({ ...m.EMPTY_VEHICLE_FORM, vehicleNumber: " ts09ab1234 ", chassisNumber: "mat123x", engineNumber: " eng1 ", make: " Ashok ", yearOfManufacture: " 2022 ", status: "INACTIVE" });
  same(body, { vehicleNumber: "TS09AB1234", status: "INACTIVE", make: "Ashok", chassisNumber: "MAT123X", engineNumber: "ENG1", yearOfManufacture: 2022 });
  same(m.vehicleRequestBody({ ...m.EMPTY_VEHICLE_FORM, vehicleNumber: "A1" }), { vehicleNumber: "A1", status: "ACTIVE" });
});

test("VR edit round-trip: the form starts from the stored record, so an unchanged save resends every field", () => {
  const form = m.vehicleFormFrom(VEHICLE);
  same(m.vehicleRequestBody(form), {
    vehicleNumber: "TS09AB1234",
    status: "ACTIVE",
    vehicleType: "BUS",
    make: "Synthetic Make",
    model: "Synthetic Model",
    chassisNumber: "CH123X",
    engineNumber: "EN98765",
    color: "White",
    remarks: "Route 4",
    yearOfManufacture: 2022,
  });
  // Nulls from the server become blank fields (not the string "null").
  same(m.vehicleFormFrom({ vehicleNumber: "B2", make: null, yearOfManufacture: null, status: "INACTIVE" }), { ...m.EMPTY_VEHICLE_FORM, vehicleNumber: "B2", status: "INACTIVE" });
});

test("VR display helpers: device label and make/model/year summary", () => {
  assert.equal(m.deviceLabel(VEHICLE), "Bus 4");
  assert.equal(m.deviceLabel({ device: { id: 1, name: null, terminalNo: "999" } }), "999");
  assert.equal(m.deviceLabel({ device: null }), null);
  assert.equal(m.vehicleSummary(VEHICLE), "Synthetic Make Synthetic Model · 2022");
  assert.equal(m.vehicleSummary({ vehicleNumber: "X" }), null);
});

// ── Access ──────────────────────────────────────────────────────────────────

test("VR access: screen on vehicle.read; create / update / delete are separate codes; Safe-Fare Admin needs a tenant to write", () => {
  const only = (codes) => access({ platform: false, roleCode: "R", permissions: codes });
  assert.equal(only(["vehicle.read"]).screens.has("vehicleRegistry"), true);
  assert.equal(only(["device.read"]).screens.has("vehicleRegistry"), false, "device.read opens the devices screen, not the registry");
  const actions = (codes) => [...only(codes).actions].filter((k) => k.startsWith("vehicleRegistry.")).sort();
  same(actions(["vehicle.read"]), []);
  same(actions(["vehicle.read", "vehicle.create"]), ["vehicleRegistry.create"]);
  same(actions(["vehicle.read", "vehicle.update"]), ["vehicleRegistry.update"]);
  same(actions(["vehicle.read", "vehicle.delete"]), ["vehicleRegistry.delete"]);
  same(actions(["vehicle.create", "vehicle.update", "vehicle.delete"]), [], "no writes without the screen's read code");
  // Safe-Fare Admin: reads in all-tenants mode, writes only with a selected tenant (contract: TENANT_REQUIRED).
  const sfa = access(IDENTITIES.platformAdmin);
  assert.equal(sfa.screens.has("vehicleRegistry"), true);
  for (const k of ["vehicleRegistry.create", "vehicleRegistry.update", "vehicleRegistry.delete"]) {
    assert.equal(p.actionBlock(sfa, k), "tenant", k);
    assert.equal(p.canPerform(access(IDENTITIES.platformAdmin, 42), k), true, k);
  }
  assert.equal(access(IDENTITIES.driver).screens.has("vehicleRegistry"), false);
});

test("VR contract: operations marked off-spec really are absent from V10; route and server path map to the screen", () => {
  for (const pth of ["/api/v1/vehicles", "/api/v1/vehicles/available", "/api/v1/vehicles/{id}"]) assert.equal(SPEC.paths[pth], undefined, pth);
  same([...VEHICLE_CODES], ["vehicle.read", "vehicle.create", "vehicle.update", "vehicle.delete"]);
  assert.equal(p.SCREEN_ROUTES.vehicleRegistry, "/drive-vision/vehicle-registry");
  assert.equal(p.screenForPath("/drive-vision/vehicle-registry"), "vehicleRegistry");
  assert.equal(p.screenForPath("/drive-vision/vehicles"), "vehicles", "the devices screen is unchanged");
  same(p.routeForServerPath("/vehicle-registry"), { screen: "vehicleRegistry", href: "/drive-vision/vehicle-registry" });
});

test("VR navigation: 'Vehicles' sits right after Reports", () => {
  const nav = read("components/drive-vision/navigation/nav-config.ts");
  assert.match(nav, /label: "Reports", screen: "reports"[^\n]*\n\s*\{ label: "Vehicles", screen: "vehicleRegistry", href: SCREEN_ROUTES\.vehicleRegistry/);
});

test("VR UI wiring: buttons follow the resolver; delete is disabled while a device is fitted", () => {
  const page = read("components/drive-vision/vehicle-registry/vehicle-registry-page.tsx");
  assert.match(page, /useActionGate\("vehicleRegistry\.create"\)/);
  assert.match(page, /useCan\("vehicleRegistry\.update"\)/);
  assert.match(page, /useCan\("vehicleRegistry\.delete"\)/);
  assert.match(page, /disabled=\{vehicle\.deviceAssigned === true\}/);
  assert.doesNotMatch(page, /roleCode|"ADMIN"|SUPER_ADMIN/);
});

// ── Service against a stub fetch ────────────────────────────────────────────

function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 600_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const out = respond(u.pathname.replace("/api/v1", ""), init.method ?? "GET");
    return new Response(JSON.stringify(out[1]), { status: out[0], headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined } });
  const r = (x) => realm.require(x);
  return { calls, svc: r("features/drive-vision/api/vehicle-registry-service").vehicleRegistryService, ctx: r("features/drive-vision/api/tenant-context") };
}
const ok = (data, total = null, code = 200) => [code, { code, msg: "Success", data, total, extend: null }];
const tenantHeader = (c) => Object.entries(c.headers).find(([k]) => k.toLowerCase() === "x-tenant-id")?.[1];

test("VR service: list sends only the set filters; total and tenant columns come back", async () => {
  const s = openRealm(() => ok([{ ...VEHICLE, tenantId: 10, tenantName: "Synthetic Tenant" }], 57));
  const res = await s.svc.listVehicles({ keyword: "tata", status: "ACTIVE", vehicleType: undefined, assigned: false, pageNumber: 2, pageSize: 20 });
  assert.equal(res.total, 57);
  assert.equal(res.items[0].tenantName, "Synthetic Tenant");
  const c = s.calls[0];
  assert.equal(`${c.method} ${c.path}`, "GET /api/v1/vehicles");
  same(c.query, { keyword: "tata", status: "ACTIVE", assigned: "false", pageNumber: "2", pageSize: "20" });
  assert.match(c.headers.Authorization, /^Bearer /);
});

test("VR service: available, detail, create (201), update and delete hit the contract paths", async () => {
  const s = openRealm((pth, method) => (method === "POST" ? ok(VEHICLE, null, 201) : method === "DELETE" ? ok(null) : pth === "/vehicles/available" ? ok([], 0) : ok(VEHICLE)));
  await s.svc.listAvailableVehicles({ keyword: "ts", pageNumber: 1, pageSize: 20 });
  same(await s.svc.getVehicle(12), VEHICLE);
  const body = { vehicleNumber: "TS09AB1234", status: "ACTIVE" };
  same(await s.svc.createVehicle(body), VEHICLE);
  await s.svc.updateVehicle(12, body);
  await s.svc.deleteVehicle(12);
  same(
    s.calls.map((c) => `${c.method} ${c.path}`),
    ["GET /api/v1/vehicles/available", "GET /api/v1/vehicles/12", "POST /api/v1/vehicles", "PUT /api/v1/vehicles/12", "DELETE /api/v1/vehicles/12"]
  );
  same(s.calls[2].body, body);
  same(s.calls[3].body, body);
  assert.equal(s.calls[4].body, undefined);
});

test("VR service: the Safe-Fare Admin's selected tenant travels as X-Tenant-Id", async () => {
  const s = openRealm(() => ok(VEHICLE, null, 201));
  s.ctx.setTenantSelection({ tenantId: 7, code: "SYN", name: null, header: "X-Tenant-Id" });
  await s.svc.createVehicle({ vehicleNumber: "A1" });
  assert.equal(tenantHeader(s.calls[0]), "7");
});

test("VR service: DUPLICATE, RESOURCE_IN_USE and validation errors reject with the server's message and code, sent once", async () => {
  const cases = [
    [409, { code: 409, msg: "A vehicle with this number is already registered", data: null, extend: { errorCode: "DUPLICATE" } }, (s) => s.svc.createVehicle({ vehicleNumber: "TS09AB1234" })],
    [409, { code: 409, msg: "Vehicle TS09AB1234 has device Bus 4 (13265326521) fitted; unlink or delete the device first", data: null, extend: { errorCode: "RESOURCE_IN_USE" } }, (s) => s.svc.deleteVehicle(12)],
    [400, { code: 400, msg: "Request validation failed", data: null, extend: { errorCode: "VALIDATION_FAILED", fieldErrors: [{ field: "vehicleNumber", message: "must not be blank" }] } }, (s) => s.svc.updateVehicle(12, { vehicleNumber: "" })],
    [404, { code: 404, msg: "Vehicle not found", data: null, extend: { errorCode: "NOT_FOUND" } }, (s) => s.svc.getVehicle(99)],
  ];
  for (const [status, payload, call] of cases) {
    const s = openRealm(() => [status, payload]);
    await assert.rejects(call(s), (err) => {
      assert.equal(err.message, payload.msg);
      assert.equal(err.errorCode, payload.extend.errorCode);
      if (payload.extend.fieldErrors) same(err.fieldErrorMap(), { vehicleNumber: "must not be blank" });
      return true;
    });
    assert.equal(s.calls.length, 1, `${payload.extend.errorCode}: sent once`);
  }
});
