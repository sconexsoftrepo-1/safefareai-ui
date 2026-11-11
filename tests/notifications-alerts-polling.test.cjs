// Notifications and alerts polling. MOCKED / SYNTHETIC ONLY: payloads follow docs/contracts/polling-apis.txt, identities
// are synthetic and every request goes to a stub fetch. A pass says nothing about the live backend.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const pure = createRealm({ AbortController, process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f() } });
const { createPoller, POLL_INTERVAL_MS } = pure.require("features/drive-vision/hooks/poller");
const model = pure.require("components/drive-vision/app-shell/notifications-model");
const alertsModel = pure.require("components/drive-vision/alerts/alerts-model");
const p = pure.require("features/drive-vision/access/access-policy");
const idm = pure.require("features/drive-vision/access/identity");
const access = (raw, selectedTenantId) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });

// ── A clock and page the test controls ──────────────────────────────────────

function fakeEnv() {
  let now = 0;
  let seq = 0;
  let hidden = false;
  const timers = new Map();
  const listeners = new Set();
  return {
    env: {
      isHidden: () => hidden,
      onVisibilityChange: (l) => (listeners.add(l), () => listeners.delete(l)),
      setTimer: (run, ms) => (timers.set(++seq, { run, at: now + ms }), seq),
      clearTimer: (id) => timers.delete(id),
    },
    timers,
    listeners,
    /** Moves the clock, firing due timers in order. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].run();
      }
      now = end;
    },
    setHidden(value) {
      hidden = value;
      listeners.forEach((l) => l());
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** A poller whose requests stay open until the test settles them. */
function harness(options = {}) {
  const clock = fakeEnv();
  const started = [];
  const delivered = [];
  const errors = [];
  const poller = createPoller({
    run: (signal) => new Promise((resolve, reject) => started.push({ resolve, reject, signal })),
    onData: (d) => delivered.push(d),
    onError: (e) => errors.push(e),
    env: clock.env,
    ...options,
  });
  const finish = async (value = "ok") => {
    started.at(-1).resolve(value);
    await flush();
  };
  const fail = async (error) => {
    started.at(-1).reject(error);
    await flush();
  };
  return { ...clock, poller, started, delivered, errors, finish, fail };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

test("the interval is 5 seconds and the first request is immediate", async () => {
  assert.equal(POLL_INTERVAL_MS, 5000);
  const h = harness();
  h.poller.start();
  assert.equal(h.started.length, 1, "no wait for the first");
  await h.finish();
  h.advance(4999);
  assert.equal(h.started.length, 1);
  h.advance(1);
  assert.equal(h.started.length, 2);
  await h.finish();
  h.advance(5000);
  assert.equal(h.started.length, 3);
  same(h.delivered, ["ok", "ok"]);
});

test("requests never overlap: a slow response delays the next one", async () => {
  const h = harness();
  h.poller.start();
  h.advance(60_000);
  assert.equal(h.started.length, 1, "nothing starts while one is open");
  assert.equal(h.timers.size, 0, "and no timer is waiting");
  await h.finish();
  h.advance(4999);
  assert.equal(h.started.length, 1, "the interval runs from the response");
  h.advance(1);
  assert.equal(h.started.length, 2);
});

test("hidden tab: no timer and no request, however long", async () => {
  const h = harness();
  h.poller.start();
  await h.finish();
  h.setHidden(true);
  assert.equal(h.timers.size, 0);
  h.advance(600_000);
  assert.equal(h.started.length, 1);
});

test("a request open when the tab hides finishes, but schedules nothing", async () => {
  const h = harness();
  h.poller.start();
  h.setHidden(true);
  await h.finish();
  same(h.delivered, ["ok"]);
  assert.equal(h.timers.size, 0);
});

test("visible again: one request at once, then the normal pace", async () => {
  const h = harness();
  h.poller.start();
  await h.finish();
  h.setHidden(true);
  h.advance(30_000);
  h.setHidden(false);
  assert.equal(h.started.length, 2, "immediately");
  await h.finish();
  h.advance(5000);
  assert.equal(h.started.length, 3);
});

test("started in a hidden tab, it waits for the tab to show", () => {
  const h = harness();
  h.setHidden(true);
  h.poller.start();
  assert.equal(h.started.length, 0);
  h.setHidden(false);
  assert.equal(h.started.length, 1);
});

test("stop ends everything: the open request aborts, its answer is ignored, timers and listeners go", async () => {
  const h = harness();
  h.poller.start();
  const open = h.started[0];
  h.poller.stop();
  assert.equal(open.signal.aborted, true);
  assert.equal(h.listeners.size, 0);
  await h.finish("too late");
  same(h.delivered, []);
  assert.equal(h.timers.size, 0);
  h.advance(60_000);
  h.setHidden(true);
  h.setHidden(false);
  assert.equal(h.started.length, 1, "logout: nothing more is requested");
});

test("React Strict Mode: mount, unmount, mount leaves exactly one loop", async () => {
  const clock = fakeEnv();
  const started = [];
  const make = () => createPoller({ run: (signal) => new Promise((resolve) => started.push({ resolve, signal })), onData() {}, onError() {}, env: clock.env });
  const first = make();
  first.start();
  first.stop();
  const second = make();
  second.start();
  assert.equal(started[0].signal.aborted, true);
  started[1].resolve("x");
  started[0].resolve("x");
  await flush();
  assert.equal(clock.timers.size, 1, "one timer, from the live poller only");
  assert.equal(clock.listeners.size, 1);
  second.stop();
});

test("start twice is one loop", async () => {
  const h = harness();
  h.poller.start();
  h.poller.start();
  assert.equal(h.started.length, 1);
  assert.equal(h.listeners.size, 1);
});

test("pollNow: at once when idle, and right after the open request otherwise, without overlap", async () => {
  const h = harness();
  h.poller.start();
  await h.finish();
  h.poller.pollNow();
  assert.equal(h.started.length, 2, "after read-all or a click");
  h.poller.pollNow();
  assert.equal(h.started.length, 2, "not alongside the open one");
  await h.finish();
  assert.equal(h.started.length, 3);
  await h.finish();
  assert.equal(h.timers.size, 1, "and back to one timer");
});

test("a failure keeps polling; a halting failure stops until asked", async () => {
  const halt = new Error("forbidden");
  const h = harness({ shouldHalt: (e) => e === halt });
  h.poller.start();
  await h.fail(new Error("network"));
  h.advance(5000);
  assert.equal(h.started.length, 2, "retried on the next cycle");
  await h.fail(halt);
  assert.equal(h.timers.size, 0);
  h.advance(60_000);
  h.setHidden(true);
  h.setHidden(false);
  assert.equal(h.started.length, 2, "halted stays halted");
  h.poller.pollNow();
  assert.equal(h.started.length, 3, "an explicit retry can resume");
});

test("a run that throws synchronously is a failure, not a dead loop", async () => {
  const clock = fakeEnv();
  const errors = [];
  let calls = 0;
  const poller = createPoller({ run: () => (calls++, (() => { throw new Error("sync"); })()), onData() {}, onError: (e) => errors.push(e), env: clock.env });
  poller.start();
  await flush();
  assert.equal(errors.length, 1);
  clock.advance(5000);
  assert.equal(calls, 2);
  poller.stop();
});

// ── The hook ────────────────────────────────────────────────────────────────

test("usePolledQuery: keeps data on failure, skips identical responses, stops on session end, never flashes the table", () => {
  const hook = read("features/drive-vision/hooks/use-polled-query.ts");
  assert.match(hook, /prev\?\.key === key && prev\.json === json && prev\.error === undefined \? prev :/, "an identical response keeps the same state object, so React does not render");
  assert.match(hook, /return prev\.errorId === id \? prev : \{ \.\.\.prev, error, errorId: id, at: lastSuccess \?\? prev\.at \};/, "a failure keeps `data` and says when it was last confirmed");
  assert.match(hook, /onSessionEnded\(\(\) => poller\.stop\(\)\)/);
  assert.match(hook, /refreshing: false/);
  assert.match(hook, /return \(\) => \{\s*unsubscribe\(\);\s*poller\.stop\(\);/, "cleanup");
  assert.match(hook, /scopedKey\(scope, rawKey\)/, "tenant in the key, as useApiQuery");
});

test("only 400, 401, 403 and 404 stop a loop; network, timeout, parse and 5xx retry", () => {
  const s = openRealm();
  const { ApiError } = s.errors;
  const http = (status) => new ApiError({ kind: "http", status, message: "x", method: "GET", path: "/x" });
  for (const status of [400, 401, 403, 404]) assert.equal(s.haltsPolling(http(status)), true, status);
  for (const status of [429, 500, 502, 503, 504]) assert.equal(s.haltsPolling(http(status)), false, status);
  for (const kind of ["network", "timeout", "parse", "aborted"]) assert.equal(s.haltsPolling(new ApiError({ kind, message: "x", method: "GET", path: "/x" })), false, kind);
});

// ── Requests through the real client ────────────────────────────────────────

const STORAGE_KEY = "safefare:session:v1";
function openRealm(respond = () => [200, { code: 200, msg: "Success", data: {} }]) {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 10 * 60_000, refreshToken: "r", refreshExpiresAt: null }));
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const search = u.search;
    const call = { method: init.method ?? "GET", path: u.pathname.replace("/api/v1", ""), search, query: Object.fromEntries(u.searchParams), headers: init.headers ?? {}, body: init.body, sent: init.body !== undefined };
    calls.push(call);
    const [status, body] = await respond(call);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const realm = createRealm(
    { console: sink, sessionStorage: storage, navigator: { locks: createLockManager() }, fetch, AbortSignal, AbortController, performance, crypto: globalThis.crypto, atob, structuredClone, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } } },
    { react: { useSyncExternalStore: () => undefined, useMemo: (f) => f(), useCallback: (f) => f, useEffect() {}, useRef: () => ({}), useState: () => [] } }
  );
  const r = (x) => realm.require(x);
  return {
    calls,
    storage,
    svc: r("features/drive-vision/api/alert-service").alertService,
    fleet: r("features/drive-vision/api/fleet-service").fleetService,
    tenant: r("features/drive-vision/api/tenant-context"),
    errors: r("features/drive-vision/api/errors"),
    client: r("features/drive-vision/api/client"),
    createPoller: r("features/drive-vision/hooks/poller").createPoller,
    haltsPolling: r("features/drive-vision/hooks/use-polled-query").haltsPolling,
    model: r("components/drive-vision/alerts/alerts-model"),
  };
}
const ok = (data, total) => [200, { code: 200, msg: "Success", data, total: total ?? null, extend: null }];
const fail = (status, errorCode, msg) => [status, { code: status, msg, data: null, extend: { errorCode, fieldErrors: [], requestId: "req-1" } }];
const header = (c, name) => Object.entries(c.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const T1 = { tenantId: 1, code: "Ganesh", name: "Ganesh Travels", header: "X-Tenant-Id" };

const aiItem = () => ({ id: 912, type: "AI_EVENT", severity: 3, title: "AP29Z0001:Pedestrian Collision", body: "AP29Z0001 (13600000003) Pedestrian Collision at 2026-11-04 09:50:54", refType: "ALARM", refId: "837", createdAt: "2026-11-04T04:20:57Z", readAt: null, read: false, details: { kind: "AI", alarmId: 837, deviceId: 1215, deviceName: "AP29Z0001", terminalNo: "13600000003", alarmTypeId: 208, alarmName: "Pedestrian Collision", alarmTime: "2026-11-04T04:20:54Z", vendorAlarmTime: "2026-11-04 09:50:54" } });
const assigned = () => ({ id: 950, type: "ALARM", severity: 2, title: "Alert assigned", body: "An alert was assigned to you", refType: "ALARM", refId: "840", createdAt: "2026-11-04T05:00:00Z", readAt: null, read: false, details: null });

test("GET /notifications/poll?limit=20 with the bearer token and no tenant header, even with a tenant selected", async () => {
  const s = openRealm(() => ok({ unreadTotal: 0, aiEvents: { unread: 0, items: [] }, alarm: { unread: 0, items: [] } }));
  await s.svc.pollNotifications(20);
  s.tenant.setTenantSelection(T1);
  await s.svc.pollNotifications(20);
  for (const c of s.calls) {
    assert.equal(`${c.method} ${c.path}${c.search}`, "GET /notifications/poll?limit=20");
    assert.match(header(c, "Authorization"), /^Bearer /);
    assert.equal(header(c, "X-Tenant-Id"), undefined, "notifications belong to the signed-in user");
  }
});

test("the poll response maps to the bell: total, tab counts and lists", () => {
  const poll = model.readNotificationPoll({ unreadTotal: 35, aiEvents: { type: "AI_EVENT", unread: 34, items: [aiItem()] }, alarm: { type: "ALARM", unread: 1, items: [assigned()] } });
  assert.equal(poll.unreadTotal, 35, "may exceed the tabs: it counts other types too");
  assert.equal(poll.ai.unread, 34);
  assert.equal(poll.alarm.unread, 1);
  assert.equal(poll.ai.items[0].title, "AP29Z0001:Pedestrian Collision");
  assert.equal(poll.alarm.items[0].body, "An alert was assigned to you");
  assert.ok(poll.ai.items.every((n) => !n.read), "the poll holds unread items only");
});

test("Safe-Fare Admin: an empty poll shows an empty bell; nothing is invented, and malformed data reads as empty", () => {
  const empty = { unreadTotal: 0, ai: { unread: 0, items: [] }, alarm: { unread: 0, items: [] } };
  same(model.readNotificationPoll({ unreadTotal: 0, aiEvents: { type: "AI_EVENT", unread: 0, items: [] }, alarm: { type: "ALARM", unread: 0, items: [] } }), empty);
  same(model.readNotificationPoll({}), empty);
  same(model.readNotificationPoll(null), empty);
  same(model.readNotificationPoll({ unreadTotal: "x", aiEvents: { unread: -1, items: "no" }, alarm: null }), empty);
});

test("null details: time falls back to createdAt, and the link to the reference", () => {
  const a = access(IDENTITIES.tenantAdmin);
  const n = assigned();
  const t = model.notificationTime(n);
  assert.equal(t.iso, "2026-11-04T05:00:00Z");
  assert.notEqual(t.text, "—");
  assert.equal(model.notificationHref(a, n), "/drive-vision/alerts?kind=incidents&alarm=840");
  for (const details of [undefined, null, {}]) {
    assert.equal(model.notificationTime({ ...n, details }).iso, n.createdAt);
    assert.doesNotThrow(() => model.notificationHref(a, { ...n, details }));
  }
  assert.equal(model.notificationTime({ id: 1 }), null, "no time at all");
});

test("alarm notifications: the vendor's clock text is shown as sent, and details.alarmId opens the alert", () => {
  const a = access(IDENTITIES.tenantAdmin);
  const n = aiItem();
  same(model.notificationTime(n), { text: "2026-11-04 09:50:54", iso: "2026-11-04T04:20:54Z" });
  assert.equal(model.notificationHref(a, n), "/drive-vision/alerts?kind=incidents&alarm=837");
});

test("other types are not assumed to be alarms; a link needs the right to open it", () => {
  const driver = access(IDENTITIES.driver);
  assert.equal(model.notificationHref(driver, aiItem()), null, "no alarm.read: plain text, no dead link");
  const sensor = { id: 7, type: "SENSOR", title: "Sensor offline", createdAt: "2026-11-04T05:00:00Z", refType: "SENSOR", refId: "4", read: false };
  assert.equal(model.notificationHref(access(IDENTITIES.tenantAdmin), sensor), null);
  assert.ok(model.notificationTime(sensor));
});

test("the bell: every poll row is unread, tabs use the tab counts, other types stay reachable through All", () => {
  const nc = read("components/drive-vision/app-shell/notification-center.tsx");
  assert.match(nc, /usePolledQuery\("notifications:poll", \(signal\) => alertService\.pollNotifications\(POLL_LIMIT, signal\)\)/);
  assert.match(nc, /const unread = pollQ\.data \? poll\.unreadTotal : undefined;/, "badge from unreadTotal");
  assert.match(nc, /label="AI Events" count=\{poll\.ai\.unread\}/);
  assert.match(nc, /label="Alarm" count=\{poll\.alarm\.unread\}/);
  assert.match(nc, /label="All"/);
  assert.match(nc, /type: tab === "ALL" \? undefined : tab, unreadOnly: unreadOnly \|\| undefined, pageNumber: page, pageSize: PAGE_SIZE/, "See more");
  assert.match(nc, /!n\.read && "bg-brand-tint\/40"/);
  assert.match(nc, /n\.read \? "bg-transparent" : "bg-brand"/, "red dot");
  assert.doesNotMatch(nc, /unreadCount\(\)/, "the poll replaces the separate count");
});

// ── Actions ─────────────────────────────────────────────────────────────────

test("read, unread and read-all: POST, no body, documented paths", async () => {
  const s = openRealm(() => ok({ id: 912, read: true, updated: 3 }));
  await s.svc.markNotification(912, true);
  await s.svc.markNotification(912, false);
  await s.svc.markAllRead("AI_EVENT");
  await s.svc.markAllRead("ALARM");
  await s.svc.markAllRead();
  same(s.calls.map((c) => `${c.method} ${c.path}${c.search}`), ["POST /notifications/912/read", "POST /notifications/912/unread", "POST /notifications/read-all?type=AI_EVENT", "POST /notifications/read-all?type=ALARM", "POST /notifications/read-all"]);
  for (const c of s.calls) {
    assert.equal(c.sent, false, "no body");
    assert.equal(header(c, "Content-Type"), undefined);
  }
});

test("See more: type, unreadOnly and paging, with the server's total", async () => {
  const s = openRealm(() => ok([aiItem()], 34));
  const page = await s.svc.listNotifications({ type: "AI_EVENT", unreadOnly: true, pageNumber: 2, pageSize: 20 });
  same(s.calls[0].query, { type: "AI_EVENT", unreadOnly: "true", pageNumber: "2", pageSize: "20" });
  assert.equal(page.total, 34);
});

test("the panel shows the full list: a loading check can't swallow the list (a regression found in the browser)", () => {
  const nc = read("components/drive-vision/app-shell/notification-center.tsx");
  assert.match(nc, /\) : !\(fullList \? listQ\.data : pollQ\.data\) \? \(\s*<LoadingSkeleton/);
  assert.doesNotMatch(nc, /fullList \? !listQ\.data : !pollQ\.data/);
});

test("the UI: success updates first, a click re-polls and then opens the alert, a failed read doesn't navigate", () => {
  const nc = read("components/drive-vision/app-shell/notification-center.tsx");
  const mark = nc.slice(nc.indexOf("async function mark("), nc.indexOf("async function markAll"));
  assert.match(mark, /await alertService\.markNotification\(n\.id, read\);\s*return true;/);
  assert.match(mark, /finally \{\s*setBusy\(null\);\s*refresh\(\);/, "counts refresh immediately");
  assert.match(nc, /if \(!n\.read && canMark && !\(await mark\(n, true\)\)\) return;\s*setOpen\(false\);\s*router\.push\(href\);/);
  const all = nc.slice(nc.indexOf("async function markAll"), nc.indexOf("async function openItem"));
  assert.match(all, /markAllRead\(tab === "ALL" \? undefined : tab\)/);
  assert.match(all, /refresh\(\);/, "polls again at once");
});

// ── Alert queries ───────────────────────────────────────────────────────────

const VIEW = { kind: "ai", range: "7d", deviceId: null, typeId: null, page: 1, alarmId: null, history: false };
const LIVE = { openOnly: true, keyword: "" };

test("the AI and Routine requests are exactly the documented ones", async () => {
  const s = openRealm(() => ok([], 0));
  await s.svc.listAlerts(s.model.incidentQuery(VIEW, new Date(), { ...LIVE, kind: "AI" }));
  await s.svc.listAlerts(s.model.incidentQuery({ ...VIEW, kind: "routine" }, new Date(), { ...LIVE, kind: "ROUTINE" }));
  same(s.calls.map((c) => [c.path, c.query]), [
    ["/alerts", { kind: "AI", openOnly: "true", pageNumber: "1", pageSize: "20" }],
    ["/alerts", { kind: "ROUTINE", openOnly: "true", pageNumber: "1", pageSize: "20" }],
  ]);
});

test("a poll never sends `to`: a fixed end would hide every new alert", () => {
  for (const range of ["today", "7d", "30d"]) assert.equal(alertsModel.incidentQuery({ ...VIEW, range }, new Date(), LIVE).to, undefined, range);
  const q = (now) => alertsModel.incidentQuery({ ...VIEW, range: "30d" }, new Date(now), LIVE).from;
  assert.notEqual(q("2026-11-04T06:00:00Z"), q("2026-11-05T06:00:00Z"), "`from` follows the clock");
  assert.match(read("components/drive-vision/alerts/incidents.tsx"), /incidentQuery\(view, new Date\(\), \{ openOnly, keyword, kind: alertKind \}\)/, "built for each poll");
});

test("filters: only what the screen offers is sent; no status when openOnly is on; none invented", async () => {
  const s = openRealm(() => ok([], 0));
  await s.svc.listAlerts(s.model.incidentQuery({ ...VIEW, range: "today", deviceId: 12, typeId: 208, page: 3 }, new Date("2026-11-04T06:00:00Z"), { openOnly: true, keyword: " speed ", kind: "AI" }));
  const c = s.calls[0];
  assert.equal(c.path, "/alerts");
  assert.ok(c.query.from);
  assert.deepEqual({ ...c.query, from: 0 }, { kind: "AI", from: 0, deviceIds: "12", alarmTypeIds: "208", openOnly: "true", keyword: "speed", pageNumber: "3", pageSize: "20" });
  const closed = alertsModel.incidentQuery(VIEW, new Date(), { openOnly: false, keyword: "" });
  assert.equal(closed.openOnly, undefined);
  for (const k of ["status", "severity", "driverId", "assigneeUserId"]) assert.equal(closed[k], undefined, k);
});

test("pagination and filter changes: the page and filters are in the view and the loop's key", () => {
  const view = alertsModel.parseAlertsView(new URLSearchParams("kind=routine&range=30d&device=3&type=2&page=4"));
  assert.equal(alertsModel.incidentQuery(view, new Date(), { ...LIVE, kind: "ROUTINE" }).pageNumber, 4);
  const list = read("components/drive-vision/alerts/incidents.tsx");
  assert.match(list, /const filters = JSON\.stringify\(\[view\.range, view\.deviceId, view\.typeId, openOnly, keyword\]\);/);
  assert.match(list, /`alerts:live:\$\{alertKind \?\? "all"\}:\$\{filters\}:\$\{view\.page\}`/, "a new key refetches at once and restarts the loop");
  assert.match(list, /serverPagination=\{\{ page: view\.page, total: listQ\.data\.total, onPageChange: onPage \}\}/, "the server's total");
  assert.doesNotMatch(list, /isLoading=\{listQ\.refreshing\}/, "polling doesn't replace the table with a skeleton");
  assert.match(list, /\(view\.page - 1\) \* ALARM_PAGE_SIZE >= total/, "a page emptied by closed alerts steps back");
});

test("page text keeps \"AI\" in capitals", () => {
  assert.doesNotMatch(read("components/drive-vision/alerts/alerts-page.tsx"), /KIND_LABEL\[[^\]]+\]\.toLowerCase\(\)/);
});

test("severity labels are the documented scale; an unknown value isn't guessed", () => {
  same([1, 2, 3, 4].map(alertsModel.severityLabel), ["Severe", "Moderate", "General", "Notice"]);
  assert.equal(alertsModel.severityLabel(9), "Level 9");
});

test("routine rows show device, terminal, alarm, time, severity and handling status; details use GET /alerts/{id}, not polled", async () => {
  const list = read("components/drive-vision/alerts/incidents.tsx");
  for (const re of [/deviceLabel\(a\)/, /a\.terminalNo/, /alarmLabel\(a, typeById\)/, /formatAlertIstTime\(a\.alarmTime\)/, /alertIstRelative\(a\.alarmTime, shownAt\)/, /<SeverityBadge severity=\{a\.severity\} \/>/, /<HandlingBadge alert=\{a\} \/>/]) assert.match(list, re);
  assert.match(list, /useApiQuery\(id !== null \? `incidents:detail:\$\{id\}` : null, \(\) => alertService\.getAlert\(id!\)\)/, "the detail is a one-off read");
  assert.equal([...list.matchAll(/usePolledQuery\(/g)].length, 2, "the list and the other tab's total only");
  for (const label of ["Evidence", "History", "Assignee", "Driver (server)", "Terminal", "Severity"]) assert.ok(list.includes(label), label);
  const s = openRealm(() => ok({ alert: { id: 837 }, actions: [], evidence: [] }));
  const detail = await s.svc.getAlert(837);
  assert.equal(detail.alert.id, 837);
  assert.equal(s.calls[0].path, "/alerts/837");
});

test("UTC becomes the user's own time zone, whichever that is", () => {
  const script = `
    const { createRealm } = require(${JSON.stringify(path.join(__dirname, "helpers/load-ts.cjs"))});
    const realm = createRealm({ process: { env: {} } }, {});
    const { formatLocalDateTime } = realm.require("features/drive-vision/utils/format");
    process.stdout.write(formatLocalDateTime("2026-11-04T04:20:54Z"));`;
  const at = (TZ) => execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ, LANG: "en_GB.UTF-8" }, encoding: "utf8" });
  assert.match(at("Asia/Kolkata"), /09:50:54/);
  assert.match(at("UTC"), /04:20:54/);
  assert.match(at("America/New_York"), /23:20:54/);
  const f = pure.require("features/drive-vision/utils/format");
  assert.equal(f.formatLocalDateTime("not a date"), "—");
});

test("the fixed fleet-time formatters are unchanged for everything else", () => {
  const f = pure.require("features/drive-vision/utils/format");
  assert.equal(f.FLEET_TIME_ZONE, "Asia/Kolkata");
  assert.match(f.formatTime("2026-11-04T04:20:54Z"), /09:50/);
});

// ── Tenants, permissions ────────────────────────────────────────────────────

test("tenant isolation: /alerts carries only the selected tenant, and tenant users send none", async () => {
  const s = openRealm(() => ok([], 0));
  await s.svc.listAlerts({ kind: "AI", openOnly: true });
  assert.equal(header(s.calls[0], "X-Tenant-Id"), undefined, "tenant user or Safe-Fare Admin with no tenant");
  s.tenant.setTenantSelection(T1);
  await s.svc.listAlerts({ kind: "AI", openOnly: true });
  assert.equal(header(s.calls[1], "X-Tenant-Id"), "1");
  assert.equal("tenantId" in s.calls[1].query, false, "a header only");
  const hook = read("features/drive-vision/hooks/use-polled-query.ts");
  assert.match(hook, /useSyncExternalStore\(subscribeTenantSelection/, "a tenant switch changes the key, so old-tenant data can't show");
});

test("Safe-Fare Admin with no tenant: /alerts is allowed across tenants, vendor History waits for a tenant", () => {
  const sfa = access(IDENTITIES.platformAdmin);
  assert.equal(p.canAccessScreen(sfa, "alerts"), true);
  assert.equal(p.hasTenantContext(sfa), false);
  assert.equal(p.hasTenantContext(access(IDENTITIES.platformAdmin, 1)), true);
  const page = read("components/drive-vision/alerts/alerts-page.tsx");
  assert.match(page, /const feedAllowed = feed !== null && hasTenantContext\(access\);/);
  assert.match(page, /useApiQuery\(feedAllowed \? `alerts:\$\{feed\}/);
  assert.match(page, /useApiQuery\(feedAllowed \? `alerts:count:\$\{other\}/);
});

test("without alarm.read: the screen is closed and the list has no key, so no request or 403 can happen", () => {
  const a = access({ ...IDENTITIES.tenantAdmin, permissions: ["device.read"] });
  assert.equal(p.canAccessScreen(a, "alerts"), false);
  assert.equal(p.canAccessPath(a, "/drive-vision/alerts"), false);
  const list = read("components/drive-vision/alerts/incidents.tsx");
  assert.match(list, /const canRead = canAccessScreen\(useAccess\(\), "alerts"\);/);
  assert.match(list, /usePolledQuery\(canRead \? `alerts:live/);
  assert.match(list, /usePolledQuery\(canRead && otherKind \?/);
});

test("notifications need no permission: any signed-in user polls", () => {
  assert.doesNotMatch(read("components/drive-vision/app-shell/notification-center.tsx"), /usePolledQuery\(\w+ \?/);
});

// ── Vendor APIs ─────────────────────────────────────────────────────────────

test("vendor APIs are never on a timer", () => {
  const list = read("components/drive-vision/alerts/incidents.tsx");
  assert.doesNotMatch(list, /fleetService|\/alarms/);
  const page = read("components/drive-vision/alerts/alerts-page.tsx");
  assert.doesNotMatch(page, /usePolledQuery/);
  assert.match(page, /const feed: AlarmKind \| null = view\.history && view\.kind !== "incidents" \? view\.kind : null;/, "live by default");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(SRC).filter((x) => /\.tsx?$/.test(x))) {
    const src = fs.readFileSync(f, "utf8");
    if (/usePolledQuery\(|createPoller\(|setInterval\(/.test(src)) assert.doesNotMatch(src, /aiAlarms|routineAlarms|\/alarms\//, path.relative(SRC, f));
  }
});

test("History is an explicit view and stays in the URL; Incidents has none", () => {
  const view = alertsModel.parseAlertsView(new URLSearchParams("kind=routine&source=history"));
  assert.equal(view.history, true);
  assert.equal(alertsModel.alertsSearch(view), "?kind=routine&source=history");
  assert.equal(alertsModel.parseAlertsView(new URLSearchParams("kind=incidents&source=history")).history, false);
  assert.equal(alertsModel.parseAlertsView(new URLSearchParams("")).history, false);
});

// ── Sessions and failures ───────────────────────────────────────────────────

/** A real poller on real timers' stand-in, polling through the real client. */
function clientPoller(s, run) {
  const clock = fakeEnv();
  const data = [];
  const errors = [];
  const poller = s.createPoller({ run, onData: (d) => data.push(d), onError: (e) => errors.push(e), shouldHalt: s.haltsPolling, env: clock.env });
  return { clock, data, errors, poller };
}
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const POLL_OK = { unreadTotal: 1, aiEvents: { unread: 1, items: [] }, alarm: { unread: 0, items: [] } };

test("401: the existing client refreshes and retries; the poll carries on with the new token", async () => {
  let refreshed = false;
  const s = openRealm((c) => {
    if (c.path === "/auth/refresh") return (refreshed = true), ok({ accessToken: "new.token.here", tokenType: "Bearer", expiresIn: 900, refreshToken: "r2", refreshExpiresIn: 1000 });
    return header(c, "Authorization") === "Bearer new.token.here" ? ok(POLL_OK) : fail(401, "UNAUTHENTICATED", "Token expired");
  });
  const h = clientPoller(s, (signal) => s.svc.pollNotifications(20, signal));
  h.poller.start();
  await settle();
  assert.equal(refreshed, true);
  assert.equal(h.data.length, 1);
  same(h.errors, []);
  assert.equal(h.clock.timers.size, 1, "carries on");
  h.poller.stop();
});

test("401 with a refused refresh: the session ends and polling stops, with no expired-token requests after it", async () => {
  const s = openRealm((c) => (c.path === "/auth/refresh" ? fail(401, "INVALID_TOKEN", "Refresh token expired") : fail(401, "UNAUTHENTICATED", "Token expired")));
  const h = clientPoller(s, (signal) => s.svc.pollNotifications(20, signal));
  let ended = 0;
  s.client.onSessionEnded(() => ended++);
  h.poller.start();
  await settle();
  assert.equal(ended, 1);
  const before = s.calls.length;
  h.clock.advance(60_000);
  await settle();
  assert.equal(s.calls.length, before);
  assert.equal(h.clock.timers.size, 0);
});

test("logout: session end stops the loop through onSessionEnded", async () => {
  const s = openRealm(() => ok(POLL_OK));
  const h = clientPoller(s, (signal) => s.svc.pollNotifications(20, signal));
  s.client.onSessionEnded(() => h.poller.stop());
  h.poller.start();
  await settle();
  s.client.endSession("signed-out");
  const before = s.calls.length;
  h.clock.advance(30_000);
  await settle();
  assert.equal(s.calls.length, before);
  assert.equal(h.clock.listeners.size, 0);
});

test("a 403 stops the loop instead of repeating a refused request", async () => {
  const s = openRealm(() => fail(403, "FORBIDDEN", "No alarm.read"));
  const h = clientPoller(s, (signal) => s.svc.listAlerts({ kind: "AI" }, signal));
  h.poller.start();
  await settle();
  h.clock.advance(60_000);
  await settle();
  assert.equal(s.calls.length, 1);
  assert.equal(h.errors[0].status, 403);
});

test("network errors and 5xx: earlier data is kept, and the next cycle recovers", async () => {
  let mode = "ok";
  const s = openRealm(() => {
    if (mode === "network") throw new TypeError("failed");
    return mode === "5xx" ? fail(503, "UPSTREAM", "Unavailable") : ok(POLL_OK);
  });
  const h = clientPoller(s, (signal) => s.svc.pollNotifications(20, signal));
  h.poller.start();
  await settle();
  for (const m of ["network", "5xx"]) {
    mode = m;
    h.clock.advance(5000);
    await settle();
  }
  assert.equal(h.data.length, 1, "nothing replaced what was delivered");
  assert.equal(h.errors.length, 2);
  mode = "ok";
  h.clock.advance(5000);
  await settle();
  assert.equal(h.data.length, 2);
  h.poller.stop();
});

test("the lists keep showing data on a failed poll, with a quiet note", () => {
  const list = read("components/drive-vision/alerts/incidents.tsx");
  assert.match(list, /\{listQ\.error && !listQ\.data \? \(/, "the error page is only for no data at all");
  assert.match(list, /listQ\.stale \?/);
  const nc = read("components/drive-vision/app-shell/notification-center.tsx");
  assert.match(nc, /pollQ\.stale \?/);
  assert.match(nc, /pollQ\.error && !pollQ\.data/);
});

test("no token in the polling code, and no sample data in it", () => {
  for (const f of ["features/drive-vision/hooks/poller.ts", "features/drive-vision/hooks/use-polled-query.ts", "components/drive-vision/app-shell/notification-center.tsx", "components/drive-vision/app-shell/notifications-model.ts", "components/drive-vision/alerts/incidents.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /accessToken|console\.|mock-data|seed/, f);
  }
});
