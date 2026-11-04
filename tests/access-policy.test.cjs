// Access resolver mechanics (V10): identity parsing, deny-by-default, exact codes only, route decisions,
// navigation ⇔ route agreement, search filtering. Pure functions; no network.
// Role scenarios and the registry ↔ spec cross-check are in access-v10.test.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const realm = createRealm({ process: { env: {} } });
const policy = realm.require("features/drive-vision/access/access-policy");
const idm = realm.require("features/drive-vision/access/identity");
const { ALL_SCREENS, NO_ACCESS, SCREEN_ROUTES, computeAccess, screenForPath, canAccessPath, canUseFeature, homeScreen, filterNavGroups, decideRoute, visibleSearchResults } = policy;
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const list = (set) => [...set].sort();
const access = (raw) => computeAccess(idm.readIdentity(raw));
const withPerms = (permissions, extra = {}) => access({ platform: false, roleCode: "TEST_ROLE", tenantId: 1, permissions, ...extra });

// ── Identity parsing ────────────────────────────────────────────────────────

test("identity: V10 fields are read exactly; platform is true only for a literal true", () => {
  const i = idm.readIdentity({ userId: 7, platform: true, homeTenantId: 3, tenantId: 4, roleId: 2, roleCode: "ADMIN", permissions: ["a", "b", "a"], screens: [] });
  same({ ...i, permissions: list(i.permissions) }, { userId: 7, platform: true, homeTenantId: 3, tenantId: 4, roleId: 2, roleCode: "ADMIN", permissions: ["a", "b"], screens: [] });
  for (const platform of [undefined, null, false, "true", 1, "yes", {}, [true]]) assert.equal(idm.readIdentity({ platform }).platform, false, JSON.stringify(platform));
});

test("identity: missing or malformed payload → no identity → no access", () => {
  for (const raw of [null, undefined, "x", 5, [], [{ platform: true }], true]) {
    assert.equal(idm.readIdentity(raw), null, JSON.stringify(raw));
    same(list(access(raw).screens), []);
    assert.equal(access(raw), NO_ACCESS);
  }
});

test("identity: permissions are read defensively", () => {
  const p = (permissions) => list(idm.readIdentity({ permissions }).permissions);
  same(p(["a", "b", "a"]), ["a", "b"]);
  same(p(undefined), []);
  same(p(null), []);
  same(p("a,b"), []);
  same(p({ 0: "a" }), []);
  same(p(["a", 1, null, "", { code: "b" }]), ["a"]);
});

test("identity: ids must be safe integers; role code must be a non-empty string", () => {
  const i = idm.readIdentity({ userId: "1", tenantId: 1.5, homeTenantId: NaN, roleId: 2 ** 60, roleCode: "  " });
  same([i.userId, i.tenantId, i.homeTenantId, i.roleId, i.roleCode], [null, null, null, null, null]);
});

test("identity: screens and operations parsed defensively; only allowed: true allows", () => {
  const i = idm.readIdentity({
    screens: [
      { menuKey: "k", title: " T ", routePath: "/x", readOnly: true, operations: [{ operation: "CREATE", permissionCode: "c", allowed: true }, { operation: "DELETE", permissionCode: "d" }, { operation: "", allowed: true }, "junk"] },
      null,
      "s",
      { readOnly: "yes" },
    ],
  });
  same(i.screens, [
    { menuKey: "k", title: "T", routePath: "/x", icon: null, readOnly: true, operations: [{ operation: "CREATE", permissionCode: "c", allowed: true }, { operation: "DELETE", permissionCode: "d", allowed: false }] },
    { menuKey: null, title: null, routePath: null, icon: null, readOnly: false, operations: [] },
  ]);
});

// ── Deny by default ─────────────────────────────────────────────────────────

test("no identity or an empty permission set → no screens, no features, no actions", () => {
  for (const a of [NO_ACCESS, access({}), withPerms([]), access({ platform: true, roleCode: "ADMIN" })]) {
    same(list(a.screens), []);
    same(list(a.features), []);
    same(list(a.actions), []);
    assert.equal(homeScreen(a), null);
  }
});

test("only unrecognised codes → just the signed-in screen (Settings) and own-account actions", () => {
  const a = withPerms(["devices:read", "alarms:read", "*", "admin", "ALL"]);
  same(list(a.screens), ["settings"]);
  same(list(a.features), []);
  same(list(a.actions), ["account.password", "notifications.markRead", "settings.manage"]);
});

test("a role code alone grants nothing — ADMIN, PLATFORM_ADMIN, SUPER_ADMIN, DRIVER without permissions", () => {
  for (const roleCode of ["ADMIN", "PLATFORM_ADMIN", "SUPER_ADMIN", "DRIVER", "FLEET_OWNER"]) {
    for (const platform of [false, true]) {
      const a = access({ roleCode, platform, permissions: [] });
      same(list(a.screens), [], `${roleCode} platform=${platform}`);
      same(list(a.actions), [], `${roleCode} platform=${platform}`);
    }
  }
});

test("only exact permission codes grant; look-alikes don't", () => {
  same(list(withPerms(["alarm.read"]).screens), ["alerts", "safety", "settings"]);
  for (const code of [" alarm.read", "alarm.read ", "ALARM.READ", "alarm", "alarm.read.extra", "alarm.*", "*", "alarm:read"]) {
    same(list(withPerms([code]).screens), ["settings"], code);
  }
});

test("prototype-chain and non-string codes never grant", () => {
  for (const code of ["constructor", "hasOwnProperty", "__proto__", "valueOf", "toString"]) same(list(withPerms([code]).screens), ["settings"], code);
  same(list(withPerms([["device.read"]]).screens), []);
  same(list(withPerms([{ toString: () => "device.read" }]).screens), []);
  same(list(access({ roleCode: { toString: () => "ADMIN" }, permissions: ["device.read"] }).screens).includes("overview"), true);
  assert.equal(access({ roleCode: ["ADMIN"], permissions: [] }).roleCode, null);
});

test("server screens never widen access: an unmapped or foreign routePath opens nothing", () => {
  const a = withPerms(["alarm.read"], { screens: [{ routePath: "/drive-vision/users", title: "Users" }, { routePath: "/dashboard" }, { routePath: "/admin/everything" }] });
  same(list(a.screens), ["alerts", "safety", "settings"]);
  same([...a.unmappedServerPaths], ["/admin/everything"]);
  same(a.serverScreens, []);
});

// ── Routes ──────────────────────────────────────────────────────────────────

test("screenForPath matches whole segments and nested routes", () => {
  assert.equal(screenForPath("/drive-vision/overview"), "overview");
  assert.equal(screenForPath("/drive-vision/overview/"), "overview");
  assert.equal(screenForPath("/drive-vision/vehicles/123"), "vehicles");
  assert.equal(screenForPath("/drive-vision/vehicles/new"), "vehicles");
  assert.equal(screenForPath("/drive-vision/devices/commands"), "commands");
  assert.equal(screenForPath("/drive-vision/drivers?driver=d1"), "drivers");
  assert.equal(screenForPath("/drive-vision/workforce?tab=leave"), "workforce");
  assert.equal(screenForPath("/drive-vision/my-work/shifts"), "myWork");
  assert.equal(screenForPath("/drive-vision/overviewx"), null);
  assert.equal(screenForPath("/drive-vision/devices"), null);
  assert.equal(screenForPath("/drive-vision"), null);
  assert.equal(screenForPath("/drive-vision/unknown"), null);
  assert.equal(screenForPath("/other/overview"), null);
});

test("decideRoute: authentication first, then deny by default", () => {
  const admin = access(IDENTITIES.tenantAdmin);
  const none = withPerms([]);
  same(decideRoute("unknown", admin, "/drive-vision/alerts"), { kind: "checking" });
  same(decideRoute("unauthenticated", NO_ACCESS, "/drive-vision/alerts"), { kind: "login", next: "/drive-vision/alerts" });
  same(decideRoute("error", admin, "/drive-vision/alerts"), { kind: "session-error" });
  same(decideRoute("authenticated", admin, "/drive-vision/vehicles/9"), { kind: "allow", screen: "vehicles" });
  same(decideRoute("authenticated", admin, "/drive-vision/nope"), { kind: "forbidden", screen: null, reason: "unknown-route" });
  // Signed in with no identity at all → no permissions.
  same(decideRoute("authenticated", NO_ACCESS, "/drive-vision/overview"), { kind: "forbidden", screen: "overview", reason: "no-permissions" });
  // An identity with an empty permission set opens nothing (not even Settings) → no permissions.
  same(decideRoute("authenticated", none, "/drive-vision/overview"), { kind: "forbidden", screen: "overview", reason: "no-permissions" });
  same(decideRoute("authenticated", none, "/drive-vision/settings"), { kind: "forbidden", screen: "settings", reason: "no-permissions" });
  // Some screen allowed, this one not → no access.
  same(decideRoute("authenticated", withPerms(["alarm.read"]), "/drive-vision/overview"), { kind: "forbidden", screen: "overview", reason: "no-access" });
  const alertsOnly = withPerms(["alarm.read"]);
  same(decideRoute("authenticated", alertsOnly, "/drive-vision/alerts"), { kind: "allow", screen: "alerts" });
  same(decideRoute("authenticated", alertsOnly, "/drive-vision/users"), { kind: "forbidden", screen: "users", reason: "no-access" });
  assert.equal(homeScreen(alertsOnly), "alerts");
  assert.equal(canAccessPath(alertsOnly, "/drive-vision/alerts?alarm=1"), true);
  assert.equal(canAccessPath(alertsOnly, "/drive-vision/vehicles/1"), false);
});

test("landing redirect: only from the generic landing pages, and only to an allowed screen", () => {
  const alertsOnly = withPerms(["alarm.read"]);
  assert.equal(policy.landingRedirect(alertsOnly, "/drive-vision"), "/drive-vision/alerts");
  assert.equal(policy.landingRedirect(alertsOnly, "/drive-vision/overview/"), "/drive-vision/alerts");
  assert.equal(policy.landingRedirect(alertsOnly, "/drive-vision/users"), null);
  assert.equal(policy.landingRedirect(access(IDENTITIES.tenantAdmin), "/drive-vision/overview"), null);
  assert.equal(policy.landingRedirect(NO_ACCESS, "/drive-vision/overview"), null);
});

// ── Navigation ──────────────────────────────────────────────────────────────

test("navigation shows only permitted items and drops empty groups", () => {
  const groups = [
    { label: "Overview", items: [{ screen: "overview" }] },
    { label: "Safety", items: [{ screen: "alerts" }, { screen: "safety" }] },
    { label: "Admin", items: [{ screen: "users" }, { screen: "settings" }] },
  ];
  same(filterNavGroups(groups, access(IDENTITIES.tenantAdmin)), groups);
  same(filterNavGroups(groups, withPerms(["alarm.read"])), [
    { label: "Safety", items: [{ screen: "alerts" }, { screen: "safety" }] },
    { label: "Admin", items: [{ screen: "settings" }] },
  ]);
  same(filterNavGroups(groups, NO_ACCESS), []);
});

test("every nav route in the app maps to a screen in the policy", () => {
  for (const screen of ALL_SCREENS) assert.equal(screenForPath(SCREEN_ROUTES[screen]), screen, screen);
});

test("navigation and route authorisation agree for every screen and identity", () => {
  const groups = [{ label: "All", items: ALL_SCREENS.map((screen) => ({ screen })) }];
  const samples = [NO_ACCESS, withPerms([]), withPerms(["alarm.read", "driver.read"]), ...Object.values(IDENTITIES).map(access)];
  for (const a of samples) {
    const inNav = filterNavGroups(groups, a).flatMap((g) => g.items.map((i) => i.screen)).sort();
    const routable = ALL_SCREENS.filter((s) => decideRoute("authenticated", a, SCREEN_ROUTES[s]).kind === "allow").sort();
    same(inNav, routable);
  }
});

// ── Search ──────────────────────────────────────────────────────────────────

test("search hides records and pages the user can't open; records need the recordSearch feature", () => {
  const pages = [{ href: "/drive-vision/alerts" }, { href: "/drive-vision/users" }];
  const records = [{ href: "/drive-vision/vehicles/v1" }, { href: "/drive-vision/drivers?driver=d1" }, { href: "/drive-vision/alerts?alarm=a1" }, { href: null }];
  same(visibleSearchResults(access(IDENTITIES.tenantAdmin), pages, records), { pages, records: records.slice(0, 3) });
  same(visibleSearchResults(NO_ACCESS, pages, records), { pages: [], records: [] });
  // alarm.read opens Alerts, but record search needs device.read (GET /search).
  const alertsOnly = withPerms(["alarm.read"]);
  assert.equal(canUseFeature(alertsOnly, "recordSearch"), false);
  same(visibleSearchResults(alertsOnly, pages, records), { pages: [{ href: "/drive-vision/alerts" }], records: [] });
  // With the feature, records still need an openable target screen.
  const searcher = withPerms(["alarm.read", "device.read"]);
  same(visibleSearchResults(searcher, pages, records).records, [{ href: "/drive-vision/vehicles/v1" }, { href: "/drive-vision/alerts?alarm=a1" }]);
  same(visibleSearchResults(access(IDENTITIES.tenantAdmin), [{ href: "/drive-vision/nope" }], [{ href: "https://evil.test/drive-vision/alerts" }]), { pages: [], records: [] });
});
