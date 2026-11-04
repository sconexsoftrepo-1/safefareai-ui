// V10 identity fixtures (GET /api/v1/me/permissions `data`) for access tests.
//
// Permission codes come from docs/openapi/api-docs-v10.json (every "Required permission" in the spec),
// so fixtures can't drift from the contract. What is NOT known from the backend is marked:
// - Safe-Fare Admin / tenant ADMIN: modelled on the brief ("platform: true" vs "platform: false,
//   roleCode ADMIN"; tenant ADMIN holds every tenant permission). Not observed live — no test accounts.
// - DRIVER: role code and the codes driver.app + own.data.read observed live on 2026-10-29.
// - Fleet Owner / Dispatcher / Viewer: role codes are unconfirmed, so these fixtures use obviously
//   synthetic codes (TEST_*). Only their permissions matter to the resolver.
const contract = require("./v10-contract.cjs");

const SPEC = contract.loadSpec();
const ALL_CODES = [...new Set(contract.specOperations(SPEC).flatMap((o) => contract.permissionCodes(contract.permissionOf(o.op))))].sort();
const PLATFORM_CODES = ["tenant.all"];
/** Every tenant-level code in the spec (all codes except the platform one). */
const TENANT_CODES = ALL_CODES.filter((c) => !PLATFORM_CODES.includes(c));
const READ_CODES = TENANT_CODES.filter((c) => /\.read$/.test(c) && c !== "own.data.read");

const DRIVER_SCREENS = [
  ["my_work", "/driver/work", "My Work"],
  ["my_shifts", "/driver/shifts", "My Shifts"],
  ["my_leave", "/driver/leave", "My Leave"],
  ["shift_checklist", "/driver/checklist", "Shift Checklist"],
  ["my_safety", "/driver/safety", "My Safety"],
  ["driver_notifications", "/driver/notifications", "Notifications"],
  ["my_profile", "/driver/profile", "My Profile"],
].map(([menuKey, routePath, title]) => ({ menuKey, title, routePath, icon: null, parentId: null, readOnly: false, resources: [], operations: [] }));

const ids = (extra) => ({ userId: 1, homeTenantId: 10, tenantId: 10, roleId: 1, screens: [], ...extra });

const IDENTITIES = {
  /** Safe-Fare Admin: platform true, no home tenant, no tenant selected. */
  platformAdmin: ids({ userId: 1, platform: true, homeTenantId: null, tenantId: null, roleId: 1, roleCode: "ADMIN", permissions: ALL_CODES }),
  /** Tenant ADMIN: same role code, platform false, every tenant permission. */
  tenantAdmin: ids({ userId: 2, platform: false, roleId: 2, roleCode: "ADMIN", permissions: TENANT_CODES }),
  /** Live DRIVER fixture (2026-10-29) with the driver menu routePaths as V10 screens. */
  driver: ids({ userId: 9, platform: false, roleId: 4, roleCode: "DRIVER", permissions: ["driver.app", "own.data.read"], screens: DRIVER_SCREENS }),
  /** Synthetic: a fleet owner managing drivers, dispatch and workforce, reading the fleet. */
  fleetOwner: ids({ userId: 3, platform: false, roleId: 5, roleCode: "TEST_FLEET_OWNER", permissions: ["device.read", "group.read", "track.read", "alarm.read", "report.read", "driver.read", "driver.create", "driver.update", "dispatch.read", "dispatch.create", "dispatch.update", "workforce.read", "workforce.create", "workforce.update"] }),
  /** Synthetic: a dispatcher — dispatch and read-only fleet context. */
  dispatcher: ids({ userId: 4, platform: false, roleId: 6, roleCode: "TEST_DISPATCHER", permissions: ["device.read", "driver.read", "dispatch.read", "dispatch.create", "dispatch.update", "workforce.read"] }),
  /** Synthetic: read-only viewer — every *.read code, no writes. */
  viewer: ids({ userId: 5, platform: false, roleId: 7, roleCode: "TEST_VIEWER", permissions: READ_CODES }),
};

module.exports = { SPEC, ALL_CODES, TENANT_CODES, READ_CODES, PLATFORM_CODES, DRIVER_SCREENS, IDENTITIES };
