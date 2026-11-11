// Phase 4 — Safe-Fare Admin platform dashboard. Access rules, data model and request construction.
// MOCKED / SYNTHETIC ONLY: identities are synthetic fixtures (permission codes are real V10 codes) and
// every request goes to a stub fetch. Nothing here talks to the BFF; the real Safe-Fare Admin
// /me/permissions payload has not been captured.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const contract = require("./helpers/v10-contract.cjs");
const { SPEC, ALL_CODES, TENANT_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const pure = createRealm({ process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f() } });
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const model = pure.require("components/drive-vision/dashboard/platform-dashboard-model");
const nav = pure.require("components/drive-vision/navigation/use-nav");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const access = (raw) => p.computeAccess(idm.readIdentity(raw));
const synthetic = (extra) => ({ userId: 100, homeTenantId: 10, tenantId: 10, roleId: 50, roleCode: "ADMIN", platform: false, permissions: [], screens: [], ...extra });
/** Synthetic Safe-Fare Admin as described by the backend (platform true, ADMIN, no tenant, every code but driver.app). NOT the captured real payload. */
const SAFE_FARE_ADMIN = synthetic({ platform: true, homeTenantId: null, tenantId: null, permissions: ALL_CODES });
const TENANT_ADMIN = synthetic({ permissions: TENANT_CODES });
const navScreens = (a) => nav.navGroupsFor(a).flatMap((g) => g.items.map((i) => i.screen));

// ── Access ──────────────────────────────────────────────────────────────────

test("P4 access: platform=true + tenant.all → platform dashboard (screen, nav, route, landing)", () => {
  const a = access(SAFE_FARE_ADMIN);
  assert.equal(p.canAccessScreen(a, "platform"), true);
  assert.ok(navScreens(a).includes("platform"));
  assert.equal(p.decideRoute("authenticated", a, "/drive-vision/platform").kind, "allow");
  assert.equal(p.defaultLanding(a), "/drive-vision/platform");
  assert.equal(p.dataScope(a), "all-tenants");
  assert.equal(a.screens.has("myWork"), false, "no driver app");
  // This fixture holds the V10 codes only; widgets gated solely by off-spec codes (vehicle.read) are out of its scope.
  for (const w of p.ALL_WIDGETS) if (p.WIDGETS[w].anyOf.some((c) => ALL_CODES.includes(c))) assert.equal(p.canViewWidget(a, w), true, w);
});

test("P4 access: platform=true WITHOUT tenant.all → no platform dashboard, lands on Overview", () => {
  const a = access({ ...SAFE_FARE_ADMIN, permissions: TENANT_CODES });
  assert.equal(p.canAccessScreen(a, "platform"), false);
  assert.ok(!navScreens(a).includes("platform"));
  assert.equal(p.decideRoute("authenticated", a, "/drive-vision/platform").reason, "no-access");
  assert.equal(p.canViewWidget(a, "platform.tenants"), false);
  assert.equal(p.defaultLanding(a), "/drive-vision/overview");
});

test("P4 access: tenant ADMIN (platform=false) never gets the platform dashboard, even holding tenant.all", () => {
  for (const raw of [TENANT_ADMIN, { ...TENANT_ADMIN, permissions: ALL_CODES }]) {
    const a = access(raw);
    assert.equal(a.kind, "tenant-admin");
    assert.equal(p.canAccessScreen(a, "platform"), false);
    assert.ok(!navScreens(a).includes("platform"));
    assert.equal(p.decideRoute("authenticated", a, "/drive-vision/platform").kind, "forbidden");
    assert.equal(p.canViewWidget(a, "platform.tenants"), false);
    assert.equal(p.dataScope(a), "tenant", "own-tenant scope");
    assert.equal(p.defaultLanding(a), "/drive-vision/overview");
  }
});

test("P4 access: missing / null / non-boolean platform, missing permissions, no identity → no platform dashboard", () => {
  const noFlag = { ...SAFE_FARE_ADMIN };
  delete noFlag.platform;
  for (const raw of [noFlag, { ...SAFE_FARE_ADMIN, platform: null }, { ...SAFE_FARE_ADMIN, platform: "true" }, { ...SAFE_FARE_ADMIN, permissions: [] }, { ...SAFE_FARE_ADMIN, permissions: null }, null]) {
    const a = access(raw);
    assert.equal(p.canAccessScreen(a, "platform"), false, JSON.stringify(raw)?.slice(0, 60));
    assert.equal(p.canViewWidget(a, "platform.tenants"), false);
  }
  assert.equal(p.dataScope(access(null)), "none");
  assert.equal(p.defaultLanding(access(null)), null);
});

test("P4 access: widgets need their own codes; a Safe-Fare Admin holding only tenant.all sees tenants but no fleet widgets", () => {
  const a = access({ ...SAFE_FARE_ADMIN, permissions: ["tenant.all"] });
  assert.equal(p.canAccessScreen(a, "platform"), true);
  assert.equal(p.canViewWidget(a, "platform.tenants"), true);
  for (const w of ["dashboard.fleet", "dashboard.safety", "dashboard.groups"]) assert.equal(p.canViewWidget(a, w), false, w);
});

test("P4 access: a Safe-Fare Admin with a SELECTED tenant is tenant-scoped (Phase 5: the selection, not identity.tenantId)", () => {
  assert.equal(p.dataScope(p.computeAccess(idm.readIdentity(SAFE_FARE_ADMIN), undefined, { selectedTenantId: 42 })), "tenant");
  assert.equal(p.dataScope(access({ ...SAFE_FARE_ADMIN, tenantId: 42 })), "all-tenants", "an identity tenantId alone doesn't scope the platform admin");
});

test("P4 driver: driver logins never see the platform dashboard; nav unchanged", () => {
  const a = access(IDENTITIES.driver);
  assert.equal(p.canAccessScreen(a, "platform"), false);
  assert.deepEqual([...new Set(navScreens(a))], ["myWork"]);
  assert.equal(p.defaultLanding(a), "/drive-vision/my-work");
});

test("P4 contract: platform screen and every widget requirement mirror the V10 'Required permission'", () => {
  const ops = new Map(contract.specOperations(SPEC).map((o) => [o.key, o.op]));
  const reqs = [["screen platform", p.SCREENS.platform.requires], ...p.ALL_WIDGETS.map((w) => [`widget ${w}`, p.WIDGETS[w]])];
  for (const [label, req] of reqs) {
    assert.ok(req.operations.length > 0, label);
    for (const key of req.operations) {
      if (req.offSpec?.operations.includes(key)) continue;
      const op = ops.get(key);
      assert.ok(op, `${label}: ${key} is a V10 operation`);
      same([...(req.anyOf ?? [])].sort(), [...contract.permissionCodes(contract.permissionOf(op))].sort());
    }
  }
  assert.equal(p.SCREENS.platform.platformOnly, true);
});

// ── Data model ──────────────────────────────────────────────────────────────

const T = (extra) => ({ id: 1, code: "A", name: "Alpha", status: "ACTIVE", users: 3, devices: 10, drivers: 4, ...extra });

test("P4 model: complete tenant list → server totals summed; statuses counted only as documented strings", () => {
  const s = model.summarizeTenants({ items: [T(), T({ id: 2, name: "Beta", status: "INACTIVE", users: 1, devices: 0, drivers: 0 }), T({ id: 3, status: "SUSPENDED", users: 2, devices: 5, drivers: 1 })], total: 3 });
  same({ ...s }, { tenants: 3, complete: true, active: 1, inactive: 1, otherStatus: 1, users: 6, devices: 15, drivers: 5 });
});

test("P4 model: empty list is a real, complete zero (empty state), not an error", () => {
  same({ ...model.summarizeTenants({ items: [], total: 0 }) }, { tenants: 0, complete: true, active: 0, inactive: 0, otherStatus: 0, users: 0, devices: 0, drivers: 0 });
  assert.equal(model.summarizeTenants(undefined), null, "no response yet → no figures");
});

test("P4 model: incomplete list (total ≠ rows) → no partial sums or status counts", () => {
  const s = model.summarizeTenants({ items: [T()], total: 5 });
  assert.equal(s.tenants, 5, "the server's total is still the tenant count");
  assert.equal(s.complete, false);
  for (const k of ["active", "inactive", "otherStatus", "users", "devices", "drivers"]) assert.equal(s[k], null, k);
});

test("P4 model: a missing or malformed per-tenant count makes that total unavailable (never a partial sum)", () => {
  const s = model.summarizeTenants({ items: [T(), T({ id: 2, users: undefined, devices: "7", drivers: -1 })], total: 2 });
  assert.equal(s.users, null);
  assert.equal(s.devices, null);
  assert.equal(s.drivers, null);
  assert.equal(s.active, 2);
});

test("P4 model: serverCount, severityRows and sortTenants never invent values", () => {
  for (const v of [undefined, null, "3", -1, 1.5, NaN]) assert.equal(model.serverCount(v), null, String(v));
  assert.equal(model.serverCount(0), 0);
  same(model.severityRows({ 1: 4, 3: 2, "": 9, 2: -1, x: "5" }), [{ key: "3", value: 2 }, { key: "1", value: 4 }]);
  same(model.severityRows(undefined), []);
  same(model.sortTenants([T({ id: 2, name: "Beta" }), T({ id: 1, name: "alpha" })]).map((t) => t.id), [1, 2]);
});

// ── Request construction (stub fetch) ───────────────────────────────────────

const STORAGE_KEY = "safefare:session:v1";
function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const headers = init.headers ?? {};
    const call = { method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), headerNames: Object.keys(headers).map((h) => h.toLowerCase()), auth: !!headers.Authorization };
    calls.push(call);
    const out = respond(call);
    if (out === "network") throw new TypeError("Failed to fetch");
    const [status, body] = out;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm(
    { console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } },
    { react: { useSyncExternalStore: () => undefined } }
  );
  const r = (m) => realm.require(`features/drive-vision/api/${m}`);
  return { calls, platform: r("platform-service").platformService, insight: r("insight-service").insightService, fleet: r("fleet-service").fleetService, errors: r("errors") };
}
const ok = (data, total) => [200, { code: 200, msg: "Success", data, total: total ?? (Array.isArray(data) ? data.length : undefined) }];
const W = { from: "2026-10-26T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" };

test("P4 API: every platform-dashboard read hits its V10 endpoint with the bearer token, no X-Tenant-Id and no tenantId", async () => {
  const s = openRealm(() => ok([]));
  await s.platform.tenants();
  await s.fleet.listGroups();
  await s.insight.overview();
  await s.insight.fleetStatus();
  await s.insight.trends(W);
  await s.insight.safetyEvents(W);
  same(s.calls.map((c) => `${c.method} ${c.path}`), [
    "GET /api/v1/platform/tenants",
    "GET /api/v1/groups",
    "GET /api/v1/dashboard/overview",
    "GET /api/v1/dashboard/fleet-status",
    "GET /api/v1/dashboard/trends",
    "GET /api/v1/dashboard/safety-events",
  ]);
  for (const c of s.calls) {
    assert.equal(c.auth, true, `${c.path}: bearer`);
    assert.ok(!c.headerNames.includes("x-tenant-id"), `${c.path}: no X-Tenant-Id`);
    assert.ok(!("tenantId" in c.query), `${c.path}: no tenantId query`);
  }
  same(s.calls[0].query, {});
  same(s.calls[4].query, W);
  same(s.calls[5].query, W);
});

test("P4 API: tenant list keeps the server total; empty list is empty, not an error", async () => {
  const s = openRealm(() => ok([T(), T({ id: 2 })], 2));
  const list = await s.platform.tenants();
  assert.equal(list.total, 2);
  assert.equal(list.items.length, 2);
  const e = openRealm(() => [200, { code: 200, msg: "Success", data: null }]);
  same({ items: [...(await e.platform.tenants()).items], total: 0 }, { items: [], total: 0 });
});

test("P4 API: 403 / 503 / network failures surface as errors (never converted to zero)", async () => {
  for (const [label, out, check] of [
    ["403", [403, { code: 403, msg: "Forbidden", data: null, extend: { errorCode: "FORBIDDEN", requestId: "req-1" } }], (err) => assert.equal(err.status, 403)],
    ["503", [503, { code: 503, msg: "Database unavailable", data: null }], (err) => assert.equal(err.status, 503)],
    ["network", "network", (err) => assert.equal(err.kind, "network")],
  ]) {
    const s = openRealm(() => out);
    await assert.rejects(s.platform.tenants(), (err) => {
      assert.ok(s.errors.isApiError(err), `${label}: ApiError`);
      check(err);
      assert.doesNotMatch(s.errors.describeApiError(err), /a\.b\.c|Bearer/, "no token in the message");
      return true;
    });
  }
});

// Phase 5 replaces "no code path sends a tenant selector" (true until Phase 4) with: the header name appears
// only in the tenant module, and nothing hard-codes a tenant id or sends ?tenantId.
test("P4/P5 API: tenant header only via api/tenant-context; no hard-coded tenant ids; no tenantId query (static)", () => {
  const SRC = path.join(__dirname, "..", "src");
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(SRC);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (!f.endsWith(path.join("api", "tenant-context.ts"))) assert.doesNotMatch(src, /["'`]X-Tenant-Id["'`]/i, `${path.relative(SRC, f)} names the tenant header`);
    assert.doesNotMatch(src, /query:\s*\{[^}]*\btenantId\b/, `${path.relative(SRC, f)} sends ?tenantId`);
    assert.doesNotMatch(src, /tenantId\s*:\s*\d/, `${path.relative(SRC, f)} hard-codes a tenant id`);
  }
});

test("P4 separation: platform widgets use their own query keys; the tenant Overview never calls platform APIs", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "components", "drive-vision", "dashboard", f), "utf8");
  const platform = read("platform-dashboard.tsx");
  const overview = read("fleet-overview.tsx");
  const keys = [...platform.matchAll(/useApiQuery\(\s*([^,]+),/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6);
  for (const k of keys) assert.match(k, /"platform:|`platform:/, `platform key ${k}`);
  assert.doesNotMatch(overview, /platformService|platform:/, "Overview keeps its own (tenant) queries");
  // Permission logic stays central: the page asks the resolver, it doesn't read codes itself.
  assert.doesNotMatch(platform, /permissions\.has|\.platform\s*===|roleCode/);
});
