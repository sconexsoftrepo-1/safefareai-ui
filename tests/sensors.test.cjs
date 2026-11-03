// Sensors / passenger counts (docs/contracts/passenger-counting-api.txt, supplied 2026-11-03; NOT in api-docs-v10.json).
// MOCKED / SYNTHETIC ONLY: buses, readings and responses are synthetic; requests go to a stub fetch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { SPEC, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const pure = createRealm({ process: { env: {} } }, { react: { useSyncExternalStore: () => null } });
const m = pure.require("components/drive-vision/sensors/sensors-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });
// 2026-11-03 14:00 IST = 08:30 UTC
const NOW = new Date("2026-11-03T08:30:00Z");

// ── Model ───────────────────────────────────────────────────────────────────

test("SN window: presets in fleet time (IST); custom range; from < to; at most 31 days", () => {
  same(m.resolveWindow("24h", {}, NOW).window, { fromUtc: "2026-11-02T08:30:00.000Z", toUtc: "2026-11-03T08:30:00.000Z" });
  same(m.resolveWindow("7d", {}, NOW).window.fromUtc, "2026-10-27T08:30:00.000Z");
  // IST midnight 2026-11-03 = 2026-11-02T18:30Z
  same(m.resolveWindow("today", {}, NOW).window, { fromUtc: "2026-11-02T18:30:00.000Z", toUtc: "2026-11-03T08:30:00.000Z" });
  same(m.resolveWindow("yesterday", {}, NOW).window, { fromUtc: "2026-11-01T18:30:00.000Z", toUtc: "2026-11-02T18:30:00.000Z" });
  same(m.resolveWindow("custom", { from: "2026-11-02T00:00", to: "2026-11-03T00:00" }, NOW).window, { fromUtc: "2026-11-01T18:30:00.000Z", toUtc: "2026-11-02T18:30:00.000Z" });
  assert.match(m.resolveWindow("custom", { from: "", to: "2026-11-03T00:00" }, NOW).error, /start and end/);
  assert.match(m.resolveWindow("custom", { from: "2026-11-03T00:00", to: "2026-11-02T00:00" }, NOW).error, /before the end/);
  assert.match(m.resolveWindow("custom", { from: "2026-09-01T00:00", to: "2026-11-02T00:00" }, NOW).error, /31 days/);
  assert.equal(m.recalcBlock(m.resolveWindow("7d", {}, NOW).window), null);
  assert.match(m.recalcBlock(m.resolveWindow("custom", { from: "2026-10-20T00:00", to: "2026-11-02T00:00" }, NOW).window), /7 days/);
});

test("SN display: unknown counts are '—' (never 0); statuses map to the contract's colours; notes explained", () => {
  assert.equal(m.showCount(null), "—");
  assert.equal(m.showCount(0), "0");
  assert.equal(m.showSigned(2), "+2");
  assert.equal(m.showSigned(-1), "-1");
  assert.equal(m.showPct(50), "50%");
  same(["MATCH", "MISMATCH", "OVER_CAPACITY", "OVER_CAPACITY_MISMATCH", "NO_BMS", "NO_SENSOR_COUNT"].map((s) => m.statusMeta(s).tone), ["success", "warning", "danger", "danger", "neutral", "neutral"]);
  same(m.statusMeta("SOMETHING_NEW"), { label: "SOMETHING_NEW", tone: "neutral" });
  assert.match(m.noteText("BMS_SEQUENCE_GAP"), /BMS stop is missing/);
  assert.equal(m.noteText("UNKNOWN_CODE"), "UNKNOWN_CODE");
  assert.equal(m.describeSensorData('{"in":6,"out":1,"count":17}'), "in 6 · out 1 · on board 17");
  assert.equal(m.describeSensorData("SMOKE_DETECTED"), "SMOKE_DETECTED");
  assert.equal(m.describeSensorData("25"), "25");
});

test("SN reading: IR needs whole numbers 0–300 and becomes the contract's JSON string; time ≤ 5 min ahead", () => {
  const ir = { ...m.emptyReadingForm(NOW), sensorId: "IR-01", inCount: "6", outCount: "1", count: "17" };
  same(m.validateReading(ir, NOW), {});
  same(m.readingBody(ir, 1215), { sensorId: "IR-01", sensorSubId: 3, deviceId: 1215, timestamp: "2026-11-03T08:30:00.000Z", sensorData: '{"in":6,"out":1,"count":17}', activeStatus: true });
  assert.ok(m.validateReading({ ...ir, count: "301" }, NOW).count);
  assert.ok(m.validateReading({ ...ir, inCount: "1.5" }, NOW).inCount);
  assert.ok(m.validateReading({ ...ir, sensorId: "bad id!" }, NOW).sensorId);
  assert.ok(m.validateReading({ ...ir, time: "2026-11-03T14:10" }, NOW).time, "10 min ahead is refused");
  assert.equal(m.validateReading({ ...ir, time: "2026-11-03T14:04" }, NOW).time, undefined);
  const smoke = { ...ir, sensorSubId: "1", sensorId: "SMOKE-1", data: " SMOKE_DETECTED ", active: false };
  same(m.validateReading(smoke, NOW), {});
  same(m.readingBody(smoke, 1215).sensorData, "SMOKE_DETECTED");
  assert.equal(m.readingBody(smoke, 1215).activeStatus, false);
  assert.ok(m.validateReading({ ...smoke, data: "" }, NOW).data);
});

// ── Access ──────────────────────────────────────────────────────────────────

test("SN access: screen on sensor.read; readings and recalculation need sensor.ingest; Safe-Fare Admin needs a tenant to write", () => {
  const only = (codes) => access({ platform: false, roleCode: "R", permissions: codes });
  assert.equal(only(["sensor.read"]).screens.has("sensors"), true);
  assert.equal(only(["sensor.ingest"]).screens.has("sensors"), false);
  const acts = (codes) => [...only(codes).actions].filter((k) => k.startsWith("sensors.")).sort();
  same(acts(["sensor.read"]), []);
  same(acts(["sensor.read", "sensor.ingest"]), ["sensors.ingest", "sensors.recalculate"]);
  assert.equal(p.canViewWidget(only(["sensor.read"]), "sensors.deviceChoices"), false, "bus picker needs device.read");
  assert.equal(p.canViewWidget(only(["sensor.read", "device.read"]), "sensors.deviceChoices"), true);
  const sfa = access(IDENTITIES.platformAdmin);
  assert.equal(sfa.screens.has("sensors"), true);
  assert.equal(p.actionBlock(sfa, "sensors.ingest"), "tenant");
  assert.equal(p.canPerform(access(IDENTITIES.platformAdmin, 42), "sensors.ingest"), true);
  assert.equal(access(IDENTITIES.driver).screens.has("sensors"), false);
});

test("SN contract: off-spec paths really are absent from V10; route, server path and nav entry", () => {
  for (const pth of Object.keys(SPEC.paths)) assert.doesNotMatch(pth, /sensors|\/stops|\/bms|passenger-summary/, pth);
  assert.equal(p.SCREEN_ROUTES.sensors, "/drive-vision/sensors");
  same(p.routeForServerPath("/sensors"), { screen: "sensors", href: "/drive-vision/sensors" });
  assert.match(read("components/drive-vision/navigation/nav-config.ts"), /\{ label: "Sensors", screen: "sensors", href: SCREEN_ROUTES\.sensors/);
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
  return { calls, svc: r("features/drive-vision/api/sensor-service").sensorService, ctx: r("features/drive-vision/api/tenant-context") };
}
const ok = (data, total = null) => [200, { code: 200, msg: "Success", data, total, extend: null }];
const WIN = { fromUtc: "2026-11-02T00:00:00Z", toUtc: "2026-11-03T00:00:00Z" };

test("SN service: every read hits its contract path with the window; readings are paged and filtered", async () => {
  const s = openRealm((pth) => (pth === "/sensors/types" ? ok([{ sensorSubId: 3, sensorName: "IR Sensor" }], 1) : pth.endsWith("/readings") ? ok([], 7) : ok({ deviceId: 1215 })));
  await s.svc.sensorTypes();
  await s.svc.passengerSummary(1215, WIN);
  await s.svc.comparison(1215, WIN);
  await s.svc.stops(1215, WIN);
  await s.svc.bms(1215, WIN);
  const readings = await s.svc.readings(1215, { ...WIN, sensorSubId: 3, pageNumber: 2, pageSize: 20 });
  assert.equal(readings.total, 7);
  same(
    s.calls.map((c) => `${c.method} ${c.path}`),
    [
      "GET /api/v1/sensors/types",
      "GET /api/v1/devices/1215/passenger-summary",
      "GET /api/v1/devices/1215/stops/comparison",
      "GET /api/v1/devices/1215/stops",
      "GET /api/v1/devices/1215/bms",
      "GET /api/v1/devices/1215/sensors/readings",
    ]
  );
  for (const c of s.calls.slice(1, 5)) same(c.query, WIN);
  same(s.calls[5].query, { ...WIN, sensorSubId: "3", pageNumber: "2", pageSize: "20" });
});

test("SN service: send readings (with the selected tenant header) and recalculate (window in the query, no body)", async () => {
  const s = openRealm((pth) => (pth === "/sensors/readings" ? ok({ received: 1, created: 1, duplicates: 0, results: [{ status: "CREATED" }] }) : ok({ deviceId: 1215, stopVisitsUpdated: 0, passengerAlerts: 3 })));
  s.ctx.setTenantSelection({ tenantId: 7, code: "SYN", name: null, header: "X-Tenant-Id" });
  const reading = { sensorId: "IR-01", sensorSubId: 3, deviceId: 1215, timestamp: "2026-11-02T08:05:00Z", sensorData: '{"in":6,"out":1,"count":17}', activeStatus: true };
  const res = await s.svc.sendReadings([reading]);
  assert.equal(res.created, 1);
  const rc = await s.svc.recalculate(1215, WIN);
  assert.equal(rc.passengerAlerts, 3);
  same(s.calls.map((c) => `${c.method} ${c.path}`), ["POST /api/v1/sensors/readings", "POST /api/v1/devices/1215/stops/recalculate"]);
  same(s.calls[0].body, { readings: [reading] });
  same(s.calls[1].query, WIN);
  assert.equal(s.calls[1].body, undefined);
  for (const c of s.calls) assert.equal(Object.entries(c.headers).find(([k]) => k.toLowerCase() === "x-tenant-id")?.[1], "7");
});

test("SN service: errors keep the server's message and code (404 other organisation, 409 duplicate, 400 window)", async () => {
  const cases = [
    [404, { code: 404, msg: "Device not found", data: null, extend: { errorCode: "NOT_FOUND" } }, (s) => s.svc.comparison(99, WIN)],
    [409, { code: 409, msg: "Reading already stored with a different value", data: null, extend: { errorCode: "DUPLICATE" } }, (s) => s.svc.sendReadings([{ sensorId: "IR-01", sensorSubId: 3, deviceId: 1, timestamp: "2026-11-02T08:05:00Z", sensorData: "1" }])],
    [400, { code: 400, msg: "Window too long", data: null, extend: { errorCode: "INVALID_VALUE" } }, (s) => s.svc.recalculate(1, WIN)],
  ];
  for (const [status, payload, call] of cases) {
    const s = openRealm(() => [status, payload]);
    await assert.rejects(call(s), (err) => err.message === payload.msg && err.errorCode === payload.extend.errorCode);
    assert.equal(s.calls.length, 1);
  }
});

// ── Alcohol detection (docs/contracts/alcohol-detection-api.txt) ────────────

test("AL status: detected is danger, not detected success; invalid / no reading are never shown as 'not detected'", () => {
  same(["DETECTED", "NOT_DETECTED", "INVALID_READING", "NO_READING"].map((s) => m.alcoholMeta(s).tone), ["danger", "success", "warning", "neutral"]);
  assert.equal(m.alcoholMeta(null).label, "No reading");
  for (const s of ["INVALID_READING", "NO_READING", null]) assert.doesNotMatch(m.alcoholMeta(s).label, /not detected/i, String(s));
  same(m.alcoholMeta("NEW_STATUS").label, "NEW_STATUS");
});

test("AL reading: sensorSubId 5 sends exactly \"1\" or \"0\"", () => {
  const base = { ...m.emptyReadingForm(NOW), sensorSubId: "5", sensorId: "ALC-1" };
  assert.ok(m.validateReading({ ...base, data: "" }, NOW).data);
  assert.ok(m.validateReading({ ...base, data: "2" }, NOW).data);
  same(m.validateReading({ ...base, data: "1" }, NOW), {});
  same(m.readingBody({ ...base, data: "0" }, 42), { sensorId: "ALC-1", sensorSubId: 5, deviceId: 42, timestamp: "2026-11-03T08:30:00.000Z", sensorData: "0", activeStatus: true });
});

test("AL service: GET /devices/{id}/sensors/alcohol with the window; covered by the Sensors screen's sensor.read", async () => {
  const data = { deviceId: 42, sensorId: "ALC-1", sensorName: "Alcohol Sensor", sensorData: "1", alcoholDetected: true, detectionStatus: "DETECTED", timestamp: "2026-11-03T10:00:00Z" };
  const s = openRealm(() => ok(data));
  same(await s.svc.alcohol(42, WIN), data);
  same(`${s.calls[0].method} ${s.calls[0].path}`, "GET /api/v1/devices/42/sensors/alcohol");
  same(s.calls[0].query, WIN);
  assert.ok(p.SCREENS.sensors.requires.operations.includes("GET /api/v1/devices/{id}/sensors/alcohol"));
  assert.match(read("components/drive-vision/sensors/sensors-page.tsx"), /sensorService\.alcohol\(deviceId!, win!\)/);
});
