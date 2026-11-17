// Not-found handling under /drive-vision: the file-system routes plus the access policy that
// RouteGuard applies to them. Unmatched paths render the root app/not-found.tsx (404.html in a
// static export), which wraps the drive-vision AuthGate + shell, so they never show Next's bare 404.
// No catch-all route: static export can't pre-render one.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const { computeAccess, decideRoute, screenForPath } = realm.require("features/drive-vision/access/access-policy");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const APP_DIR = path.join(__dirname, "..", "src", "app", "drive-vision");
const { readIdentity } = realm.require("features/drive-vision/access/identity");
const { IDENTITIES } = require("./helpers/identities.cjs");
// V10 identities (GET /me/permissions): a tenant ADMIN, and an identity with no permission at all.
const admin = computeAccess(readIdentity(IDENTITIES.tenantAdmin));
const unmapped = computeAccess(readIdentity({ userId: 2, platform: false, roleCode: "UNMAPPED", permissions: [] }));

/** Every page.tsx under app/drive-vision as a URL, dynamic segments filled with "1"; catch-alls skipped. */
function pageRoutes(dir = APP_DIR, url = "/drive-vision") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") out.push(url);
    if (!entry.isDirectory() || entry.name.startsWith("[...") || entry.name.startsWith("[[...")) continue;
    out.push(...pageRoutes(path.join(dir, entry.name), `${url}/${entry.name.startsWith("[") ? "1" : entry.name}`));
  }
  return out;
}

test("root not-found renders the in-shell panel; no catch-all route remains", () => {
  const root = fs.readFileSync(path.join(APP_DIR, "..", "not-found.tsx"), "utf8");
  assert.match(root, /<AuthGate>\s*<DriveVisionAppShell>\s*<AccessStatePanel reason="unknown-route" \/>\s*<\/DriveVisionAppShell>\s*<\/AuthGate>/);
  assert.match(root, /title: "Page not found"/);
  const segment = fs.readFileSync(path.join(APP_DIR, "not-found.tsx"), "utf8");
  assert.match(segment, /<AccessStatePanel reason="unknown-route" \/>/);
  const catchAlls = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (/^\[\[?\.\.\./.test(e.name)) catchAlls.push(path.join(dir, e.name));
      walk(path.join(dir, e.name));
    }
  })(path.join(APP_DIR, ".."));
  same(catchAlls, []);
});

test("every real drive-vision page maps to a screen, so the not-found page only receives unmatched paths", () => {
  // /drive-vision and /drive-vision/devices are redirect-only pages with no screen of their own.
  const routes = pageRoutes().filter((r) => r !== "/drive-vision" && r !== "/drive-vision/devices");
  assert.ok(routes.length >= 13, `found only ${routes.length} pages`);
  for (const r of routes) assert.notEqual(screenForPath(r), null, `${r} has no screen`);
});

test("unknown paths: Page not found for admins, never a role-based allow", () => {
  for (const p of ["/drive-vision/does-not-exist", "/drive-vision/does-not-exist/deeper", "/drive-vision/devicez"]) {
    same(decideRoute("authenticated", admin, p), { kind: "forbidden", screen: null, reason: "unknown-route" });
    same(decideRoute("authenticated", unmapped, p), { kind: "forbidden", screen: null, reason: "unknown-route" });
  }
  // Signed-out visitors go to login first; nothing about the path is revealed.
  same(decideRoute("unauthenticated", admin, "/drive-vision/does-not-exist"), { kind: "login", next: "/drive-vision/does-not-exist" });
});

test("unmatched sub-paths of a screen stay behind that screen's grant", () => {
  // Admin: allowed, so the root not-found.tsx panel renders (inside the shell).
  same(decideRoute("authenticated", admin, "/drive-vision/vehicles/1/nope"), { kind: "allow", screen: "vehicles" });
  // No grant: the access-denied panel wins; the not-found page never mounts.
  same(decideRoute("authenticated", unmapped, "/drive-vision/users/nope"), { kind: "forbidden", screen: "users", reason: "no-permissions" });
});
