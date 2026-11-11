// Passenger Analytics demo journey (Sensors screen: Sensor vs BMS, Stops, BMS records, Sensor readings).
// SIMULATED DATA from one fixture (passenger-demo-fixture.ts). MOCKED ONLY: the live services are stubs that record
// calls, so the tests can prove the demo never calls them and live mode still does. Live rows below are synthetic.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const pure = createRealm({ process: { env: {} }, Intl, Date });
const demo = () => pure.require("components/drive-vision/sensors/passenger-demo");
const fixture = () => pure.require("components/drive-vision/sensors/passenger-demo-fixture").PASSENGER_DEMO_JOURNEY;

// ── Flag ─────────────────────────────────────────────────────────────────────

test("PD flag: off by default — only the exact string \"true\" enables it; .env.example ships false", () => {
  const { passengerDemoEnabled } = demo();
  same([passengerDemoEnabled(undefined), passengerDemoEnabled(""), passengerDemoEnabled("false"), passengerDemoEnabled("1"), passengerDemoEnabled("TRUE"), passengerDemoEnabled("true")], [false, false, false, false, false, true]);
  assert.equal(passengerDemoEnabled(), false, "unset in this environment → off");
  assert.match(fs.readFileSync(path.join(ROOT, ".env.example"), "utf8"), /^NEXT_PUBLIC_PASSENGER_DEMO_MODE=false$/m);
  assert.match(read("components/drive-vision/sensors/passenger-demo.ts"), /process\.env\.NEXT_PUBLIC_PASSENGER_DEMO_MODE/, "direct reference, so Next inlines it");
});

// ── Calculations ─────────────────────────────────────────────────────────────

test("PD calculations: the formulas, on their own", () => {
  const d = demo();
  same([d.nextOnboard(12, 5, 2), d.stopDifference(18, 19), d.matchRate(2, 5), d.matchRate(0, 0)], [15, -1, 40, 0]);
  same([d.meanAbsoluteError([0, -1, 0, -1, -3]), d.maxAbsoluteError([0, -1, 0, -1, -3]), d.meanAbsoluteError([])], [1, 3, 0]);
  same(d.overCapacityStops([{ bmsOverCapacity: false, sensorOverCapacity: false }, { bmsOverCapacity: true, sensorOverCapacity: false }, { bmsOverCapacity: false, sensorOverCapacity: true }]), 2);
});

test("PD journey: derived from the fixture's inputs — BMS 22, sensor 19, difference −3, 2 exact, 3 mismatched, 40 %, MAE 1, max 3, 0 over capacity", () => {
  const j = demo().DEMO_JOURNEY;
  same(j.bus, { busNumber: "TS09UB2180", route: "218", routeName: "Hyderabad City Route", capacity: 44, date: "2026-11-11", startingPassengers: 12 });
  same(j.stops.map((s) => s.bmsActual), [15, 19, 16, 23, 22], "12 + 30 − 20 = 22");
  same(j.stops.map((s) => s.sensorReported), [15, 18, 16, 22, 19], "12 + 29 − 22 = 19");
  same(j.stops.map((s) => s.difference), [0, -1, 0, -1, -3]);
  same(j.stops.map((s) => s.status), ["EXACT", "MISMATCH", "EXACT", "MISMATCH", "MISMATCH"]);
  same(j.dashboard, { busCapacity: 44, onboardBms: 22, onboardSensor: 19, latestDifference: -3, matchRate: 40, overCapacityStops: 0 });
  same(j.comparison, { stops: 5, compared: 5, exactMatches: 2, mismatches: 3, matchRate: 40, meanAbsoluteError: 1, maxAbsoluteError: 3, boardedBms: 30, boardedSensor: 29, alightedBms: 20, alightedSensor: 22 });
  assert.ok(demo().readingsMatchStops(j), "the five sensor readings (15, 18, 16, 22, 19) match the sensor progression");
  same(j.bmsRecords.map((r) => [r.time, r.stop, r.seq, r.boarded, r.alighted, r.onboard, r.bmsId]), [
    ["08:15", "Ameerpet", 1, 5, 2, 15, "BMS-001"],
    ["08:25", "SR Nagar", 2, 8, 4, 19, "BMS-001"],
    ["08:35", "ESI Hospital", 3, 3, 6, 16, "BMS-001"],
    ["08:45", "Erragadda", 4, 10, 3, 23, "BMS-001"],
    ["08:55", "Moosapet", 5, 4, 5, 22, "BMS-001"],
  ]);
  same(j.alcohol, { status: "NO_READING", time: null, sensor: null, value: null, message: "No active alcohol reading in this window." }, "no alcohol reading invented");
});

test("PD one source of truth: the fixture stores inputs only; changing an input changes every derived value", () => {
  const f = fixture();
  for (const s of f.stops) for (const k of ["bmsActual", "sensorReported", "difference", "status", "onboard"]) assert.ok(!(k in s), `${k} is derived, not stored`);
  const changed = demo().deriveJourney({ ...f, stops: f.stops.map((s) => (s.seq === 5 ? { ...s, sensorOut: 5 } : s)) });
  same([changed.dashboard.onboardSensor, changed.dashboard.latestDifference, changed.comparison.exactMatches, changed.dashboard.matchRate], [21, -1, 2, 40]);
  const over = demo().deriveJourney({ ...f, bus: { ...f.bus, capacity: 20 } });
  same(over.dashboard.overCapacityStops, 2, "Erragadda (23 BMS, 22 sensor) and Moosapet (22 BMS) exceed 20");
});

test("PD response shapes: Stops and Sensor vs BMS carry the same five records and statuses; times are the journey's IST times", async () => {
  const d = demo();
  const stops = d.demoStops().stops;
  const comp = d.demoComparison().stops;
  same(stops.map((s) => [s.stopName, s.bmsStopSequence, s.actualCount, s.sensorCount, s.countOfPeople, s.difference, s.comparisonStatus]), comp.map((c) => [c.stopName, c.bms.stopSequence, c.bms.actualCount, c.sensor.sensorCount, c.sensor.count, c.difference.count, c.comparisonStatus]));
  same(stops[0].stopVisitTime, "2026-11-11T02:45:00.000Z", "08:15 IST");
  same(d.demoComparison().summary, { visits: 5, visitsWithBms: 5, compared: 5, exactMatches: 2, mismatches: 3, overCapacityStops: 0, missingBmsStops: 0, missingSensorStops: 0, matchRatePct: 40, meanAbsoluteError: 1, maxAbsoluteError: 3, bmsTotalBoarded: 30, sensorTotalBoarded: 29, bmsTotalAlighted: 20, sensorTotalAlighted: 22 });
  const r = d.demoReadings();
  same(r.items.map((x) => [x.timestamp, x.sensorId, x.sensorName, x.sensorData, x.numericValue, x.activeStatus]), [
    ["2026-11-11T02:45:10.000Z", "SEN-001", "PASSENGER_COUNT", "ENTRY", 15, true],
    ["2026-11-11T02:55:32.000Z", "SEN-001", "PASSENGER_COUNT", "ENTRY", 18, true],
    ["2026-11-11T03:05:45.000Z", "SEN-001", "PASSENGER_COUNT", "EXIT", 16, true],
    ["2026-11-11T03:15:18.000Z", "SEN-001", "PASSENGER_COUNT", "ENTRY", 22, true],
    ["2026-11-11T03:25:40.000Z", "SEN-001", "PASSENGER_COUNT", "EXIT", 19, true],
  ]);
  same(d.demoAlcohol(), { detectionStatus: "NO_READING", alcoholDetected: null, sensorId: null, sensorData: null, timestamp: null });
  same(JSON.stringify(await d.passengerDemoSource.comparison()), JSON.stringify(await d.passengerDemoSource.comparison()), "the same records every time");
  assert.doesNotMatch(read("components/drive-vision/sensors/passenger-demo.ts") + read("components/drive-vision/sensors/passenger-demo-fixture.ts"), /from "@\/features\/drive-vision\/api\/(client|sensor-service|sensor-alerts-service)"|\bapi\.(get|post|put|delete)|fetch\(|localStorage|sessionStorage/, "the demo never calls or writes anything");
});

// ── The Sensors screen ───────────────────────────────────────────────────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/sensors", pretendToBeVisual: true });
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

const LIVE = { busCapacity: 50, capacitySource: "VEHICLE", latestActualCount: 7, latestSensorCount: 8, latestDifference: 1, matchRatePct: 100, matchedStops: 1, comparedStops: 1, overCapacityStops: 0, totalStops: 1 };
const LIVE_STOP = { stopId: 9, stopName: "Live Stop", stopVisitTime: "2026-11-10T04:00:00Z", bms: { stopSequence: 1, boarded: 2, alighted: 0, actualCount: 7 }, sensor: { boarded: 3, alighted: 0, sensorCount: 8 }, difference: { count: 1 }, comparisonStatus: "MISMATCH" };
let calls;
let failLive = false;
const live = (name, value) => async (...args) => {
  calls.push([name, args[0]]);
  if (failLive) throw new (ui().require("features/drive-vision/api/errors").ApiError)({ kind: "http", status: 503, message: "Passenger service unavailable.", method: "GET", path: `/devices/${args[0]}/${name}` });
  return value;
};
const sensorService = {
  sensorTypes: async () => ({ items: [{ sensorSubId: 3, sensorName: "IR Sensor" }], total: 1, source: null }),
  passengerSummary: live("passenger-summary", LIVE),
  comparison: live("comparison", { stops: [LIVE_STOP], summary: { visits: 1, compared: 1, exactMatches: 0, mismatches: 1 } }),
  stops: live("stops", { stops: [] }),
  bms: live("bms", { rows: [] }),
  readings: live("readings", { items: [], total: 0, source: null }),
  alcohol: live("alcohol", { detectionStatus: "NO_READING" }),
  sendReadings: live("sendReadings", {}),
  recalculate: live("recalculate", {}),
};
// Live Sensor Alerts (synthetic): one ULT record; the service's own total drives the tab badge.
const ALERTS = {
  success: true,
  filters: null,
  summary: { total_alerts: 3, by_sensor: [{ sensor_sub_id: 2, sensor_type: "ULT", alert_count: 3, total_lasted_seconds: 81 }] },
  count: 1,
  alerts: [{ tenant_id: 10, vehicle_number: "AP31Z0044", iot_kit: "IOT-KIT-001", sensor_sub_id: 2, sensor_type: "ULT", started_at: "2026-11-10 16:41:35", sensor_data: "distance:3,reading:no_echo", ongoing: false, ended_after_gap: true, ended_at: "2026-11-10 16:42:02", lasted_seconds: 27 }],
};
const VEHICLES = { items: [{ id: 7, vehicleNumber: "AP31Z0044", deviceAssigned: true, device: { id: 1215, name: "Bus 1", terminalNo: "13600000003" } }], total: 1, truncated: false, source: null };

function makeRealm(flag) {
  const stubs = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push() {}, replace() {} }), usePathname: () => "/drive-vision/sensors" },
    "@/features/drive-vision/api/sensor-service": { sensorService },
    "@/features/drive-vision/api/sensor-alerts-service": {
      sensorAlertsService: {
        list: async (...a) => {
          calls.push(["alerts", a[0], a[1]]);
          if (failLive) throw new (ui().require("features/drive-vision/api/errors").ApiError)({ kind: "http", status: 502, message: "The sensor alerts service can't be reached right now.", method: "GET", path: "/api/sensors/alerts" });
          return ALERTS;
        },
      },
    },
    "@/features/drive-vision/api/vehicle-registry-service": { vehicleRegistryService: { listAllVehicles: async () => (calls.push(["vehicles"]), VEHICLES) } },
    "@/features/drive-vision/access/use-access": { useAccess: () => ({ tenantId: 10 }), useActionGate: () => ({ allowed: true, tenantBlocked: false }), useCan: () => true },
    "@/features/drive-vision/access/access-policy": { ...pure.require("features/drive-vision/access/access-policy"), canViewWidget: () => true },
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
  const env = { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test", ...(flag === undefined ? {} : { NEXT_PUBLIC_PASSENGER_DEMO_MODE: flag }) };
  return createRealm({ window, document: window.document, HTMLElement: window.HTMLElement, navigator: window.navigator, ResizeObserver: globalThis.ResizeObserver, Intl, Date, URL, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, process: { env }, console: { ...console, error() {}, warn() {} } }, modules);
}
const realms = { on: makeRealm("true"), off: makeRealm(undefined) };
let current = realms.on;
const ui = () => current;

const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
let root;
async function mountPage(which) {
  current = realms[which];
  calls = [];
  const host = window.document.body.appendChild(window.document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(React.createElement(current.require("components/drive-vision/sensors/sensors-page").SensorsPage)));
  await settle();
  return host;
}
test.afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  window.document.body.innerHTML = "";
  failLive = false;
});
const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = () => window.document.body.textContent;
const click = async (el) => {
  await act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
};
const tab = (label) => $$("[role='tab']").find((t) => t.textContent.trim().startsWith(label));
const button = (label) => $$("button").find((b) => b.textContent.trim() === label);
const tableRows = () => $$("tbody tr");
const PER_BUS = ["passenger-summary", "comparison", "stops", "bms", "readings", "alcohol", "sendReadings", "recalculate"];
const liveBusCalls = () => calls.filter((c) => PER_BUS.includes(c[0]));

test("PD screen (flag on): passenger tabs show one compact journey row — no Data switch, no DEMO DATA badge, no banner; Sample journey note kept", async () => {
  await mountPage("on");
  await click(tab("Sensor vs BMS"));
  const ctx = $("[data-testid='journey-context']");
  assert.ok(ctx, "compact journey context");
  same([$("[data-testid='journey-bus']").textContent, $("[data-testid='journey-date']").textContent, $("[data-testid='sample-journey-note']").textContent], ["TS09UB2180", "11 November 2026", "Sample journey"]);
  assert.ok(ctx.textContent.includes("Route 218") && ctx.textContent.includes("Hyderabad City Route"));
  assert.match(ctx.className, /flex-wrap/, "wraps on phones");
  for (const gone of ["data-source", "demo-journey", "passenger-demo-banner", "vehicle-scope-line", "time-window"]) assert.equal($(`[data-testid='${gone}']`), null, gone);
  for (const phrase of ["DEMO DATA", "Live vehicles", "Demo journey", "not real passenger", "simulated demo data"]) assert.ok(!text().includes(phrase), phrase);
  assert.equal($$("[data-testid='journey-context']").length, 1, "no duplicate journey description");
  same(liveBusCalls(), [], "the passenger tabs never call the live passenger APIs");
  assert.equal(button("Recalculate"), undefined, "no writes on the sample journey");
  assert.equal(button("Add reading"), undefined);
});

test("PD Sensor vs BMS: the shared summary cards, the comparison metrics, five records with Exact (green) / Mismatch (orange), and charts", async () => {
  await mountPage("on");
  await click(tab("Sensor vs BMS"));
  const summary = $("section[aria-label='Passenger summary']").textContent;
  for (const s of ["Bus capacity44", "On board · BMS22", "On board · sensor19", "Latest difference-3", "Match rate40%", "Over-capacity stops0"]) assert.ok(summary.includes(s), s);
  const strip = Object.fromEntries($$("[data-testid='comparison-summary'] > div").map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]));
  same(strip, { Stops: "5", Compared: "5", "Exact matches": "2", Mismatches: "3", "Match rate": "40%", "Mean abs. error": "1", "Max abs. error": "3", "Boarded BMS / sensor": "30 / 29", "Alighted BMS / sensor": "20 / 22" });
  const rows = tableRows();
  assert.equal(rows.length, 5);
  const status = rows.map((r) => r.querySelector("td:nth-child(8) span"));
  same(status.map((s) => s.textContent), ["Exact", "Mismatch", "Exact", "Mismatch", "Mismatch"]);
  assert.match(status[0].className, /success/, "Exact: green");
  assert.match(status[1].className, /warning/, "Mismatch: the existing orange warning tone");
  same(rows.map((r) => r.querySelector("td:nth-child(7)").textContent), ["0", "-1", "0", "-1", "-3"]);
  assert.ok($("[data-testid='passenger-demo-charts']"), "charts kept");
  assert.ok($("[data-testid='demo-match-rate']").textContent.includes("mean abs. error 1.00"));
});

test("PD tabs: Stops, BMS records and Sensor readings show the same journey — five rows each, same context and cards; no new records", async () => {
  await mountPage("on");
  await click(tab("Sensor vs BMS"));
  const firstCards = $("section[aria-label='Passenger summary']").textContent;
  const comparisonRows = tableRows().map((r) => [r.querySelector("td:nth-child(2) p").textContent, r.querySelector("td:nth-child(8)").textContent]);

  await click(tab("Stops"));
  let rows = tableRows();
  assert.equal(rows.length, 5);
  same(rows.map((r) => [r.querySelector("td:nth-child(2)").textContent, r.querySelector("td:nth-child(10)").textContent]), comparisonRows, "Stops and Sensor vs BMS: same records, same statuses");
  same(rows.map((r) => r.querySelector("td:nth-child(8)").textContent), ["15", "18", "16", "22", "19"], "sensor reported");
  assert.ok(rows[4].textContent.includes("Three passenger discrepancy."), "notes");
  assert.equal($("section[aria-label='Passenger summary']").textContent, firstCards);

  await click(tab("BMS records"));
  rows = tableRows();
  same(
    rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent)),
    [
      ["11 Nov, 08:15", "Ameerpet", "1", "5", "2", "15", "BMS-001"],
      ["11 Nov, 08:25", "SR Nagar", "2", "8", "4", "19", "BMS-001"],
      ["11 Nov, 08:35", "ESI Hospital", "3", "3", "6", "16", "BMS-001"],
      ["11 Nov, 08:45", "Erragadda", "4", "10", "3", "23", "BMS-001"],
      ["11 Nov, 08:55", "Moosapet", "5", "4", "5", "22", "BMS-001"],
    ],
    "chronological"
  );

  await click(tab("Sensor readings"));
  rows = tableRows();
  same(
    rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent)),
    [
      ["11 Nov, 08:15", "SEN-001", "PASSENGER_COUNT", "ENTRY", "15", "Active"],
      ["11 Nov, 08:25", "SEN-001", "PASSENGER_COUNT", "ENTRY", "18", "Active"],
      ["11 Nov, 08:35", "SEN-001", "PASSENGER_COUNT", "EXIT", "16", "Active"],
      ["11 Nov, 08:45", "SEN-001", "PASSENGER_COUNT", "ENTRY", "22", "Active"],
      ["11 Nov, 08:55", "SEN-001", "PASSENGER_COUNT", "EXIT", "19", "Active"],
    ]
  );
  const alcohol = $("[data-testid='alcohol-card']").textContent;
  for (const s of ["No reading", "No active alcohol reading in this window.", "TimeUnavailable", "SensorUnavailable", "ValueUnavailable"]) assert.ok(alcohol.includes(s), s);
  assert.equal($("[data-testid='journey-date']").textContent, "11 November 2026", "the journey survives tab switches");
  assert.equal($("section[aria-label='Passenger summary']").textContent, firstCards);
  same(liveBusCalls(), []);
});

test("PD Sensor Alerts (flag on): unchanged — first tab, live vehicle picker, the live service with the live vehicle number and tenant, live cards and badge; the sample bus never leaks", async () => {
  await mountPage("on");
  assert.equal(tab("Sensor Alerts").getAttribute("aria-selected"), "true", "still the first, default tab");
  assert.ok($("[data-testid='alerts-window-note']"), "original filter panel");
  assert.ok($("#sn-bus"), "the live vehicle picker");
  assert.equal($("[data-testid='journey-context']"), null, "no journey row on Sensor Alerts");
  assert.ok($("[data-testid='vehicle-scope-line']").textContent.startsWith("AP31Z0044"));
  const alertCalls = calls.filter((c) => c[0] === "alerts");
  assert.ok(alertCalls.length >= 1);
  for (const c of alertCalls) {
    assert.equal(c[1].vehicleNumber, "AP31Z0044", "the live vehicle's number");
    assert.equal(c[2], 10, "the caller's tenant, as before");
  }
  assert.ok(!JSON.stringify(calls).includes("TS09UB2180"), "the sample bus is never sent anywhere");
  assert.equal($$("[data-testid='sensor-alert-card']").length, 1, "live alert cards");
  assert.ok(tab("Sensor Alerts").outerHTML.includes("3 sensor alerts"), "badge from the service's total");
});

test("PD Sensor Alerts filters and data survive a round trip through the passenger tabs", async () => {
  await mountPage("on");
  const ult = $$("[role='radio']").find((b) => b.textContent.trim().startsWith("Ultrasonic"));
  assert.ok(ult, "the existing sensor filter");
  await click(ult);
  const before = calls.filter((c) => c[0] === "alerts").at(-1)[1];
  assert.equal(before.sensorSubId, 2);
  await click(tab("Stops"));
  assert.ok($("[data-testid='journey-context']"));
  await click(tab("Sensor Alerts"));
  const after = calls.filter((c) => c[0] === "alerts").at(-1)[1];
  same(after, before, "same vehicle and filters after switching back");
  assert.equal($$("[data-testid='sensor-alert-card']").length, 1);
  assert.ok(!JSON.stringify(calls).includes("TS09UB2180"));
});

test("PD live failures never show sample values: a failing Sensor Alerts shows its own error; with the flag off a failing passenger API shows its error", async () => {
  failLive = true;
  await mountPage("on");
  assert.ok(text().includes("can't be reached right now"), "Sensor Alerts' own error state");
  assert.ok(!text().includes("TS09UB2180") && !text().includes("Ameerpet"));
  await act(async () => root.unmount());
  window.document.body.innerHTML = "";
  await mountPage("off");
  await click(tab("Sensor vs BMS"));
  assert.ok(text().includes("Passenger service unavailable."));
  assert.ok(!text().includes("TS09UB2180") && !text().includes("Ameerpet") && !text().includes("Sample journey"));
});

test("PD flag off: the screen is the live screen — no journey row, no sample values, Sensor Alerts first, live requests and actions as before", async () => {
  await mountPage("off");
  assert.equal($("[data-testid='journey-context']"), null);
  assert.ok(!text().includes("TS09UB2180") && !text().includes("Sample journey"));
  assert.equal(tab("Sensor Alerts").getAttribute("aria-selected"), "true");
  await click(tab("Sensor vs BMS"));
  assert.ok($("[data-testid='time-window']") && $("#sn-bus"), "vehicle picker and time window as before");
  assert.ok(liveBusCalls().some((c) => c[0] === "comparison" && c[1] === 1215), "the live device id");
  assert.ok(text().includes("Live Stop"));
  assert.equal(tableRows().length, 1, "only the live record");
  assert.ok(button("Recalculate") && button("Add reading"), "live actions unchanged");
});

test("PD mobile: tables scroll horizontally inside their panel; summary cards and charts stack (1 column, then 2 / 3 / 6)", () => {
  assert.match(read("components/drive-vision/shared/data-table.tsx"), /overflow-x-auto/);
  const page = read("components/drive-vision/sensors/sensors-page.tsx");
  assert.match(page, /aria-label="Passenger summary" className="mb-4 grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-6"/, "summary cards: one column on phones");
  assert.match(page, /@2xl:grid-cols-3 @5xl:grid-cols-9" data-testid="comparison-summary"/);
  const charts = read("components/drive-vision/sensors/passenger-demo-charts.tsx");
  assert.match(charts, /className="mb-3 grid gap-3 @4xl:grid-cols-2"/, "charts: one column until wide");
  assert.match(charts, /min-w-0/, "a chart never forces the page wider");
  assert.match(page, /className="mb-4 flex flex-wrap gap-1 rounded-card|SensorsTabs/, "existing wrapping tab bar");
});
