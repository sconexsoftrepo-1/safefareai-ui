// Phase 3.5 — explicit validation matrices for the V10 auth / permission implementation.
// Pure functions only; no network. Every identity below is a SYNTHETIC fixture (code-level only):
// permission codes are real V10 codes (docs/openapi/api-docs-v10.json); role codes other than
// ADMIN / DRIVER are deliberately fake (TEST_*, UNKNOWN_*) because the backend hasn't confirmed them.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { ALL_CODES, TENANT_CODES, IDENTITIES } = require("./helpers/identities.cjs");

// lucide-react icons are components; the nav code only stores them.
const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const realm = createRealm({ process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f() } });
const p = realm.require("features/drive-vision/access/access-policy");
const idm = realm.require("features/drive-vision/access/identity");
const lm = realm.require("components/drive-vision/auth/login-model");
const nav = realm.require("components/drive-vision/navigation/use-nav");

const access = (raw, policy) => p.computeAccess(idm.readIdentity(raw), policy);
const synthetic = (extra) => ({ userId: 100, homeTenantId: 10, tenantId: 10, roleId: 50, roleCode: "TEST_USER", platform: false, permissions: [], screens: [], ...extra });
const FLEET = p.ALL_SCREENS.filter((s) => s !== "myWork" && s !== "settings" && !p.SCREENS[s].platformOnly);

// ── Task 2: login request construction ──────────────────────────────────────

test("3.5/T2 login body: tenant mode carries tenantCode; admin mode has no tenantCode key at all (not '', not null)", () => {
  const form = { tenantCode: " ACME ", login: " a@b.example ", password: " pw " };
  const tenant = lm.buildLoginRequest("tenant", form);
  assert.equal(tenant.tenantCode, "ACME");
  assert.equal(tenant.password, " pw ", "password is never trimmed");

  for (const tenantCode of ["", "   ", "ACME"]) {
    const admin = lm.buildLoginRequest("platform", { ...form, tenantCode });
    assert.equal(Object.hasOwn(admin, "tenantCode"), false, `admin body with form tenantCode=${JSON.stringify(tenantCode)}`);
    assert.doesNotMatch(JSON.stringify(admin), /tenantCode|null/);
  }
  for (const tenantCode of ["", "   "]) {
    const blank = lm.buildLoginRequest("tenant", { ...form, tenantCode });
    assert.equal(Object.hasOwn(blank, "tenantCode"), false, "blank code never sent in tenant mode either");
  }
});

test("3.5/T2 switching modes changes validation: tenant code required only in tenant mode", () => {
  const form = { tenantCode: "", login: "x", password: "y" };
  assert.ok(lm.validateLogin("tenant", form).tenantCode);
  assert.equal(lm.validateLogin("platform", form).tenantCode, undefined);
  assert.deepEqual([...lm.loginFields("platform")], ["login", "password"]);
});

// ── Task 3: platform administration ─────────────────────────────────────────

test("3.5/T3 platform scenarios 1–8 (synthetic identities)", () => {
  const cases = [
    // [label, raw identity, expected kind, expected platform, expected canAccessPlatform]
    ["1 platform=true + tenant.all", synthetic({ platform: true, tenantId: null, roleCode: "ADMIN", permissions: ["tenant.all"] }), "platform-admin", true, true],
    ["2 platform=true without tenant.all", synthetic({ platform: true, tenantId: null, roleCode: "ADMIN", permissions: TENANT_CODES }), "platform-admin", true, false],
    ["3 platform=false, role ADMIN, every code incl. tenant.all", synthetic({ platform: false, roleCode: "ADMIN", permissions: ALL_CODES }), "tenant-admin", false, false],
    ["4 platform missing", (() => { const r = synthetic({ roleCode: "ADMIN", permissions: ALL_CODES }); delete r.platform; return r; })(), "tenant-admin", false, false],
    ["5 platform null", synthetic({ platform: null, roleCode: "ADMIN", permissions: ALL_CODES }), "tenant-admin", false, false],
    ["5b platform 'true' (string)", synthetic({ platform: "true", permissions: ALL_CODES }), "tenant-user", false, false],
    ["5c platform 1", synthetic({ platform: 1, permissions: ALL_CODES }), "tenant-user", false, false],
    ["6 empty permissions", synthetic({ platform: true, permissions: [] }), "platform-admin", true, false],
    ["7 malformed permissions (string)", synthetic({ platform: true, permissions: "tenant.all" }), "platform-admin", true, false],
    ["7b malformed permissions (object)", synthetic({ platform: true, permissions: { "tenant.all": true } }), "platform-admin", true, false],
    ["7c malformed entries", synthetic({ platform: true, permissions: [1, null, {}, ["tenant.all"], "", "TENANT.ALL", " tenant.all"] }), "platform-admin", true, false],
    ["8 unknown role code", synthetic({ roleCode: "UNKNOWN_ROLE", permissions: [] }), "tenant-user", false, false],
  ];
  for (const [label, raw, kind, platform, platformAdmin] of cases) {
    const a = access(raw);
    assert.equal(a.kind, kind, `${label}: kind`);
    assert.equal(a.platform, platform, `${label}: platform`);
    assert.equal(p.canAccessPlatform(a), platformAdmin, `${label}: canAccessPlatform`);
  }
});

test("3.5/T3 no permissions → no screen, not even Settings; unknown role code grants nothing", () => {
  for (const raw of [synthetic({ permissions: [] }), synthetic({ permissions: "device.read" }), synthetic({ platform: true, permissions: null }), synthetic({ roleCode: "UNKNOWN_ROLE" })]) {
    const a = access(raw);
    assert.equal(a.screens.size, 0);
    assert.equal(a.actions.size, 0);
    assert.equal(p.decideRoute("authenticated", a, p.SCREEN_ROUTES.settings).reason, "no-permissions");
  }
  for (const raw of [null, undefined, "x", 42, [], true]) assert.equal(access(raw).kind, "none");
});

test("3.5/T3 tenant ADMIN never inherits platform-only screens; Safe-Fare Admin needs the screen's code too", () => {
  const policy = { ...p.ACCESS_POLICY, screens: { ...p.SCREENS, users: { ...p.SCREENS.users, platformOnly: true, requires: { anyOf: ["tenant.all"], operations: ["GET /api/v1/platform/tenants"] } } } };
  assert.equal(access(synthetic({ roleCode: "ADMIN", permissions: ALL_CODES }), policy).screens.has("users"), false, "tenant ADMIN, even holding tenant.all");
  assert.equal(access(synthetic({ platform: true, permissions: ["device.read"] }), policy).screens.has("users"), false, "platform without tenant.all");
  assert.equal(access(synthetic({ platform: true, permissions: ["tenant.all"] }), policy).screens.has("users"), true);
});

// ── Task 4: resolver ────────────────────────────────────────────────────────

test("3.5/T4 server screens cannot grant: an allowed fleet routePath without the code opens nothing", () => {
  const raw = synthetic({
    permissions: ["report.read"],
    screens: [
      { menuKey: "dashboard", title: "Dashboard", routePath: "/dashboard", readOnly: false, operations: [{ operation: "create", permissionCode: "driver.create", allowed: true }] },
      { menuKey: "x", title: "X", routePath: "/drive-vision/users", readOnly: false, operations: [{ operation: "read", permissionCode: "user.read", allowed: true }] },
      { menuKey: "y", title: "Y", routePath: "/totally/unknown", readOnly: false, operations: [] },
    ],
  });
  const a = access(raw);
  assert.deepEqual([...a.screens].sort(), ["reports", "settings"]);
  assert.equal(p.canPerform(a, "drivers.create"), false);
  assert.deepEqual([...a.unmappedServerPaths], ["/totally/unknown"]);
});

test("3.5/T4 unknown screens and paths are never allowed", () => {
  const a = access(IDENTITIES.tenantAdmin);
  for (const path of ["/drive-vision/platform", "/drive-vision/tenants", "/drive-vision/tenant-admin", "/drive-vision/roles", "/drive-vision/overviewx", "/elsewhere", "/drive-vision/../drive-vision/users"]) {
    assert.equal(p.canAccessPath(a, path), false, path);
  }
  assert.equal(p.decideRoute("authenticated", a, "/drive-vision/tenant-admin").reason, "unknown-route");
  assert.equal(p.decideRoute("authenticated", a, "/drive-vision/tenants").reason, "no-access", "platform-only since Phase 5");
});

// ── Task 5: driver ──────────────────────────────────────────────────────────

test("3.5/T5 My Work needs a DRIVER login with own.data.read AND driver.app; nothing else opens it", () => {
  const myWork = (raw) => access(raw).screens.has("myWork");
  assert.equal(myWork(IDENTITIES.driver), true);
  assert.equal(myWork({ ...IDENTITIES.driver, permissions: ["own.data.read"] }), false, "own.data.read alone");
  assert.equal(myWork({ ...IDENTITIES.driver, permissions: ["driver.app"] }), false, "driver.app alone");
  assert.equal(myWork(synthetic({ roleCode: "ADMIN", permissions: ["own.data.read", "driver.app"] })), false, "ADMIN holding both");
  assert.equal(myWork(synthetic({ platform: true, roleCode: "DRIVER", permissions: ["own.data.read", "driver.app"] })), false, "platform + DRIVER");
  assert.equal(myWork(synthetic({ roleCode: "TEST_USER", permissions: ["own.data.read", "driver.app"] })), false, "unknown role holding both");
});

test("3.5/T5 driver: no fleet screens or actions unless explicitly granted; Settings always hidden; all six sections in nav", () => {
  const a = access(IDENTITIES.driver);
  assert.deepEqual([...a.screens], ["myWork"]);
  assert.deepEqual([...a.actions].sort(), ["account.password", "notifications.markRead"]);
  const groups = nav.navGroupsFor(a);
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(hrefs, p.DRIVER_SECTIONS.map((s) => s.href));
  assert.equal(p.canAccessPath(a, p.SCREEN_ROUTES.settings), false);

  const granted = access({ ...IDENTITIES.driver, permissions: [...IDENTITIES.driver.permissions, "alarm.read"] });
  assert.deepEqual([...granted.screens].sort(), ["alerts", "myWork", "safety"], "explicit alarm.read opens only the alarm screens");
  assert.equal(granted.screens.has("settings"), false);
  assert.equal(p.canPerform(granted, "alerts.handle"), false);
});

test("3.5/T5 driver frontend never routes to another driver's record (no fleet drivers screen without driver.read)", () => {
  const a = access(IDENTITIES.driver);
  for (const path of ["/drive-vision/drivers", "/drive-vision/drivers/2", "/drive-vision/users", "/drive-vision/workforce"]) assert.equal(p.canAccessPath(a, path), false, path);
});

// ── Task 6: operation-level matrix ──────────────────────────────────────────

const PAGES = {
  drivers: { read: "driver.read", create: ["driver.create", ["drivers.create"]], update: ["driver.update", ["drivers.update"]], delete: ["driver.delete", ["drivers.delete"]] },
  dispatch: { read: "dispatch.read", create: ["dispatch.create", ["dispatch.create"]], update: ["dispatch.update", ["dispatch.update", "swaps.decide"]], delete: null },
  workforce: { read: "workforce.read", create: ["workforce.create", ["leave.create"]], update: ["workforce.update", ["leave.decide"]], delete: null },
  users: { read: "user.read", create: ["user.create", ["users.create"]], update: ["user.update", ["users.update"]], delete: null },
};

test("3.5/T6 combinations A–D on Drivers, Dispatch, Workforce, Users (real V10 codes)", () => {
  const combos = { A: ["create", "update", "delete"].map(() => false), B: [false, true, false], C: [true, false, false], D: [false, true, true] };
  const codesFor = { A: [], B: ["update"], C: ["create"], D: ["update", "delete"] };
  for (const [screen, def] of Object.entries(PAGES)) {
    for (const [name, expected] of Object.entries(combos)) {
      const extra = codesFor[name].map((k) => def[k]?.[0]).filter(Boolean);
      const a = access(synthetic({ permissions: [def.read, ...extra] }));
      assert.equal(p.canAccessScreen(a, screen), true, `${screen}/${name}: view`);
      ["create", "update", "delete"].forEach((op, i) => {
        if (!def[op]) return; // the page has no such operation (V10 offers none the UI uses)
        for (const action of def[op][1]) assert.equal(p.canPerform(a, action), expected[i], `${screen}/${name}: ${action}`);
      });
      // No other action on this screen leaks.
      const onScreen = p.ALL_ACTIONS.filter((k) => p.ACTIONS[k].screen === screen);
      const allowed = onScreen.filter((k) => p.canPerform(a, k));
      const want = ["create", "update", "delete"].filter((op, i) => expected[i] && def[op]).flatMap((op) => def[op][1]);
      assert.deepEqual([...allowed].sort(), [...new Set(want)].sort(), `${screen}/${name}: exact action set`);
    }
  }
});

test("3.5/T6 write codes without the read code open no screen and no action", () => {
  const a = access(synthetic({ permissions: ["driver.create", "driver.update", "driver.delete", "user.create", "user.update", "dispatch.create", "workforce.update"] }));
  for (const s of ["drivers", "users", "dispatch", "workforce"]) assert.equal(p.canAccessScreen(a, s), false, s);
  assert.deepEqual([...[...a.actions].filter((k) => p.ACTIONS[k].screen !== "settings" && p.ACTIONS[k].screen !== null)], []);
});

// ── Task 7: navigation / routes ─────────────────────────────────────────────

test("3.5/T7 navigation equals route access for every fixture; missing identity exposes nothing", () => {
  for (const raw of [...Object.values(IDENTITIES), null, synthetic({ permissions: [] })]) {
    const a = access(raw);
    const navScreens = new Set(nav.navGroupsFor(a).flatMap((g) => g.items.map((i) => i.screen)));
    for (const s of p.ALL_SCREENS) assert.equal(navScreens.has(s), p.canAccessPath(a, p.SCREEN_ROUTES[s]), `${raw?.roleCode ?? "none"}: ${s}`);
  }
  const none = access(null);
  assert.equal(p.decideRoute("authenticated", none, p.SCREEN_ROUTES.settings).kind, "forbidden");
  assert.equal(p.decideRoute("unauthenticated", none, p.SCREEN_ROUTES.users).kind, "login");
  assert.equal(p.decideRoute("error", none, p.SCREEN_ROUTES.users).kind, "session-error");
  for (const s of FLEET) assert.equal(p.canAccessScreen(none, s), false);
});
