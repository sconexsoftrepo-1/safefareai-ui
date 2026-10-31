// Pure models for the 2026-10-29 API families: request bodies and validation mirror the OpenAPI
// constraints; response mapping never invents values (missing → null / skipped).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} }, URL });
const drivers = realm.require("components/drive-vision/drivers/drivers-model");
const ops = realm.require("components/drive-vision/operations/operations-model");
const dash = realm.require("components/drive-vision/dashboard/dashboard-api-model");
const trip = realm.require("components/drive-vision/trips/trip-model");
const search = realm.require("components/drive-vision/app-shell/search-model");
const alerts = realm.require("components/drive-vision/alerts/alerts-model");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const keys = (o) => Object.keys(o).sort();

// ── Drivers ─────────────────────────────────────────────────────────────────

test("driver form: name required, spec max lengths, dates, phone/email shapes, licence order", () => {
  const ok = { ...drivers.EMPTY_DRIVER_FORM, name: "Ravi Kumar", phone: "+91 98765 43210", email: "r@example.com", licenceIssuedOn: "2020-01-01", licenceExpiresOn: "2030-01-01" };
  same(drivers.validateDriverForm(ok), {});
  same(keys(drivers.validateDriverForm({ ...drivers.EMPTY_DRIVER_FORM, name: " " })), ["name"]);
  assert.ok(drivers.validateDriverForm({ ...ok, name: "x".repeat(151) }).name);
  assert.ok(drivers.validateDriverForm({ ...ok, licenceNo: "x".repeat(61) }).licenceNo);
  assert.ok(drivers.validateDriverForm({ ...ok, remark: "x".repeat(501) }).remark);
  assert.ok(drivers.validateDriverForm({ ...ok, dateOfBirth: "2020-02-30" }).dateOfBirth);
  assert.ok(drivers.validateDriverForm({ ...ok, email: "nope" }).email);
  assert.ok(drivers.validateDriverForm({ ...ok, emergencyContactPhone: "12" }).emergencyContactPhone);
  assert.ok(drivers.validateDriverForm({ ...ok, licenceExpiresOn: "2019-12-31" }).licenceExpiresOn);
  assert.ok(drivers.validateDriverForm({ ...ok, userId: "abc" }).userId);
});

test("driver body: blank optionals omitted, trimmed, gender/status/userId typed as the spec says", () => {
  const body = drivers.driverRequestBody({ ...drivers.EMPTY_DRIVER_FORM, name: "  Ravi ", phone: " 123456 ", gender: "M", status: "INACTIVE", userId: "42" });
  same(body, { name: "Ravi", status: "INACTIVE", phone: "123456", gender: "M", userId: 42 });
  same(drivers.driverRequestBody({ ...drivers.EMPTY_DRIVER_FORM, name: "A" }), { name: "A", status: "ACTIVE" });
});

test("driver form from DTO round-trips licence fields and ignores unknown gender values", () => {
  const f = drivers.driverFormFrom({ name: "A", gender: "X", status: "INACTIVE", userId: 9, licence: { number: "L1", licenceClass: "B", issuedOn: "2020-01-01", expiresOn: "2030-01-01" } });
  same([f.gender, f.status, f.userId, f.licenceNo, f.licenceClass, f.licenceExpiresOn], ["", "INACTIVE", "9", "L1", "B", "2030-01-01"]);
  same(drivers.driverRequestBody(f), { name: "A", status: "INACTIVE", licenceNo: "L1", licenceClass: "B", licenceIssuedOn: "2020-01-01", licenceExpiresOn: "2030-01-01", userId: 9 });
});

test("assignment: vehicle required; optional start parsed as IST", () => {
  assert.ok(drivers.validateAssignForm({ deviceId: "", from: "", replaceCurrent: false }).deviceId);
  same(drivers.validateAssignForm({ deviceId: "7", from: "", replaceCurrent: false }), {});
  same(drivers.assignRequestBody({ deviceId: "7", from: "", replaceCurrent: true }), { deviceId: 7, replaceCurrent: true });
  same(drivers.assignRequestBody({ deviceId: "7", from: "2026-10-29T09:30", replaceCurrent: false }), { deviceId: 7, replaceCurrent: false, from: "2026-10-29T04:00:00.000Z" });
});

// ── Dispatch & leave ────────────────────────────────────────────────────────

test("dispatch form: required fields, max lengths, end after start", () => {
  const ok = { ...ops.EMPTY_DISPATCH_FORM, deviceId: "1", driverId: "2", title: "Airport run", scheduledStart: "2026-11-01T08:00", scheduledEnd: "2026-11-01T10:00" };
  same(ops.validateDispatchForm(ok), {});
  same(keys(ops.validateDispatchForm(ops.EMPTY_DISPATCH_FORM)), ["deviceId", "driverId", "scheduledEnd", "scheduledStart", "title"]);
  assert.ok(ops.validateDispatchForm({ ...ok, scheduledEnd: "2026-11-01T08:00" }).scheduledEnd);
  assert.ok(ops.validateDispatchForm({ ...ok, title: "x".repeat(151) }).title);
  assert.ok(ops.validateDispatchForm({ ...ok, instructions: "x".repeat(1001) }).instructions);
});

test("dispatch body: IST → ISO instants, blank optionals omitted, round-trips from a DTO", () => {
  const form = { ...ops.EMPTY_DISPATCH_FORM, deviceId: "1", driverId: "2", title: " T ", origin: "Depot", scheduledStart: "2026-11-01T08:00", scheduledEnd: "2026-11-01T10:00" };
  const body = ops.dispatchRequestBody(form);
  same(body, { deviceId: 1, driverId: 2, title: "T", scheduledStart: "2026-11-01T02:30:00.000Z", scheduledEnd: "2026-11-01T04:30:00.000Z", origin: "Depot" });
  same(ops.dispatchRequestBody(ops.dispatchFormFrom({ ...body, id: 5, status: "X" })), body);
});

test("leave form: type from the spec pattern, ISO dates, order, driver required only on the fleet form", () => {
  const ok = { driverId: "3", leaveType: "SICK", startDate: "2026-11-01", endDate: "2026-11-03", reason: "" };
  same(ops.validateLeaveForm(ok, { requireDriver: true }), {});
  same(ops.validateLeaveForm({ ...ok, driverId: "" }, { requireDriver: false }), {});
  assert.ok(ops.validateLeaveForm({ ...ok, driverId: "" }, { requireDriver: true }).driverId);
  assert.ok(ops.validateLeaveForm({ ...ok, leaveType: "HOLIDAY" }, { requireDriver: true }).leaveType);
  assert.ok(ops.validateLeaveForm({ ...ok, endDate: "2026-10-31" }, { requireDriver: true }).endDate);
  assert.ok(ops.validateLeaveForm({ ...ok, reason: "x".repeat(501) }, { requireDriver: true }).reason);
  same(ops.leaveRequestBody(ok, { includeDriver: true }), { leaveType: "SICK", startDate: "2026-11-01", endDate: "2026-11-03", driverId: 3 });
  same(ops.leaveRequestBody({ ...ok, reason: " flu " }, { includeDriver: false }), { leaveType: "SICK", startDate: "2026-11-01", endDate: "2026-11-03", reason: "flu" });
});

// ── Dashboard mapping ───────────────────────────────────────────────────────

test("status slices: server labels kept, invalid rows dropped, distinct colours", () => {
  const s = dash.statusSegments([{ status: "ONLINE", label: "Online", count: 3 }, { status: "OFFLINE", count: 1 }, { status: "X", count: -1 }, { label: "", count: 2 }, { status: "PARKED", label: "Parked", count: 0 }]);
  same(s.map((x) => [x.key, x.label, x.value]), [["ONLINE", "Online", 3], ["OFFLINE", "OFFLINE", 1], ["PARKED", "Parked", 0]]);
  assert.equal(new Set(s.map((x) => x.color)).size, s.length);
});

test("trend rows keep missing values as null and sums ignore them (no invented zeros)", () => {
  const rows = dash.trendRows([{ day: "2026-10-28", trips: 2, distanceKm: 10.5 }, { day: "2026-10-29", alarms: 1 }, { trips: 9 }]);
  same(rows, [{ day: "2026-10-28", trips: 2, distanceKm: 10.5, alarms: null, severeAlarms: null }, { day: "2026-10-29", trips: null, distanceKm: null, alarms: 1, severeAlarms: null }]);
  assert.equal(dash.sumColumn(rows, "trips"), 2);
  assert.equal(dash.sumColumn(rows, "severeAlarms"), null);
  assert.equal(dash.describeStatusCounts({ ACCEPTED: 1, PENDING: 3, DONE: 0 }), "3 PENDING · 1 ACCEPTED");
});

// ── Trip route geometry ─────────────────────────────────────────────────────

test("route geometry skips points without usable GPS, orders by time and never invents an end for a live trip", () => {
  const g = trip.routeGeometry({
    trip: { inProgress: true, startLat: 0, startLon: 0 },
    points: [
      { deviceTime: "2026-10-29T10:02:00Z", lat: 17.2, lon: 78.2 },
      { deviceTime: "2026-10-29T10:01:00Z", lat: 17.1, lon: 78.1 },
      { deviceTime: "2026-10-29T10:03:00Z", lat: 0, lon: 0 },
      { deviceTime: "2026-10-29T10:04:00Z" },
    ],
    stops: [{ lat: 17.15, lon: 78.15, stopType: "IDLE" }, { lat: 200, lon: 1 }],
    events: [{ alarmName: "Overspeed" }],
  });
  same(g.line, [{ lat: 17.1, lon: 78.1 }, { lat: 17.2, lon: 78.2 }]);
  same([g.total, g.skipped], [4, 2]);
  same(g.start, { lat: 17.1, lon: 78.1 }); // trip start was 0,0 → first valid point
  assert.equal(g.end, null);
  assert.equal(g.stops.length, 1);
  assert.equal(g.events.length, 0);
  same(trip.routeGeometry(undefined).line, []);
});

// ── Search & notification links ─────────────────────────────────────────────

test("search hits link only to known screens; unknown types and bad ids stay unlinked", () => {
  assert.equal(search.searchHitHref("drivers", { id: 5, title: "Ravi" }), "/drive-vision/drivers?driver=5");
  assert.equal(search.searchHitHref("x", { id: 7, type: "DEVICE", title: "Bus" }), "/drive-vision/vehicles/7");
  assert.equal(search.searchHitHref("alerts", { id: 9 }), "/drive-vision/alerts?kind=incidents&alarm=9");
  assert.equal(search.searchHitHref("geofences", { id: 3 }), null);
  assert.equal(search.searchHitHref("drivers", { id: -1 }), null);
  const flat = search.flattenSearch({ drivers: [{ id: 1, title: "A" }, { id: 2 }], junk: "x", geofences: [{ id: 3, title: "Depot" }] });
  same(flat.map((f) => [f.group, f.hit.id, f.href]), [["drivers", 1, "/drive-vision/drivers?driver=1"], ["geofences", 3, null]]);
  assert.equal(search.groupLabel("leave_requests"), "Leave requests");
});

test("notification links: leave / swap / known entities; anything else unlinked", () => {
  assert.equal(search.notificationHref("LEAVE_REQUEST", "4"), "/drive-vision/workforce?tab=leave");
  assert.equal(search.notificationHref("SWAP_REQUEST", "4"), "/drive-vision/dispatch?tab=swaps");
  assert.equal(search.notificationHref("DISPATCH", "12"), "/drive-vision/dispatch?dispatch=12");
  assert.equal(search.notificationHref("ALERT", "abc"), null);
  assert.equal(search.notificationHref("REPORT", "1"), null);
  assert.equal(search.notificationHref(undefined, "1"), null);
});

// ── Alerts incidents tab ────────────────────────────────────────────────────

test("incidents tab: parsed from the URL and mapped to GET /alerts filters", () => {
  const p = (s) => new URLSearchParams(s);
  const view = alerts.parseAlertsView(p("kind=incidents&device=3&type=2&page=2"));
  assert.equal(view.kind, "incidents");
  same(alerts.parseAlertsView(p(alerts.alertsSearch(view).slice(1))), view);
  const q = alerts.incidentQuery(view, new Date("2026-10-29T06:00:00Z"), { openOnly: true, keyword: " speed " });
  same([q.deviceIds, q.alarmTypeIds, q.openOnly, q.keyword, q.pageNumber, q.pageSize], [[3], [2], true, "speed", 2, 20]);
  same(alerts.incidentQuery(view, new Date(), { openOnly: false, keyword: "" }).openOnly, undefined);
});
