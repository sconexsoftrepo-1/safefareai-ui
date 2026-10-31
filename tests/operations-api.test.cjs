// Request construction for the API families added to the spec on 2026-10-29 (dashboard, trips,
// drivers, dispatch, workforce, driver app, safety, alerts, notifications, search, assistant,
// geofence events). Runs the real API client and services against a stub fetch and checks every
// call's method + path against the saved OpenAPI snapshot. MOCKED: nothing here talks to the BFF.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");

const SPEC = require(path.join(__dirname, "..", "docs", "openapi", "api-docs-2026-10-29.json"));
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const STORAGE_KEY = "safefare:session:v1";

/** Does `METHOD /api/v1/x/12/y` match a templated spec path? */
function inSpec(method, pathname) {
  return Object.entries(SPEC.paths).some(([p, ops]) => {
    if (!ops[method.toLowerCase()]) return false;
    const re = new RegExp(`^${p.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return re.test(pathname);
  });
}

function openRealm(respond = () => [200, { code: 200, msg: "Success", data: null }]) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const call = { method: init.method ?? "GET", path: u.pathname, query: Object.fromEntries([...new Set(u.searchParams.keys())].map((k) => [k, u.searchParams.getAll(k).length > 1 ? u.searchParams.getAll(k) : u.searchParams.get(k)])), body: init.body ? JSON.parse(init.body) : undefined, auth: !!init.headers?.Authorization };
    calls.push(call);
    const [status, body] = respond(call);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
  const r = (m) => realm.require(`features/drive-vision/api/${m}`);
  return {
    calls,
    insight: r("insight-service").insightService,
    ops: r("operations-service").operationsService,
    alerts: r("alert-service").alertService,
    readUnreadCount: r("alert-service").readUnreadCount,
    assistant: r("assistant-service").assistantService,
    driver: r("driver-app-service").driverAppService,
    errors: r("errors"),
  };
}

const W = { from: "2026-10-22T00:00:00.000Z", to: "2026-10-29T00:00:00.000Z" };

/** [label, (services) => promise, expected { method, path, query?, body? }] */
const CASES = [
  // dashboard
  ["dashboard overview", (s) => s.insight.overview(), { method: "GET", path: "/api/v1/dashboard/overview" }],
  ["dashboard vehicles", (s) => s.insight.vehicleCounts(), { method: "GET", path: "/api/v1/dashboard/vehicles" }],
  ["dashboard active trips", (s) => s.insight.activeTrips(), { method: "GET", path: "/api/v1/dashboard/active-trips" }],
  ["dashboard device health", (s) => s.insight.deviceHealth(), { method: "GET", path: "/api/v1/dashboard/device-health" }],
  ["dashboard safety events", (s) => s.insight.safetyEvents(W), { method: "GET", path: "/api/v1/dashboard/safety-events", query: W }],
  ["dashboard trends", (s) => s.insight.trends(W), { method: "GET", path: "/api/v1/dashboard/trends", query: W }],
  ["dashboard fleet status", (s) => s.insight.fleetStatus(), { method: "GET", path: "/api/v1/dashboard/fleet-status" }],
  ["device summary", (s) => s.insight.vehicleSummary(7), { method: "GET", path: "/api/v1/devices/7/summary" }],
  ["event markers", (s) => s.insight.eventMarkers(7, W), { method: "GET", path: "/api/v1/devices/7/event-markers", query: W }],
  // trips
  ["trips list", (s) => s.insight.listTrips({ ...W, deviceId: 3, pageNumber: 2, pageSize: 20 }), { method: "GET", path: "/api/v1/trips", query: { ...W, deviceId: "3", pageNumber: "2", pageSize: "20" } }],
  ["trips summary", (s) => s.insight.tripSummary({ ...W, driverId: 4 }), { method: "GET", path: "/api/v1/trips/summary", query: { ...W, driverId: "4" } }],
  ["trip detail", (s) => s.insight.tripDetail(9), { method: "GET", path: "/api/v1/trips/9" }],
  ["trip route", (s) => s.insight.tripRoute(9), { method: "GET", path: "/api/v1/trips/9/route" }],
  // safety
  ["safety analytics", (s) => s.insight.safetyAnalytics(W), { method: "GET", path: "/api/v1/safety/analytics", query: W }],
  ["driver scores", (s) => s.insight.scores("drivers", { ...W, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/safety/scores/drivers", query: { ...W, pageNumber: "1", pageSize: "20" } }],
  ["vehicle scores", (s) => s.insight.scores("vehicles", W), { method: "GET", path: "/api/v1/safety/scores/vehicles", query: W }],
  ["driver safety score", (s) => s.insight.driverScore(5, W), { method: "GET", path: "/api/v1/drivers/5/safety-score", query: W }],
  ["driver safety events", (s) => s.insight.driverSafetyEvents(5, { ...W, pageNumber: 1, pageSize: 5 }), { method: "GET", path: "/api/v1/drivers/5/safety-events", query: { ...W, pageNumber: "1", pageSize: "5" } }],
  // geofence events + voices
  ["geofence events", (s) => s.insight.geofenceEvents({ ...W, geofenceId: 2, eventType: "ENTER", pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/geofences/events", query: { ...W, geofenceId: "2", eventType: "ENTER", pageNumber: "1", pageSize: "20" } }],
  ["geofence event summary", (s) => s.insight.geofenceEventSummary(W), { method: "GET", path: "/api/v1/geofences/events/summary", query: W }],
  ["fence voices", (s) => s.insight.fenceVoices(), { method: "GET", path: "/api/v1/voices/fence" }],
  // drivers
  ["drivers list", (s) => s.ops.listDrivers({ keyword: "ra", status: "ACTIVE", pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/drivers", query: { keyword: "ra", status: "ACTIVE", pageNumber: "1", pageSize: "20" } }],
  ["driver get", (s) => s.ops.getDriver(5), { method: "GET", path: "/api/v1/drivers/5" }],
  ["driver create", (s) => s.ops.createDriver({ name: "A", status: "ACTIVE" }), { method: "POST", path: "/api/v1/drivers", body: { name: "A", status: "ACTIVE" } }],
  ["driver update", (s) => s.ops.updateDriver(5, { name: "A" }), { method: "PUT", path: "/api/v1/drivers/5", body: { name: "A" } }],
  ["driver delete", (s) => s.ops.deleteDriver(5), { method: "DELETE", path: "/api/v1/drivers/5" }],
  ["licence expiries", (s) => s.ops.licenceExpiries(30), { method: "GET", path: "/api/v1/drivers/licence-expiries", query: { withinDays: "30" } }],
  ["driver assignments", (s) => s.ops.driverAssignments(5), { method: "GET", path: "/api/v1/drivers/5/assignments" }],
  ["assign vehicle", (s) => s.ops.assignVehicle(5, { deviceId: 7, replaceCurrent: false }), { method: "POST", path: "/api/v1/drivers/5/assignments", body: { deviceId: 7, replaceCurrent: false } }],
  ["end assignment", (s) => s.ops.endAssignment(5, 11, {}), { method: "POST", path: "/api/v1/drivers/5/assignments/11/end", body: {} }],
  ["device driver assignments", (s) => s.ops.deviceAssignments(7), { method: "GET", path: "/api/v1/devices/7/driver-assignments" }],
  // dispatch
  ["dispatch list", (s) => s.ops.listDispatches({ ...W, status: ["A", "B"], pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/dispatches", query: { ...W, status: ["A", "B"], pageNumber: "1", pageSize: "20" } }],
  ["dispatch get", (s) => s.ops.getDispatch(3), { method: "GET", path: "/api/v1/dispatches/3" }],
  ["dispatch create", (s) => s.ops.createDispatch({ deviceId: 1, driverId: 2, title: "T", scheduledStart: W.from, scheduledEnd: W.to }), { method: "POST", path: "/api/v1/dispatches", body: { deviceId: 1, driverId: 2, title: "T", scheduledStart: W.from, scheduledEnd: W.to } }],
  ["dispatch update", (s) => s.ops.updateDispatch(3, { deviceId: 1, driverId: 2, title: "T", scheduledStart: W.from, scheduledEnd: W.to }), { method: "PUT", path: "/api/v1/dispatches/3" }],
  ["dispatch check", (s) => s.ops.checkDispatch({ deviceId: 1, driverId: 2, title: "T", scheduledStart: W.from, scheduledEnd: W.to }), { method: "POST", path: "/api/v1/dispatches/check" }],
  ["dispatch cancel", (s) => s.ops.cancelDispatch(3, { reason: "x" }), { method: "POST", path: "/api/v1/dispatches/3/cancel", body: { reason: "x" } }],
  ["dispatch verification", (s) => s.ops.verification(3), { method: "GET", path: "/api/v1/dispatches/3/verification" }],
  ["dispatch conflicts", (s) => s.ops.conflicts(W), { method: "GET", path: "/api/v1/dispatches/conflicts", query: W }],
  ["swap request", (s) => s.ops.requestSwap(3, { toDriverId: 4 }), { method: "POST", path: "/api/v1/dispatches/3/swap-requests", body: { toDriverId: 4 } }],
  ["swap list", (s) => s.ops.listSwaps({ pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/swap-requests", query: { pageNumber: "1", pageSize: "20" } }],
  ["swap approve", (s) => s.ops.decideSwap(8, "approve", { note: "ok" }), { method: "POST", path: "/api/v1/swap-requests/8/approve", body: { note: "ok" } }],
  ["swap reject", (s) => s.ops.decideSwap(8, "reject", {}), { method: "POST", path: "/api/v1/swap-requests/8/reject", body: {} }],
  // workforce
  ["shifts", (s) => s.ops.listShifts({ ...W, driverId: 2 }), { method: "GET", path: "/api/v1/shifts", query: { ...W, driverId: "2" } }],
  ["leave list", (s) => s.ops.listLeave({ pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/leave-requests", query: { pageNumber: "1", pageSize: "20" } }],
  ["leave create", (s) => s.ops.createLeave({ driverId: 2, leaveType: "SICK", startDate: "2026-11-01", endDate: "2026-11-02" }), { method: "POST", path: "/api/v1/leave-requests", body: { driverId: 2, leaveType: "SICK", startDate: "2026-11-01", endDate: "2026-11-02" } }],
  ["leave approve", (s) => s.ops.decideLeave(6, "approve", {}), { method: "POST", path: "/api/v1/leave-requests/6/approve", body: {} }],
  ["leave reject", (s) => s.ops.decideLeave(6, "reject", { note: "n" }), { method: "POST", path: "/api/v1/leave-requests/6/reject", body: { note: "n" } }],
  ["checklists", (s) => s.ops.listChecklists({ ...W, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/checklists" }],
  ["checklist template", (s) => s.ops.checklistTemplate(), { method: "GET", path: "/api/v1/checklist-template" }],
  ["availability", (s) => s.ops.availability("2026-10-29"), { method: "GET", path: "/api/v1/drivers/availability", query: { date: "2026-10-29" } }],
  // alerts
  ["alerts list", (s) => s.alerts.listAlerts({ ...W, openOnly: true, deviceIds: [1, 2], pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/alerts", query: { ...W, openOnly: "true", deviceIds: ["1", "2"], pageNumber: "1", pageSize: "20" } }],
  ["alert get", (s) => s.alerts.getAlert(4), { method: "GET", path: "/api/v1/alerts/4" }],
  ["alert evidence", (s) => s.alerts.evidence(4), { method: "GET", path: "/api/v1/alerts/4/evidence" }],
  ["alert actions", (s) => s.alerts.actions(4), { method: "GET", path: "/api/v1/alerts/4/actions" }],
  ["alert acknowledge", (s) => s.alerts.noteAction(4, "acknowledge", { note: "seen" }), { method: "POST", path: "/api/v1/alerts/4/acknowledge", body: { note: "seen" } }],
  ["alert dismiss", (s) => s.alerts.noteAction(4, "dismiss", {}), { method: "POST", path: "/api/v1/alerts/4/dismiss", body: {} }],
  ["alert reopen", (s) => s.alerts.noteAction(4, "reopen", {}), { method: "POST", path: "/api/v1/alerts/4/reopen", body: {} }],
  ["alert resolve", (s) => s.alerts.resolve(4, { outcome: "FALSE_POSITIVE" }), { method: "POST", path: "/api/v1/alerts/4/resolve", body: { outcome: "FALSE_POSITIVE" } }],
  ["alert comment", (s) => s.alerts.comment(4, { note: "c" }), { method: "POST", path: "/api/v1/alerts/4/comments", body: { note: "c" } }],
  // notifications
  ["notifications", (s) => s.alerts.listNotifications({ pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/notifications", query: { pageNumber: "1", pageSize: "20" } }],
  ["unread count", (s) => s.alerts.unreadCount(), { method: "GET", path: "/api/v1/notifications/unread-count" }],
  ["mark read", (s) => s.alerts.markNotification(3, true), { method: "POST", path: "/api/v1/notifications/3/read" }],
  ["mark unread", (s) => s.alerts.markNotification(3, false), { method: "POST", path: "/api/v1/notifications/3/unread" }],
  ["mark all read", (s) => s.alerts.markAllRead(), { method: "POST", path: "/api/v1/notifications/read-all" }],
  // search + assistant
  ["search", (s) => s.assistant.search("ab c", 8), { method: "GET", path: "/api/v1/search", query: { q: "ab c", limit: "8" } }],
  ["assistant prompts", (s) => s.assistant.prompts(), { method: "GET", path: "/api/v1/assistant/prompts" }],
  ["assistant ask", (s) => s.assistant.ask({ question: "Who is on leave?" }), { method: "POST", path: "/api/v1/assistant/ask", body: { question: "Who is on leave?" } }],
  // driver app
  ["driver me", (s) => s.driver.me(), { method: "GET", path: "/api/v1/driver/me" }],
  ["driver contact", (s) => s.driver.updateContact({ phone: "+91 1" }), { method: "PATCH", path: "/api/v1/driver/me", body: { phone: "+91 1" } }],
  ["driver assignment", (s) => s.driver.assignment(), { method: "GET", path: "/api/v1/driver/assignment" }],
  ["driver dispatches", (s) => s.driver.dispatches({ ...W, pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/driver/dispatches" }],
  ["driver dispatch", (s) => s.driver.dispatch(3), { method: "GET", path: "/api/v1/driver/dispatches/3" }],
  ["driver accept", (s) => s.driver.dispatchAction(3, "accept"), { method: "POST", path: "/api/v1/driver/dispatches/3/accept" }],
  ["driver start", (s) => s.driver.dispatchAction(3, "start"), { method: "POST", path: "/api/v1/driver/dispatches/3/start" }],
  ["driver complete", (s) => s.driver.dispatchAction(3, "complete"), { method: "POST", path: "/api/v1/driver/dispatches/3/complete" }],
  ["driver decline", (s) => s.driver.decline(3, { reason: "sick" }), { method: "POST", path: "/api/v1/driver/dispatches/3/decline", body: { reason: "sick" } }],
  ["driver swap", (s) => s.driver.requestSwap(3, {}), { method: "POST", path: "/api/v1/driver/dispatches/3/swap-requests", body: {} }],
  ["driver current shift", (s) => s.driver.currentShift(), { method: "GET", path: "/api/v1/driver/shifts/current" }],
  ["driver shift start", (s) => s.driver.startShift({ deviceId: 7 }), { method: "POST", path: "/api/v1/driver/shifts/start", body: { deviceId: 7 } }],
  ["driver shift end", (s) => s.driver.endShift({}), { method: "POST", path: "/api/v1/driver/shifts/end", body: {} }],
  ["driver working hours", (s) => s.driver.workingHours(W), { method: "GET", path: "/api/v1/driver/working-hours", query: W }],
  ["driver leave", (s) => s.driver.leave({ pageNumber: 1, pageSize: 20 }), { method: "GET", path: "/api/v1/driver/leave-requests" }],
  ["driver leave request", (s) => s.driver.requestLeave({ leaveType: "CASUAL", startDate: "2026-11-01", endDate: "2026-11-01" }), { method: "POST", path: "/api/v1/driver/leave-requests", body: { leaveType: "CASUAL", startDate: "2026-11-01", endDate: "2026-11-01" } }],
  ["driver leave cancel", (s) => s.driver.cancelLeave(6), { method: "POST", path: "/api/v1/driver/leave-requests/6/cancel" }],
  ["driver checklist template", (s) => s.driver.checklistTemplate(), { method: "GET", path: "/api/v1/driver/checklist-template" }],
  ["driver checklists", (s) => s.driver.checklists({ ...W, pageNumber: 1, pageSize: 5 }), { method: "GET", path: "/api/v1/driver/checklists" }],
  ["driver checklist submit", (s) => s.driver.submitChecklist({ items: [{ key: "tyres", passed: true }] }), { method: "POST", path: "/api/v1/driver/checklists", body: { items: [{ key: "tyres", passed: true }] } }],
  ["driver safety score", (s) => s.driver.safetyScore(W), { method: "GET", path: "/api/v1/driver/safety-score", query: W }],
  ["driver safety events", (s) => s.driver.safetyEvents({ ...W, pageNumber: 1, pageSize: 5 }), { method: "GET", path: "/api/v1/driver/safety-events" }],
];

for (const [label, call, want] of CASES) {
  test(`request: ${label} → ${want.method} ${want.path}`, async () => {
    const s = openRealm();
    await call(s);
    assert.equal(s.calls.length, 1, "exactly one request");
    const got = s.calls[0];
    assert.equal(got.method, want.method);
    assert.equal(got.path, want.path);
    assert.ok(inSpec(got.method, got.path), `${got.method} ${got.path} is in the OpenAPI snapshot`);
    assert.equal(got.auth, true, "bearer token attached");
    if (want.query) same(got.query, want.query);
    if ("body" in want) same(got.body, want.body);
  });
}

test("every new-family operation in the snapshot is covered by a service request test", () => {
  const covered = new Set(CASES.map(([, , w]) => `${w.method} ${w.path.replace(/\/\d+(?=\/|$)/g, "/{}")}`));
  const NEW_TAGS = ["dashboard-controller", "trip-controller", "driver-controller", "dispatch-controller", "driver-app-controller", "workforce-controller", "safety-controller", "alert-controller", "notification-controller", "search-controller", "assistant-controller", "geofence-event-controller"];
  // Deliberately not called from the UI: the spec's body for it is the driver-assignment schema (no assignee field).
  const EXCLUDED = new Set(["POST /api/v1/alerts/{}/assign"]);
  const missing = [];
  for (const [p, ops] of Object.entries(SPEC.paths)) {
    for (const [m, op] of Object.entries(ops)) {
      if (!(op.tags ?? []).some((t) => NEW_TAGS.includes(t))) continue;
      const key = `${m.toUpperCase()} ${p.replace(/\{[^}]+\}/g, "{}")}`;
      if (!covered.has(key) && !EXCLUDED.has(key)) missing.push(key);
    }
  }
  same(missing, []);
});

test("an error envelope inside HTTP 200 is an error, not a success", async () => {
  const s = openRealm(() => [200, { code: 409, msg: "Driver already assigned", data: null, extend: { errorCode: "CONFLICT", requestId: "req-1" } }]);
  const err = await s.ops.assignVehicle(5, { deviceId: 7 }).then(
    () => assert.fail("resolved"),
    (e) => e
  );
  assert.ok(s.errors.isApiError(err));
  same({ status: err.status, errorCode: err.errorCode, requestId: err.requestId, msg: s.errors.describeApiError(err) }, { status: 409, errorCode: "CONFLICT", requestId: "req-1", msg: "Driver already assigned" });
});

test("403 on a driver-app call surfaces as forbidden — no retry, no fallback data", async () => {
  const s = openRealm(() => [403, { code: 403, msg: "Not a driver", data: null, extend: { errorCode: "FORBIDDEN" } }]);
  const err = await s.driver.me().then(
    () => assert.fail("resolved"),
    (e) => e
  );
  assert.equal(err.isForbidden, true);
  assert.equal(s.calls.length, 1);
});

test("successful reads return the server's data unchanged; empty data becomes an empty value, never sample data", async () => {
  const s = openRealm((c) => (c.path.endsWith("/overview") ? [200, { code: 200, data: { vehicles: { total: 3 } }, extend: { source: "LOCAL", stale: true } }] : [200, { code: 200, data: null, total: null }]));
  const o = await s.insight.overview();
  same(o.data, { vehicles: { total: 3 } });
  assert.equal(o.source.source, "LOCAL");
  same(await s.insight.trends(W), { items: [], total: 0, source: null });
  assert.equal(await s.driver.currentShift(), null);
  same(await s.assistant.search("x"), {});
});

test("unread count: read from the `unread` key observed on the live BFF; anything else gives null (no badge)", () => {
  const { readUnreadCount } = openRealm();
  assert.equal(readUnreadCount({ unread: 4 }), 4);
  assert.equal(readUnreadCount({ unread: 0 }), 0);
  assert.equal(readUnreadCount({ count: 2 }), null);
  assert.equal(readUnreadCount({ something: 3 }), null);
  assert.equal(readUnreadCount({ unread: -1 }), null);
  assert.equal(readUnreadCount(null), null);
});
