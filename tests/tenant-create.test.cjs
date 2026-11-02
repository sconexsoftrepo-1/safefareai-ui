// Tenant creation (POST /api/v1/platform/tenants). The contract was supplied by the backend team on 2026-11-02
// and is NOT in api-docs-v10.json. MOCKED / SYNTHETIC ONLY: tenants, identities and responses are synthetic
// (the permission codes are real V10 codes), and requests go to a stub fetch. Nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { SPEC, ALL_CODES, TENANT_CODES, IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const pure = createRealm({ process: { env: {} } }, { react: { useSyncExternalStore: () => null } });
const m = pure.require("components/drive-vision/platform/tenant-create-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const errorsMod = pure.require("features/drive-vision/api/errors");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });

const SFA = { ...IDENTITIES.platformAdmin, permissions: ALL_CODES };
/** SYNTHETIC tenants and created response (shape as observed, values invented). */
const LIST = [
  { id: 1, code: "BASE", name: "Synthetic Base", status: "ACTIVE" },
  { id: 2, code: "OLD", name: "Synthetic Old", status: "INACTIVE" },
];
const CREATED = { id: 9001, code: "SYNTHA", name: "Synthetic A", status: "ACTIVE", timezone: "Asia/Kolkata", s3Prefix: "", users: 0, devices: 0, drivers: 0, current: false, createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z" };

// ── Defaults, form and request body ─────────────────────────────────────────

test("TC defaults: timezone Asia/Kolkata, status ACTIVE, permission source tenant 1, empty code", () => {
  same(m.emptyCreateForm(), { code: "", name: "", timezone: "Asia/Kolkata", status: "ACTIVE", s3Prefix: "" });
  assert.equal(m.DEFAULT_PERMISSION_SOURCE_TENANT_ID, 1);
  assert.equal(m.buildCreateRequest({ ...m.emptyCreateForm(), name: "X" }).copyRolePermissionsFromTenantId, 1);
});

test("TC request: exactly the six contract fields, trimmed; empty code sent as \"\"; nothing hard-coded", () => {
  const body = m.buildCreateRequest({ code: "", name: "  Synthetic Transport ", timezone: " Asia/Kolkata ", status: "ACTIVE", s3Prefix: "" });
  same(body, { code: "", name: "Synthetic Transport", timezone: "Asia/Kolkata", status: "ACTIVE", s3Prefix: "", copyRolePermissionsFromTenantId: 1 });
  same(Object.keys(body), ["code", "name", "timezone", "status", "s3Prefix", "copyRolePermissionsFromTenantId"]);
  same(m.buildCreateRequest({ code: "SYN1", name: "N", timezone: "UTC", status: "INACTIVE", s3Prefix: " tenants/syn1 " }), { code: "SYN1", name: "N", timezone: "UTC", status: "INACTIVE", s3Prefix: "tenants/syn1", copyRolePermissionsFromTenantId: 1 });
  const src = read("components/drive-vision/platform/tenant-create-model.ts") + read("components/drive-vision/platform/tenant-create-panel.tsx");
  assert.doesNotMatch(src, /charan|s3Prefix: "string"|name: "[A-Z]/i, "example values from the contract are not hard-coded");
});

test("TC validation: name required; code optional (no spaces); valid IANA timezone; status from the list", () => {
  const statuses = ["ACTIVE"];
  const ok = { ...m.emptyCreateForm(), name: "Synthetic" };
  same(m.validateCreate(ok, statuses), {});
  assert.ok(m.validateCreate({ ...ok, name: "   " }, statuses).name);
  assert.ok(m.validateCreate({ ...ok, code: "A B" }, statuses).code);
  assert.equal(m.validateCreate({ ...ok, code: "" }, statuses).code, undefined, "empty code allowed (server generates)");
  for (const tz of ["", "India Standard Time", "+05:30", "Mars/Olympus", "Asia/"]) assert.ok(m.validateCreate({ ...ok, timezone: tz }, statuses).timezone, tz);
  for (const tz of ["Asia/Kolkata", "UTC", "America/New_York", "Europe/London"]) assert.equal(m.validateCreate({ ...ok, timezone: tz }, statuses).timezone, undefined, tz);
  assert.ok(m.validateCreate({ ...ok, status: "PENDING" }, statuses).status, "invented status rejected");
});

test("TC options: timezone list always has Asia/Kolkata; statuses come from the catalogue, else ACTIVE + returned values", () => {
  const z = m.timezoneOptions(["Europe/London", "Asia/Calcutta"]);
  assert.ok(z.includes("Asia/Kolkata") && z.includes("UTC") && z.includes("Europe/London"));
  assert.equal(new Set(z).size, z.length);
  assert.ok(m.timezoneOptions().includes("Asia/Kolkata"));
  same(m.createStatusOptions(LIST, null), ["ACTIVE", "INACTIVE"]);
  same(m.createStatusOptions([], null), ["ACTIVE"]);
  same(m.createStatusOptions(LIST, { name: "tenant", values: ["ACTIVE", "SUSPENDED", " "] }), ["ACTIVE", "SUSPENDED"]);
});

test("TC review: name, code (or server-generated), timezone, status, S3 prefix and the permission source", () => {
  const rows = m.reviewRows(m.buildCreateRequest({ ...m.emptyCreateForm(), name: "Synthetic" }), LIST[0]);
  same(rows.map((r) => [r.label, r.value]), [
    ["Name", "Synthetic"],
    ["Code", "Generated by the server"],
    ["Time zone", "Asia/Kolkata"],
    ["Status", "ACTIVE"],
    ["S3 prefix", "Not set (sent empty)"],
    ["Copy role permissions from", "Tenant 1 (Synthetic Base)"],
  ]);
  assert.equal(m.reviewRows(m.buildCreateRequest({ ...m.emptyCreateForm(), name: "S" }), undefined)[5].value, "Tenant 1");
});

test("TC success: ID and code come from the server response (the generated code), never from the request", () => {
  const s = m.createdSummary(CREATED);
  same(s, { id: 9001, code: "SYNTHA", name: "Synthetic A" });
  assert.equal(m.createdMessage(s), "Synthetic A created · ID 9001 · code SYNTHA");
  same(m.createdSummary({}), { id: null, code: null, name: null });
  assert.equal(m.createdMessage(m.createdSummary({})), "Tenant created · ID not returned · code not returned");
});

test("TC errors: duplicate code, validation field errors, 401/403/409, 5xx and network (uncertain → reload)", () => {
  const E = (status, errorCode, msg, fieldErrors) => new errorsMod.ApiError({ kind: "http", status, errorCode, message: msg, fieldErrors, method: "POST", path: "/platform/tenants" });
  let o = m.describeCreateError(E(409, "DUPLICATE", "Tenant code already exists"));
  assert.match(o.message, /already exists: Tenant code already exists/);
  assert.equal(o.fieldErrors.code, "Tenant code already exists");
  assert.equal(o.uncertain, false);
  o = m.describeCreateError(E(400, "VALIDATION_FAILED", "Request validation failed", [{ field: "name", message: "must not be blank" }, { field: "timezone", message: "invalid timezone" }, { field: "status", message: "invalid" }, { field: "copyRolePermissionsFromTenantId", message: "unknown tenant" }]));
  same({ ...o.fieldErrors }, { name: "must not be blank", timezone: "invalid timezone", status: "invalid", copyRolePermissionsFromTenantId: "unknown tenant" });
  assert.match(o.message, /rejected the details: Request validation failed/);
  assert.match(m.describeCreateError(E(400, "INVALID_REFERENCE", "Source tenant not found")).message, /permission-copy source tenant\).*Source tenant not found/);
  assert.match(m.describeCreateError(E(401, "UNAUTHENTICATED", "")).message, /Sign in again/);
  assert.match(m.describeCreateError(E(403, "FORBIDDEN", "Missing permission")).message, /don't have permission/);
  assert.match(m.describeCreateError(E(409, "OPERATION_NOT_ALLOWED", "Nope")).message, /conflict: Nope/);
  for (const st of [500, 502, 503, 504]) {
    o = m.describeCreateError(E(st, "INTERNAL_ERROR", "Boom"));
    assert.equal(o.uncertain, true, String(st));
    assert.match(o.message, /may or may not have been created/);
  }
  o = m.describeCreateError(new errorsMod.ApiError({ kind: "network", status: 0, message: "Failed to fetch", method: "POST", path: "/platform/tenants" }));
  assert.equal(o.uncertain, true);
  assert.match(o.message, /No response/);
});

// ── Authorization ───────────────────────────────────────────────────────────

test("TC authorization: only platform === true + tenant.all; every tenant role denied; all-tenants mode not blocked", () => {
  assert.equal(p.canPerform(access(SFA), "tenants.create"), true, "platform-wide: no tenant selection needed");
  assert.equal(p.canPerform(access(SFA, 10), "tenants.create"), true, "allowed with a tenant selected too");
  const denied = {
    tenantAdmin: IDENTITIES.tenantAdmin,
    tenantAdminWithTenantAll: { ...IDENTITIES.tenantAdmin, permissions: ALL_CODES },
    fleetOwner: IDENTITIES.fleetOwner,
    dispatcher: IDENTITIES.dispatcher,
    viewer: IDENTITIES.viewer,
    driver: IDENTITIES.driver,
    platformWithoutTenantAll: { ...IDENTITIES.platformAdmin, permissions: TENANT_CODES },
    platformFlagString: { ...SFA, platform: "true" },
    roleNameOnly: { ...IDENTITIES.tenantAdmin, roleCode: "SUPER_ADMIN", permissions: TENANT_CODES },
  };
  for (const [label, raw] of Object.entries(denied)) assert.equal(p.canPerform(access(raw), "tenants.create"), false, label);
  const def = p.ACTIONS["tenants.create"];
  assert.equal(def.screen, "tenants");
  assert.equal(def.tenantWrite, false);
  same([...def.requires.anyOf], ["tenant.all"]);
  // Off-spec and documented as such: the operation really is absent from V10.
  same([...def.requires.offSpec.operations], ["POST /api/v1/platform/tenants"]);
  assert.equal(SPEC.paths["/api/v1/platform/tenants"].post, undefined);
});

test("TC UI wiring: the button and panel render only when the resolver allows tenants.create (no role names)", () => {
  const page = read("components/drive-vision/platform/tenant-management.tsx");
  assert.match(page, /const canCreate = canPerform\(access, "tenants\.create"\);/);
  assert.match(page, /\{canCreate \? \(\s*<Button onClick=\{\(\) => setCreating\(true\)\} data-testid="tenant-create-button">/);
  assert.match(page, /\{canCreate && creating \? \(/);
  assert.doesNotMatch(page, /roleCode|"ADMIN"|SUPER_ADMIN/);
  // Success: reload the list; never touch the tenant selection.
  assert.match(page, /function onCreated\([\s\S]*?listQ\.refetch\(\);\s*\}/);
  const onCreated = page.match(/function onCreated\([\s\S]*?\n {2}\}/)[0];
  assert.doesNotMatch(onCreated, /selectTenant|setTenantSelection|clearTenantSelection/);
  const panel = read("components/drive-vision/platform/tenant-create-panel.tsx");
  assert.match(panel, /if \(inFlight\.current\) return;/, "duplicate submissions blocked");
  assert.match(panel, /const created = await platformService\.createTenant\(body\);\s*const summary = createdSummary\(created\);\s*toast\.success/, "success only after the awaited POST");
  assert.match(panel, /setStep\("review"\)/, "review step before sending");
  assert.doesNotMatch(panel, /selectTenant|setTenantSelection|createUser|adminService/, "no switch, no users created");
});

// ── Service against a stub fetch ────────────────────────────────────────────

function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 600_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const out = respond(u.pathname.replace("/api/v1", ""), init.method ?? "GET");
    if (out === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(out[1]), { status: out[0], headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm({ console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } }, { react: { useSyncExternalStore: () => undefined } });
  const r = (x) => realm.require(x);
  return { calls, platform: r("features/drive-vision/api/platform-service").platformService, ctx: r("features/drive-vision/api/tenant-context"), m: r("components/drive-vision/platform/tenant-create-model") };
}
const tenantHeader = (c) => Object.keys(c.headers).some((k) => k.toLowerCase() === "x-tenant-id");
const created201 = () => [201, { code: 201, msg: "Success", data: CREATED, total: null, extend: null }];

test("TC service: POST /api/v1/platform/tenants with the exact body and bearer token; no tenant header or ?tenantId, even with a selection", async () => {
  const s = openRealm(created201);
  const body = s.m.buildCreateRequest({ ...s.m.emptyCreateForm(), name: "Synthetic A" });
  const res = await s.platform.createTenant(body);
  same(res, CREATED);
  s.ctx.setTenantSelection({ tenantId: 2, code: "OLD", name: null, header: "X-Tenant-Id" });
  await s.platform.createTenant(body);
  assert.equal(s.calls.length, 2);
  for (const c of s.calls) {
    assert.equal(`${c.method} ${c.path}`, "POST /api/v1/platform/tenants");
    same(c.body, { code: "", name: "Synthetic A", timezone: "Asia/Kolkata", status: "ACTIVE", s3Prefix: "", copyRolePermissionsFromTenantId: 1 });
    same(c.query, {});
    assert.equal(tenantHeader(c), false, "platform-wide: no X-Tenant-Id");
    assert.match(c.headers.Authorization, /^Bearer /);
  }
  // Creating doesn't switch tenants: the selection is exactly what it was.
  assert.equal(s.ctx.getTenantSelection().tenantId, 2);
});

test("TC service: creating in all-tenants mode leaves the selection empty; the list refresh shows the new tenant", async () => {
  let listed = LIST;
  const s = openRealm((pth, method) => {
    if (method === "POST") {
      listed = [...LIST, CREATED];
      return created201();
    }
    return [200, { code: 200, msg: "Success", data: listed, total: listed.length }];
  });
  const before = await s.platform.tenants();
  assert.equal(before.items.length, 2);
  await s.platform.createTenant(s.m.buildCreateRequest({ ...s.m.emptyCreateForm(), name: "Synthetic A" }));
  const after = await s.platform.tenants();
  assert.ok(after.items.some((t) => t.id === 9001 && t.code === "SYNTHA"));
  assert.equal(after.total, 3);
  assert.equal(s.ctx.getTenantSelection(), null, "still all tenants");
  same(s.calls.map((c) => `${c.method} ${c.path}`), ["GET /api/v1/platform/tenants", "POST /api/v1/platform/tenants", "GET /api/v1/platform/tenants"]);
});

test("TC service: failures reject (no success), are sent once (no automatic retry), and keep the server message", async () => {
  const cases = [
    [409, { code: 409, msg: "Tenant code already exists", data: null, extend: { errorCode: "DUPLICATE" } }],
    [400, { code: 400, msg: "Request validation failed", data: null, extend: { errorCode: "VALIDATION_FAILED", fieldErrors: [{ field: "name", message: "must not be blank" }] } }],
    [403, { code: 403, msg: "Forbidden", data: null, extend: { errorCode: "FORBIDDEN" } }],
    [500, { code: 500, msg: "Internal error", data: null, extend: { errorCode: "INTERNAL_ERROR" } }],
    // A 200 envelope carrying an error code is still an error.
    [200, { code: 400, msg: "Bad status", data: null, extend: { errorCode: "INVALID_VALUE" } }],
  ];
  for (const [status, payload] of cases) {
    const s = openRealm(() => [status, payload]);
    await assert.rejects(s.platform.createTenant(s.m.buildCreateRequest({ ...s.m.emptyCreateForm(), name: "S" })), (err) => {
      assert.equal(err.message, payload.msg);
      assert.equal(err.errorCode, payload.extend.errorCode);
      return true;
    });
    assert.equal(s.calls.length, 1, `HTTP ${status}: sent once`);
  }
  const net = openRealm(() => "network");
  await assert.rejects(net.platform.createTenant(net.m.buildCreateRequest({ ...net.m.emptyCreateForm(), name: "S" })), (err) => err.kind === "network");
  assert.equal(net.calls.length, 1);
});
