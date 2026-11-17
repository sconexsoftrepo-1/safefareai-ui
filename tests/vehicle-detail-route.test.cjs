// Vehicle detail as a static route (/drive-vision/vehicles/detail/?vehicleId=…) so the app can be
// exported as static files: the id is read in the browser, every link goes through vehicleDetailHref,
// and access stays behind the "vehicles" screen grant.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const { computeAccess, decideRoute, reachableHref, screenForPath, vehicleDetailHref } = realm.require("features/drive-vision/access/access-policy");
const { readIdentity } = realm.require("features/drive-vision/access/identity");
const { IDENTITIES } = require("./helpers/identities.cjs");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const admin = computeAccess(readIdentity(IDENTITIES.tenantAdmin));
const unmapped = computeAccess(readIdentity({ userId: 2, platform: false, roleCode: "UNMAPPED", permissions: [] }));

test("vehicleDetailHref builds the static detail URL and encodes the id", () => {
  assert.equal(vehicleDetailHref(469), "/drive-vision/vehicles/detail/?vehicleId=469");
  assert.equal(vehicleDetailHref("469"), "/drive-vision/vehicles/detail/?vehicleId=469");
  assert.equal(vehicleDetailHref("a b&c=d/e"), "/drive-vision/vehicles/detail/?vehicleId=a%20b%26c%3Dd%2Fe");
  assert.equal(vehicleDetailHref(undefined), "/drive-vision/vehicles/detail/?vehicleId=", "no id → the not-found panel");
});

test("the detail URL belongs to the vehicles screen: same access checks as before", () => {
  const href = vehicleDetailHref(12);
  assert.equal(screenForPath(href), "vehicles");
  same(decideRoute("authenticated", admin, href), { kind: "allow", screen: "vehicles" });
  same(decideRoute("authenticated", unmapped, href), { kind: "forbidden", screen: "vehicles", reason: "no-permissions" });
  same(decideRoute("unauthenticated", admin, href), { kind: "login", next: href });
  assert.equal(reachableHref(admin, href), href);
  assert.equal(reachableHref(unmapped, href), null);
});

test("static route: Suspense around a client child that reads ?vehicleId= and passes it to VehicleDetail", () => {
  const page = read("app/drive-vision/vehicles/detail/page.tsx");
  assert.match(page, /<Suspense fallback=\{<LoadingSkeleton[^>]*\/>\}>\s*<VehicleDetailRoute \/>\s*<\/Suspense>/);
  assert.match(page, /title: "Vehicle details"/);
  assert.doesNotMatch(page, /generateStaticParams|fleetService|fetch\(/, "nothing is fetched or enumerated at build time");
  const route = read("components/drive-vision/vehicles/vehicle-detail-route.tsx");
  assert.match(route, /^"use client";/);
  assert.match(route, /useSearchParams\(\)\.get\("vehicleId"\) \?\? ""/);
  assert.match(route, /<VehicleDetail key=\{vehicleId\} vehicleId=\{vehicleId\} \/>/);
  // A missing or non-numeric id falls through to VehicleDetail's existing "Vehicle not found" panel.
  const detail = read("components/drive-vision/vehicles/vehicle-detail.tsx");
  assert.match(detail, /const id = \/\^\\d\+\$\/\.test\(vehicleId\) \? Number\(vehicleId\) : null;\s*if \(id === null\) return <NotFound/);
});

test("the dynamic [vehicleId] route is gone and no source builds /vehicles/{id} links", () => {
  assert.equal(fs.existsSync(path.join(SRC, "app", "drive-vision", "vehicles", "[vehicleId]")), false);
  assert.ok(fs.existsSync(path.join(SRC, "app", "drive-vision", "vehicles", "new", "page.tsx")), "/vehicles/new is unchanged");
  const offenders = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /\/drive-vision\/vehicles\/\$\{|SCREEN_ROUTES\.vehicles\}\/\$\{/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(SRC, p));
    }
  })(SRC);
  same(offenders, []);
});
