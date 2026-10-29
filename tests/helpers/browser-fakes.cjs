// Minimal stand-ins for the browser pieces the auth client uses, shared between simulated tabs.

/** Fake BFF: issues JWT-shaped access tokens and rotating, single-use refresh tokens. */
function createServer({ latencyMs = 15, accessTtlMs = 15 * 60_000, revokeFamilyOnReuse = false } = {}) {
  let n = 0;
  const validRefresh = new Map(); // token → family
  const spentRefresh = new Map();
  const validAccess = new Set();
  const revokedFamilies = new Set();
  const calls = [];
  let offline = false;

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  function issue(family, ttl = accessTtlMs) {
    n++;
    const accessToken = `${b64({ alg: "none" })}.${b64({ exp: Math.floor((Date.now() + ttl) / 1000), n })}.sig`;
    const refreshToken = `refresh-${n}`;
    validAccess.add(accessToken);
    validRefresh.set(refreshToken, family);
    return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: ttl / 1000 };
  }
  let denyAccess = false;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const unauthorized = () => json(401, { code: 401, msg: "Unauthorized", extend: { errorCode: "UNAUTHENTICATED" } });

  async function fetch(url, init = {}) {
    const path = new URL(url).pathname.replace("/api/v1", "");
    const entry = { method: init.method ?? "GET", path };
    calls.push(entry);
    await new Promise((r) => setTimeout(r, latencyMs));
    if (offline) throw new TypeError("Failed to fetch");
    if (path === "/auth/refresh") {
      const { refreshToken } = JSON.parse(init.body);
      entry.refreshToken = refreshToken;
      const family = validRefresh.get(refreshToken);
      if (family === undefined || revokedFamilies.has(family)) {
        entry.status = 401;
        if (spentRefresh.has(refreshToken)) {
          entry.reuse = true;
          if (revokeFamilyOnReuse) revokedFamilies.add(spentRefresh.get(refreshToken));
        }
        return unauthorized();
      }
      validRefresh.delete(refreshToken);
      spentRefresh.set(refreshToken, family);
      entry.status = 200;
      return json(200, { code: 200, data: issue(family) });
    }
    const token = (init.headers?.Authorization ?? "").replace(/^Bearer /, "");
    // Like the real BFF (2026-10-27): logout needs the bearer token as well as the refresh token.
    if (path === "/auth/logout") {
      entry.bearer = token !== "";
      entry.refreshToken = JSON.parse(init.body).refreshToken;
    }
    if (denyAccess || !validAccess.has(token)) {
      entry.status = 401;
      return unauthorized();
    }
    if (path === "/auth/logout") validRefresh.delete(entry.refreshToken);
    entry.status = 200;
    return json(200, { code: 200, data: { ok: true } });
  }

  return {
    fetch,
    calls,
    /** A signed-in session whose access token expires in `accessInMs`. */
    login(accessInMs = accessTtlMs, family = Symbol("family")) {
      return issue(family, accessInMs);
    },
    revokeAccess: (t) => validAccess.delete(t),
    revokeRefresh: (t) => validRefresh.delete(t),
    setOffline: (v) => (offline = v),
    /** Reject every access token, old or new (e.g. account disabled). */
    setDenyAccess: (v) => (denyAccess = v),
    refreshCalls: () => calls.filter((c) => c.path === "/auth/refresh"),
  };
}

class MemoryStorage {
  #m = new Map();
  getItem(k) {
    return this.#m.has(k) ? this.#m.get(k) : null;
  }
  setItem(k, v) {
    this.#m.set(k, String(v));
  }
  removeItem(k) {
    this.#m.delete(k);
  }
}

/** One BroadcastChannel "origin": messages go to every other open instance with the same name. */
function createBroadcastHub() {
  const open = new Set();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.asleep = false;
      open.add(this);
    }
    postMessage(data) {
      const copy = structuredClone(data);
      for (const other of open) {
        if (other === this || other.name !== this.name) continue;
        // A sleeping (frozen/discarded) tab misses the message entirely.
        if (!other.asleep) setTimeout(() => other.onmessage?.({ data: structuredClone(copy) }), 0);
      }
    }
    close() {
      open.delete(this);
    }
  }
  return { FakeBroadcastChannel, open };
}

/** Exclusive Web Locks shared by all tabs. */
function createLockManager() {
  const tails = new Map();
  return {
    request(name, fn) {
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(() => fn({ name, mode: "exclusive" }));
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

module.exports = { createServer, MemoryStorage, createBroadcastHub, createLockManager };
