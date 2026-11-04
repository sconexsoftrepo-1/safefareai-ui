// Driver experience under V10: the live DRIVER fixture (role DRIVER, permissions driver.app +
// own.data.read, driver menu routePaths observed 2026-10-29) as GET /me/permissions screens, through the
// access policy and the real sidebar grouping (navigation/use-nav.ts). Pure functions; no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { IDENTITIES, DRIVER_SCREENS } = require("./helpers/identities.cjs");

// lucide-react icons are components; the nav code only stores them.
const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const realm = createRealm({ process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f() } });
const p = realm.require("features/drive-vision/access/access-policy");
const idm = realm.require("features/drive-vision/access/identity");
const nav = realm.require("components/drive-vision/navigation/use-nav");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const access = (raw) => p.computeAccess(idm.readIdentity(raw));
const driver = access(IDENTITIES.driver);

const SECTION_HREFS = ["/drive-vision/my-work", "/drive-vision/my-work/shifts", "/drive-vision/my-work/leave", "/drive-vision/my-work/checklist", "/drive-vision/my-work/safety", "/drive-vision/my-work/profile"];

test("driver sidebar: one 'My work' group with the six sections, server titles, section icons; no Settings", () => {
  const groups = nav.navGroupsFor(driver);
  same(groups.map((g) => g.label), ["My work"]);
  same(groups[0].items.map((i) => [i.label, i.href]), DRIVER_SCREENS.filter((s) => s.routePath !== "/driver/notifications").map((s, i) => [s.title, SECTION_HREFS[i]]));
  same(groups[0].items.map((i) => i.icon), ["icon:BriefcaseBusiness", "icon:Clock", "icon:CalendarOff", "icon:ClipboardCheck", "icon:ShieldCheck", "icon:UserRound"]);
  for (const i of groups[0].items) assert.equal(i.screen, "myWork");
});

test("staff sidebars never contain the driver app; tenant ADMIN keeps the full fleet catalogue", () => {
  for (const key of ["platformAdmin", "tenantAdmin", "fleetOwner", "dispatcher", "viewer"]) {
    const items = nav.navGroupsFor(access(IDENTITIES[key])).flatMap((g) => g.items);
    assert.ok(!items.some((i) => i.screen === "myWork"), key);
    assert.ok(items.some((i) => i.screen === "settings"), `${key} has Settings`);
  }
  const admin = nav.navGroupsFor(access(IDENTITIES.tenantAdmin));
  same(admin.map((g) => g.label), ["Overview", "Monitor", "Fleet", "Safety", "Manage", "Administration"]);
});

test("no usable server screens (empty, unmapped, malformed) → all sections from the static list", () => {
  for (const screens of [[], [{ routePath: "/unknown" }], [null, 5, "x"], [{ routePath: "/driver/notifications" }], "junk"]) {
    same(p.driverNavEntries(access({ ...IDENTITIES.driver, screens })).map((e) => e.href), SECTION_HREFS, JSON.stringify(screens));
  }
});

test("hostile server screens can't point a driver at a fleet page or add unknown sections", () => {
  const screens = [...DRIVER_SCREENS, { routePath: "/drive-vision/users", title: "Users" }, { routePath: "/dashboard", title: "Dashboard" }, { routePath: "/drive-vision/my-work/admin", title: "x" }, { routePath: "constructor" }];
  const a = access({ ...IDENTITIES.driver, screens });
  same(p.driverNavEntries(a).map((e) => e.href), SECTION_HREFS);
  same([...a.screens], ["myWork"]);
  assert.ok(nav.navGroupsFor(a).flatMap((g) => g.items).every((i) => p.canAccessPath(a, i.href)));
});

test("typed URLs: a driver is redirected only from the generic landing; fleet screens stay denied", () => {
  assert.equal(p.landingRedirect(driver, "/drive-vision"), "/drive-vision/my-work");
  assert.equal(p.landingRedirect(driver, "/drive-vision/overview/"), "/drive-vision/my-work");
  for (const url of ["/drive-vision/users", "/drive-vision/drivers?driver=1", "/drive-vision/vehicles/1", "/drive-vision/dispatch", "/drive-vision/settings", "/drive-vision/nope"]) {
    assert.equal(p.decideRoute("authenticated", driver, url).kind, "forbidden", url);
    assert.equal(p.landingRedirect(driver, url), null, url);
  }
});

test("a driver without driver.app or own.data.read gets no driver app and no sidebar", () => {
  for (const permissions of [["own.data.read"], ["driver.app"]]) {
    const a = access({ ...IDENTITIES.driver, permissions });
    assert.equal(a.screens.has("myWork"), false);
    same(nav.navGroupsFor(a), []);
    same(p.decideRoute("authenticated", a, "/drive-vision/my-work"), { kind: "forbidden", screen: "myWork", reason: "no-permissions" });
  }
});

test("V10 permission model: a DRIVER the backend grants a fleet read code sees that screen too (permissions decide)", () => {
  // Intentional change from the pre-V10 role policy, where DRIVER never saw a fleet screen.
  const a = access({ ...IDENTITIES.driver, permissions: [...IDENTITIES.driver.permissions, "alarm.read"] });
  assert.equal(a.screens.has("alerts"), true);
  assert.equal(a.screens.has("myWork"), true);
  assert.equal(a.screens.has("settings"), false, "Settings stays staff-only; drivers use My Profile");
});
