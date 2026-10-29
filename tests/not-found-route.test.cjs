// Not-found handling under /drive-vision: the file-system routes plus the access policy that
// RouteGuard applies to them. Unmatched paths must reach the drive-vision layout (catch-all page →
// notFound() → segment not-found.tsx) so they render inside the shell, never Next's bare 404.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const { computeAccess, decideRoute, screenForPath } = realm.require("features/drive-vision/access/access-policy");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const APP_DIR = path.join(__dirname, "..", "src", "app", "drive-vision");
const admin = computeAccess({ id: 1, role: { id: 1, code: "PLATFORM_ADMIN" }, permissions: [] }, null);
const unmapped = computeAccess({ id: 2, role: { id: 2, code: "UNMAPPED" }, permissions: [] }, null);

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

test("catch-all page calls notFound() and the segment has its own not-found.tsx", () => {
  const catchAll = fs.readFileSync(path.join(APP_DIR, "[...slug]", "page.tsx"), "utf8");
  assert.match(catchAll, /from "next\/navigation"/);
  assert.match(catchAll, /\bnotFound\(\)/);
  const notFound = fs.readFileSync(path.join(APP_DIR, "not-found.tsx"), "utf8");
  assert.match(notFound, /<AccessStatePanel reason="unknown-route" \/>/);
});

test("every real drive-vision page maps to a screen, so the catch-all only receives unmatched paths", () => {
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
  // Admin: allowed, so the catch-all's not-found.tsx renders (inside the shell).
  same(decideRoute("authenticated", admin, "/drive-vision/vehicles/1/nope"), { kind: "allow", screen: "vehicles" });
  // No grant: the access-denied panel wins; the not-found page never mounts.
  same(decideRoute("authenticated", unmapped, "/drive-vision/users/nope"), { kind: "forbidden", screen: "users", reason: "no-role" });
});
