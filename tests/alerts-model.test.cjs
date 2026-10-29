const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} }, URL, URLSearchParams });
const m = realm.require("components/drive-vision/alerts/alerts-model");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const params = (s) => new URLSearchParams(s);

test("parseAlertsView defaults and ignores legacy or invalid params", () => {
  same(m.parseAlertsView(params("")), { kind: "ai", range: "7d", deviceId: null, typeId: null, page: 1, alarmId: null });
  // Old sample-data deep links (?status, ?severity, mock ids) land on the default view.
  same(m.parseAlertsView(params("status=open&severity=high&alarm=al-0042&vehicle=v-3")), { kind: "ai", range: "7d", deviceId: null, typeId: null, page: 1, alarmId: null });
  same(m.parseAlertsView(params("kind=routine&range=30d&device=12&type=3&page=4&alarm=99")), { kind: "routine", range: "30d", deviceId: 12, typeId: 3, page: 4, alarmId: 99 });
  same(m.parseAlertsView(params("kind=x&range=1y&device=-1&type=1.5&page=0")), { kind: "ai", range: "7d", deviceId: null, typeId: null, page: 1, alarmId: null });
});

test("alertsSearch round-trips and omits defaults", () => {
  const view = { kind: "routine", range: "today", deviceId: 7, typeId: 2, page: 3, alarmId: 5 };
  same(m.parseAlertsView(params(m.alertsSearch(view).slice(1))), view);
  assert.equal(m.alertsSearch({ kind: "ai", range: "7d", deviceId: null, typeId: null, page: 1, alarmId: null }), "");
});

test("alarmQuery sends only spec parameters, with a fixed window", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const q = m.alarmQuery({ kind: "ai", range: "7d", deviceId: 12, typeId: null, page: 2, alarmId: 1 }, now);
  same(Object.keys(q).filter((k) => q[k] !== undefined), ["from", "to", "deviceIds", "pageNumber", "pageSize"]);
  assert.equal(q.to, now.toISOString());
  assert.ok(new Date(q.from) < now);
  same([q.deviceIds, q.pageNumber, q.pageSize], [[12], 2, 20]);
  same(m.alarmQuery({ kind: "ai", range: "7d", deviceId: null, typeId: 3, page: 1, alarmId: null }, now).alarmTypeIds, [3]);
});

test("labels fall back without inventing data", () => {
  const types = new Map([[4, { id: 4, label: "Fatigue" }]]);
  assert.equal(m.alarmLabel({ alarmName: "Phone use", alarmTypeId: 4 }, types), "Phone use");
  assert.equal(m.alarmLabel({ alarmTypeId: 4 }, types), "Fatigue");
  assert.equal(m.alarmLabel({ alarmTypeId: 9 }, types), "Alarm type 9");
  assert.equal(m.deviceLabel({ terminalNo: "T1" }), "T1");
  assert.equal(m.deviceLabel({ deviceId: 3 }), "Device 3");
});

test("alarmPosition rejects missing, out-of-range and 0,0 coordinates", () => {
  same(m.alarmPosition({ lat: 17.68, lon: 83.21 }), { lat: 17.68, lon: 83.21 });
  assert.equal(m.alarmPosition({ lat: 0, lon: 0 }), null);
  assert.equal(m.alarmPosition({ lat: 91, lon: 0 }), null);
  assert.equal(m.alarmPosition({ lon: 3 }), null);
});

test("safeMediaUrl only allows absolute http(s) links", () => {
  assert.equal(m.safeMediaUrl("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg");
  assert.equal(m.safeMediaUrl("javascript:alert(1)"), null);
  assert.equal(m.safeMediaUrl("data:image/png;base64,AA"), null);
  assert.equal(m.safeMediaUrl("/relative.jpg"), null);
  assert.equal(m.safeMediaUrl(undefined), null);
});
