// Display helpers for the driver screens: they only re-present server values (no invented data).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const m = createRealm({ process: { env: {} } }).require("components/drive-vision/operations/my-work-model");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

test("status tone: known words coloured, case-insensitive; unknown and missing stay neutral", () => {
  same(["APPROVED", "pending", "IN_PROGRESS", "REJECTED", "EXPIRED", "VALID"].map(m.statusTone), ["success", "warning", "info", "danger", "danger", "success"]);
  same([undefined, "", "SOMETHING_NEW"].map(m.statusTone), ["neutral", "neutral", "neutral"]);
  assert.equal(m.humanize("IN_PROGRESS"), "In progress");
  assert.equal(m.humanize("CASUAL"), "Casual");
});

test("elapsed time only from a valid past start", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  assert.equal(m.elapsedSince("2026-10-29T08:30:00Z", now), "01:30:00");
  assert.equal(m.elapsedSince(undefined, now), null);
  assert.equal(m.elapsedSince("not a date", now), null);
  assert.equal(m.elapsedSince("2026-10-29T11:00:00Z", now), null);
});

test("checklist items grouped by server category in first-seen order; blank category → Other", () => {
  const items = [{ key: "a", category: "DRIVER" }, { key: "b", category: "VEHICLE" }, { key: "c", category: "DRIVER" }, { key: "d" }, { key: "e", category: "  " }];
  same(m.groupByCategory(items).map(([k, v]) => [k, v.map((i) => i.key)]), [["DRIVER", ["a", "c"]], ["VEHICLE", ["b"]], ["Other", ["d", "e"]]]);
  same(m.groupByCategory([]), []);
});

test("status counts come only from returned rows", () => {
  same(m.countByStatus([{ status: "PENDING" }, { status: "APPROVED" }, { status: "PENDING" }, {}]), { PENDING: 2, APPROVED: 1, "—": 1 });
  same(m.countByStatus([]), {});
});
