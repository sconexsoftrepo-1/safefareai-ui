// Phase 5 — tenant context, request tenant header, switching, tenant-scoped write gating, cache scope.
// MOCKED / SYNTHETIC ONLY: identities are synthetic (real V10 permission codes) and every request goes to a
// stub fetch. Nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { ALL_CODES, TENANT_CODES, OFF_SPEC_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const STORAGE_KEY = "safefare:session:v1";
const synthetic = (extra) => ({ userId: 100, homeTenantId: 10, tenantId: 10, roleId: 50, roleCode: "ADMIN", platform: false, permissions: [], screens: [], ...extra });
const SFA = synthetic({ platform: true, homeTenantId: null, tenantId: null, permissions: [...ALL_CODES, ...OFF_SPEC_CODES] });
const TENANT_ADMIN = synthetic({ permissions: [...TENANT_CODES, ...OFF_SPEC_CODES] });

/** A realm running the real client, tenant context and tenant store against a stub fetch. */
function openRealm(respond = () => [200, { code: 200, msg: "Success", data: null }]) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const headers = init.headers ?? {};
    const call = { method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), query: Object.fromEntries(u.searchParams), headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const out = await respond(call);
    const [status, body] = out;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm(
    { console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } },
    { react: { useSyncExternalStore: () => undefined, useMemo: (f) => f() } }
  );
  const r = (m) => realm.require(m);
  const policy = r("features/drive-vision/access/access-policy");
  const idm = r("features/drive-vision/access/identity");
  return {
    calls,
    api: r("features/drive-vision/api/client"),
    ctx: r("features/drive-vision/api/tenant-context"),
    scope: r("features/drive-vision/api/tenant-scope"),
    store: r("features/drive-vision/store/tenant-store"),
    policy,
    access: (raw, selectedTenantId) => policy.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId }),
  };
}
const ok = (data) => [200, { code: 200, msg: "Success", data }];
const header = (call, name = "X-Tenant-Id") => Object.entries(call.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

// ── Tenant context ──────────────────────────────────────────────────────────

test("P5 context: starts with no tenant; set/clear; invalid ids or header names are refused", () => {
  const { ctx } = openRealm();
  assert.equal(ctx.getTenantSelection(), null);
  assert.equal(ctx.tenantScopeKey(), "all");
  ctx.setTenantSelection({ tenantId: 7, code: "ACME", name: "Acme", header: "X-Tenant-Id" });
  assert.equal(ctx.getTenantSelection().tenantId, 7);
  assert.equal(ctx.tenantScopeKey(), "t:7");
  for (const bad of [{ tenantId: 0 }, { tenantId: -1 }, { tenantId: 1.5 }, { tenantId: "7" }, { tenantId: null }, { tenantId: 7, header: "Authorization" }, { tenantId: 7, header: "" }, { tenantId: 7, header: "Tenant" }, { tenantId: 7, header: "X-Request-Id" }]) {
    assert.throws(() => ctx.setTenantSelection({ code: null, name: null, header: "X-Tenant-Id", ...bad }), /Invalid tenant selection/, JSON.stringify(bad));
  }
  assert.equal(ctx.getTenantSelection().tenantId, 7, "a refused value leaves the selection unchanged");
  ctx.setTenantSelection(null);
  assert.equal(ctx.getTenantSelection(), null);
});

test("P5 context: header-name guard accepts only X-… tokens that can't overwrite credentials", () => {
  const { ctx } = openRealm();
  for (const good of ["X-Tenant-Id", "X-Tenant", "x-tenant-id"]) assert.equal(ctx.isSafeTenantHeader(good), true, good);
  for (const bad of ["Authorization", "Cookie", "X-Request-Id", "X Tenant", "X-", "Tenant-Id", "X-Tenant-Id\r\nX-Evil: 1", 42, null]) assert.equal(ctx.isSafeTenantHeader(bad), false, String(bad));
});

// ── Request classification and header ───────────────────────────────────────

test("P5 scope: platform and self paths are never tenant-scoped; fleet data is", () => {
  const { scope } = openRealm();
  const want = {
    "/platform/tenants": "PLATFORM_WIDE",
    "/platform/switch-tenant": "PLATFORM_WIDE",
    "/auth/login": "SELF",
    "/me": "SELF",
    "/me/permissions": "SELF",
    "/me/preferences": "SELF",
    "/notifications/unread-count": "SELF",
    "/driver/me": "SELF",
    "/drivers": "TENANT_SCOPED",
    "/drivers/5": "TENANT_SCOPED",
    "/dashboard/overview": "TENANT_SCOPED",
    "/users/3/status": "TENANT_SCOPED",
    "/groups": "TENANT_SCOPED",
    "/alerts/1/acknowledge": "TENANT_SCOPED",
    "/mechanics": "TENANT_SCOPED",
  };
  for (const [p, s] of Object.entries(want)) assert.equal(scope.tenantScopeFor(p), s, p);
});

test("P5 API: platform-wide mode sends no tenant header (not empty, not null) and never ?tenantId", async () => {
  const s = openRealm(() => ok([]));
  await s.api.api.get("/drivers");
  await s.api.api.get("/dashboard/overview");
  await s.api.api.post("/drivers", { name: "x" });
  for (const c of s.calls) {
    assert.equal(header(c), undefined, c.path);
    assert.ok(!Object.keys(c.headers).some((k) => /tenant/i.test(k)), `${c.path}: no tenant-like header`);
    assert.ok(!("tenantId" in c.query));
  }
});

test("P5 API: selected-tenant mode — header on tenant-scoped calls only; header name from the selection; bearer unchanged", async () => {
  const s = openRealm(() => ok([]));
  s.ctx.setTenantSelection({ tenantId: 7, code: "ACME", name: "Acme", header: "X-Tenant-Id" });
  await s.api.api.get("/drivers");
  await s.api.api.put("/drivers/5", { name: "x" });
  await s.api.api.delete("/geofences/2");
  await s.api.api.get("/platform/tenants");
  await s.api.api.get("/me/permissions");
  await s.api.api.get("/notifications/unread-count");
  await s.api.api.get("/driver/me");
  await s.api.api.post("/auth/login", { login: "u", password: "p" }, { auth: false });
  await s.api.api.get("/drivers", { tenant: "none" });
  same(s.calls.map((c) => [c.path, header(c) ?? null]), [
    ["/drivers", "7"],
    ["/drivers/5", "7"],
    ["/geofences/2", "7"],
    ["/platform/tenants", null],
    ["/me/permissions", null],
    ["/notifications/unread-count", null],
    ["/driver/me", null],
    ["/auth/login", null],
    ["/drivers", null],
  ]);
  for (const c of s.calls) assert.ok(!("tenantId" in c.query), `${c.path}: header only, never also ?tenantId (INVALID_TENANT)`);
  for (const c of s.calls.slice(0, 7)) assert.equal(c.headers.Authorization, "Bearer a.b.c", `${c.path}: bearer preserved`);
  // A server-provided header name is used as given.
  s.ctx.setTenantSelection({ tenantId: 8, code: null, name: null, header: "X-Tenant" });
  await s.api.api.get("/drivers");
  assert.equal(header(s.calls.at(-1), "X-Tenant"), "8");
  assert.equal(header(s.calls.at(-1)), undefined);
});

test("P5 API: the 401 retry carries the same tenant as the first attempt, with the refreshed token", async () => {
  let first = true;
  const s = openRealm((c) => {
    if (c.path === "/auth/refresh") return ok({ accessToken: "n.e.w", refreshToken: "r2", tokenType: "Bearer", expiresIn: 600 });
    if (c.path === "/drivers" && first) {
      first = false;
      return [401, { code: 401, msg: "expired", data: null }];
    }
    return ok([]);
  });
  s.ctx.setTenantSelection({ tenantId: 7, code: null, name: null, header: "X-Tenant-Id" });
  const pending = s.api.api.get("/drivers");
  await pending;
  const drivers = s.calls.filter((c) => c.path === "/drivers");
  assert.equal(drivers.length, 2, "exactly one retry");
  same(drivers.map((c) => header(c)), ["7", "7"]);
  assert.equal(drivers[1].headers.Authorization, "Bearer n.e.w");
  const refresh = s.calls.find((c) => c.path === "/auth/refresh");
  assert.equal(header(refresh), undefined, "refresh call carries no tenant");
});

test("P5 API: a scoped request rejected with INVALID_TENANT clears the selection (UI never keeps a rejected tenant)", async () => {
  const s = openRealm((c) => (c.path === "/drivers" ? [400, { code: 400, msg: "Invalid tenant", data: null, extend: { errorCode: "INVALID_TENANT" } }] : ok([])));
  s.ctx.setTenantSelection({ tenantId: 7, code: null, name: null, header: "X-Tenant-Id" });
  await assert.rejects(s.api.api.get("/drivers"));
  assert.equal(s.ctx.getTenantSelection(), null);
  assert.match(s.store.getTenantSwitchState().error, /rejected/);
});

// ── Switching ───────────────────────────────────────────────────────────────

test("P5 switch: success — POST /platform/switch-tenant {tenantId} without a tenant header, then the context changes", async () => {
  const s = openRealm((c) => (c.path === "/platform/switch-tenant" ? ok({ tenantId: 7, code: "ACME", name: "Acme Logistics", header: "X-Tenant-Id" }) : ok([])));
  const done = await s.store.selectTenant(s.access(SFA), { id: 7, code: "ACME", name: "Acme", status: "ACTIVE" });
  assert.equal(done, true);
  const sw = s.calls.find((c) => c.path === "/platform/switch-tenant");
  same(sw.body, { tenantId: 7 });
  assert.equal(sw.method, "POST");
  assert.equal(header(sw), undefined, "no stale tenant header on the switch call");
  same({ ...s.ctx.getTenantSelection() }, { tenantId: 7, code: "ACME", name: "Acme Logistics", header: "X-Tenant-Id" });
  same({ ...s.store.getTenantSwitchState() }, { pendingTenantId: null, error: null });
  // No re-authentication: no auth calls were made.
  assert.ok(!s.calls.some((c) => c.path.startsWith("/auth/")));
});

test("P5 switch: header name missing → V10 default; unusable header name or mismatched tenant → refused, selection unchanged", async () => {
  let reply = { tenantId: 7, code: "A", name: "A" };
  const s = openRealm(() => ok(reply));
  assert.equal(await s.store.selectTenant(s.access(SFA), { id: 7 }), true);
  assert.equal(s.ctx.getTenantSelection().header, "X-Tenant-Id");
  for (const bad of [{ tenantId: 8, header: "Authorization" }, { tenantId: 9, header: "X-Tenant-Id" }]) {
    reply = bad;
    assert.equal(await s.store.selectTenant(s.access(SFA, 7), { id: 8 }), false);
    assert.equal(s.ctx.getTenantSelection().tenantId, 7, `still tenant 7 after ${JSON.stringify(bad)}`);
    assert.ok(s.store.getTenantSwitchState().error);
  }
});

test("P5 switch: failure (INVALID_TENANT, 403, 409, 503) keeps the previous selection and shows a specific message", async () => {
  const cases = [
    [[400, { code: 400, msg: "x", data: null, extend: { errorCode: "INVALID_TENANT" } }], /doesn't exist or isn't active/],
    [[403, { code: 403, msg: "x", data: null, extend: { errorCode: "FORBIDDEN" } }], /isn't allowed/],
    [[409, { code: 409, msg: "Tenant is being migrated", data: null }], /migrated/],
    [[503, { code: 503, msg: "Database unavailable", data: null }], /Database unavailable/],
  ];
  for (const [reply, message] of cases) {
    const s = openRealm(() => reply);
    s.ctx.setTenantSelection({ tenantId: 3, code: "OLD", name: "Old", header: "X-Tenant-Id" });
    assert.equal(await s.store.selectTenant(s.access(SFA, 3), { id: 9, status: "ACTIVE" }), false);
    assert.equal(s.ctx.getTenantSelection().tenantId, 3);
    assert.match(s.store.getTenantSwitchState().error, message);
    assert.equal(s.store.getTenantSwitchState().pendingTenantId, null);
  }
});

test("P5 switch: inactive tenant, tenant ADMIN, and Safe-Fare Admin without tenant.all are refused without any request", async () => {
  const s = openRealm(() => ok({ tenantId: 7, header: "X-Tenant-Id" }));
  assert.equal(await s.store.selectTenant(s.access(SFA), { id: 7, status: "INACTIVE" }), false);
  assert.match(s.store.getTenantSwitchState().error, /active/);
  assert.equal(await s.store.selectTenant(s.access(TENANT_ADMIN), { id: 7, status: "ACTIVE" }), false);
  assert.equal(await s.store.selectTenant(s.access({ ...SFA, permissions: TENANT_CODES }), { id: 7, status: "ACTIVE" }), false);
  assert.equal(await s.store.selectTenant(s.access(SFA), { id: undefined }), false);
  assert.equal(s.calls.length, 0);
  assert.equal(s.ctx.getTenantSelection(), null);
});

test("P5 switch: rapid switching — the latest wins; a late earlier response can't overwrite it; duplicate clicks send one request", async () => {
  const slow = deferred();
  const s = openRealm(async (c) => {
    if (c.body?.tenantId === 7) {
      await slow.promise;
      return ok({ tenantId: 7, header: "X-Tenant-Id" });
    }
    return ok({ tenantId: c.body.tenantId, header: "X-Tenant-Id" });
  });
  const a = s.access(SFA);
  const first = s.store.selectTenant(a, { id: 7 });
  const dup = s.store.selectTenant(a, { id: 7 });
  await new Promise((r) => setTimeout(r, 30)); // let any request reach fetch
  assert.equal(s.calls.filter((c) => c.body?.tenantId === 7).length, 1, "duplicate submission sent no second request");
  assert.equal(await s.store.selectTenant(a, { id: 8 }), true);
  slow.resolve();
  assert.equal(await first, false, "superseded");
  assert.equal(await dup, false, "duplicate ignored");
  assert.equal(s.ctx.getTenantSelection().tenantId, 8);
  assert.equal(s.calls.filter((c) => c.body?.tenantId === 7).length, 1);
});

test("P5 switch: clearing during a pending switch drops its result; clear returns to platform-wide mode", async () => {
  const slow = deferred();
  const s = openRealm(async () => {
    await slow.promise;
    return ok({ tenantId: 7, header: "X-Tenant-Id" });
  });
  const p = s.store.selectTenant(s.access(SFA), { id: 7 });
  s.store.clearTenantSelection();
  slow.resolve();
  assert.equal(await p, false);
  assert.equal(s.ctx.getTenantSelection(), null);
  await s.api.api.get("/drivers");
  assert.equal(header(s.calls.at(-1)), undefined, "no header after clear");
});

test("P5 switch: ending the session clears the selection", () => {
  const s = openRealm();
  s.ctx.setTenantSelection({ tenantId: 7, code: null, name: null, header: "X-Tenant-Id" });
  s.api.endSession("signed-out");
  assert.equal(s.ctx.getTenantSelection(), null);
});

// ── Writes ──────────────────────────────────────────────────────────────────

// Phase 5 classified 26 operations (5 / 19 / 2). The device-edit work added PUT /devices/{id} as class B.
test("P5 writes: the tenant-scoped operations — 8 create (A: 5 + vehicle + sensor reading + device registration), 22 record update (B: 19 + device edit + vehicle + stop recalculation), 3 record delete (C: 2 + vehicle)", () => {
  const { policy } = openRealm();
  const byClass = {};
  for (const key of policy.ALL_ACTIONS) {
    const def = policy.ACTIONS[key];
    assert.equal(def.tenantWrite, def.tenantClass !== undefined, `${key}: tenantWrite ⇔ tenantClass`);
    if (def.tenantClass) byClass[def.tenantClass] = (byClass[def.tenantClass] ?? 0) + def.requires.operations.length;
  }
  assert.deepEqual({ ...byClass }, { CREATE_REQUIRES_SELECTED_TENANT: 8, EXISTING_RECORD_UPDATE: 22, EXISTING_RECORD_DELETE: 3 });
  for (const key of policy.ALL_ACTIONS) {
    const def = policy.ACTIONS[key];
    if (def.tenantClass === "CREATE_REQUIRES_SELECTED_TENANT") for (const op of def.requires.operations) assert.match(op, /^POST /, `${key}: creates are POSTs`);
    if (def.tenantClass === "EXISTING_RECORD_DELETE") for (const op of def.requires.operations) assert.match(op, /^DELETE .*\{id\}$/, key);
    if (def.tenantClass === "EXISTING_RECORD_UPDATE") for (const op of def.requires.operations) assert.match(op, /\{id\}/, `${key}: targets an existing record`);
  }
  assert.equal(policy.RECORD_TENANT_RESOLUTION_CONFIRMED.size, 0, "no record-tenant resolution assumed without backend confirmation");
});

test("P5 writes: Safe-Fare Admin without a tenant — every tenant write blocked (reason: tenant), own-account actions still allowed", () => {
  const { policy, access } = openRealm();
  const a = access(SFA);
  const tenantWrites = policy.ALL_ACTIONS.filter((k) => policy.ACTIONS[k].tenantWrite);
  for (const k of tenantWrites) {
    assert.equal(policy.canPerform(a, k), false, k);
    assert.equal(policy.actionBlock(a, k), "tenant", k);
    assert.equal(policy.needsTenantSelection(a, k), true, k);
  }
  for (const k of ["settings.manage", "account.password", "notifications.markRead"]) assert.equal(policy.canPerform(a, k), true, k);
  same([...policy.tenantBlockedScreens(a)].sort(), ["alerts", "dispatch", "drivers", "geofences", "sensors", "users", "vehicleRegistry", "vehicles", "video", "workforce"]);
});

test("P5 writes: with a selected tenant every permitted write is offered; nothing is tenant-blocked", () => {
  const { policy, access } = openRealm();
  const a = access(SFA, 7);
  assert.equal(a.tenantId, 7);
  for (const k of policy.ALL_ACTIONS.filter((x) => policy.ACTIONS[x].tenantWrite)) assert.equal(policy.canPerform(a, k), true, k);
  assert.equal(a.tenantBlockedActions.size, 0);
  assert.equal(policy.dataScope(a), "tenant");
});

test("P5 writes: tenant users can't be retargeted — a selection is ignored; their writes need no selection", () => {
  const { policy, access } = openRealm();
  for (const raw of [TENANT_ADMIN, IDENTITIES.fleetOwner]) {
    const a = access(raw, 999);
    assert.equal(a.tenantId, raw.tenantId, "tenant comes from the identity, not the selection");
    assert.equal(a.tenantBlockedActions.size, 0);
    assert.equal(policy.dataScope(a), "tenant");
    assert.equal(policy.canAccessPlatform(a), false);
  }
  assert.equal(policy.canPerform(access(TENANT_ADMIN), "drivers.create"), true);
});

// ── Cache scope ─────────────────────────────────────────────────────────────

test("P5 cache: query keys are tenant-scoped, so tenants and platform-wide data never share an entry", () => {
  const realm = createRealm({ process: { env: {} } }, { react: { useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}], useSyncExternalStore: () => "all" } });
  const q = realm.require("features/drive-vision/hooks/use-api-query");
  assert.equal(q.scopedKey("all", "overview:dashboard"), "all|overview:dashboard");
  assert.equal(q.scopedKey("t:7", "overview:dashboard"), "t:7|overview:dashboard");
  assert.notEqual(q.scopedKey("t:7", "k"), q.scopedKey("t:8", "k"));
  assert.equal(q.scopedKey("t:7", null), null, "skipped queries stay skipped");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "features", "drive-vision", "hooks", "use-api-query.ts"), "utf8");
  assert.match(src, /const key = scopedKey\(scope, rawKey\)/, "every useApiQuery key goes through the tenant scope");
  const shell = fs.readFileSync(path.join(__dirname, "..", "src", "components", "drive-vision", "app-shell", "app-shell.tsx"), "utf8");
  assert.match(shell, /key=\{tenantScope\}/, "page content remounts on a tenant change (filters, pagination, drawers reset)");
});

// ── Regression ──────────────────────────────────────────────────────────────

test("P5 regression: tenant management and switcher are Safe-Fare Admin + tenant.all only; driver and tenant ADMIN unchanged", () => {
  const { policy, access } = openRealm();
  assert.equal(policy.canAccessScreen(access(SFA), "tenants"), true);
  assert.equal(policy.canAccessScreen(access(SFA), "platform"), true);
  for (const raw of [TENANT_ADMIN, { ...TENANT_ADMIN, permissions: ALL_CODES }, { ...SFA, permissions: TENANT_CODES }, IDENTITIES.driver]) {
    const a = access(raw);
    assert.equal(policy.canAccessScreen(a, "tenants"), false);
    assert.equal(policy.decideRoute("authenticated", a, "/drive-vision/tenants").kind, "forbidden");
  }
  same([...access(IDENTITIES.driver).screens], ["myWork"]);
  const switcher = fs.readFileSync(path.join(__dirname, "..", "src", "components", "drive-vision", "app-shell", "tenant-switcher.tsx"), "utf8");
  assert.match(switcher, /if \(!ctx\.canSelectTenant\) return null;/);
});

test("P5 regression: the platform tenant list is never narrowed to the selected tenant", async () => {
  const s = openRealm(() => ok([]));
  s.ctx.setTenantSelection({ tenantId: 7, code: null, name: null, header: "X-Tenant-Id" });
  await s.api.api.get("/platform/tenants");
  await s.api.api.post("/platform/switch-tenant", { tenantId: 8 }, { tenant: "none" });
  for (const c of s.calls) assert.equal(header(c), undefined, c.path);
});
