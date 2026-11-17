// V10 sign-in (Phase 2): the login form model and the real auth store + API client against a fake BFF.
// CODE-LEVEL ONLY: nothing here talks to the real BFF; no test account has been supplied.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { createServer, MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const STORAGE_KEY = "safefare:session:v1";
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const PASSWORD = "S3cret pass ";

const model = createRealm({ process: { env: {} } }).require("components/drive-vision/auth/login-model");

// ── Login form model ────────────────────────────────────────────────────────

test("tenant login: tenantCode, login and password are sent (trimmed, password untouched)", () => {
  const req = model.buildLoginRequest("tenant", { tenantCode: "  ACME ", login: " ops@acme.test ", password: PASSWORD });
  same(req, { login: "ops@acme.test", password: PASSWORD, tenantCode: "ACME" });
});

test("Safe-Fare Admin login: tenantCode is omitted entirely — not empty, not null, not invented", () => {
  for (const tenantCode of ["", "   ", "ACME"]) {
    const req = model.buildLoginRequest("platform", { tenantCode, login: "admin@safefare.test", password: PASSWORD });
    assert.equal(Object.hasOwn(req, "tenantCode"), false, JSON.stringify(tenantCode));
    same(JSON.parse(JSON.stringify(req)), { login: "admin@safefare.test", password: PASSWORD });
  }
});

test("a blank tenant code is never sent, even in tenant mode", () => {
  for (const tenantCode of ["", "  "]) assert.equal(Object.hasOwn(model.buildLoginRequest("tenant", { tenantCode, login: "u", password: "p" }), "tenantCode"), false);
});

test("validation: tenant users need a tenant code; the Safe-Fare Admin doesn't; existing messages kept", () => {
  same(model.validateLogin("tenant", { tenantCode: " ", login: "", password: "" }), { tenantCode: "Tenant code is required.", login: "Email or username is required.", password: "Password is required." });
  same(model.validateLogin("platform", { tenantCode: "", login: "", password: "" }), { login: "Email or username is required.", password: "Password is required." });
  same(model.validateLogin("platform", { tenantCode: "", login: "a", password: "b" }), {});
  same(model.validateLogin("tenant", { tenantCode: "x".repeat(51), login: "a", password: "b" }), { tenantCode: "Tenant code must be at most 50 characters." });
  same(model.validateLogin("platform", { tenantCode: "x".repeat(51), login: "a", password: "y".repeat(73) }), { password: "Password must be at most 72 characters." });
  // A password of spaces is a password (not trimmed), as before.
  same(model.validateLogin("tenant", { tenantCode: "T", login: "a", password: "   " }), {});
});

// ── Sign-in flow through the real store ─────────────────────────────────────

/**
 * Fake BFF: the rotating-token server from browser-fakes plus POST /auth/login, GET /me and
 * GET /me/permissions. `login` decides the answer to a login body.
 */
function openTab({ identity = IDENTITIES.tenantAdmin, me = { id: 2, displayName: "Admin" }, login, permissionsStatus = 200 } = {}) {
  const server = createServer();
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const logins = [];
  async function fetch(url, init = {}) {
    const path = new URL(url).pathname.replace("/api/v1", "");
    if (path === "/auth/login") {
      const body = JSON.parse(init.body);
      logins.push({ body, bearer: !!init.headers?.Authorization });
      const verdict = login ? login(body) : "ok";
      if (verdict !== "ok") return json(401, { code: 401, msg: "Invalid credentials", extend: { errorCode: "INVALID_CREDENTIALS", requestId: "req-login" } });
      return json(200, { code: 200, data: { ...server.login(), user: me } });
    }
    const res = await server.fetch(url, init);
    if (res.status !== 200) return res;
    if (path === "/me") return json(200, { code: 200, data: me });
    if (path === "/me/permissions") return permissionsStatus === 200 ? json(200, { code: 200, data: identity }) : json(permissionsStatus, { code: permissionsStatus, msg: "Service unavailable", extend: { errorCode: "SERVICE_UNAVAILABLE" } });
    return res;
  }
  const storage = new MemoryStorage();
  const logs = [];
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, (...a) => logs.push(a.map(String).join(" "))]));
  const realm = createRealm(
    {
      console: sink,
      sessionStorage: storage,
      navigator: { locks: createLockManager() },
      fetch,
      AbortSignal,
      performance,
      crypto: globalThis.crypto,
      atob,
      structuredClone,
      process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test", NEXT_PUBLIC_API_DEBUG: "true" } },
    },
    { react: { useSyncExternalStore: () => undefined } }
  );
  const store = realm.require("features/drive-vision/store/auth-store");
  const policy = realm.require("features/drive-vision/access/access-policy");
  const loginModel = realm.require("components/drive-vision/auth/login-model");
  const access = () => policy.computeAccess(store.getAuthState().identity);
  const calls = (p) => server.calls.filter((c) => c.path === p).length;
  return { server, store, storage, logins, logs, access, calls, policy, loginModel };
}

test("tenant user signs in: body has tenantCode, no bearer; identity loaded from /me/permissions", async () => {
  const tab = openTab();
  await tab.store.signIn(tab.loginModel.buildLoginRequest("tenant", { tenantCode: "ACME", login: "ops", password: PASSWORD }));
  same(tab.logins.map((l) => [l.body, l.bearer]), [[{ login: "ops", password: PASSWORD, tenantCode: "ACME" }, false]]);
  const s = tab.store.getAuthState();
  assert.equal(s.status, "authenticated");
  same([s.user.displayName, s.identity.platform, s.identity.roleCode], ["Admin", false, "ADMIN"]);
  assert.equal(tab.calls("/me/permissions"), 1);
  assert.equal(tab.access().kind, "tenant-admin");
  assert.equal(tab.policy.canAccessPlatform(tab.access()), false);
  assert.notEqual(tab.storage.getItem(STORAGE_KEY), null);
});

test("Safe-Fare Admin signs in without tenantCode; platform=true recognised", async () => {
  const tab = openTab({ identity: IDENTITIES.platformAdmin, me: { id: 1, displayName: "Safe-Fare", platform: true } });
  await tab.store.signIn(tab.loginModel.buildLoginRequest("platform", { tenantCode: "LEFTOVER", login: "admin", password: PASSWORD }));
  same(tab.logins[0].body, { login: "admin", password: PASSWORD });
  assert.equal(Object.hasOwn(tab.logins[0].body, "tenantCode"), false);
  const a = tab.access();
  same([a.kind, a.platform, a.tenantId, tab.policy.canAccessPlatform(a)], ["platform-admin", true, null, true]);
});

test("platform information missing or not literally true → no platform access", async () => {
  for (const platform of [undefined, null, "true", 1]) {
    const identity = { ...IDENTITIES.platformAdmin, platform };
    if (platform === undefined) delete identity.platform;
    const tab = openTab({ identity, me: { id: 1, platform: true } });
    await tab.store.signIn({ login: "admin", password: PASSWORD });
    const a = tab.access();
    assert.equal(a.platform, false, String(platform));
    assert.equal(tab.policy.canAccessPlatform(a), false, String(platform));
  }
});

test("invalid login: rejected with the server's error; no session, no identity requests", async () => {
  const tab = openTab({ login: () => "bad" });
  const err = await tab.store.signIn({ tenantCode: "ACME", login: "ops", password: "wrong" }).then(
    () => assert.fail("resolved"),
    (e) => e
  );
  same([err.status, err.errorCode, err.requestId], [401, "INVALID_CREDENTIALS", "req-login"]);
  assert.equal(tab.storage.getItem(STORAGE_KEY), null);
  assert.equal(tab.calls("/me"), 0);
  assert.equal(tab.calls("/me/permissions"), 0);
  assert.notEqual(tab.store.getAuthState().status, "authenticated");
});

test("signed in but the identity can't be loaded: retryable error, no access, tokens kept for retry", async () => {
  const tab = openTab({ permissionsStatus: 503 });
  await assert.rejects(tab.store.signIn({ tenantCode: "ACME", login: "ops", password: PASSWORD }));
  const s = tab.store.getAuthState();
  same([s.status, s.identity, s.user], ["error", null, null]);
  same(tab.policy.decideRoute(s.status, tab.access(), "/drive-vision/overview"), { kind: "session-error" });
  assert.notEqual(tab.storage.getItem(STORAGE_KEY), null);
});

test("unauthorised after login (token rejected): session ends, state cleared, signed out", async () => {
  const tab = openTab();
  tab.server.setDenyAccess(true); // every bearer token rejected, even after refresh
  await assert.rejects(tab.store.signIn({ tenantCode: "ACME", login: "ops", password: PASSWORD }), (e) => e.status === 401);
  const s = tab.store.getAuthState();
  same([s.status, s.user, s.identity, s.endReason], ["unauthenticated", null, null, "expired"]);
  assert.equal(tab.storage.getItem(STORAGE_KEY), null);
});

test("refreshIdentity re-reads /me/permissions (e.g. after a permission change); failure drops the identity", async () => {
  const tab = openTab({ identity: IDENTITIES.viewer });
  await tab.store.signIn({ tenantCode: "ACME", login: "v", password: PASSWORD });
  assert.equal(tab.policy.canPerform(tab.access(), "drivers.create"), false);
  // The fake server now answers with more permissions.
  IDENTITIES.viewer.permissions.push("driver.create");
  try {
    await tab.store.refreshIdentity();
    assert.equal(tab.policy.canPerform(tab.access(), "drivers.create"), true);
  } finally {
    IDENTITIES.viewer.permissions.pop();
  }
  assert.equal(tab.calls("/me/permissions"), 2);
});

test("no password, token or Authorization header appears in console output", async () => {
  const tab = openTab();
  await tab.store.signIn({ tenantCode: "ACME", login: "ops", password: PASSWORD });
  await tab.store.signOut();
  const { accessToken } = tab.server.login();
  assert.ok(tab.logs.length > 0, "diagnostics ran");
  for (const line of tab.logs) {
    assert.ok(!line.includes(PASSWORD.trim()), line);
    assert.doesNotMatch(line, /refresh-\d+|eyJ|Bearer |Authorization/, line);
    assert.ok(!line.includes(accessToken.split(".")[1]), line);
  }
});

// ── Return destination through login (/login?next=…) ─────────────────────────
// AuthGate builds the login URL from the path and the complete `location.search`; the login screen reads it
// back with params.get("next"), keeps only same-app paths (safeNext) and, once signed in, opens it through
// the access check (postLoginRoute), exactly as login-screen.tsx does.

const DETAIL = "/drive-vision/vehicles/detail/";

/** The /login URL AuthGate sends a signed-out visitor of `pathname` + `search` to. */
const gateHref = (lm, pathname, search, reason) => lm.loginHref(lm.loginReturnPath(pathname, search), reason);

/** Where the login screen sends the user after a successful sign-in, given the URL it was opened with. */
function afterLogin(tab, loginUrl) {
  const params = new URL(loginUrl, "http://app.test").searchParams; // what useSearchParams() returns
  const requested = tab.loginModel.safeNext(params.get("next"));
  const a = tab.access();
  return tab.policy.postLoginRoute(a, tab.store.mayResumeRoute(a.identity) ? requested : null) ?? "/drive-vision/overview";
}

test("return path: pathname plus the complete query string; no query → the path alone, as before", () => {
  const lm = createRealm({ process: { env: {} } }).require("components/drive-vision/auth/login-model");
  assert.equal(lm.loginReturnPath(DETAIL, "?vehicleId=469"), `${DETAIL}?vehicleId=469`);
  assert.equal(lm.loginReturnPath(DETAIL, "?vehicleId=469&tab=trips"), `${DETAIL}?vehicleId=469&tab=trips`);
  assert.equal(lm.loginReturnPath("/drive-vision/overview", ""), "/drive-vision/overview");
  assert.equal(lm.loginReturnPath("/drive-vision/overview", "?"), "/drive-vision/overview");
  // Unchanged shape for a query-less page: the same URL the old `new URLSearchParams({ next: pathname })` built.
  assert.equal(gateHref(lm, "/drive-vision/overview", ""), "/login?next=%2Fdrive-vision%2Foverview");
  assert.equal(gateHref(lm, "/drive-vision/overview", "", "expired"), "/login?next=%2Fdrive-vision%2Foverview&reason=expired");
});

test("login URL encodes the destination once: params.get('next') returns it byte for byte", () => {
  const lm = createRealm({ process: { env: {} } }).require("components/drive-vision/auth/login-model");
  const href = gateHref(lm, DETAIL, "?vehicleId=469");
  assert.equal(href, "/login?next=%2Fdrive-vision%2Fvehicles%2Fdetail%2F%3FvehicleId%3D469");
  const cases = ["?vehicleId=469", "?vehicleId=469&from=alerts&tab=trips", "?q=a%20b%26c&name=%E0%A4%AC%E0%A4%B8", "?driver=5#x"];
  for (const search of cases) {
    const next = new URL(gateHref(lm, DETAIL, search), "http://app.test").searchParams.get("next");
    assert.equal(next, `${DETAIL}${search}`, search);
    // The inner query still decodes to the original values: encoded once, not twice.
    const inner = new URL(next, "http://app.test").searchParams;
    if (search.startsWith("?q=")) same([inner.get("q"), inner.get("name")], ["a b&c", "बस"]);
  }
  // `%20` in the query becomes `%2520` (one encoding of the whole value), never `%252520` (encoded twice).
  assert.match(gateHref(lm, DETAIL, "?q=a%20b"), /q%3Da%2520b$/);
  assert.doesNotMatch(gateHref(lm, DETAIL, "?q=a%20b"), /%252520/);
});

test("unsafe next values stay rejected (no open redirect)", () => {
  const lm = createRealm({ process: { env: {} } }).require("components/drive-vision/auth/login-model");
  for (const bad of ["https://evil.example/drive-vision", "//evil.example/drive-vision", "/\evil.example", "javascript:alert(1)", "/login", "/", "", null, "drive-vision/overview"]) {
    assert.equal(lm.safeNext(bad), null, String(bad));
  }
  assert.equal(lm.safeNext(`${DETAIL}?vehicleId=469&tab=trips`), `${DETAIL}?vehicleId=469&tab=trips`);
  // An external URL smuggled into the query of a same-app path is just a query value; the destination stays in-app.
  assert.equal(lm.safeNext("/drive-vision/overview?next=https://evil.example"), "/drive-vision/overview?next=https://evil.example");
});

test("signed-out visit to the vehicle detail → sign in → back on the same vehicle (pathname + query)", async () => {
  const tab = openTab();
  const loginUrl = gateHref(tab.loginModel, DETAIL, "?vehicleId=469");
  await tab.store.signIn(tab.loginModel.buildLoginRequest("tenant", { tenantCode: "ACME", login: "ops", password: PASSWORD }));
  assert.equal(tab.store.getAuthState().status, "authenticated");
  assert.equal(afterLogin(tab, loginUrl), `${DETAIL}?vehicleId=469`);
  assert.equal(afterLogin(tab, gateHref(tab.loginModel, DETAIL, "?vehicleId=469&tab=trips&q=a%20b")), `${DETAIL}?vehicleId=469&tab=trips&q=a%20b`);
  assert.equal(afterLogin(tab, gateHref(tab.loginModel, "/drive-vision/drivers", "")), "/drive-vision/drivers", "no query: unchanged");
  // Unsafe or unknown destinations fall back to the user's own landing page, as before.
  const landing = tab.policy.defaultLanding(tab.access());
  assert.equal(afterLogin(tab, "/login?next=https%3A%2F%2Fevil.example%2Fdrive-vision"), landing);
  assert.equal(afterLogin(tab, "/login?next=%2F%2Fevil.example"), landing);
  assert.equal(afterLogin(tab, "/login"), landing);
});

test("the query keeps the permission check: a page the user can't open still lands on their default", async () => {
  const tab = openTab({ identity: IDENTITIES.platformAdmin, me: { id: 1, displayName: "Safe-Fare", platform: true } });
  await tab.store.signIn(tab.loginModel.buildLoginRequest("platform", { tenantCode: "", login: "admin", password: PASSWORD }));
  const a = tab.access();
  const target = `${DETAIL}?vehicleId=469`;
  assert.equal(afterLogin(tab, gateHref(tab.loginModel, DETAIL, "?vehicleId=469")), tab.policy.canAccessPath(a, target) ? target : tab.policy.defaultLanding(a));
});

test("AuthGate reads location.search only inside its effect (never during static generation)", () => {
  const gate = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "components", "drive-vision", "auth", "auth-gate.tsx"), "utf8");
  assert.match(gate, /useEffect\(\(\) => \{\s*if \(status !== "unauthenticated"\) return;[\s\S]*?loginHref\(loginReturnPath\(pathname, window\.location\.search\), endReason === "expired" \? "expired" : undefined\)/);
  assert.equal(gate.match(/window\./g).length, 1, "no other window access");
  const login = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "components", "drive-vision", "auth", "login-screen.tsx"), "utf8");
  assert.match(login, /const requested = safeNext\(params\.get\("next"\)\);/);
  assert.doesNotMatch(login, /function safeNext/, "one shared implementation (login-model)");
});
