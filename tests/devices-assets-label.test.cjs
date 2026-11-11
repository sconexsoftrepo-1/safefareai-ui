// "Vehicles & Assets" → "Devices & Assets": a user-facing rename only. Route /vehicles, menu_key vehicles_assets,
// permission codes and access logic are unchanged. MOCKED / SYNTHETIC: identities are synthetic fixtures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const icons = new Proxy({}, { get: (_, name) => (name === "__esModule" ? false : `icon:${String(name)}`) });
const realm = createRealm({ process: { env: {} } }, { "lucide-react": icons, react: { useMemo: (f) => f() }, "@/features/drive-vision/access/use-access": { useAccess: () => null } });
const nav = realm.require("components/drive-vision/navigation/nav-config");
const useNav = realm.require("components/drive-vision/navigation/use-nav");
const p = realm.require("features/drive-vision/access/access-policy");
const idm = realm.require("features/drive-vision/access/identity");
const access = (raw, selectedTenantId = null) => p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });

const FLEET_OWNER = { ...IDENTITIES.fleetOwner, roleCode: "FLEET_OWNER" };
const SUBTITLE = "Manage registered vehicles, tracking devices, device groups and maintenance reminders.";
const devicesItems = (a) => useNav.navGroupsFor(a).flatMap((g) => g.items).filter((i) => i.screen === "vehicles");

test("DA nav: the section is 'Devices & Assets' and still opens /drive-vision/vehicles (screen key unchanged)", () => {
  const item = nav.ALL_NAV_ITEMS.find((i) => i.screen === "vehicles");
  same([item.label, item.href, item.subtitle], ["Devices & Assets", "/drive-vision/vehicles", SUBTITLE]);
  assert.equal(p.SCREEN_ROUTES.vehicles, "/drive-vision/vehicles");
  assert.ok(!nav.ALL_NAV_ITEMS.some((i) => /Vehicles & Assets/.test(`${i.label} ${i.title ?? ""} ${i.description} ${i.subtitle}`)));
});

test("DA nav: Fleet Owner and Safe-Fare Admin see exactly one Devices & Assets entry (sidebar and mobile share it)", () => {
  for (const a of [access(FLEET_OWNER), access(IDENTITIES.platformAdmin), access(IDENTITIES.platformAdmin, 42), access(IDENTITIES.tenantAdmin)]) {
    same(devicesItems(a).map((i) => [i.label, i.href]), [["Devices & Assets", "/drive-vision/vehicles"]]);
  }
  // The registry screen ("Vehicles") is a different section and keeps its name.
  const all = useNav.navGroupsFor(access(IDENTITIES.platformAdmin)).flatMap((g) => g.items);
  same(all.filter((i) => i.screen === "vehicleRegistry").map((i) => i.label), ["Vehicles"]);
  assert.match(read("components/drive-vision/app-shell/mobile-nav.tsx"), /<SidebarNav /, "mobile navigation renders the same nav groups");
});

test("DA access: unchanged — device.read still gates the section; drivers don't get it", () => {
  same(p.SCREENS.vehicles.requires.anyOf, ["device.read"]);
  same(devicesItems(access(IDENTITIES.driver)), []);
  same(devicesItems(access({ ...FLEET_OWNER, permissions: FLEET_OWNER.permissions.filter((c) => c !== "device.read") })), []);
  assert.equal(p.canAccessPath(access(FLEET_OWNER), "/drive-vision/vehicles"), true);
});

test("DA header: page title and subtitle on /vehicles; nested device pages show the parent section", () => {
  const meta = nav.getPageMeta("/drive-vision/vehicles", "", new Date(), false);
  same([meta.title, meta.subtitle, meta.nested], ["Devices & Assets", SUBTITLE, false]);
  const nested = nav.getPageMeta("/drive-vision/vehicles/7", "", new Date(), false);
  same([nested.title, nested.nested], ["Devices & Assets", true]);
  assert.match(read("app/drive-vision/vehicles/page.tsx"), /title: "Devices & Assets"/);
  assert.match(read("components/drive-vision/vehicles/vehicles-page.tsx"), /title="Devices & Assets"/);
  assert.match(read("components/drive-vision/vehicles/vehicle-detail.tsx"), /Back to Devices &amp; Assets/);
});

test("DA scope: no user-visible 'Vehicles & Assets' left in src; identifiers and resource labels untouched", () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && files.push(path.join(d, e.name))));
  walk(SRC);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /Vehicles (&|&amp;) Assets/, f);
  const policy = read("features/drive-vision/access/access-policy.ts");
  assert.match(policy, /vehicles: `\$\{DV_BASE\}\/vehicles`/, "route unchanged");
  assert.match(policy, /menu_key "vehicles_assets"/);
  // Vehicle-specific labels stay: the table column and the registry section.
  assert.match(read("components/drive-vision/vehicles/vehicles-page.tsx"), /header: "Vehicle"/);
  assert.match(read("components/drive-vision/navigation/nav-config.ts"), /\{ label: "Vehicles", screen: "vehicleRegistry"/);
});
