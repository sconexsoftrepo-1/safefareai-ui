// Driver buttons against GET /me/permissions. MOCKED: tests/fixtures/driver-me-permissions.json is built from the written
// brief, not captured from the API. To use the real response, replace that file: nothing here hardcodes a grant.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "driver-me-permissions.json"), "utf8"));
const realm = createRealm({ process: { env: {} } }, { "lucide-react": new Proxy({}, { get: () => "icon" }) });
const policy = realm.require("features/drive-vision/access/access-policy");
const identityModule = realm.require("features/drive-vision/access/identity");
const model = realm.require("components/drive-vision/operations/my-work-model");

const accessFor = (raw) => policy.computeAccess(identityModule.readIdentity(raw));
const OPERATIONS = Object.keys(policy.DRIVER_OPERATIONS);
const setAllowed = (raw, code, allowed) => {
  for (const s of raw.screens) for (const o of s.operations) if (o.permissionCode === code) o.allowed = allowed;
  return raw;
};
const control = (access, operation, extra = {}) => model.driverControl({ allowed: policy.canDriver(access, operation), ...extra });
const PAGE = "components/drive-vision/operations/my-work-page.tsx";

test("the fixture says what it is, and every mapped operation is allowed in it", () => {
  assert.match(fixture()._source, /^SYNTHETIC/);
  const a = accessFor(fixture());
  for (const op of OPERATIONS) assert.equal(policy.canDriver(a, op), true, op);
});

// ── The root cause ──────────────────────────────────────────────────────────

const onMyWork = { "account.password": { screen: "myWork", tenantWrite: false, requires: { anyOf: ["own.data.read"], operations: [] } } };
const withAction = { ...policy.ACCESS_POLICY, actions: onMyWork };

test("root cause: My Safety's readOnly doesn't make the other driver sections read-only", () => {
  const raw = fixture();
  assert.equal(raw.screens.find((s) => s.menuKey === "my_safety").readOnly, true);
  const a = policy.computeAccess(identityModule.readIdentity(raw), withAction);
  assert.equal(a.actions.has("account.password"), true);
  assert.equal(a.screens.has("myWork"), true);
});

test("a screen is read-only when every section that maps to it is", () => {
  const raw = fixture();
  for (const s of raw.screens) s.readOnly = true;
  assert.equal(policy.computeAccess(identityModule.readIdentity(raw), withAction).actions.has("account.password"), false);
});

test("the shared driver.selfService gate is gone from the policy and the page", () => {
  assert.equal(policy.ALL_ACTIONS.includes("driver.selfService"), false);
  assert.doesNotMatch(read(PAGE), /driver\.selfService|canSelfService|noProfile/);
});

// ── The resolver ────────────────────────────────────────────────────────────

test("isScreenOperationAllowed returns the backend's allowed value", () => {
  const raw = fixture();
  const { isScreenOperationAllowed: allowed, readIdentity } = identityModule;
  assert.equal(allowed(readIdentity(raw), "my_leave", "driver.app.leave.create"), true);
  assert.equal(allowed(readIdentity(setAllowed(raw, "driver.app.leave.create", false)), "my_leave", "driver.app.leave.create"), false);
});

test("the resolver fails closed: no data, no screen, no operation, or anything but an explicit true", () => {
  const { isScreenOperationAllowed: allowed, readIdentity } = identityModule;
  const i = readIdentity(fixture());
  assert.equal(allowed(null, "my_work", "driver.app.work.read"), false);
  assert.equal(allowed(undefined, "my_work", "driver.app.work.read"), false);
  assert.equal(allowed(i, "no_such_menu", "driver.app.work.read"), false);
  assert.equal(allowed(i, "my_work", "no.such.code"), false);
  assert.equal(allowed(i, "my_shifts", "driver.app.work.read"), false, "an operation of another screen doesn't count");
  assert.equal(allowed(readIdentity({ ...fixture(), screens: undefined }), "my_work", "driver.app.work.read"), false);
  for (const value of [undefined, null, "true", 1]) {
    const raw = fixture();
    raw.screens[0].operations[0].allowed = value;
    assert.equal(allowed(readIdentity(raw), "my_work", "driver.app.work.read"), false, String(value));
  }
});

test("the resolver reads operations, not permissions or readOnly", () => {
  const { isScreenOperationAllowed: allowed, readIdentity } = identityModule;
  const raw = setAllowed(fixture(), "driver.app.work.respond", false);
  assert.ok(raw.permissions.includes("driver.app.work.respond"), "the code is held, and the operation still says no");
  assert.equal(allowed(readIdentity(raw), "my_work", "driver.app.work.respond"), false);
  const readOnly = fixture();
  readOnly.screens[0].readOnly = true;
  assert.equal(allowed(readIdentity(readOnly), "my_work", "driver.app.work.respond"), true);
});

test("the mapping names no identity and no grant: only menu keys and codes", () => {
  for (const o of Object.values(policy.DRIVER_OPERATIONS)) same(Object.keys(o), ["menuKey", "permissionCode"]);
  for (const f of ["features/drive-vision/access/access-policy.ts", "features/drive-vision/access/identity.ts", PAGE]) assert.doesNotMatch(read(f), /\b469\b|Satish/, f);
});

// ── Every operation, five ways ──────────────────────────────────────────────

for (const op of OPERATIONS) {
  const { permissionCode } = policy.DRIVER_OPERATIONS[op];

  test(`${op}: enabled when allowed and eligible`, () => {
    same(control(accessFor(fixture()), op), { disabled: false, block: null, reason: null });
  });

  test(`${op}: disabled when allowed is false`, () => {
    const c = control(accessFor(setAllowed(fixture(), permissionCode, false)), op);
    same([c.disabled, c.block, c.reason], [true, "permission", model.PERMISSION_DENIED]);
  });

  test(`${op}: fails closed with no permission data`, () => {
    for (const raw of [null, { ...fixture(), screens: [] }, { ...fixture(), screens: fixture().screens.map((s) => ({ ...s, operations: [] })) }]) {
      same(control(accessFor(raw), op).block, "permission");
    }
  });

  test(`${op}: an ineligible state stays disabled although allowed`, () => {
    const c = control(accessFor(fixture()), op, { state: "Not eligible" });
    same([c.disabled, c.block, c.reason], [true, "state", "Not eligible"]);
  });

  test(`${op}: disabled while a request is processing`, () => {
    same(control(accessFor(fixture()), op, { processing: true }).block, "processing");
  });
}

test("a disabled control always names its first reason, permission before anything else", () => {
  const all = { allowed: false, missingData: "m", state: "s", loading: "l", processing: true };
  same(model.driverControl(all).block, "permission");
  same(model.driverControl({ ...all, allowed: true }).block, "data");
  same(model.driverControl({ ...all, allowed: true, missingData: null }).block, "state");
  same(model.driverControl({ ...all, allowed: true, missingData: null, state: null }).block, "loading");
  same(model.driverControl({ ...all, allowed: true, missingData: null, state: null, loading: null }).block, "processing");
});

// ── The three screenshot problems ───────────────────────────────────────────

test("regression, My Leave: Request leave and Cancel request are enabled for a pending request", () => {
  const a = accessFor(fixture());
  assert.equal(control(a, "leave.create").disabled, false);
  assert.equal(control(a, "leave.cancel").disabled, false);
  assert.equal(model.leaveCancelBlock({ id: 1, status: "PENDING" }), null);
});

test("regression, Shift Checklist: Start checklist is enabled, and a template with no items is a real restriction", () => {
  const a = accessFor(fixture());
  assert.equal(control(a, "checklist.submit").disabled, false);
  same(control(a, "checklist.submit", { state: "The server returned no checklist items" }).block, "state");
  assert.match(read(PAGE), /const startChecklist = control\("checklist\.submit", templateItems\.length \? null : /);
});

test("regression, My Work: Accept, Decline, Start, Complete and Swap use their own operations", () => {
  same(model.TRIP_OPERATIONS, { accept: "work.respond", decline: "work.respond", start: "work.execute", complete: "work.execute", swap: "swap.create" });
  const a = accessFor(fixture());
  for (const action of model.TRIP_ACTIONS) assert.equal(control(a, model.TRIP_OPERATIONS[action]).disabled, false, action);
});

test("each trip action follows its own operation only", () => {
  const noRespond = accessFor(setAllowed(fixture(), "driver.app.work.respond", false));
  same(model.TRIP_ACTIONS.map((x) => control(noRespond, model.TRIP_OPERATIONS[x]).disabled), [true, false, false, true, false]);
  const noExecute = accessFor(setAllowed(fixture(), "driver.app.work.execute", false));
  same(model.TRIP_ACTIONS.map((x) => control(noExecute, model.TRIP_OPERATIONS[x]).disabled), [false, true, true, false, false]);
  const noSwap = accessFor(setAllowed(fixture(), "driver.app.swap.create", false));
  same(model.TRIP_ACTIONS.map((x) => control(noSwap, model.TRIP_OPERATIONS[x]).disabled), [false, false, false, false, true]);
});

test("permission doesn't make every trip eligible: the trip's own record still decides", () => {
  const started = model.tripActionAvailability({ id: 1, startedAt: "2026-11-05T08:00:00Z" });
  assert.ok(started.accept && started.start && started.decline);
  assert.equal(started.complete, null);
  const done = model.tripActionAvailability({ id: 1, completedAt: "2026-11-05T09:00:00Z" });
  for (const a of model.TRIP_ACTIONS) assert.ok(done[a], a);
  assert.ok(model.tripActionAvailability({ id: 1, pendingSwapRequestId: 3 }).swap);
});

test("the trip buttons are wired to their operation and to a visible reason", () => {
  const ui = read(PAGE);
  assert.match(ui, /disabled=\{control\(TRIP_OPERATIONS\[a\]\)\.disabled\}/);
  assert.match(ui, /offered\.map\(\(a\) => control\(TRIP_OPERATIONS\[a\]\)\.reason\)/);
});

// ── Leave status ────────────────────────────────────────────────────────────

test("only an undecided pending request can be cancelled, whatever the case of the status", () => {
  for (const status of ["APPROVED", "REJECTED", "CANCELLED"]) assert.ok(model.leaveCancelBlock({ id: 1, status }), status);
  assert.equal(model.leaveCancelBlock({ id: 1, status: "pending" }), null);
  assert.ok(model.leaveCancelBlock({ id: 1, status: "PENDING", decidedAt: "2026-11-05T08:00:00Z" }));
  assert.ok(model.leaveCancelBlock({ status: "PENDING" }), "no id, nothing to cancel");
  assert.equal(model.leaveCancelBlock({ id: 1 }), null, "no status: decidedAt alone decides, as before");
  assert.ok(model.leaveCancelBlock({ id: 1, decidedAt: "2026-11-05T08:00:00Z" }));
});

test("regression: a cancelled request with no decision date no longer offers Cancel request", () => {
  assert.equal(model.leaveCancelBlock({ id: 1, status: "CANCELLED" }), "This request is cancelled");
});

// ── Screens ─────────────────────────────────────────────────────────────────

test("each section opens on its own read operation, and fetches nothing without it", () => {
  same(Object.keys(model.SECTION_READ), ["work", "shifts", "leave", "checklist", "safety", "profile"]);
  const ui = read(PAGE);
  assert.match(ui, /const canRead = canDriver\(access, SECTION_READ\[section\]\);/);
  assert.match(ui, /const on = \(\.\.\.s: MyWorkSection\[\]\) => canRead && s\.includes\(section\);/);
  assert.match(ui, /useApiQuery\(canRead \? `me:driver:\$\{version\}` : null/);
  assert.match(ui, /if \(!canRead\) \{/);
});

test("My Safety stays read-only: it has one operation and the section has no write control", () => {
  same(fixture().screens.find((s) => s.menuKey === "my_safety").operations.map((o) => o.permissionCode), ["driver.app.safety.read"]);
  same(OPERATIONS.filter((o) => policy.DRIVER_OPERATIONS[o].menuKey === "my_safety"), ["safety.read"]);
  const ui = read(PAGE);
  const safety = ui.slice(ui.indexOf('{on("safety") ? ('), ui.indexOf("{/* ── My Profile"));
  assert.doesNotMatch(safety, /<Button|control\(/);
});

test("My Profile keeps viewing apart from editing", () => {
  const a = accessFor(setAllowed(fixture(), "driver.app.profile.update", false));
  assert.equal(policy.canDriver(a, "profile.read"), true);
  assert.equal(control(a, "profile.update").disabled, true);
  assert.match(read(PAGE), /const editContact = control\("profile\.update"\);/);
});

test("notifications stay as they were: no driver write operation is added", () => {
  same(OPERATIONS.filter((o) => policy.DRIVER_OPERATIONS[o].menuKey === "driver_notifications"), []);
});

test("every disabled control says why on the page, because a disabled button can't show a tooltip", () => {
  const ui = read(PAGE);
  for (const name of ["shiftControl", "requestLeave", "startChecklist", "editContact"]) assert.match(ui, new RegExp(`<ControlNote control=\\{${name}\\} />`), name);
  assert.match(ui, /<ControlNote control=\{control\("leave\.cancel"\)\} \/>/);
  assert.match(read("components/ui/button.tsx"), /disabled:pointer-events-none/, "why title isn't enough");
});

test("a dialog in progress disables the buttons behind it", () => {
  assert.match(read(PAGE), /const processing = pending !== null \|\| contactOpen \|\| leaveOpen \|\| checklistOpen;/);
});

test("checklist rules are kept: every item answered, a critical failure shown, one submission at a time", () => {
  const ui = read(PAGE);
  assert.match(ui, /if \(saving \|\| !answered\) return;/);
  assert.match(ui, /a critical item failed/);
  assert.match(ui, /type="submit" form="checklist-form" className=\{TOUCH\} disabled=\{saving \|\| items\.length === 0\}/);
});

// ── Work CRUD codes ─────────────────────────────────────────────────────────

test("the work CRUD codes enable nothing: held in permissions, but no button uses them", () => {
  const crud = ["driver.app.work.create", "driver.app.work.update", "driver.app.work.delete"];
  const raw = fixture();
  for (const c of crud) assert.ok(raw.permissions.includes(c), c);
  for (const s of raw.screens) for (const o of s.operations) assert.equal(crud.includes(o.permissionCode), false);
  for (const o of Object.values(policy.DRIVER_OPERATIONS)) assert.equal(crud.includes(o.permissionCode), false);
  for (const c of crud) assert.equal(read(PAGE).includes(c), false, c);
  const respondMissing = setAllowed(fixture(), "driver.app.work.respond", false);
  assert.equal(control(accessFor(respondMissing), "work.respond").disabled, true, "holding CRUD codes doesn't stand in for respond");
});

// ── Authentication: the real client and auth store ──────────────────────────

const STORAGE_KEY = "safefare:session:v1";

function openApp() {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r1", refreshExpiresAt: null }));
  const world = { permissions: fixture(), calls: [] };
  const json = (data) => new Response(JSON.stringify({ code: 200, msg: "Success", data }), { status: 200, headers: { "Content-Type": "application/json" } });
  async function fetch(url) {
    const p = new URL(url).pathname.replace("/api/v1", "");
    world.calls.push(p);
    if (p === "/auth/refresh") return json({ accessToken: "n.e.w", tokenType: "Bearer", expiresIn: 900, refreshToken: "r2", refreshExpiresIn: 1209600 });
    if (p === "/me/permissions") return json(world.permissions);
    if (p === "/auth/logout") return json(null);
    return json({ id: world.permissions.userId, displayName: "Test driver" });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const r = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, AbortController, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined, useMemo: (f) => f() } });
  return { world, auth: r.require("features/drive-vision/store/auth-store"), client: r.require("features/drive-vision/api/client"), id: r.require("features/drive-vision/access/identity") };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const LEAVE = ["my_leave", "driver.app.leave.create"];

test("a token refresh re-reads /me/permissions, so a changed permission reaches the buttons", async () => {
  const app = openApp();
  await app.auth.bootstrapAuth();
  assert.equal(app.id.isScreenOperationAllowed(app.auth.getAuthState().identity, ...LEAVE), true);
  setAllowed(app.world.permissions, LEAVE[1], false);
  await app.client.refreshSession("test");
  await settle();
  assert.equal(app.id.isScreenOperationAllowed(app.auth.getAuthState().identity, ...LEAVE), false);
  same(app.world.calls.filter((c) => c === "/me/permissions").length, 2);
});

test("sign-out clears the permissions: nothing of the last account stays", async () => {
  const app = openApp();
  await app.auth.bootstrapAuth();
  await app.auth.signOut();
  assert.equal(app.auth.getAuthState().identity, null);
  assert.equal(app.id.isScreenOperationAllowed(app.auth.getAuthState().identity, ...LEAVE), false);
});

test("a failed permission re-read drops the identity instead of keeping it stale", async () => {
  const app = openApp();
  await app.auth.bootstrapAuth();
  app.world.permissions = undefined;
  await app.client.refreshSession("test");
  await settle();
  assert.equal(app.id.isScreenOperationAllowed(app.auth.getAuthState().identity, ...LEAVE), false);
});
