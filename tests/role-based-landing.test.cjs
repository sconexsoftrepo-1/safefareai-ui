// Default landing after sign-in. MOCKED: identities are synthetic and every request goes to a stub fetch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const driverFixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "driver-me-permissions.json"), "utf8"));
const realm = createRealm({ process: { env: {} } }, { "lucide-react": new Proxy({}, { get: () => "icon" }) });
const p = realm.require("features/drive-vision/access/access-policy");
const { readIdentity } = realm.require("features/drive-vision/access/identity");
const access = (raw, tenant) => p.computeAccess(readIdentity(raw), undefined, tenant);

const R = p.SCREEN_ROUTES;
const MY_WORK = R.myWork;
const fleetOwner = (extra = {}) => ({ ...IDENTITIES.fleetOwner, roleCode: "FLEET OWNER", tenantId: 77, homeTenantId: 77, ...extra });
const operator = () => ({ ...IDENTITIES.fleetOwner, roleCode: "OPERATOR", permissions: ["device.read", "alarm.read"] });
const dispatcher = () => ({ ...IDENTITIES.dispatcher, roleCode: "DISPATCHER" });
const viewer = () => ({ ...IDENTITIES.viewer, roleCode: "VIEWER" });
const ALL = { platformAdmin: IDENTITIES.platformAdmin, tenantAdmin: IDENTITIES.tenantAdmin, fleetOwner: fleetOwner(), operator: operator(), dispatcher: dispatcher(), viewer: viewer(), driver: driverFixture(), legacyDriver: IDENTITIES.driver };

// ── Safe-Fare Admin ─────────────────────────────────────────────────────────

test("Safe-Fare Admin lands on Platform Overview, with no tenant selected", () => {
  const a = access(IDENTITIES.platformAdmin);
  assert.equal(a.tenantId, null);
  assert.equal(p.defaultLanding(a), R.platform);
  assert.equal(p.canAccessPath(a, R.platform), true);
  assert.equal(p.tenantBlockedScreens(a).has("platform"), false);
});

test("the platform flag decides, not the role code: a tenant ADMIN isn't a Safe-Fare Admin", () => {
  assert.equal(p.defaultLanding(access(IDENTITIES.tenantAdmin)), R.overview);
  assert.equal(p.defaultLanding(access({ ...IDENTITIES.tenantAdmin, platform: "true" })), R.overview);
});

test("Safe-Fare Admin keeps Platform Overview with a tenant selected", () => {
  assert.equal(p.defaultLanding(access(IDENTITIES.platformAdmin, { selectedTenantId: 5 })), R.platform);
});

test("Safe-Fare Admin never reaches My Work, even on a Driver's next", () => {
  const a = access(IDENTITIES.platformAdmin);
  assert.equal(p.canAccessPath(a, MY_WORK), false);
  assert.equal(p.postLoginRoute(a, MY_WORK), R.platform);
  assert.equal(p.postLoginRoute(a, `${MY_WORK}/leave`), R.platform);
});

test("Safe-Fare Admin can still open Fleet Overview on purpose", () => {
  const a = access(IDENTITIES.platformAdmin);
  assert.equal(p.landingRedirect(a, R.overview), null);
  assert.equal(p.decideRoute("authenticated", a, R.overview).kind, "allow");
});

// ── Fleet Owner ─────────────────────────────────────────────────────────────

test("Fleet Owner, with the backend's own role code, lands on Fleet Overview in their tenant", () => {
  const a = access(fleetOwner());
  assert.equal(a.roleCode, "FLEET OWNER");
  assert.equal(p.defaultLanding(a), R.overview);
  assert.equal(a.tenantId, 77);
  assert.equal(p.canAccessPath(a, MY_WORK), false);
  assert.equal(p.postLoginRoute(a, MY_WORK), R.overview);
});

test("a tenant user's tenant can't be replaced by a selection", () => {
  assert.equal(access(fleetOwner(), { selectedTenantId: 5 }).tenantId, 77);
});

test("Fleet Owner without Fleet Overview gets the next screen they can open", () => {
  const a = access(fleetOwner({ permissions: ["alarm.read"], screens: [] }));
  assert.equal(p.canAccessPath(a, R.overview), false);
  assert.equal(p.defaultLanding(a), R.alerts);
});

// ── Driver ──────────────────────────────────────────────────────────────────

test("Driver lands on My Work", () => {
  const a = access(driverFixture());
  assert.equal(p.defaultLanding(a), MY_WORK);
  assert.equal(p.canDriver(a, "work.read"), true);
});

test("Driver is sent to My Work ahead of Fleet Overview, even holding device.read", () => {
  const raw = driverFixture();
  raw.permissions.push("device.read");
  const a = access(raw);
  assert.equal(p.canAccessPath(a, R.overview), true);
  assert.equal(p.defaultLanding(a), MY_WORK);
});

test("Driver who can't read My Work starts on the first section they can read", () => {
  const raw = driverFixture();
  raw.screens.find((s) => s.menuKey === "my_work").operations[0].allowed = false;
  assert.equal(p.defaultLanding(access(raw)), `${MY_WORK}/shifts`);
});

test("Driver with no section read still goes to My Work, which says so, and never to a fleet screen", () => {
  assert.equal(p.defaultLanding(access(IDENTITIES.driver)), MY_WORK);
});

test("a role code alone grants nothing: DRIVER without driver.app has no landing", () => {
  assert.equal(p.defaultLanding(access({ ...IDENTITIES.driver, permissions: [] })), null);
});

// ── Other roles ─────────────────────────────────────────────────────────────

test("ADMIN, OPERATOR, DISPATCHER and VIEWER prefer Fleet Overview", () => {
  for (const raw of [IDENTITIES.tenantAdmin, operator(), dispatcher(), viewer()]) assert.equal(p.defaultLanding(access(raw)), R.overview, raw.roleCode);
});

test("without Fleet Overview, the server's menu order decides, and only for screens the user can open", () => {
  const raw = { ...viewer(), permissions: ["alarm.read", "report.read"], screens: [{ menuKey: "x", routePath: "/dashboard" }, { menuKey: "r", title: "Reports", routePath: "/reports" }, { menuKey: "a", title: "Alarms", routePath: "/alarms" }] };
  assert.equal(p.defaultLanding(access(raw)), R.reports, "/dashboard needs device.read, so it is skipped");
});

test("no permitted screen: no destination", () => {
  assert.equal(p.defaultLanding(access({ ...viewer(), permissions: [] })), null);
  assert.equal(p.defaultLanding(p.NO_ACCESS), null);
});

test("every destination can actually be opened by that user", () => {
  for (const [name, raw] of Object.entries(ALL)) {
    const a = access(raw);
    const landing = p.defaultLanding(a);
    assert.ok(landing, name);
    assert.equal(p.canAccessPath(a, landing), true, name);
    assert.equal(p.decideRoute("authenticated", a, landing).kind, "allow", name);
  }
});

test("no user id, tenant id or permission grant is hardcoded in the landing code", () => {
  const ui = ["components/drive-vision/auth/route-guard.tsx", "components/drive-vision/auth/auth-gate.tsx", "components/drive-vision/auth/login-screen.tsx"];
  for (const f of ui) assert.doesNotMatch(read(f), /\b469\b|tenantId === \d|"driver\.app/, f);
  const policy = read("features/drive-vision/access/access-policy.ts");
  const fn = policy.slice(policy.indexOf("export function defaultLanding("), policy.indexOf("export function postLoginRoute("));
  assert.doesNotMatch(fn, /roleCode|"ADMIN"|FLEET/);
});

// ── Requested paths ─────────────────────────────────────────────────────────

test("a valid deep link survives sign-in", () => {
  const a = access(fleetOwner());
  assert.equal(p.postLoginRoute(a, R.alerts), R.alerts);
  assert.equal(p.postLoginRoute(a, `${R.vehicles}/3`), `${R.vehicles}/3`);
  assert.equal(p.postLoginRoute(a, `${R.alerts}?tab=open`), `${R.alerts}?tab=open`);
});

test("generic and unknown requests fall back to the user's own default", () => {
  const a = access(IDENTITIES.platformAdmin);
  for (const r of [null, "/drive-vision", "/drive-vision/", "/drive-vision/no-such-page", "/drive-vision-evil"]) assert.equal(p.postLoginRoute(a, r), R.platform, String(r));
});

test("no screen at all: nothing to go to, whatever was requested", () => {
  assert.equal(p.postLoginRoute(p.NO_ACCESS, R.alerts), null);
});

// ── Entry points and the guard ──────────────────────────────────────────────

test("/drive-vision goes to each user's own default", () => {
  assert.equal(p.landingRedirect(access(IDENTITIES.platformAdmin), "/drive-vision"), R.platform);
  assert.equal(p.landingRedirect(access(fleetOwner()), "/drive-vision/"), R.overview);
  assert.equal(p.landingRedirect(access(driverFixture()), "/drive-vision"), MY_WORK);
});

test("the root pages no longer send everyone to Fleet Overview", () => {
  assert.match(read("app/page.tsx"), /redirect\("\/drive-vision"\)/);
  const index = read("app/drive-vision/page.tsx");
  assert.doesNotMatch(index, /redirect\(|overview/);
});

test("nothing is decided before authentication and permissions have loaded", () => {
  const a = p.NO_ACCESS;
  for (const route of ["/drive-vision", MY_WORK, R.platform]) assert.deepEqual({ ...p.decideRoute("unknown", a, route) }, { kind: "checking" });
  const guard = read("components/drive-vision/auth/route-guard.tsx");
  assert.match(guard, /const landing = decision\.kind === "forbidden" \? landingRedirect\(access, pathname\) : null;/);
  assert.match(guard, /if \(landing\) return null;/, "no page renders while resolving");
});

test("an account with no screen gets the no-access state at the entry point, not 'page not found'", () => {
  const d = p.decideRoute("authenticated", access({ ...viewer(), permissions: [] }), "/drive-vision");
  assert.equal(d.kind, "forbidden");
  assert.equal(d.reason, "no-permissions");
  assert.equal(p.decideRoute("authenticated", access(fleetOwner()), "/drive-vision/no-such-page").reason, "unknown-route");
});

test("an unauthorized deep link is denied where it is, so there is no redirect loop", () => {
  const a = access(driverFixture());
  for (const route of [R.users, R.platform, R.alerts]) {
    assert.equal(p.decideRoute("authenticated", a, route).kind, "forbidden", route);
    assert.equal(p.landingRedirect(a, route), null, route);
    assert.equal(p.revokedRouteRedirect(a, route, false), null, route);
  }
});

test("a valid current route is left alone, whatever the role's default is", () => {
  const a = access(fleetOwner());
  assert.equal(p.landingRedirect(a, R.alerts), null);
  assert.equal(p.revokedRouteRedirect(a, R.alerts, true), null);
});

test("a page taken away by a permission re-read moves the user to their default, once", () => {
  const before = access(fleetOwner());
  const after = access(fleetOwner({ permissions: before.identity ? ["device.read"] : [] }));
  assert.equal(p.canAccessPath(before, R.alerts), true);
  assert.equal(p.revokedRouteRedirect(after, R.alerts, true), R.overview);
  assert.equal(p.revokedRouteRedirect(after, R.overview, true), null, "the default itself is open, so it stops there");
});

test("the guard only treats a page as taken away if it had been open on that path", () => {
  const guard = read("components/drive-vision/auth/route-guard.tsx");
  assert.match(guard, /if \(decision\.kind === "allow"\) openPath\.current = pathname;/);
  assert.match(guard, /revokedRouteRedirect\(access, pathname, openPath\.current === pathname\)/);
  assert.match(guard, /openPath\.current = null;/);
});

test("redirects replace the history entry, so Back doesn't bounce off them", () => {
  assert.match(read("components/drive-vision/auth/route-guard.tsx"), /router\.replace\(landing\)/);
  assert.match(read("components/drive-vision/auth/route-guard.tsx"), /router\.replace\(fallback\)/);
  assert.match(read("components/drive-vision/auth/auth-gate.tsx"), /router\.replace\("\/login"\)/);
});

// ── Session switching: the real client and auth store ───────────────────────

const STORAGE_KEY = "safefare:session:v1";

function openApp(first) {
  const storage = new MemoryStorage();
  const world = { identity: first };
  const session = () => JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null });
  storage.setItem(STORAGE_KEY, session());
  const json = (data) => new Response(JSON.stringify({ code: 200, msg: "Success", data }), { status: 200, headers: { "Content-Type": "application/json" } });
  async function fetch(url) {
    const route = new URL(url).pathname.replace("/api/v1", "");
    if (route === "/auth/login") return json({ accessToken: "n.e.w", tokenType: "Bearer", expiresIn: 900, refreshToken: "r2", refreshExpiresIn: 1209600 });
    if (route === "/me/permissions") return json(world.identity);
    if (route === "/auth/logout") return json(null);
    return json({ id: world.identity.userId, displayName: "Test user" });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const r = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, AbortController, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined, useMemo: (f) => f() } });
  const auth = r.require("features/drive-vision/store/auth-store");
  const policy = r.require("features/drive-vision/access/access-policy");
  return {
    world,
    auth,
    client: r.require("features/drive-vision/api/client"),
    landing: (requested) => {
      const identity = auth.getAuthState().identity;
      return policy.postLoginRoute(policy.computeAccess(identity), auth.mayResumeRoute(identity) ? requested : null);
    },
  };
}
const login = (app, identity) => ((app.world.identity = identity), app.auth.signIn({ login: "u", password: "p" }));

test("the leak itself: Driver signs out, Safe-Fare Admin signs in, Platform Overview opens", async () => {
  const app = openApp(driverFixture());
  await app.auth.bootstrapAuth();
  await app.auth.signOut();
  assert.equal(app.auth.getAuthState().endReason, "signed-out");
  assert.equal(app.auth.getAuthState().identity, null);
  await login(app, IDENTITIES.platformAdmin);
  assert.equal(app.landing(null), R.platform, "after a sign-out AuthGate sends no next");
  assert.equal(app.landing(MY_WORK), R.platform, "and an old /login?next= link can't bring it back");
});

test("after a sign-out AuthGate sends the user to a clean /login", () => {
  const gate = read("components/drive-vision/auth/auth-gate.tsx");
  assert.match(gate, /if \(endReason === "signed-out"\) \{\s*router\.replace\("\/login"\);\s*return;\s*\}/);
  assert.match(gate, /new URLSearchParams\(\{ next: pathname \}\)/, "other cases still keep the page");
});

test("the login screen decides only once authenticated, through the access check", () => {
  const login = read("components/drive-vision/auth/login-screen.tsx");
  assert.match(login, /if \(status !== "authenticated"\) return;\s*router\.replace\(postLoginRoute\(access, mayResumeRoute\(access\.identity\) \? requested : null\) \?\? FALLBACK_PATH\);/);
  assert.doesNotMatch(login, /requested \?\? /, "a requested path can't skip the check");
});

test("an expired session: the same user returns to their page", async () => {
  const app = openApp(fleetOwner());
  await app.auth.bootstrapAuth();
  app.client.endSession("expired");
  assert.equal(app.auth.getAuthState().endReason, "expired");
  await login(app, fleetOwner());
  assert.equal(app.landing(R.alerts), R.alerts);
});

test("an expired session: another account doesn't inherit the page, even one it could open", async () => {
  const app = openApp(fleetOwner());
  await app.auth.bootstrapAuth();
  app.client.endSession("expired");
  await login(app, { ...fleetOwner(), userId: 999, roleCode: "OPERATOR" });
  assert.equal(app.landing(R.alerts), R.overview);
});

test("the same user id in another tenant is another account", async () => {
  const app = openApp(fleetOwner());
  await app.auth.bootstrapAuth();
  app.client.endSession("expired");
  await login(app, fleetOwner({ tenantId: 78, homeTenantId: 78 }));
  assert.equal(app.landing(R.alerts), R.overview);
});

test("a sign-out clears the expired owner: it can't block a later user's own deep link", async () => {
  const app = openApp(fleetOwner());
  await app.auth.bootstrapAuth();
  app.client.endSession("expired");
  await login(app, IDENTITIES.platformAdmin);
  await app.auth.signOut();
  await login(app, viewer());
  assert.equal(app.landing(R.alerts), R.alerts, "a link the user opened themselves, which they can access");
});

test("a typed deep link with no earlier session still works", async () => {
  const app = openApp(fleetOwner());
  await app.auth.bootstrapAuth();
  assert.equal(app.landing(R.alerts), R.alerts);
});

test("Driver → Safe-Fare Admin → Fleet Owner: each resolves independently", async () => {
  const app = openApp(driverFixture());
  await app.auth.bootstrapAuth();
  assert.equal(app.landing(null), MY_WORK);
  await app.auth.signOut();
  await login(app, IDENTITIES.platformAdmin);
  assert.equal(app.landing(null), R.platform);
  await app.auth.signOut();
  await login(app, fleetOwner());
  assert.equal(app.landing(null), R.overview);
});

test("a re-read that changes nothing leaves the route alone", async () => {
  const app = openApp(fleetOwner());
  await app.auth.bootstrapAuth();
  await app.auth.refreshIdentity();
  assert.equal(app.landing(R.alerts), R.alerts);
});
