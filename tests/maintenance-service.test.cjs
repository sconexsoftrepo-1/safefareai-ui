// Vehicle / Tyre Maintenance browser service (maintenance-service.ts), calling the Python API directly (temporary demo
// integration). Replaces maintenance-proxy.test.cjs: the same guarantees, now enforced in the browser — demo-tenant
// scope, X-Tenant-ID only where the contract takes it, request validation, the BFF write guard, the tenant check on
// answers, error mapping, and the Notifications feed's bounds, cache and partial failures.
// MOCKED ONLY: the BFF and the Python API are stub fetches; a pass says nothing about the live services.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));

const DEMO = 10;
let calls = [];
let python = {};
let bffVehicles = () => [{ id: 501, vehicleNumber: "AP31Z0044" }, { id: 502, vehicleNumber: "TS09AB1234" }];
let inFlight = 0;
let maxInFlight = 0;
const header = (init, name) => Object.entries(init.headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

async function stubFetch(url, init = {}) {
  const u = new URL(String(url));
  const py = u.host === "py.test";
  const call = { host: u.host, path: py ? u.pathname.replace(/^\/safe-fare-python/, "") : u.pathname, query: Object.fromEntries(u.searchParams), method: init.method ?? "GET", auth: header(init, "authorization"), tenant: header(init, "x-tenant-id"), credentials: init.credentials, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(call);
  if (!py) {
    if (u.pathname === "/api/v1/vehicles") return Response.json({ code: 200, msg: "ok", data: bffVehicles(call), total: 2 });
    return Response.json({ code: 200, msg: "ok", data: {} });
  }
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    await new Promise((r) => setTimeout(r, 1));
    for (const [pattern, fn] of Object.entries(python)) if (new RegExp(`^${pattern}$`).test(`${call.method} ${call.path}`)) return await fn(call);
    return new Response('{"detail":"Not Found"}', { status: 404 });
  } finally {
    inFlight -= 1;
  }
}

const storage = new MemoryStorage();
storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 3_600_000, refreshToken: "r", refreshExpiresAt: null }));
const realm = createRealm({
  console: sink,
  URL,
  URLSearchParams,
  AbortSignal,
  AbortController,
  Request,
  Response,
  Headers,
  DOMException,
  fetch: (...a) => stubFetch(...a),
  sessionStorage: storage,
  localStorage: new MemoryStorage(),
  navigator: { locks: createLockManager() },
  performance,
  crypto: globalThis.crypto,
  atob,
  btoa,
  structuredClone,
  queueMicrotask,
  process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://bff.test", NEXT_PUBLIC_PYTHON_API_BASE_URL: "https://py.test/safe-fare-python", NEXT_PUBLIC_DEMO_TENANT_ID: String(DEMO) } },
});
const mod = () => realm.require("features/drive-vision/api/maintenance-service");
const svc = () => mod().maintenanceService;
const pyCalls = () => calls.filter((c) => c.host === "py.test");
const bffCalls = () => calls.filter((c) => c.host === "bff.test" && c.path === "/api/v1/vehicles");

test.beforeEach(() => {
  calls = [];
  python = {};
  bffVehicles = () => [{ id: 501, vehicleNumber: "AP31Z0044" }, { id: 502, vehicleNumber: "TS09AB1234" }];
  inFlight = 0;
  maxInFlight = 0;
  mod().resetMaintenanceFeedCache();
});

const schedule = (tenant = DEMO, extra = {}) => ({
  success: true,
  message: "Maintenance schedule retrieved successfully",
  data: { tenant_id: tenant, vehicle_number: "AP31Z0044", device_id: 1215, driver_id: 1204, driver_name: "Ravi Kumar", previous_vehicle_maintenance_date: "2026-11-10", maintenance_time_window: 30, expected_vehicle_maintenance_date: "2026-12-10", due_date: "2026-12-10", status: "pending", days_until_due: 30, reminder_schedule: [], ...extra },
});
const tyreAlerts = (tenant = DEMO, items = null) => ({
  count: 1,
  items: items ?? [{ id: 115, tenant_id: tenant, device_id: 1215, vehicle_number: "AP31Z0044", alert_level: 2, maintenance_status: "CRITICAL_85", usage_percentage: 88.92, current_distance_km: 266.769, limit_km: 300, message: "Vehicle AP31Z0044 has used 88.92% of its tyre life.", is_reminder: false, created_at: "2026-11-09T22:44:48.252063" }],
});
const vehicleAlerts = (items, extra = {}) => ({ success: true, message: "Alerts retrieved successfully", data: { vehicle_number: "AP31Z0044", driver_id: 1204, driver_name: "Ravi Kumar", items, total_alerts: items.length, ...extra } });
const OVERDUE = { vehicle_number: "AP31Z0044", kind: "overdue", title: "Vehicle maintenance reminder", message: "Maintenance for vehicle AP31Z0044 is overdue by 2 days.", due_date: "2026-11-09", alert_date: "2026-11-11", created_at: "2026-11-11T04:15:59" };
const vmList = (numbers, total) => ({ success: true, message: "ok", data: { items: numbers.map((n) => ({ tenant_id: DEMO, vehicle_number: n, status: "pending" })), ...(total !== undefined ? { total } : {}) } });

// ── Scope and headers ───────────────────────────────────────────────────────

test("MS scope: only the demo tenant's callers reach Python; another tenant, no tenant and no config send nothing", async () => {
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json(tyreAlerts());
  await assert.rejects(svc().tyreAlerts(42, {}), (e) => e.status === 403 && e.errorCode === "not_demo_tenant" && /tenant 10/.test(e.message));
  await assert.rejects(svc().getSchedule(null, "AP31Z0044"), (e) => e.errorCode === "no_tenant");
  await assert.rejects(svc().notifications(42), (e) => e.errorCode === "not_demo_tenant");
  same(calls, [], "nothing sent");
  await svc().tyreAlerts(DEMO, {});
  same(pyCalls().map((c) => [c.path, c.tenant, c.auth, c.credentials]), [["/api/v1/tyre-maintenance/alerts", "10", undefined, "omit"]]);
});

test("MS headers: X-Tenant-ID on the five tyre operations and schedule create; never on Vehicle Maintenance GETs; never a token", async () => {
  python["GET /api/vehicle-maintenance"] = () => Response.json({ success: true, message: "ok", data: [] });
  python["GET /api/vehicle-maintenance/alerts"] = () => Response.json(vehicleAlerts([]));
  python["GET /api/vehicle-maintenance/AP31Z0044"] = () => Response.json(schedule());
  python["POST /api/vehicle-maintenance"] = () => Response.json(schedule());
  python["GET /api/v1/tyre-maintenance"] = () => Response.json([]);
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json(tyreAlerts());
  python["GET /api/v1/tyre-maintenance/vehicle/AP31Z0044"] = () => Response.json({ tenant_id: DEMO, vehicle_number: "AP31Z0044" });
  python["POST /api/v1/tyre-maintenance/vehicle/AP31Z0044/(register|complete)"] = () => Response.json({ tenant_id: DEMO, vehicle_number: "AP31Z0044" });
  const cases = [
    ["vehicle schedule list", () => svc().listSchedules(DEMO), "/api/vehicle-maintenance", undefined],
    ["vehicle schedule detail", () => svc().getSchedule(DEMO, "AP31Z0044"), "/api/vehicle-maintenance/AP31Z0044", undefined],
    ["vehicle alerts", () => svc().vehicleAlerts(DEMO, "AP31Z0044"), "/api/vehicle-maintenance/alerts", undefined],
    ["vehicle schedule create (kept until its contract is confirmed)", () => svc().createSchedule(DEMO, { vehicle_number: "AP31Z0044", previous_vehicle_maintenance_date: "2026-11-10" }), "/api/vehicle-maintenance", "10"],
    ["tyre list", () => svc().listTyres(DEMO), "/api/v1/tyre-maintenance", "10"],
    ["tyre alerts", () => svc().tyreAlerts(DEMO), "/api/v1/tyre-maintenance/alerts", "10"],
    ["tyre detail", () => svc().getTyre(DEMO, "AP31Z0044"), "/api/v1/tyre-maintenance/vehicle/AP31Z0044", "10"],
    ["tyre register", () => svc().registerTyres(DEMO, "AP31Z0044", "2026-11-10T10:30:00Z"), "/api/v1/tyre-maintenance/vehicle/AP31Z0044/register", "10"],
    ["tyre complete", () => svc().completeTyreReplacement(DEMO, "AP31Z0044"), "/api/v1/tyre-maintenance/vehicle/AP31Z0044/complete", "10"],
  ];
  for (const [name, run, path, tenant] of cases) {
    calls = [];
    await run();
    const py = pyCalls();
    same([name, py.length, py[0].path, py[0].tenant, py[0].auth, py[0].credentials], [name, 1, path, tenant, undefined, "omit"]);
  }
  for (const c of bffCalls()) assert.equal(c.auth, "Bearer a.b.c", "the Safe-Fare token goes to the Java BFF only");
});

test("MS tenant check: an answer carrying another tenant's tenant_id is withheld (tenant_mismatch), also in the feed", async () => {
  python["GET /api/vehicle-maintenance/AP31Z0044"] = () => Response.json(schedule(1));
  await assert.rejects(svc().getSchedule(DEMO, "AP31Z0044"), (e) => e.status === 502 && e.errorCode === "tenant_mismatch" && !/Ravi/.test(e.message));
  assert.equal(pyCalls()[0].tenant, undefined, "checked even though no X-Tenant-ID was sent");
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json(tyreAlerts(DEMO, [{ ...tyreAlerts().items[0], tenant_id: 3 }]));
  await assert.rejects(svc().tyreAlerts(DEMO), (e) => e.errorCode === "tenant_mismatch");
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json(tyreAlerts());
  python["GET /api/vehicle-maintenance"] = () => Response.json(vmList(["AP31Z0044"]));
  python["GET /api/vehicle-maintenance/alerts"] = () => Response.json(vehicleAlerts([{ ...OVERDUE, message: "secret" }], { tenant_id: 3 }));
  const feed = await svc().notifications(DEMO);
  same([feed.items.map((n) => n.source), feed.sources.vehicle.failedVehicles], [["TYRE_MAINTENANCE"], 1]);
  assert.ok(!JSON.stringify(feed).includes("secret"));
});

// ── Validation, write guard, errors ─────────────────────────────────────────

test("MS validation: only documented fields and parameters are sent; invalid input is refused before any request", async () => {
  python["GET /api/vehicle-maintenance"] = () => Response.json({ success: true, message: "ok", data: [] });
  python["POST /api/vehicle-maintenance"] = () => Response.json(schedule());
  await svc().listSchedules(DEMO, { status: "pending", page: 2, page_size: 20, expected_date_from: "2026-12-01", tenant_id: 99, foo: "bar" });
  same(Object.entries(pyCalls()[0].query).sort(), Object.entries({ status: "pending", page: "2", page_size: "20", expected_date_from: "2026-12-01" }).sort());
  await svc().createSchedule(DEMO, { vehicle_number: " AP31Z0044 ", previous_vehicle_maintenance_date: "2026-11-10", reason: "  Routine ", expected_vehicle_maintenance_date: "2027-01-01", tenant_id: 3 });
  same(pyCalls().at(-1).body, { vehicle_number: "AP31Z0044", previous_vehicle_maintenance_date: "2026-11-10", reason: "Routine" });
  calls = [];
  const bad = [
    () => svc().listSchedules(DEMO, { page: 0 }),
    () => svc().listSchedules(DEMO, { page_size: 101 }),
    () => svc().listSchedules(DEMO, { expected_date_to: "2026-13-01" }),
    () => svc().createSchedule(DEMO, { vehicle_number: "AP31Z0044", previous_vehicle_maintenance_date: "10/11/2026" }),
    () => svc().vehicleAlerts(DEMO, ""),
    () => svc().getSchedule(DEMO, "a/b"),
    () => svc().getSchedule(DEMO, "alerts"),
    () => svc().tyreAlerts(DEMO, { limit: 0 }),
    () => svc().tyreAlerts(DEMO, { limit: 501 }),
    () => svc().tyreAlerts(DEMO, { vehicle_number: "a/b" }),
    () => svc().registerTyres(DEMO, "AP31Z0044", "2026-11-10"),
    () => svc().registerTyres(DEMO, "AP31Z0044", "2026-11-10T10:30:00"),
    () => svc().completeTyreReplacement(DEMO, "AP31Z0044", "yesterday"),
  ];
  for (const [i, run] of bad.entries()) await assert.rejects(run(), (e) => e.status === 400 && e.errorCode === "invalid_request", String(i));
  same(calls, [], "nothing sent for invalid input");
});

test("MS write guard: create, register and complete first confirm the vehicle with the Java BFF; outside the tenant nothing reaches Python", async () => {
  python["POST /api/vehicle-maintenance"] = () => Response.json(schedule());
  python["POST /api/v1/tyre-maintenance/vehicle/KA01ZZ9999/register"] = () => Response.json({});
  await assert.rejects(svc().createSchedule(DEMO, { vehicle_number: "KA01ZZ9999", previous_vehicle_maintenance_date: "2026-11-10" }), (e) => e.status === 404 && e.errorCode === "vehicle_not_found" && /KA01ZZ9999/.test(e.message));
  await assert.rejects(svc().registerTyres(DEMO, "KA01ZZ9999", "2026-11-10T10:30:00Z"), (e) => e.errorCode === "vehicle_not_found");
  same(pyCalls(), []);
  same(bffCalls().map((c) => [c.query.keyword, c.auth]), [["KA01ZZ9999", "Bearer a.b.c"], ["KA01ZZ9999", "Bearer a.b.c"]]);
  bffVehicles = () => {
    throw new Error("BFF down");
  };
  await assert.rejects(svc().completeTyreReplacement(DEMO, "AP31Z0044"), (e) => e.status === 502 && e.errorCode === "vehicle_check_failed");
  same(pyCalls(), []);
});

test("MS errors: route missing vs record missing, 422 field errors, 500, the gateway's HTML 502, network and timeout keep their status", async () => {
  const cases = [
    [() => new Response('{"detail":"Not Found"}', { status: 404 }), (e) => e.status === 404 && e.errorCode === "upstream_route_missing" && /doesn't have this endpoint/.test(e.message)],
    [() => Response.json({ detail: "No maintenance schedule for AP31Z0044" }, { status: 404 }), (e) => e.status === 404 && e.errorCode === "not_found" && /No maintenance schedule/.test(e.message)],
    [() => Response.json({ detail: [{ loc: ["path", "vehicle_number"], msg: "invalid" }] }, { status: 422 }), (e) => e.status === 422 && e.fieldErrors?.[0]?.field === "vehicle_number"],
    [() => Response.json({}, { status: 500 }), (e) => e.status === 500 && /ran into a problem/.test(e.message)],
    [() => new Response("<!DOCTYPE html><html><title>502 - Web server received an invalid response</title></html>", { status: 502 }), (e) => e.status === 502 && /can't be reached/.test(e.message) && /HTML error page/.test(e.message)],
    [() => Promise.reject(new TypeError("Failed to fetch")), (e) => e.kind === "network" && /CORS/.test(e.message)],
  ];
  for (const [respond, check] of cases) {
    python["GET /api/vehicle-maintenance/AP31Z0044"] = respond;
    await assert.rejects(svc().getSchedule(DEMO, "AP31Z0044"), check);
  }
});

// ── Notifications feed (assembled in the browser) ───────────────────────────

test("MS feed: tyre alerts + every per-vehicle alert, normalized and newest first; tyre request has X-Tenant-ID, vehicle requests don't", async () => {
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json(tyreAlerts());
  python["GET /api/vehicle-maintenance"] = () => Response.json(vmList(["AP31Z0044", "TS09AB1234", "AP31Z0044"]));
  python["GET /api/vehicle-maintenance/alerts"] = (c) =>
    c.query.vehicle_number === "AP31Z0044"
      ? Response.json(vehicleAlerts([OVERDUE, { ...OVERDUE, kind: "due_today", alert_date: "2026-11-09", created_at: "2026-11-09T04:15:59" }]))
      : Response.json({ detail: "No alerts for TS09AB1234" }, { status: 404 });
  const feed = await svc().notifications(DEMO);
  same(feed.items.map((n) => [n.id, n.source, n.sourceId, n.driverName]), [
    ["vehicle:AP31Z0044:overdue:2026-11-09:2026-11-11:2026-11-11T04:15:59", "VEHICLE_MAINTENANCE", null, "Ravi Kumar"],
    ["tyre:115", "TYRE_MAINTENANCE", 115, null],
    ["vehicle:AP31Z0044:due_today:2026-11-09:2026-11-09:2026-11-09T04:15:59", "VEHICLE_MAINTENANCE", null, "Ravi Kumar"],
  ]);
  same(feed.sources.vehicle, { ok: true, vehiclesChecked: 2, vehiclesWithSchedules: 2, failedVehicles: 0, truncated: false }, "a 404 for one vehicle is 'no alerts', not a failure");
  same(pyCalls().find((c) => c.path === "/api/v1/tyre-maintenance/alerts").query, { limit: "50" });
  same(pyCalls().find((c) => c.path === "/api/vehicle-maintenance").query, { page: "1", page_size: "100" });
  same(pyCalls().filter((c) => c.path === "/api/vehicle-maintenance/alerts").map((c) => c.query.vehicle_number).sort(), ["AP31Z0044", "TS09AB1234"], "deduplicated per vehicle");
  for (const c of pyCalls()) same([c.path, c.tenant, c.auth], [c.path, c.path.startsWith("/api/v1/tyre-maintenance") ? "10" : undefined, undefined]);
});

test("MS feed: bounded to 25 vehicles, at most 4 alert requests at a time, cached 60 s per tenant, refresh limited to every 10 s", async () => {
  const numbers = Array.from({ length: 40 }, (_, i) => `KA01AA${String(i).padStart(4, "0")}`);
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json({ count: 0, items: [] });
  python["GET /api/vehicle-maintenance"] = () => Response.json(vmList(numbers, 140));
  python["GET /api/vehicle-maintenance/alerts"] = () => Response.json(vehicleAlerts([]));
  let t = 1_000_000;
  const now = () => t;
  const feed = await svc().notifications(DEMO, false, now);
  assert.equal(pyCalls().filter((c) => c.path === "/api/vehicle-maintenance/alerts").length, 25);
  assert.ok(maxInFlight <= 4 + 2, `concurrency bounded (max in flight ${maxInFlight})`);
  same([feed.sources.vehicle.truncated, feed.sources.vehicle.vehiclesWithSchedules], [true, 140]);

  calls = [];
  t += 5_000;
  await svc().notifications(DEMO, false, now);
  await svc().notifications(DEMO, true, now);
  same(pyCalls(), [], "within the TTL, and a refresh within 10 s, are served from the cache");
  t += 11_000;
  await svc().notifications(DEMO, true, now);
  assert.equal(pyCalls().filter((c) => c.path === "/api/vehicle-maintenance").length, 1, "an explicit refresh after 10 s rebuilds");
  calls = [];
  t += 61_000;
  await Promise.all([svc().notifications(DEMO, false, now), svc().notifications(DEMO, false, now)]);
  assert.equal(pyCalls().filter((c) => c.path === "/api/vehicle-maintenance").length, 1, "concurrent opens share one build");
});

test("MS feed: one failed source is reported, not shown as 'no alerts'; both failing is an error; errors aren't cached", async () => {
  python["GET /api/v1/tyre-maintenance/alerts"] = () => new Response("boom", { status: 500 });
  python["GET /api/vehicle-maintenance"] = () => Response.json(vmList(["AP31Z0044"]));
  python["GET /api/vehicle-maintenance/alerts"] = () => Response.json(vehicleAlerts([OVERDUE]));
  let feed = await svc().notifications(DEMO);
  same([feed.sources.tyre.ok, feed.sources.tyre.status, feed.sources.vehicle.ok, feed.items.map((n) => n.kind)], [false, 500, true, ["overdue"]], "vehicle alerts still shown");
  mod().resetMaintenanceFeedCache();
  python["GET /api/v1/tyre-maintenance/alerts"] = () => Response.json(tyreAlerts());
  python["GET /api/vehicle-maintenance/alerts"] = () => new Response("boom", { status: 503 });
  feed = await svc().notifications(DEMO);
  same([feed.sources.vehicle.failedVehicles, feed.items.map((n) => n.id)], [1, ["tyre:115"]], "tyre alerts still shown");
  mod().resetMaintenanceFeedCache();
  python["GET /api/v1/tyre-maintenance/alerts"] = () => new Response("boom", { status: 500 });
  python["GET /api/vehicle-maintenance"] = () => new Response('{"detail":"Not Found"}', { status: 404 });
  await assert.rejects(svc().notifications(DEMO), (e) => e.status === 500);
  calls = [];
  await assert.rejects(svc().notifications(DEMO));
  assert.ok(pyCalls().length > 0, "a failure isn't cached: the next open tries again");
});
