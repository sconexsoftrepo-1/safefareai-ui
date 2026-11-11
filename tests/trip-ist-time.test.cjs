// Trips API (GET /trips, /trips/{id}, /trips/{id}/route) startTime / endTime: IST wall-clock digits sent with a wrong
// "Z" suffix. The dedicated helper reads the digits as IST; generic helpers, other APIs and the from / to request
// parameters are unchanged. MOCKED ONLY: the Trips screen is rendered against stub services; trips are synthetic.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const pure = createRealm({ Intl, Date, process: { env: {} } });
const t = () => pure.require("features/drive-vision/utils/trip-ist-time");

test("TIST format: the brief's examples — digits shown as IST, the Z never read as UTC (no +5:30 shift)", () => {
  assert.equal(t().formatTripTime("2026-11-11T10:32:20Z"), "11 Nov, 10:32 AM", "was 11 Nov, 16:02");
  assert.equal(t().formatTripTime("2026-11-10T20:43:27Z"), "10 Nov, 08:43 PM");
  assert.equal(t().formatTripTimeFull("2026-11-10T20:43:27Z"), "10 Nov 2026, 08:43:27 PM IST", "full form (tooltips) keeps the seconds");
  assert.equal(t().formatTripTime("2026-11-10T00:05:00Z"), "10 Nov, 12:05 AM");
  assert.equal(t().formatTripTime("2026-11-10T12:30:00Z"), "10 Nov, 12:30 PM");
  for (const same of ["2026-11-11T10:32:20", "2026-11-11 10:32:20", "2026-11-11T10:32:20.123Z", "2026-11-11T10:32:20+00:00", "2026-11-11T10:32:20+05:30"]) {
    assert.equal(t().formatTripTime(same), "11 Nov, 10:32 AM", same);
  }
});

test("TIST date boundaries: late-evening, month-end and year-end trips stay on their own IST day", () => {
  assert.equal(t().formatTripTime("2026-11-10T23:59:59Z"), "10 Nov, 11:59 PM", "not pushed to 11 Nov");
  assert.equal(t().formatTripTime("2026-11-30T22:00:00Z"), "30 Nov, 10:00 PM", "not pushed into December");
  assert.equal(t().formatTripTimeFull("2026-12-31T23:30:00Z"), "31 Dec 2026, 11:30:00 PM IST", "not pushed into 2027");
  assert.equal(t().formatTripTime("2026-11-11T00:10:00Z"), "11 Nov, 12:10 AM", "just after midnight stays on 11 Nov");
  assert.equal(t().formatTripTime("2028-02-29T01:00:00Z"), "29 Feb, 01:00 AM");
});

test("TIST instant and relative time: the wall clock is read at +05:30, so 'ago' labels are not 5 h 30 m off", () => {
  assert.equal(t().tripIstInstant("2026-11-11T10:32:20Z"), Date.parse("2026-11-11T10:32:20+05:30"));
  assert.equal(t().tripIstIso("2026-11-11T10:32:20Z"), "2026-11-11T05:02:20.000Z", "<time dateTime> carries the real instant");
  const now = new Date("2026-11-11T12:32:20+05:30");
  assert.equal(t().tripIstRelative("2026-11-11T10:32:20Z", now), "2 h ago", "read as UTC it would be 'just now' / in the future");
  assert.equal(t().tripIstRelative("2026-11-11T12:20:20Z", now), "12 min ago");
  assert.equal(t().tripIstRelative("2026-11-10T20:43:27Z", now), "16 h ago");
});

test("TIST null and invalid values are safe ('—'), never 'Invalid Date' and never a thrown RangeError", () => {
  for (const bad of [null, undefined, "", "garbage", "2026-02-30T10:00:00Z", "2026-11-10T24:00:00Z", "2026-11-10T10:00:00+02:00", "2026-11-10", 1731253524000, {}]) {
    assert.equal(t().tripWallClock(bad), null, String(bad));
    assert.equal(t().tripIstInstant(bad), null, String(bad));
    assert.equal(t().formatTripTime(bad), "—", String(bad));
    assert.equal(t().formatTripTimeFull(bad), "—", String(bad));
    assert.equal(t().tripIstRelative(bad, new Date()), "—", String(bad));
    assert.equal(t().tripIstIso(bad), undefined, String(bad));
  }
});

test("TIST source: never `new Date(original)`; generic formatters, the Alerts helper and track playback untouched", () => {
  const src = read("features/drive-vision/utils/trip-ist-time.ts");
  assert.doesNotMatch(src, /new Date\((v|value|s|str)\)|Date\.parse\(/, "the original string is never parsed as a date");
  assert.match(read("features/drive-vision/utils/format.ts"), /const toDate = \(value: string \| Date\) => \(typeof value === "string" \? new Date\(value\) : value\);/, "generic helpers unchanged");
  assert.doesNotMatch(read("features/drive-vision/utils/alert-ist-time.ts"), /trip/i, "Alerts & Events helper not touched");
  const playback = read("components/drive-vision/trips/trips-page.tsx");
  assert.doesNotMatch(playback, /trip-ist-time/, "track playback (GET /devices/{id}/track deviceTime) does not use trip fields, so it is unchanged");
  const vehicle = read("components/drive-vision/vehicles/vehicle-operations.tsx");
  assert.match(vehicle, /\{t\.startTime \? formatTripTime\(t\.startTime\) : "—"\}/, "vehicle page 'Recent trips' (GET /trips) uses the trip helper");
  assert.match(vehicle, /formatDateTime\(current\.assignedFrom\)/, "…while other APIs on that page keep the generic helper");
});

test("TIST stop pins on the trip route map show IST stop times; alarm pins (Alerts data) keep their own helper", () => {
  const model = pure.require("components/drive-vision/trips/trip-model");
  const g = model.routeGeometry({ trip: {}, points: [], stops: [{ lat: 17.4, lon: 78.4, stopType: "IDLE", startTime: "2026-11-10T20:43:27Z" }], events: [] });
  assert.equal(g.stops[0].title, "Stop (IDLE) · 10 Nov, 08:43 PM");
});

// ── Trips & Tracking screen (TripHistory) rendered against stub services ──────────────────────────────────────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/trips", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Event", "DocumentFragment", "navigator"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
// Real packages (radix, …) run in the host realm and look for DOM classes on globalThis.
for (const key of Object.getOwnPropertyNames(window)) {
  if (/^(HTML|SVG|Mouse|Keyboard|Pointer|Focus|Custom|UI|Input)\w*$/.test(key) && !(key in globalThis)) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const TRIPS = [
  { id: 1, deviceId: 7, deviceName: "Bus 7", driverName: "Driver A", startTime: "2026-11-11T10:32:20Z", endTime: null, inProgress: true, distanceKm: 4.2, durationSeconds: 900, alarmCount: 0 },
  { id: 2, deviceId: 7, deviceName: "Bus 7", driverName: "Driver A", startTime: "2026-11-10T20:43:27Z", endTime: "2026-11-10T23:59:59Z", inProgress: false, distanceKm: 31.5, durationSeconds: 11_792, alarmCount: 2 },
  { id: 3, deviceId: 8, deviceName: "Bus 8", startTime: "not-a-time", endTime: "also-bad", distanceKm: 1, durationSeconds: 60, alarmCount: 0 },
];
const SUMMARY = { tripCount: 3, inProgressCount: 1, totalDistanceKm: 36.7, totalDrivingSeconds: 10_000, totalIdleSeconds: 2_752, alarmCount: 2 };
const DETAIL = { trip: { ...TRIPS[1], drivingSeconds: 10_000, idleSeconds: 1_792, avgSpeedKmh: 28.4, maxSpeedKmh: 61, stopCount: 1 }, stops: [{ id: 9, stopType: "IDLE", startTime: "2026-11-10T21:30:00Z", address: "Depot" }] };
const calls = [];
const insightService = {
  listTrips: async (q) => (calls.push(["list", q]), { items: TRIPS, total: TRIPS.length, source: "api" }),
  tripSummary: async (q) => (calls.push(["summary", q]), { data: SUMMARY, source: "api" }),
  tripDetail: async (id) => ({ data: id === 2 ? DETAIL : { trip: TRIPS[id - 1], stops: [] }, source: "api" }),
  tripRoute: async (id) => ({ data: { trip: TRIPS[id - 1], points: [], stops: [], events: [] }, source: "api" }),
};
const fleetService = { listAllDevices: async () => ({ items: [{ id: 7, name: "Bus 7" }, { id: 8, name: "Bus 8" }], total: 2 }) };

const stubs = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "@/features/drive-vision/api/insight-service": { insightService },
  "@/features/drive-vision/api/fleet-service": { fleetService },
  "../map/geo-map": { GeoMap: () => null },
};
// Any other bare package (lucide-react, radix, …) is the real one, sharing the host React.
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
const ui = createRealm({ window, document: window.document, HTMLElement: window.HTMLElement, navigator: window.navigator, ResizeObserver: globalThis.ResizeObserver, Intl, Date, URL, URLSearchParams, process: { env: { NODE_ENV: "test" } }, console: { ...console, error() {}, warn() {} } }, modules);

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
let root;
async function mountTrips() {
  const host = window.document.body.appendChild(window.document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ui.require("components/drive-vision/trips/trip-history").TripHistory, {})));
  await settle();
  return host;
}
test.afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  window.document.body.innerHTML = "";
  calls.length = 0;
});

test("TIST Trips table: start times in IST (no shift), in-progress badge kept, invalid time does not crash; order and summary unchanged", async () => {
  const host = await mountTrips();
  const rows = [...host.querySelectorAll("tbody tr")];
  assert.equal(rows.length, 3, "all trips listed, in the server's order");
  const startCells = rows.map((r) => r.querySelector("td").textContent);
  same(startCells, ["11 Nov, 10:32 AMIn progress", "10 Nov, 08:43 PM", "—"], "not 16:02 / 02:13; bad value → '—'");
  assert.equal(rows[0].querySelector("time").getAttribute("datetime"), "2026-11-11T05:02:20.000Z");
  same(
    rows.map((r) => r.querySelector("td span[title]")?.getAttribute("title") ?? null),
    ["11 Nov 2026, 10:32:20 AM IST → in progress", "10 Nov 2026, 08:43:27 PM IST → 10 Nov 2026, 11:59:59 PM IST", "— → —"],
    "row tooltip: full IST start and end"
  );
  const text = host.textContent;
  for (const [label, value] of [["Trips", "3"], ["In progress", "1"], ["Alarms", "2"]]) assert.ok(text.includes(`${label}${value}`), `${label} ${value}`);
});

test("TIST Trips request: from / to keep their existing UTC ISO conversion (7-day default); pagination and filters unchanged", async () => {
  await mountTrips();
  const list = calls.find((c) => c[0] === "list")[1];
  const summary = calls.find((c) => c[0] === "summary")[1];
  assert.match(list.from, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "still toISOString()");
  assert.match(list.to, /Z$/);
  same([list.pageNumber, list.pageSize, list.deviceId], [1, 20, undefined]);
  same([summary.from, summary.to], [list.from, list.to]);
  assert.match(read("components/drive-vision/trips/trip-history.tsx"), /from: range\.from\.toISOString\(\),\s*to: range\.to\.toISOString\(\),/, "request conversion untouched");
});

test("TIST trip detail: header and stop times in IST; 'in progress' kept for a live trip; metrics unchanged", async () => {
  const host = await mountTrips();
  await act(async () => host.querySelectorAll("tbody tr")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
  const panel = host.querySelector('[aria-labelledby="trip-detail-title"]');
  assert.ok(panel.textContent.includes("10 Nov, 08:43 PM → 10 Nov, 11:59 PM"), "header start → end, same day");
  assert.ok(panel.textContent.includes("1. 10 Nov, 09:30 PM · IDLE · Depot"), "stop time");
  assert.ok(panel.textContent.includes("28 km/h") && panel.textContent.includes("61 km/h"), "speeds unchanged");
  await act(async () => host.querySelectorAll("tbody tr")[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
  assert.ok(host.querySelector('[aria-labelledby="trip-detail-title"]').textContent.includes("11 Nov, 10:32 AM → in progress"));
});
