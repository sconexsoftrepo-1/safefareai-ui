// Phase 7 — global roles, permission catalogue, role-permission mapping. MOCKED / SYNTHETIC ONLY: roles,
// permissions and identities are synthetic (permission codes are real V10 codes); requests go to a stub fetch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { ALL_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const pure = createRealm({ process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f() } });
const m = pure.require("components/drive-vision/platform/role-permission-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const nav = pure.require("components/drive-vision/navigation/use-nav");
const access = (raw) => p.computeAccess(idm.readIdentity(raw));
const set = (...c) => new Set(c);

/** SYNTHETIC roles: global (no tenantId) and tenant roles. */
const ROLES = [
  { id: 1, code: "ADMIN", description: "Administrator", protectedRole: true, fullAccess: true, permissionCodes: [], assignable: true, activeUsers: 3 },
  { id: 2, code: "OPS_LEAD", description: "Operations lead", protectedRole: false, fullAccess: false, permissionCodes: ["device.read", "driver.read", "driver.read"], assignable: true, activeUsers: 0 },
  { id: 3, code: "VIEWER", description: undefined, protectedRole: false, permissionCodes: undefined, activeUsers: undefined },
  { id: 4, code: "DISPATCH_X", description: "Tenant role", tenantId: 10, protectedRole: false, permissionCodes: ["dispatch.read"], activeUsers: 1 },
];
/** SYNTHETIC catalogue. */
const CATALOG = [
  { code: "device.read", description: "Read devices", scope: "TENANT" },
  { code: "device.update", description: "Update devices", scope: "TENANT" },
  { code: "driver.read", description: "", scope: "TENANT" },
  { code: "tenant.all", description: "All tenants", scope: "PLATFORM" },
  { code: "role.manage", description: "Manage roles", scope: "PLATFORM" },
  { code: "custom.thing", description: undefined, scope: undefined },
];

// ── Global roles ────────────────────────────────────────────────────────────

test("P7 roles: global = no tenantId; tenant roles separated; search by code/description/id; flag filters", () => {
  same(m.filterRoles(ROLES, "", "global").map((r) => r.code), ["ADMIN", "OPS_LEAD", "VIEWER"]);
  same(m.filterRoles(ROLES, "", "tenant").map((r) => r.code), ["DISPATCH_X"]);
  same(m.filterRoles(ROLES, "operations", "global").map((r) => r.id), [2]);
  same(m.filterRoles(ROLES, "3", "global").map((r) => r.id), [3]);
  same(m.filterRoles(ROLES, "", "global", "protected").map((r) => r.id), [1]);
  same(m.filterRoles(ROLES, "", "global", "custom").map((r) => r.id), [2, 3]);
  same(m.filterRoles(ROLES, "", "global", "fullAccess").map((r) => r.id), [1]);
  assert.equal(m.roleScope({ tenantId: null }), "global");
  assert.equal(m.roleScope({ tenantId: 0 }), "tenant");
});

test("P7 roles: permission count — 'all' for full access, distinct server codes, null when not returned (never 0)", () => {
  assert.equal(m.permissionCount(ROLES[0]), "all");
  assert.equal(m.permissionCount(ROLES[1]), 2, "duplicates counted once");
  assert.equal(m.permissionCount(ROLES[2]), null);
  assert.equal(m.permissionCount({ permissionCodes: [] }), 0, "a real empty list is 0");
});

test("P7 roles: create/edit validation follows CreateRoleRequest / UpdateRoleRequest", () => {
  for (const ok of ["OPS", "OPS_LEAD_2", "A1"]) same(m.validateRole({ code: ok, description: "" }, "create"), {}, ok);
  for (const bad of ["", "A", "ops", "1OPS", "OPS-LEAD", "A".repeat(31)]) assert.ok(m.validateRole({ code: bad, description: "" }, "create").code, bad);
  assert.ok(m.validateRole({ code: "OPS", description: "x".repeat(201) }, "create").description);
  same(m.validateRole({ description: "x".repeat(200) }, "edit"), {}, "edit validates description only");
});

test("P7 roles: protection from server flags — protected / in use / tenant role / no id block; unknown activeUsers doesn't", () => {
  assert.match(m.roleDeleteBlock(ROLES[0]), /protected/);
  assert.match(m.roleEditBlock(ROLES[0]), /protected/);
  assert.equal(m.roleDeleteBlock(ROLES[1]), null);
  assert.equal(m.roleDeleteBlock(ROLES[2]), null, "activeUsers missing → let the backend decide");
  assert.match(m.roleDeleteBlock({ ...ROLES[1], activeUsers: 2 }), /2 active users/);
  assert.match(m.roleDeleteBlock(ROLES[3]), /Tenant roles/);
  assert.match(m.roleEditBlock(ROLES[3]), /Tenant roles/);
  assert.match(m.roleDeleteBlock({ code: "X" }), /no id/);
});

// ── Permission catalogue ────────────────────────────────────────────────────

test("P7 catalogue: search code and description; scope filter (incl. 'No scope'); prefix filter; grouping", () => {
  same(m.filterPermissions(CATALOG, "device").map((x) => x.code), ["device.read", "device.update"]);
  same(m.filterPermissions(CATALOG, "manage").map((x) => x.code), ["role.manage"]);
  same(m.filterPermissions(CATALOG, "", "PLATFORM").map((x) => x.code), ["role.manage", "tenant.all"]);
  same(m.filterPermissions(CATALOG, "", "").map((x) => x.code), ["custom.thing"]);
  same(m.filterPermissions(CATALOG, "", m.ALL, "driver").map((x) => x.code), ["driver.read"]);
  same(m.scopeOptions(CATALOG).map((o) => [o.value, o.count]), [["PLATFORM", 2], ["TENANT", 3], ["", 1]]);
  same(m.groupByPrefix(CATALOG).map((g) => [g.prefix, g.items.length]), [["custom", 1], ["device", 2], ["driver", 1], ["role", 1], ["tenant", 1]]);
  same(m.filterPermissions([{ description: "no code" }, { code: "" }], ""), [], "entries without a code are dropped");
});

test("P7 catalogue: create/edit validation follows CreatePermissionRequest / UpdatePermissionRequest", () => {
  same(m.validatePermission({ code: "report.export", description: "", scope: "TENANT" }, "create"), {});
  for (const bad of ["", "report", "Report.export", "report.", ".export", "report-x.y", `a.${"b".repeat(60)}`]) assert.ok(m.validatePermission({ code: bad, description: "", scope: "TENANT" }, "create").code, bad);
  assert.ok(m.validatePermission({ code: "a.b", description: "", scope: "GLOBAL" }, "create").scope, "only TENANT | PLATFORM (V10 pattern)");
  assert.ok(m.validatePermission({ description: "", scope: "" }, "edit").scope);
  same(m.validatePermission({ description: "x", scope: "PLATFORM" }, "edit"), {});
});

test("P7 catalogue: missing descriptions are explained, not invented; frontend usage comes from the access policy", () => {
  for (const f of ["components/drive-vision/platform/permission-catalog.tsx", "components/drive-vision/platform/role-permission-editor.tsx"]) assert.match(read(f), /No description provided by the backend\./, f);
  same(m.frontendUsage("driver.delete").map((u) => `${u.kind}:${u.key}`), ["action:drivers.delete"]);
  assert.ok(m.frontendUsage("role.read").some((u) => u.kind === "screen" && u.key === "roles"));
  same(m.frontendUsage("custom.thing"), []);
});

// ── Role-permission mapping ─────────────────────────────────────────────────

test("P7 mapping: toggling adds unassigned / removes assigned codes, undoes, never both, never duplicates", () => {
  const assigned = set("device.read");
  let pd = m.toggleCode(m.NO_CHANGES, "device.update", assigned);
  same([...pd.additions], ["device.update"]);
  pd = m.toggleCode(pd, "device.read", assigned);
  same([...pd.removals], ["device.read"]);
  pd = m.toggleCode(pd, "device.update", assigned);
  same([...pd.additions], [], "second toggle undoes");
  pd = m.toggleCode(pd, "device.read", assigned);
  same([...pd.removals], []);
});

test("P7 mapping: the plan sends only real changes, blocks unknown codes / missing permissions / >300, warns on platform scope and self-lockout", () => {
  const assigned = set("device.read", "role.manage");
  const base = { catalog: CATALOG, canAdd: true, canRemove: true, ownRole: false };
  // Duplicates and no-ops never reach the server.
  let plan = m.planChanges({ additions: set("device.read", "device.update"), removals: set("driver.read", "role.manage") }, assigned, base);
  same(plan.add, ["device.update"]);
  same(plan.remove, ["role.manage"]);
  same(plan.problems, []);
  plan = m.planChanges({ additions: set("nope.code"), removals: set() }, assigned, base);
  assert.match(plan.problems.join(), /Not in the permission catalogue: nope\.code/);
  plan = m.planChanges({ additions: set("device.update"), removals: set("device.read") }, assigned, { ...base, canAdd: false, canRemove: false });
  assert.equal(plan.problems.length, 2);
  const many = new Set(Array.from({ length: 301 }, (_, i) => `x.c${i}`));
  plan = m.planChanges({ additions: many, removals: set() }, assigned, { ...base, catalog: [...many].map((code) => ({ code })) });
  assert.match(plan.problems.join(), /300/);
  plan = m.planChanges({ additions: set("tenant.all"), removals: set() }, assigned, base);
  assert.match(plan.warnings.join(), /Platform-scope permission: tenant\.all/);
  plan = m.planChanges({ additions: set(), removals: set("role.manage") }, assigned, { ...base, ownRole: true });
  assert.match(plan.warnings.join(), /You hold this role/);
  assert.match(plan.warnings.join(), /lose frontend access/);
});

test("P7 mapping: read-only for full-access roles, editable === false, tenant roles, or before loading", () => {
  const g = ROLES[1];
  assert.equal(m.mappingEditBlock(g, { editable: true, permissionCodes: [] }), null);
  assert.equal(m.mappingEditBlock(g, { permissionCodes: [] }), null, "editable missing → not blocked; backend decides");
  assert.match(m.mappingEditBlock(g, { editable: false }), /not editable/);
  assert.match(m.mappingEditBlock(g, { fullAccess: true }), /full access/);
  assert.match(m.mappingEditBlock(ROLES[0], { editable: true }), /full access/);
  assert.match(m.mappingEditBlock(ROLES[3], { editable: true }), /Tenant roles/);
  assert.match(m.mappingEditBlock(g, undefined), /not loaded/);
});

test("P7 mapping: outcome summary — success, partial (one step failed), failed, nothing; never assumes success", () => {
  assert.equal(m.summarizeApply({ ok: true, codes: ["a.b"] }, { ok: true, codes: ["c.d"] }).status, "success");
  const partial = m.summarizeApply({ ok: true, codes: ["a.b"] }, { ok: false, codes: ["c.d"], error: new Error("x") });
  assert.equal(partial.status, "partial");
  assert.match(partial.message, /added 1; removing failed/);
  assert.equal(m.summarizeApply({ ok: false, codes: ["a.b"], error: 1 }, null).status, "failed");
  assert.equal(m.summarizeApply(null, null).status, "nothing");
  const editor = read("components/drive-vision/platform/role-permission-editor.tsx");
  // After any apply (success or not) the editor re-reads the server state and refreshes the role list.
  assert.match(editor, /Always re-read[\s\S]*rpQ\.refetch\(\);\s*onChanged\(\);/);
  assert.match(editor, /if \(saving \|\| plan\.problems\.length \|\| changeCount === 0\) return;/, "duplicate submissions and blocked plans send nothing");
});

// ── Service: platform-wide, exact contract, errors ──────────────────────────

function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 600_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), query: [...u.searchParams.entries()], headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const out = respond(u.pathname.replace("/api/v1", ""), init.method ?? "GET");
    if (out === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(out[1]), { status: out[0], headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined } });
  const r = (x) => realm.require(x);
  return { calls, roles: r("features/drive-vision/api/role-admin-service").roleAdminService, admin: r("features/drive-vision/api/admin-service").adminService, ctx: r("features/drive-vision/api/tenant-context"), errors: r("features/drive-vision/api/errors"), m: r("components/drive-vision/platform/role-permission-model") };
}
const ok = (data) => [200, { code: 200, msg: "Success", data }];
const tenantHeader = (c) => Object.keys(c.headers).some((k) => k.toLowerCase() === "x-tenant-id");

test("P7 service: every global role / catalogue call is platform-wide — no tenant header even with a tenant selected", async () => {
  const s = openRealm(() => ok({}));
  s.ctx.setTenantSelection({ tenantId: 7, code: null, name: null, header: "X-Tenant-Id" });
  await s.roles.listRoles();
  await s.roles.createRole({ code: "OPS", description: "" });
  await s.roles.updateRole(2, { description: "d" });
  await s.roles.deleteRole(2);
  await s.roles.rolePermissions(2);
  await s.roles.addRolePermissions(2, ["device.read"]);
  await s.roles.removeRolePermissions(2, ["device.read", "driver.read"]);
  await s.roles.listPermissions();
  await s.roles.createPermission({ code: "a.b", description: "", scope: "TENANT" });
  await s.roles.updatePermission("a.b", { description: "", scope: "PLATFORM" });
  await s.roles.deletePermission("a.b");
  same(s.calls.map((c) => `${c.method} ${c.path}`), [
    "GET /roles", "POST /roles", "PUT /roles/2", "DELETE /roles/2", "GET /roles/2/permissions", "POST /roles/2/permissions", "DELETE /roles/2/permissions",
    "GET /permissions", "POST /permissions", "PUT /permissions/a.b", "DELETE /permissions/a.b",
  ]);
  for (const c of s.calls) {
    assert.equal(tenantHeader(c), false, `${c.method} ${c.path}: no tenant header`);
    assert.ok(!c.query.some(([k]) => k === "tenantId"), "no tenantId query");
  }
  same(s.calls[6].query, [["codes", "device.read"], ["codes", "driver.read"]], "codes as repeated query params (OpenAPI form/explode)");
  same(s.calls[5].body, { permissionCodes: ["device.read"] });
  // The Users page keeps its tenant-scoped reads (unchanged Phase 5 behaviour).
  await s.admin.listRoles();
  assert.equal(tenantHeader(s.calls.at(-1)), true, "Users page roles read follows the selected tenant");
});

test("P7 service: backend errors surface with msg + errorCode (409 / PROTECTED_ROLE / ROLE_IN_USE / PLATFORM_PERMISSION / 403 / 404 / 5xx / network); never an empty list", async () => {
  const cases = [[409, "ROLE_CODE_TAKEN"], [409, "PROTECTED_ROLE"], [409, "ROLE_IN_USE"], [400, "PLATFORM_PERMISSION"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [503, "SERVICE_UNAVAILABLE"]];
  for (const [status, errorCode] of cases) {
    const s = openRealm(() => [status, { code: status, msg: `Synthetic ${errorCode}`, data: null, extend: { errorCode } }]);
    for (const call of [() => s.roles.listRoles(), () => s.roles.addRolePermissions(1, ["a.b"]), () => s.roles.listPermissions()]) {
      await assert.rejects(call(), (err) => err.status === status && err.errorCode === errorCode && s.errors.describeApiError(err) === `Synthetic ${errorCode}`);
    }
  }
  const net = openRealm(() => "network");
  await assert.rejects(net.roles.listRoles(), (err) => err.kind === "network");
});

test("P7 apply sequence: add ok + remove 409 → partial, and the follow-up read is the server's truth", async () => {
  let state = ["device.read"];
  const s = openRealm((pathname, method) => {
    if (method === "POST") { state = [...state, "device.update"]; return ok({ permissionCodes: state }); }
    if (method === "DELETE") return [409, { code: 409, msg: "Synthetic conflict", data: null, extend: { errorCode: "OPERATION_NOT_ALLOWED" } }];
    return ok({ permissionCodes: state, editable: true });
  });
  let added = null, removed = null;
  try { await s.roles.addRolePermissions(2, ["device.update"]); added = { ok: true, codes: ["device.update"] }; } catch (error) { added = { ok: false, codes: ["device.update"], error }; }
  try { await s.roles.removeRolePermissions(2, ["device.read"]); removed = { ok: true, codes: ["device.read"] }; } catch (error) { removed = { ok: false, codes: ["device.read"], error }; }
  assert.equal(s.m.summarizeApply(added, removed).status, "partial");
  same((await s.roles.rolePermissions(2)).permissionCodes, ["device.read", "device.update"], "server state after the partial save");
});

// ── Access control ──────────────────────────────────────────────────────────

const SFA = { userId: 1, platform: true, homeTenantId: null, tenantId: null, roleId: 1, roleCode: "ADMIN", permissions: ALL_CODES, screens: [] };
const PLATFORM_SCREENS = ["roles", "permissions"];
const PLATFORM_ACTIONS = ["roles.create", "roles.update", "roles.delete", "rolePermissions.add", "rolePermissions.remove", "permissions.create", "permissions.update", "permissions.delete"];

test("P7 access: only the Safe-Fare Admin reaches Global Roles / Permission Catalogue and their actions", () => {
  const a = access(SFA);
  for (const s of PLATFORM_SCREENS) {
    assert.equal(p.canAccessScreen(a, s), true, s);
    assert.equal(p.decideRoute("authenticated", a, p.SCREEN_ROUTES[s]).kind, "allow");
  }
  for (const act of PLATFORM_ACTIONS) assert.equal(p.canPerform(a, act), true, act);
  for (const w of ["roles.permissions", "permissions.catalog"]) assert.equal(p.canViewWidget(a, w), true, w);
  const navScreens = nav.navGroupsFor(a).flatMap((g) => g.items.map((i) => i.screen));
  for (const s of PLATFORM_SCREENS) assert.ok(navScreens.includes(s));
  // All-tenants mode doesn't block platform configuration (it has no tenant).
  assert.equal(a.tenantBlockedActions.size > 0, true);
  for (const act of PLATFORM_ACTIONS) assert.equal(a.tenantBlockedActions.has(act), false, act);
});

test("P7 access: denied for tenant ADMIN (even with every code), Fleet Owner, Operator, Dispatcher, Viewer, Driver, platform=false ADMIN", () => {
  const denied = {
    tenantAdmin: IDENTITIES.tenantAdmin,
    tenantAdminAllCodes: { ...IDENTITIES.tenantAdmin, permissions: ALL_CODES },
    platformFalseAdmin: { ...SFA, platform: false },
    platformMissing: (() => { const x = { ...SFA }; delete x.platform; return x; })(),
    fleetOwner: IDENTITIES.fleetOwner,
    operator: { ...IDENTITIES.fleetOwner, roleCode: "TEST_OPERATOR", permissions: ["device.read", "track.read", "role.read", "role.permission.read"] },
    dispatcher: IDENTITIES.dispatcher,
    viewer: IDENTITIES.viewer,
    driver: IDENTITIES.driver,
  };
  for (const [label, raw] of Object.entries(denied)) {
    const a = access(raw);
    for (const s of PLATFORM_SCREENS) {
      assert.equal(p.canAccessScreen(a, s), false, `${label}: ${s}`);
      assert.equal(p.decideRoute("authenticated", a, p.SCREEN_ROUTES[s]).kind, "forbidden", `${label}: route ${s}`);
    }
    for (const act of PLATFORM_ACTIONS) assert.equal(p.canPerform(a, act), false, `${label}: ${act}`);
    for (const w of ["roles.permissions", "permissions.catalog"]) assert.equal(p.canViewWidget(a, w), false, `${label}: widget ${w}`);
    assert.ok(!nav.navGroupsFor(a).some((g) => g.items.some((i) => PLATFORM_SCREENS.includes(i.screen))), `${label}: nav`);
  }
});

test("P7 access: platform=true but missing the precise code → that screen / action / widget denied (fail closed)", () => {
  const without = (...codes) => access({ ...SFA, permissions: ALL_CODES.filter((c) => !codes.includes(c)) });
  assert.equal(p.canAccessScreen(without("role.read"), "roles"), false);
  assert.equal(p.canAccessScreen(without("permission.manage"), "permissions"), false);
  const noManage = without("role.manage");
  assert.equal(p.canAccessScreen(noManage, "roles"), true, "read-only roles screen");
  for (const act of ["roles.create", "roles.update", "roles.delete"]) assert.equal(p.canPerform(noManage, act), false, act);
  assert.equal(p.canPerform(without("role.permission.create"), "rolePermissions.add"), false);
  assert.equal(p.canPerform(without("role.permission.delete"), "rolePermissions.remove"), false);
  assert.equal(p.canViewWidget(without("role.permission.read"), "roles.permissions"), false);
  assert.equal(p.canViewWidget(without("role.permission.read", "permission.manage"), "permissions.catalog"), false);
  assert.equal(p.canPerform(without("permission.manage"), "permissions.create"), false);
});

test("P7 routes: the platform routePaths from GET /me/permissions map to the new screens", () => {
  same(p.routeForServerPath("/platform/roles"), { screen: "roles", href: "/drive-vision/platform/roles" });
  same(p.routeForServerPath("/platform/permissions"), { screen: "permissions", href: "/drive-vision/platform/permissions" });
  same(p.routeForServerPath("/tenants"), { screen: "tenants", href: "/drive-vision/tenants" });
  assert.equal(p.screenForPath("/drive-vision/platform/roles"), "roles", "longest prefix wins over the platform dashboard");
  assert.equal(p.screenForPath("/drive-vision/platform"), "platform");
});

test("P7 regression: platform screens use only the platform-wide service; the Users page keeps its own reads", () => {
  for (const f of ["global-roles.tsx", "role-permission-editor.tsx", "permission-catalog.tsx", "role-permission-matrix.tsx"]) {
    const src = read(`components/drive-vision/platform/${f}`);
    assert.doesNotMatch(src, /adminService/, `${f} uses the tenant-scoped admin service`);
    assert.doesNotMatch(src, /permissions\.has|roleCode|\.platform\s*===/, `${f} has its own permission logic`);
  }
  assert.match(read("components/drive-vision/users/users-page.tsx"), /adminService\.listRoles\(\)/);
  assert.doesNotMatch(read("components/drive-vision/users/users-page.tsx"), /roleAdminService|addRolePermissions|removeRolePermissions/, "no permission editing on the tenant Users page");
  const svc = read("features/drive-vision/api/role-admin-service.ts");
  const calls = [...svc.matchAll(/api\.(get|post|put|delete)</g)].length;
  const platform = [...svc.matchAll(/PLATFORM\b|\.\.\.PLATFORM/g)].length;
  assert.ok(calls === 12 && platform >= 12, `every one of the 12 calls passes tenant:"none" (${calls} calls)`);
});

// ── Phase 7 UI enhancement: checkbox-based selection ────────────────────────

const RIGHTS = { locked: false, canAdd: true, canRemove: true };
const ASSIGNED = set("alarm.read", "alarm.handle", "device.read");
const ALARM = ["alarm.read", "alarm.handle", "alarm.rule.create", "alarm.rule.update", "alarm.rule.delete"];
const DEVICE = ["device.read", "device.create", "device.update", "device.delete"];
const sorted = (s) => [...s].sort();

test("P7-UI checkboxes: assigned codes start checked, unassigned unchecked; changes stay pending until save", () => {
  same(sorted(m.desiredSelection(ASSIGNED, m.NO_CHANGES)), sorted(ASSIGNED));
  let pd = m.setCodes(m.NO_CHANGES, ["alarm.rule.create"], true, ASSIGNED, RIGHTS);
  same([...pd.additions], ["alarm.rule.create"], "checking an unchecked code → pending addition");
  pd = m.setCodes(pd, ["device.read"], false, ASSIGNED, RIGHTS);
  same([...pd.removals], ["device.read"], "unchecking an assigned code → pending removal");
  same(sorted(m.desiredSelection(ASSIGNED, pd)), ["alarm.handle", "alarm.read", "alarm.rule.create"]);
  // Re-checking / re-unchecking undoes, never duplicates.
  pd = m.setCodes(pd, ["device.read"], true, ASSIGNED, RIGHTS);
  pd = m.setCodes(pd, ["alarm.rule.create", "alarm.rule.create"], false, ASSIGNED, RIGHTS);
  same({ a: [...pd.additions], r: [...pd.removals] }, { a: [], r: [] });
});

test("P7-UI Select all / Deselect all and module-level selection", () => {
  const every = [...ALARM, ...DEVICE];
  let pd = m.setCodes(m.NO_CHANGES, every, true, ASSIGNED, RIGHTS);
  same(sorted(pd.additions), sorted(every.filter((c) => !ASSIGNED.has(c))), "Select all adds only unassigned codes");
  assert.equal(pd.removals.size, 0);
  pd = m.setCodes(m.NO_CHANGES, every, false, ASSIGNED, RIGHTS);
  same(sorted(pd.removals), sorted(ASSIGNED), "Deselect all removes only assigned codes");
  pd = m.setCodes(m.NO_CHANGES, ALARM, true, ASSIGNED, RIGHTS);
  same(sorted(pd.additions), ["alarm.rule.create", "alarm.rule.delete", "alarm.rule.update"], "module select touches that module only");
  pd = m.setCodes(pd, DEVICE, false, ASSIGNED, RIGHTS);
  same([...pd.removals], ["device.read"]);
  same(sorted(pd.additions), ["alarm.rule.create", "alarm.rule.delete", "alarm.rule.update"], "deselecting another module keeps the first module's picks");
});

test("P7-UI group state: all / none / some (indeterminate), and the group checkbox renders it", () => {
  assert.equal(m.groupState(ALARM, m.desiredSelection(ASSIGNED, m.NO_CHANGES)), "some");
  assert.equal(m.groupState(DEVICE.slice(1), ASSIGNED), "none");
  assert.equal(m.groupState(["alarm.read", "alarm.handle"], ASSIGNED), "all");
  assert.equal(m.groupState([], ASSIGNED), "none");
  const editor = read("components/drive-vision/platform/role-permission-editor.tsx");
  assert.match(editor, /ref\.current\.indeterminate = state === "some"/);
  assert.match(editor, /aria-checked=\{state === "some" \? "mixed" : state === "all"\}/);
});

test("P7-UI search / filters never change the selection (only what's shown)", () => {
  // A bulk action on the shown subset leaves pending picks outside it untouched.
  let pd = m.setCodes(m.NO_CHANGES, ["device.update"], true, ASSIGNED, RIGHTS);
  pd = m.setCodes(pd, ["alarm.rule.create"], true, ASSIGNED, RIGHTS); // e.g. "Select shown" with search "alarm.rule.create"
  same(sorted(pd.additions), ["alarm.rule.create", "device.update"]);
  const editor = read("components/drive-vision/platform/role-permission-editor.tsx");
  assert.match(editor, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/, "search only sets the query");
  assert.match(editor, /Search and the view filter only change what's shown; pending changes are never touched by them\./);
});

test("P7-UI protected / non-editable / missing rights: neither single nor bulk selection can change them", () => {
  const locked = { locked: true, canAdd: true, canRemove: true };
  const before = { additions: set("x.y"), removals: set() };
  assert.equal(m.setCodes(before, [...ALARM, ...DEVICE], true, ASSIGNED, locked), before, "locked role (full access / editable=false / tenant role) changes nothing");
  assert.equal(m.setCodes(before, [...ALARM, ...DEVICE], false, ASSIGNED, locked), before);
  let pd = m.setCodes(m.NO_CHANGES, [...ALARM, ...DEVICE], true, ASSIGNED, { ...RIGHTS, canAdd: false });
  assert.equal(pd.additions.size, 0, "without role.permission.create, Select all adds nothing");
  pd = m.setCodes(m.NO_CHANGES, [...ALARM, ...DEVICE], false, ASSIGNED, { ...RIGHTS, canRemove: false });
  assert.equal(pd.removals.size, 0, "without role.permission.delete, Deselect all removes nothing");
  assert.equal(m.codeEditable("device.read", ASSIGNED, { ...RIGHTS, canRemove: false }), false);
  assert.equal(m.codeEditable("device.create", ASSIGNED, { ...RIGHTS, canAdd: false }), false);
  assert.equal(m.codeEditable("device.create", ASSIGNED, locked), false);
  assert.equal(m.codeEditable("device.create", ASSIGNED, RIGHTS), true);
  // The UI derives `locked` from the existing read-only rules.
  assert.match(read("components/drive-vision/platform/role-permission-editor.tsx"), /locked: block !== null \|\| saving/);
});

test("P7-UI review: exact additions / removals from the checkbox selection; failed / partial saves keep what wasn't accepted", () => {
  let pd = m.setCodes(m.NO_CHANGES, ALARM, true, ASSIGNED, RIGHTS);
  pd = m.setCodes(pd, ["alarm.rule.delete", "device.read"], false, ASSIGNED, RIGHTS);
  const plan = m.planChanges(pd, ASSIGNED, { catalog: [...ALARM, ...DEVICE].map((code) => ({ code })), canAdd: true, canRemove: true, ownRole: false });
  same(plan.add, ["alarm.rule.create", "alarm.rule.update"]);
  same(plan.remove, ["device.read"]);
  const ok = (codes) => ({ ok: true, codes });
  const ko = (codes) => ({ ok: false, codes, error: new Error("x") });
  same(sorted(m.pendingAfterApply(pd, ok(plan.add), ok(plan.remove)).additions), [], "success clears");
  const partial = m.pendingAfterApply(pd, ok(plan.add), ko(plan.remove));
  same({ a: [...partial.additions], r: [...partial.removals] }, { a: [], r: ["device.read"] }, "partial keeps only the failed removal");
  const failed = m.pendingAfterApply(pd, ko(plan.add), ko(plan.remove));
  same({ a: sorted(failed.additions), r: [...failed.removals] }, { a: ["alarm.rule.create", "alarm.rule.update"], r: ["device.read"] }, "failure keeps everything");
});

test("P7-UI save path: existing add / remove operations only (no replace-all), then a backend re-read", () => {
  const editor = read("components/drive-vision/platform/role-permission-editor.tsx");
  assert.match(editor, /roleAdminService\.addRolePermissions\(id, plan\.add\)/);
  assert.match(editor, /roleAdminService\.removeRolePermissions\(id, plan\.remove\)/);
  assert.doesNotMatch(editor, /replace|api\.put|PUT \/roles/i);
  assert.match(editor, /setPending\(\(p\) => pendingAfterApply\(p, added, removed\)\)/, "pending changes survive failures");
  assert.match(editor, /Always re-read[\s\S]*rpQ\.refetch\(\);\s*onChanged\(\);/);
  // The full-replace PUT exists only for the Permission Catalogue's role matrix, never the Global Roles editor.
  assert.match(read("features/drive-vision/api/role-admin-service.ts"), /async replaceRolePermissions\(id: number, permissionCodes: string\[\]\)[\s\S]*?api\.put<RolePermissionsDto>\(`\/roles\/\$\{id\}\/permissions`, \{ permissionCodes \}, PLATFORM\)/);
  assert.match(read("components/drive-vision/platform/role-permission-matrix.tsx"), /roleAdminService\.replaceRolePermissions\(roleId, request\.permissionCodes\)/);
});

// ── Permission Catalogue: role × module matrix (full-replace save) ──────────

test("Matrix: module = code minus its last segment; create/update/delete/read become Add/Edit/Delete/View, the rest Other", () => {
  same(m.permissionModule("alarm.rule.create"), { module: "alarm.rule", action: "create" });
  same(m.permissionModule("device.read"), { module: "device", action: "read" });
  same(m.permissionModule("solo"), { module: "solo", action: "" });
  assert.equal(m.moduleLabel("alarm.rule"), "Alarm rule");
  assert.equal(m.moduleLabel("own.data"), "Own data");
  const rows = m.buildPermissionMatrix(["alarm.read", "alarm.handle", ...ALARM.slice(2), "device.read", "device.update", "tenant.all", "device.read"]);
  same(rows.map((r) => r.module), ["alarm", "alarm.rule", "device", "tenant"]);
  const alarm = rows[0];
  same(alarm.cells, { read: "alarm.read" });
  same(alarm.others, ["alarm.handle"]);
  same(rows[1].cells, { create: "alarm.rule.create", update: "alarm.rule.update", delete: "alarm.rule.delete" });
  same(rows[2].codes, ["device.read", "device.update"], "duplicates dropped");
  same(rows[3].others, ["tenant.all"]);
  same(m.filterMatrix(rows, "rule").map((r) => r.module), ["alarm.rule"]);
  same(m.filterMatrix(rows, "handle").map((r) => r.module), ["alarm"]);
  assert.equal(m.filterMatrix(rows, " ").length, 4);
});

test("Matrix save body: the whole selection (assigned − removals + additions), sorted; > 300 codes blocks", () => {
  const pending = { additions: set("device.create"), removals: set("alarm.handle") };
  const r = m.replaceRequest(ASSIGNED, pending);
  same(r.permissionCodes, ["alarm.read", "device.create", "device.read"]);
  same(r.problems, []);
  same(m.replaceRequest(set(), m.NO_CHANGES).permissionCodes, [], "an empty list is a valid full replace");
  const many = new Set(Array.from({ length: 301 }, (_, i) => `x.c${i}`));
  assert.equal(m.replaceRequest(many, m.NO_CHANGES).problems.length, 1);
});

test("Matrix access: saving needs role.permission.update on the Permission Catalogue screen; platform-wide, never tenant-blocked", () => {
  const def = p.ACTIONS["rolePermissions.replace"];
  assert.equal(def.screen, "permissions");
  assert.equal(def.tenantWrite, false);
  same([...def.requires.anyOf], ["role.permission.update"]);
  same([...def.requires.operations], ["PUT /api/v1/roles/{id}/permissions"]);
  const a = access(SFA);
  assert.equal(p.canPerform(a, "rolePermissions.replace"), true);
  assert.equal(a.tenantBlockedActions.has("rolePermissions.replace"), false);
  assert.equal(p.canPerform(access({ ...SFA, permissions: ALL_CODES.filter((c) => c !== "role.permission.update") }), "rolePermissions.replace"), false);
  assert.equal(p.canPerform(access({ ...IDENTITIES.tenantAdmin, permissions: ALL_CODES }), "rolePermissions.replace"), false, "tenant ADMIN never");
});

test("Matrix UI: role first, then the catalogue and the role's permissions; save reviews, then PUTs the full list", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /useApiQuery\(roleId !== null \? "platform-permissions:list" : null/, "catalogue loads only after a role is chosen");
  assert.match(ui, /roleAdminService\.rolePermissions\(roleId!\)/);
  assert.match(ui, /canPerform\(access, "rolePermissions\.replace"\)/);
  assert.match(ui, /locked: block !== null \|\| !canReplace \|\| saving/, "locked roles, missing rights and in-flight saves freeze the boxes");
  assert.match(ui, /onConfirm=\{save\}/, "save goes through the review dialog");
  assert.match(ui, /setPending\(NO_CHANGES\);\s*assignedQ\.refetch\(\);/, "success re-reads the server's list");
  const page = read("components/drive-vision/platform/permission-catalog.tsx");
  assert.match(page, /useState<"roles" \| "catalogue">\("roles"\)/, "Role permissions is the default view");
  assert.match(page, /\{tab === "roles" \? <RolePermissionMatrix \/> : null\}/);
});
