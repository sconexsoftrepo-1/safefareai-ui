// Browser client for the Python API (python-client.ts): configuration, path allowlist, demo-tenant scope, request
// construction (headers, no credentials), error mapping and the tenant check. Replaces python-api-config.test.cjs,
// which covered the removed server-side proxies.
// MOCKED ONLY: every request goes to a stub fetch; nothing here reaches the real Python service.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));

const BASE = "https://py.example.test/safe-fare-python";
let calls = [];
let respond = () => Response.json({ ok: true });
const env = { NODE_ENV: "test", NEXT_PUBLIC_PYTHON_API_BASE_URL: BASE, NEXT_PUBLIC_DEMO_TENANT_ID: "1" };
const realm = createRealm({
  console: sink,
  URL,
  URLSearchParams,
  AbortSignal,
  AbortController,
  Request,
  Response,
  fetch: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  },
  process: { env },
});
const pc = () => realm.require("features/drive-vision/api/python-client");
test.beforeEach(() => {
  calls = [];
  respond = () => Response.json({ ok: true });
  Object.assign(env, { NODE_ENV: "test", NEXT_PUBLIC_PYTHON_API_BASE_URL: BASE, NEXT_PUBLIC_DEMO_TENANT_ID: "1" });
});

test("PC config: base URL validated, /safe-fare-python kept, trailing slash dropped; HTTPS required in production", () => {
  const c = pc();
  assert.equal(c.pythonApiBase("https://safefareai-api.sconexsoft.com/safe-fare-python/"), "https://safefareai-api.sconexsoft.com/safe-fare-python");
  assert.equal(c.pythonApiBase("http://localhost:8088", false), "http://localhost:8088", "plain http only outside production");
  assert.equal(c.pythonApiBase("http://safefareai-api.sconexsoft.com/safe-fare-python", true), null);
  assert.equal(c.pythonApiBase("https://safefareai-api.sconexsoft.com/safe-fare-python", true), "https://safefareai-api.sconexsoft.com/safe-fare-python");
  for (const bad of ["", "  ", "not a url", "ftp://x/y", "https://u:p@x/y", "https://x/y?a=1", "https://x/y#f"]) assert.equal(c.pythonApiBase(bad, false), null, String(bad));
  assert.equal(c.pythonApiBase(), BASE, "read from NEXT_PUBLIC_PYTHON_API_BASE_URL");
});

test("PC demo tenant: from NEXT_PUBLIC_DEMO_TENANT_ID; only that tenant's users get a scope; no all-tenant mode", () => {
  const c = pc();
  assert.equal(c.getPythonDemoTenantId(), 1);
  for (const bad of ["", "0", "-1", "1.5", "abc", " ", "1 OR 1"]) assert.equal(c.getPythonDemoTenantId(bad), null, String(bad));
  same(c.demoTenantScope(1), { ok: true, tenantId: 1 });
  same(c.demoTenantScope(10), { ok: false, reason: "not_demo_tenant", demoTenantId: 1 }, "another organisation never sees the demo tenant's data");
  same(c.demoTenantScope(null), { ok: false, reason: "no_tenant", demoTenantId: 1 }, "Safe-Fare Admin in all-tenants mode: no request");
  same(c.demoTenantScope(1, null), { ok: false, reason: "not_configured", demoTenantId: null });
  assert.match(c.demoScopeMessage({ ok: false, reason: "not_demo_tenant", demoTenantId: 1 }, "Sensor alerts"), /only available in the demo tenant \(tenant 1\)/);
});

test("PC paths: only allowlisted templates; {vehicle_number} validated and encoded; only relative paths, never another host", () => {
  const c = pc();
  same(c.PYTHON_API_PATHS, {
    irisChat: "/api/chat/message",
    irisHealth: "/health",
    sensorAlerts: "/api/sensors/alerts",
    vehicleMaintenanceList: "/api/vehicle-maintenance",
    vehicleMaintenanceAlerts: "/api/vehicle-maintenance/alerts",
    vehicleMaintenanceSchedule: "/api/vehicle-maintenance/{vehicle_number}",
    tyreMaintenanceList: "/api/v1/tyre-maintenance",
    tyreMaintenanceAlerts: "/api/v1/tyre-maintenance/alerts",
    tyreMaintenanceVehicle: "/api/v1/tyre-maintenance/vehicle/{vehicle_number}",
    tyreMaintenanceRegister: "/api/v1/tyre-maintenance/vehicle/{vehicle_number}/register",
    tyreMaintenanceComplete: "/api/v1/tyre-maintenance/vehicle/{vehicle_number}/complete",
  });
  assert.equal(c.pythonPath(c.PYTHON_API_PATHS.vehicleMaintenanceSchedule, "AP 31 Z0044"), "/api/vehicle-maintenance/AP%2031%20Z0044");
  for (const bad of ["alerts", "a/b", "../x", " AP31", "", undefined, "AP31Z0044?x=1"]) assert.throws(() => c.pythonPath(c.PYTHON_API_PATHS.tyreMaintenanceVehicle, bad), /invalid vehicle number/, String(bad));
  assert.throws(() => c.pythonPath("/api/vehicle-maintenance/{vehicle_number}/postpone", "AP31Z0044"), /not an allowed/, "driver-only paths can't be built");
  assert.throws(() => c.pythonPath(c.PYTHON_API_PATHS.irisChat, "AP31Z0044"), /takes no vehicle number/);
  assert.equal(c.pythonApiUrl("/api/sensors/alerts", new URLSearchParams({ tenant_id: "1", from_time: "2026-11-10 18:00:00" })), `${BASE}/api/sensors/alerts?tenant_id=1&from_time=2026-11-10+18%3A00%3A00`);
  for (const bad of ["https://evil.test/x", "//evil.test/x", "/api/../admin", "api/x", "/api/x?y=1", "/api//x", "/api/x#f", "\\\\evil"]) assert.throws(() => c.pythonApiUrl(bad), /only relative/, bad);
  assert.equal(c.pythonApiUrl("/health", null, null), null, "not configured → null");
});

test("PC request: Accept always; Content-Type only with a body; X-Tenant-ID only when asked; never Authorization or cookies; no-store", async () => {
  const c = pc();
  await c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.vehicleMaintenanceSchedule, "AP31Z0044"));
  await c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.tyreMaintenanceList), { tenantId: 1 });
  await c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.irisChat), { method: "POST", body: { message: "hi" } });
  await c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.tyreMaintenanceComplete, "AP31Z0044"), { method: "PATCH", body: {}, tenantId: 1 });
  same(calls.map((x) => [x.url, x.init.method, x.init.headers, x.init.body ?? null]), [
    [`${BASE}/api/vehicle-maintenance/AP31Z0044`, "GET", { Accept: "application/json" }, null],
    [`${BASE}/api/v1/tyre-maintenance`, "GET", { Accept: "application/json", "X-Tenant-Id": "1" }, null],
    [`${BASE}/api/chat/message`, "POST", { Accept: "application/json", "Content-Type": "application/json" }, '{"message":"hi"}'],
    [`${BASE}/api/v1/tyre-maintenance/vehicle/AP31Z0044/complete`, "PATCH", { Accept: "application/json", "Content-Type": "application/json", "X-Tenant-Id": "1" }, "{}"],
  ]);
  for (const x of calls) {
    same([x.init.cache, x.init.credentials, x.init.mode], ["no-store", "omit", "cors"]);
    assert.ok(!Object.keys(x.init.headers).some((h) => /authorization|cookie/i.test(h)));
  }
});

test("PC errors: not configured, network / CORS, timeout and abort are ApiErrors; HTTP errors keep their status; FastAPI detail is read", async () => {
  const c = pc();
  env.NEXT_PUBLIC_PYTHON_API_BASE_URL = "";
  await assert.rejects(c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.irisHealth)), (e) => e.status === 503 && e.errorCode === "not_configured" && /NEXT_PUBLIC_PYTHON_API_BASE_URL/.test(e.message));
  assert.equal(calls.length, 0, "no request without a base URL");
  env.NEXT_PUBLIC_PYTHON_API_BASE_URL = BASE;
  respond = () => Promise.reject(new TypeError("Failed to fetch"));
  await assert.rejects(c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.irisHealth)), (e) => e.kind === "network" && /Failed to fetch/.test(e.message) && /CORS/.test(e.message));
  const ctl = new AbortController();
  ctl.abort();
  respond = () => Promise.reject(new DOMException("aborted", "AbortError"));
  await assert.rejects(c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.irisHealth), { signal: ctl.signal }), (e) => e.kind === "aborted");
  // AbortSignal.timeout's timer doesn't keep Node's event loop alive; a plain timer does, for this case only.
  const keepAlive = setTimeout(() => {}, 1000);
  respond = (_, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))));
  await assert.rejects(c.pythonFetch(c.pythonPath(c.PYTHON_API_PATHS.irisHealth), { timeoutMs: 5 }), (e) => e.kind === "timeout");
  clearTimeout(keepAlive);

  const describe = (status, d) => `failed ${status}: ${d.message ?? (d.html ? "html" : "-")}`;
  const json = (status, body) => () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const cases = [
    [json(404, { detail: "Not Found" }), (e) => e.status === 404 && e.errorCode === "upstream_route_missing"],
    [json(404, { detail: "No schedule for AP31Z0044" }), (e) => e.status === 404 && e.errorCode === "not_found" && /No schedule/.test(e.message)],
    [json(422, { detail: [{ loc: ["query", "min_run"], msg: "must be >= 1" }] }), (e) => e.status === 422 && e.fieldErrors?.[0]?.field === "min_run"],
    [json(502, "<!DOCTYPE html><html><title>502 - Web server received an invalid response</title></html>"), (e) => e.status === 502 && e.errorCode === "upstream" && /html/.test(e.message)],
    [json(200, "not json"), (e) => e.kind === "parse"],
    [json(200, { data: { tenant_id: 2 } }), (e) => e.status === 502 && e.errorCode === "tenant_mismatch"],
  ];
  for (const [r, check] of cases) {
    respond = r;
    await assert.rejects(c.pythonJson(c.pythonPath(c.PYTHON_API_PATHS.tyreMaintenanceList), { tenantId: 1, expectTenantId: 1, describe }), check);
  }
  respond = json(200, { items: [{ tenant_id: 1 }] });
  same(await c.pythonJson(c.pythonPath(c.PYTHON_API_PATHS.tyreMaintenanceList), { expectTenantId: 1, describe }), { items: [{ tenant_id: 1 }] });
  same([...c.tenantIdsIn({ data: { tenant_id: 1, items: [{ tenant_id: 2 }, { nested: { tenant_id: 3 } }] } })].sort(), [1, 2, 3]);
});

test("PC wiring: the browser services use python-client only; no proxy, no same-origin /api route, no token to Python", () => {
  for (const f of ["features/drive-vision/api/iris-chat-service.ts", "features/drive-vision/api/sensor-alerts-service.ts", "features/drive-vision/api/maintenance-service.ts"]) {
    const s = read(f);
    assert.match(s, /from "\.\/python-client"/, f);
    assert.doesNotMatch(s, /-proxy"|same-origin-auth|fetchWithSession|"\/api\/(iris|maintenance|sensors)\//, f);
    assert.doesNotMatch(s, /Authorization:|Bearer \$|usableSession|accessToken/, `${f}: no token to Python`);
  }
  assert.ok(!fs.existsSync(path.join(SRC, "app", "api", "iris")) && !fs.existsSync(path.join(SRC, "app", "api", "maintenance")) && !fs.existsSync(path.join(SRC, "app", "api", "sensors")), "proxy routes removed");
  for (const f of ["iris-chat-proxy.ts", "sensor-alerts-proxy.ts", "maintenance-proxy.ts", "python-api.ts", "safefare-caller.ts", "same-origin-auth.ts"]) assert.ok(!fs.existsSync(path.join(SRC, "features", "drive-vision", "api", f)), `${f} removed`);
  const client = read("features/drive-vision/api/python-client.ts");
  assert.match(client, /process\.env\.NEXT_PUBLIC_PYTHON_API_BASE_URL/, "written out literally so Next.js inlines it");
  assert.match(client, /process\.env\.NEXT_PUBLIC_DEMO_TENANT_ID/);
  assert.doesNotMatch(client, /console\./, "nothing logged");
  assert.doesNotMatch(client, /185\.193|:8088|safefareai-api/, "no host hardcoded");
});

test("PC config files: one public Python base URL and demo tenant in .env.example; the server-only variables are gone", () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(SRC);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /IRIS_CHAT_API_URL|SENSOR_ALERTS_API_URL|\bPYTHON_API_URL\b|185\.193\.19\.156:8088/, f);
  const envFile = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.match(envFile, /^NEXT_PUBLIC_PYTHON_API_BASE_URL=https:\/\/safefareai-api\.sconexsoft\.com\/safe-fare-python$/m);
  assert.match(envFile, /^NEXT_PUBLIC_DEMO_TENANT_ID=\d+$/m);
  assert.doesNotMatch(envFile, /^(PYTHON_API_URL|IRIS_CHAT_API_URL|SENSOR_ALERTS_API_URL)=/m);
});

test("PC separation: the Java BFF and the GPSTrackTech video service keep their own configuration", () => {
  const envFile = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.match(envFile, /^NEXT_PUBLIC_API_BASE_URL=https:\/\/safefareai-api\.sconexsoft\.com\/safe-fare$/m, "Java BFF base URL unchanged");
  assert.match(envFile, /^NEXT_PUBLIC_GPS_VIDEO_API_TOKEN=/m, "GPSTrackTech token unchanged");
  assert.match(read("features/drive-vision/api/config.ts"), /process\.env\.NEXT_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(read("features/drive-vision/api/config.ts"), /PYTHON/);
  assert.match(read("components/drive-vision/monitoring/gps-video.ts"), /y\.gpstracktech\.com/, "GPSTrackTech host unchanged");
  assert.doesNotMatch(read("components/drive-vision/monitoring/gps-video.ts"), /PYTHON|python-client/);
});
