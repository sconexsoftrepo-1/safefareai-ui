// Regression tests for the final frontend audit fixes (docs/evidence/final-frontend-gap-audit.md):
// GA-04 security headers, GA-10 profile menu, GA-11 stale demo wording, GA-12 notification links,
// GA-13 driver password change, GA-14 menu/identity failure (V10), GA-15 trip actions, GA-16 action policy (V10).
// Pure functions and source checks only; no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} }, URL });
const p = realm.require("features/drive-vision/access/access-policy");
const search = realm.require("components/drive-vision/app-shell/search-model");
const mw = realm.require("components/drive-vision/operations/my-work-model");
const sec = realm.require("config/security-headers");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const list = (set) => [...set].sort();

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const { IDENTITIES } = require("./helpers/identities.cjs");
const idm = realm.require("features/drive-vision/access/identity");
const accessFor = (raw) => p.computeAccess(idm.readIdentity(raw));
// V10 identities (GET /me/permissions). "admin" = tenant ADMIN (every tenant permission).
const admin = accessFor(IDENTITIES.tenantAdmin);
const driver = accessFor(IDENTITIES.driver);
const unknown = accessFor({ userId: 5, platform: false, roleCode: "MANAGER", permissions: ["driver.app", "unknown.code"] });

// ── GA-16: central action policy (V10: actions follow permission codes) ─────

test("GA-16: tenant ADMIN gets every fleet action, and nothing of driver self-service or platform configuration", () => {
  // Phase 7: role / permission configuration lives on platform-only screens — never a tenant ADMIN's, even with the codes.
  const platformAction = (a) => p.ACTIONS[a].platformOnly === true || (p.ACTIONS[a].screen !== null && p.SCREENS[p.ACTIONS[a].screen].platformOnly === true);
  same(list(admin.actions), list(p.ALL_ACTIONS.filter((a) => a !== "driver.selfService" && !platformAction(a))));
  for (const a of ["roles.create", "roles.update", "roles.delete", "rolePermissions.add", "rolePermissions.remove", "permissions.create", "permissions.update", "permissions.delete"]) assert.equal(p.canPerform(admin, a), false, a);
  assert.equal(p.canPerform(admin, "driver.selfService"), false);
});

test("GA-16: Driver gets only own password and own notifications from the action policy; its buttons use operations", () => {
  same(list(driver.actions), ["account.password", "notifications.markRead"]);
  for (const a of ["drivers.create", "drivers.update", "drivers.delete", "dispatch.create", "dispatch.update", "swaps.decide", "leave.create", "leave.decide", "alerts.handle", "geofences.delete", "video.export", "users.create", "users.update", "settings.manage"]) assert.equal(p.canPerform(driver, a), false, a);
});

test("GA-16: a driver without driver.app can't open My Work", () => {
  const d = accessFor({ ...IDENTITIES.driver, permissions: ["own.data.read"] });
  same(list(d.actions), ["account.password", "notifications.markRead"]);
});

test("GA-16: unrecognised role codes get no fleet action, whatever their label", () => {
  same(list(unknown.actions).filter((a) => !["account.password", "notifications.markRead", "settings.manage"].includes(a)), []);
  same(list(p.NO_ACCESS.actions), []);
});

test("GA-16: a screen grant never exposes its actions by itself; an action also needs its screen", () => {
  // driver.read opens Drivers, but no write.
  const reader = accessFor({ platform: false, roleCode: "R", permissions: ["driver.read"] });
  assert.equal(p.canAccessScreen(reader, "drivers"), true);
  for (const a of ["drivers.create", "drivers.update", "drivers.delete"]) assert.equal(p.canPerform(reader, a), false, a);
  // A write code without the screen's read code offers nothing.
  const writer = accessFor({ platform: false, roleCode: "R", permissions: ["driver.update", "user.update"] });
  assert.equal(p.canPerform(writer, "drivers.update"), false);
  assert.equal(p.canPerform(writer, "users.update"), false);
  const both = accessFor({ platform: false, roleCode: "R", permissions: ["driver.read", "driver.update"] });
  assert.equal(p.canPerform(both, "drivers.update"), true);
  assert.equal(p.canPerform(both, "users.update"), false);
});

test("GA-16: every write entry point consults the action policy", () => {
  const uses = {
    "components/drive-vision/drivers/drivers-page.tsx": ['useCan("drivers.create")', 'useCan("drivers.update")', 'useCan("drivers.delete")'],
    "components/drive-vision/operations/dispatch-page.tsx": ['useCan("dispatch.create")', 'useCan("dispatch.update")', 'useCan("swaps.decide")'],
    "components/drive-vision/operations/workforce-page.tsx": ['useCan("leave.create")', 'useCan("leave.decide")'],
    "components/drive-vision/alerts/incidents.tsx": ['useCan("alerts.handle")'],
    "components/drive-vision/geofences/geofences-page.tsx": ['useCan("geofences.delete")'],
    "components/drive-vision/video/video-workspace.tsx": ['useCan("video.export")'],
    "components/drive-vision/users/users-page.tsx": ['useCan("users.create")', 'useCan("users.update")'],
    "components/drive-vision/settings/settings-page.tsx": ['useCan("settings.manage")', 'useCan("account.password")'],
    "components/drive-vision/operations/my-work-page.tsx": ['canDriver(access, ', 'canPerform(access, "account.password")'],
    "components/drive-vision/app-shell/notification-center.tsx": ['canPerform(access, "notifications.markRead")'],
  };
  // Phase 5: useActionGate(x) (allowed / tenant-blocked) reads the same central policy as useCan(x).
  const consults = (src, n) => src.includes(n) || (n.startsWith("useCan(") && src.includes(n.replace("useCan(", "useActionGate(")));
  for (const [file, needles] of Object.entries(uses)) for (const n of needles) assert.ok(consults(read(file), n), `${file} uses ${n}`);
  // The coarse pre-V10 keys are gone everywhere.
  for (const file of Object.keys(uses)) for (const old of ['"drivers.manage"', '"dispatch.manage"', '"leave.manage"', '"users.manage"']) assert.ok(!read(file).includes(old), `${file} still uses ${old}`);
});

// ── GA-10: profile menu ─────────────────────────────────────────────────────

test("GA-10: profile menu links follow screen access — Admin keeps both, Driver none, others what they may open", () => {
  same(p.profileMenuLinks(admin), [
    { screen: "settings", label: "Profile & preferences", href: "/drive-vision/settings" },
    { screen: "users", label: "Users & sub-accounts", href: "/drive-vision/users" },
  ]);
  same(p.profileMenuLinks(driver), []);
  // V10: Settings needs only a signed-in identity with permission information; Users needs user.read.
  same(p.profileMenuLinks(unknown), [{ screen: "settings", label: "Profile & preferences", href: "/drive-vision/settings" }]);
  same(p.profileMenuLinks(p.NO_ACCESS), []);
  const menu = read("components/drive-vision/app-shell/user-profile-menu.tsx");
  assert.ok(menu.includes("profileMenuLinks(useAccess())"));
  assert.ok(!menu.includes('href="/drive-vision/settings"') && !menu.includes('href="/drive-vision/users"'), "no hard-coded screen links");
});

// ── GA-11: stale demo wording ───────────────────────────────────────────────

test("GA-11: outdated demo / sample-data wording is gone from live UI and metadata", () => {
  const files = [
    "components/drive-vision/app-shell/sidebar.tsx",
    "components/drive-vision/app-shell/mobile-nav.tsx",
    "components/drive-vision/app-shell/user-profile-menu.tsx",
    "components/drive-vision/settings/settings-page.tsx",
    "components/drive-vision/vehicles/vehicle-detail.tsx",
    "app/layout.tsx",
  ];
  const stale = [/Demo workspace/i, /sample data only/i, /About this demo/i, /sample data; admins only/i, /demo with sample data/i, /still use sample data/i, /DemoNotice/];
  for (const f of files) for (const re of stale) assert.ok(!re.test(read(f)), `${f} still matches ${re}`);
  assert.ok(!/mock data/i.test(JSON.parse(fs.readFileSync(path.join(SRC, "..", "package.json"), "utf8")).description));
});

// ── GA-12: notification links ───────────────────────────────────────────────

test("GA-12: driver notifications open the driver's own screens; other types stay unlinked", () => {
  assert.equal(search.notificationHref("LEAVE_REQUEST", "4", "driver"), "/drive-vision/my-work/leave");
  assert.equal(search.notificationHref("leave", "4", "driver"), "/drive-vision/my-work/leave");
  assert.equal(search.notificationHref("SWAP_REQUEST", "4", "driver"), "/drive-vision/my-work");
  assert.equal(search.notificationHref("DISPATCH", "12", "driver"), "/drive-vision/my-work");
  for (const t of ["ALERT", "DEVICE", "DRIVER", "REPORT"]) assert.equal(search.notificationHref(t, "1", "driver"), null, t);
  // Fleet mapping unchanged.
  assert.equal(search.notificationHref("LEAVE_REQUEST", "4"), "/drive-vision/workforce?tab=leave");
});

test("GA-12: notificationLink uses the role's mapping and drops targets the user can't open", () => {
  assert.equal(search.notificationLink(driver, "LEAVE_REQUEST", "4"), "/drive-vision/my-work/leave");
  assert.equal(search.notificationLink(driver, "ALERT", "4"), null);
  assert.equal(search.notificationLink(admin, "LEAVE_REQUEST", "4"), "/drive-vision/workforce?tab=leave");
  assert.equal(search.notificationLink(admin, "ALERT", "7"), "/drive-vision/alerts?kind=incidents&alarm=7");
  // Admin can't open My Work; unmapped roles open nothing.
  assert.equal(search.notificationLink(unknown, "LEAVE_REQUEST", "4"), null);
  assert.equal(p.reachableHref(driver, "/drive-vision/alerts?kind=incidents"), null);
  assert.equal(p.reachableHref(admin, "/drive-vision/alerts?kind=incidents"), "/drive-vision/alerts?kind=incidents");
  const nc = read("components/drive-vision/app-shell/notification-center.tsx");
  assert.ok(!nc.includes('href="/drive-vision/alerts?kind=incidents"'), "footer link is access-filtered");
  assert.ok(!nc.includes("disabled={!href}"), "no dead button for unlinked items");
});

// ── GA-13: driver password change ───────────────────────────────────────────

test("GA-13: My Profile offers the existing POST /me/password form, gated by account.password", () => {
  const page = read("components/drive-vision/operations/my-work-page.tsx");
  assert.ok(page.includes('on("profile") && canChangePassword ? ('));
  assert.ok(page.includes("<PasswordPanel />"));
  assert.ok(read("components/drive-vision/settings/settings-page.tsx").includes("export function PasswordPanel()"));
  assert.ok(read("features/drive-vision/api/account-service.ts").includes('api.post<unknown>("/me/password", body)'));
  // Passwords are never written to browser storage.
  for (const f of ["components/drive-vision/settings/settings-page.tsx", "components/drive-vision/operations/my-work-page.tsx"]) assert.ok(!/localStorage|sessionStorage/.test(read(f)), f);
});

test("GA-13: the request body matches the spec's ChangePasswordRequest exactly (no confirmation field sent)", () => {
  const model = realm.require("components/drive-vision/settings/settings-model");
  same(model.passwordRequest({ currentPassword: "a", newPassword: "b", confirmPassword: "b" }), { currentPassword: "a", newPassword: "b" });
});

// ── GA-14 (V10): identity failure ───────────────────────────────────────────
// Pre-V10 the driver menu came from GET /me/menus and could fail on its own (MenuLoadError + Retry).
// Since V10 navigation comes from the identity (GET /me/permissions), which is loaded with the session:
// if it fails, the AuthGate shows its retryable error and no shell or navigation renders at all.
// Session-level behaviour is tested in auth-access.test.cjs / auth-login.test.cjs.

test("GA-14: no separate menu-failure path remains; navigation is derived from the identity only", () => {
  assert.ok(!fs.existsSync(path.join(SRC, "components/drive-vision/app-shell/menu-load-error.tsx")));
  assert.ok(!read("components/drive-vision/app-shell/app-shell.tsx").includes("MenuLoadError"));
  const nav = read("components/drive-vision/navigation/use-nav.ts");
  assert.ok(nav.includes("useAccess()") && !/\bs\.menus\b|myMenus/.test(nav));
  const store = read("features/drive-vision/store/auth-store.ts");
  assert.ok(store.includes("authService.myPermissions()") && !store.includes("myMenus"));
});

test("GA-14: without an identity there is no navigation and every route is denied", () => {
  same(p.filterNavGroups([{ label: "My work", items: [{ screen: "myWork" }] }, { label: "Fleet", items: [{ screen: "drivers" }] }], p.NO_ACCESS), []);
  same(p.driverNavEntries(p.NO_ACCESS), []);
  // Direct navigation still follows the policy.
  same(p.decideRoute("authenticated", driver, "/drive-vision/my-work/leave"), { kind: "allow", screen: "myWork" });
  same(p.decideRoute("authenticated", driver, "/drive-vision/workforce"), { kind: "forbidden", screen: "workforce", reason: "no-access" });
});

// ── GA-15: trip actions ─────────────────────────────────────────────────────

test("GA-15: a new trip offers every action (the server decides); status codes are never read", () => {
  same(mw.tripActionAvailability({ id: 1, status: "ANYTHING" }), { accept: null, start: null, complete: null, decline: null, swap: null });
});

test("GA-15: completed, cancelled and declined trips offer nothing, with the reason", () => {
  for (const [facts, reason] of [
    [{ completedAt: "2026-10-30T10:00:00Z", startedAt: "2026-10-30T08:00:00Z" }, "This trip is completed"],
    [{ cancelReason: "Vehicle unavailable" }, "This trip was cancelled"],
    [{ declineReason: "Sick" }, "You declined this trip"],
    [{}, null],
  ]) {
    const a = mw.tripActionAvailability({ id: 1, ...facts });
    if (reason) same(Object.values(a), [reason, reason, reason, reason, reason]);
  }
  same(Object.values(mw.tripActionAvailability({})), Array(5).fill("This trip has no id from the server"));
  // Blank strings are not facts.
  same(mw.tripActionAvailability({ id: 1, cancelReason: "  ", declineReason: "" }).accept, null);
});

test("GA-15: steps already recorded aren't offered again", () => {
  const started = mw.tripActionAvailability({ id: 1, respondedAt: "x", startedAt: "y" });
  same(started, { accept: "This trip has already started", start: "This trip has already started", complete: null, decline: "This trip has already started", swap: null });
  const responded = mw.tripActionAvailability({ id: 1, respondedAt: "x" });
  same(responded, { accept: "You already responded to this trip", start: null, complete: null, decline: null, swap: null });
  same(mw.tripActionAvailability({ id: 1, pendingSwapRequestId: 3 }).swap, "A swap request for this trip is already pending");
});

test("GA-15: withheld reasons are listed once, only for the actions shown", () => {
  const started = mw.tripActionAvailability({ id: 1, startedAt: "y", pendingSwapRequestId: 2 });
  assert.equal(mw.withheldTripReason(started, ["accept", "start", "complete"]), "This trip has already started.");
  assert.equal(mw.withheldTripReason(started, mw.TRIP_ACTIONS), "This trip has already started. A swap request for this trip is already pending.");
  assert.equal(mw.withheldTripReason(mw.tripActionAvailability({ id: 1 }), mw.TRIP_ACTIONS), null);
  assert.ok(read("components/drive-vision/operations/my-work-page.tsx").includes("tripActionAvailability(d)"));
});

// ── GA-04: security headers ─────────────────────────────────────────────────

const header = (hs, key) => hs.find((h) => h.key === key)?.value;

test("GA-04: enforced headers — framing limited to this origin, nosniff, referrer and permissions policy", () => {
  const hs = sec.securityHeaders({ NODE_ENV: "production" });
  assert.equal(header(hs, "X-Frame-Options"), "SAMEORIGIN");
  assert.equal(header(hs, "X-Content-Type-Options"), "nosniff");
  assert.equal(header(hs, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(header(hs, "Permissions-Policy"), /camera=\(\).*geolocation=\(\)/);
  assert.equal(header(hs, "Content-Security-Policy"), "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
});

test("GA-04: report-only CSP allows the configured BFF and base map, and nothing else external", () => {
  const env = { NODE_ENV: "production", NEXT_PUBLIC_API_BASE_URL: "https://bff.example.test/", NEXT_PUBLIC_MAPTILER_KEY: "k" };
  const csp = header(sec.securityHeaders(env), "Content-Security-Policy-Report-Only");
  assert.match(csp, /connect-src 'self' https:\/\/bff\.example\.test https:\/\/api\.maptiler\.com;/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval|ws:/, "no dev-only sources in production");
  // Custom style replaces MapTiler; no key → no MapTiler origin.
  same(sec.connectOrigins({ NEXT_PUBLIC_MAP_STYLE_URL: "https://tiles.example.test/style.json", NEXT_PUBLIC_MAPTILER_KEY: "k" }), ["https://tiles.example.test"]);
  same(sec.connectOrigins({ NEXT_PUBLIC_API_BASE_URL: "not a url", NEXT_PUBLIC_MAPTILER_KEY: " " }), []);
  same(sec.connectOrigins({ NEXT_PUBLIC_API_BASE_URL: "javascript:alert(1)" }), []);
  // Development adds what next dev needs.
  assert.match(sec.reportOnlyCsp({ NODE_ENV: "development" }), /'unsafe-eval'.*ws: wss:/s);
});

test("GA-04: next.config applies the headers to every route", () => {
  const config = fs.readFileSync(path.join(SRC, "..", "next.config.ts"), "utf8");
  assert.ok(config.includes('source: "/:path*", headers: securityHeaders(process.env)'));
});

// ── GA-07 R1 / R2 (responsive defects) ──────────────────────────────────────

test("GA-07 R1: below sm the Vehicles search gets its own row and the selects share the next (as on Users)", () => {
  const page = read("components/drive-vision/vehicles/vehicles-page.tsx");
  assert.ok(page.includes('<FilterBar className="max-sm:w-full">'));
  assert.ok(page.includes('label="Search vehicles" placeholder="Name or device ID" className="max-sm:basis-full"'));
  assert.equal(page.match(/className="max-sm:flex-1"/g)?.length, 2, "both selects share the second row");
});

test("GA-07 R2: attribution sits above the caption row at its measured height", () => {
  const cfg = realm.require("components/drive-vision/map/base-map-config");
  assert.equal(cfg.attributionBottom(22), 40, "one-line caption keeps the previous 40 px offset");
  assert.equal(cfg.attributionBottom(52), 70, "a wrapped two-line caption lifts the attribution above it");
  assert.equal(cfg.attributionBottom(0), 18);
  assert.equal(cfg.attributionBottom(Number.NaN), 18);
  assert.equal(cfg.attributionBottom(-5), 18);
});

test("GA-07 R2: the full attribution is always shown and re-placed whenever the caption row resizes", () => {
  const map = read("components/drive-vision/map/geo-map.tsx");
  assert.ok(map.includes("attributionControl: { compact: false }"), "compact mode collapses the credit on drag");
  assert.ok(!map.includes('style.bottom = "40px"'), "no fixed offset");
  assert.ok(map.includes("new ResizeObserver(place)") && map.includes("observer.observe(caption)"));
  assert.ok(map.includes("<div ref={captionRef}"));
});
