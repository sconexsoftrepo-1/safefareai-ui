// Phase 2 integration models: request building and validation against the OpenAPI constraints.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} }, URL });
const settings = realm.require("components/drive-vision/settings/settings-model");
const users = realm.require("components/drive-vision/users/users-model");
const geo = realm.require("components/drive-vision/geofences/geofence-model");
const reports = realm.require("components/drive-vision/reports/reports-model");
const video = realm.require("components/drive-vision/video/video-model");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const keys = (o) => Object.keys(o).sort();

// ── Profile / password / preferences ────────────────────────────────────────

test("profile validation mirrors UpdateMeRequest", () => {
  const ok = { displayName: "Ops", email: "ops@example.com", phone: "+91 (40) 1234-5678", locale: "en_IN", timezone: "Asia/Kolkata" };
  same(settings.validateProfile(ok), {});
  same(settings.validateProfile({ ...ok, email: "", phone: "", locale: "", timezone: "" }), {});
  same(keys(settings.validateProfile({ displayName: "  ", email: "nope", phone: "12", locale: "EN", timezone: "x".repeat(51) })), ["displayName", "email", "locale", "phone", "timezone"]);
  assert.ok(settings.validateProfile({ ...ok, displayName: "x".repeat(151) }).displayName);
  assert.ok(settings.validateProfile({ ...ok, phone: "+91 12345 abc" }).phone);
  assert.ok(settings.validateProfile({ ...ok, locale: "en-IN" }).locale);
});

test("profile PATCH sends only changed, trimmed fields", () => {
  const original = settings.profileForm({ displayName: "Ops", email: "a@b.c", phone: undefined });
  same(settings.profilePatch(original, { ...original }), {});
  same(settings.profilePatch(original, { ...original, displayName: " Ops Team ", phone: "+1 555 0100" }), { displayName: "Ops Team", phone: "+1 555 0100" });
  same(settings.profilePatch(original, { ...original, displayName: "Ops  " }), {});
});

test("password change: required, ≤ 72, different, confirmed — no invented strength rule", () => {
  same(settings.validatePasswordChange({ currentPassword: "a", newPassword: "b", confirmPassword: "b" }), {});
  same(keys(settings.validatePasswordChange({ currentPassword: "", newPassword: "", confirmPassword: "x" })), ["confirmPassword", "currentPassword", "newPassword"]);
  assert.ok(settings.validatePasswordChange({ currentPassword: "same", newPassword: "same", confirmPassword: "same" }).newPassword);
  assert.ok(settings.validatePasswordChange({ currentPassword: "a", newPassword: "x".repeat(73), confirmPassword: "x".repeat(73) }).newPassword);
  same(settings.passwordRequest({ currentPassword: "a", newPassword: "b", confirmPassword: "b" }), { currentPassword: "a", newPassword: "b" });
});

test("preferences: ranges and enums from the spec; PUT keeps stored fields, drops updatedAt", () => {
  same(settings.validatePreferences({ videoLayout: "GRID_4", videoAutoStopMin: 1, alarmPopupCloseSec: 600, alarmPopupMax: 50, expiryReminderDays: 0, expiryReminderMode: "BADGE" }), {});
  same(keys(settings.validatePreferences({ videoLayout: "GRID_3", videoAutoStopMin: 121, alarmPopupCloseSec: -1, alarmPopupMax: 0, expiryReminderDays: 1.5, expiryReminderMode: "LOUD" })), [
    "alarmPopupCloseSec",
    "alarmPopupMax",
    "expiryReminderDays",
    "expiryReminderMode",
    "videoAutoStopMin",
    "videoLayout",
  ]);
  assert.ok(settings.validatePreferences({ videoAutoStopMin: NaN }).videoAutoStopMin);
  const loaded = { theme: "light", homeModules: ["a"], deviceInfoFields: [], trackAlarmTypeIds: [3], videoLayout: "GRID_1", expiryReminderMode: "NONE", expiryReminderDays: 30, updatedAt: "2026-10-27T00:00:00Z" };
  same(settings.preferencesBody(loaded, { expiryReminderDays: 7 }), { ...loaded, expiryReminderDays: 7, updatedAt: undefined });
  assert.equal("updatedAt" in settings.preferencesBody(loaded, {}), false);
  same(settings.missingRequiredPreferences(loaded), []);
  same(settings.missingRequiredPreferences({ ...loaded, theme: null, homeModules: undefined }), ["homeModules", "theme"]);
  assert.equal(settings.parseIntInput(""), undefined);
  assert.equal(settings.parseIntInput("12"), 12);
  assert.ok(Number.isNaN(settings.parseIntInput("abc")));
});

test("Overview reminder window uses the server value only when it's a positive whole number", () => {
  assert.equal(settings.reminderDaysFrom({ expiryReminderDays: 14 }), 14);
  for (const v of [undefined, null, 0, -3, 2.5, "7"]) assert.equal(settings.reminderDaysFrom({ expiryReminderDays: v }), null);
  assert.equal(settings.reminderDaysFrom(undefined), null);
});

// ── Users ───────────────────────────────────────────────────────────────────

test("user form validation for create and edit", () => {
  const form = { ...users.EMPTY_USER_FORM, displayName: "Asha", roleId: "2", password: "pw" };
  same(users.validateUserForm(form, "create"), {});
  same(keys(users.validateUserForm(users.EMPTY_USER_FORM, "create")), ["displayName", "password", "roleId"]);
  same(keys(users.validateUserForm({ ...form, password: "" }, "edit")), []);
  assert.ok(users.validateUserForm({ ...form, roleId: "abc" }, "edit").roleId);
  assert.ok(users.validateUserForm({ ...form, password: "x".repeat(73) }, "create").password);
});

test("user request bodies omit empty optionals and keep the parent on edit", () => {
  const form = { displayName: " Asha ", email: "", phone: " +91 99999 00000 ", password: "pw", roleId: "2", locale: "", timezone: "" };
  same(users.createUserBody(form), { displayName: "Asha", password: "pw", roleId: 2, phone: "+91 99999 00000" });
  same(users.updateUserBody(form, { id: 9, parentUserId: 4 }), { displayName: "Asha", roleId: 2, phone: "+91 99999 00000", parentUserId: 4 });
  assert.equal("password" in users.updateUserBody(form, { id: 9 }), false);
  assert.equal("parentUserId" in users.updateUserBody(form, { id: 9 }), false);
});

test("role options: assignable only, but the user's current role stays listed", () => {
  const roles = [{ id: 1, code: "PLATFORM_ADMIN", assignable: false }, { id: 2, code: "OPS", description: "Operations" }, { id: 3, code: "X", assignable: true }, { code: "NOID" }];
  same(users.roleOptions(roles).map((o) => o.value), ["2", "3"]);
  same(users.roleOptions(roles, 1).map((o) => o.value), ["1", "2", "3"]);
  assert.equal(users.roleOptions(roles)[0].label, "OPS · Operations");
});

test("status toggle covers only ACTIVE ⇄ DISABLED; tree flattening is cycle-safe", () => {
  assert.equal(users.nextStatus("ACTIVE"), "DISABLED");
  assert.equal(users.nextStatus("DISABLED"), "ACTIVE");
  for (const s of ["INVITED", undefined, "active", "LOCKED"]) assert.equal(users.nextStatus(s), null);
  const loop = { id: 1, displayName: "root", children: [] };
  loop.children.push({ id: 2, children: [loop] });
  same(users.flattenTree([loop, null, "x"]).map((r) => [r.node.id, r.depth]), [[1, 0], [2, 1]]);
  same(users.flattenTree(undefined), []);
  same(users.validateResetPassword("a", "a"), {});
  same(keys(users.validateResetPassword("", "b")), ["confirm", "newPassword"]);
});

// ── Geofences ───────────────────────────────────────────────────────────────

test("geofence geometry: unusable points dropped, minimum vertices per shape", () => {
  const area = { shape: "AREA", points: [{ lat: 17.4, lon: 78.4 }, { lat: 17.5, lon: 78.4 }, { lat: 0, lon: 0 }, { lat: 17.5, lon: 78.5 }, { lat: 95, lon: 1 }] };
  const g = geo.fenceGeometry(area);
  same([g.points.length, g.dropped, g.issue], [3, 2, null]);
  same(geo.fencePath(area, g).length, 4, "AREA ring is closed");
  same(geo.fencePath({ shape: "LINE", points: area.points.slice(0, 2) }).length, 2);
  assert.match(geo.fenceGeometry({ shape: "AREA", points: area.points.slice(0, 2) }).issue, /zone needs 3/);
  assert.match(geo.fenceGeometry({ shape: "LINE", points: [] }).issue, /line needs 2/);
  assert.equal(geo.fenceGeometry({ shape: "CIRCLE", points: area.points }).issue, "Unknown shape");
  same(geo.fencePath({ shape: "AREA", points: [] }), []);
  assert.equal(geo.fenceGeometry({ shape: "AREA", points: null }).points.length, 0);
});

test("geofence binding and colour", () => {
  assert.equal(geo.bindingSummary({ bindType: "DEVICE", bindIds: [1, 2] }), "2 devices");
  assert.equal(geo.bindingSummary({ bindType: "GROUP", bindIds: [5] }), "1 group");
  assert.equal(geo.bindingSummary({ bindType: "GROUP", bindIds: [] }), "Not bound");
  assert.equal(geo.bindingSummary({ global: true }), "All devices (global)");
  assert.equal(geo.fenceColor({ color: "#12ab34" }), "#12ab34");
  assert.match(geo.fenceColor({ color: "red; background:url(x)" }), /^var\(/);
});

// ── Reports ─────────────────────────────────────────────────────────────────

test("report queries: mileage unpaged, others paged; device filter optional", () => {
  const range = { from: new Date("2026-10-20T00:00:00Z"), to: new Date("2026-10-27T00:00:00Z") };
  same(reports.reportQuery("mileage", range, null, 3), { from: "2026-10-20T00:00:00.000Z", to: "2026-10-27T00:00:00.000Z" });
  same(reports.reportQuery("driving", range, 7, 2), { from: "2026-10-20T00:00:00.000Z", to: "2026-10-27T00:00:00.000Z", deviceIds: [7], pageNumber: 2, pageSize: 20 });
  same(reports.mileageTotal([{ distanceKm: 1.25 }, { distanceKm: 2 }, {}, { distanceKm: NaN }]), { km: 3.3, missing: 2 });
  assert.equal(reports.safeHttpUrl("https://cdn.safefare.test/x.jpg"), "https://cdn.safefare.test/x.jpg");
  assert.equal(reports.safeHttpUrl("http://185.193.19.156:9096/files/1.mp4"), "http://185.193.19.156:9096/files/1.mp4");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "/relative", "", null]) assert.equal(reports.safeHttpUrl(bad), null);
  // Reserved placeholder hosts (RFC 2606 / 6761) can never serve a file — e.g. the export URL seen on 2026-10-27.
  for (const placeholder of ["https://example.invalid/exports/1.mp4", "https://files.example.invalid/x", "https://EXAMPLE.INVALID./x", "https://cdn.example/x.jpg", "https://example.com/x", "http://media.example.org/x"]) {
    assert.equal(reports.safeHttpUrl(placeholder), null, placeholder);
  }
  // Only the reserved names themselves — look-alikes stay usable.
  for (const ok of ["https://invalid.safefare.io/x", "https://myexample.com/x", "https://example.community/x", "https://cdn.safefare.io/example/invalid.mp4", "https://examples.com/x", "https://example.co/x", "https://notexample.org/x"]) {
    assert.equal(reports.safeHttpUrl(ok), ok, ok);
  }
});

// ── Video ───────────────────────────────────────────────────────────────────

test("IST day keys and ranges", () => {
  assert.equal(video.istDayKey(new Date("2026-10-26T19:00:00Z")), "2026-10-27", "00:30 IST next day");
  assert.equal(video.istDayKey(new Date("2026-10-26T18:00:00Z")), "2026-10-26");
  same(video.istDayRange("2026-10-27"), { from: "2026-10-26T18:30:00.000Z", to: "2026-10-27T18:30:00.000Z" });
});

test("recording calendar: only valid day numbers for the month are used", () => {
  same([...video.calendarDayKeys("2026-02", [1, 28, 29, 0, -1, 2.5, "3", null])], ["2026-02-01", "2026-02-28"]);
  same([...video.calendarDayKeys("2026-10", null)], []);
});

test("channels and export requests", () => {
  same(video.channelOptions({ cameraLines: [3, 1, 1, 17, 0], cameraCount: 8 }), [1, 3]);
  same(video.channelOptions({ cameraCount: 4 }), [1, 2, 3, 4]);
  same(video.channelOptions({ cameraCount: 0 }), []);
  same(video.channelOptions(undefined), []);
  same(video.exportRequestFor({ channel: 2, beginTime: "2026-10-27T01:00:00Z", endTime: "2026-10-27T01:05:00Z" }, 9), { deviceId: 9, channel: 2, from: "2026-10-27T01:00:00Z", to: "2026-10-27T01:05:00Z" });
  for (const rec of [{ channel: 0, beginTime: "2026-10-27T01:00:00Z", endTime: "2026-10-27T01:05:00Z" }, { channel: 2, beginTime: "2026-10-27T01:05:00Z", endTime: "2026-10-27T01:00:00Z" }, { channel: 2 }]) {
    assert.equal(video.exportRequestFor(rec, 9), null);
  }
});
