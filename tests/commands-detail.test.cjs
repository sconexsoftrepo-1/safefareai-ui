// Command detail (GET /commands/{id}): how a backend failure is surfaced, and how incomplete or
// malformed detail data is normalised for display. Runs the real API client against a stub fetch;
// nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const STORAGE_KEY = "safefare:session:v1";

/** Real client + fleet service; `respond(path)` returns [status, body] for each request. */
function openRealm(respond) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const path = new URL(url).pathname.replace("/api/v1", "");
    calls.push({ method: init.method ?? "GET", path });
    const [status, body, headers = {}] = respond(path);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
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
      URL,
      process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } },
    },
    { react: { useSyncExternalStore: () => undefined } }
  );
  return {
    calls,
    fleet: realm.require("features/drive-vision/api/fleet-service").fleetService,
    errors: realm.require("features/drive-vision/api/errors"),
    model: realm.require("components/drive-vision/devices/commands-model"),
  };
}

// The envelope the BFF returned for GET /commands/1 on 2026-10-27 (request id is one of the observed refs).
const INTERNAL = { code: 500, msg: "Unexpected server error", data: null, extend: { errorCode: "INTERNAL_ERROR", fieldErrors: [], requestId: "351a2c05-11e4-4ec4-97f0-c7582edfc2ba" } };

test("detail 500: surfaced as an error with status, code and request id — one request, no fabricated data", async () => {
  const r = openRealm(() => [500, INTERNAL, { "X-Request-Id": "351a2c05-11e4-4ec4-97f0-c7582edfc2ba" }]);
  const err = await r.fleet.getCommand(1).then(
    () => assert.fail("getCommand resolved on a 500"),
    (e) => e
  );
  assert.ok(r.errors.isApiError(err));
  same({ kind: err.kind, status: err.status, errorCode: err.errorCode, requestId: err.requestId }, { kind: "http", status: 500, errorCode: "INTERNAL_ERROR", requestId: "351a2c05-11e4-4ec4-97f0-c7582edfc2ba" });
  assert.equal(r.errors.describeApiError(err), "Unexpected server error");
  assert.equal(r.errors.apiErrorMeta(err), "HTTP 500 · INTERNAL_ERROR · ref 351a2c05-11e4-4ec4-97f0-c7582edfc2ba");
  same(r.calls, [{ method: "GET", path: "/commands/1" }]);
});

test("detail 404 for an unknown id keeps the server's message", async () => {
  const r = openRealm(() => [404, { code: 404, msg: "Command not found", data: null, extend: { errorCode: "NOT_FOUND", requestId: "95c7ed7c-4514-4d64-b0de-2ee3d1fd83de" } }]);
  const err = await r.fleet.getCommand(999999).catch((e) => e);
  assert.equal(r.errors.describeApiError(err), "Command not found");
  assert.equal(r.errors.apiErrorMeta(err), "HTTP 404 · NOT_FOUND · ref 95c7ed7c-4514-4d64-b0de-2ee3d1fd83de");
});

test("detail view of the observed list record: count says 1, no targets returned → flagged, not invented", () => {
  const { model } = openRealm(() => [200, {}]);
  const v = model.commandDetailView({ id: 1, type: "INSTANT_SHOT", section: null, status: "PENDING", targetCount: 1, requestedBy: 5, params: { channel: 1 }, createdAt: "2026-10-24T11:05:00Z", completedAt: null, targets: [] });
  same(
    { type: v.type, section: v.section, status: v.status, requestedBy: v.requestedBy, params: v.params, completedAt: v.completedAt, targets: v.targets.length, targetCount: v.targetCount, mismatch: v.targetCountMismatch, dropped: v.droppedTargets },
    { type: "INSTANT_SHOT", section: null, status: "PENDING", requestedBy: 5, params: '{"channel":1}', completedAt: null, targets: 0, targetCount: 1, mismatch: true, dropped: 0 }
  );
});

test("detail view tolerates missing and malformed fields without crashing or showing junk", () => {
  const { model } = openRealm(() => [200, {}]);
  for (const empty of [null, undefined, {}, "oops", 42]) {
    const v = model.commandDetailView(empty);
    same({ type: v.type, status: v.status, requestedBy: v.requestedBy, params: v.params, targets: v.targets, count: v.targetCount, mismatch: v.targetCountMismatch }, { type: null, status: null, requestedBy: null, params: "—", targets: [], count: null, mismatch: false });
  }
  const v = model.commandDetailView({
    type: "  ",
    requestedBy: null,
    createdAt: "not a date",
    targetCount: 1.5,
    targets: [null, "x", [1], { id: 7, deviceId: "3", status: 2, sentAt: "2026-10-24T11:05:00Z", finishedAt: "garbage", result: { ok: true } }],
  });
  same(
    { type: v.type, requestedBy: v.requestedBy, createdAt: v.createdAt, count: v.targetCount, mismatch: v.targetCountMismatch, dropped: v.droppedTargets },
    { type: null, requestedBy: null, createdAt: null, count: null, mismatch: false, dropped: 3 }
  );
  same(v.targets, [{ key: "t7", deviceId: null, terminalNo: null, status: null, failReason: null, sentAt: "2026-10-24T11:05:00Z", finishedAt: null, result: { ok: true } }]);
  // `targets` that isn't an array is treated as none returned.
  const notArray = model.commandDetailView({ targetCount: 2, targets: { 0: { id: 1 } } });
  same({ targets: notArray.targets.length, mismatch: notArray.targetCountMismatch }, { targets: 0, mismatch: true });
  assert.equal(model.rawValue("on"), "on");
  assert.equal(model.rawValue([1, 2]), "[1,2]");
});
