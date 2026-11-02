// V10 permission system (Phase 3): the access registries against the V10 spec, and per-identity
// scenarios (Safe-Fare Admin, tenant ADMIN, Fleet Owner, Dispatcher, Viewer, Driver).
// Pure functions + static source checks; no network. Fixtures: tests/helpers/identities.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const contract = require("./helpers/v10-contract.cjs");
const { SPEC, ALL_CODES, IDENTITIES, DRIVER_SCREENS } = require("./helpers/identities.cjs");

const realm = createRealm({ process: { env: {} } });
const p = realm.require("features/drive-vision/access/access-policy");
const idm = realm.require("features/drive-vision/access/identity");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const list = (set) => [...set].sort();
const access = (raw, policy) => p.computeAccess(idm.readIdentity(raw), policy);
const OPS = contract.specOperations(SPEC);
const opByKey = new Map(OPS.map((o) => [o.key, o.op]));

const FLEET = p.ALL_SCREENS.filter((s) => s !== "myWork" && s !== "settings" && !p.SCREENS[s].platformOnly);

// ── Registries ↔ V10 spec ────────────────────────────────────────────────────

/** Each requirement must mirror the documented permission of every operation it lists. */
function checkRequirement(label, req) {
  assert.ok(req.operations.length > 0, `${label}: names its V10 operation(s)`);
  const observed = new Set(req.observed?.codes ?? []);
  const own = [...(req.anyOf ?? []), ...(req.allOf ?? [])].filter((c) => !observed.has(c));
  const offSpec = new Set(req.offSpec?.operations ?? []);
  for (const key of offSpec) {
    // Off-spec = backend-supplied contract outside V10: must really be absent from V10, and documented.
    assert.ok(!opByKey.has(key), `${label}: ${key} is marked off-spec but exists in V10`);
    assert.ok(req.operations.includes(key) && req.offSpec.source.length > 10, `${label}: off-spec ${key} is listed and sourced`);
  }
  for (const key of req.operations) {
    if (offSpec.has(key)) continue;
    const op = opByKey.get(key);
    assert.ok(op, `${label}: ${key} is a V10 operation`);
    const text = contract.permissionOf(op);
    const codes = contract.permissionCodes(text);
    if (req.signedIn) {
      assert.match(text, /^none\b/, `${label}: ${key} needs only a signed-in user (spec: ${text})`);
      assert.equal(own.length, 0, `${label}: signedIn requirement carries no codes`);
    } else {
      // The frontend asks for exactly what the spec documents ("a or b" ⇒ anyOf [a, b]).
      same([...own].sort(), [...codes].sort());
    }
  }
}

test("every screen requirement mirrors the V10 permission of the operation it names", () => {
  for (const [key, def] of Object.entries(p.SCREENS)) checkRequirement(`screen ${key}`, def.requires);
});

test("every feature requirement mirrors V10", () => {
  for (const [key, req] of Object.entries(p.FEATURES)) checkRequirement(`feature ${key}`, req);
});

test("every action requirement mirrors V10 for all the operations behind it", () => {
  for (const [key, def] of Object.entries(p.ACTIONS)) checkRequirement(`action ${key}`, def.requires);
});

test("tenantWrite is set exactly for the tenant-scoped writes (not /me, /notifications, /driver)", () => {
  for (const [key, def] of Object.entries(p.ACTIONS)) {
    const selfScoped = def.requires.operations.every((k) => /^\w+ \/api\/v1\/(me|notifications|driver)(\/|$)/.test(k));
    // Phase 7: actions on platform-only screens (global roles, permission catalogue) have no tenant either.
    const platformAction = def.screen !== null && p.SCREENS[def.screen].platformOnly === true;
    assert.equal(def.tenantWrite, !selfScoped && !platformAction, key);
  }
});

test("every code the registries use exists in V10, except the documented observed driver.app", () => {
  const used = new Set();
  const add = (req) => [...(req.anyOf ?? []), ...(req.allOf ?? [])].forEach((c) => used.add(c));
  Object.values(p.SCREENS).forEach((d) => add(d.requires));
  Object.values(p.FEATURES).forEach(add);
  Object.values(p.ACTIONS).forEach((d) => add(d.requires));
  same([...used].filter((c) => !ALL_CODES.includes(c)), ["driver.app"]);
  assert.ok(p.SCREENS.myWork.requires.observed.codes.includes("driver.app"));
});

test("no legacy role assumptions remain in the app source", () => {
  const SRC = path.join(__dirname, "..", "src");
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(SRC);
  for (const f of files) {
    if (/mock-data|[\\/]services[\\/]|types[\\/]index\.ts/.test(f)) continue; // unmounted legacy sample layer
    const text = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // code, not comments
    for (const re of [/PLATFORM_ADMIN/, /SUPER_ADMIN/, /roleGrants/, /roleCodes/, /menusError|retryMenus/, /access\.role\b/]) assert.doesNotMatch(text, re, `${path.relative(SRC, f)} uses ${re}`);
  }
});

// ── Safe-Fare Admin vs tenant ADMIN ─────────────────────────────────────────

test("Safe-Fare Admin: platform=true recognised, every fleet screen and feature, platform access, no driver app", () => {
  const a = access(IDENTITIES.platformAdmin);
  assert.equal(a.kind, "platform-admin");
  assert.equal(a.platform, true);
  assert.equal(p.canAccessPlatform(a), true);
  // Phase 4: the platform dashboard in addition to every tenant screen.
  same(list(a.screens), [...FLEET, "permissions", "platform", "roles", "settings", "tenants"].sort());
  same(list(a.features), ["assistant", "recordSearch"]);
  assert.equal(a.screens.has("myWork"), false);
});

test("tenant ADMIN: platform=false recognised; same role code, but no platform access", () => {
  const a = access(IDENTITIES.tenantAdmin);
  assert.equal(a.kind, "tenant-admin");
  assert.equal(a.platform, false);
  assert.equal(p.canAccessPlatform(a), false);
  same(list(a.screens), [...FLEET, "settings"].sort());
  // Even holding tenant.all, a non-platform identity gets no platform access.
  assert.equal(p.canAccessPlatform(access({ ...IDENTITIES.tenantAdmin, permissions: [...IDENTITIES.tenantAdmin.permissions, "tenant.all"] })), false);
  // An ADMIN identity whose platform flag is missing is a tenant ADMIN.
  const missing = { ...IDENTITIES.platformAdmin };
  delete missing.platform;
  assert.equal(access(missing).kind, "tenant-admin");
  assert.equal(p.canAccessPlatform(access(missing)), false);
});

test("platform flag alone doesn't open screens; platform access also needs tenant.all", () => {
  const bare = access({ platform: true, roleCode: "ADMIN", permissions: [] });
  same(list(bare.screens), []);
  assert.equal(p.canAccessPlatform(bare), false);
  assert.equal(p.canAccessPlatform(access({ platform: true, permissions: ["tenant.all"] })), true);
});

test("platform-only screens need platform=true: hidden from tenant ADMIN and blocked by typed URL", () => {
  // No platform screen exists before Phase 5; a test policy registers one on an existing route.
  const policy = { ...p.ACCESS_POLICY, screens: { ...p.SCREENS, users: { audience: "all", platformOnly: true, requires: { anyOf: ["tenant.all"], operations: ["GET /api/v1/platform/tenants"] } } } };
  const sfa = access(IDENTITIES.platformAdmin, policy);
  const ta = access({ ...IDENTITIES.tenantAdmin, permissions: [...IDENTITIES.tenantAdmin.permissions, "tenant.all"] }, policy);
  same(p.decideRoute("authenticated", sfa, "/drive-vision/users"), { kind: "allow", screen: "users" });
  same(p.decideRoute("authenticated", ta, "/drive-vision/users"), { kind: "forbidden", screen: "users", reason: "no-access" });
  assert.equal(p.canPerform(ta, "users.update"), false, "actions of a hidden platform screen are dropped too");
});

test("tenant context: tenant users have it from their token; Safe-Fare Admin only with a selected tenant", () => {
  assert.equal(p.hasTenantContext(access(IDENTITIES.tenantAdmin)), true);
  assert.equal(p.hasTenantContext(access({ ...IDENTITIES.tenantAdmin, tenantId: null })), true);
  assert.equal(p.hasTenantContext(access(IDENTITIES.platformAdmin)), false);
  // Phase 5: the Safe-Fare Admin's tenant is the frontend selection (switch-tenant isn't persisted server-side),
  // so an identity tenantId alone doesn't give it a tenant context; a selection does.
  assert.equal(p.hasTenantContext(access({ ...IDENTITIES.platformAdmin, tenantId: 42 })), false);
  assert.equal(p.hasTenantContext(p.computeAccess(idm.readIdentity(IDENTITIES.platformAdmin), undefined, { selectedTenantId: 42 })), true);
  assert.equal(p.hasTenantContext(p.NO_ACCESS), false);
  const sfa = access(IDENTITIES.platformAdmin);
  assert.equal(p.needsTenantSelection(sfa, "drivers.create"), true);
  assert.equal(p.needsTenantSelection(sfa, "settings.manage"), false);
  assert.equal(p.needsTenantSelection(access(IDENTITIES.tenantAdmin), "drivers.create"), false);
  // Phase 5 closes the documented gap: without a selected tenant the write isn't offered (it would answer TENANT_REQUIRED)…
  assert.equal(p.canPerform(sfa, "drivers.create"), false);
  assert.equal(p.actionBlock(sfa, "drivers.create"), "tenant");
  // …and with one it is.
  assert.equal(p.canPerform(p.computeAccess(idm.readIdentity(IDENTITIES.platformAdmin), undefined, { selectedTenantId: 42 }), "drivers.create"), true);
});

// ── Other roles: permissions decide ─────────────────────────────────────────

test("Fleet Owner (synthetic code): screens and actions follow its permissions only", () => {
  const a = access(IDENTITIES.fleetOwner);
  assert.equal(a.kind, "tenant-user");
  same(list(a.screens), ["alerts", "dispatch", "drivers", "monitoring", "overview", "reports", "safety", "settings", "trips", "vehicles", "workforce"]);
  for (const k of ["drivers.create", "drivers.update", "dispatch.create", "dispatch.update", "swaps.decide", "leave.create", "leave.decide"]) assert.equal(p.canPerform(a, k), true, k);
  for (const k of ["drivers.delete", "alerts.handle", "users.create", "users.update", "geofences.delete", "video.export"]) assert.equal(p.canPerform(a, k), false, k);
  assert.equal(p.canAccessPlatform(a), false);
});

test("Dispatcher (synthetic code): dispatch writes, no driver or workforce writes", () => {
  const a = access(IDENTITIES.dispatcher);
  same(list(a.screens), ["dispatch", "drivers", "monitoring", "overview", "settings", "vehicles", "workforce"]);
  same(list(a.actions).filter((k) => !["settings.manage", "account.password", "notifications.markRead"].includes(k)), ["dispatch.create", "dispatch.update", "swaps.decide"]);
});

test("Viewer (synthetic code): every read screen it has codes for, and no write action at all", () => {
  const a = access(IDENTITIES.viewer);
  for (const s of ["overview", "monitoring", "trips", "reports", "vehicles", "drivers", "dispatch", "workforce", "alerts", "safety", "geofences", "users"]) assert.equal(a.screens.has(s), true, s);
  // Command history needs command.send in V10 — a read-only viewer doesn't get it.
  assert.equal(a.screens.has("commands"), false);
  assert.equal(a.screens.has("video"), false);
  same(list(a.actions), ["account.password", "notifications.markRead", "settings.manage"]);
});

test("operation-level: create / update / delete are separate permission boundaries", () => {
  const only = (codes) => list(access({ platform: false, roleCode: "R", permissions: ["driver.read", ...codes] }).actions).filter((k) => k.startsWith("drivers."));
  same(only([]), []);
  same(only(["driver.create"]), ["drivers.create"]);
  same(only(["driver.update"]), ["drivers.update"]);
  same(only(["driver.delete"]), ["drivers.delete"]);
  // Without the screen's read permission, its write codes offer nothing.
  same(list(access({ permissions: ["driver.create", "driver.update", "driver.delete"] }).actions).filter((k) => k.startsWith("drivers.")), []);
});

test("server screens narrow: readOnly removes the screen's writes; allowed:false removes that operation", () => {
  const base = { platform: false, roleCode: "R", permissions: ["alarm.read", "alarm.handle", "device.read", "report.read"] };
  assert.equal(p.canPerform(access(base), "alerts.handle"), true);
  assert.equal(p.canPerform(access({ ...base, screens: [{ routePath: "/alarms", readOnly: true }] }), "alerts.handle"), false);
  assert.equal(p.canPerform(access({ ...base, screens: [{ routePath: "/alarms", operations: [{ operation: "HANDLE", permissionCode: "alarm.handle", allowed: false }] }] }), "alerts.handle"), false);
  assert.equal(p.canPerform(access({ ...base, screens: [{ routePath: "/alarms", operations: [{ operation: "HANDLE", permissionCode: "alarm.handle", allowed: true }] }] }), "alerts.handle"), true);
  // Narrowing never removes the screen itself (the read permission decides that).
  assert.equal(access({ ...base, screens: [{ routePath: "/alarms", readOnly: true }] }).screens.has("alerts"), true);
  // A readOnly flag on another screen doesn't leak.
  assert.equal(p.canPerform(access({ ...base, screens: [{ routePath: "/reports", readOnly: true }] }), "alerts.handle"), true);
});

test("missing permissions never grant: removing a code removes exactly what depended on it", () => {
  const full = access(IDENTITIES.tenantAdmin);
  for (const code of ["device.read", "driver.read", "alarm.read", "user.read", "user.update", "command.send"]) {
    const less = access({ ...IDENTITIES.tenantAdmin, permissions: IDENTITIES.tenantAdmin.permissions.filter((c) => c !== code) });
    assert.ok(less.screens.size <= full.screens.size && less.actions.size < full.actions.size + 1, code);
    for (const s of less.screens) assert.ok(full.screens.has(s), `${code}: ${s} appeared`);
    for (const k of less.actions) assert.ok(full.actions.has(k), `${code}: ${k} appeared`);
  }
});

// ── Driver ──────────────────────────────────────────────────────────────────

test("Driver (live fixture): My Work only, self-service actions, no fleet screen or feature", () => {
  const a = access(IDENTITIES.driver);
  assert.equal(a.kind, "driver");
  same(list(a.screens), ["myWork"]);
  same(list(a.features), []);
  same(list(a.actions), ["account.password", "driver.selfService", "notifications.markRead"]);
  for (const s of p.ALL_SCREENS.filter((x) => x !== "myWork")) assert.equal(p.decideRoute("authenticated", a, p.SCREEN_ROUTES[s]).kind, "forbidden", s);
});

test("driver nav: V10 screens mapped by routePath, server order and titles; notifications has no page", () => {
  const a = access(IDENTITIES.driver);
  same(p.driverNavEntries(a).map((e) => [e.title, e.href]), [
    ["My Work", "/drive-vision/my-work"],
    ["My Shifts", "/drive-vision/my-work/shifts"],
    ["My Leave", "/drive-vision/my-work/leave"],
    ["Shift Checklist", "/drive-vision/my-work/checklist"],
    ["My Safety", "/drive-vision/my-work/safety"],
    ["My Profile", "/drive-vision/my-work/profile"],
  ]);
  // Server order wins; a renamed title is shown; duplicates collapse.
  const custom = access({ ...IDENTITIES.driver, screens: [{ ...DRIVER_SCREENS[4], title: "Safety score" }, DRIVER_SCREENS[0], DRIVER_SCREENS[4]] });
  same(p.driverNavEntries(custom).map((e) => e.title), ["Safety score", "My Work"]);
  // No usable server screens → every section is listed.
  same(p.driverNavEntries(access({ ...IDENTITIES.driver, screens: [] })).length, 6);
});

test("driver app is for DRIVER logins only — admins holding the same codes don't get it", () => {
  const codes = ["driver.app", "own.data.read"];
  for (const extra of [{ roleCode: "ADMIN", platform: false }, { roleCode: "ADMIN", platform: true }, { roleCode: "DRIVER", platform: true }, { roleCode: "TEST_FLEET_OWNER" }]) {
    const a = access({ ...IDENTITIES.driver, ...extra, permissions: [...IDENTITIES.tenantAdmin.permissions, ...codes] });
    assert.equal(a.screens.has("myWork"), false, JSON.stringify(extra));
    same(p.driverNavEntries(a), []);
  }
  // A DRIVER missing either code doesn't get it.
  for (const permissions of [["own.data.read"], ["driver.app"], []]) assert.equal(access({ ...IDENTITIES.driver, permissions }).screens.has("myWork"), false, String(permissions));
});

test("each driver section route is open to the driver and closed to the admins (typed URL)", () => {
  const driver = access(IDENTITIES.driver);
  const sfa = access(IDENTITIES.platformAdmin);
  const ta = access(IDENTITIES.tenantAdmin);
  for (const href of p.DRIVER_SECTIONS.map((s) => s.href)) {
    same(p.decideRoute("authenticated", driver, href), { kind: "allow", screen: "myWork" });
    assert.equal(p.decideRoute("authenticated", sfa, href).kind, "forbidden", href);
    assert.equal(p.decideRoute("authenticated", ta, href).kind, "forbidden", href);
    same(p.decideRoute("unauthenticated", driver, href), { kind: "login", next: href });
  }
  assert.equal(p.landingRedirect(driver, "/drive-vision"), "/drive-vision/my-work");
});

test("sidebar highlight follows the section route; segment boundaries respected", () => {
  const hrefs = p.driverNavEntries(access(IDENTITIES.driver)).map((e) => e.href);
  for (const href of hrefs) assert.equal(p.activeNavHref(hrefs, href), href);
  assert.equal(p.activeNavHref(hrefs, "/drive-vision/my-work/shifts/?x=1#y"), "/drive-vision/my-work/shifts");
  assert.equal(p.activeNavHref(hrefs, "/drive-vision/my-workx"), null);
  assert.equal(p.activeNavHref(["/drive-vision/vehicles", "/drive-vision/devices/commands"], "/drive-vision/vehicles/12"), "/drive-vision/vehicles");
});

test("server routePath mapping: only observed paths and the app's own routes; everything else unmapped", () => {
  same(p.routeForServerPath("/driver/shifts/"), { screen: "myWork", href: "/drive-vision/my-work/shifts" });
  same(p.routeForServerPath("/dashboard"), { screen: "overview", href: "/drive-vision/overview" });
  same(p.routeForServerPath("/drive-vision/vehicles"), { screen: "vehicles", href: "/drive-vision/vehicles" });
  assert.equal(p.routeForServerPath("/driver/notifications"), null);
  for (const unknown of ["/vehicles", "/driver", "/driver/unknown", "/settings", "constructor", "/__proto__", "/drive-visionx/vehicles", null]) assert.equal(p.routeForServerPath(unknown), undefined, String(unknown));
});
