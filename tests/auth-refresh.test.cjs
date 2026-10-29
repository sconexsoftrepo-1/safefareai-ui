// Refresh-token rotation across tabs: each "tab" runs the real api/client.ts + session-sync.ts
// in its own vm context (own module state and sessionStorage), sharing a fake rotating-token
// server, a BroadcastChannel hub and a Web Locks manager.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { createServer, MemoryStorage, createBroadcastHub, createLockManager } = require("./helpers/browser-fakes.cjs");

const STORAGE_KEY = "safefare:session:v1";
const NEAR_EXPIRY_MS = 10_000; // inside the client's 30 s refresh leeway

function toSession(tokens, refreshExpiresAt = null) {
  return {
    accessToken: tokens.accessToken,
    tokenType: "Bearer",
    accessExpiresAt: Date.now() + tokens.expiresIn * 1000,
    refreshToken: tokens.refreshToken,
    refreshExpiresAt,
  };
}

function createWorld(opts = {}) {
  const server = createServer(opts.server);
  const hub = createBroadcastHub();
  const locks = opts.locks === false ? undefined : createLockManager();
  const logs = [];
  const tabs = [];

  function openTab({ session, storage = new MemoryStorage(), broadcast = true } = {}) {
    if (session) storage.setItem(STORAGE_KEY, JSON.stringify(session));
    const before = new Set(hub.open);
    const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, (...a) => logs.push(a.map(String).join(" "))]));
    const globals = {
      console: sink,
      sessionStorage: storage,
      navigator: locks ? { locks } : {},
      fetch: server.fetch,
      AbortSignal,
      performance,
      crypto: globalThis.crypto,
      atob,
      structuredClone,
      process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test", NEXT_PUBLIC_API_DEBUG: "true" } },
    };
    if (broadcast) globals.BroadcastChannel = hub.FakeBroadcastChannel;
    const realm = createRealm(globals);
    const client = realm.require("features/drive-vision/api/client");
    const ended = [];
    client.onSessionEnded((reason) => ended.push(reason));
    const channel = [...hub.open].find((c) => !before.has(c));
    const tab = {
      client,
      ended,
      storage,
      stored: () => JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"),
      get: (path = "/me") => client.api.get(path),
      sleep: () => channel && (channel.asleep = true),
      wake: () => channel && (channel.asleep = false),
    };
    tabs.push(tab);
    return tab;
  }

  /** Let hello/here and queued messages settle. */
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

  function assertNoSecretsLogged() {
    const issued = server.calls.filter((c) => c.refreshToken).map((c) => c.refreshToken);
    for (const line of logs) {
      assert.doesNotMatch(line, /refresh-\d+|eyJ|Bearer /, `log line leaked a token: ${line}`);
      for (const t of issued) assert.ok(!line.includes(t));
    }
  }

  return { server, openTab, settle, logs, assertNoSecretsLogged };
}

test("concurrent requests in one tab share a single refresh", async () => {
  const w = createWorld();
  const tab = w.openTab({ session: toSession(w.server.login(NEAR_EXPIRY_MS)) });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => tab.get()));
  assert.equal(results.length, 5);
  assert.equal(w.server.refreshCalls().length, 1);
  assert.deepEqual(tab.ended, []);
  w.assertNoSecretsLogged();
});

test("two tabs with a duplicated session refreshing at once: one refresh, nobody signed out", async () => {
  const w = createWorld();
  const shared = toSession(w.server.login(NEAR_EXPIRY_MS));
  const a = w.openTab({ session: shared });
  const b = w.openTab({ session: shared });
  await w.settle();
  await Promise.all([a.get(), b.get(), a.get(), b.get()]);
  assert.equal(w.server.refreshCalls().length, 1, "only one tab spends the refresh token");
  assert.equal(w.server.calls.filter((c) => c.reuse).length, 0);
  assert.deepEqual([a.ended, b.ended], [[], []]);
  assert.equal(a.stored().refreshToken, b.stored().refreshToken);
  assert.notEqual(a.stored().refreshToken, shared.refreshToken);
  w.assertNoSecretsLogged();
});

test("without Web Locks, a stale-token rejection is rescued by the tab that refreshed first", async () => {
  const w = createWorld({ locks: false });
  const shared = toSession(w.server.login(NEAR_EXPIRY_MS));
  const a = w.openTab({ session: shared });
  const b = w.openTab({ session: shared });
  await w.settle();
  await Promise.all([a.get(), b.get()]);
  const refreshes = w.server.refreshCalls();
  assert.equal(refreshes.length, 2, "both tabs raced");
  assert.equal(refreshes.filter((c) => c.status === 401 && c.reuse).length, 1, "the loser reused the rotated token");
  assert.deepEqual([a.ended, b.ended], [[], []], "the loser adopted the winner's session instead of signing out");
  assert.equal(a.stored().refreshToken, b.stored().refreshToken);
  await Promise.all([a.get(), b.get()]);
  assert.deepEqual([a.ended, b.ended], [[], []]);
  w.assertNoSecretsLogged();
});

test("a tab that missed the broadcast asks peers before spending its stale token", async () => {
  // Strict server: reusing a rotated token revokes the whole family, so prevention matters.
  const w = createWorld({ server: { revokeFamilyOnReuse: true } });
  const shared = toSession(w.server.login(NEAR_EXPIRY_MS));
  const a = w.openTab({ session: shared });
  const b = w.openTab({ session: shared });
  await w.settle();
  b.sleep();
  await a.get();
  await w.settle();
  assert.equal(b.stored().refreshToken, shared.refreshToken, "asleep: b still holds the old token");
  b.wake();
  await b.get();
  assert.equal(w.server.refreshCalls().length, 1, "b never sent its stale token");
  assert.equal(b.stored().refreshToken, a.stored().refreshToken);
  await a.get();
  assert.deepEqual([a.ended, b.ended], [[], []]);
});

test("an idle tab adopts the rotated session from the broadcast without any request", async () => {
  const w = createWorld();
  const shared = toSession(w.server.login(NEAR_EXPIRY_MS));
  const a = w.openTab({ session: shared });
  const b = w.openTab({ session: shared });
  await w.settle();
  await a.get();
  await w.settle();
  assert.equal(b.stored().refreshToken, a.stored().refreshToken);
  const callsBefore = w.server.calls.length;
  await b.get();
  assert.equal(w.server.calls.length, callsBefore + 1, "b's request went out with the adopted token, no refresh");
});

test("documents sharing one sessionStorage (iframe) re-read storage instead of reusing the old token", async () => {
  const w = createWorld();
  const storage = new MemoryStorage();
  const top = w.openTab({ session: toSession(w.server.login(NEAR_EXPIRY_MS)), storage, broadcast: false });
  const frame = w.openTab({ storage, broadcast: false });
  await Promise.all([top.get(), frame.get()]);
  assert.equal(w.server.refreshCalls().length, 1);
  assert.deepEqual([top.ended, frame.ended], [[], []]);
});

test("tabs signed in as different users never receive each other's session", async () => {
  const w = createWorld();
  const a = w.openTab({ session: toSession(w.server.login(NEAR_EXPIRY_MS)) });
  const bSession = toSession(w.server.login(NEAR_EXPIRY_MS));
  const b = w.openTab({ session: bSession });
  await w.settle();
  await a.get();
  await w.settle();
  assert.equal(b.stored().refreshToken, bSession.refreshToken);
  await b.get();
  assert.notEqual(a.stored().refreshToken, b.stored().refreshToken);
  assert.equal(w.server.refreshCalls().length, 2);
});

test("a genuinely rejected refresh token still signs out, without retrying the refresh", async () => {
  const w = createWorld();
  const session = toSession(w.server.login(NEAR_EXPIRY_MS));
  const a = w.openTab({ session });
  w.openTab({ session }); // a peer with nothing newer to offer
  await w.settle();
  w.server.revokeRefresh(session.refreshToken);
  await assert.rejects(a.get(), (err) => err.kind === "http" && err.status === 401);
  assert.deepEqual(a.ended, ["expired"]);
  assert.equal(a.stored(), null, "tokens cleared");
  assert.equal(w.server.refreshCalls().length, 1, "refresh endpoint called once, never retried");
  w.assertNoSecretsLogged();
});

test("an expired refresh token signs out without contacting the server", async () => {
  const w = createWorld();
  const a = w.openTab({ session: toSession(w.server.login(NEAR_EXPIRY_MS), Date.now() - 1000) });
  await assert.rejects(a.get(), (err) => err.status === 401);
  assert.deepEqual(a.ended, ["expired"]);
  assert.equal(w.server.calls.length, 0);
});

test("a request still rejected after a successful refresh signs out after one retry", async () => {
  const w = createWorld();
  const a = w.openTab({ session: toSession(w.server.login()) });
  w.server.setDenyAccess(true);
  await assert.rejects(a.get(), (err) => err.status === 401);
  assert.deepEqual(a.ended, ["expired"]);
  assert.equal(w.server.refreshCalls().length, 1);
  assert.equal(w.server.calls.filter((c) => c.path === "/me").length, 2, "original + one retry");
});

test("a network failure during refresh keeps the session", async () => {
  const w = createWorld();
  const session = toSession(w.server.login(NEAR_EXPIRY_MS));
  const a = w.openTab({ session });
  w.server.setOffline(true);
  await assert.rejects(a.get(), (err) => err.kind === "network");
  assert.deepEqual(a.ended, []);
  assert.equal(a.stored().refreshToken, session.refreshToken, "tokens kept");
  w.server.setOffline(false);
  await a.get();
  assert.deepEqual(a.ended, []);
  assert.equal(w.server.refreshCalls().length, 2, "one failed attempt, one on the next request — no automatic retry");
});
