// Role menu permissions on the Permission Catalogue screen. MOCKED / SYNTHETIC ONLY: grids follow the examples
// in docs/contracts/role-menu-permission-api.txt, identities are synthetic and every request goes to a stub fetch.
// Nothing here talks to the BFF, so a pass says nothing about the live backend.
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
const m = pure.require("components/drive-vision/platform/role-menu-permission-model");
const errors = pure.require("features/drive-vision/api/errors");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const nav = pure.require("components/drive-vision/navigation/use-nav");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });

const cell = (permissionCode, granted = false, editable = true) => ({ permissionCode, granted, editable });
const row = (label, extra = {}) => ({ label, view: null, add: null, edit: null, delete: null, actions: [], ...extra });
const action = (label, permissionCode, granted = false, editable = true) => ({ label, ...cell(permissionCode, granted, editable) });

/** The contract's OPERATOR example, plus a menu with no operations and one needing no permission. */
const operatorDto = () => ({
  tenantId: 1,
  roleId: 3,
  roleCode: "OPERATOR",
  fullAccess: false,
  editable: true,
  menus: [
    { menuId: 4, menuKey: "dashboard", title: "Fleet Overview", icon: "layout-dashboard", parentId: null, sortOrder: 10, access: cell("device.read", true), resources: [row("Fleet overview", { view: cell("device.read", true) })] },
    {
      menuId: 7,
      menuKey: "vehicles_assets",
      title: "Vehicles & Assets",
      parentId: null,
      sortOrder: 40,
      access: cell("device.read", true),
      resources: [
        row("Vehicles", { view: cell("device.read", true), add: cell("device.create"), edit: cell("device.update"), delete: cell("device.delete") }),
        row("Device groups", { view: cell("group.read", true), add: cell("group.create") }),
        row("Maintenance reminders", { view: cell("maintenance.read", true), add: cell("maintenance.create"), edit: cell("maintenance.update") }),
        row("Service renewals", { actions: [action("Service renewals", "renewal.manage")] }),
      ],
    },
    { menuId: 66, menuKey: "sensors", title: "Sensors", parentId: null, sortOrder: 47, access: cell("sensor.read"), resources: [row("Sensors", { view: cell("sensor.read"), actions: [action("Sensors", "sensor.ingest")] })] },
    {
      menuId: 9,
      menuKey: "alerts_events",
      title: "Alerts & Events",
      parentId: null,
      sortOrder: 60,
      access: cell("alarm.read", true),
      resources: [row("Alerts", { view: cell("alarm.read", true) }), row("Handle alerts", { actions: [action("Handle alerts", "alarm.handle", true)] }), row("Alarm rules", { view: cell("alarm.rule.read", true), add: cell("alarm.rule.create") })],
    },
    { menuId: 70, menuKey: "only_module", title: "Module only", parentId: null, sortOrder: 70, access: cell("only.read", true), resources: [] },
    { menuId: 71, menuKey: "open_menu", title: "No permission needed", parentId: null, sortOrder: 71, access: null, resources: [row("Open row", { view: cell("open.read", true) })] },
  ],
  otherPermissionCodes: ["own.data.read"],
});
const grid = (dto = operatorDto()) => m.readGrid(dto);
const G = grid();
const sel = (g = G) => m.grantedCodes(g);
const box = (g, label) => g.menus.flatMap((x) => x.resources).find((r) => r.label === label);
const menu = (g, key) => g.menus.find((x) => x.menuKey === key);
const off = (g, key, s) => m.isMenuOff(menu(g, key), s);

// ── Reading the grid ────────────────────────────────────────────────────────

test("#6 checked and unchecked boxes are the API's granted values; only an explicit true grants or edits", () => {
  same([...sel()].sort(), ["alarm.handle", "alarm.read", "alarm.rule.read", "device.read", "group.read", "maintenance.read", "only.read", "open.read"]);
  const vehicles = box(G, "Vehicles");
  same(vehicles.view, { code: "device.read", granted: true, editable: true });
  same(vehicles.add, { code: "device.create", granted: false, editable: true });
  const sloppy = operatorDto();
  sloppy.menus[0].access = { permissionCode: "x.y", granted: "true", editable: 1 };
  same(grid(sloppy).menus[0].access, { code: "x.y", granted: false, editable: false });
});

test("#7 null cells stay null in the grid: they have no code; a cell without a code is treated as null", () => {
  const renewals = box(G, "Service renewals");
  for (const k of ["view", "add", "edit", "delete"]) assert.equal(renewals[k], null, k);
  same(m.resourceCells(renewals).map((c) => c.code), ["renewal.manage"]);
  assert.equal(box(G, "Maintenance reminders").delete, null);
  const broken = operatorDto();
  broken.menus[0].resources[0].view = { granted: true, editable: true };
  assert.equal(grid(broken).menus[0].resources[0].view, null);
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /\{cell \? box\(cell, [^\n]*: <UnmappedBox /, "a null cell gets the unmapped box, never a coded one");
});

test("menus: built from the response, children under their parent, siblings by sortOrder, a null access or no resources handled", () => {
  same(G.menus.map((x) => x.menuKey), ["dashboard", "vehicles_assets", "sensors", "alerts_events", "only_module", "open_menu"], "the contract's example order 60 before 47 is sorted");
  assert.equal(menu(G, "open_menu").access, null);
  same(menu(G, "only_module").resources, []);
  const dto = operatorDto();
  dto.menus.push({ menuId: 80, menuKey: "child", title: "Child", parentId: 7, sortOrder: 1, access: cell("c.read"), resources: [] });
  dto.menus.push({ menuId: 81, menuKey: "orphan", title: "Orphan", parentId: 999, sortOrder: 5, access: cell("o.read"), resources: [] });
  const g = grid(dto);
  same(g.menus.map((x) => x.menuKey), ["orphan", "dashboard", "vehicles_assets", "child", "sensors", "alerts_events", "only_module", "open_menu"]);
  assert.equal(menu(g, "child").depth, 1);
  same(m.readGrid(undefined).menus, []);
  same(grid({ menus: "junk", otherPermissionCodes: 5 }).otherPermissionCodes, []);
  assert.equal(m.readGrid(undefined).editable, false, "fail closed");
});

test("the UI has no hardcoded menu names, resource names or permission codes for the grid", () => {
  for (const f of ["components/drive-vision/platform/role-permission-matrix.tsx", "components/drive-vision/platform/role-menu-permission-model.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /"(?:device|alarm|group|maintenance|video|sensor|driver)\.[a-z.]+"|Vehicles & Assets|Device groups|vehicles_assets|"ADMIN"/, f);
  }
});

// ── Shared codes ────────────────────────────────────────────────────────────

test("#8 a shared code moves as one: every box reads the same selection", () => {
  const dto = operatorDto();
  dto.menus[0].resources[0].actions = [action("Extra", "alarm.handle", true)]; // alarm.handle in two menus
  const g = grid(dto);
  const next = m.setPermission(g, sel(g), "alarm.handle", false);
  const cells = m.allCells(g).filter((c) => c.code === "alarm.handle");
  assert.equal(cells.length, 2);
  for (const c of cells) assert.equal(next.has(c.code), false);
  assert.equal(m.codeUsage(g).get("alarm.handle"), 2);
  assert.equal(m.codeUsage(g).get("device.read"), 4, "device.read: two modules and two View boxes");
  same(m.permissionCodesToSave(g, m.setPermission(g, sel(g), "device.create", true)).filter((c) => c === "device.create"), ["device.create"], "sent once");
});

test("#8 a shared code with one read-only box: each box keeps its own flag, and the code still moves as one", () => {
  const dto = operatorDto();
  dto.menus[1].resources[0].view.editable = false;
  const g = grid(dto);
  const s = sel(g);
  const dash = menu(g, "dashboard");
  const vehicles = menu(g, "vehicles_assets");
  assert.equal(m.cellDisabled(vehicles.resources[0].view, { locked: false }), true, "the read-only box");
  assert.equal(m.cellDisabled(dash.resources[0].view, { locked: false }), false, "the editable box of the same code");
  const off = m.setPermission(g, s, "device.read", false);
  same(m.allCells(g).filter((c) => c.code === "device.read").map((c) => off.has(c.code)), [false, false, false, false], "every box shows the same state");
});

// ── Module checkbox ─────────────────────────────────────────────────────────

test("#9 unticking a module unticks that menu; its boxes stay usable, by each cell's own flag", () => {
  const next = m.setPermission(G, sel(), "alarm.read", false);
  for (const c of ["alarm.read", "alarm.handle", "alarm.rule.read"]) assert.equal(next.has(c), false, c);
  assert.equal(next.has("device.read"), true, "other menus untouched");
  assert.equal(off(G, "alerts_events", next), true);
  const alerts = menu(G, "alerts_events");
  for (const c of [alerts.access, ...m.menuCells(alerts)]) assert.equal(m.cellDisabled(c, { locked: false }), false, c.code);
});

test("#9 re-ticking a module grants nothing else and gives the boxes back to their editable values", () => {
  const dto = operatorDto();
  dto.menus[3].resources[1].actions[0].editable = false; // alarm.handle read-only
  const g = grid(dto);
  const offState = m.setPermission(g, sel(g), "alarm.read", false);
  assert.equal(offState.has("alarm.handle"), true, "a read-only box isn't unticked: the backend would refuse it");
  const on = m.setPermission(g, offState, "alarm.read", true);
  assert.equal(on.has("alarm.read"), true);
  assert.equal(on.has("alarm.rule.read"), false, "not restored automatically");
  assert.equal(on.has("alarm.rule.create"), false, "not granted automatically");
  const alerts = menu(g, "alerts_events");
  const canChange = m.menuCells(alerts).filter((c) => !m.cellDisabled(c, { locked: false })).map((c) => c.code);
  same(canChange, ["alarm.read", "alarm.rule.read", "alarm.rule.create"], "alarm.handle stays disabled: editable false");
});

test("#9 + #8 a module code shared by several menus closes all of them; unticking its View box is the same permission", () => {
  for (const code of ["device.read"]) {
    const next = m.setPermission(G, sel(), code, false);
    for (const key of ["dashboard", "vehicles_assets"]) assert.equal(off(G, key, next), true, key);
    for (const c of ["group.read", "maintenance.read"]) assert.equal(next.has(c), false, `${c}: belongs to the closed menu`);
    assert.equal(next.has("alarm.read"), true, "menus on other codes stay");
  }
});

test("#9 closing a menu follows module codes it unticks onward, and stops at read-only boxes", () => {
  const dto = operatorDto();
  dto.menus[1].resources[1].view = cell("sensor.read", true); // Vehicles & Assets holds Sensors' module code
  const g = grid(dto);
  const s = new Set([...sel(g), "sensor.ingest"]);
  const next = m.setPermission(g, s, "device.read", false);
  assert.equal(off(g, "sensors", next), true);
  assert.equal(next.has("sensor.ingest"), false, "Sensors closed in turn");
});

test("#9 a grid loaded with a closed module keeps the server's ticks: reading it changes nothing", () => {
  const dto = operatorDto();
  dto.menus[3].access.granted = false; // alarm.read off everywhere
  dto.menus[3].resources[0].view.granted = false;
  const g = grid(dto);
  same(m.diffPermissions(g, sel(g)), { added: [], removed: [], unchanged: m.permissionCodesToSave(g, sel(g)) });
  assert.equal(sel(g).has("alarm.handle"), true);
});

test("a menu with no module box (access null) is never closed", () => {
  assert.equal(off(G, "open_menu", new Set()), false);
});

// ── Read-only ───────────────────────────────────────────────────────────────

test("#10 editable:false boxes can't change, in the model and in the UI state", () => {
  const dto = operatorDto();
  dto.menus[3].resources[1].actions[0].editable = false;
  const g = grid(dto);
  const s = sel(g);
  assert.equal(m.setPermission(g, s, "alarm.handle", false), s);
  const alerts = menu(g, "alerts_events");
  assert.equal(m.cellDisabled(alerts.resources[1].actions[0], { locked: false }), true);
  assert.equal(m.setPermission(g, s, "not.in.grid", true), s, "an unknown code changes nothing");
});

test("#11 ADMIN: fullAccess, editable false: every box ticked and disabled, nothing can change, nothing can be saved", () => {
  const dto = operatorDto();
  dto.roleId = 1;
  dto.roleCode = "ADMIN";
  dto.fullAccess = true;
  dto.editable = false;
  for (const x of dto.menus) {
    if (x.access) Object.assign(x.access, { granted: true, editable: false });
    for (const r of x.resources) {
      for (const k of ["view", "add", "edit", "delete"]) if (r[k]) Object.assign(r[k], { granted: true, editable: false });
      for (const a of r.actions) Object.assign(a, { granted: true, editable: false });
    }
  }
  const g = grid(dto);
  const s = sel(g);
  same([...m.editableCodes(g)], []);
  for (const c of m.allCells(g)) {
    assert.equal(s.has(c.code), true, c.code);
    assert.equal(m.cellDisabled(c, { locked: true }), true);
    assert.equal(m.setPermission(g, s, c.code, false), s);
  }
  assert.notEqual(m.saveBlock(g, s, { canUpdate: true }), null);
  const unlocked = operatorDto();
  unlocked.editable = false; // a cell says editable, the grid doesn't: the grid wins
  same([...m.editableCodes(grid(unlocked))], []);
});

// ── Saving ──────────────────────────────────────────────────────────────────

test("#13 save sends exactly the ticked grid codes: unique, read-only ones included, null cells impossible", () => {
  const dto = operatorDto();
  dto.menus[3].resources[1].actions[0].editable = false;
  const g = grid(dto);
  const next = m.setPermission(g, sel(g), "device.create", true);
  same(m.permissionCodesToSave(g, next), ["alarm.handle", "alarm.read", "alarm.rule.read", "device.create", "device.read", "group.read", "maintenance.read", "only.read", "open.read"]);
});

test("#12 otherPermissionCodes are kept: shown, but never sent and never counted as a change", () => {
  same(G.otherPermissionCodes, ["own.data.read"]);
  const s = new Set([...m.setPermission(G, sel(), "device.create", true), "own.data.read"]);
  assert.equal(m.permissionCodesToSave(G, s).includes("own.data.read"), false);
  const d = m.diffPermissions(G, s);
  for (const k of ["added", "removed", "unchanged"]) assert.equal(d[k].includes("own.data.read"), false, k);
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(read("components/drive-vision/platform/role-menu-permission-model.ts"), /const sent = permissionCodesToSave\(latest, selected\);\s*const dto = await api\.saveMatrix\(expected\.roleId, sent\);/);
  assert.match(ui, /saveIfUnchanged\(/);
});

test("#14 no changes, no request: back to the server's state is no change, and save refuses", () => {
  const s = sel();
  assert.equal(m.hasChanges(m.diffPermissions(G, s)), false);
  assert.equal(m.saveBlock(G, s, { canUpdate: true }), "No changes to save.");
  const there = m.setPermission(G, s, "device.create", true);
  assert.equal(m.saveBlock(G, there, { canUpdate: true }), null);
  const back = m.setPermission(G, there, "device.create", false);
  assert.equal(m.hasChanges(m.diffPermissions(G, back)), false);
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /if \(!shownGrid \|\| roleId === null \|\| block !== null \|\| saving\) return;/);
  assert.match(ui, /disabled=\{block !== null \|\| saving\} data-testid="matrix-save"/);
});

test("review: added, removed, unchanged; the 300 limit and missing rights block the save", () => {
  const next = m.setPermission(G, m.setPermission(G, sel(), "device.create", true), "alarm.handle", false);
  same(m.diffPermissions(G, next), { added: ["device.create"], removed: ["alarm.handle"], unchanged: ["alarm.read", "alarm.rule.read", "device.read", "group.read", "maintenance.read", "only.read", "open.read"] });
  assert.match(m.saveBlock(G, next, { canUpdate: false }), /role\.permission\.update/);
  const dto = operatorDto();
  dto.menus[0].resources = Array.from({ length: 301 }, (_, i) => row(`R${i}`, { view: cell(`x.c${i}`, true) }));
  const big = grid(dto);
  const s = m.setPermission(big, sel(big), "device.create", true);
  assert.match(m.saveBlock(big, s, { canUpdate: true }), /At most 300/);
});

test("#15 + #16 the UI: success shown only after the PUT resolved, then a re-read; a failure keeps the edits", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const save = ui.slice(ui.indexOf("async function save()"), ui.indexOf("const switchDescription"));
  assert.ok(save.indexOf("await saveIfUnchanged") < save.indexOf("toast.success"), "no success before the PUT resolved");
  assert.ok(save.indexOf("matrixQ.refetch()") > save.indexOf("await saveIfUnchanged"), "re-read after the save");
  assert.match(save, /setSaved\(\{ key: editKey, readAt: matrixQ\.updatedAt, dto: outcome\.dto \}\)/, "the saved response shows until the re-read arrives");
  const failure = save.slice(save.indexOf("catch (err)"));
  assert.doesNotMatch(failure, /toast\.success|setEdits/, "a failure neither claims success nor touches the edits");
  assert.match(failure, /throw err/, "the review dialog stays open");
  assert.match(ui, /onConfirm=\{save\}/, "saving goes through the review");
});

// ── Errors ──────────────────────────────────────────────────────────────────

test("errors: each documented code gets a heading and keeps the backend's own message", () => {
  const err = (status, errorCode, message, fieldErrors) => new errors.ApiError({ kind: "http", status, errorCode, message, fieldErrors, requestId: "req-1", method: "PUT", path: "/x" });
  for (const code of ["TENANT_REQUIRED", "INVALID_TENANT", "TENANT_ACCESS_DENIED", "PROTECTED_ROLE", "VALIDATION_FAILED", "INVALID_VALUE", "FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"]) {
    const e = m.matrixError(err(400, code, `backend says ${code}`));
    assert.notEqual(e.title, "The server refused the change", code);
    assert.match(e.detail, new RegExp(`backend says ${code}`));
    assert.match(e.meta, /ref req-1/);
  }
  assert.match(m.matrixError(err(400, "VALIDATION_FAILED", "Bad", [{ field: "permissionCodes", message: "too many" }])).detail, /Bad permissionCodes: too many/);
  assert.equal(m.matrixError(err(403, undefined, "No")).title, "You don't have permission to do this");
  assert.equal(m.matrixError(err(500, "BOOM", "Broken")).title, "The server refused the change");
});

test("#17 a grid of another tenant or role is refused, never shown", () => {
  assert.equal(m.gridMismatch(G, { tenantId: 1, roleId: 3 }), null);
  assert.match(m.gridMismatch(G, { tenantId: 2, roleId: 3 }), /tenant 1 instead of tenant 2/);
  assert.match(m.gridMismatch(G, { tenantId: 1, roleId: 4 }), /role 3 instead of role 4/);
  assert.equal(m.gridMismatch(G, { tenantId: null, roleId: 3 }), null, "tenant unknown to the client: the token decides");
});

test("search matches menu titles, resource labels and codes", () => {
  same(m.filterMenus(G.menus, "renewal").map((x) => x.menuKey), ["vehicles_assets"]);
  same(m.filterMenus(G.menus, "HANDLE").map((x) => x.menuKey), ["alerts_events"]);
  assert.equal(m.filterMenus(G.menus, "  ").length, G.menus.length);
});

// ── Requests through the real client ────────────────────────────────────────

const STORAGE_KEY = "safefare:session:v1";
function openRealm(respond = () => [200, { code: 200, msg: "Success", data: null }]) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const call = { method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, body] = await respond(call);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm(
    { console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } },
    { react: { useSyncExternalStore: () => undefined, useMemo: (f) => f() } }
  );
  const r = (x) => realm.require(x);
  const policy = r("features/drive-vision/access/access-policy");
  const identity = r("features/drive-vision/access/identity");
  return {
    calls,
    model: r("components/drive-vision/platform/role-menu-permission-model"),
    svc: r("features/drive-vision/api/role-menu-service").roleMenuService,
    platform: r("features/drive-vision/api/platform-service").platformService,
    role: r("features/drive-vision/api/role-admin-service").roleAdminService,
    tenant: r("features/drive-vision/api/tenant-context"),
    store: r("features/drive-vision/store/tenant-store"),
    access: (raw, id) => policy.computeAccess(identity.readIdentity(raw), undefined, { selectedTenantId: id }),
  };
}
const ok = (data) => [200, { code: 200, msg: "Success", data }];
const fail = (status, errorCode, msg) => [status, { code: status, msg, data: null, extend: { errorCode, fieldErrors: [], requestId: "req-9" } }];
const tenantOf = (c) => Object.entries(c.headers).find(([k]) => k.toLowerCase() === "x-tenant-id")?.[1];
const SFA = { ...IDENTITIES.platformAdmin };
const T1 = { tenantId: 1, code: "Ganesh", name: "Ganesh Travels", header: "X-Tenant-Id" };

test("#1 the role dropdown loads from GET /roles", async () => {
  const s = openRealm(() => [200, { code: 200, msg: "Success", data: [{ id: 1, code: "ADMIN" }, { id: 3, code: "OPERATOR", description: "Operations user" }], total: 2 }]);
  const list = await s.svc.listRoles();
  same(s.calls.map((c) => [c.method, c.path]), [["GET", "/roles"]]);
  same(list.items.map((r) => r.code), ["ADMIN", "OPERATOR"]);
});

test("#2 Safe-Fare Admin: tenants from GET /platform/tenants?status=ACTIVE with no tenant header; nothing else loads before a tenant is chosen", async () => {
  const s = openRealm(() => ok([{ id: 1, code: "Ganesh", name: "Ganesh Travels", status: "ACTIVE" }]));
  s.tenant.setTenantSelection(T1);
  await s.platform.activeTenants();
  same(s.calls.map((c) => [c.path, c.query.status, tenantOf(c) ?? null]), [["/platform/tenants", "ACTIVE", null]]);
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /const tenantReady = hasTenantContext\(access\)/);
  assert.match(ui, /useApiQuery\(tenantReady && canListRoles \? "role-matrix:roles" : null/, "no role list without a tenant");
  assert.match(ui, /useApiQuery\(role && canReadGrid \? `role-matrix:grid:\$\{roleId\}` : null/, "no grid without a role of this tenant's list");
  assert.match(ui, /title="Select a tenant"/, "a clear message");
  assert.equal(p.hasTenantContext(access(SFA)), false);
  assert.equal(p.hasTenantContext(access(SFA, 1)), true);
});

test("#3 every role-permission request carries the selected tenant in X-Tenant-Id, as a header only", async () => {
  const s = openRealm(() => ok([]));
  s.tenant.setTenantSelection(T1);
  await s.svc.listRoles();
  await s.svc.getMatrix(3);
  await s.svc.saveMatrix(3, ["device.read"]);
  same(s.calls.map((c) => [c.method, c.path, tenantOf(c)]), [
    ["GET", "/roles", "1"],
    ["GET", "/roles/3/menu-permissions", "1"],
    ["PUT", "/roles/3/menu-permissions", "1"],
  ]);
  for (const c of s.calls) {
    assert.equal("tenantId" in c.query, false);
    assert.match(c.headers.Authorization, /^Bearer /);
  }
  same(s.calls[2].body, { permissionCodes: ["device.read"] });
});

test("#3 the tenant follows the selection: a switch changes the header on the next request", async () => {
  const s = openRealm(() => ok([]));
  s.tenant.setTenantSelection(T1);
  await s.svc.getMatrix(3);
  s.tenant.setTenantSelection({ ...T1, tenantId: 2, code: "B", name: "B" });
  await s.svc.getMatrix(3);
  same(s.calls.map(tenantOf), ["1", "2"]);
});

test("#4 tenant users: no tenant header, no way to select one, and no picker", async () => {
  const s = openRealm(() => ok({ tenantId: 7, code: "X", name: "X", header: "X-Tenant-Id" }));
  await s.svc.listRoles();
  await s.svc.getMatrix(3);
  await s.svc.saveMatrix(3, []);
  for (const c of s.calls) assert.equal(tenantOf(c), undefined, c.path);
  const before = s.calls.length;
  assert.equal(await s.store.selectTenant(s.access(IDENTITIES.tenantAdmin), { id: 7, status: "ACTIVE" }), false);
  assert.equal(s.tenant.getTenantSelection(), null);
  assert.equal(s.calls.length, before, "not even the switch request");
  const a = s.access(IDENTITIES.tenantAdmin, 99);
  assert.equal(a.tenantId, IDENTITIES.tenantAdmin.tenantId, "a stray selection can't override the token's tenant");
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /\{ctx\.isPlatformUser \? \(\s*<div[^>]*>\s*<label htmlFor="rpm-tenant"/, "the picker is for platform users only");
  assert.match(ui, /useApiQuery\(ctx\.canSelectTenant \? "role-matrix:tenants" : null/, "tenant users never read the tenant list");
  assert.doesNotMatch(read("features/drive-vision/api/role-menu-service.ts"), /tenant: "none"|tenantId|X-Tenant-Id"/, "the service passes no tenant of its own");
});

test("#5 selecting a role loads GET /roles/{roleId}/menu-permissions", async () => {
  const s = openRealm(() => ok(operatorDto()));
  const g = m.readGrid(await s.svc.getMatrix(3));
  same(s.calls.map((c) => c.path), ["/roles/3/menu-permissions"]);
  assert.equal(g.roleCode, "OPERATOR");
});

test("#15 a refused save rejects with the backend's error", async () => {
  const s = openRealm(() => fail(403, "FORBIDDEN", "You cannot grant or remove permissions you do not hold: [device.create]"));
  await assert.rejects(s.svc.saveMatrix(3, ["device.create"]), (e) => {
    const r = s.model.matrixError(e);
    assert.match(r.detail, /do not hold: \[device\.create\]/);
    assert.equal(r.title, "You don't have permission to do this");
    return true;
  });
});

test("#17 tenant switch: edits and grids are keyed by tenant; an INVALID_TENANT answer drops the selection", async () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /const editKey = `\$\{access\.tenantId \?\? "none"\}\|\$\{roleId\}`/);
  assert.match(ui, /const selected = edits\?\.key === editKey \? edits\.codes : granted/, "another tenant's edits are ignored");
  assert.match(ui, /saved\?\.key === editKey/, "another tenant's saved grid is ignored");
  assert.match(ui, /const shownGrid = mismatch \? null : grid/);
  assert.match(read("components/drive-vision/app-shell/app-shell.tsx"), /<div key=\{tenantScope\}/, "the shell remounts the page on a tenant change");
  assert.match(ui, /useState<number \| null>\(lastRoleId\)/, "only the role id crosses the remount, so the same role reloads for the new tenant");
  assert.match(ui, /onSessionEnded\(\(\) => \(lastRoleId = null\)\)/);
  const hook = read("features/drive-vision/hooks/use-api-query.ts");
  assert.match(hook, /scopedKey\(scope, rawKey\)/, "the query key carries the tenant");
  const s = openRealm(() => fail(400, "INVALID_TENANT", "Tenant is not active"));
  s.tenant.setTenantSelection(T1);
  await assert.rejects(s.svc.getMatrix(3));
  assert.equal(s.tenant.getTenantSelection(), null);
});

test("#4 + access: Permission Catalogue route for role.permission.read, catalogue actions stay Safe-Fare Admin only", () => {
  const viewer = access({ ...IDENTITIES.tenantAdmin, permissions: ["role.read", "role.permission.read"] });
  assert.equal(p.canAccessScreen(viewer, "permissions"), true);
  assert.equal(p.canViewWidget(viewer, "roleMenu.matrix"), true);
  assert.equal(p.canPerform(viewer, "roleMenuPermissions.update"), false, "viewing isn't saving");
  const admin = access({ ...IDENTITIES.tenantAdmin, permissions: ALL_CODES });
  assert.equal(p.canPerform(admin, "roleMenuPermissions.update"), true);
  for (const a of ["permissions.create", "permissions.update", "permissions.delete"]) assert.equal(p.canPerform(admin, a), false, `tenant ADMIN: ${a}`);
  assert.equal(p.canManageCatalogue(admin), false);
  assert.ok(!nav.navGroupsFor(admin).some((g) => g.items.some((i) => i.screen === "roles")), "Global Roles stays platform only");
  assert.equal(p.canAccessScreen(access({ ...IDENTITIES.tenantAdmin, permissions: ["device.read"] }), "permissions"), false);
  // The Safe-Fare Admin needs a tenant before saving.
  assert.equal(p.actionBlock(access(SFA), "roleMenuPermissions.update"), "tenant");
  assert.equal(p.canPerform(access(SFA, 1), "roleMenuPermissions.update"), true);
});

// ── Phase 7 catalogue ───────────────────────────────────────────────────────

test("#18 Phase 7 catalogue: list, create, edit and delete are still wired and still platform-wide", async () => {
  const page = read("components/drive-vision/platform/permission-catalog.tsx");
  for (const re of [/roleAdminService\.listPermissions\(\)/, /roleAdminService\.createPermission\(/, /roleAdminService\.updatePermission\(/, /roleAdminService\.deletePermission\(/, /canPerform\(access, "permissions\.create"\)/, /canPerform\(access, "permissions\.update"\)/, /canPerform\(access, "permissions\.delete"\)/, /canManageCatalogue\(access\)/]) assert.match(page, re);
  const s = openRealm(() => ok([]));
  s.tenant.setTenantSelection(T1);
  await s.role.listPermissions();
  await s.role.createPermission({ code: "a.b", description: "", scope: "TENANT" });
  await s.role.updatePermission("a.b", { description: "x", scope: "TENANT" });
  await s.role.deletePermission("a.b");
  same(s.calls.map((c) => [c.method, c.path, tenantOf(c) ?? null]), [
    ["GET", "/permissions", null],
    ["POST", "/permissions", null],
    ["PUT", "/permissions/a.b", null],
    ["DELETE", "/permissions/a.b", null],
  ]);
  const sfa = access(SFA);
  assert.equal(p.canManageCatalogue(sfa), true);
  for (const a of ["permissions.create", "permissions.update", "permissions.delete"]) assert.equal(p.canPerform(sfa, a), true, a);
});

test("no new route, screen or sidebar item", () => {
  assert.equal(p.SCREEN_ROUTES.permissions, "/drive-vision/platform/permissions");
  assert.equal(p.ALL_SCREENS.filter((s) => /role|menu/i.test(s)).join(), "roles");
  const routes = fs.readdirSync(path.join(SRC, "app/drive-vision/platform"));
  same(routes.sort(), ["page.tsx", "permissions", "roles"]);
});

// ── Unsaved changes ─────────────────────────────────────────────────────────

test("unsaved changes: links, reload, Back and Forward are held; a role or tenant switch and Sign out ask first", () => {
  const guard = read("components/drive-vision/shared/use-unsaved-guard.ts");
  for (const re of [/addEventListener\("beforeunload"/, /addEventListener\("click", onClick, true\)/, /holdHistory\(/, /setUnsavedChanges\(message\)/]) assert.match(guard, re);
  assert.doesNotMatch(guard + read("components/drive-vision/shared/history-guard.ts"), /pushState|replaceState/, "the guard leaves nothing in the history");
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /if \(dirty\) setPendingSwitch\(\{ kind: "role", id \}\)/);
  assert.match(ui, /if \(dirty\) setPendingSwitch\(\{ kind: "tenant", tenant: t \}\)/);
  assert.match(ui, /open=\{guard\.blocked\}/);
});

test("top-bar tenant switcher: asks while there are unsaved changes, and switches straight away otherwise", () => {
  const sw = read("components/drive-vision/app-shell/tenant-switcher.tsx");
  assert.doesNotMatch(sw, /disabled=\{unsaved !== null\}/, "it prompts rather than locks");
  assert.match(sw, /function confirmFirst\(run: \(\) => Promise<void> \| void\) \{\s*if \(!unsaved\) return void run\(\);\s*setOpen\(false\);\s*setHeld\(\{ run \}\);/);
  assert.match(sw, /confirmFirst\(\(\) => select\(t\)\)/);
  assert.match(sw, /confirmFirst\(clearSelection\)/);
});

/**
 * A browser's session history. `go` is asynchronous, as in a browser: it queues a traversal that `settle` delivers.
 * There is deliberately no pushState: if the guard ever called it, the test would throw. Window popstate listeners
 * fire in registration order, as in Chromium: the gate (installed before hydration) and then the router, which
 * replaces the page at once. A guard registered after the router would be too late here, as it is in a browser.
 */
function fakeHistory({ entries, at, navigationApi = true }) {
  const listeners = [];
  const queued = [];
  const b = { at, routerSaw: [], goes: [], held: [], allow: false };
  const win = {
    history: { go: (d) => (b.goes.push(d), queued.push(d)) },
    addEventListener: (type, l) => listeners.push(l),
  };
  if (navigationApi) win.navigation = { get currentEntry() { return { index: b.at }; } };
  const deliver = (to) => {
    if (to < 0 || to >= entries) return;
    b.at = to;
    let stopped = false;
    const e = { stopImmediatePropagation: () => (stopped = true) };
    for (const l of listeners) {
      l(e);
      if (stopped) break;
    }
  };
  history.installHistoryGate(win);
  win.addEventListener("popstate", () => b.routerSaw.push(b.at)); // the App Router, mounted after the gate
  b.win = win;
  b.traverse = (delta) => deliver(b.at + delta); // the browser's Back / Forward button
  b.settle = () => {
    while (queued.length) deliver(b.at + queued.shift());
  };
  b.hold = () => history.holdHistory(win, (d) => b.held.push(d), () => b.allow);
  return b;
}
const history = pure.require("components/drive-vision/shared/history-guard");

test("Back with unsaved changes: held on the page, the router never sees it, no loop", () => {
  const b = fakeHistory({ entries: 3, at: 2 });
  b.hold();
  b.traverse(-1);
  b.settle();
  assert.equal(b.at, 2, "stays on the page");
  same(b.routerSaw, [], "the page never changed");
  same(b.goes, [1], "undone once");
  same(b.held, [-1], "the dialog gets the delta to resume");
});

test("Forward with unsaved changes: held too, and its entry survives", () => {
  const b = fakeHistory({ entries: 3, at: 1 });
  b.hold();
  b.traverse(1);
  b.settle();
  assert.equal(b.at, 1);
  same(b.goes, [-1]);
  same(b.held, [1]);
  same(b.routerSaw, []);
});

test("a jump of several entries is undone by the same distance; a second press during the undo stays held", () => {
  const jump = fakeHistory({ entries: 6, at: 5 });
  jump.hold();
  jump.traverse(-3);
  jump.settle();
  assert.equal(jump.at, 5);
  same(jump.held, [-3]);
  const twice = fakeHistory({ entries: 5, at: 4 });
  twice.hold();
  twice.traverse(-1);
  twice.traverse(-1);
  twice.settle();
  assert.equal(twice.at, 4, "back on the page");
  same(twice.routerSaw, []);
});

test("cancel stays; confirming resumes the traversal for the router, once", () => {
  const b = fakeHistory({ entries: 3, at: 2 });
  b.hold();
  b.traverse(-1);
  b.settle();
  // Cancel is doing nothing: the page and the history are as they were.
  b.allow = true;
  b.win.history.go(b.held[0]);
  b.settle();
  assert.equal(b.at, 1);
  same(b.routerSaw, [1]);
});

test("after a save the guard is gone: one Back leaves at once, with no extra entry", () => {
  const b = fakeHistory({ entries: 3, at: 2 });
  const release = b.hold();
  release();
  b.traverse(-1);
  b.settle();
  assert.equal(b.at, 1);
  same(b.routerSaw, [1]);
  same(b.goes, []);
});

test("without the Navigation API a traversal is taken as one Back, and still doesn't loop", () => {
  const b = fakeHistory({ entries: 3, at: 2, navigationApi: false });
  b.hold();
  b.traverse(-1);
  b.settle();
  assert.equal(b.at, 2);
  same(b.goes, [1]);
  same(b.routerSaw, []);
});

test("the gate is registered before hydration: top-level, static and synchronous, in the file Next.js runs first", () => {
  const src = read("instrumentation-client.ts");
  assert.match(src, /^import \{ installHistoryGate \} from "@\/components\/drive-vision\/shared\/history-guard";/);
  assert.match(src, /^installHistoryGate\(window\);$/m);
  assert.doesNotMatch(src, /import\(|await |useEffect/);
});

test("Sign out: asks only with unsaved changes, with the required text, and ends the session only on Continue", () => {
  const menu = read("components/drive-vision/app-shell/user-profile-menu.tsx");
  assert.match(menu, /onSelect=\{\(\) => \(unsaved \? setConfirmSignOut\(true\) : void signOut\(\)\)\}/, "no unsaved changes: the existing flow");
  assert.match(menu, /onConfirm=\{signOut\}/, "the session ends only here");
  assert.equal([...menu.matchAll(/signOut\(\)|=\{signOut\}/g)].length, 2, "no other way to sign out from this menu");
  const unsaved = /const UNSAVED = "([^"]+)"/.exec(read("components/drive-vision/platform/role-permission-matrix.tsx"))[1];
  const tail = /description=\{`\$\{unsaved \?\? "[^"]+"\} ([^`]+)`\}/.exec(menu)[1];
  assert.equal(`${unsaved} ${tail}`, "You have unsaved permission changes. If you sign out, these changes will be lost. Do you want to continue?");
  assert.doesNotMatch(read("components/drive-vision/auth/route-guard.tsx") + read("components/drive-vision/auth/auth-gate.tsx"), /RolePermissionMatrix/, "the other Sign out buttons only show where no grid is mounted");
});

// ── Dirty state ─────────────────────────────────────────────────────────────

test("dirty state: one change is dirty, changing it back is clean, a save clears it, a failure keeps it", () => {
  const start = sel();
  const changed = m.setPermission(G, start, "device.create", true);
  assert.equal(m.hasChanges(m.diffPermissions(G, changed)), true);
  assert.equal(m.hasChanges(m.diffPermissions(G, m.setPermission(G, changed, "device.create", false))), false);
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /const dirty = hasChanges\(diff\);/);
  assert.match(ui, /useUnsavedGuard\(dirty, UNSAVED\)/);
  const save = ui.slice(ui.indexOf("async function save()"), ui.indexOf("const switchDescription"));
  assert.match(save, /if \(!shownGrid \|\| roleId === null \|\| block !== null \|\| saving\) return;/, "no second submission");
  assert.match(save, /dto: outcome\.dto \}\);\s*setEdits\(null\);/, "a save clears the edits");
  assert.match(save, /matrixQ\.refetch\(\)/, "a save re-reads the role");
  assert.doesNotMatch(save.slice(save.indexOf("catch (err)")), /setEdits/, "a failure keeps them");
});

// ── Shared codes ────────────────────────────────────────────────────────────

test("impact of a shared code: the code, the module it was unticked in and every other module, before anything changes", () => {
  const start = sel();
  const before = [...start];
  const impact = m.removalImpact(G, start, "device.read", menu(G, "dashboard"));
  assert.equal(impact.code, "device.read");
  assert.equal(impact.origin, "Fleet Overview");
  same(impact.removed[0], { code: "device.read", modules: ["Vehicles & Assets"] });
  same(impact.removed.map((r) => r.code), ["device.read", "group.read", "maintenance.read"]);
  same(impact.affected, ["Vehicles & Assets"]);
  same(impact.closed, ["Vehicles & Assets"]);
  same([...start], before, "cancelling leaves the selection as it was");
  const after = m.setPermission(G, start, "device.read", false);
  same([...impact.next].sort(), [...after].sort(), "confirming applies the existing removal");
  same(m.allCells(G).filter((c) => c.code === "device.read").map((c) => impact.next.has(c.code)), [false, false, false, false], "shown the same in every module");
});

test("impact: a shared action names its other module without closing it, and the save body has the code gone once", () => {
  const dto = operatorDto();
  const shared = action("Live video", "video.live", true);
  dto.menus[0].resources[0].actions = [shared];
  dto.menus[2].resources[0].actions = [shared];
  dto.menus[2].access.granted = true;
  const g = grid(dto);
  const s = sel(g);
  const impact = m.removalImpact(g, s, "video.live", menu(g, "dashboard"));
  same(impact.affected, ["Sensors"]);
  same(impact.closed, []);
  same(impact.removed, [{ code: "video.live", modules: ["Sensors"] }]);
  assert.equal(m.permissionCodesToSave(g, impact.next).includes("video.live"), false);
});

test("impact: a removal staying inside one module has no other module, so it needs no confirmation", () => {
  const impact = m.removalImpact(G, sel(), "only.read", menu(G, "only_module"));
  same(impact.affected, []);
  same(impact.closed, []);
  same(impact.removed, [{ code: "only.read", modules: [] }]);
  assert.equal(m.removalImpact(G, sel(), "device.create", menu(G, "vehicles_assets")), null, "not ticked: nothing to remove");
  const locked = grid({ ...operatorDto(), editable: false });
  assert.equal(m.removalImpact(locked, sel(locked), "device.read", menu(locked, "dashboard")), null, "read-only");
});

test("the UI confirms a removal reaching another module and applies nothing until then", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const toggle = ui.slice(ui.indexOf("function toggle("), ui.indexOf("/** Replaces the edits"));
  assert.match(toggle, /const impact = checked \? null : removalImpact\(shownGrid, selected, cell\.code, menu\);/);
  assert.match(toggle, /if \(impact\?\.affected\.length\) setPendingRemoval\(impact\);\s*\/\/[^\n]*\n\s*else \{/);
  assert.match(ui, /open=\{pendingRemoval !== null\}/);
  assert.match(ui, /if \(pendingRemoval\) applySelection\(pendingRemoval\.code, pendingRemoval\.next\);/);
  assert.match(ui, /onOpenChange=\{\(o\) => !o && setPendingRemoval\(null\)\}/, "cancel only closes");
});

// ── Concurrent edits ────────────────────────────────────────────────────────

/** Stub of the service: `latest` is what the server holds now. */
function stubApi(latest) {
  const calls = [];
  return {
    calls,
    getMatrix: async (id) => (calls.push(["GET", id]), typeof latest === "function" ? latest() : latest),
    saveMatrix: async (id, codes) => (calls.push(["PUT", id, codes]), { roleId: id, saved: codes }),
  };
}
const expected = { tenantId: 1, roleId: 3 };

test("no conflict: the role is unchanged, so it reads, then saves the ticked codes", async () => {
  const api = stubApi(operatorDto());
  const next = m.setPermission(G, sel(), "device.create", true);
  const out = await m.saveIfUnchanged(G, next, expected, api);
  assert.equal(out.status, "saved");
  same(api.calls.map((c) => c[0]), ["GET", "PUT"]);
  same(api.calls[1][2], m.permissionCodesToSave(G, next));
});

test("a save is confirmed by the returned granted values, in both directions", async () => {
  const sent = ["device.read", "device.create"];
  const dto = (held) => {
    const out = operatorDto();
    const mark = (c) => c && (c.granted = held.includes(c.permissionCode));
    for (const x of out.menus) {
      mark(x.access);
      for (const r of x.resources) [r.view, r.add, r.edit, r.delete, ...r.actions].forEach(mark);
    }
    return out;
  };
  const id = { tenantId: 1, roleId: 3 };
  same(m.unconfirmedCodes(sent, dto(sent), id), [], "the server shows what was sent");
  same(m.unconfirmedCodes(sent, dto(["device.read"]), id), ["device.create"], "sent, not granted");
  same(m.unconfirmedCodes(sent, dto([...sent, "alarm.read"]), id), ["alarm.read"], "granted, not sent");
  same(m.unconfirmedCodes(sent, {}, id), ["device.create", "device.read"], "an empty response confirms nothing");
  same(m.unconfirmedCodes(sent, { ...dto(sent), tenantId: 2 }, id), sent, "another tenant's grid confirms nothing");
});

test("the screen reports success only when the save is confirmed", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const save = ui.slice(ui.indexOf("async function save()"), ui.indexOf("const switchDescription"));
  assert.ok(save.indexOf("if (outcome.unconfirmed.length)") < save.indexOf("toast.success"));
  const branch = save.slice(save.indexOf("if (outcome.unconfirmed.length)"), save.indexOf("toast.success"));
  assert.match(branch, /setSaveError\(failure\);[\s\S]*toast\.error\([\s\S]*return;/);
  assert.ok(save.indexOf("matrixQ.refetch()") < save.indexOf("if (outcome.unconfirmed.length)"), "both paths re-read");
});

test("conflict: another administrator changed the role, so nothing is written", async () => {
  const newer = operatorDto();
  newer.menus[1].resources[0].delete = cell("device.delete", true);
  const api = stubApi(newer);
  const out = await m.saveIfUnchanged(G, m.setPermission(G, sel(), "device.create", true), expected, api);
  same(out, { status: "conflict" });
  same(api.calls.map((c) => c[0]), ["GET"], "no PUT: the newer state isn't overwritten");
});

test("conflict: a change to otherPermissionCodes counts; re-ordered responses and changed flags don't", async () => {
  const other = { ...operatorDto(), otherPermissionCodes: ["own.data.read", "x.y"] };
  assert.equal((await m.saveIfUnchanged(G, sel(), expected, stubApi(other))).status, "conflict");
  const reordered = operatorDto();
  reordered.menus.reverse();
  assert.equal((await m.saveIfUnchanged(G, sel(), expected, stubApi(reordered))).status, "saved");
  assert.equal(m.permissionState(G), m.permissionState(grid()));
});

test("a failed check saves nothing: the read's error reaches the screen, another tenant's answer is refused", async () => {
  const down = stubApi(() => Promise.reject(new Error("read failed")));
  await assert.rejects(m.saveIfUnchanged(G, sel(), expected, down), /read failed/);
  same(down.calls.map((c) => c[0]), ["GET"]);
  const stray = stubApi({ ...operatorDto(), tenantId: 2 });
  await assert.rejects(m.saveIfUnchanged(G, sel(), expected, stray), /tenant 2 instead of tenant 1/);
  same(stray.calls.map((c) => c[0]), ["GET"]);
});

test("conflict in the screen: Save is blocked, edits stay until reloaded, reload replaces them from the server", () => {
  const edited = m.setPermission(G, sel(), "device.create", true);
  assert.equal(m.saveBlock(G, edited, { canUpdate: true, conflict: true }), m.CONFLICT_MESSAGE);
  assert.equal(m.CONFLICT_MESSAGE, "This role's permissions were changed by another administrator. Reload the latest permissions before saving.");
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const save = ui.slice(ui.indexOf("async function save()"), ui.indexOf("const switchDescription"));
  const branch = save.slice(save.indexOf('outcome.status === "conflict"'), save.indexOf("return;", save.indexOf('outcome.status === "conflict"')));
  assert.match(branch, /setConflictKey\(editKey\)/);
  assert.doesNotMatch(branch, /setEdits|toast\.success/, "local edits stay, and no success is claimed");
  assert.match(ui, /Reload Latest Permissions/);
  const reload = ui.slice(ui.indexOf("async function reloadLatest()"), ui.indexOf("function switchRole"));
  assert.ok(reload.indexOf("await roleMenuService.getMatrix") < reload.indexOf("setEdits(null)"), "edits go only once the latest state is in hand");
  assert.match(reload, /catch \(err\) \{\s*setSaveError/);
  assert.match(ui, /base: edits\?\.key === editKey \? edits\.base : shownGrid/, "the first edit pins the state a save compares against");
});

test("the conflict check goes through the real client: both calls carry the selected tenant", async () => {
  const s = openRealm(() => ok(operatorDto()));
  s.tenant.setTenantSelection(T1);
  const g = s.model.readGrid(operatorDto());
  const out = await s.model.saveIfUnchanged(g, s.model.setPermission(g, s.model.grantedCodes(g), "device.create", true), expected, s.svc);
  assert.equal(out.status, "saved");
  const role = s.calls.filter((c) => c.path === "/roles/3/menu-permissions");
  same(role.map((c) => c.method), ["GET", "PUT"]);
  same(role.map(tenantOf), ["1", "1"]);
});

// ── Checkbox visibility ─────────────────────────────────────────────────────

const theme = fs.readFileSync(path.join(SRC, "styles/drive-vision-theme.css"), "utf8");
const token = (name) => new RegExp(`--dv-${name}:\\s*(#[0-9a-f]{6})`).exec(theme)[1];
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const UI_MIN = 3;

test("checkboxes: checked is a filled box with a contrasting mark, unchecked a clear border on an empty box", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const cls = /const PERMISSION_CHECKBOX =\s*"([^"]+)"/.exec(ui)[1].split(/\s+/);
  for (const c of ["size-5", "border-2", "border-ink-muted", "bg-surface", "data-[state=checked]:bg-brand-deep", "data-[state=checked]:text-white"]) assert.ok(cls.includes(c), c);
  // The shared Checkbox's dark: colours follow the OS and won in the browser: both must be replaced here.
  const shared = read("components/ui/checkbox.tsx");
  for (const c of ["dark:bg-input/30", "dark:data-[state=checked]:bg-primary"]) assert.ok(shared.includes(c), `still in the shared Checkbox: ${c}`);
  for (const c of ["dark:bg-surface", "dark:data-[state=checked]:bg-brand-deep"]) assert.ok(cls.includes(c), c);
  for (const bg of ["surface", "surface-muted"]) {
    assert.ok(contrast(token("ink-muted"), token(bg)) >= UI_MIN, `unchecked border on ${bg}`);
    assert.ok(contrast(token("brand-deep"), token(bg)) >= UI_MIN, `checked fill on ${bg}`);
  }
  assert.ok(contrast("#ffffff", token("brand-deep")) >= UI_MIN, "checkmark on the fill");
});

test("checkboxes: disabled stays readable, hover and keyboard focus show, the click target is 36 px", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const cls = /const PERMISSION_CHECKBOX =\s*"([^"]+)"/.exec(ui)[1].split(/\s+/);
  // Grey fill and dashed border: read-only is told apart from granted without relying on the brand colour alone.
  for (const c of ["disabled:opacity-100", "disabled:border-dashed", "disabled:data-[state=checked]:bg-ink-muted", "enabled:hover:ring-[3px]", "focus-visible:ring-[3px]", "focus-visible:ring-brand-deep", "focus-visible:ring-offset-2", "after:-inset-2.5"]) assert.ok(cls.includes(c), c);
  assert.ok(contrast("#ffffff", token("ink-muted")) >= UI_MIN, "disabled checkmark");
  assert.ok(contrast(token("ink-muted"), token("surface-sunken")) >= UI_MIN, "disabled empty box");
  assert.doesNotMatch(ui, /opacity-70/, "a closed menu's rows aren't faded: that would wash the boxes out");
});

test("checkboxes: one style for module, Add, Edit, Delete, View and action boxes, and only on this grid", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.equal([...ui.matchAll(/<Checkbox /g)].length, 2, "a coded box and an empty one, nothing else");
  assert.match(ui, /className=\{PERMISSION_CHECKBOX\}/);
  assert.match(ui, /checked=\{false\} disabled className=\{PERMISSION_CHECKBOX\}/, "the empty box is as visible as the others");
  assert.equal([...ui.matchAll(/<PermissionBox /g)].length, 1);
  assert.doesNotMatch(read("components/ui/checkbox.tsx"), /brand-deep/, "the shared Checkbox used on other screens is unchanged");
});

test("parent and child boxes: unticking a module unticks its children once, and re-ticking grants nothing else", () => {
  const s = m.setPermission(G, sel(), "alarm.read", false);
  const alerts = menu(G, "alerts_events");
  assert.equal(m.cellDisabled(alerts.access, { locked: false }), false);
  assert.equal(m.cellDisabled(box(G, "Handle alerts").actions[0], { locked: false }), false, "a child stays usable");
  assert.equal(s.has("alarm.handle"), false);
  const back = m.setPermission(G, s, "alarm.read", true);
  assert.equal(back.has("alarm.handle"), false, "re-ticking grants nothing else");
});

// ── Access and naming ───────────────────────────────────────────────────────

const navConfig = pure.require("components/drive-vision/navigation/nav-config");
const ROUTE = "/drive-vision/platform/permissions";
const itemIn = (a) => nav.navGroupsFor(a).flatMap((g) => g.items.map((i) => ({ group: g.label, short: g.short, ...i }))).find((i) => i.screen === "permissions");

test("access: Safe-Fare Admin gets the full catalogue, and keeps Platform → Permission Catalogue", () => {
  const a = access(SFA);
  assert.equal(p.canManageCatalogue(a), true);
  for (const x of ["permissions.create", "permissions.update", "permissions.delete"]) assert.equal(p.canPerform(a, x), true, x);
  const item = itemIn(a);
  assert.equal(item.group, "Platform");
  assert.equal(item.label, "Permission Catalogue");
  assert.equal(navConfig.getPageMeta(ROUTE, "x", new Date(), a.platform).title, "Permission Catalogue");
  assert.equal(navConfig.findNavGroup(ROUTE, a.platform).label, "Platform");
  const manageOnly = access({ ...SFA, permissions: ["permission.manage"] });
  assert.equal(p.canAccessScreen(manageOnly, "permissions"), true, "the catalogue alone still opens the screen");
  assert.equal(p.canManageCatalogue(manageOnly), true);
});

test("access: a tenant user with role.permission.read gets Role Permissions under Administration, on the same route", () => {
  const a = access({ ...IDENTITIES.tenantAdmin, permissions: ["role.read", "role.permission.read", "user.read"] });
  assert.equal(p.canAccessPath(a, ROUTE), true);
  const item = itemIn(a);
  assert.equal(item.group, "Administration");
  assert.equal(item.short, "Admin");
  assert.equal(item.label, "Role Permissions");
  assert.equal(item.href, ROUTE, "no new route");
  assert.equal(nav.navGroupsFor(a).some((g) => g.label === "Platform"), false);
  assert.equal(navConfig.getPageMeta(ROUTE, "x", new Date(), a.platform).title, "Role Permissions");
  assert.equal(navConfig.findNavGroup(ROUTE, a.platform).label, "Administration");
  assert.equal(p.canManageCatalogue(a), false);
  assert.match(read("components/drive-vision/app-shell/global-search.tsx"), /navItemFor\(p, access\.platform\)/, "search uses the same name");
});

test("access: a tenant user without role.permission.read is denied, even holding permission.manage", () => {
  for (const permissions of [["device.read"], ["device.read", "permission.manage"], ["device.read", "role.read", "role.permission.update"]]) {
    const a = access({ ...IDENTITIES.tenantAdmin, permissions });
    assert.equal(p.canAccessScreen(a, "permissions"), false, permissions.join());
    assert.equal(p.canAccessPath(a, ROUTE), false, permissions.join());
    assert.equal(itemIn(a), undefined, "not in the sidebar");
  }
});

test("access: tenant users can't reach platform configuration, whatever they hold", () => {
  const a = access({ ...IDENTITIES.tenantAdmin, permissions: ALL_CODES });
  assert.equal(p.canManageCatalogue(a), false);
  for (const x of ["permissions.create", "permissions.update", "permissions.delete"]) assert.equal(p.canPerform(a, x), false, x);
  for (const s of ["platform", "tenants", "roles"]) assert.equal(p.canAccessScreen(a, s), false, s);
  const page = read("components/drive-vision/platform/permission-catalog.tsx");
  assert.match(page, /const showCatalogue = canManageCatalogue\(access\);/);
  assert.match(page, /const tab = !showCatalogue \? "roles" : !showRoles \? "catalogue" : chosenTab;/, "a tenant user can never land on the Catalogue tab");
  assert.match(page, /useApiQuery\(tab === "catalogue" \? "platform-permissions:list" : null/, "no catalogue request for them");
});

test("access: a tenant user stays in their tenant: no selection, and the token's tenant wins", async () => {
  const s = openRealm(() => ok(operatorDto()));
  const raw = { ...IDENTITIES.tenantAdmin, permissions: ["role.permission.read"] };
  const a = s.access(raw, 99);
  assert.equal(a.tenantId, raw.tenantId, "a stray selection is ignored");
  await s.svc.getMatrix(3);
  assert.equal(tenantOf(s.calls[0]), undefined, "no tenant header");
});

test("the sidebar change is display only: every shown item is one the route guard allows", () => {
  for (const key of ["platformAdmin", "tenantAdmin"]) {
    const a = access(IDENTITIES[key]);
    assert.ok(nav.navGroupsFor(a).flatMap((g) => g.items).every((i) => p.canAccessPath(a, i.href)), key);
  }
  assert.equal(navConfig.NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.screen === "permissions").length, 1, "one catalogue entry");
});

// ── Cell-level editability ──────────────────────────────────────────────────

/** A resource with every kind of cell, whose View the user can't change. The module box shares the View's code. */
const independentDto = ({ viewGranted = false, viewEditable = false } = {}) => ({
  tenantId: 1,
  roleId: 3,
  roleCode: "OPERATOR",
  fullAccess: false,
  editable: true,
  menus: [
    {
      menuId: 1,
      menuKey: "reports",
      title: "Reports",
      parentId: null,
      sortOrder: 1,
      access: cell("report.read", viewGranted, viewEditable),
      resources: [row("Reports", { view: cell("report.read", viewGranted, viewEditable), add: cell("report.create"), edit: cell("report.update", true), delete: cell("report.delete", false, false), actions: [action("Export", "report.export"), action("Share", "report.share", false, false)] })],
    },
  ],
  otherPermissionCodes: [],
});
const disabledOf = (c) => m.cellDisabled(c, { locked: false });

test("each cell's granted and editable give its state: the four combinations", () => {
  const cases = [
    [true, false, { checked: true, disabled: true }],
    [false, false, { checked: false, disabled: true }],
    [true, true, { checked: true, disabled: false }],
    [false, true, { checked: false, disabled: false }],
  ];
  for (const [granted, editable, want] of cases) {
    const dto = independentDto({ viewGranted: true, viewEditable: true });
    dto.menus[0].resources[0].add = cell("report.create", granted, editable);
    const g = grid(dto);
    const add = g.menus[0].resources[0].add;
    same({ checked: sel(g).has("report.create"), disabled: disabledOf(add) }, want);
  }
});

test("a non-editable View disables only itself: Add, Edit, Delete and Actions keep their own flags", () => {
  for (const viewGranted of [false, true]) {
    const g = grid(independentDto({ viewGranted }));
    const r = g.menus[0].resources[0];
    assert.equal(disabledOf(r.view), true, "View");
    assert.equal(disabledOf(r.add), false, "Add");
    assert.equal(disabledOf(r.edit), false, "Edit");
    assert.equal(disabledOf(r.delete), true, "Delete is read-only by its own flag");
    assert.equal(disabledOf(r.actions[0]), false, "an editable action");
    assert.equal(disabledOf(r.actions[1]), true, "each action has its own flag");
  }
});

test("under a non-editable View, the editable cells really change and save", () => {
  const g = grid(independentDto());
  const start = sel(g);
  const next = m.setPermission(g, m.setPermission(g, start, "report.create", true), "report.export", true);
  same(m.permissionCodesToSave(g, next), ["report.create", "report.export", "report.update"]);
  assert.equal(m.setPermission(g, next, "report.read", true), next, "the View itself stays as it is");
  assert.equal(m.saveBlock(g, next, { canUpdate: true }), null);
});

test("an unticked module disables nothing, editable or not; a box sharing its code stays usable", () => {
  for (const viewEditable of [false, true]) {
    const g = grid(independentDto({ viewEditable }));
    assert.equal(m.isMenuOff(g.menus[0], sel(g)), true);
    assert.equal(disabledOf(g.menus[0].resources[0].add), false);
    assert.equal(disabledOf(g.menus[0].resources[0].view), !viewEditable);
  }
  const g = grid(independentDto({ viewEditable: true }));
  const ticked = m.setPermission(g, sel(g), "report.create", true);
  assert.equal(ticked.has("report.create"), true, "ticking under a closed menu works");
  assert.equal(m.isMenuOff(g.menus[0], ticked), true, "and doesn't open the menu");
  assert.match(read("components/drive-vision/platform/role-permission-matrix.tsx"), /won't see that menu until it is ticked/, "the user is told");
});

test("a read-only grid and missing rights still lock every cell, whatever its own flag", () => {
  const g = grid({ ...independentDto(), editable: false });
  same([...m.editableCodes(g)], [], "the grid-level flag: the whole grid is read-only");
  assert.equal(m.cellDisabled(g.menus[0].resources[0].add, { locked: true }), true);
});

// ── Cells with no permission code ───────────────────────────────────────────

test("a null cell is an empty, disabled box in every operation column: no handler, no amber, no code", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const unmapped = ui.slice(ui.indexOf("function UnmappedBox("), ui.indexOf("function RoleOption("));
  assert.match(unmapped, /checked=\{false\} disabled /);
  assert.doesNotMatch(unmapped, /onCheckedChange|data-code/);
  assert.match(unmapped, /data-testid="unmapped-box"/);
  assert.doesNotMatch(ui, /PendingBox|PendingNote|togglePending|setWished|pendingCells|PENDING_CHECKBOX|border-warning/, "the amber state is gone");
  same(m.unmappedColumns(box(G, "Maintenance reminders")).map((o) => o.key), ["delete"]);
  same(m.unmappedColumns(box(G, "Service renewals")).map((o) => o.key), ["add", "edit", "delete", "view"]);
});

test("the user is told what an unmapped cell means: on the box, to screen readers and on the page", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /title=\{`\$\{operation\} isn't mapped for \$\{resource\}/);
  assert.match(ui, /aria-label=\{`\$\{label\} \(not mapped\)`\}/);
  assert.match(ui, /\{hasUnmappedCells\(shownGrid\) \? \(/);
  assert.match(ui, /data-testid="unmapped-note"/);
  assert.equal(m.hasUnmappedCells(G), true);
});

test("a grid with every cell mapped shows no unmapped explanation", () => {
  const dto = operatorDto();
  const full = { permissionCode: "x.y", granted: false, editable: true };
  dto.menus = [{ menuId: 1, menuKey: "k", title: "T", access: null, resources: [row("R", { view: full, add: full, edit: full, delete: full })] }];
  assert.equal(m.hasUnmappedCells(grid(dto)), false);
});

test("unmapped cells alone leave nothing to save", () => {
  assert.equal(m.saveBlock(G, sel(), { canUpdate: true }), "No changes to save.");
  assert.match(read("components/drive-vision/platform/role-permission-matrix.tsx"), /const dirty = hasChanges\(diff\);/);
});

test("a menu with no resources gets one row of unmapped cells; a menu with resources is drawn as sent", () => {
  const only = menu(G, "only_module");
  same(only.resources, []);
  same(m.menuRows(only), [{ label: "Module only", view: null, add: null, edit: null, delete: null, actions: [] }]);
  assert.equal(m.menuRows(menu(G, "vehicles_assets")), menu(G, "vehicles_assets").resources);
});

test("empty Actions stay empty: there is no named action to show, and no code is invented anywhere", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  assert.match(ui, /\{r\.actions\.length \? \(/);
  for (const code of ["driver.app", "driver.create", "driver.update", "driver.delete", "own.data"]) assert.ok(!ui.includes(code), code);
  assert.ok(!read("components/drive-vision/platform/role-menu-permission-model.ts").includes("driver."));
});

test("My Work as the grid sends it: View works from its own flags, the null cells stay out of the save", () => {
  const dto = operatorDto();
  dto.menus.push({ menuId: 12, menuKey: "my_work", title: "My Work", parentId: null, sortOrder: 90, access: cell("driver.app", false, true), resources: [row("My Work", { view: cell("driver.app", false, true) })] });
  const g = grid(dto);
  const work = menu(g, "my_work");
  for (const k of ["add", "edit", "delete"]) assert.equal(work.resources[0][k], null, k);
  const next = m.setPermission(g, sel(g), "driver.app", true);
  const body = m.permissionCodesToSave(g, next);
  assert.ok(body.includes("driver.app"));
  for (const code of ["driver.create", "driver.update", "driver.delete"]) assert.equal(body.includes(code), false, code);
});
