// Driver menu permissions on the Role Permissions grid. MOCKED / SYNTHETIC ONLY: the fixture is built from the written brief
// (the database output and backend structure), not captured from the API, and every request goes to a stub fetch. A pass
// says nothing about the live backend.
// To use the real response, replace tests/fixtures/driver-role-menu-permissions.json: nothing here hardcodes a grid.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const FIXTURE = path.join(__dirname, "fixtures", "driver-role-menu-permissions.json");
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const pure = createRealm({ AbortController, process: { env: {} } }, { "lucide-react": new Proxy({}, { get: () => "icon" }), react: { useMemo: (f) => f() } });
const m = pure.require("components/drive-vision/platform/role-menu-permission-model");

const G = m.readGrid(fixture());
const menu = (title, g = G) => g.menus.find((x) => x.title === title);
const rowOf = (title, label = title, g = G) => menu(title, g).resources.find((r) => r.label === label);
const codeOf = (c) => (c === null ? null : c.code);
const usable = (cell) => !m.cellDisabled(cell, { locked: false });
const columns = (r) => ({ view: codeOf(r.view), add: codeOf(r.add), edit: codeOf(r.edit), delete: codeOf(r.delete), actions: r.actions.map((a) => `${a.label}=${a.code}`) });

test("the fixture says what it is", () => {
  assert.match(fixture()._source, /^SYNTHETIC/);
  assert.equal(fixture().roleCode, "DRIVER");
});

// The permissions the database output assigns to role 4 in tenant 1.
const ASSIGNED = ["driver.app.work.read", "driver.app.work.respond", "driver.app.work.execute", "driver.app.swap.create", "driver.app.shift.read", "driver.app.shift.start", "driver.app.shift.end", "driver.app.leave.read", "driver.app.leave.create", "driver.app.leave.cancel", "driver.app.checklist.read", "driver.app.checklist.submit", "driver.app.safety.read", "driver.app.profile.read", "driver.app.profile.update"];

test("My Work: the rows are exactly the backend's, in its order", () => {
  same(menu("My Work").resources.map((r) => r.label), ["My Work", "Accept or decline trips", "Start and complete trips", "Trip swap requests"]);
});

test("#1 My Work View uses driver.app.work.read", () => {
  same(columns(rowOf("My Work")), { view: "driver.app.work.read", add: null, edit: null, delete: null, actions: [] });
});

test("#2 My Work Add, Edit and Delete stay null and unmapped: no code to tick, select or send", () => {
  const r = rowOf("My Work");
  same(m.unmappedColumns(r).map((o) => o.key), ["add", "edit", "delete"]);
  const before = m.grantedCodes(G);
  for (const k of ["add", "edit", "delete"]) assert.equal(r[k], null, k);
  assert.equal(m.resourceCells(r).length, 1, "only View is a real cell on this row");
  assert.equal(m.saveBlock(G, before, { canUpdate: true }), "No changes to save.");
});

test("#3 Accept or decline uses driver.app.work.respond, as an action on its own row", () => {
  same(columns(rowOf("My Work", "Accept or decline trips")), { view: null, add: null, edit: null, delete: null, actions: ["Accept or decline trips=driver.app.work.respond"] });
});

test("#4 Start and complete uses driver.app.work.execute, as an action on its own row", () => {
  same(columns(rowOf("My Work", "Start and complete trips")), { view: null, add: null, edit: null, delete: null, actions: ["Start and complete trips=driver.app.work.execute"] });
});

test("#5 Trip swap uses driver.app.swap.create under Add", () => {
  same(columns(rowOf("My Work", "Trip swap requests")), { view: null, add: "driver.app.swap.create", edit: null, delete: null, actions: [] });
});

test("#6 every assigned permission renders once, from the code, granted and editable the response gave it", () => {
  const cells = m.allCells(G);
  for (const code of ASSIGNED) {
    const found = cells.filter((c) => c.code === code);
    assert.equal(found.length, 1, code);
    assert.equal(found[0].granted, true, code);
    assert.equal(found[0].editable, true, code);
  }
  const dto = fixture();
  const leave = dto.menus.find((x) => x.title === "My Leave").resources[0];
  leave.add.granted = false;
  leave.add.editable = false;
  same(m.readGrid(dto).menus.find((x) => x.title === "My Leave").resources[0].add, { code: "driver.app.leave.create", granted: false, editable: false });
});

test("the app reads no fixture and hardcodes no tenant: the grid is whatever the current tenant's API call returned", () => {
  for (const f of ["components/drive-vision/platform/role-permission-matrix.tsx", "components/drive-vision/platform/role-menu-permission-model.ts", "features/drive-vision/api/role-menu-service.ts"]) {
    assert.doesNotMatch(read(f), /fixtures?\/|driver-role-menu|2419|2499|tenantId: 1\b|X-Tenant-Id: 1\b/, f);
  }
  const service = read("features/drive-vision/api/role-menu-service.ts");
  assert.match(service, /api\.get<RoleMenuPermissionsDto>\(`\/roles\/\$\{roleId\}\/menu-permissions`, \{ signal \}\)/, "the client adds the tenant, the service never does");
});

test("My Shifts: start under Add, end under Edit, Delete null", () => {
  same(columns(rowOf("My Shifts")), { view: "driver.app.shift.read", add: "driver.app.shift.start", edit: "driver.app.shift.end", delete: null, actions: [] });
});

test("My Leave: create under Add; cancel stays an action, never Delete", () => {
  const r = rowOf("My Leave");
  same(columns(r), { view: "driver.app.leave.read", add: "driver.app.leave.create", edit: null, delete: null, actions: ["Cancel leave request=driver.app.leave.cancel"] });
  assert.equal(r.delete, null);
});

test("Shift Checklist: submit under Add", () => {
  same(columns(rowOf("Shift Checklist")), { view: "driver.app.checklist.read", add: "driver.app.checklist.submit", edit: null, delete: null, actions: [] });
});

test("My Safety: read only", () => {
  same(columns(rowOf("My Safety")), { view: "driver.app.safety.read", add: null, edit: null, delete: null, actions: [] });
});

test("My Profile: read and update", () => {
  same(columns(rowOf("My Profile")), { view: "driver.app.profile.read", add: null, edit: "driver.app.profile.update", delete: null, actions: [] });
});

const DRIVER_MENUS = ["My Work", "My Shifts", "My Leave", "Shift Checklist", "My Safety", "My Profile"];

test("the parent driver.app is checked and disabled in every driver menu, and can't be changed", () => {
  const s = m.grantedCodes(G);
  for (const title of DRIVER_MENUS) {
    const a = menu(title).access;
    assert.equal(a.code, "driver.app", title);
    assert.equal(s.has(a.code), true, title);
    assert.equal(usable(a), false, title);
  }
  assert.equal(m.setPermission(G, s, "driver.app", false), s);
});

test("child cells stay selectable beside the disabled parent, one at a time", () => {
  const children = DRIVER_MENUS.flatMap((t) => m.menuCells(menu(t)));
  assert.ok(children.length >= 15);
  for (const c of children) assert.equal(usable(c), true, c.code);
  const s = m.grantedCodes(G);
  const off = m.setPermission(G, s, "driver.app.work.respond", false);
  assert.equal(off.has("driver.app.work.respond"), false);
  same([...s].filter((c) => !off.has(c)), ["driver.app.work.respond"], "nothing else moved, not even in the same row");
  assert.equal(m.removalImpact(G, s, "driver.app.work.respond", menu("My Work")).affected.length, 0, "no shared-code dialog for an unshared code");
  const on = m.setPermission(G, off, "driver.app.work.respond", true);
  assert.equal(on.has("driver.app.work.respond"), true);
});

test("a child's editable flag is its own: read-only children don't affect their neighbours", () => {
  const dto = fixture();
  dto.menus.find((x) => x.title === "My Shifts").resources[0].view.editable = false;
  const g = m.readGrid(dto);
  const r = rowOf("My Shifts", "My Shifts", g);
  assert.equal(usable(r.view), false);
  assert.equal(usable(r.add), true);
  assert.equal(usable(r.edit), true);
});

test("null cells stay empty: no code, not granted, not inherited, not in the PUT", () => {
  for (const title of DRIVER_MENUS) for (const r of m.menuRows(menu(title))) for (const k of ["view", "add", "edit", "delete"]) if (r[k] !== null) assert.ok(r[k].code.startsWith("driver.app."), r[k].code);
  const nulls = DRIVER_MENUS.flatMap((t) => m.menuRows(menu(t)).flatMap((r) => ["view", "add", "edit", "delete"].filter((k) => r[k] === null)));
  assert.ok(nulls.length > 0);
  const body = m.permissionCodesToSave(G, m.grantedCodes(G));
  assert.ok(body.every((c) => typeof c === "string" && c.length > 0));
  assert.equal(new Set(body).size, body.length);
});

test("a cell the backend fills later renders with no frontend change", () => {
  const dto = fixture();
  dto.menus.find((x) => x.title === "My Safety").resources[0].delete = { permissionCode: "a.code.from.the.server", granted: false, editable: true };
  const g = m.readGrid(dto);
  assert.equal(rowOf("My Safety", "My Safety", g).delete.code, "a.code.from.the.server");
  assert.equal(m.setPermission(g, m.grantedCodes(g), "a.code.from.the.server", true).has("a.code.from.the.server"), true);
});

test("own.data.read is kept: shown as other codes, no box, not sent, not a change", () => {
  assert.ok(G.otherPermissionCodes.includes("own.data.read"));
  assert.equal(m.allCells(G).some((c) => c.code === "own.data.read"), false);
  assert.equal(m.permissionCodesToSave(G, m.grantedCodes(G)).includes("own.data.read"), false);
  const d = m.diffPermissions(G, m.grantedCodes(G));
  for (const k of ["added", "removed", "unchanged"]) assert.equal(d[k].includes("own.data.read"), false, k);
});

test("the read-only parent is in the save body: a grid code left out would be removed from the role", () => {
  assert.equal(m.permissionCodesToSave(G, m.grantedCodes(G)).includes("driver.app"), true);
});

test("shared-code sync still works next to the driver menus", () => {
  const s = m.grantedCodes(G);
  const on = m.setPermission(G, s, "device.read", true);
  same(m.allCells(G).filter((c) => c.code === "device.read").map((c) => on.has(c.code)), [true, true, true, true]);
  assert.ok(m.removalImpact(G, on, "device.read", menu("Fleet Overview")).affected.includes("Live Monitoring"));
});

test("no driver mapping is hardcoded in the app", () => {
  for (const f of ["components/drive-vision/platform/role-permission-matrix.tsx", "components/drive-vision/platform/role-menu-permission-model.ts", "features/drive-vision/api/role-menu-service.ts"]) assert.doesNotMatch(read(f), /driver\.app|My Work|My Shifts|My Leave/, f);
});

// ── Through the real client, against a stub that follows the PUT contract ───

function openServer(tenants, grids = {}) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  const gridCodes = (dto) => new Set(dto.menus.flatMap((x) => [x.access, ...x.resources.flatMap((r) => [r.view, r.add, r.edit, r.delete, ...r.actions])]).filter(Boolean).map((c) => c.permissionCode));
  const build = (tenantId) => {
    const dto = grids[tenantId] ? grids[tenantId]() : fixture();
    delete dto._source;
    dto.tenantId = tenantId;
    const held = tenants[tenantId];
    const mark = (c) => c && (c.granted = held.has(c.permissionCode));
    for (const x of dto.menus) {
      mark(x.access);
      for (const r of x.resources) [r.view, r.add, r.edit, r.delete, ...r.actions].forEach(mark);
    }
    return dto;
  };
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const tenant = Number(Object.entries(init.headers ?? {}).find(([k]) => k.toLowerCase() === "x-tenant-id")?.[1] ?? 1);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), tenant, body });
    if (fetch.refuseCode && body?.permissionCodes) body.permissionCodes = body.permissionCodes.filter((c) => c !== fetch.refuseCode);
    const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if ((init.method ?? "GET") === "PUT") {
      const onGrid = gridCodes(build(tenant));
      const bad = body.permissionCodes.filter((c) => !onGrid.has(c));
      if (bad.length) return json(400, { code: 400, msg: `Not a checkbox of the menu grid: ${bad}`, data: null, extend: { errorCode: "INVALID_VALUE", fieldErrors: [] } });
      tenants[tenant] = new Set(body.permissionCodes);
    }
    return json(200, { code: 200, msg: "Success", data: build(tenant) });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, AbortController, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined, useMemo: (f) => f() } });
  return { calls, tenants, fetch, svc: realm.require("features/drive-vision/api/role-menu-service").roleMenuService, model: realm.require("components/drive-vision/platform/role-menu-permission-model"), ctx: realm.require("features/drive-vision/api/tenant-context") };
}
const fixtureHeld = () => m.grantedCodes(G);
const T = (tenantId) => ({ tenantId, code: `t${tenantId}`, name: `Tenant ${tenantId}`, header: "X-Tenant-Id" });

test("save then re-read: the changes hold, everything else is unchanged, own.data.read stays", async () => {
  const s = openServer({ 1: fixtureHeld(), 2: new Set() });
  s.ctx.setTenantSelection(T(1));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  const before = s.model.grantedCodes(base);
  let next = s.model.setPermission(base, before, "driver.app.leave.cancel", false);
  next = s.model.setPermission(base, next, "driver.app.work.execute", false);
  const out = await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc);
  assert.equal(out.status, "saved", "the stub refuses any code outside the grid, so own.data.read wasn't sent");
  const put = s.calls.find((c) => c.method === "PUT");
  assert.equal(put.body.permissionCodes.includes("own.data.read"), false);
  assert.equal(put.body.permissionCodes.includes("driver.app"), true);
  const after = s.model.readGrid(await s.svc.getMatrix(4));
  const now = s.model.grantedCodes(after);
  assert.equal(now.has("driver.app.leave.cancel"), false);
  assert.equal(now.has("driver.app.work.execute"), false);
  same([...now].sort(), [...next].sort(), "every other permission is as it was");
  same(after.otherPermissionCodes, base.otherPermissionCodes);
  assert.equal(after.menus.find((x) => x.title === "My Work").access.editable, false, "the parent is still read-only");
});

test("a code that isn't on the grid is refused by the contract's rule: it is the proof the body has none", async () => {
  const s = openServer({ 1: fixtureHeld() });
  await assert.rejects(s.svc.saveMatrix(4, ["own.data.read"]), /Not a checkbox/);
});

test("tenant switching: each tenant loads its own DRIVER grid, and a grid of the wrong tenant is refused", async () => {
  const s = openServer({ 1: fixtureHeld(), 2: new Set(["driver.app", "driver.app.work.read"]) });
  s.ctx.setTenantSelection(T(1));
  const one = s.model.readGrid(await s.svc.getMatrix(4));
  s.ctx.setTenantSelection(T(2));
  const two = s.model.readGrid(await s.svc.getMatrix(4));
  same(s.calls.map((c) => c.tenant), [1, 2]);
  assert.equal(s.model.grantedCodes(one).has("driver.app.shift.start"), true);
  assert.equal(s.model.grantedCodes(two).has("driver.app.shift.start"), false);
  assert.equal(s.model.gridMismatch(one, { tenantId: 2, roleId: 4 }) !== null, true);
  assert.equal(s.model.gridMismatch(two, { tenantId: 2, roleId: 4 }), null);
});

// ── Granular permissions: your 10 scenarios, through the real client ────────

// A tenant that has not received the granular cells: My Work offers driver.app and nothing else.
const olderGrid = () => {
  const dto = fixture();
  dto.menus = dto.menus.filter((x) => !["My Shifts", "My Leave", "Shift Checklist", "My Safety", "My Profile"].includes(x.title));
  const work = dto.menus.find((x) => x.title === "My Work");
  work.resources = [{ label: "My Work", view: { permissionCode: "driver.app", granted: true, editable: true }, add: null, edit: null, delete: null, actions: [] }];
  return dto;
};
const puts = (s) => s.calls.filter((c) => c.method === "PUT");

test("#7 each assigned permission changes alone and saves: Save enables, only that code leaves, the rest are preserved", async () => {
  for (const code of ASSIGNED) {
    const s = openServer({ 1: fixtureHeld() });
    s.ctx.setTenantSelection(T(1));
    const base = s.model.readGrid(await s.svc.getMatrix(4));
    const before = s.model.grantedCodes(base);
    const next = s.model.setPermission(base, before, code, false);
    assert.equal(s.model.saveBlock(base, next, { canUpdate: true }), null, code);
    same(s.model.diffPermissions(base, next).removed, [code]);
    assert.equal((await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc)).status, "saved", code);
    same([...puts(s)[0].body.permissionCodes].sort(), [...before].filter((c) => c !== code).sort());
    assert.equal(s.model.grantedCodes(s.model.readGrid(await s.svc.getMatrix(4))).has(code), false, code);
  }
});

test("#7 a removed permission can be granted back the same way", async () => {
  const held = fixtureHeld();
  held.delete("driver.app.work.execute");
  const s = openServer({ 1: held });
  s.ctx.setTenantSelection(T(1));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  const next = s.model.setPermission(base, s.model.grantedCodes(base), "driver.app.work.execute", true);
  assert.equal(s.model.saveBlock(base, next, { canUpdate: true }), null);
  await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc);
  assert.equal(puts(s)[0].body.permissionCodes.includes("driver.app.work.execute"), true);
});

test("#8 null cells never enter the PUT: the body is exactly the ticked coded cells", async () => {
  const s = openServer({ 1: fixtureHeld() });
  s.ctx.setTenantSelection(T(1));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  const next = s.model.setPermission(base, s.model.grantedCodes(base), "driver.app.swap.create", false);
  await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc);
  const body = puts(s)[0].body.permissionCodes;
  same(Object.keys(puts(s)[0].body), ["permissionCodes"]);
  const coded = new Set(s.model.allCells(base).map((c) => c.code));
  assert.ok(body.every((c) => typeof c === "string" && coded.has(c)), "every entry is a real grid code");
  assert.equal(new Set(body).size, body.length, "no duplicates");
  for (const r of s.model.menuRows(base.menus.find((x) => x.title === "My Work"))) for (const o of s.model.unmappedColumns(r)) assert.equal(r[o.key], null);
  assert.equal(body.some((c) => /null|undefined/.test(String(c))), false);
});

test("#9 tenants 1, 2419 and 2499 load independently: no tenant inherits another's permissions or rows", async () => {
  const s = openServer({ 1: fixtureHeld(), 2419: new Set(["driver.app", "driver.app.work.read"]), 2499: new Set(["driver.app"]) }, { 2499: olderGrid });
  const load = async (id) => {
    s.ctx.setTenantSelection(T(id));
    return s.model.readGrid(await s.svc.getMatrix(4));
  };
  const one = await load(1);
  const a = await load(2419);
  const b = await load(2499);
  same(s.calls.map((c) => c.tenant), [1, 2419, 2499], "each read carried its own tenant");
  same([one.tenantId, a.tenantId, b.tenantId], [1, 2419, 2499]);
  for (const code of ASSIGNED) assert.equal(s.model.grantedCodes(one).has(code), true, code);
  same([...s.model.grantedCodes(a)].sort(), ["driver.app", "driver.app.work.read"], "granular cells exist but aren't granted");
  same([...s.model.grantedCodes(b)], ["driver.app"]);
  assert.equal(s.model.allCells(b).some((c) => c.code.startsWith("driver.app.")), false, "no granular cell is invented for this tenant");
  assert.ok(s.model.gridMismatch(one, { tenantId: 2419, roleId: 4 }), "tenant 1's grid is refused under 2419");
  assert.ok(s.model.gridMismatch(a, { tenantId: 2499, roleId: 4 }), "2419's grid is refused under 2499");
});

test("#9 a save changes one tenant only, and only sends codes that tenant's grid has", async () => {
  const s = openServer({ 1: fixtureHeld(), 2419: new Set(["driver.app"]), 2499: new Set(["driver.app"]) }, { 2499: olderGrid });
  s.ctx.setTenantSelection(T(2419));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  const next = s.model.setPermission(base, s.model.grantedCodes(base), "driver.app.safety.read", true);
  await s.model.saveIfUnchanged(base, next, { tenantId: 2419, roleId: 4 }, s.svc);
  assert.equal(puts(s)[0].tenant, 2419);
  assert.equal(s.tenants[2419].has("driver.app.safety.read"), true);
  same([...s.tenants[2499]], ["driver.app"]);
  same([...s.tenants[1]].sort(), [...fixtureHeld()].sort());
  const older = s.model.readGrid(olderGrid());
  same(s.model.permissionCodesToSave(older, new Set(["driver.app", "driver.app.work.read"])), ["driver.app"], "a code the tenant's grid doesn't have can't be sent");
});

test("#10 save and reload: the screen follows the backend's state, also when the backend kept less than was asked", async () => {
  const s = openServer({ 1: new Set(["driver.app"]) });
  s.ctx.setTenantSelection(T(1));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  let next = s.model.setPermission(base, s.model.grantedCodes(base), "driver.app.work.respond", true);
  next = s.model.setPermission(base, next, "driver.app.work.execute", true);
  s.fetch.refuseCode = "driver.app.work.execute";
  const out = await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc);
  const shown = s.model.grantedCodes(s.model.readGrid(out.dto));
  assert.equal(shown.has("driver.app.work.respond"), true);
  assert.equal(shown.has("driver.app.work.execute"), false, "the saved response decides, not the ticks");
  same([...s.model.grantedCodes(s.model.readGrid(await s.svc.getMatrix(4)))].sort(), [...shown].sort(), "a later read agrees");
});

test("#10 after a save the screen drops the edits, shows the response and re-reads", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  const save = ui.slice(ui.indexOf("async function save()"), ui.indexOf("const switchDescription"));
  assert.match(save, /setSaved\(\{ key: editKey, readAt: matrixQ\.updatedAt, dto: outcome\.dto \}\);\s*setEdits\(null\);[\s\S]*matrixQ\.refetch\(\);/);
});

// ── My Work CRUD codes ──────────────────────────────────────────────────────
// Two states. As reported today: the three codes are only in otherPermissionCodes. The `mapped` grid below is
// HYPOTHETICAL: the desired contract from the brief, built here in the test only, to prove the screen will work when the
// backend sends it. The app has no such mapping, and no test here shows the backend does.

const CRUD = { add: "driver.app.work.create", edit: "driver.app.work.update", delete: "driver.app.work.delete" };
const CRUD_CODES = Object.values(CRUD);
const mapped = () => {
  const dto = fixture();
  const r = dto.menus.find((x) => x.title === "My Work").resources[0];
  for (const [k, code] of Object.entries(CRUD)) r[k] = { permissionCode: code, granted: true, editable: true };
  dto.otherPermissionCodes = dto.otherPermissionCodes.filter((c) => !CRUD_CODES.includes(c));
  return dto;
};
const heldWithCrud = () => new Set([...fixtureHeld(), ...CRUD_CODES]);

test("CRUD #1 as reported today: the three codes are outside the grid and My Work Add, Edit and Delete stay null", () => {
  same(G.otherPermissionCodes, [...CRUD_CODES, "own.data.read"]);
  for (const code of CRUD_CODES) assert.equal(m.allCells(G).some((c) => c.code === code), false, code);
  same(m.unmappedColumns(rowOf("My Work")).map((o) => o.key), ["add", "edit", "delete"]);
});

test("CRUD #2 outside the grid they can't be ticked, aren't sent, and are refused if forced", async () => {
  const s = m.grantedCodes(G);
  for (const code of CRUD_CODES) assert.equal(m.setPermission(G, s, code, true), s, code);
  const forced = new Set([...s, ...CRUD_CODES]);
  for (const code of CRUD_CODES) assert.equal(m.permissionCodesToSave(G, forced).includes(code), false, code);
  const server = openServer({ 1: fixtureHeld() });
  for (const code of CRUD_CODES) await assert.rejects(server.svc.saveMatrix(4, [code]), /Not a checkbox/);
});

test("CRUD #3 outside the grid they survive a save: the other codes come back unchanged", async () => {
  const s = openServer({ 1: fixtureHeld() });
  s.ctx.setTenantSelection(T(1));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  await s.model.saveIfUnchanged(base, s.model.setPermission(base, s.model.grantedCodes(base), "driver.app.work.respond", false), { tenantId: 1, roleId: 4 }, s.svc);
  for (const code of [...CRUD_CODES, "own.data.read"]) assert.equal(puts(s)[0].body.permissionCodes.includes(code), false, code);
  same(s.model.readGrid(await s.svc.getMatrix(4)).otherPermissionCodes, [...CRUD_CODES, "own.data.read"]);
});

test("the app hardcodes no CRUD code or cell", () => {
  for (const f of ["components/drive-vision/platform/role-permission-matrix.tsx", "components/drive-vision/platform/role-menu-permission-model.ts", "features/drive-vision/api/role-menu-service.ts", "features/drive-vision/access/access-policy.ts"]) assert.doesNotMatch(read(f), /driver\.app\.work\.(create|update|delete)/, f);
});

test("HYPOTHETICAL mapped grid: the codes appear in the right columns with no frontend change, and leave the other codes", () => {
  const g = m.readGrid(mapped());
  same(columns(rowOf("My Work", "My Work", g)), { view: "driver.app.work.read", add: CRUD.add, edit: CRUD.edit, delete: CRUD.delete, actions: [] });
  same(m.unmappedColumns(rowOf("My Work", "My Work", g)), []);
  same(g.otherPermissionCodes, ["own.data.read"]);
});

test("HYPOTHETICAL mapped grid: each state comes from the response, and a read-only parent doesn't disable a CRUD cell", () => {
  for (const [granted, editable] of [[true, true], [false, true], [true, false], [false, false]]) {
    const dto = mapped();
    Object.assign(dto.menus.find((x) => x.title === "My Work").resources[0].add, { granted, editable });
    const g = m.readGrid(dto);
    const add = rowOf("My Work", "My Work", g).add;
    assert.equal(m.grantedCodes(g).has(CRUD.add), granted);
    assert.equal(usable(add), editable);
    assert.equal(usable(rowOf("My Work", "My Work", g).edit), true, "the neighbour keeps its own flags");
  }
  const g = m.readGrid(mapped());
  assert.equal(usable(menu("My Work", g).access), false, "the parent is read-only");
});

test("HYPOTHETICAL mapped grid: each CRUD code changes alone; actions and own.data.read are untouched; PUT, then GET, then reload hold", async () => {
  for (const code of CRUD_CODES) {
    const s = openServer({ 1: heldWithCrud(), 2419: new Set(["driver.app"]), 2499: new Set(["driver.app"]) }, { 1: mapped, 2419: mapped });
    s.ctx.setTenantSelection(T(1));
    const base = s.model.readGrid(await s.svc.getMatrix(4));
    const before = s.model.grantedCodes(base);
    const next = s.model.setPermission(base, before, code, false);
    same(s.model.diffPermissions(base, next).removed, [code]);
    assert.equal(s.model.saveBlock(base, next, { canUpdate: true }), null);
    const out = await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc);
    same(out.unconfirmed, [], "the returned granted values match");
    const body = puts(s)[0].body.permissionCodes;
    same([...body].sort(), [...before].filter((c) => c !== code).sort(), "the complete list, less the one change");
    for (const kept of ["driver.app.work.read", "driver.app.work.respond", "driver.app.work.execute", "driver.app.swap.create"]) assert.ok(body.includes(kept), kept);
    assert.equal(body.includes("own.data.read"), false);
    same(s.calls.map((c) => c.method), ["GET", "GET", "PUT"], "read, conflict check, save");
    const again = s.model.readGrid(await s.svc.getMatrix(4));
    same(s.calls.at(-1).method, "GET", "a re-read follows the save");
    assert.equal(s.model.grantedCodes(again).has(code), false, code);
    same(again.otherPermissionCodes, ["own.data.read"]);
    same([...s.tenants[2419]], ["driver.app"], "tenant 2419 is unchanged");
    same([...s.tenants[2499]], ["driver.app"], "tenant 2499 is unchanged");
    assert.equal(puts(s).every((c) => c.tenant === 1), true);
  }
});

test("HYPOTHETICAL mapped grid in one tenant only: another tenant still gets its own unmapped grid", async () => {
  const s = openServer({ 1: heldWithCrud(), 2419: new Set(["driver.app"]) }, { 1: mapped });
  s.ctx.setTenantSelection(T(1));
  const one = s.model.readGrid(await s.svc.getMatrix(4));
  s.ctx.setTenantSelection(T(2419));
  const other = s.model.readGrid(await s.svc.getMatrix(4));
  assert.equal(s.model.allCells(one).some((c) => c.code === CRUD.add), true);
  assert.equal(s.model.allCells(other).some((c) => c.code === CRUD.add), false);
});

test("a save the backend doesn't confirm is reported, through the real client", async () => {
  const s = openServer({ 1: new Set(["driver.app"]) });
  s.ctx.setTenantSelection(T(1));
  const base = s.model.readGrid(await s.svc.getMatrix(4));
  const next = s.model.setPermission(base, s.model.grantedCodes(base), "driver.app.work.execute", true);
  s.fetch.refuseCode = "driver.app.work.execute";
  const out = await s.model.saveIfUnchanged(base, next, { tenantId: 1, roleId: 4 }, s.svc);
  same(out.unconfirmed, ["driver.app.work.execute"]);
});

test("CRUD #11 the driver UI respects driver.app.work.create, update and delete", { todo: "My Work has no Create, Edit or Delete action to gate, and reads no driver.app.work code: integration gap in the report" });
test("CRUD #12 the backend rejects unauthorized direct operations", { todo: "needs a designated test environment and test accounts: backend dependency in the report" });
