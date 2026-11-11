// Fleet Overview → Recent activity → the exact alert on Alerts & Events. MOCKED ONLY: stub services; the alert ids,
// device and names follow docs/contracts/polling-apis.txt (id 837 is the same record in /alarms/ai and /alerts).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/overview", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Event", "DocumentFragment", "navigator"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
for (const key of Object.getOwnPropertyNames(window)) {
  if (/^(HTML|SVG|Mouse|Keyboard|Pointer|Focus|Custom|UI|Input|NodeFilter|TreeWalker|Range)\w*$/.test(key)) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const pure = createRealm({ process: { env: {} }, URL, URLSearchParams, Intl, Date });
const links = () => pure.require("components/drive-vision/dashboard/activity-links");
const alertsModel = () => pure.require("components/drive-vision/alerts/alerts-model");
const realPolicy = pure.require("features/drive-vision/access/access-policy");

// Stub API: the live list (GET /alerts) and the detail (GET /alerts/{id}).
const ROWS = [
  { id: 836, alarmTime: "2026-11-11T09:00:00Z", deviceId: 1215, deviceName: "AP29Z0001", alarmTypeId: 208, alarmName: "Pedestrian Collision", kind: "AI", severity: 3, handlingStatus: "NEW" },
  { id: 837, alarmTime: "2026-11-11T09:50:54Z", deviceId: 1215, deviceName: "AP29Z0001", alarmTypeId: 208, alarmName: "Pedestrian Collision", kind: "AI", severity: 3, handlingStatus: "NEW" },
];
const calls = [];
const alertService = {
  listAlerts: async (q) => (calls.push(["list", q]), { items: ROWS, total: ROWS.length, page: 1 }),
  getAlert: async (id) => {
    calls.push(["detail", id]);
    const alert = ROWS.find((r) => r.id === id);
    // The error class of the realm the UI runs in, so isApiError recognises it.
    if (!alert) throw new (ui.require("features/drive-vision/api/errors").ApiError)({ kind: "http", status: 404, message: "Alert not found.", method: "GET", path: `/alerts/${id}` });
    return { alert, actions: [], evidence: [] };
  },
  getEvidence: async () => ({ items: [], total: 0 }),
};
const stubs = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "@/features/drive-vision/api/alert-service": { alertService },
  "@/features/drive-vision/access/use-access": { useAccess: () => ({}), useCan: () => true, useActionGate: () => ({ allowed: true, tenantBlocked: false }) },
  "@/features/drive-vision/access/access-policy": { ...realPolicy, canAccessScreen: () => true },
};
const modules = new Proxy(stubs, {
  getOwnPropertyDescriptor(target, spec) {
    if (Object.hasOwn(target, spec)) return Object.getOwnPropertyDescriptor(target, spec);
    if (typeof spec === "string" && !spec.startsWith(".") && !spec.startsWith("@/")) {
      target[spec] = require(spec);
      return Object.getOwnPropertyDescriptor(target, spec);
    }
    return undefined;
  },
});
const ui = createRealm({ window, document: window.document, HTMLElement: window.HTMLElement, navigator: window.navigator, ResizeObserver: globalThis.ResizeObserver, Intl, Date, URL, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, process: { env: { NODE_ENV: "test" } }, console: { ...console, error() {}, warn() {} } }, modules);

const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const roots = [];
async function render(el) {
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
test.afterEach(async () => {
  while (roots.length) {
    const r = roots.pop();
    await act(async () => r.unmount());
  }
  window.document.body.innerHTML = "";
  calls.length = 0;
});

// ── Link ─────────────────────────────────────────────────────────────────────

test("RA link: AI event → AI Events tab, routine alarm → Routine alarms tab; the alert's own id, the vehicle and the range are in the URL", () => {
  const { activityAlertHref } = links();
  assert.equal(activityAlertHref({ id: 837, kind: "ai", deviceId: 1215 }, "7d"), "/drive-vision/alerts?device=1215&alarm=837", "AI is the page's default tab");
  assert.equal(activityAlertHref({ id: 912, kind: "routine", deviceId: 1215 }, "today"), "/drive-vision/alerts?kind=routine&range=today&device=1215&alarm=912");
  const ai = alertsModel().parseAlertsView(new URL("http://x" + activityAlertHref({ id: 837, kind: "ai", deviceId: 1215 }, "30d")).searchParams);
  same(ai, { kind: "ai", range: "30d", deviceId: 1215, typeId: null, page: 1, alarmId: 837, history: false });
  const routine = alertsModel().parseAlertsView(new URL("http://x" + activityAlertHref({ id: 912, kind: "routine", deviceId: 7 }, "7d")).searchParams);
  same([routine.kind, routine.alarmId, routine.deviceId, routine.history], ["routine", 912, 7, false], "the Live list, whose drawer opens the id with GET /alerts/{id}");
});

test("RA link: no usable id → no link (never matched by title or vehicle); a missing device just isn't filtered", () => {
  const { activityAlertHref } = links();
  for (const id of [undefined, null, 0, -1, 1.5, "837", Number.NaN]) assert.equal(activityAlertHref({ id, kind: "ai", deviceId: 1215 }, "7d"), null, String(id));
  assert.equal(activityAlertHref({ id: 837, kind: "ai" }, "7d"), "/drive-vision/alerts?alarm=837");
  assert.equal(activityAlertHref({ id: 837, kind: "other", deviceId: 1 }, "7d"), null);
  assert.doesNotMatch(read("components/drive-vision/dashboard/activity-links.ts"), /alarmName|deviceName|terminalNo/, "only the id identifies the alert");
});

test("RA access: the Overview only links when the user can open Alerts & Events (existing reachableHref)", () => {
  const ov = read("components/drive-vision/dashboard/fleet-overview.tsx");
  assert.match(ov, /<LiveActivityList alarms=\{alarms\} now=\{now\} hrefFor=\{\(a\) => reachableHref\(access, activityAlertHref\(a, rangeKey\)\)\} \/>/);
  assert.match(read("components/drive-vision/vehicles/vehicle-detail.tsx"), /<LiveActivityList alarms=\{alarms\} now=\{now\} \/>/, "the vehicle page's list is unchanged (no links)");
});

// ── Recent activity rows ─────────────────────────────────────────────────────

const ACTIVITY = [
  { id: 837, kind: "ai", deviceId: 1215, deviceName: "AP29Z0001", alarmTypeId: 208, alarmName: "Pedestrian Collision", speedKmh: 42, handlingStatus: "NEW", alarmTime: "2026-11-11T04:20:54Z" },
  { id: 912, kind: "routine", deviceId: 1215, deviceName: "AP29Z0001", alarmTypeId: 1, alarmName: "Overspeed", handlingStatus: "NEW", alarmTime: "2026-11-11T04:00:00Z" },
  { kind: "ai", deviceId: 1215, deviceName: "AP29Z0001", alarmName: "No id", alarmTime: "2026-11-11T03:00:00Z" },
];
const NOW = new Date("2026-11-11T05:20:54Z");
const list = (props) => React.createElement(ui.require("components/drive-vision/dashboard/live-activity-list").LiveActivityList, { alarms: ACTIVITY, now: NOW, ...props });

test("RA rows: each whole row is one link to its alert, with the same content (title, vehicle, speed, type, NEW, relative time)", async () => {
  const href = (a) => links().activityAlertHref(a, "7d");
  const host = await render(list({ hrefFor: href }));
  const rows = [...host.querySelectorAll("li")];
  assert.equal(rows.length, 3);
  const a = rows[0].querySelector("a[data-testid='activity-link']");
  assert.equal(a.getAttribute("href"), "/drive-vision/alerts?device=1215&alarm=837");
  assert.equal(rows[1].querySelector("a").getAttribute("href"), "/drive-vision/alerts?kind=routine&device=1215&alarm=912");
  assert.equal(rows[0].children.length, 1, "the link is the whole row");
  same([a.textContent.includes("Pedestrian Collision"), a.textContent.includes("AP29Z0001 · 42 km/h · AI event"), a.textContent.includes("NEW"), a.textContent.includes("1 h ago")], [true, true, true, true]);
  assert.ok(rows[1].textContent.includes("AP29Z0001 · Routine alarm"));
  assert.equal(rows[2].querySelector("a"), null, "a record without an id stays a plain row");
});

test("RA rows: keyboard and pointer — a real link (Tab + Enter), pointer cursor, subtle hover and a visible focus ring; layout classes kept", async () => {
  const host = await render(list({ hrefFor: (a) => links().activityAlertHref(a, "7d") }));
  const a = host.querySelector("a[data-testid='activity-link']");
  assert.equal(a.tagName, "A", "native link: focusable, Enter activates, Back works (Next Link pushes a history entry)");
  assert.equal(a.getAttribute("tabindex"), null, "no tabindex hacks");
  for (const cls of ["cursor-pointer", "hover:bg-surface-muted", "focus-visible:ring-[3px]", "focus-visible:ring-brand/30", "focus-visible:outline-none", "flex", "items-center", "gap-3", "rounded-xl", "px-2", "py-2.5"]) assert.ok(a.classList.contains(cls), cls);
  assert.match(a.getAttribute("title"), /Open this AI event in Alerts & Events/);
  const plain = await render(list({}));
  assert.equal(plain.querySelectorAll("a").length, 0, "without hrefFor nothing is clickable (vehicle page)");
  assert.equal(plain.querySelector("li > div").className, "flex items-center gap-3 rounded-xl px-2 py-2.5", "same row styling as before");
});

// ── Destination: Alerts & Events live list + drawer ──────────────────────────

const VIEW = (patch = {}) => ({ kind: "ai", range: "7d", deviceId: 1215, typeId: null, page: 1, alarmId: 837, history: false, ...patch });
function incidents(view, onOpen = () => {}) {
  const { IncidentsList } = ui.require("components/drive-vision/alerts/incidents");
  return React.createElement(IncidentsList, { view, now: NOW, typeById: new Map(), alertKind: view.kind === "routine" ? "ROUTINE" : "AI", refreshRef: { current: null }, onPage() {}, onOpen, onTotal() {} });
}

test("RA destination: the exact alert (id 837, not its same-titled neighbour 836) is highlighted, scrolled into view and opened by GET /alerts/837; the vehicle filter is applied", async () => {
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function (opts) {
    scrolled.push([this.getAttribute("data-row-id"), opts]);
  };
  await render(incidents(VIEW()));
  await settle(10);
  const active = [...window.document.querySelectorAll("tr[data-active='true']")].map((r) => r.getAttribute("data-row-id"));
  same(active, ["837"], "only the linked id");
  same(scrolled, [["837", { block: "nearest" }]], "scrolled once");
  assert.ok(calls.some((c) => c[0] === "detail" && c[1] === 837), "detail by id");
  const list = calls.find((c) => c[0] === "list")[1];
  same([list.kind, list.deviceIds], ["AI", [1215]], "AI tab, vehicle kept");
  await settle(4);
  assert.equal(scrolled.length, 1, "polling doesn't scroll again");
  delete window.HTMLElement.prototype.scrollIntoView;
});

test("RA destination: routine alarm opens on the Routine list request", async () => {
  await render(incidents(VIEW({ kind: "routine", alarmId: 836 })));
  await settle(8);
  same(calls.find((c) => c[0] === "list")[1].kind, "ROUTINE");
  assert.ok(calls.some((c) => c[0] === "detail" && c[1] === 836));
});

test("RA destination: a deleted / unavailable alert shows the server's message in the drawer and highlights nothing — never another alert", async () => {
  const host = await render(incidents(VIEW({ alarmId: 999 })));
  await settle(10);
  assert.ok(calls.some((c) => c[0] === "detail" && c[1] === 999));
  same([...host.ownerDocument.querySelectorAll("tr[data-active='true']")].length, 0);
  assert.ok(window.document.body.textContent.includes("Alert not found."), "the 404 is explained");
  assert.ok(!window.document.body.textContent.includes("Overspeed"));
});

test("RA browser navigation: Overview pushes (Back returns), Alerts & Events replaces (no extra entries, no redirect loop); the URL alone restores the view on refresh", () => {
  assert.match(read("components/drive-vision/dashboard/live-activity-list.tsx"), /import Link from "next\/link";[\s\S]*<Link\s+href=\{href\}/, "Next Link: a pushed history entry");
  const page = read("components/drive-vision/alerts/alerts-page.tsx");
  assert.match(page, /const view = useMemo\(\(\) => parseAlertsView\(params\), \[params\]\);/, "refresh: the view is read from the URL");
  assert.match(page, /router\.replace\(`\/drive-vision\/alerts\$\{alertsSearch\(\{ \.\.\.view, \.\.\.patch \}\)\}`/, "in-page changes replace");
  assert.doesNotMatch(page, /router\.push|redirect\(/, "no redirects from the destination");
  assert.match(read("components/drive-vision/alerts/incidents.tsx"), /<AlertWorkflowDrawer id=\{view\.alarmId\}/, "the existing drawer, by id");
});
