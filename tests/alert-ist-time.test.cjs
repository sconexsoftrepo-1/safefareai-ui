// Alerts & Events API (GET /api/v1/alerts) timestamps: IST wall-clock digits sent with a wrong "Z" suffix.
// The dedicated parser reads the digits as IST (+05:30); generic date helpers and other APIs are unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const realm = createRealm({ Intl, Date });
const t = () => realm.require("features/drive-vision/utils/alert-ist-time");

test("AIST format: the digits are IST, shown in Asia/Kolkata with seconds; the Z is never read as UTC", () => {
  assert.equal(t().formatAlertIstTime("2026-11-10T21:15:24Z"), "10 Nov 2026, 09:15:24 PM IST");
  assert.equal(t().formatAlertIstTime("2026-11-11T02:45:24Z"), "11 Nov 2026, 02:45:24 AM IST");
  assert.equal(t().formatAlertIstTime("2026-11-10T00:00:00Z"), "10 Nov 2026, 12:00:00 AM IST");
  assert.equal(t().formatAlertIstTime("2026-11-10T12:30:00Z"), "10 Nov 2026, 12:30:00 PM IST");
  assert.equal(t().formatAlertIstTime("2026-11-10T21:15:24.500Z"), "10 Nov 2026, 09:15:24 PM IST", "fractions ignored");
  assert.equal(t().formatAlertIstTime("2026-11-10T21:15:24"), "10 Nov 2026, 09:15:24 PM IST", "without the Z too");
});

test("AIST date boundaries: late-evening and year-end values stay on their own calendar day", () => {
  assert.equal(t().formatAlertIstTime("2026-11-10T23:59:59Z"), "10 Nov 2026, 11:59:59 PM IST", "not pushed to 11 Nov");
  assert.equal(t().formatAlertIstTime("2026-12-31T23:30:00Z"), "31 Dec 2026, 11:30:00 PM IST", "not pushed into 2027");
  assert.equal(t().formatAlertIstTime("2028-02-29T01:00:00Z"), "29 Feb 2028, 01:00:00 AM IST");
});

test("AIST instant: the wall clock is read with +05:30 (the Z is not UTC); null and invalid input are safe", () => {
  assert.equal(t().alertIstInstant("2026-11-10T21:15:24Z"), Date.parse("2026-11-10T21:15:24+05:30"));
  assert.equal(t().alertIstInstant("2026-11-10T21:15:24Z"), Date.parse("2026-11-10T15:45:24Z"));
  assert.equal(t().alertIstIso("2026-11-10T21:15:24Z"), "2026-11-10T15:45:24.000Z", "<time dateTime> carries the real instant");
  for (const bad of [null, undefined, "", "garbage", "2026-02-30T10:00:00Z", "2026-11-10T24:00:00Z", "2026-11-10T21:15:24+02:00", "2026-11-10", 1731253524000]) {
    assert.equal(t().alertIstInstant(bad), null, String(bad));
    assert.equal(t().formatAlertIstTime(bad), "—", String(bad));
    assert.equal(t().alertIstRelative(bad, new Date()), "—", String(bad));
    assert.equal(t().alertIstIso(bad), undefined, String(bad));
  }
});

test("AIST relative labels use the correctly read instant (no extra 5 h 30 m)", () => {
  const now = new Date(Date.parse("2026-11-11T07:15:24+05:30"));
  assert.equal(t().alertIstRelative("2026-11-10T21:15:24Z", now), "10 h ago", "would read '4 h ago' if the Z were trusted");
  assert.equal(t().alertIstRelative("2026-11-11T07:10:24Z", now), "5 min ago");
  assert.equal(t().alertIstRelative("2026-11-11T07:15:00Z", now), "just now");
  assert.equal(t().alertIstRelative("2026-11-09T07:15:24Z", now), "2 d ago");
});

test("AIST sorting: ordering by the corrected instant matches the intended IST order", () => {
  const rows = [{ id: 1, alarmTime: "2026-11-10T21:15:24Z" }, { id: 2, alarmTime: "2026-11-11T02:45:24Z" }, { id: 3, alarmTime: null }, { id: 4, alarmTime: "2026-11-10T23:59:59Z" }];
  const key = (r) => t().alertIstInstant(r.alarmTime) ?? Number.NEGATIVE_INFINITY;
  same([...rows].sort((a, b) => key(b) - key(a)).map((r) => r.id), [2, 4, 1, 3], "newest first; missing last");
});

test("AIST scope: the AI Events and Incidents tabs (GET /alerts) and the Recent events card use it; other APIs and the generic helpers don't", () => {
  const incidents = read("components/drive-vision/alerts/incidents.tsx");
  assert.match(incidents, /alertService\.listAlerts\(/, "the live AI Events / Incidents list is GET /alerts");
  assert.doesNotMatch(incidents, /formatLocalDateTime\((a|alert)\.alarmTime\)|formatRelative\(a\.alarmTime/);
  assert.equal((incidents.match(/formatAlertIstTime\((a|alert)\.alarmTime\)/g) ?? []).length, 3, "list, drawer subtitle, Alarm time row");
  assert.match(incidents, /alertIstRelative\(a\.alarmTime, shownAt\)/);
  const platform = read("components/drive-vision/dashboard/platform-dashboard.tsx");
  assert.match(platform, /dateTime=\{alertIstIso\(a\.alarmTime\)\}/);
  assert.match(platform, /alertIstRelative\(a\.alarmTime, now\)/);
  // GET /alarms/ai|routine (History, its drawer, the live dashboard) and notifications keep their own handling.
  for (const f of ["components/drive-vision/alerts/alerts-page.tsx", "components/drive-vision/alerts/event-detail-drawer.tsx", "components/drive-vision/dashboard/live-activity-list.tsx", "components/drive-vision/app-shell/notifications-model.ts", "features/drive-vision/utils/format.ts"]) {
    assert.doesNotMatch(read(f), /alert-ist-time|alertIst|formatAlertIstTime/, f);
  }
  assert.doesNotMatch(read("features/drive-vision/utils/format.ts"), /\+05:30|replace\(\/Z\$/, "no global Z stripping");
});
