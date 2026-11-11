// Sensor Alerts (Python sensor alerts service; duration-based response and Swagger parameters as supplied 2026-11-12).
// MOCKED ONLY: every request goes to a stub fetch. SAMPLE is the supplied response
// (tests/fixtures/sensor-alerts-duration-2026-11-12.json: a summary of all five sensor types and one ULT record);
// FIXTURE adds synthetic SMK (ended) and ALC (ongoing) records to it. Buses, vehicles and other records are synthetic. A pass says nothing
// about the live service (see docs/sensor-alerts-api-integration-report.md → "Mocked versus live verification").
// The Sensors page and the Sensor Alerts panel are real React running in jsdom; only the Select primitive is a
// native <select> stand-in and the access hook returns a computed V10 identity.
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
/** Source without comments, for checks about code (doc comments may name what was removed). */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const DEMO_TENANT = 10;
/** Every tenant_id moved to the demo tenant of this realm (the synthetic users are tenant 10; the sample says 1). */
const retenant = (v) => JSON.parse(JSON.stringify(v), (k, x) => (k === "tenant_id" && typeof x === "number" ? DEMO_TENANT : x));
const SAMPLE = retenant(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sensor-alerts-duration-2026-11-12.json"), "utf8")));
/** SAMPLE (its own summary: ULT 241, SMK 1, ALC 1 …) plus synthetic SMK and ALC records. Newest first: SMK, ULT, ALC. */
const FIXTURE = {
  ...SAMPLE,
  alerts: [
    SAMPLE.alerts[0],
    { ...SAMPLE.alerts[0], sensor_sub_id: 3, sensor_type: "SMK", started_at: "2026-11-08 17:10:00", ended_at: "2026-11-08 17:10:27", ongoing: false, ended_after_gap: false, lasted_seconds: 27, sensor_data: "value:2,reading:alert" },
    { ...SAMPLE.alerts[0], sensor_sub_id: 4, sensor_type: "ALC", started_at: "2026-11-08 15:00:00", ended_at: null, ongoing: true, ended_after_gap: false, lasted_seconds: 95, sensor_data: "value:3,reading:alert" },
  ],
};

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/sensors", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event", "DocumentFragment"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.releasePointerCapture = () => {};

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

// ── Stub fetch: BFF (http://api.test/api/v1/…), the same-origin proxy (/api/sensors/alerts) ───────────────────

let requests = [];
let handlers = {};
const json = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const envelope = (data, total = null) => json(200, { code: 200, msg: "Success", data, total, extend: null });
const headerOf = (init, name) => {
  const h = init.headers ?? {};
  if (typeof h.get === "function") return h.get(name);
  const hit = Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit ? hit[1] : undefined;
};
async function stubFetch(url, init = {}) {
  const u = new URL(String(url), "http://localhost:3000");
  const py = u.host === "py.test";
  const pyPath = u.pathname.replace(/^\/safe-fare-python/, "");
  const req = { method: init.method ?? "GET", host: u.host, path: py ? pyPath : u.pathname, search: u.search, query: Object.fromEntries(u.searchParams), auth: headerOf(init, "authorization"), tenant: headerOf(init, "x-tenant-id"), credentials: init.credentials, signal: init.signal };
  requests.push(req);
  const route = py ? pyPath : u.pathname.replace(/^\/api\/v1/, "");
  for (const [pattern, fn] of Object.entries(handlers)) {
    if (new RegExp(`^${pattern}$`).test(`${req.method} ${route}`)) return fn(req);
  }
  return envelope({});
}
const alertRequests = () => requests.filter((r) => r.host === "py.test" && r.path === "/api/sensors/alerts");
const deferred = () => {
  let resolve;
  const promise = new Promise((a) => (resolve = a));
  return { promise, resolve };
};

// ── Realms ──────────────────────────────────────────────────────────────────

const motionTags = new Map();
const MOTION_ONLY = new Set(["initial", "animate", "exit", "transition", "variants", "whileHover", "whileTap", "layout"]);
const motion = new Proxy(
  {},
  {
    get(_, tag) {
      if (!motionTags.has(tag)) motionTags.set(tag, React.forwardRef((props, ref) => React.createElement(tag, { ...Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY.has(k))), ref })));
      return motionTags.get(tag);
    },
  }
);

/** Native <select> stand-in for the Radix Select wrapper (same props), so tests can choose options. */
const SelectCtx = React.createContext(null);
const selectStub = {
  Select: ({ value, onValueChange, disabled, children }) => {
    const [label, setLabel] = React.useState(null);
    return React.createElement(SelectCtx.Provider, { value: { value, onValueChange, disabled, label, setLabel } }, children);
  },
  SelectTrigger: ({ id, children, ...rest }) => {
    const ctx = React.useContext(SelectCtx);
    return React.createElement("span", { "data-select-trigger": id ?? rest["aria-label"] ?? "" }, children, ctx && null);
  },
  SelectValue: () => null,
  SelectContent: ({ children }) => {
    const ctx = React.useContext(SelectCtx);
    return React.createElement("select", { "data-select": "", value: ctx.value ?? "", disabled: ctx.disabled, onChange: (e) => ctx.onValueChange(e.target.value) }, React.createElement("option", { value: "" }, "—"), children);
  },
  SelectItem: ({ value, children }) => React.createElement("option", { value }, React.Children.toArray(children).filter((c) => typeof c === "string" || typeof c === "number").join("") || value),
  SelectGroup: ({ children }) => children,
  SelectLabel: () => null,
  SelectSeparator: () => null,
  SelectScrollUpButton: () => null,
  SelectScrollDownButton: () => null,
};

let currentAccess = null;
let searchParams = new URLSearchParams();
let ui;
let pure;
function buildRealms() {
  const storage = new MemoryStorage();
  const session = JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 3_600_000, refreshToken: "r", refreshExpiresAt: null });
  storage.setItem("safefare:session:v1", session);
  // The UI realm's window is jsdom's, so the client reads jsdom's own sessionStorage.
  window.sessionStorage.setItem("safefare:session:v1", session);
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const modules = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "motion/react": { motion, AnimatePresence: ({ children }) => children, useReducedMotion: () => true },
    "radix-ui": require("radix-ui"),
    "lucide-react": require("lucide-react"),
    clsx: require("clsx"),
    "tailwind-merge": require("tailwind-merge"),
    "class-variance-authority": require("class-variance-authority"),
    "next/navigation": { useSearchParams: () => searchParams, usePathname: () => "/drive-vision/sensors", useRouter: () => ({ push() {}, replace() {}, back() {} }) },
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
    sonner: { toast: Object.assign(() => {}, { success() {}, error() {}, info() {}, warning() {} }), Toaster: () => null },
    "next-themes": { useTheme: () => ({ theme: "light" }) },
    "@/components/ui/select": selectStub,
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
    sessionStorage: storage,
    localStorage: new MemoryStorage(),
    navigator: { locks: createLockManager() },
    performance,
    crypto: globalThis.crypto,
    atob,
    btoa,
    structuredClone,
    queueMicrotask,
    process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test", NEXT_PUBLIC_PYTHON_API_BASE_URL: "https://py.test/safe-fare-python", NEXT_PUBLIC_DEMO_TENANT_ID: String(DEMO_TENANT) } },
  };
  ui = createRealm({ ...globals, window, document: window.document, HTMLElement: window.HTMLElement }, modules);
  pure = createRealm(globals, modules);
}
buildRealms();

const model = () => pure.require("components/drive-vision/sensors/sensor-alerts-model");
const contract = () => pure.require("features/drive-vision/api/sensor-alerts");
const service = () => pure.require("features/drive-vision/api/sensor-alerts-service").sensorAlertsService;
const accessFor = (raw, selectedTenantId = null) => {
  const p = ui.require("features/drive-vision/access/access-policy");
  const idm = ui.require("features/drive-vision/access/identity");
  return p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });
};

const roots = [];
test.afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => root.unmount());
  }
  window.document.body.innerHTML = "";
  requests = [];
  handlers = {};
  searchParams = new URLSearchParams();
  ui.require("features/drive-vision/api/tenant-context").setTenantSelection(null);
});

const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const text = () => window.document.body.textContent;
const click = async (el) => {
  assert.ok(el, "element to click");
  await act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
};
const choose = async (selectEl, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(selectEl, value);
    selectEl.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await settle();
};
/** A radio chip by its label (a trailing count, e.g. "Smoke2", is ignored). */
const radio = (label) => $$('[role="radio"]').find((b) => b.textContent.trim() === label || b.textContent.trim().replace(/\d+$/, "") === label);
const tabs = () => $$('[role="tab"]');
const tab = (label) => tabs().find((t) => t.textContent.trim().replace(/\d+$/, "") === label);
const button = (label, nth = 0) => $$("button").filter((b) => b.textContent.trim() === label)[nth];
/** { label: number } from the Sensor Alerts summary cards. */
const summaryValues = () => Object.fromEntries($$('[data-testid="summary-card"]').map((c) => [c.dataset.label, Number(c.querySelector('[data-testid="summary-value"]').textContent)]));

// ── 1. Contract: request building and response validation ───────────────────

test("SA request: optional parameters are omitted, never sent empty or as 'undefined'; max_gap_seconds always sent (default 60)", () => {
  const c = contract();
  assert.equal(c.sensorAlertsSearch({}), "?max_gap_seconds=60");
  assert.equal(c.sensorAlertsSearch(), "?max_gap_seconds=60");
  assert.equal(c.sensorAlertsSearch({ tenantId: 1 }), "?tenant_id=1&max_gap_seconds=60");
  assert.equal(c.sensorAlertsSearch({ tenantId: 1, vehicleNumber: "AP31Z0044" }), "?tenant_id=1&vehicle_number=AP31Z0044&max_gap_seconds=60");
  for (const v of ["", "  ", "undefined", "null", "NULL", null, undefined]) assert.equal(c.sensorAlertsSearch({ vehicleNumber: v }), "?max_gap_seconds=60", String(v));
  for (const t of [0, -1, 1.5, NaN, null, undefined, "1"]) assert.equal(c.sensorAlertsSearch({ tenantId: t }), "?max_gap_seconds=60", String(t));
  assert.equal(c.sensorAlertsSearch({ vehicleNumber: "AP31&x=1" }), "?max_gap_seconds=60", "malformed numbers are dropped, not encoded");
  assert.equal(c.sensorAlertsSearch({ maxGapSeconds: 120 }), "?max_gap_seconds=120");
  for (const bad of [0, -5, 1.5, "60", 100_000]) assert.equal(c.sensorAlertsSearch({ maxGapSeconds: bad }), "?max_gap_seconds=60", String(bad));
  same(c.SENSOR_ALERTS_DEFAULTS, { maxGapSeconds: 60 });
  assert.doesNotMatch(code("features/drive-vision/api/sensor-alerts.ts"), /min_run|minRun|params\.set\("raw"/, "the old min_run / raw parameters are gone");
});

test("SA request: sensor_sub_id 1–5 and from_time / to_time in the service's own format — no toISOString, no Z, no offset", () => {
  const c = contract();
  same(c.SENSOR_SUB_IDS, { 1: "IR", 2: "ULT", 3: "SMK", 4: "ALC", 5: "PRS" });
  for (const id of [1, 2, 3, 4, 5]) assert.equal(c.sensorAlertsSearch({ sensorSubId: id }), `?sensor_sub_id=${id}&max_gap_seconds=60`);
  for (const id of [0, 6, 2.5, "2", null]) assert.equal(c.sensorAlertsSearch({ sensorSubId: id }), "?max_gap_seconds=60", String(id));
  // datetime-local values: T → space, seconds added; the digits are never shifted.
  assert.equal(c.cleanSensorTime("2026-11-10T00:00"), "2026-11-10 00:00:00");
  assert.equal(c.cleanSensorTime("2026-11-10T23:59:30"), "2026-11-10 23:59:30");
  assert.equal(c.cleanSensorTime("2026-11-10 00:00:00"), "2026-11-10 00:00:00", "the Swagger example passes as is");
  assert.equal(c.cleanSensorTime("2026-11-10T23:59:59.000"), "2026-11-10 23:59:59", "a datetime-local value with milliseconds: dropped, never rounded");
  assert.equal(c.sensorAlertsSearch({ fromTime: "2026-11-10T00:00", toTime: "2026-11-10T23:59" }), "?from_time=2026-11-10+00%3A00%3A00&to_time=2026-11-10+23%3A59%3A00&max_gap_seconds=60", "URLSearchParams encoding of '2026-11-10 00:00:00'");
  for (const bad of ["2026-02-30 10:00:00", "2026-11-10 24:00:00", "2026-11-10T18:00:00Z", "2026-11-10T18:00:00+05:30", "2026-11-10", "yesterday", "", null]) assert.equal(c.cleanSensorTime(bad), null, String(bad));
  assert.ok(c.isTimeRangeValid("2026-11-10 00:00:00", "2026-11-10 00:00:00") && c.isTimeRangeValid(null, "2026-11-10 00:00:00") && !c.isTimeRangeValid("2026-11-11 00:00:00", "2026-11-10 23:59:59"));
  assert.doesNotMatch(code("features/drive-vision/api/sensor-alerts.ts"), /toISOString/);
});

test("SA response: the duration contract — filters, summary (count + total_lasted_seconds), count and alerts[] with every field", () => {
  const c = contract();
  const ok = c.parseSensorAlertsResponse(SAMPLE);
  assert.equal(ok.ok, true);
  same(ok.value.filters, SAMPLE.filters);
  same(ok.value.summary, SAMPLE.summary, "all five sensor types, as sent");
  assert.equal(ok.value.count, 243, "count kept even though 1 record came back");
  same(ok.value.alerts, SAMPLE.alerts, "every alert field preserved as sent");
  same(Object.keys(ok.value.alerts[0]).sort(), ["ended_after_gap", "ended_at", "iot_kit", "lasted_seconds", "ongoing", "sensor_data", "sensor_sub_id", "sensor_type", "started_at", "tenant_id", "vehicle_number"]);
  same(c.parseSensorAlertsResponse({ success: false, count: 0, alerts: [] }), { ok: false, reason: "unsuccessful" });
  same(c.parseSensorAlertsResponse({ count: 0, alerts: [] }), { ok: false, reason: "shape" });
  same(c.parseSensorAlertsResponse({ success: true, count: 0, alerts: null }), { ok: false, reason: "shape" });
  same(c.parseSensorAlertsResponse([]), { ok: false, reason: "shape" });
  const empty = c.parseSensorAlertsResponse({ success: true, summary: { total_alerts: 0, by_sensor: [] }, count: 0, alerts: [] });
  same([empty.ok, empty.value.alerts, empty.value.summary], [true, [], { total_alerts: 0, by_sensor: [] }]);
  same(c.parseSensorAlertsResponse({ success: true, alerts: [] }).value.summary, null, "summary is optional");
  const odd = c.parseSensorAlertsResponse({ success: true, alerts: [{ sensor_type: "SMK", ongoing: "true", ended_after_gap: 1, ended_at: "", lasted_seconds: -3 }, 5, null] });
  same(odd.value.alerts.map((a) => [a.ongoing, a.ended_after_gap, a.ended_at, a.lasted_seconds]), [[null, null, null, null]], "wrong types read as null, never coerced");
  const noEnd = c.parseSensorAlertsResponse({ success: true, alerts: [{ sensor_type: "ULT", started_at: "2026-11-08 16:41:35" }] }).value.alerts[0];
  same([noEnd.ended_at, noEnd.ongoing, noEnd.lasted_seconds], [null, null, null], "missing end fields are null, not invented");
});

// ── 2. Interpretation ───────────────────────────────────────────────────────

const rec = (patch = {}) => ({ ...SAMPLE.alerts[0], ...patch });

test("SA ULT: reading SAFE / WARNING / NO_ECHO in any case; distance:NA or missing is 'Distance unavailable'", () => {
  const m = model();
  const v = m.interpretAlert(SAMPLE.alerts[0], 0);
  same([v.kind, v.code, v.subId, v.sensorName, v.title, v.reading, v.readingTone, v.distanceText], ["ULT", "ULT", 2, "Ultrasonic Sensor", "No echo", "no_echo", "neutral", "3"]);
  const ult = (sensor_data) => m.interpretAlert(rec({ sensor_data }), 0);
  for (const [data, title, reading] of [["distance:120,reading:SAFE", "Safe reading", "safe"], ["distance:120,reading:safe", "Safe reading", "safe"], ["distance:40,reading:Warning", "Warning reading", "warning"], ["distance:NA,reading:NO_ECHO", "No echo", "no_echo"]]) same([ult(data).title, ult(data).reading], [title, reading], data);
  for (const data of ["distance:NA,reading:NO_ECHO", "reading:SAFE", "distance:,reading:SAFE", "distance:abc", null, ""]) assert.equal(ult(data).distanceText, "Distance unavailable", String(data));
  assert.equal(ult("distance:287.07 cm,reading:SAFE").distanceText, "287.07 cm", "a unit is kept as sent");
  same([ult("distance:3,reading:ECHO").title, ult("distance:3,reading:ECHO").reading], ["Ultrasonic sensor alert", null], "unknown reading: nothing invented");
});

test("SA ULT object very close: any case / spacing reads as one reading; title and badge 'Object Very Close'; no 'Distance unavailable', no invented distance", () => {
  const m = model();
  const ult = (sensor_data) => m.interpretAlert(rec({ sensor_data }), 0);
  for (const data of ["distance:NA,reading:object very close", "distance:NA,reading:OBJECT VERY CLOSE", "distance:NA,reading:object_very_close", "distance:NA,reading:object-very-close", "reading: Object  Very Close ,distance:NA"]) {
    const v = ult(data);
    same([v.title, v.reading, v.readingTone, v.distanceText], ["Object Very Close", "object_very_close", "danger", null], data);
  }
  assert.equal(m.ULT_READING_LABEL.object_very_close, "Object Very Close");
  assert.equal(ult("distance:12 cm,reading:object very close").distanceText, "12 cm", "a real distance sent with it is shown as sent");
  same([ult("distance:NA,reading:NO_ECHO").distanceText, ult("distance:NA,reading:SAFE").distanceText], ["Distance unavailable", "Distance unavailable"], "other readings keep 'Distance unavailable'");
  same([m.ULT_READING_LABEL.safe, m.ULT_READING_LABEL.warning, m.ULT_READING_LABEL.no_echo], ["Safe", "Warning", "No echo"], "existing badge labels unchanged");
  for (const sensor_type of ["SMK", "ALC", "IR", "PRS", "TMP"]) {
    const v = m.interpretAlert({ sensor_type, sensor_data: "distance:NA,reading:object very close" }, 0);
    same([v.reading, v.readingTone, v.distanceText, v.title === "Object Very Close"], [null, null, null, false], `${sensor_type}: not a ULT reading`);
  }
});

test("SA status and duration fields: ongoing / ended after gap / ended; missing ended_at is never a fabricated time", () => {
  const m = model();
  const ended = m.interpretAlert(SAMPLE.alerts[0], 0);
  same([ended.status, ended.statusLabel, ended.startedText, ended.endedText, ended.durationText, ended.gapText, ended.vehicle, ended.iotKit, ended.sensorData], ["ended_gap", "Ended after inactivity gap", "08 Nov 2026, 04:41:35 PM IST", "08 Nov 2026, 04:42:02 PM IST", "27 sec", "Yes", "AP31Z0044", "IOT-KIT-001", "distance:3,reading:no_echo"]);
  const ongoing = m.interpretAlert(rec({ ongoing: true, ended_after_gap: false, ended_at: null, lasted_seconds: 95 }), 0);
  same([ongoing.status, ongoing.statusLabel, ongoing.endedText, ongoing.durationText, ongoing.gapText], ["ongoing", "Ongoing", "Not ended", "1 min 35 sec", "No"]);
  const plain = m.interpretAlert(rec({ ongoing: false, ended_after_gap: false, lasted_seconds: 0 }), 0);
  same([plain.status, plain.statusLabel, plain.durationText, plain.gapText], ["ended", "Ended", "0 sec", "No"]);
  const unknown = m.interpretAlert(rec({ ongoing: null, ended_after_gap: null, ended_at: null, lasted_seconds: null }), 0);
  same([unknown.status, unknown.endedText, unknown.durationText, unknown.gapText], ["unknown", "Not reported", "—", "—"]);
});

test("SA durations: seconds, minutes and seconds, hours and minutes; 0 is '0 sec'; missing is '—'", () => {
  const m = model();
  same([0, 1, 27, 59, 60, 95, 3069, 3599, 3600, 7500, 86_400 + 60].map(m.formatDuration), ["0 sec", "1 sec", "27 sec", "59 sec", "1 min", "1 min 35 sec", "51 min 9 sec", "59 min 59 sec", "1 h", "2 h 5 min", "24 h 1 min"]);
  for (const bad of [null, undefined, -1, NaN, "27"]) assert.equal(m.formatDuration(bad), "—", String(bad));
});

test("SA other sensors: SMK / ALC get no ULT rules; IR / PRS / unknown types stay displayable", () => {
  const m = model();
  const smk = m.interpretAlert(FIXTURE.alerts[1], 1);
  const alc = m.interpretAlert(FIXTURE.alerts[2], 2);
  same([smk.title, smk.sensorName, smk.code, smk.distanceText, smk.reading], ["Smoke sensor alert", "Smoke Sensor", "SMK", null, null]);
  same([alc.title, alc.sensorName, alc.code, alc.distanceText, alc.reading], ["Alcohol sensor alert", "Alcohol Sensor", "ALC", null, null]);
  assert.equal(m.interpretAlert({ sensor_type: "SMK", sensor_data: "value:2,reading:WARNING" }, 0).readingTone, null);
  const ir = m.interpretAlert({ sensor_sub_id: 1 }, 0);
  same([ir.code, ir.kind, ir.sensorName, ir.title], ["IR", null, "IR Sensor", "IR Sensor alert"], "no sensor_type → Swagger's type for sensor_sub_id");
  const prs = m.interpretAlert({ sensor_type: "PRS", sensor_sub_id: 5 }, 0);
  same([prs.code, prs.sensorName, prs.title], ["PRS", null, "Sensor alert"]);
  const tmp = m.interpretAlert({ sensor_type: "tmp", started_at: "2026-11-08 09:05:00" }, 0);
  same([tmp.kind, tmp.code, tmp.title, tmp.startedText], [null, "TMP", "Sensor alert", "08 Nov 2026, 09:05:00 AM IST"]);
  assert.equal(m.interpretAlert({}, 0).code, "—");
  assert.equal(m.interpretAll([{ sensor_type: "TMP" }, ...FIXTURE.alerts]).length, 4, "not discarded");
});

// ── 3. Summary, ordering, time ──────────────────────────────────────────────

test("SA summary: the response's summary — every type's count and total duration; records counted only for a browser-side search", () => {
  const m = model();
  const resp = contract().parseSensorAlertsResponse(SAMPLE).value;
  const s = m.alertSummary(m.interpretAll(resp.alerts), resp, false);
  same([s.source, s.total], ["service", 243]);
  same(s.byType, { IR: { count: 0, seconds: 0 }, ULT: { count: 241, seconds: 3069 }, SMK: { count: 1, seconds: 27 }, ALC: { count: 1, seconds: 27 }, PRS: { count: 0, seconds: 0 } });
  const partial = m.serviceSummary({ total_alerts: null, by_sensor: [{ sensor_sub_id: 3, sensor_type: null, alert_count: 2, total_lasted_seconds: null }, { sensor_sub_id: 9, sensor_type: "TMP", alert_count: 4, total_lasted_seconds: 8 }] }, 0);
  same([partial.total, partial.byType.SMK, partial.byType.ULT, partial.other], [6, { count: 2, seconds: null }, { count: 0, seconds: 0 }, { count: 4, seconds: 8 }], "missing entries count 0; a missing duration isn't invented");
  for (const r of [{ summary: null }, { summary: { total_alerts: 9, by_sensor: [] } }]) assert.equal(m.alertSummary(m.interpretAll(FIXTURE.alerts), r, false).source, "records");
  const local = m.alertSummary(m.interpretAll(FIXTURE.alerts), FIXTURE, true);
  same([local.source, local.total, local.byType.ULT, local.byType.SMK, local.byType.ALC], ["records", 3, { count: 1, seconds: 27 }, { count: 1, seconds: 27 }, { count: 1, seconds: 95 }]);
  same([m.totalAlerts(resp), m.totalAlerts({ summary: null, count: 7, alerts: [] }), m.totalAlerts({ summary: null, count: null, alerts: [{}, {}] })], [243, 7, 2]);
});

test("SA IST time: started_at / ended_at formatted from their own digits — no UTC reading, no 'Z', no offset", () => {
  const m = model();
  assert.equal(m.formatIstTimestamp("2026-11-08 16:41:35"), "08 Nov 2026, 04:41:35 PM IST");
  assert.equal(m.formatIstTimestamp("2026-11-08 00:05:00"), "08 Nov 2026, 12:05:00 AM IST");
  assert.equal(m.formatIstTimestamp("2026-11-08T12:00:00"), "08 Nov 2026, 12:00:00 PM IST");
  for (const bad of ["2026-11-08T17:45:13Z", "2026-11-08T17:45:13+00:00", "2026-02-30 10:00:00", "2026-11-08 24:00:00", "yesterday", "", null]) assert.equal(m.formatIstTimestamp(bad), null, String(bad));
  const src = read("components/drive-vision/sensors/sensor-alerts-model.ts");
  assert.doesNotMatch(src.slice(src.indexOf("export function formatIstTimestamp")), /new Date\(ts|Date\.parse|toLocale|timeZone/);
  const sorted = m.interpretAll([{ sensor_type: "SMK", started_at: "2026-11-08 09:00:00" }, { sensor_type: "ALC", started_at: "2026-11-08 17:45:13" }, { sensor_type: "ULT", started_at: "garbage" }]);
  same(sorted.map((v) => v.code), ["ALC", "SMK", "ULT"], "newest first; unreadable time last");
});

test("SA date range input: datetime-local values become the service's strings; invalid ranges are refused with a message", () => {
  const m = model();
  same(m.readDateRange("2026-11-10T00:00", "2026-11-10T23:59:59"), { ok: true, fromTime: "2026-11-10 00:00:00", toTime: "2026-11-10 23:59:59" });
  same(m.readDateRange("", ""), { ok: true, fromTime: null, toTime: null }, "empty = no bound");
  same(m.readDateRange("2026-11-10T00:00", ""), { ok: true, fromTime: "2026-11-10 00:00:00", toTime: null });
  same(m.readDateRange("2026-11-11T00:00", "2026-11-10T00:00"), { ok: false, error: "The start must not be later than the end." });
  same(m.readDateRange("2026-02-30T00:00", ""), { ok: false, error: "Enter a valid start date and time." });
  same([m.toDateTimeInput("2026-11-10 00:00:00"), m.toDateTimeInput(null)], ["2026-11-10T00:00:00", ""]);
  same(m.filterByVehicle(m.interpretAll([...FIXTURE.alerts, { ...FIXTURE.alerts[0], vehicle_number: "TS09 AB 1234" }]), "ts09ab").map((v) => v.vehicle), ["TS09 AB 1234"], "registration search ignores case and spaces");
});

// ── 4. Client service (direct call to the Python API, demo tenant only) ────

test("SA service: calls the Python API directly with the demo tenant as tenant_id; no token, cookies or tenant header", async () => {
  handlers = { "GET /api/sensors/alerts": () => json(200, FIXTURE) };
  const svc = service();
  const res = await svc.list({ vehicleNumber: "AP31Z0044" }, DEMO_TENANT);
  assert.equal(res.count, 243);
  assert.equal(res.summary.total_alerts, 243);
  await svc.list({}, DEMO_TENANT);
  await svc.list({ vehicleNumber: "AP31Z0044", sensorSubId: 2, fromTime: "2026-11-10T18:00", toTime: "2026-11-10 19:00:00", maxGapSeconds: 60, tenantId: 99, minRun: 5, raw: false }, DEMO_TENANT);
  same(alertRequests().map((r) => r.search), [
    "?tenant_id=10&vehicle_number=AP31Z0044&max_gap_seconds=60",
    "?tenant_id=10&max_gap_seconds=60",
    "?tenant_id=10&vehicle_number=AP31Z0044&sensor_sub_id=2&from_time=2026-11-10+18%3A00%3A00&to_time=2026-11-10+19%3A00%3A00&max_gap_seconds=60",
  ], "tenant_id is always the demo tenant; from_time / to_time in the service's format; no min_run / raw; a tenantId in the query is ignored");
  for (const r of alertRequests()) {
    assert.equal(r.host, "py.test", "the configured Python host");
    same([r.auth, r.tenant, r.credentials], [undefined, undefined, "omit"]);
  }
});

test("SA service: only the demo tenant's users get alerts; another tenant and all-tenants mode send nothing", async () => {
  handlers = { "GET /api/sensors/alerts": () => json(200, FIXTURE) };
  const svc = service();
  await assert.rejects(svc.list({ vehicleNumber: "AP31Z0044" }, 7), (e) => e.status === 403 && e.errorCode === "not_demo_tenant" && /only available in the demo tenant \(tenant 10\)/.test(e.message));
  await assert.rejects(svc.list({}, null), (e) => e.errorCode === "no_tenant" && /Select the demo tenant/.test(e.message), "no all-tenant request");
  same(alertRequests(), []);
  handlers = { "GET /api/sensors/alerts": () => json(200, { ...FIXTURE, alerts: [{ ...FIXTURE.alerts[0], tenant_id: 3 }] }) };
  await assert.rejects(svc.list({}, DEMO_TENANT), (e) => e.status === 502 && e.errorCode === "tenant_mismatch", "another tenant's records are withheld");
  for (const qs of [{ sensorSubId: 6 }, { maxGapSeconds: 0 }, { fromTime: "yesterday" }, { toTime: "2026-11-10T18:00:00Z" }]) {
    requests = [];
    handlers = { "GET /api/sensors/alerts": () => json(200, FIXTURE) };
    await svc.list(qs, DEMO_TENANT);
    same(alertRequests().map((r) => r.search), ["?tenant_id=10&max_gap_seconds=60"], `${JSON.stringify(qs)}: an invalid filter is never sent`);
  }
});

test("SA service: empty alerts is a valid result; success:false, invalid JSON and HTTP errors are plain-language ApiErrors with their status", async () => {
  const svc = service();
  handlers = { "GET /api/sensors/alerts": () => json(200, { success: true, summary: { total_alerts: 0, by_sensor: [] }, count: 0, alerts: [] }) };
  same((await svc.list({}, DEMO_TENANT)).alerts, []);

  const html502 = () => new Response("<!DOCTYPE html><html><title>502 - Web server received an invalid response</title></html>", { status: 502 });
  const cases = [
    [() => json(200, { success: false, count: 0, alerts: [] }), (e) => e.errorCode === "SENSOR_ALERTS_UNSUCCESSFUL" && /couldn't return alerts/.test(e.message)],
    [() => json(200, "<html>oops</html>"), (e) => e.kind === "parse"],
    [() => json(200, { success: true, alerts: "nope" }), (e) => e.kind === "parse"],
    [() => json(422, { detail: [{ loc: ["query", "max_gap_seconds"], msg: "Input should be greater than 0" }] }), (e) => e.status === 422 && /didn't accept these filters: max_gap_seconds: Input should be greater than 0/.test(e.message)],
    [() => json(403, { detail: "nope" }), (e) => e.status === 403 && /refused/.test(e.message)],
    [() => json(404, { detail: "Not Found" }), (e) => e.status === 404 && /wasn't found/.test(e.message)],
    [() => json(500, { detail: "Traceback secret" }), (e) => e.status === 500 && /ran into a problem/.test(e.message) && !/Traceback/.test(e.message)],
    [html502, (e) => e.status === 502 && /can't be reached/.test(e.message) && /HTML error page/.test(e.message)],
    [() => json(504, {}), (e) => e.status === 504 && /too long/.test(e.message)],
    [() => Promise.reject(new TypeError("Failed to fetch")), (e) => e.kind === "network" && /CORS/.test(e.message)],
  ];
  for (const [respond, check] of cases) {
    handlers = { "GET /api/sensors/alerts": respond };
    await assert.rejects(svc.list({}, DEMO_TENANT), (e) => e.name === "ApiError" && check(e));
  }
});

test("SA config: the Python URL and demo tenant come from NEXT_PUBLIC_ configuration; no host, port or tenant is hardcoded in src", () => {
  const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  assert.match(envFile, /^NEXT_PUBLIC_PYTHON_API_BASE_URL=/m);
  assert.match(envFile, /^NEXT_PUBLIC_DEMO_TENANT_ID=/m);
  for (const f of ["features/drive-vision/api/sensor-alerts.ts", "features/drive-vision/api/sensor-alerts-service.ts", "components/drive-vision/sensors/sensor-alerts-panel.tsx", "components/drive-vision/sensors/sensor-alerts-model.ts", "components/drive-vision/sensors/sensors-page.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /185\.193|:8088|safefareai-api|AP31Z0044|tenantId: 1\b|tenant_id=1\b/, f);
  }
  assert.match(read("features/drive-vision/api/sensor-alerts-service.ts"), /from "\.\/python-client"/);
  assert.ok(!fs.existsSync(path.join(SRC, "app", "api", "sensors")), "the proxy route is gone");
});

// ── 6. The Sensor Alerts panel (real component in jsdom) ────────────────────

async function mountPanel(props) {
  const { SensorAlertsPanel } = ui.require("components/drive-vision/sensors/sensor-alerts-panel");
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  const render = (p) => act(async () => root.render(React.createElement(SensorAlertsPanel, { onRetry() {}, ...p })));
  await render(props);
  return { render };
}
const query = (patch) => ({ data: undefined, error: undefined, loading: false, refreshing: false, updatedAt: Date.UTC(2026, 10, 8, 12, 15, 13), refetch() {}, ...patch });
const parsed = (raw) => contract().parseSensorAlertsResponse(raw).value;

const card = (sensor) => $(`[data-testid="sensor-alert-card"][data-sensor="${sensor}"]`);
const field = (el, id) => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

test("SA panel: every card shows title, type + sub-ID, vehicle, IoT kit, started, ended, duration, status, gap and sensor data", async () => {
  await mountPanel({ scope: { kind: "vehicle", vehicleNumber: "AP31Z0044", busName: "Bus 1" }, query: query({ data: parsed(FIXTURE) }) });
  same($$('[data-testid="sensor-alert-card"]').map((c) => c.dataset.sensor), ["SMK", "ULT", "ALC"], "newest first, one card per record");
  const ult = card("ULT");
  same(
    [field(ult, "sensor-alert-title"), field(ult, "sensor-alert-sensor"), field(ult, "sensor-alert-vehicle"), field(ult, "sensor-alert-kit"), field(ult, "sensor-alert-started"), field(ult, "sensor-alert-ended"), field(ult, "sensor-alert-duration"), field(ult, "sensor-alert-status"), field(ult, "sensor-alert-gap"), field(ult, "sensor-alert-data")],
    ["No echo", "Ultrasonic Sensor · ULT · Sub-ID 2", "VehicleAP31Z0044", "IoT kitIOT-KIT-001", "Started at (IST)08 Nov 2026, 04:41:35 PM", "Ended at (IST)08 Nov 2026, 04:42:02 PM", "27 sec", "Ended after inactivity gap", "Ended after inactivity gapYes", "Sensor datadistance:3,reading:no_echo"]
  );
  same([ult.querySelector('[data-testid="sensor-alert-reading"]').dataset.reading, field(ult, "sensor-alert-distance")], ["no_echo", "3"]);
  const alc = card("ALC");
  same([field(alc, "sensor-alert-status"), field(alc, "sensor-alert-ended"), field(alc, "sensor-alert-duration"), field(alc, "sensor-alert-gap")], ["Ongoing", "Ended at (IST)Not ended", "1 min 35 sec", "Ended after inactivity gapNo"], "ongoing, no ended_at: 'Not ended', never a made-up time");
  same([field(card("SMK"), "sensor-alert-status"), card("SMK").querySelector('[data-testid="sensor-alert-reading"]')], ["Ended", null], "neutral Ended; no ULT reading on other sensors");
  const html = $('[data-testid="sensor-alerts"]').innerHTML;
  assert.doesNotMatch(html, /→ [01]|0_to_1|1_to_0|Previous run|previous_value/, "no transition pills or previous/new value rows");
  same(summaryValues(), { "Total alerts": 243, "IR alerts": 0, "Ultrasonic alerts": 241, "Smoke alerts": 1, "Alcohol alerts": 1, "PRS alerts": 0 }, "the response's summary, never sample constants");
  same($$('[data-testid="summary-note"]').slice(1).map((n) => n.textContent), ["0 sec total", "51 min 9 sec total", "27 sec total", "27 sec total", "0 sec total"]);
  assert.ok(text().includes("3 loaded · from the service summary"));
  const latest = $('[data-testid="sensor-alert-latest"]').textContent;
  for (const s of ["Latest sensor alert", "Smoke sensor alert", "08 Nov 2026, 05:10:00 PM IST", "Lasted 27 sec"]) assert.ok(latest.includes(s), s);
  assert.ok(text().includes("gap 60 s"), "the gap the service applied");
});

test("SA panel: responsive grid — 1 column on mobile, 2 on tablet (md), 3 on large desktop (xl); full width; no fixed heights", async () => {
  await mountPanel({ scope: { kind: "vehicle", vehicleNumber: "AP31Z0044", busName: "Bus 1" }, query: query({ data: parsed(FIXTURE) }) });
  const grid = $('[data-testid="sensor-alert-grid"]');
  for (const cls of ["grid", "grid-cols-1", "md:grid-cols-2", "xl:grid-cols-3", "gap-4"]) assert.ok(grid.classList.contains(cls), cls);
  assert.ok(!/\bw-\[|max-w-/.test(grid.className), "uses the full content width");
  for (const c of $$('[data-testid="sensor-alert-card"]')) {
    assert.ok(c.classList.contains("h-full") && !/\bh-\d|max-h-/.test(c.className.replace("h-full", "")), "no fixed height that could clip long sensor data");
    assert.ok(c.querySelector('[data-testid="sensor-alert-data"] code').className.includes("break-all"), "long sensor_data wraps");
  }
  const summary = $('[data-testid="sensor-alert-summary"]');
  for (const cls of ["grid-cols-2", "md:grid-cols-3", "xl:grid-cols-6"]) assert.ok(summary.classList.contains(cls), cls);
});

test("SA panel: sensor colours — ULT blue, SMK amber, ALC purple, IR / PRS their generic style, unknown neutral", async () => {
  const data = parsed({ ...FIXTURE, alerts: [...FIXTURE.alerts, { ...FIXTURE.alerts[0], sensor_type: "IR", sensor_sub_id: 1 }, { ...FIXTURE.alerts[0], sensor_type: "PRS", sensor_sub_id: 5 }, { ...FIXTURE.alerts[0], sensor_type: "TMP", sensor_sub_id: 9 }] });
  await mountPanel({ scope: { kind: "vehicle", vehicleNumber: "AP31Z0044", busName: "Bus 1" }, query: query({ data }) });
  const cls = (s) => card(s).className;
  assert.match(cls("ULT"), /border-l-info/);
  assert.match(cls("SMK"), /border-l-warning/);
  assert.match(cls("ALC"), /border-l-ai-ink/);
  assert.ok(card("ALC").querySelector(".bg-lavender"), "purple chip");
  same([card("IR").dataset.style, card("PRS").dataset.style, card("TMP").dataset.style], ["IRPRS", "IRPRS", "UNKNOWN"]);
  assert.match(cls("TMP"), /border-l-line-strong/);
  assert.ok(text().includes("Sensor · TMP · Sub-ID 9"), "unknown type rendered, not dropped");
});

test("SA panel: date range — Apply sends the service's strings with the sensor kept; an invalid range shows a message and sends nothing; Clear keeps the sensor", async () => {
  const changes = [];
  const props = { scope: { kind: "vehicle", vehicleNumber: "AP31Z0044", busName: "Bus 1" }, query: query({ data: parsed(FIXTURE) }), filters: { sensorSubId: 2, fromTime: null, toTime: null }, onFiltersChange: (f) => changes.push(f) };
  const { render } = await mountPanel(props);
  const setInput = async (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(el, value);
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  };
  await setInput($('[data-testid="sensor-alert-from"]'), "2026-11-11T00:00");
  await setInput($('[data-testid="sensor-alert-to"]'), "2026-11-10T00:00");
  await click($('[data-testid="sensor-alert-apply"]'));
  assert.equal($('[data-testid="sensor-alert-range-error"]').textContent, "The start must not be later than the end.");
  same(changes, [], "nothing applied");
  await setInput($('[data-testid="sensor-alert-to"]'), "2026-11-11T23:59:59");
  await click($('[data-testid="sensor-alert-apply"]'));
  assert.equal($('[data-testid="sensor-alert-range-error"]'), null);
  same(changes, [{ sensorSubId: 2, fromTime: "2026-11-11 00:00:00", toTime: "2026-11-11 23:59:59" }], "both bounds in one change; sensor kept");
  await render({ ...props, filters: changes[0] });
  assert.ok($('[data-testid="sensor-alert-range"]').textContent.includes("from 11 Nov 2026, 12:00:00 AM IST to 11 Nov 2026, 11:59:59 PM IST"));
  await click($('[data-testid="sensor-alert-clear"]'));
  same(changes.at(-1), { sensorSubId: 2, fromTime: null, toTime: null }, "Clear removes both bounds, keeps the sensor");
  same([$('[data-testid="sensor-alert-from"]').value, $('[data-testid="sensor-alert-to"]').value], ["", ""]);
  await click(radio("Smoke"));
  same(changes.at(-1), { sensorSubId: 3, fromTime: "2026-11-11 00:00:00", toTime: "2026-11-11 23:59:59" }, "the sensor filter is a server filter and keeps the applied range");
});

test("SA panel: loading, empty, error-with-retry, and a failed refresh that keeps the last good data (marked stale)", async () => {
  let retried = 0;
  const scope = { kind: "all" };
  const { render } = await mountPanel({ scope, query: query({ loading: true }), onRetry: () => retried++ });
  assert.ok($('[data-testid="sensor-alerts-loading"]'));
  assert.equal($('[data-testid="sensor-alert-range"]'), null, "no filter label while loading");
  await render({ scope, query: query({ data: parsed({ success: true, summary: { total_alerts: 0, by_sensor: [] }, count: 0, alerts: [] }) }), onRetry: () => retried++ });
  assert.ok(text().includes("No sensor alerts"));
  assert.ok(text().includes("The sensor service returned no records with these filters."));
  same(summaryValues(), { "Total alerts": 0, "IR alerts": 0, "Ultrasonic alerts": 0, "Smoke alerts": 0, "Alcohol alerts": 0, "PRS alerts": 0 });
  const err = new (ui.require("features/drive-vision/api/errors").ApiError)({ kind: "http", status: 502, errorCode: "unreachable", message: "The sensor alerts service can't be reached right now. Please try again shortly.", method: "GET", path: "/api/sensors/alerts" });
  await render({ scope, query: query({ error: err }), onRetry: () => retried++ });
  assert.ok(text().includes("Couldn't load sensor alerts") && text().includes("can't be reached right now"));
  assert.ok(!text().includes("No sensor alerts"), "an error is never shown as empty");
  await click(button("Try again") ?? button("Retry"));
  assert.equal(retried, 1);
  await render({ scope, query: query({ data: parsed(FIXTURE), error: err }), onRetry: () => retried++ });
  assert.ok($('[data-testid="sensor-alerts-stale"]'), "stale banner");
  assert.ok(text().includes("Smoke sensor alert"), "previous successful data still shown");
  await click($('[data-testid="sensor-alerts-stale"] button'));
  assert.equal(retried, 2);
});

test("SA panel: registration search only in All vehicles; lookup states explain themselves", async () => {
  const { render } = await mountPanel({ scope: { kind: "all" }, query: query({ data: parsed({ success: true, count: 4, alerts: [...FIXTURE.alerts, { ...FIXTURE.alerts[1], vehicle_number: "TS09AB1234" }] }) }) });
  const search = $('input[aria-label="Search by registration"]');
  assert.ok(search);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(search, "ts09");
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await settle();
  same($$('[data-testid="sensor-alert-card"]').map((c) => c.dataset.sensor), ["SMK"]);
  await render({ scope: { kind: "no-registration", busName: "Bus 9" }, query: query({}) });
  assert.ok(text().includes("isn't fitted to a vehicle in the vehicle registry"));
  await render({ scope: { kind: "lookup-forbidden", busName: "Bus 9" }, query: query({}) });
  assert.ok(text().includes("vehicle.read"));
});

// ── 7. The Sensors page (real component): tabs, dropdown, tenant, refresh, regression ──

// The picker's source: GET /vehicles?assigned=true. Vehicle ids (501, 502) and device ids (101, 102) differ on purpose.
const ASSIGNED_VEHICLES = [
  { id: 501, vehicleNumber: "AP31Z0044", vehicleType: "Bus", deviceAssigned: true, device: { id: 101, name: "Bus 1", terminalNo: "T-0101" } },
  { id: 502, vehicleNumber: "TS09AB1234", vehicleType: "Bus", deviceAssigned: true, device: { id: 102, name: "Bus 2", terminalNo: "T-0102" } },
];
const vehicleListRequests = () => requests.filter((r) => r.path === "/api/v1/vehicles");
const forVehicle = (vn) => ({ success: true, count: 1, alerts: vn ? [{ ...FIXTURE.alerts[0], vehicle_number: vn }] : FIXTURE.alerts });
function pageHandlers(alerts = (r) => json(200, r.query.vehicle_number === "TS09AB1234" ? forVehicle("TS09AB1234") : FIXTURE)) {
  handlers = {
    // Only the assigned=true list is a valid source; anything else answers 400 so a wrong query shows up.
    "GET /vehicles": (r) => (r.query.assigned === "true" ? envelope(ASSIGNED_VEHICLES, ASSIGNED_VEHICLES.length) : json(400, { code: 400, msg: "assigned=true expected", data: null })),
    "GET /sensors/types": () => envelope([]),
    "GET /devices/\\d+/(passenger-summary|stops/comparison|stops|bms|sensors/alcohol)": () => envelope({}),
    "GET /devices/\\d+/sensors/readings": () => envelope([], 0),
    "POST /devices/\\d+/stops/recalculate": () => envelope({ stopVisitsUpdated: 2, passengerAlerts: 0 }),
    "GET /api/sensors/alerts": alerts,
  };
}
async function mountPage(identity = IDENTITIES.viewer, selectedTenantId = null) {
  currentAccess = accessFor(identity, selectedTenantId);
  const { SensorsPage } = ui.require("components/drive-vision/sensors/sensors-page");
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  const render = () => act(async () => root.render(React.createElement(SensorsPage)));
  await render();
  await settle();
  return { render };
}
const busSelect = () => $$("select[data-select]")[0];

test("SA page: 'Sensors & Safety Monitoring' opens on Sensor Alerts — first tab, selected, coral — with the time window hidden", async () => {
  pageHandlers();
  await mountPage();
  const meta = ui.require("components/drive-vision/navigation/nav-config").getPageMeta("/drive-vision/sensors", "", new Date(), false);
  same([meta.title, meta.subtitle], ["Sensors & Safety Monitoring", "Monitor vehicle sensor activity, passenger counts, BMS reconciliation and safety alerts."]);
  assert.match(read("components/drive-vision/navigation/nav-config.ts"), /\{ label: "Sensors", screen: "sensors"/, "sidebar label stays short");
  same(tabs().map((t) => t.textContent.replace(/\d+$/, "")), ["Sensor Alerts", "Sensor vs BMS", "Stops", "BMS records", "Sensor readings"]);
  same(tabs().map((t) => t.getAttribute("aria-selected")), ["true", "false", "false", "false", "false"]);
  assert.match(tab("Sensor Alerts").className, /bg-brand/);
  assert.equal(tab("Sensor Alerts").querySelector("span[aria-label]").getAttribute("aria-label"), "243 sensor alerts", "the service's total_alerts on the tab");
  assert.equal($('[role="tabpanel"]').getAttribute("aria-labelledby"), tab("Sensor Alerts").id);
  assert.ok($('[data-testid="sensor-alert-latest"]'), "alert dashboard is the first content");
  assert.equal($('[data-testid="time-window"]'), null, "time window hidden on Sensor Alerts");
  assert.match($('[data-testid="alerts-window-note"]').textContent, /time window applies to Sensor vs BMS, Stops, BMS records and Sensor readings only/);
  assert.equal(button("Recalculate"), undefined);
  assert.equal($('[data-testid="alcohol-card"]'), null, "per-bus cards live on the reconciliation tabs");
  await click(tab("Sensor vs BMS"));
  assert.ok($('[data-testid="time-window"]'), "time window back on the reconciliation tabs");
  assert.equal($('[data-testid="alerts-window-note"]'), null);
  // Keyboard: arrow keys move between tabs.
  await act(async () => tab("Sensor vs BMS").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  await settle();
  assert.equal(tab("Sensor Alerts").getAttribute("aria-selected"), "true");
});

test("SA page: the vehicle dropdown (GET /vehicles?assigned=true) supplies the registration (not vehicle id / device id / terminal / kit) and loads on open", async () => {
  pageHandlers();
  await mountPage();
  same(alertRequests().map((r) => r.search), ["?tenant_id=10&vehicle_number=AP31Z0044&max_gap_seconds=60"], "first vehicle, viewer's own tenant");
  same(vehicleListRequests().map((r) => r.query), [{ assigned: "true", pageNumber: "1", pageSize: "100" }], "one assigned-vehicles request");
  assert.ok(!requests.some((r) => r.path === "/api/v1/devices"), "the device list is no longer the picker's source");
  assert.ok(!requests.some((r) => /^\/api\/v1\/vehicles\/\d+$/.test(r.path)), "no per-vehicle lookup: the list carries the number");
  for (const r of alertRequests()) assert.doesNotMatch(r.search, /501|101|T-0101|IOT-KIT/);
  assert.equal($$("select[data-select]").length, 1, "one vehicle dropdown, no second picker");
  same([...busSelect().options].map((o) => o.value), ["", "all", "501", "502"], "values are vehicle ids");
  same([...busSelect().options].slice(2).map((o) => o.textContent), ["AP31Z0044", "TS09AB1234"], "labels are vehicle numbers");
  assert.ok(text().includes("No echo"));
  assert.equal($('[data-testid="sensor-alerts-scope"]').textContent, "AP31Z0044");
});

test("SA page: switching vehicle clears the previous vehicle's alerts while loading, and a late response can't overwrite a newer choice", async () => {
  const gates = {};
  pageHandlers((r) => {
    const k = r.query.vehicle_number ?? "*";
    if (k === "AP31Z0044") return json(200, FIXTURE);
    gates[k] = deferred();
    return gates[k].promise.then((body) => json(200, body));
  });
  await mountPage();
  assert.ok(text().includes("Smoke sensor alert"));
  await choose(busSelect(), "502");
  assert.equal(alertRequests().at(-1).search, "?tenant_id=10&vehicle_number=TS09AB1234&max_gap_seconds=60");
  assert.equal($$('[data-testid="sensor-alert-card"]').length, 0, "Bus 1's alerts are gone while Bus 2 loads");
  assert.ok(!$('[data-testid="sensor-alerts"]').textContent.includes("AP31Z0044"));
  await choose(busSelect(), "all");
  assert.equal(alertRequests().at(-1).search, "?tenant_id=10&max_gap_seconds=60", "All vehicles omits vehicle_number");
  gates.TS09AB1234.resolve(forVehicle("TS09AB1234")); // late answer for the abandoned choice
  await settle();
  // Scoped to the alerts panel: the vehicle numbers are also the dropdown's own option labels now.
  assert.ok(!$('[data-testid="sensor-alerts"]').textContent.includes("TS09AB1234"), "stale response ignored");
  gates["*"].resolve({ success: true, count: 2, alerts: [FIXTURE.alerts[2], { ...FIXTURE.alerts[1], vehicle_number: "KA01AA0001" }] });
  await settle();
  assert.equal($('[data-testid="sensor-alerts-scope"]').textContent, "All vehicles");
  assert.ok(text().includes("KA01AA0001"));
  assert.ok($('input[aria-label="Search by registration"]'));
});

test("SA page: sensor and date filters go into one request, keep the vehicle, survive a vehicle change, and the summary is the filtered response's", async () => {
  const filtered = { ...FIXTURE, filters: { ...FIXTURE.filters, sensor_sub_id: 2 }, summary: { total_alerts: 5, by_sensor: [{ sensor_sub_id: 2, sensor_type: "ULT", alert_count: 5, total_lasted_seconds: 300 }] }, count: 5, alerts: [FIXTURE.alerts[0]] };
  pageHandlers((r) => json(200, r.query.sensor_sub_id === "2" ? filtered : FIXTURE));
  await mountPage();
  same(summaryValues()["Total alerts"], 243);
  await click(radio("Ultrasonic"));
  same(alertRequests().at(-1).query, { tenant_id: "10", vehicle_number: "AP31Z0044", sensor_sub_id: "2", max_gap_seconds: "60" });
  same(summaryValues(), { "Total alerts": 5, "IR alerts": 0, "Ultrasonic alerts": 5, "Smoke alerts": 0, "Alcohol alerts": 0, "PRS alerts": 0 }, "the filtered response's own summary, not the earlier unfiltered one");
  const setInput = async (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(el, value);
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  };
  let release;
  handlers["GET /api/sensors/alerts"] = () => new Promise((ok) => (release = () => ok(json(200, filtered))));
  await setInput($('[data-testid="sensor-alert-from"]'), "2026-11-10T00:00");
  await setInput($('[data-testid="sensor-alert-to"]'), "2026-11-10T23:59");
  await click($('[data-testid="sensor-alert-apply"]'));
  same(alertRequests().at(-1).query, { tenant_id: "10", vehicle_number: "AP31Z0044", sensor_sub_id: "2", from_time: "2026-11-10 00:00:00", to_time: "2026-11-10 23:59:00", max_gap_seconds: "60" }, "one request with both bounds; vehicle and sensor kept");
  assert.ok($('[data-testid="sensor-alerts-loading"]'), "loading feedback while the filter applies");
  assert.equal($('[data-testid="sensor-alert-range"]'), null, "no filter label until its data has loaded");
  release();
  await settle();
  assert.ok($('[data-testid="sensor-alert-range"]').textContent.includes("from 10 Nov 2026, 12:00:00 AM IST to 10 Nov 2026, 11:59:00 PM IST"));
  handlers["GET /api/sensors/alerts"] = () => json(200, filtered);
  await choose(busSelect(), "502");
  same(alertRequests().at(-1).query, { tenant_id: "10", vehicle_number: "TS09AB1234", sensor_sub_id: "2", from_time: "2026-11-10 00:00:00", to_time: "2026-11-10 23:59:00", max_gap_seconds: "60" }, "filters survive a vehicle change");
  const n = alertRequests().length;
  await setInput($('[data-testid="sensor-alert-from"]'), "2026-11-12T00:00");
  await click($('[data-testid="sensor-alert-apply"]'));
  assert.ok($('[data-testid="sensor-alert-range-error"]'), "invalid range: message");
  assert.equal(alertRequests().length, n, "…and no request");
  await click($('[data-testid="sensor-alert-clear"]'));
  same(alertRequests().at(-1).query, { tenant_id: "10", vehicle_number: "TS09AB1234", sensor_sub_id: "2", max_gap_seconds: "60" }, "Clear drops both bounds, keeps the vehicle and the sensor");
});

test("SA page: All vehicles works without a bus; the per-bus tabs ask for one and send no per-bus requests", async () => {
  pageHandlers();
  await mountPage();
  await choose(busSelect(), "all");
  assert.ok(text().includes("Smoke sensor alert"), "Sensor Alerts never shows 'Choose a bus'");
  assert.ok(!$('[data-testid="sensor-alerts"]').textContent.includes("Choose a bus"));
  const before = requests.filter((r) => /\/devices\/\d+\//.test(r.path)).length;
  await click(tab("Stops"));
  assert.ok(text().includes("Passenger counts, stops, BMS records and sensor readings are per bus"));
  assert.equal(requests.filter((r) => /\/devices\/\d+\//.test(r.path)).length, before, "no per-bus request without a bus");
  assert.equal($('[data-testid="alcohol-card"]'), null);
});

test("SA page: with no vehicle to choose (no vehicle.read, or no assigned vehicles) Sensor Alerts covers every permitted vehicle", async () => {
  pageHandlers();
  handlers["GET /vehicles"] = () => envelope([], 0);
  await mountPage();
  same(alertRequests().map((r) => r.search), ["?tenant_id=10&max_gap_seconds=60"]);
  assert.ok($('[data-testid="sensors-no-assigned-vehicles"]'), "explains that no vehicle has a device");
  assert.ok(text().includes("Smoke sensor alert"));
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  window.document.body.innerHTML = "";
  requests = [];
  pageHandlers();
  await mountPage({ ...IDENTITIES.viewer, permissions: ["sensor.read"] });
  same(alertRequests().map((r) => r.search), ["?tenant_id=10&max_gap_seconds=60"]);
  assert.ok(!requests.some((r) => r.path === "/api/v1/vehicles"), "no vehicle list without vehicle.read");
  assert.ok(text().includes("Smoke sensor alert"));
});

test("SA page: Safe-Fare Admin — no all-tenant request; selecting the demo tenant loads it; another tenant is told it's demo-only", async () => {
  pageHandlers();
  const tc = ui.require("features/drive-vision/api/tenant-context");
  const page = await mountPage(IDENTITIES.platformAdmin, null);
  same(alertRequests(), [], "all-tenants mode sends nothing");
  assert.ok(text().includes("Select the demo tenant (tenant 10)"));

  let release;
  handlers["GET /api/sensors/alerts"] = () => new Promise((r) => (release = () => r(json(200, forVehicle("AP31Z0044")))));
  await act(async () => {
    tc.setTenantSelection({ tenantId: DEMO_TENANT, code: "DEMO", name: "Demo", header: "X-Tenant-Id" });
    currentAccess = accessFor(IDENTITIES.platformAdmin, DEMO_TENANT);
  });
  await page.render();
  await settle();
  assert.equal(alertRequests().at(-1).search, "?tenant_id=10&vehicle_number=AP31Z0044&max_gap_seconds=60");
  release();
  await settle();
  same($$('[data-testid="sensor-alert-card"]').map((c) => c.dataset.sensor), ["ULT"]);

  requests = [];
  await act(async () => {
    tc.setTenantSelection({ tenantId: 7, code: "T7", name: "Tenant 7", header: "X-Tenant-Id" });
    currentAccess = accessFor(IDENTITIES.platformAdmin, 7);
  });
  await page.render();
  await settle();
  same(alertRequests(), [], "nothing is sent for another tenant");
  assert.equal($$('[data-testid="sensor-alert-card"]').length, 0, "the demo tenant's alerts are hidden at once");
  assert.ok(text().includes("only available in the demo tenant (tenant 10)"));
});
test("SA page: Refresh reloads the active tab only; a failed alerts refresh keeps the last alerts with Retry; Recalculate never calls the alerts API", async () => {
  pageHandlers();
  await mountPage(IDENTITIES.tenantAdmin);
  const n = alertRequests().length;
  handlers["GET /api/sensors/alerts"] = () => json(502, { error: "unreachable" });
  await click(button("Refresh"));
  assert.equal(alertRequests().length, n + 1);
  assert.ok($('[data-testid="sensor-alerts-stale"]'), "marked stale");
  assert.ok(text().includes("Smoke sensor alert"), "last good alerts kept");
  handlers["GET /api/sensors/alerts"] = () => json(200, FIXTURE);
  await click($('[data-testid="sensor-alerts-stale"] button'));
  assert.equal($('[data-testid="sensor-alerts-stale"]'), null);

  await click(tab("Sensor vs BMS"));
  const before = alertRequests().length;
  const summaries = () => requests.filter((r) => r.path.endsWith("/passenger-summary")).length;
  const s0 = summaries();
  await click(button("Refresh"));
  assert.ok(summaries() > s0, "Refresh on a reconciliation tab reloads its BFF data");
  assert.equal(alertRequests().length, before, "…and not Sensor Alerts");
  await click(button("Recalculate"));
  const confirm = $$('[role="alertdialog"] button').find((b) => b.textContent.trim() === "Recalculate");
  await click(confirm);
  await settle();
  assert.ok(requests.some((r) => r.method === "POST" && /\/stops\/recalculate$/.test(r.path)), "existing recalculation ran");
  assert.equal(alertRequests().length, before, "no Sensor Alerts request from Recalculate");
  assert.ok(button("Add reading"), "Add reading still offered on the reconciliation tabs");
});

test("SA page regression: the four existing tabs still load their own BFF data for the chosen bus", async () => {
  pageHandlers();
  await mountPage();
  const hit = (suffix) => requests.some((r) => r.path === `/api/v1/devices/101/${suffix}`);
  assert.ok(hit("passenger-summary") && hit("sensors/alcohol"), "summary and alcohol card");
  await click(tab("Sensor vs BMS"));
  assert.ok(hit("stops/comparison"));
  await click(tab("Stops"));
  assert.ok(hit("stops"));
  await click(tab("BMS records"));
  assert.ok(hit("bms"));
  await click(tab("Sensor readings"));
  assert.ok(hit("sensors/readings"));
  for (const label of ["Bus capacity", "On board · BMS", "On board · sensor", "Latest difference", "Match rate", "Over-capacity stops"]) assert.ok(text().includes(label), label);
  assert.ok($('[data-testid="alcohol-card"]'));
  assert.ok(button("Refresh"));
});

test("SA access: Sensors stays on sensor.read; the registration lookup needs vehicle.read; Add reading still refreshes only the BFF views", () => {
  const p = ui.require("features/drive-vision/access/access-policy");
  same(p.SCREENS.sensors.requires.anyOf, ["sensor.read"]);
  assert.equal(p.canAccessScreen(accessFor(IDENTITIES.viewer), "sensors"), true);
  assert.equal(p.canAccessScreen(accessFor(IDENTITIES.driver), "sensors"), false);
  assert.equal(p.canAccessScreen(accessFor(IDENTITIES.fleetOwner), "sensors"), false, "no sensor.read");
  assert.equal(p.canViewWidget(accessFor(IDENTITIES.viewer), "sensors.deviceChoices"), true);
  assert.equal(p.canViewWidget(accessFor({ ...IDENTITIES.viewer, permissions: ["sensor.read", "device.read"] }), "sensors.deviceChoices"), false, "the vehicle picker needs vehicle.read");
  const page = read("components/drive-vision/sensors/sensors-page.tsx");
  assert.match(page, /onSaved=\{\(\) => \(setAdding\(false\), refreshAll\(\)\)\}/, "Add reading → refreshAll (BFF views only)");
  const recalc = page.slice(page.indexOf("sensorService.recalculate"), page.indexOf("sensorService.recalculate") + 400);
  assert.match(recalc, /refreshAll\(\)/);
  assert.doesNotMatch(recalc, /alertsQ|refreshScreen/);
});

test("SA page: a vehicle row without a device (or without a number) isn't offered and never sends an empty vehicle_number", async () => {
  pageHandlers();
  handlers["GET /vehicles"] = () => envelope([{ id: 503, vehicleNumber: "KA01AA0001", deviceAssigned: true, device: null }, { id: 504, vehicleNumber: " ", deviceAssigned: true, device: { id: 104 } }, ASSIGNED_VEHICLES[1]], 3);
  await mountPage();
  same([...busSelect().options].map((o) => o.value), ["", "all", "502"]);
  same(alertRequests().map((r) => r.search), ["?tenant_id=10&vehicle_number=TS09AB1234&max_gap_seconds=60"]);
  for (const r of alertRequests()) assert.doesNotMatch(r.search, /vehicle_number=(&|$)/);
  assert.ok(requests.some((r) => r.path === "/api/v1/devices/102/passenger-summary"), "device.id of the chosen vehicle");
});

test("SA panel: 'Object Very Close' reads the same on the Latest Sensor Alert and the card — title, red badge, no 'Distance unavailable'", async () => {
  const ovc = { ...FIXTURE.alerts[0], started_at: "2026-11-09 09:00:00", ended_at: "2026-11-09 09:00:12", lasted_seconds: 12, sensor_data: "distance:NA,reading:object very close" };
  await mountPanel({ scope: { kind: "vehicle", vehicleNumber: "AP31Z0044", busName: "Bus 1" }, query: query({ data: parsed({ ...FIXTURE, alerts: [ovc, ...FIXTURE.alerts] }) }) });
  const latest = $('[data-testid="sensor-alert-latest"]');
  const first = $$('[data-testid="sensor-alert-card"]')[0];
  assert.ok(latest.textContent.includes("Object Very Close"), "latest: title");
  assert.equal(field(first, "sensor-alert-title"), "Object Very Close", "card: title");
  for (const el of [latest, first]) {
    const badge = el.querySelector('[data-testid="sensor-alert-reading"]');
    same([badge.dataset.reading, badge.textContent], ["object_very_close", "Object Very Close"]);
    assert.match(badge.innerHTML, /danger/, "danger tone");
    assert.ok(!el.textContent.includes("Distance unavailable"), "no 'Distance unavailable'");
  }
  assert.equal(first.querySelector('[data-testid="sensor-alert-distance"]'), null, "no distance row; distance:NA is not a number");
  const ult = $$('[data-testid="sensor-alert-card"]').find((c) => field(c, "sensor-alert-title") === "No echo");
  same([ult.querySelector('[data-testid="sensor-alert-reading"]').textContent, field(ult, "sensor-alert-distance")], ["No echo", "3"], "NO_ECHO card unchanged");
});
