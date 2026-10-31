// Driver access from the real role + menu contract. The fixtures are the `/me` role/permissions and
// the `/me/menus` response observed for a signed-in DRIVER login on the dev BFF (2026-10-29), with the
// fields the app reads. Pure policy functions only; no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const p = createRealm({ process: { env: {} } }).require("features/drive-vision/access/access-policy");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const list = (set) => [...set].sort();

const DRIVER_ME = { id: 9, displayName: "Driver", role: { id: 4, code: "DRIVER", description: "Driver" }, permissions: ["driver.app", "own.data.read"] };
const ADMIN_ME = { id: 1, displayName: "Admin", role: { id: 1, code: "PLATFORM_ADMIN", description: "Platform administrator" }, permissions: ["X"] };
const item = (id, key, path, title, icon, sortOrder) => ({ id, parentId: null, menuKey: key, title, routeKey: key, routePath: path, icon, requiredPermissionCode: "driver.app", sortOrder, visible: true, active: true, children: [] });
const LIVE_MENUS = [
  item(18, "my_work", "/driver/work", "My Work", "clipboard-list", 10),
  item(19, "my_shifts", "/driver/shifts", "My Shifts", "clock", 20),
  item(20, "my_leave", "/driver/leave", "My Leave", "calendar-off", 30),
  item(21, "shift_checklist", "/driver/checklist", "Shift Checklist", "list-checks", 40),
  item(22, "my_safety", "/driver/safety", "My Safety", "shield", 50),
  item(23, "driver_notifications", "/driver/notifications", "Notifications", "inbox", 60),
  item(24, "my_profile", "/driver/profile", "My Profile", "user", 70),
];

// 1. Confirmed DRIVER role is recognised
test("DRIVER with driver.app → driver role with My Work only", () => {
  const a = p.computeAccess(DRIVER_ME, LIVE_MENUS);
  assert.equal(a.role, "driver");
  assert.equal(a.roleCode, "DRIVER");
  same(list(a.screens), ["myWork"]);
  same(list(a.features), []);
  same(p.decideRoute("authenticated", a, "/drive-vision/my-work"), { kind: "allow", screen: "myWork" });
});

test("DRIVER without driver.app gets no screen (role alone grants nothing) — denied, not 'no role'", () => {
  const a = p.computeAccess({ ...DRIVER_ME, permissions: ["own.data.read"] }, LIVE_MENUS);
  assert.equal(a.role, "driver");
  same(list(a.screens), []);
  same(p.decideRoute("authenticated", a, "/drive-vision/my-work"), { kind: "forbidden", screen: "myWork", reason: "no-access" });
});

// 2. Menu entries come from the real response structure
test("live menu → six nav entries in sortOrder with the server's titles; notifications has no page", () => {
  const { items, unmapped } = p.menuNavEntries(LIVE_MENUS, p.computeAccess(DRIVER_ME, LIVE_MENUS));
  same(
    items.map((i) => [i.routeKey, i.title, i.href]),
    [
      ["my_work", "My Work", "/drive-vision/my-work"],
      ["my_shifts", "My Shifts", "/drive-vision/my-work/shifts"],
      ["my_leave", "My Leave", "/drive-vision/my-work/leave"],
      ["shift_checklist", "Shift Checklist", "/drive-vision/my-work/checklist"],
      ["my_safety", "My Safety", "/drive-vision/my-work/safety"],
      ["my_profile", "My Profile", "/drive-vision/my-work/profile"],
    ]
  );
  same(unmapped, ["driver_notifications"]);
});

test("menu order follows sortOrder, not array order; children are included; hidden/inactive parents hide children", () => {
  const a = p.computeAccess(DRIVER_ME, null);
  const shuffled = [LIVE_MENUS[4], LIVE_MENUS[0], { ...LIVE_MENUS[1], sortOrder: undefined }];
  same(p.menuNavEntries(shuffled, a).items.map((i) => i.routeKey), ["my_work", "my_safety", "my_shifts"]);
  const tree = [{ ...LIVE_MENUS[0], children: [LIVE_MENUS[2]] }, { ...LIVE_MENUS[1], visible: false, children: [LIVE_MENUS[3]] }, { ...LIVE_MENUS[4], active: false }];
  same(p.menuNavEntries(tree, a).items.map((i) => i.routeKey), ["my_work", "my_leave"]);
});

// 3. Driver access never grants Admin privileges
test("DRIVER gets no fleet screen, no shell feature, and every fleet URL is denied", () => {
  const a = p.computeAccess(DRIVER_ME, LIVE_MENUS);
  for (const s of p.FLEET_SCREENS) {
    assert.equal(a.screens.has(s), false, s);
    assert.equal(p.decideRoute("authenticated", a, p.SCREEN_ROUTES[s]).kind, "forbidden", s);
  }
  assert.equal(p.canUseFeature(a, "assistant"), false);
  assert.equal(p.canUseFeature(a, "recordSearch"), false);
  // Admin-only permissions on a DRIVER login still don't open fleet screens.
  const extra = p.computeAccess({ ...DRIVER_ME, permissions: ["driver.app", "users.manage", "*"] }, LIVE_MENUS);
  same(list(extra.screens), ["myWork"]);
});

// 4. Admin cannot open /my-work — even with driver.app or driver menus
test("PLATFORM_ADMIN is denied My Work even if it carried driver.app and the driver menus", () => {
  const a = p.computeAccess({ ...ADMIN_ME, permissions: ["driver.app"] }, LIVE_MENUS);
  assert.equal(a.role, "admin");
  assert.equal(a.screens.has("myWork"), false);
  same(p.decideRoute("authenticated", a, "/drive-vision/my-work/shifts"), { kind: "forbidden", screen: "myWork", reason: "no-access" });
  same(p.menuNavEntries(LIVE_MENUS, a).items, []);
  same(list(a.screens), [...p.FLEET_SCREENS].sort());
});

// 5. Unknown / unconfirmed roles still get the safe denied screen
test("unconfirmed roles with driver.app and driver menus still get 'no role' and no navigation", () => {
  for (const code of ["FLEET_OWNER", "MANAGER", "driver", "DRIVER_ADMIN"]) {
    const a = p.computeAccess({ role: { code }, permissions: ["driver.app"] }, LIVE_MENUS);
    assert.equal(a.role, "unknown", code);
    same(list(a.screens), [], code);
    same(p.decideRoute("authenticated", a, "/drive-vision/my-work"), { kind: "forbidden", screen: "myWork", reason: "no-role" });
    same(p.menuNavEntries(LIVE_MENUS, a).items, [], code);
  }
});

// 6. Route guards can't be bypassed by typing a URL
test("typed URLs: a driver is redirected only from the generic landing; other screens stay denied", () => {
  const a = p.computeAccess(DRIVER_ME, LIVE_MENUS);
  assert.equal(p.landingRedirect(a, "/drive-vision"), "/drive-vision/my-work");
  assert.equal(p.landingRedirect(a, "/drive-vision/overview/"), "/drive-vision/my-work");
  for (const url of ["/drive-vision/users", "/drive-vision/drivers?driver=1", "/drive-vision/vehicles/1", "/drive-vision/dispatch", "/drive-vision/nope"]) {
    assert.equal(p.decideRoute("authenticated", a, url).kind, "forbidden", url);
    assert.equal(p.landingRedirect(a, url), null, url);
  }
  // Admin keeps Overview; an account with no screens has nowhere to be redirected.
  assert.equal(p.landingRedirect(p.computeAccess(ADMIN_ME, null), "/drive-vision/overview"), null);
  assert.equal(p.landingRedirect(p.computeAccess({ role: { code: "X" } }, null), "/drive-vision/overview"), null);
  // Signed out is decided before any screen grant.
  same(p.decideRoute("unauthenticated", a, "/drive-vision/my-work"), { kind: "login", next: "/drive-vision/my-work" });
});

// 7. Missing or malformed menus never create navigation
test("missing or malformed menu data yields no entries (and never more than the policy allows)", () => {
  const a = p.computeAccess(DRIVER_ME, null);
  for (const bad of [null, undefined, "x", 5, {}, [null, 1, "s"], [{}], [{ routeKey: "" }], [{ routeKey: 7 }], [{ routeKey: "unknown_key" }], [{ ...LIVE_MENUS[0], requiredPermissionCode: "admin.only" }], [{ routeKey: "toString" }], [{ routeKey: "__proto__" }]]) {
    same(p.menuNavEntries(bad, a).items, [], JSON.stringify(bad));
  }
  // A cycle or deep nesting doesn't hang.
  const loop = { ...LIVE_MENUS[0] };
  loop.children = [loop];
  same(p.menuNavEntries([loop], a).items.map((i) => i.routeKey), ["my_work"]);
  // A route mapping to a fleet screen is dropped for a driver, whatever the menu says.
  same(p.menuNavEntries([{ routeKey: "x", visible: true }], a, { x: "/drive-vision/users" }).items, []);
  // Menus alone never grant: same DRIVER without driver.app has no screens even with the live menu.
  same(list(p.computeAccess({ ...DRIVER_ME, permissions: [] }, LIVE_MENUS).screens), []);
});

// ── Section routes (2026-10-29: one route per menu item instead of #anchors) ─────────────

const SECTION_ROUTES = {
  my_work: "/drive-vision/my-work",
  my_shifts: "/drive-vision/my-work/shifts",
  my_leave: "/drive-vision/my-work/leave",
  shift_checklist: "/drive-vision/my-work/checklist",
  my_safety: "/drive-vision/my-work/safety",
  my_profile: "/drive-vision/my-work/profile",
};

test("every driver menu key maps to its own route; notifications stays unmapped", () => {
  for (const [key, href] of Object.entries(SECTION_ROUTES)) assert.equal(p.MENU_ROUTES[key], href, key);
  assert.equal(p.MENU_ROUTES.driver_notifications, null);
  // No mapping uses a hash or the backend's /driver/* paths.
  for (const href of Object.values(p.MENU_ROUTES)) if (href) assert.ok(href.startsWith("/drive-vision/my-work") && !href.includes("#"), href);
});

test("each section route is open to the driver and closed to admin and unconfirmed roles (typed URL)", () => {
  const driver = p.computeAccess(DRIVER_ME, LIVE_MENUS);
  const admin = p.computeAccess({ ...ADMIN_ME, permissions: ["driver.app"] }, LIVE_MENUS);
  const other = p.computeAccess({ role: { code: "MANAGER" }, permissions: ["driver.app"] }, LIVE_MENUS);
  for (const href of Object.values(SECTION_ROUTES)) {
    same(p.decideRoute("authenticated", driver, href), { kind: "allow", screen: "myWork" });
    assert.equal(p.decideRoute("authenticated", admin, href).kind, "forbidden", href);
    assert.equal(p.decideRoute("authenticated", other, href).kind, "forbidden", href);
    // Signed-out visitors go to sign-in first, with the deep link kept.
    same(p.decideRoute("unauthenticated", driver, href), { kind: "login", next: href });
  }
});

test("sidebar highlight follows the clicked item's route (not the static My Work entry)", () => {
  const hrefs = p.menuNavEntries(LIVE_MENUS, p.computeAccess(DRIVER_ME, LIVE_MENUS)).items.map((i) => i.href);
  for (const href of Object.values(SECTION_ROUTES)) assert.equal(p.activeNavHref(hrefs, href), href, href);
  assert.equal(p.activeNavHref(hrefs, "/drive-vision/my-work/shifts/"), SECTION_ROUTES.my_shifts);
  assert.equal(p.activeNavHref(hrefs, "/drive-vision/my-work/shifts?x=1#y"), SECTION_ROUTES.my_shifts);
  // Segment boundary: /my-workx is not under /my-work.
  assert.equal(p.activeNavHref(hrefs, "/drive-vision/my-workx"), null);
  assert.equal(p.activeNavHref(hrefs, "/drive-vision/users"), null);
  // Fleet nav keeps the existing longest-prefix behaviour.
  assert.equal(p.activeNavHref(["/drive-vision/vehicles", "/drive-vision/devices/commands"], "/drive-vision/vehicles/12"), "/drive-vision/vehicles");
});

test("unknown or hostile menu keys never produce a link; a menu can't point a driver at a fleet page", () => {
  const a = p.computeAccess(DRIVER_ME, LIVE_MENUS);
  const menus = [
    ...LIVE_MENUS,
    { ...LIVE_MENUS[0], id: 90, routeKey: "admin_users", routePath: "/drive-vision/users", title: "Users" },
    { ...LIVE_MENUS[0], id: 91, routeKey: "constructor", title: "x" },
    { ...LIVE_MENUS[0], id: 92, routeKey: "my_shifts", routePath: "/drive-vision/users", title: "Shifts again" },
  ];
  const { items } = p.menuNavEntries(menus, a);
  // routePath from the server is ignored; duplicates collapse to the first (sortOrder) entry.
  same(items.map((i) => i.href), Object.values(SECTION_ROUTES));
  assert.ok(items.every((i) => p.canAccessPath(a, i.href)));
});
