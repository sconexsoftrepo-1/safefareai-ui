// Phase 6 — Tenant Management: view model, access for every role, API usage, errors, and the guarantee
// that no tenant-management endpoint is invented. MOCKED / SYNTHETIC ONLY: tenants and identities are
// synthetic; requests go to a stub fetch. Nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { SPEC, ALL_CODES, TENANT_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const pure = createRealm({ process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f(), useSyncExternalStore: () => null } });
const m = pure.require("components/drive-vision/platform/tenant-management-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const store = pure.require("features/drive-vision/store/tenant-store");
const nav = pure.require("components/drive-vision/navigation/use-nav");
const access = (raw) => p.computeAccess(idm.readIdentity(raw));

/** SYNTHETIC tenants (not backend data). */
const T = (extra) => ({ id: 1, code: "ACME", name: "Acme Logistics", status: "ACTIVE", timezone: "Asia/Kolkata", users: 14, devices: 120, drivers: 48, current: false, ...extra });
const LIST = [
  T(),
  T({ id: 2, code: "BLUE", name: "Blue Line Cabs", users: 6, devices: 35, drivers: 22 }),
  T({ id: 3, code: "OLDCO", name: "Old Co Transport", status: "INACTIVE", users: 2, devices: 0, drivers: 0 }),
  T({ id: 4, code: "NEW", name: "newco", status: undefined, users: undefined, devices: null, drivers: "5", timezone: undefined }),
  T({ id: 5, code: "SUSP", name: "Suspended Ltd", status: "SUSPENDED" }),
];

// ── List: search, status filter, missing data ──────────────────────────────

test("P6 search: name, code and id, case-insensitive; blank query matches all; missing fields don't break it", () => {
  const names = (q) => m.filterTenants(LIST, q, m.ALL_STATUSES).map((t) => t.id);
  same(names(""), [1, 2, 4, 3, 5]);
  same(names("acme"), [1]);
  same(names("BLUE"), [2]);
  same(names("3"), [3]);
  same(names("  newco "), [4]);
  same(names("zzz"), []);
  assert.equal(m.matchTenant({}, "x"), false);
  assert.equal(m.matchTenant({}, ""), true);
});

test("P6 status filter: options are only statuses the server returned (+ 'No status' when one is missing)", () => {
  const opts = m.statusOptions(LIST);
  same(opts.map((o) => [o.value, o.label, o.count]), [["ACTIVE", "ACTIVE", 2], ["INACTIVE", "INACTIVE", 1], ["SUSPENDED", "SUSPENDED", 1], ["", "No status", 1]]);
  same(m.filterTenants(LIST, "", "INACTIVE").map((t) => t.id), [3]);
  same(m.filterTenants(LIST, "", m.NO_STATUS).map((t) => t.id), [4]);
  same(m.filterTenants(LIST, "o", "ACTIVE").map((t) => t.name), ["Acme Logistics"], "search and status combine");
  same(m.filterTenants(LIST, "blue", "INACTIVE").map((t) => t.name), []);
  same(m.statusOptions([]), [], "no list → no invented statuses");
});

test("P6 status catalogue (GET /reference/statuses): a tenant set adds documented values with count 0; anything else is ignored", () => {
  const sets = [{ name: "dispatch", values: ["PENDING"] }, { name: "Tenant", field: "TenantDto.status", values: ["ACTIVE", "INACTIVE", "ARCHIVED", 7, ""], notes: "synthetic" }];
  const set = m.tenantStatusSet(sets);
  assert.equal(set.name, "Tenant");
  const opts = m.statusOptions(LIST.slice(0, 3), set);
  same(opts.map((o) => [o.value, o.count, o.documented]), [["ACTIVE", 2, true], ["ARCHIVED", 0, true], ["INACTIVE", 1, true]]);
  assert.equal(m.tenantStatusSet([{ field: "tenant.status", values: ["A"] }]).field, "tenant.status", "matched by field");
  for (const bad of [undefined, null, "x", [], [{ name: "user", values: ["ACTIVE"] }], [{ name: "tenant", values: "ACTIVE" }]]) assert.equal(m.tenantStatusSet(bad), null, JSON.stringify(bad));
});

test("P6 missing optional fields and counts: shown as missing with a reason, never 0; real zeros kept", () => {
  const rows = Object.fromEntries(m.tenantDetailRows(LIST[3]).map((r) => [r.label, r]));
  for (const label of ["Status", "Timezone"]) assert.equal(rows[label].value, null, label);
  for (const label of ["Users", "Devices", "Drivers"]) {
    assert.equal(rows[label].value, null, `${label}: missing / null / "5" are not counts`);
    assert.match(rows[label].missing, /Not reported/);
  }
  const zero = Object.fromEntries(m.tenantDetailRows(LIST[2]).map((r) => [r.label, r.value]));
  assert.equal(zero.Devices, "0", "a real 0 stays 0");
  assert.equal(zero["Server 'current' flag"], "false");
  assert.equal(Object.fromEntries(m.tenantDetailRows({}).map((r) => [r.label, r.value]))["Tenant ID"], null);
});

test("P6 paging: client-side only (the API returns the whole list); page clamped; empty list is one empty page", () => {
  const rows = Array.from({ length: 60 }, (_, i) => i);
  same({ ...m.paginate(rows, 1) }, { rows: rows.slice(0, 25), page: 1, pages: 3, from: 1, to: 25, total: 60 });
  same(m.paginate(rows, 3).rows, rows.slice(50));
  assert.equal(m.paginate(rows, 99).page, 3);
  assert.equal(m.paginate(rows, -2).page, 1);
  same({ ...m.paginate([], 1) }, { rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
  const params = (SPEC.paths["/api/v1/platform/tenants"].get.parameters || []).map((x) => x.name);
  assert.ok(!params.some((n) => /page/i.test(n)), "V10 has no paging params for the tenant list");
});

test("P6 selectability: the page's rule agrees with the tenant store (ACTIVE or no status; valid id)", () => {
  for (const t of [...LIST, { id: 0, status: "ACTIVE" }, { status: "ACTIVE" }, { id: 9, status: " active " }]) {
    assert.equal(m.selectBlockReason(t) === null, store.tenantSelectable(t), JSON.stringify(t));
  }
  assert.match(m.selectBlockReason(LIST[2]), /INACTIVE/);
});

// ── Access control ──────────────────────────────────────────────────────────

test("P6 access: Tenant Management only for platform === true + tenant.all; denied for every tenant role", () => {
  assert.equal(p.canAccessScreen(access({ ...IDENTITIES.platformAdmin, permissions: ALL_CODES }), "tenants"), true);
  const denied = {
    tenantAdmin: IDENTITIES.tenantAdmin,
    tenantAdminWithTenantAll: { ...IDENTITIES.tenantAdmin, permissions: ALL_CODES },
    fleetOwner: IDENTITIES.fleetOwner,
    dispatcher: IDENTITIES.dispatcher,
    viewer: IDENTITIES.viewer,
    driver: IDENTITIES.driver,
    platformWithoutTenantAll: { ...IDENTITIES.platformAdmin, permissions: TENANT_CODES },
    platformFlagString: { ...IDENTITIES.platformAdmin, platform: "true" },
  };
  for (const [label, raw] of Object.entries(denied)) {
    const a = access(raw);
    assert.equal(p.canAccessScreen(a, "tenants"), false, label);
    assert.equal(p.decideRoute("authenticated", a, "/drive-vision/tenants").kind, "forbidden", label);
    assert.ok(!nav.navGroupsFor(a).some((g) => g.items.some((i) => i.screen === "tenants")), `${label}: not in nav`);
    assert.equal(p.canAccessPlatform(a), false, label);
  }
});

// ── API usage and errors (stub fetch) ───────────────────────────────────────

function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 600_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), query: Object.fromEntries(u.searchParams), headers: init.headers ?? {} });
    const out = respond(u.pathname.replace("/api/v1", ""));
    if (out === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(out[1]), { status: out[0], headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined } });
  const r = (x) => realm.require(x);
  return { calls, platform: r("features/drive-vision/api/platform-service").platformService, fleet: r("features/drive-vision/api/fleet-service").fleetService, ctx: r("features/drive-vision/api/tenant-context"), errors: r("features/drive-vision/api/errors") };
}
const hasTenantHeader = (c) => Object.keys(c.headers).some((k) => k.toLowerCase() === "x-tenant-id");

test("P6 API: the page reads GET /platform/tenants and GET /reference/statuses; the tenant list never carries a tenant header", async () => {
  const s = openRealm((p) => (p === "/platform/tenants" ? [200, { code: 200, msg: "Success", data: LIST, total: 5 }] : [200, { code: 200, msg: "Success", data: { statusSets: [] } }]));
  const list = await s.platform.tenants();
  assert.equal(list.total, 5);
  same(await s.fleet.statusCatalog(), { statusSets: [] });
  s.ctx.setTenantSelection({ tenantId: 2, code: null, name: null, header: "X-Tenant-Id" });
  await s.platform.tenants();
  same(s.calls.map((c) => `${c.method} ${c.path}`), ["GET /platform/tenants", "GET /reference/statuses", "GET /platform/tenants"]);
  assert.ok(!hasTenantHeader(s.calls[0]) && !hasTenantHeader(s.calls[2]), "platform tenant list stays platform-wide");
  for (const c of s.calls) assert.deepEqual({ ...c.query }, {}, "no query params invented");
});

test("P6 errors: 400/401/403/404/409/5xx/network reject with the server's msg + errorCode — never an empty list", async () => {
  const cases = [
    [400, "INVALID_TENANT"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "OPERATION_NOT_ALLOWED"],
    [500, "INTERNAL_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
  ];
  for (const [status, errorCode] of cases) {
    const s = openRealm(() => [status, { code: status, msg: `Synthetic ${status}`, data: null, total: null, extend: { errorCode, requestId: "req-x" } }]);
    await assert.rejects(s.platform.tenants(), (err) => {
      assert.equal(err.status, status);
      assert.equal(err.errorCode, errorCode);
      assert.equal(s.errors.describeApiError(err), `Synthetic ${status}`, "V10 envelope uses msg");
      assert.match(s.errors.apiErrorMeta(err), /req-x/);
      return true;
    });
  }
  // No msg at all: a generic message, still an error.
  const bare = openRealm(() => [403, { code: 403 }]);
  await assert.rejects(bare.platform.tenants(), (err) => /permission/i.test(bare.errors.describeApiError(err)));
  const net = openRealm(() => "network");
  await assert.rejects(net.platform.tenants(), (err) => err.kind === "network");
});

// ── No invented endpoints; shared selection state ───────────────────────────

test("P6 contract: V10 has exactly two tenant operations; the frontend adds only the backend-supplied create (POST /platform/tenants)", () => {
  const ops = Object.entries(SPEC.paths).flatMap(([p2, o]) => Object.keys(o).map((meth) => `${meth.toUpperCase()} ${p2}`)).filter((k) => /\/platform\/|\/tenants?\b/.test(k));
  same(ops.sort(), ["GET /api/v1/platform/tenants", "POST /api/v1/platform/switch-tenant"]);
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(path.join(SRC, "features", "drive-vision", "api"));
  const paths = files.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/["'`](\/(?:platform|tenants?)[^"'`]*)["'`]/g)].map((x) => x[1]));
  same([...new Set(paths)].sort(), ["/platform/switch-tenant", "/platform/tenants"]);
  // Create is the only tenant write; no update / status / delete exists anywhere.
  const svc = read("features/drive-vision/api/platform-service.ts");
  same([...svc.matchAll(/api\.(post|put|patch|delete)<[^>]*>\("([^"]+)"/g)].map((x) => `${x[1]} ${x[2]}`).sort(), ["post /platform/switch-tenant", "post /platform/tenants"]);
  const page = read("components/drive-vision/platform/tenant-management.tsx");
  assert.doesNotMatch(page, /api\.(post|put|patch|delete)|updateTenant|deleteTenant|setTenantStatus/);
  // No explanatory footnotes under the tenant list (removed on request, 2026-11-03).
  assert.doesNotMatch(page, /data-testid="tenant-unsupported"|browser tab only/);
});

test("P6 shared state: page and top-bar switcher both use the one tenant context; neither keeps its own selection", () => {
  for (const rel of ["components/drive-vision/platform/tenant-management.tsx", "components/drive-vision/app-shell/tenant-switcher.tsx"]) {
    const src = read(rel);
    assert.match(src, /useTenantContext\(\)/, rel);
    assert.match(src, /ctx\.selectTenant\(/, `${rel} switches through the context`);
    assert.doesNotMatch(src, /useState<number|setSelectedTenant|setTenantSelection/, `${rel} keeps no selection of its own`);
  }
  // After a switch from the page, the same post-switch navigation as the switcher runs.
  assert.match(read("components/drive-vision/platform/tenant-management.tsx"), /afterChange\(\)/);
  // Viewing details doesn't select: the drawer only sets local detail state.
  assert.match(read("components/drive-vision/platform/tenant-management.tsx"), /onClick=\{\(\) => setDetail\(t\)\}/);
});
