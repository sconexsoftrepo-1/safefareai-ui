// Vehicle / Tyre Maintenance in the UI: the Vehicles drawer tabs, the Notifications Maintenance tab, the browser
// service and the pure model. MOCKED / SYNTHETIC ONLY: identities and payloads are synthetic (payload shapes from the
// integration brief of 2026-11-10); every request goes to a stub fetch, so none of this proves live behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

// ── jsdom + React ───────────────────────────────────────────────────────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/vehicle-registry", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event", "DocumentFragment", "NodeFilter", "HTMLFormElement", "HTMLSelectElement", "HTMLInputElement"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.ResizeObserver = globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

// ── Stub backend (BFF on http://api.test, Python API on https://py.test/safe-fare-python) ───

let requests = [];
let handlers = {};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const envelope = (data, total = null) => json(200, { code: 200, msg: "Success", data, total, extend: null });
const headerOf = (init, name) => Object.entries(init.headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
async function stubFetch(url, init = {}) {
  const u = new URL(String(url), "http://localhost:3000");
  const py = u.host === "py.test";
  const pyPath = u.pathname.replace(/^\/safe-fare-python/, "");
  const req = { method: init.method ?? "GET", host: u.host, path: py ? pyPath : u.pathname, route: py ? pyPath : u.pathname.replace(/^\/api\/v1/, ""), query: Object.fromEntries(u.searchParams), tenant: headerOf(init, "x-tenant-id"), auth: headerOf(init, "authorization"), credentials: init.credentials, body: init.body ? JSON.parse(init.body) : undefined };
  requests.push(req);
  for (const [pattern, fn] of Object.entries(handlers)) if (new RegExp(`^${pattern}$`).test(`${req.method} ${req.route}`)) return fn(req);
  // The write guard's BFF lookup: both demo vehicles are registered in the tenant unless a test says otherwise.
  if (!py && req.route === "/vehicles") return envelope([{ id: 501, vehicleNumber: "AP31Z0044" }, { id: 502, vehicleNumber: "TS09AB1234" }], 2);
  if (req.route === "/notifications/poll") return envelope({ unreadTotal: 2, aiEvents: { unread: 1, items: [{ id: 1, type: "AI_EVENT", title: "Fatigue detected", read: false, createdAt: "2026-11-10T05:00:00Z" }] }, alarm: { unread: 1, items: [{ id: 2, type: "ALARM", title: "SOS", read: false, createdAt: "2026-11-10T05:01:00Z" }] } });
  if (req.route === "/notifications") return envelope([{ id: 3, type: "DISPATCH", title: "Dispatch assigned", read: true, createdAt: "2026-11-10T04:00:00Z" }], 1);
  return envelope({});
}
const maintenanceRequests = () => requests.filter((r) => r.host === "py.test");

// ── Module stubs ────────────────────────────────────────────────────────────

const motionTags = new Map();
const MOTION_ONLY = new Set(["initial", "animate", "exit", "transition", "variants", "whileHover", "whileTap", "layout", "layoutId"]);
const motion = new Proxy({}, { get: (_, tag) => (motionTags.has(tag) || motionTags.set(tag, React.forwardRef((props, ref) => React.createElement(tag, { ...Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY.has(k))), ref }))), motionTags.get(tag)) });

let toasts = [];
let pushes = [];
let currentAccess = null;
let currentParams = new URLSearchParams();
let ui;
let pure;
function buildRealms() {
  const storage = new MemoryStorage();
  const session = JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 3_600_000, refreshToken: "r", refreshExpiresAt: null });
  storage.setItem("safefare:session:v1", session);
  window.sessionStorage.setItem("safefare:session:v1", session);
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const record = (kind) => (title, opts) => toasts.push({ kind, title, description: opts?.description });
  const modules = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "motion/react": { motion, AnimatePresence: ({ children }) => children, useReducedMotion: () => true },
    "radix-ui": require("radix-ui"),
    "lucide-react": require("lucide-react"),
    clsx: require("clsx"),
    "tailwind-merge": require("tailwind-merge"),
    "class-variance-authority": require("class-variance-authority"),
    "next/navigation": { useSearchParams: () => currentParams, usePathname: () => "/drive-vision/vehicle-registry", useRouter: () => ({ push: (h) => pushes.push(h), replace() {}, back() {} }) },
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
    sonner: { toast: Object.assign(record("message"), { success: record("success"), error: record("error"), info: record("info"), warning: record("warning") }), Toaster: () => null },
    "next-themes": { useTheme: () => ({ theme: "light" }) },
    "@/features/drive-vision/access/use-access": {
      useAccess: () => currentAccess,
      useActionGate: (action) => {
        const block = ui.require("features/drive-vision/access/access-policy").actionBlock(currentAccess, action);
        return { allowed: block === null, tenantBlocked: block === "tenant" };
      },
      useCan: () => false,
    },
  };
  const globals = {
    console: sink,
    fetch: (...a) => stubFetch(...a),
    AbortController,
    AbortSignal,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    DOMException,
    sessionStorage: storage,
    localStorage: new MemoryStorage(),
    navigator: { locks: createLockManager() },
    performance,
    crypto: globalThis.crypto,
    atob,
    btoa,
    structuredClone,
    queueMicrotask,
    // The demo tenant is the synthetic Fleet Owner's tenant (10), so the Python features are shown.
    process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test", NEXT_PUBLIC_PYTHON_API_BASE_URL: "https://py.test/safe-fare-python", NEXT_PUBLIC_DEMO_TENANT_ID: "10" } },
  };
  ui = createRealm({ ...globals, window, document: window.document, HTMLElement: window.HTMLElement }, modules);
  pure = createRealm(globals, modules);
}
buildRealms();

const m = () => pure.require("features/drive-vision/api/maintenance");
const ma = () => pure.require("features/drive-vision/access/maintenance-access");
const accessFor = (raw, selectedTenantId = null) => {
  const p = ui.require("features/drive-vision/access/access-policy");
  const idm = ui.require("features/drive-vision/access/identity");
  return p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });
};
const FLEET_OWNER = { ...IDENTITIES.fleetOwner, roleCode: "FLEET_OWNER", permissions: [...IDENTITIES.fleetOwner.permissions, "vehicle.read"] };

const roots = [];
test.afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => root.unmount());
  }
  window.document.body.innerHTML = "";
  requests = [];
  handlers = {};
  toasts = [];
  pushes = [];
  currentParams = new URLSearchParams();
  ui.require("features/drive-vision/api/tenant-context").setTenantSelection(null);
  ui.require("features/drive-vision/api/maintenance-service").resetMaintenanceFeedCache();
});

/** Unmounts everything rendered so far (portals included) before rendering again in the same test. */
async function reset() {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => root.unmount());
  }
  window.document.body.innerHTML = "";
  requests = [];
}

const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const text = (el = window.document.body) => el.textContent.replace(/\s+/g, " ");
const click = async (el) => {
  assert.ok(el, "element to click");
  await act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
};
const buttonByText = (label, root = window.document) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(label));
const type = async (input, value) => {
  const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await settle(2);
};
async function render(element) {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  try {
    await act(async () => root.render(element));
    await settle();
  } catch (e) {
    // React reports render failures as an AggregateError; surface the first real cause.
    throw e?.errors?.[0] ?? e;
  }
  return host;
}

// ── Synthetic payloads (shapes from the brief) ──────────────────────────────

const REMINDERS = [
  { type: "reminder_15d", days_before: 15, label: "15 days before", date: "2026-11-25" },
  { type: "reminder_7d", days_before: 7, label: "1 week before", date: "2026-12-03" },
  { type: "action_3d", days_before: 3, label: "3 days before - completion check", date: "2026-12-07" },
  { type: "action_2d", days_before: 2, label: "2 days before - completion check", date: "2026-12-08" },
  { type: "action_1d", days_before: 1, label: "1 day before - final completion check", date: "2026-12-09" },
  { type: "due_today", days_before: 0, label: "Maintenance due today", date: "2026-12-10" },
];
const SCHEDULE = {
  success: true,
  message: "Maintenance schedule retrieved successfully",
  data: {
    tenant_id: 10, vehicle_number: "AP31Z0044", device_id: 1215, driver_id: 1204, driver_name: "Ravi Kumar", previous_vehicle_maintenance_date: "2026-11-10", maintenance_time_window: 30,
    expected_vehicle_maintenance_date: "2026-12-10", postponed_date: null, postponed_reason: null, postponed_by: null, postponed_at: null, due_date: "2026-12-10", done_date: null, status: "pending",
    reason: "Routine check", created_at: "2026-11-10T07:28:35", updated_at: "2026-11-10T07:28:35", days_until_due: 30, reminder_schedule: REMINDERS,
  },
};
const TYRE = { tenant_id: 10, device_id: 1215, vehicle_number: "AP31Z0044", tyre_life_limit_km: 300, tyre_change_odometer_km: 266.769, current_distance_km: 266.769, usage_percentage: 88.92, remaining_km: 33.231, maintenance_status: "CRITICAL_85", last_tyre_change_date: "2026-11-09T22:36:42.315000", last_limit_reminder_at: null };
// Vehicle maintenance alerts response as sampled 2026-11-11 (GET /api/vehicle-maintenance/alerts?vehicle_number=AP31Z0044).
const OVERDUE = { vehicle_number: "AP31Z0044", kind: "overdue", title: "Vehicle maintenance reminder", message: "Maintenance for vehicle AP31Z0044 is overdue by 2 days (was due 09 Nov 2026). Please complete it, or postpone the date and give a reason.", due_date: "2026-11-09", alert_date: "2026-11-11", created_at: "2026-11-11T04:15:59" };
const vehicleAlerts = (items = [OVERDUE], extra = {}) => ({ success: true, message: "Alerts retrieved successfully", data: { vehicle_number: "AP31Z0044", driver_id: 1204, driver_name: "Ravi Kumar", items, total_alerts: items.length, ...extra } });
const OVERDUE_KEY = "vehicle:AP31Z0044:overdue:2026-11-09:2026-11-11:2026-11-11T04:15:59";
const TYRE_ALERT = { id: 115, tenant_id: 10, device_id: 1215, vehicle_number: "AP31Z0044", alert_level: 2, maintenance_status: "CRITICAL_85", usage_percentage: 88.92, current_distance_km: 266.769, limit_km: 300, message: "Vehicle AP31Z0044 has used 88.92% of its tyre life (267 of 300 km). Status: CRITICAL_85.", is_reminder: false, created_at: "2026-11-09T22:44:48.252063" };
/** FastAPI's "no record" 404 (its own detail); a generic "Not Found" would mean the route isn't deployed. */
const notFound = (message) => json(404, { detail: message });

// ── Pure model ──────────────────────────────────────────────────────────────

test("MU dates: plain dates are formatted from their own digits (no time-zone shift); unzoned timestamps shown as sent", () => {
  assert.equal(m().formatPlainDate("2026-12-10"), "10 Dec 2026");
  assert.equal(m().formatPlainDate("2026-01-01"), "01 Jan 2026");
  assert.equal(m().formatPlainDate("2026-02-30"), "2026-02-30", "not a calendar date → as sent");
  assert.doesNotMatch(read("features/drive-vision/api/maintenance.ts").match(/export function formatPlainDate[\s\S]*?\n}/)[0], /new Date|Date\.parse/);
  same(m().readServerTimestamp("2026-11-09T22:36:42.315000"), { text: "09 Nov 2026, 22:36", zoned: false });
  same(m().readServerTimestamp("2026-11-09T22:36:42Z"), { text: "", zoned: true, iso: "2026-11-09T22:36:42.000Z" });
  assert.ok(m().isZonedDateTime("2026-11-10T10:30:00Z") && !m().isZonedDateTime("2026-11-10T10:30:00"));
});

test("MU parsing: the documented schedule and tyre shapes, nothing invented; non-documented shapes are failures", () => {
  const s = m().parseScheduleResponse(SCHEDULE);
  assert.ok(s.ok);
  same([s.value.data.days_until_due, s.value.data.expected_vehicle_maintenance_date, s.value.data.reminder_schedule.length], [30, "2026-12-10", 6]);
  same(m().parseScheduleResponse({ success: false, message: "No schedule" }), { ok: false, reason: "unsuccessful", message: "No schedule" });
  same(m().parseScheduleResponse({ data: {} }), { ok: false, reason: "shape" });
  const t = m().parseTyreAlerts({ count: 1, items: [TYRE_ALERT] });
  same([t.ok, t.value.items[0].id, t.value.items[0].message], [true, 115, TYRE_ALERT.message]);
  same(m().parseTyreAlerts([TYRE_ALERT]), { ok: false, reason: "shape" });
  same(m().parseTyreRecord(TYRE).value.usage_percentage, 88.92);
});

test("MU notifications: normalized with source + original id, backend message kept, newest first by actual timestamps", () => {
  const tyre = m().fromTyreAlert(m().parseTyreAlerts({ count: 1, items: [TYRE_ALERT] }).value.items[0]);
  same([tyre.id, tyre.source, tyre.sourceId, tyre.title, tyre.message, tyre.tone, tyre.severityLabel, tyre.isReminder], ["tyre:115", "TYRE_MAINTENANCE", 115, "CRITICAL_85", TYRE_ALERT.message, "danger", "Level 2", false]);
  const v = m().fromVehicleAlert({ vehicle_number: null, kind: "action_3d", title: null, message: null, due_date: "2026-12-10", alert_date: "2026-12-07", created_at: "2026-12-07T09:00:00" }, "TS09AB1234");
  same([v.id, v.vehicleNumber, v.message, v.tone, v.title, v.sourceId], ["vehicle:TS09AB1234:action_3d:2026-12-10:2026-12-07:2026-12-07T09:00:00", "TS09AB1234", null, "warning", "Action 3d", null]);
  const sorted = m().sortNotifications([tyre, v, { ...tyre, id: "tyre:1", createdAt: null }, tyre]);
  same(sorted.map((n) => n.id), [v.id, "tyre:115", "tyre:1"], "newest first, duplicates dropped, undated last");
  same(["NORMAL", "WARNING_70", "CRITICAL_85", "SOMETHING_NEW"].map(m().tyreStatusTone), ["success", "warning", "danger", "neutral"]);
});

test("MU vehicle alerts: data.items, total_alerts, vehicle and driver from data; one, several or zero items", () => {
  const one = m().parseVehicleAlerts(vehicleAlerts());
  assert.ok(one.ok);
  same([one.value.vehicle_number, one.value.driver_id, one.value.driver_name, one.value.total_alerts, one.value.items.length], ["AP31Z0044", 1204, "Ravi Kumar", 1, 1]);
  same(one.value.items[0], OVERDUE, "kind, title, message, due_date, alert_date and created_at kept as sent");
  const n = m().vehicleAlertNotifications(one.value, "AP31Z0044");
  same(
    [n[0].id, n[0].title, n[0].message, n[0].kind, n[0].kindLabel, n[0].tone, n[0].dueDate, n[0].alertDate, n[0].createdAt, n[0].driverName, n[0].driverId, n[0].sourceId],
    [OVERDUE_KEY, "Vehicle maintenance reminder", OVERDUE.message, "overdue", "Overdue", "danger", "2026-11-09", "2026-11-11", "2026-11-11T04:15:59", "Ravi Kumar", 1204, null]
  );
  assert.ok(!("id" in one.value.items[0]), "no alert id is invented");

  const older = { ...OVERDUE, kind: "action_1d", title: "Vehicle maintenance reminder", due_date: "2026-11-09", alert_date: "2026-11-08", created_at: "2026-11-08T04:15:00" };
  const odd = { ...OVERDUE, kind: "something_new", alert_date: "2026-11-10", created_at: "2026-11-10T04:15:00" };
  const many = m().parseVehicleAlerts(vehicleAlerts([older, OVERDUE, odd], { total_alerts: 3 }));
  const list = m().sortNotifications(m().vehicleAlertNotifications(many.value, "AP31Z0044"));
  same(list.map((x) => x.kind), ["overdue", "something_new", "action_1d"], "every item, newest first");
  same(list.map((x) => x.tone), ["danger", "neutral", "warning"], "an unknown kind is neutral, never a crash");
  same(list[1].kindLabel, "Something new");
  assert.equal(new Set(list.map((x) => x.id)).size, 3, "composite keys are distinct");

  const none = m().parseVehicleAlerts(vehicleAlerts([], { total_alerts: 0 }));
  same([none.ok, none.value.items.length, none.value.total_alerts], [true, 0, 0]);
  same(m().parseVehicleAlerts({ success: true, message: "ok", data: { vehicle_number: "AP31Z0044", items: [OVERDUE] } }).value.total_alerts, 1, "missing total_alerts → items.length");

  const noDriver = m().parseVehicleAlerts({ success: true, message: "ok", data: { vehicle_number: "AP31Z0044", driver_id: null, items: [{ ...OVERDUE, vehicle_number: undefined }], total_alerts: 1 } });
  const nd = m().vehicleAlertNotifications(noDriver.value, "XX00XX0000")[0];
  same([nd.driverName, nd.driverId, nd.vehicleNumber], [null, null, "AP31Z0044"], "missing driver → null; vehicle from data before the requested one");

  for (const bad of [{ success: true, data: [] }, { success: true, data: { items: "x" } }, { data: { items: [] } }]) same(m().parseVehicleAlerts(bad).ok, false, JSON.stringify(bad));
  same(m().parseVehicleAlerts({ success: false, message: "No schedule" }), { ok: false, reason: "unsuccessful", message: "No schedule" });
});

test("MU roles: Safe-Fare Admin (platform) and Fleet Owner only; drivers, viewers, tenant ADMINs excluded", () => {
  const role = (raw, t) => ma().maintenanceRole(accessFor(raw, t));
  same([role(IDENTITIES.platformAdmin), role(FLEET_OWNER), role({ ...FLEET_OWNER, roleCode: "fleet owner" }), role(IDENTITIES.driver), role(IDENTITIES.viewer), role(IDENTITIES.tenantAdmin), role(IDENTITIES.fleetOwner)], ["safe-fare-admin", "fleet-owner", "fleet-owner", null, null, null, null]);
  same(ma().maintenanceTenant(accessFor(IDENTITIES.platformAdmin)), { ok: false, reason: "tenant_required" });
  same(ma().maintenanceTenant(accessFor(IDENTITIES.platformAdmin, 42)), { ok: true, tenantId: 42 });
  same(ma().maintenanceTenant(accessFor(FLEET_OWNER, 42)), { ok: true, tenantId: 10 }, "a Fleet Owner's selection is ignored: tenant from the token");
  const acts = ma().maintenanceActions(accessFor(FLEET_OWNER));
  same([acts.createSchedule, acts.registerTyres, acts.postpone, acts.completeMaintenance], [true, true, false, false]);
});

// ── Browser service ─────────────────────────────────────────────────────────

test("MU service: direct Python calls for the demo tenant only; X-Tenant-ID on tyre calls only; no token or cookies", async () => {
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: 0, items: [] });
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => json(200, SCHEDULE);
  const svc = ui.require("features/drive-vision/api/maintenance-service").maintenanceService;
  await svc.tyreAlerts(10, { limit: 50 });
  await svc.getSchedule(10, "AP31Z0044");
  same(requests.map((r) => [r.host, r.path, r.query, r.tenant, r.auth, r.credentials]), [
    ["py.test", "/api/v1/tyre-maintenance/alerts", { limit: "50" }, "10", undefined, "omit"],
    ["py.test", "/api/vehicle-maintenance/AP31Z0044", {}, undefined, undefined, "omit"],
  ]);
  requests = [];
  await assert.rejects(svc.tyreAlerts(42, {}), (e) => e.status === 403 && e.errorCode === "not_demo_tenant" && /demo tenant \(tenant 10\)/.test(e.message));
  await assert.rejects(svc.getSchedule(null, "AP31Z0044"), (e) => e.errorCode === "no_tenant");
  same(requests, [], "nothing is sent outside the demo tenant");
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => json(403, { detail: "Only fleet owners" });
  await assert.rejects(svc.getSchedule(10, "AP31Z0044"), (e) => e.status === 403 && /^Only fleet owners \(HTTP 403\)/.test(e.message));
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => json(200, { ...SCHEDULE, data: { ...SCHEDULE.data, tenant_id: 3 } });
  await assert.rejects(svc.getSchedule(10, "AP31Z0044"), (e) => e.errorCode === "tenant_mismatch", "another tenant's data is withheld");
});

// ── Vehicle Maintenance tab ─────────────────────────────────────────────────

const panels = () => ui.require("components/drive-vision/vehicle-registry/vehicle-maintenance-panels");

test("MU vehicle tab: every schedule field and the reminder schedule, as the server sent them", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => json(200, SCHEDULE);
  const host = await render(React.createElement(panels().VehicleMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canCreate: true }));
  const t = text(host);
  for (const s of ["Pending", "AP31Z0044", "Ravi Kumar", "10 Nov 2026", "30 days", "10 Dec 2026", "Routine check"]) assert.ok(t.includes(s), s);
  assert.equal($('[data-testid="days-until-due"]').textContent, "30 days", "server's days_until_due, not recomputed");
  same($$("[data-reminder]").map((li) => li.getAttribute("data-reminder")), REMINDERS.map((r) => r.type));
  assert.ok(text($('[data-reminder="due_today"]')).includes("Maintenance due today") && text($('[data-reminder="due_today"]')).includes("10 Dec 2026"));
  assert.ok(!$('[data-testid="schedule-postponed"]') && !$('[data-testid="schedule-done"]'), "no postponement / completion when null");
  assert.ok(!buttonByText("Postpone") && !buttonByText("Mark done"), "driver-only actions aren't offered");
  same(maintenanceRequests().map((r) => r.path), ["/api/vehicle-maintenance/AP31Z0044"]);
});

test("MU vehicle tab: postponement and completion are shown when present", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => json(200, { ...SCHEDULE, data: { ...SCHEDULE.data, postponed_date: "2026-12-15", postponed_reason: "Vehicle unavailable", postponed_at: "2026-12-05T08:00:00", done_date: "2026-12-14" } });
  await render(React.createElement(panels().VehicleMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canCreate: false }));
  assert.ok(text($('[data-testid="schedule-postponed"]')).includes("15 Dec 2026") && text($('[data-testid="schedule-postponed"]')).includes("Vehicle unavailable"));
  assert.ok(text($('[data-testid="schedule-done"]')).includes("14 Dec 2026"));
  assert.ok(!$('[data-testid="create-schedule-open"]'), "no Create without permission");
});

test("MU vehicle tab: no schedule → empty state with Create; Create sends exactly the documented body and reloads", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  let created = false;
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => (created ? json(200, SCHEDULE) : notFound("Maintenance schedule not found"));
  handlers["POST /api/vehicle-maintenance"] = () => ((created = true), json(201, SCHEDULE));
  await render(React.createElement(panels().VehicleMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canCreate: true }));
  assert.ok(text().includes("No maintenance schedule"));
  await click($('[data-testid="create-schedule-open"]'));
  // Empty date is refused locally: nothing sent.
  await act(async () => $('[data-testid="create-schedule-form"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  await settle();
  assert.equal(requests.filter((r) => r.method === "POST").length, 0);
  await type($("#ms-previous"), "2026-11-10");
  await type($("#ms-reason"), "  Routine vehicle maintenance ");
  await act(async () => $('[data-testid="create-schedule-form"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  await settle();
  const posts = requests.filter((r) => r.method === "POST");
  same(posts.map((r) => [r.path, r.body]), [["/api/vehicle-maintenance", { vehicle_number: "AP31Z0044", previous_vehicle_maintenance_date: "2026-11-10", reason: "Routine vehicle maintenance" }]]);
  assert.ok(text().includes("Ravi Kumar"), "the schedule is re-read after creation");
  assert.ok(toasts.some((t) => t.kind === "success"));
});

test("MU vehicle tab: a 403 on create (Admin) is shown as the backend sent it; an error is never an empty record", async () => {
  currentAccess = accessFor(IDENTITIES.platformAdmin, 10);
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => notFound("not found");
  handlers["POST /api/vehicle-maintenance"] = () => json(403, { detail: "Only fleet owners can create maintenance schedules" });
  await render(React.createElement(panels().VehicleMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canCreate: true }));
  await click($('[data-testid="create-schedule-open"]'));
  await type($("#ms-previous"), "2026-11-10");
  await act(async () => $('[data-testid="create-schedule-form"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  await settle();
  assert.equal($('[data-testid="create-schedule-error"]').textContent, "Only fleet owners can create maintenance schedules (HTTP 403).", "the backend's message, with its status");
  assert.ok(!toasts.some((t) => t.kind === "success"));

  for (const [status, body, expect] of [
    [404, { detail: "Not Found" }, "doesn't have this endpoint"],
    [500, {}, "ran into a problem. Please try again shortly (HTTP 500)"],
    [502, "<!DOCTYPE html><html><title>502 - Web server received an invalid response</title></html>", "can't be reached right now. Please try again shortly (HTTP 502, the gateway's HTML error page"],
    [504, {}, "took too long"],
  ]) {
    await reset();
    handlers["GET /api/vehicle-maintenance/TS09AB1234"] = () => (typeof body === "string" ? new Response(body, { status, headers: { "Content-Type": "text/html" } }) : json(status, body));
    await render(React.createElement(panels().VehicleMaintenanceTab, { tenantId: 10, vehicleNumber: "TS09AB1234", canCreate: true }));
    assert.ok(!text().includes("No maintenance schedule"), `${status} is not "no schedule"`);
    assert.ok(text().includes(expect), `${status}: ${text().slice(0, 200)}`);
    requests = [];
  }
});

// ── Tyre Maintenance tab ────────────────────────────────────────────────────

test("MU tyre tab: usage, remaining km, status tone and the latest tyre alerts for this vehicle", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  handlers["GET /api/v1/tyre-maintenance/vehicle/AP31Z0044"] = () => json(200, TYRE);
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: 1, items: [TYRE_ALERT] });
  await render(React.createElement(panels().TyreMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canWrite: true }));
  assert.equal($('[data-testid="tyre-usage"]').textContent, "88.92% used");
  assert.equal($('[data-testid="tyre-remaining"]').textContent, "33.231 km remaining");
  assert.equal($('[data-testid="tyre-status"]').textContent, "CRITICAL_85");
  assert.match($('[data-testid="tyre-status"]').closest("span[class*='bg-']").className, /danger/);
  assert.equal($('[data-testid="tyre-progress"]').getAttribute("aria-valuenow"), "88.92");
  for (const s of ["300 km", "266.769 km", "09 Nov 2026, 22:36"]) assert.ok(text().includes(s), s);
  assert.ok(text().includes(TYRE_ALERT.message), "backend message as the alert description");
  same(requests.find((r) => r.path === "/api/v1/tyre-maintenance/alerts").query, { vehicle_number: "AP31Z0044", limit: "5" });
});

test("MU tyre tab: register and complete replacement send the documented bodies, then reload details and alerts", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  handlers["GET /api/v1/tyre-maintenance/vehicle/AP31Z0044"] = () => json(200, TYRE);
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: 0, items: [] });
  handlers["POST /api/v1/tyre-maintenance/vehicle/AP31Z0044/register"] = () => json(200, TYRE);
  handlers["POST /api/v1/tyre-maintenance/vehicle/AP31Z0044/complete"] = () => json(200, TYRE);
  await render(React.createElement(panels().TyreMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canWrite: true }));
  const gets = () => maintenanceRequests().filter((r) => r.method === "GET").length;

  await click($('[data-testid="tyre-register-open"]'));
  await click(buttonByText("Register tyres", $('[role="alertdialog"]')));
  assert.equal(requests.filter((r) => r.method === "POST").length, 0, "installation date is required");
  await type($("#tyre-when"), "2026-11-10T10:30");
  const before = gets();
  await click(buttonByText("Register tyres", $('[role="alertdialog"]')));
  const reg = requests.find((r) => r.method === "POST");
  same([reg.path, Object.keys(reg.body), reg.tenant], ["/api/v1/tyre-maintenance/vehicle/AP31Z0044/register", ["installation_date"], "10"]);
  assert.ok(requests.some((r) => r.host === "api.test" && r.route === "/vehicles" && r.query.keyword === "AP31Z0044"), "the vehicle is checked against the tenant (Java BFF) before the write");
  assert.equal(reg.body.installation_date, new Date("2026-11-10T10:30").toISOString());
  assert.equal(gets() - before, 2, "tyre details and tyre alerts are re-read");

  await click($('[data-testid="tyre-complete-open"]'));
  await click(buttonByText("Complete replacement", $('[role="alertdialog"]')));
  const done = requests.filter((r) => r.method === "POST").at(-1);
  same([done.path, done.body, done.tenant], ["/api/v1/tyre-maintenance/vehicle/AP31Z0044/complete", {}, "10"], "empty date → omitted (backend uses its UTC now)");
});

test("MU tyre tab: no record → empty state with Register; Complete needs a record", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  handlers["GET /api/v1/tyre-maintenance/vehicle/AP31Z0044"] = () => notFound("No tyre record");
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: 0, items: [] });
  await render(React.createElement(panels().TyreMaintenanceTab, { tenantId: 10, vehicleNumber: "AP31Z0044", canWrite: true }));
  assert.ok(text().includes("No tyre record"));
  assert.ok($('[data-testid="tyre-register-open"]'));
  assert.equal($('[data-testid="tyre-complete-open"]').disabled, true);
});

// ── Maintenance Alerts tab ──────────────────────────────────────────────────

test("MU alerts tab: vehicle and tyre alerts for the selected vehicle, labelled by source", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  const second = { ...OVERDUE, kind: "due_today", alert_date: "2026-11-09", created_at: "2026-11-09T04:15:00" };
  handlers["GET /api/vehicle-maintenance/alerts"] = () => json(200, vehicleAlerts([second, OVERDUE]));
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: 1, items: [TYRE_ALERT] });
  await render(React.createElement(panels().MaintenanceAlertsTab, { tenantId: 10, vehicleNumber: "AP31Z0044" }));
  same($$("[data-alert-id]").map((li) => li.getAttribute("data-alert-id")), [OVERDUE_KEY, "tyre:115", "vehicle:AP31Z0044:due_today:2026-11-09:2026-11-09:2026-11-09T04:15:00"], "both vehicle items, merged with tyre newest first");
  same($$("[data-source]").map((s) => s.textContent), ["Vehicle Maintenance", "Tyre Maintenance", "Vehicle Maintenance"]);
  same($$('[data-testid="maintenance-alert-kind"]').map((s) => [s.textContent, s.getAttribute("data-kind")]), [["Overdue", "overdue"], ["Due today", "due_today"]]);
  assert.ok($('[data-testid="maintenance-alert-kind"]').className.includes("text-danger"), "overdue reads in red");
  same($$('[data-testid="maintenance-alert-due"]').map((s) => s.textContent), ["Due 09 Nov 2026", "Due 09 Nov 2026"], "plain dates from their own digits");
  assert.ok(text().includes(OVERDUE.message) && text().includes("Driver Ravi Kumar") && text().includes("11 Nov 2026, 04:15"));
  same(maintenanceRequests().map((r) => [r.path, r.query]), [["/api/vehicle-maintenance/alerts", { vehicle_number: "AP31Z0044" }], ["/api/v1/tyre-maintenance/alerts", { vehicle_number: "AP31Z0044", limit: "50" }]]);
});

// ── Notifications popover ───────────────────────────────────────────────────

/** The Python endpoints the browser assembles the Maintenance feed from (tyre alerts, schedule list, vehicle alerts). */
function feedHandlers({ tyre = [TYRE_ALERT], vehicle = [OVERDUE] } = {}) {
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: tyre.length, items: tyre });
  handlers["GET /api/vehicle-maintenance"] = () => json(200, { success: true, message: "ok", data: { items: [{ tenant_id: 10, vehicle_number: "AP31Z0044", status: "pending" }] } });
  handlers["GET /api/vehicle-maintenance/alerts"] = () => json(200, vehicleAlerts(vehicle, { driver_name: null, driver_id: null }));
}

async function openBell() {
  const nc = ui.require("components/drive-vision/app-shell/notification-center");
  await render(React.createElement(nc.NotificationCenter));
  await click($('[data-testid="notification-bell"]'));
}
const tabLabels = () => $$("[role=tab][data-tab]").map((b) => b.getAttribute("data-tab"));

test("MU bell: Maintenance tab sits between Alarm and All for a Fleet Owner; its alerts load from the aggregated feed", async () => {
  currentAccess = accessFor({ ...FLEET_OWNER, permissions: [...FLEET_OWNER.permissions, "vehicle.read"] });
  feedHandlers();
  await openBell();
  same(tabLabels(), ["AI Events", "Alarm", "Maintenance", "All"]);
  assert.ok(text().includes("Fatigue detected"), "AI Events still opens first when it has unread items");
  assert.equal(maintenanceRequests().length, 0, "nothing fetched until maintenance rows are shown");
  await click($('[data-tab="Maintenance"]'));
  same($$("[data-maintenance-notification]").map((li) => li.getAttribute("data-maintenance-notification")), [OVERDUE_KEY, "tyre:115"]);
  assert.ok(text().includes(TYRE_ALERT.message) && text().includes("Tyre Maintenance") && text().includes("Vehicle Maintenance"));
  assert.ok(text().includes("Overdue") && text().includes("Due 09 Nov 2026"), "overdue status and due date shown in the popover");
  assert.ok(!text().includes("Driver "), "no driver line when the driver name is missing");
  same(maintenanceRequests().map((r) => [r.path, r.query, r.tenant]), [
    ["/api/v1/tyre-maintenance/alerts", { limit: "50" }, "10"],
    ["/api/vehicle-maintenance", { page: "1", page_size: "100" }, undefined],
    ["/api/vehicle-maintenance/alerts", { vehicle_number: "AP31Z0044" }, undefined],
  ], "assembled in the browser: X-Tenant-ID on the tyre request only");
  assert.ok($('[data-testid="maintenance-read-note"]'), "the read-state limitation is stated");
});

test("MU bell: maintenance alerts never add to unread, have no read buttons, and Mark all read can't run on that tab", async () => {
  currentAccess = accessFor({ ...FLEET_OWNER, permissions: [...FLEET_OWNER.permissions, "notification.update"] });
  feedHandlers();
  await openBell();
  const badge = $('[data-testid="notification-badge"]').textContent;
  await click($('[data-tab="Maintenance"]'));
  assert.equal($('[data-testid="notification-badge"]').textContent, badge, "badge unchanged: still the BFF's unread total");
  assert.ok(!$$("[data-maintenance-notification] button[aria-label^='Mark']").length);
  const markAll = $('[data-testid="notification-read-all"]');
  if (markAll) {
    assert.equal(markAll.disabled, true);
    await click(markAll);
  }
  assert.equal(requests.filter((r) => r.route === "/notifications/read-all").length, 0);
});

test("MU bell: clicking a maintenance alert opens that vehicle's Maintenance Alerts tab", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  feedHandlers();
  await openBell();
  await click($('[data-tab="Maintenance"]'));
  await click($('[data-maintenance-notification="tyre:115"] button'));
  same(pushes, ["/drive-vision/vehicle-registry?vehicleNumber=AP31Z0044&tab=alerts&alert=tyre%3A115"]);
});

test("MU bell: the All tab includes maintenance alerts beside the BFF notifications; empty and error states", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  feedHandlers();
  await openBell();
  await click($('[data-tab="All"]'));
  assert.ok($('[data-testid="all-tab-maintenance"]'));
  assert.ok(text().includes("Dispatch assigned"), "the BFF list is still there");
  same($$('[data-testid="all-tab-maintenance"] [data-maintenance-notification]').length, 2);

  await reset();
  ui.require("features/drive-vision/api/maintenance-service").resetMaintenanceFeedCache();
  feedHandlers({ tyre: [], vehicle: [] });
  await openBell();
  await click($('[data-tab="Maintenance"]'));
  assert.ok(text().includes("No maintenance alerts"));

  await reset();
  ui.require("features/drive-vision/api/maintenance-service").resetMaintenanceFeedCache();
  const gateway502 = () => new Response("<!DOCTYPE html><html><title>502</title></html>", { status: 502, headers: { "Content-Type": "text/html" } });
  handlers["GET /api/v1/tyre-maintenance/alerts"] = gateway502;
  handlers["GET /api/vehicle-maintenance"] = gateway502;
  await openBell();
  await click($('[data-tab="Maintenance"]'));
  assert.ok(text().includes("can't be reached"), "an error is shown, not 'no alerts'");
  assert.ok(!text().includes("No maintenance alerts"));
});

test("MU bell: no Maintenance tab for a driver or a viewer; Admin without a tenant is asked to select one (no request)", async () => {
  for (const raw of [IDENTITIES.viewer, IDENTITIES.dispatcher, IDENTITIES.tenantAdmin]) {
    currentAccess = accessFor(raw);
    await openBell();
    same(tabLabels(), ["AI Events", "Alarm", "All"], raw.roleCode);
    await reset();
  }
  currentAccess = accessFor(IDENTITIES.platformAdmin);
  await openBell();
  await click($('[data-tab="Maintenance"]'));
  assert.ok(text().includes("Select a tenant"));
  assert.equal(maintenanceRequests().length, 0);
});

// ── Vehicles screen ─────────────────────────────────────────────────────────

const VEHICLE = { id: 501, vehicleNumber: "AP31Z0044", vehicleType: "Bus", make: "Tata", model: "Starbus", status: "ACTIVE", deviceAssigned: true, device: { id: 1215, name: "Bus 1" } };
function registryHandlers() {
  handlers["GET /vehicles"] = (r) => envelope(r.query.keyword === "AP31Z0044" || !r.query.keyword ? [VEHICLE] : [], 1);
  handlers["GET /vehicles/501"] = () => envelope(VEHICLE);
  handlers["GET /api/vehicle-maintenance/alerts"] = () => json(200, vehicleAlerts([], { total_alerts: 0 }));
  handlers["GET /api/v1/tyre-maintenance/alerts"] = () => json(200, { count: 1, items: [TYRE_ALERT] });
  handlers["GET /api/vehicle-maintenance/AP31Z0044"] = () => json(200, SCHEDULE);
}
const registry = () => ui.require("components/drive-vision/vehicle-registry/vehicle-registry-page").VehicleRegistryPage;

test("MU vehicles: a notification link opens the vehicle's Maintenance Alerts tab; the table loads no maintenance data", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  registryHandlers();
  await render(React.createElement(registry()));
  assert.equal(maintenanceRequests().length, 0, "rendering the table fetches no maintenance details");
  await reset();

  currentParams = new URLSearchParams("vehicleNumber=AP31Z0044&tab=alerts&alert=tyre%3A115");
  await render(React.createElement(registry()));
  await settle(20);
  same($$('[data-testid="vehicle-drawer-tabs"] [role=tab]').map((b) => b.textContent), ["Overview", "Vehicle Maintenance", "Tyre Maintenance", "Maintenance Alerts"]);
  assert.equal($('[data-testid="vehicle-drawer-tabs"] [aria-selected="true"]').textContent, "Maintenance Alerts");
  assert.ok($('[data-alert-id="tyre:115"]'), "the vehicle's alerts are shown");
  assert.ok(maintenanceRequests().every((r) => r.path.includes("AP31Z0044") || r.query.vehicle_number === "AP31Z0044"), "by vehicle number, never the vehicle or device id");
  assert.ok(!maintenanceRequests().some((r) => /\/(501|1215)(\/|$)/.test(r.path)));

  await click(buttonByText("Vehicle Maintenance", $('[data-testid="vehicle-drawer-tabs"]')));
  assert.ok($('[data-testid="schedule-details"]'));
});

test("MU vehicles: a link to a vehicle outside the tenant says so; drivers' and viewers' drawers have no maintenance tabs", async () => {
  currentAccess = accessFor(FLEET_OWNER);
  registryHandlers();
  currentParams = new URLSearchParams("vehicleNumber=KA01ZZ9999&tab=alerts");
  await render(React.createElement(registry()));
  await settle(20);
  assert.ok($('[data-testid="vehicle-link-missing"]'));
  assert.ok(!$('[data-testid="vehicle-drawer-tabs"]'));
  await reset();

  currentAccess = accessFor(IDENTITIES.viewer);
  currentParams = new URLSearchParams("vehicle=501&tab=alerts");
  await render(React.createElement(registry()));
  await settle(20);
  assert.ok(text().includes("Tracking device"), "the drawer opens on its usual content");
  assert.ok(!$('[data-testid="vehicle-drawer-tabs"]'));
  assert.equal(maintenanceRequests().length, 0);
});

test("MU regression: existing notification behaviour is kept (poll tabs, See more, Unread only, Open Alerts & Events)", () => {
  const nc = read("components/drive-vision/app-shell/notification-center.tsx");
  for (const s of ['label="AI Events"', 'label="Alarm"', 'label="All"', "notification-see-more", "Unread only", "Open Alerts &amp; Events", "alertService.markAllRead", "usePolledQuery(\"notifications:poll\""]) assert.ok(nc.includes(s), s);
  assert.ok(nc.indexOf('label="Alarm"') < nc.indexOf('label="Maintenance"') && nc.indexOf('label="Maintenance"') < nc.indexOf('label="All"'));
});
