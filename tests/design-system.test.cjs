// The design system: approved tokens, one font, one token system, and the Platform Overview data helpers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const theme = read("styles/drive-vision-theme.css");
const globals = read("app/globals.css");
const layout = read("app/layout.tsx");
const token = (name) => new RegExp(`--dv-${name}:\\s*(#[0-9a-f]{6})`).exec(theme)?.[1];
const m = createRealm({ process: { env: {} } }).require("components/drive-vision/dashboard/platform-dashboard-model");

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the approved palette is what the tokens hold", () => {
  same({ surface: token("surface"), brand: token("brand"), powder: token("powder"), ink: token("ink"), canvas: token("canvas"), muted: token("ink-muted"), border: token("border") }, { surface: "#ffffff", brand: "#f16a45", powder: "#dceeff", ink: "#24344d", canvas: "#f7f8fc", muted: "#718096", border: "#e7ebf2" });
});

test("derived tokens do the jobs the approved colours can't", () => {
  for (const bg of ["surface", "canvas", "brand-tint", "brand-soft"]) assert.ok(contrast(token("brand-deep"), token(bg)) >= 4.5, `coral text on ${bg}`);
  assert.ok(contrast(token("powder-strong"), token("surface")) > 2.5, "powder-strong can be seen as a mark");
  assert.ok(contrast(token("ink"), token("powder")) >= 4.5, "navy text on powder");
  assert.ok(contrast(token("info"), token("powder")) >= 4.5, "info text on powder");
});

test("semantic text colours stay readable on their soft backgrounds", () => {
  for (const s of ["success", "warning", "danger", "info"]) assert.ok(contrast(token(s), token(`${s}-soft`)) >= 4, s);
});

test("selected states use tint and deep coral, because white on coral is under 4.5:1", () => {
  assert.ok(contrast("#ffffff", token("brand")) < 4.5, "the reason");
  for (const f of ["components/drive-vision/app-shell/topbar.tsx", "components/drive-vision/app-shell/sidebar.tsx", "components/drive-vision/shared/filter-bar.tsx"]) {
    const s = read(f);
    assert.match(s, /bg-brand-soft/, f);
    assert.doesNotMatch(s, /absolute inset-0 rounded-\S+ bg-ink/, `${f} has no charcoal selection`);
  }
});

test("there is one token system and one font", () => {
  assert.equal(fs.existsSync(path.join(SRC, "styles")) && fs.readdirSync(path.join(SRC, "styles")).length, 1);
  assert.doesNotMatch(theme + globals, /--sf-/);
  assert.match(layout, /Plus_Jakarta_Sans\(/);
  assert.match(layout, /weight: \["400", "500", "600", "700"\]/);
  assert.match(layout, /variable: "--font-plus-jakarta-sans"/);
  assert.match(globals, /--font-sans: var\(--font-plus-jakarta-sans\)/);
  assert.doesNotMatch(read("components/drive-vision/auth/login-screen.tsx"), /font-extrabold/, "800 isn't loaded");
});

test("no banned font is used anywhere in the app", () => {
  const files = fs.readdirSync(SRC, { recursive: true }).filter((f) => /\.(tsx?|css)$/.test(String(f)));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(SRC, String(f)), "utf8"), /Space.?Grotesk|Bricolage/i, String(f));
});

test("dark: utilities only apply under .dark, so the OS setting can't change this light app", () => {
  assert.match(globals, /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\);/);
  assert.match(globals, /color-scheme: light/);
});

test("primary buttons are coral with a distinct disabled state; informational ones are powder", () => {
  const button = read("components/ui/button.tsx");
  assert.match(button, /default: "bg-brand text-white[^"]*disabled:bg-surface-sunken disabled:text-ink-muted disabled:opacity-100/);
  assert.match(button, /secondary: "bg-powder text-ink/);
  assert.match(button, /destructive: "bg-danger text-white/);
  assert.match(button, /font-semibold/);
});

test("table headers come from tokens, not a hard-coded band", () => {
  assert.match(globals, /\.dv-thead th \{\s*background-color: var\(--dv-table-head\);\s*color: var\(--dv-table-head-ink\);/);
});

test("the permission checkbox keeps its size, click target and states", () => {
  const ui = read("components/drive-vision/platform/role-permission-matrix.tsx");
  for (const c of ["size-5", "after:-inset-2.5", "data-[state=checked]:bg-brand-deep", "disabled:border-dashed", "disabled:opacity-100"]) assert.ok(ui.includes(c), c);
});

test("top tenants: largest first, by the server's device count, limited", () => {
  const rows = m.topTenantsByFleetSize([{ id: 1, name: "A", devices: 5 }, { id: 2, name: "B", devices: 9 }, { id: 3, name: "C", devices: 9 }, { id: 4, name: "D", devices: 1 }], 3);
  same(rows.map((r) => [r.name, r.devices]), [["B", 9], ["C", 9], ["A", 5]]);
});

test("top tenants: a tenant without a count is left out, never shown as 0", () => {
  same(m.topTenantsByFleetSize([{ id: 1, name: "A" }, { id: 2, name: "B", devices: null }, { id: 3, name: "C", devices: -2 }, { id: 4, name: "D", devices: "9" }]), []);
  same(m.topTenantsByFleetSize([{ id: 1, code: "CODE", devices: 0 }]).map((r) => [r.name, r.devices]), [["CODE", 0]]);
});

test("alert chips follow the app's severity scale, and unknown levels stay neutral", () => {
  assert.match(m.alertChip(1), /danger/);
  assert.match(m.alertChip(2), /warning/);
  assert.match(m.alertChip(3), /powder/);
  assert.match(m.alertChip(4), /powder/);
  for (const v of [undefined, 0, 5]) assert.match(m.alertChip(v), /surface-sunken/, String(v));
});

test("Platform Overview shows no invented trend, and its KPIs are the server's figures", () => {
  const ui = read("components/drive-vision/dashboard/platform-dashboard.tsx");
  const kpis = ui.slice(ui.indexOf("{/* A. Platform overview */}"), ui.indexOf("{can.tenants && tenantsQ.error"));
  assert.doesNotMatch(kpis, /trend=|spark=/);
  assert.match(kpis, /label="Safety alerts" value=\{!can\.safety \? "—" : dash\(serverCount\(safety\?\.total\)\)\}/);
  assert.match(ui, /title="Top tenants by fleet size"/);
  assert.match(ui, /topTenantsByFleetSize\(tenantsQ\.data\?\.items \?\? \[\]\)/);
});

test("the tenant table and every earlier widget are still on Platform Overview", () => {
  const ui = read("components/drive-vision/dashboard/platform-dashboard.tsx");
  for (const id of ["pf-health", "pf-ops", "pf-safety", "pf-recent", "pf-trend", "pf-tenants"]) assert.ok(ui.includes(`titleId="${id}"`), id);
});

test("a switch can be seen in both states: white thumb on a track of at least 3:1", () => {
  const ui = read("components/ui/switch.tsx");
  assert.match(ui, /data-\[state=unchecked\]:bg-ink-subtle/);
  assert.match(ui, /rounded-full bg-white ring-0/);
  assert.ok(contrast("#ffffff", token("ink-subtle")) >= 3);
  assert.ok(contrast("#ffffff", token("brand")) >= 3);
});
