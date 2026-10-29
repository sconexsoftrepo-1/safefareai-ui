// Session recovery → route access: runs the real store/auth-store.ts (with api/client.ts and
// the refresh logic) against the fake rotating-token BFF, then feeds the resulting auth state
// into the access policy exactly as the AuthGate / RouteGuard do.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { createServer, MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const STORAGE_KEY = "safefare:session:v1";
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const ADMIN = { id: 1, displayName: "Admin", role: { id: 1, code: "PLATFORM_ADMIN" }, permissions: [] };

function toSession(tokens) {
  return { accessToken: tokens.accessToken, tokenType: "Bearer", accessExpiresAt: Date.now() + tokens.expiresIn * 1000, refreshToken: tokens.refreshToken, refreshExpiresAt: null };
}

/** One browser tab: fake BFF that serves `me` on GET /me, plus the real auth store and access policy. */
function openTab({ me = ADMIN, accessInMs, withSession = true } = {}) {
  const server = createServer();
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  async function fetch(url, init) {
    const res = await server.fetch(url, init);
    const path = new URL(url).pathname.replace("/api/v1", "");
    if (res.status !== 200) return res;
    if (path === "/me") return json(200, { code: 200, data: me });
    if (path === "/me/menus") return json(200, { code: 200, data: [] });
    return res;
  }
  const storage = new MemoryStorage();
  if (withSession) storage.setItem(STORAGE_KEY, JSON.stringify(toSession(server.login(accessInMs))));
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
  const decide = (path) => {
    const s = store.getAuthState();
    return policy.decideRoute(s.status, policy.computeAccess(s.user, s.menus), path);
  };
  const calls = (path) => server.calls.filter((c) => c.path === path).length;
  return { server, store, storage, decide, calls, logs };
}

test("no stored session → login redirect with the requested path, no requests", async () => {
  const tab = openTab({ withSession: false });
  await tab.store.bootstrapAuth();
  same(tab.decide("/drive-vision/vehicles/3"), { kind: "login", next: "/drive-vision/vehicles/3" });
  assert.equal(tab.server.calls.length, 0);
});

test("before the session check finishes, routes render nothing (checking)", async () => {
  const tab = openTab();
  const pending = tab.store.bootstrapAuth();
  same(tab.decide("/drive-vision/overview"), { kind: "checking" });
  await pending;
});

test("stored session recovered via GET /me → admin keeps existing screens", async () => {
  const tab = openTab();
  await tab.store.bootstrapAuth();
  same(tab.decide("/drive-vision/overview"), { kind: "allow", screen: "overview" });
  same(tab.decide("/drive-vision/devices/commands"), { kind: "allow", screen: "commands" });
  assert.equal(tab.calls("/auth/refresh"), 0);
});

test("access token near expiry → one refresh, then the session recovers", async () => {
  const tab = openTab({ accessInMs: 5_000 });
  await tab.store.bootstrapAuth();
  assert.equal(tab.calls("/auth/refresh"), 1);
  same(tab.decide("/drive-vision/alerts"), { kind: "allow", screen: "alerts" });
  assert.equal(JSON.parse(tab.storage.getItem(STORAGE_KEY)).refreshToken !== null, true);
  for (const line of tab.logs) assert.doesNotMatch(line, /refresh-\d+|eyJ|Bearer /, line);
});

test("session rejected by the server → signed out with reason expired → login", async () => {
  const tab = openTab();
  tab.server.setDenyAccess(true);
  await tab.store.bootstrapAuth();
  const s = tab.store.getAuthState();
  same([s.status, s.endReason, s.user], ["unauthenticated", "expired", null]);
  same(tab.decide("/drive-vision/overview"), { kind: "login", next: "/drive-vision/overview" });
  assert.equal(tab.storage.getItem(STORAGE_KEY), null);
});

test("server unreachable during recovery → retryable session error, tokens kept", async () => {
  const tab = openTab();
  tab.server.setOffline(true);
  await tab.store.bootstrapAuth();
  same(tab.decide("/drive-vision/overview"), { kind: "session-error" });
  assert.notEqual(tab.storage.getItem(STORAGE_KEY), null);
  tab.server.setOffline(false);
  await tab.store.bootstrapAuth();
  same(tab.decide("/drive-vision/overview"), { kind: "allow", screen: "overview" });
});

test("authenticated with an unrecognised, missing or malformed role → forbidden, not admin", async () => {
  for (const me of [{ id: 2, role: { code: "FLEET_OWNER" }, permissions: ["devices:read"] }, { id: 3 }, { id: 4, role: "PLATFORM_ADMIN", permissions: "all" }]) {
    const tab = openTab({ me });
    await tab.store.bootstrapAuth();
    assert.equal(tab.store.getAuthState().status, "authenticated");
    same(tab.decide("/drive-vision/overview"), { kind: "forbidden", screen: "overview", reason: "no-role" });
  }
});

test("signing out after recovery clears access", async () => {
  const tab = openTab();
  await tab.store.bootstrapAuth();
  const { refreshToken } = JSON.parse(tab.storage.getItem(STORAGE_KEY));
  await tab.store.signOut();
  const logouts = tab.server.calls.filter((c) => c.path === "/auth/logout");
  assert.equal(logouts.length, 1);
  same({ status: logouts[0].status, bearer: logouts[0].bearer, sentCurrent: logouts[0].refreshToken === refreshToken }, { status: 200, bearer: true, sentCurrent: true });
  assert.equal(tab.storage.getItem(STORAGE_KEY), null);
  same(tab.decide("/drive-vision/overview"), { kind: "login", next: "/drive-vision/overview" });
});

test("signing out with an expired access token refreshes first and logs out the rotated refresh token", async () => {
  const tab = openTab();
  await tab.store.bootstrapAuth();
  const before = JSON.parse(tab.storage.getItem(STORAGE_KEY));
  tab.storage.setItem(STORAGE_KEY, JSON.stringify({ ...before, accessExpiresAt: Date.now() - 1000 }));
  await tab.store.signOut();
  const refreshes = tab.server.refreshCalls();
  const logouts = tab.server.calls.filter((c) => c.path === "/auth/logout");
  assert.equal(refreshes.length, 1);
  same({ refresh: refreshes[0].status, logout: logouts.map((c) => c.status), bearer: logouts[0].bearer, sentOld: logouts[0].refreshToken === before.refreshToken }, { refresh: 200, logout: [200], bearer: true, sentOld: false });
  assert.equal(tab.storage.getItem(STORAGE_KEY), null);
});
