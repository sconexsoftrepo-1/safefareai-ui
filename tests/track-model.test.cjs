const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const { checkPosition } = realm.require("components/drive-vision/monitoring/live-fleet-model");
const { prepareTrack, validateRange, istInputToDate, dateToIstInput, trackStats } = realm.require("components/drive-vision/trips/track-model");
// Values cross the vm boundary; compare structurally via JSON.
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

test("checkPosition rejects unusable coordinates", () => {
  assert.equal(checkPosition({ lat: 17.68, lon: 83.21 }).ok, true);
  assert.equal(checkPosition({ lon: 83.21 }).ok, false);
  assert.equal(checkPosition({ lat: null, lon: null }).ok, false);
  assert.equal(checkPosition({ lat: 91, lon: 10 }).ok, false);
  assert.equal(checkPosition({ lat: 10, lon: 181 }).ok, false);
  assert.equal(checkPosition({ lat: NaN, lon: 10 }).ok, false);
  assert.equal(checkPosition({ lat: 0, lon: 0 }).ok, false, "0,0 placeholder");
  assert.equal(checkPosition({ lat: 0, lon: 32.5 }).ok, true, "equator with a real longitude");
});

test("prepareTrack orders points and never plots missing positions", () => {
  const t = prepareTrack([
    { deviceTime: "2026-10-24T11:05:00Z", lat: 17.69, lon: 83.22, speedKmh: 30, mileageKm: 100.5 },
    { deviceTime: "2026-10-24T11:00:00Z", lat: 17.68, lon: 83.21, speedKmh: 50, mileageKm: 100 },
    { deviceTime: "not-a-date", lat: 17.7, lon: 83.3 },
    { lat: 17.7, lon: 83.3 },
    { deviceTime: "2026-10-24T11:10:00Z", lat: 0, lon: 0, speedKmh: 0, mileageKm: 101 },
  ]);
  same(t.points.map((p) => p.deviceTime), ["2026-10-24T11:00:00Z", "2026-10-24T11:05:00Z", "2026-10-24T11:10:00Z"]);
  assert.equal(t.reordered, true);
  assert.equal(t.withoutTime, 2);
  same([t.points.length, t.plotted.length, t.withoutPosition], [3, 2, 1]);
  same(trackStats(t.points), { maxSpeed: 50, odometerSpanKm: 1 });
  assert.equal(prepareTrack([]).points.length, 0);
  assert.equal(prepareTrack(undefined).points.length, 0);
});

test("IST range inputs and the 7-day limit", () => {
  const now = new Date("2026-10-26T08:00:00Z");
  assert.equal(istInputToDate("2026-10-24T16:00").toISOString(), "2026-10-24T10:30:00.000Z");
  assert.equal(dateToIstInput(new Date("2026-10-24T10:30:00Z")), "2026-10-24T16:00");
  assert.equal(istInputToDate("2026-10-24"), null);
  assert.equal(validateRange(new Date(now - 7 * 864e5), now, now), null);
  assert.equal(validateRange(new Date(now - 7 * 864e5 - 60000), now, now), "The range can be at most 7 days.");
  assert.equal(validateRange(now, now, now), "The start must be before the end.");
  assert.equal(validateRange(null, now, now), "Choose a start and end time.");
});
