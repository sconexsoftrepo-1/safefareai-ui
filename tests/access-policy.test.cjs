const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const policy = realm.require("features/drive-vision/access/access-policy");
const { ACCESS_POLICY, ALL_SCREENS, NO_ACCESS, computeAccess, resolveAppRole, readPermissions, readMenuRouteKeys, screenForPath, canAccessPath, canUseFeature, homeScreen, filterNavGroups, decideRoute, visibleSearchResults, SCREEN_ROUTES } = policy;
// Values cross the vm boundary; compare structurally via JSON.
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const list = (set) => [...set].sort();

const admin = { id: 1, displayName: "Admin", role: { id: 1, code: "PLATFORM_ADMIN", description: "Platform administrator" }, permissions: ["X"] };

/** A test-only policy. Codes here are fixtures, not claims about the backend. */
function testPolicy(overrides = {}) {
  return {
    roleCodes: { PLATFORM_ADMIN: "admin", TEST_DRIVER: "driver" },
    roleGrants: {
      admin: { screens: ALL_SCREENS, features: ["assistant", "recordSearch"] },
      "fleet-owner": { screens: [], features: [] },
      driver: { screens: ["settings"], features: [] },
      unknown: { screens: [], features: [] },
    },
    screenGrants: { alerts: { permissions: ["perm.alerts.read"] }, trips: { menuRouteKeys: ["trips"] } },
    ...overrides,
  };
}

// ── Default policy: nothing guessed ─────────────────────────────────────────

test("default policy maps only the confirmed PLATFORM_ADMIN code and grants nothing else", () => {
  same(Object.keys(ACCESS_POLICY.roleCodes), ["PLATFORM_ADMIN"]);
  same(ACCESS_POLICY.screenGrants, {});
  for (const role of ["fleet-owner", "driver", "unknown"]) {
    same(ACCESS_POLICY.roleGrants[role].screens, []);
    same(ACCESS_POLICY.roleGrants[role].features, []);
  }
});

// ── Role resolution ─────────────────────────────────────────────────────────

test("role codes map exactly; missing, malformed and unknown roles resolve to unknown", () => {
  assert.equal(resolveAppRole(admin), "admin");
  for (const user of [
    null,
    undefined,
    "PLATFORM_ADMIN",
    {},
    { role: null },
    { role: "PLATFORM_ADMIN" },
    { role: {} },
    { role: { code: null } },
    { role: { code: 7 } },
    { role: { code: "" } },
    { role: { code: "  " } },
    { role: { code: "platform_admin" } },
    { role: { code: " PLATFORM_ADMIN" } },
    { role: { code: "FLEET_OWNER" } },
    { role: { code: "DRIVER" } },
    { role: { code: "toString" } },
    { role: { code: "__proto__" } },
    // A description that looks privileged must not grant anything.
    { role: { code: "SOMETHING", description: "Platform administrator" } },
  ]) {
    assert.equal(resolveAppRole(user), "unknown", JSON.stringify(user));
  }
});

test("permissions are read defensively", () => {
  same(list(readPermissions({ permissions: ["a", "b", "a"] })), ["a", "b"]);
  same(list(readPermissions({})), []);
  same(list(readPermissions({ permissions: null })), []);
  same(list(readPermissions({ permissions: "a,b" })), []);
  same(list(readPermissions({ permissions: ["a", 1, null, "", { code: "b" }] })), ["a"]);
  same(list(readPermissions(null)), []);
});

test("menu route keys: nested, hidden/inactive skipped, malformed input tolerated", () => {
  const menus = [
    { routeKey: "dashboard", children: [{ routeKey: "trips" }, { routeKey: "hidden", visible: false }, null, 5] },
    { routeKey: "off", active: false, children: [{ routeKey: "under-off" }] },
    { routeKey: 42 },
    "junk",
  ];
  same(list(readMenuRouteKeys(menus)), ["dashboard", "trips"]);
  same(list(readMenuRouteKeys(null)), []);
  same(list(readMenuRouteKeys({ routeKey: "x" })), []);
});

// ── Access computation ──────────────────────────────────────────────────────

test("PLATFORM_ADMIN keeps every existing screen and shell feature (regression)", () => {
  const a = computeAccess(admin, null);
  assert.equal(a.role, "admin");
  same(list(a.screens), [...ALL_SCREENS].sort());
  assert.equal(canUseFeature(a, "assistant"), true);
  assert.equal(canUseFeature(a, "recordSearch"), true);
  // Admin access doesn't depend on permissions[] being present.
  same(list(computeAccess({ role: admin.role }, null).screens), [...ALL_SCREENS].sort());
});

test("no user, unknown role or missing permissions → no screens, no features", () => {
  for (const user of [null, undefined, {}, { role: { code: "FLEET_OWNER" }, permissions: ["devices:read", "alarms:read"] }, { role: { code: "DRIVER" } }, { permissions: ["*"] }]) {
    const a = computeAccess(user, [{ routeKey: "dashboard" }, { routeKey: "alarms" }]);
    same(list(a.screens), []);
    same(list(a.features), []);
    assert.equal(homeScreen(a), null);
  }
});

test("screen grants open a screen by confirmed permission or menu routeKey only", () => {
  const p = testPolicy();
  const user = { role: { code: "UNMAPPED" }, permissions: ["perm.alerts.read"] };
  same(list(computeAccess(user, null, p).screens), ["alerts"]);
  same(list(computeAccess({ role: { code: "UNMAPPED" } }, [{ routeKey: "trips" }], p).screens), ["trips"]);
  same(list(computeAccess({ role: { code: "UNMAPPED" } }, [{ routeKey: "trips", visible: false }], p).screens), []);
  // A permission whose name merely resembles a screen grants nothing.
  same(list(computeAccess({ role: { code: "UNMAPPED" }, permissions: ["alerts", "ALERTS_READ", "vehicles"] }, null, p).screens), []);
});

test("a mapped driver role gets only its listed screens — never driver workflows by default", () => {
  const a = computeAccess({ role: { code: "TEST_DRIVER" } }, null, testPolicy());
  assert.equal(a.role, "driver");
  same(list(a.screens), ["settings"]);
  for (const screen of ["drivers", "trips", "vehicles", "alerts", "users", "commands"]) assert.equal(a.screens.has(screen), false, screen);
  assert.equal(canUseFeature(a, "assistant"), false);
  assert.equal(canUseFeature(a, "recordSearch"), false);
});

// ── Routes ──────────────────────────────────────────────────────────────────

test("screenForPath matches whole segments and nested routes", () => {
  assert.equal(screenForPath("/drive-vision/overview"), "overview");
  assert.equal(screenForPath("/drive-vision/overview/"), "overview");
  assert.equal(screenForPath("/drive-vision/vehicles/123"), "vehicles");
  assert.equal(screenForPath("/drive-vision/vehicles/new"), "vehicles");
  assert.equal(screenForPath("/drive-vision/devices/commands"), "commands");
  assert.equal(screenForPath("/drive-vision/drivers?driver=d1"), "drivers");
  assert.equal(screenForPath("/drive-vision/overviewx"), null);
  assert.equal(screenForPath("/drive-vision/devices"), null);
  assert.equal(screenForPath("/drive-vision"), null);
  assert.equal(screenForPath("/drive-vision/unknown"), null);
  assert.equal(screenForPath("/other/overview"), null);
});

test("decideRoute: authentication first, then deny by default", () => {
  const a = computeAccess(admin, null);
  const none = computeAccess({ role: { code: "UNMAPPED" } }, null);
  same(decideRoute("unknown", a, "/drive-vision/alerts"), { kind: "checking" });
  same(decideRoute("unauthenticated", NO_ACCESS, "/drive-vision/alerts"), { kind: "login", next: "/drive-vision/alerts" });
  same(decideRoute("error", a, "/drive-vision/alerts"), { kind: "session-error" });
  same(decideRoute("authenticated", a, "/drive-vision/vehicles/9"), { kind: "allow", screen: "vehicles" });
  same(decideRoute("authenticated", a, "/drive-vision/nope"), { kind: "forbidden", screen: null, reason: "unknown-route" });
  same(decideRoute("authenticated", none, "/drive-vision/overview"), { kind: "forbidden", screen: "overview", reason: "no-role" });
  // Authenticated, but /me hasn't produced a user (malformed payload) → still denied.
  same(decideRoute("authenticated", computeAccess(null, null), "/drive-vision/overview"), { kind: "forbidden", screen: "overview", reason: "no-role" });
  const alertsOnly = computeAccess({ role: { code: "UNMAPPED" }, permissions: ["perm.alerts.read"] }, null, testPolicy());
  same(decideRoute("authenticated", alertsOnly, "/drive-vision/alerts"), { kind: "allow", screen: "alerts" });
  same(decideRoute("authenticated", alertsOnly, "/drive-vision/users"), { kind: "forbidden", screen: "users", reason: "no-access" });
  assert.equal(homeScreen(alertsOnly), "alerts");
  assert.equal(canAccessPath(alertsOnly, "/drive-vision/alerts?alarm=1"), true);
  assert.equal(canAccessPath(alertsOnly, "/drive-vision/vehicles/1"), false);
});

// ── Navigation ──────────────────────────────────────────────────────────────

test("navigation shows only permitted items and drops empty groups", () => {
  const groups = [
    { label: "Overview", items: [{ screen: "overview" }] },
    { label: "Safety", items: [{ screen: "alerts" }, { screen: "safety" }] },
    { label: "Admin", items: [{ screen: "users" }, { screen: "settings" }] },
  ];
  same(filterNavGroups(groups, computeAccess(admin, null)), groups);
  const alertsOnly = computeAccess({ role: { code: "UNMAPPED" }, permissions: ["perm.alerts.read"] }, null, testPolicy());
  same(filterNavGroups(groups, alertsOnly), [{ label: "Safety", items: [{ screen: "alerts" }] }]);
  same(filterNavGroups(groups, computeAccess({ role: { code: "DRIVER" } }, null)), []);
});

test("every nav route in the app maps to a screen in the policy", () => {
  // nav-config imports lucide-react, so check the route table it is built from instead.
  for (const screen of ALL_SCREENS) assert.equal(screenForPath(policy.SCREEN_ROUTES[screen]), screen, screen);
});

// ── Phase 1B hardening ──────────────────────────────────────────────────────

test("only exact permission codes and menu routeKeys grant; look-alikes and other menu fields don't", () => {
  const p = testPolicy();
  const grants = (user, menus) => list(computeAccess({ role: { code: "UNMAPPED" }, ...user }, menus, p).screens);
  for (const perm of [" perm.alerts.read", "perm.alerts.read ", "PERM.ALERTS.READ", "perm.alerts", "perm.alerts.read.extra", "perm.alerts.*", "*"]) {
    same(grants({ permissions: [perm] }, null), []);
  }
  for (const menu of [
    { routeKey: "Trips" },
    { routeKey: " trips" },
    { routePath: "/drive-vision/trips" },
    { menuKey: "trips", title: "Trips" },
    { requiredPermissionCode: "perm.alerts.read" },
    { routeKey: "dashboard", title: "Trips & Tracking" },
  ]) {
    same(grants({}, [menu]), []);
  }
  // Permission *descriptions* (e.g. from GET /permissions) are never consulted.
  same(grants({ permissions: [{ code: "perm.alerts.read", description: "alerts" }] }, null), []);
});

test("a role code can't grant through the prototype chain or a non-string", () => {
  for (const code of ["constructor", "hasOwnProperty", "__proto__", "valueOf"]) {
    same(list(computeAccess({ role: { code } }, null).screens), []);
  }
  same(list(computeAccess({ role: { code: ["PLATFORM_ADMIN"] } }, null).screens), []);
  same(list(computeAccess({ role: { code: { toString: () => "PLATFORM_ADMIN" } } }, null).screens), []);
});

test("navigation and route authorisation agree for every screen", () => {
  const groups = [{ label: "All", items: ALL_SCREENS.map((screen) => ({ screen })) }];
  const p = testPolicy();
  const samples = [
    computeAccess(admin, null),
    computeAccess(null, null),
    computeAccess({ role: { code: "FLEET_OWNER" } }, null),
    computeAccess({ role: { code: "UNMAPPED" }, permissions: ["perm.alerts.read"] }, [{ routeKey: "trips" }], p),
    computeAccess({ role: { code: "TEST_DRIVER" } }, null, p),
  ];
  for (const a of samples) {
    const inNav = filterNavGroups(groups, a).flatMap((g) => g.items.map((i) => i.screen)).sort();
    const routable = ALL_SCREENS.filter((s) => decideRoute("authenticated", a, SCREEN_ROUTES[s]).kind === "allow").sort();
    same(inNav, routable);
  }
});

test("search hides sample records and pages the user can't open", () => {
  const pages = [{ href: "/drive-vision/alerts" }, { href: "/drive-vision/users" }];
  const records = [{ href: "/drive-vision/vehicles/v1" }, { href: "/drive-vision/drivers?driver=d1" }, { href: "/drive-vision/alerts?alarm=a1" }];
  same(visibleSearchResults(computeAccess(admin, null), pages, records), { pages, records });
  same(visibleSearchResults(computeAccess({ role: { code: "FLEET_OWNER" } }, null), pages, records), { pages: [], records: [] });
  // Screen access alone doesn't unlock sample records (needs the recordSearch feature).
  const alertsOnly = computeAccess({ role: { code: "UNMAPPED" }, permissions: ["perm.alerts.read"] }, null, testPolicy());
  same(visibleSearchResults(alertsOnly, pages, records), { pages: [{ href: "/drive-vision/alerts" }], records: [] });
  // With the feature, records still need an openable target screen.
  const featureOnly = computeAccess({ role: { code: "UNMAPPED" }, permissions: ["perm.alerts.read"] }, null, testPolicy({ roleGrants: { ...testPolicy().roleGrants, unknown: { screens: [], features: ["recordSearch"] } } }));
  same(visibleSearchResults(featureOnly, pages, records).records, [{ href: "/drive-vision/alerts?alarm=a1" }]);
  same(visibleSearchResults(computeAccess(admin, null), [{ href: "/drive-vision/nope" }], [{ href: "https://evil.test/drive-vision/alerts" }]), { pages: [], records: [] });
});
