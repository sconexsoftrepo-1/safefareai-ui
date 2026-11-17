// Static export (GoDaddy shared hosting): no server redirects, and the redirect-only routes resolve on
// the client through the existing RouteGuard landing logic, after authentication and permissions load.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const p = realm.require("features/drive-vision/access/access-policy");
const { readIdentity } = realm.require("features/drive-vision/access/identity");
const { IDENTITIES } = require("./helpers/identities.cjs");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const admin = p.computeAccess(readIdentity(IDENTITIES.tenantAdmin));
const platform = p.computeAccess(readIdentity(IDENTITIES.platformAdmin));
const unmapped = p.computeAccess(readIdentity({ userId: 2, platform: false, roleCode: "UNMAPPED", permissions: [] }));
const DEVICES = "/drive-vision/devices";
const COMMANDS = "/drive-vision/devices/commands";

test("/drive-vision/devices opens Device commands for every user; commands itself never redirects (no loop)", () => {
  for (const a of [admin, platform, unmapped]) {
    assert.equal(p.landingRedirect(a, DEVICES), COMMANDS);
    assert.equal(p.landingRedirect(a, `${DEVICES}/`), COMMANDS);
    assert.equal(p.landingRedirect(a, COMMANDS), null);
  }
  // RouteGuard computes the landing only for a "forbidden" decision, which needs a loaded session.
  same(p.decideRoute("authenticated", admin, DEVICES), { kind: "forbidden", screen: null, reason: "unknown-route" });
  same(p.decideRoute("unknown", admin, DEVICES), { kind: "checking" });
  same(p.decideRoute("unauthenticated", admin, DEVICES), { kind: "login", next: DEVICES });
  // Device commands keeps its own grant: no grant → the access-denied panel, as before.
  assert.equal(p.decideRoute("authenticated", unmapped, COMMANDS).kind, "forbidden");
});

test("the role-based /drive-vision landing is unchanged", () => {
  assert.equal(p.landingRedirect(platform, "/drive-vision"), p.SCREEN_ROUTES.platform);
  assert.equal(p.landingRedirect(admin, "/drive-vision/"), p.defaultLanding(admin));
});

test("no server redirect() remains under src/app; the redirect-only pages render nothing or a client redirect", () => {
  const offenders = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && /\b(permanentRedirect|redirect)\(/.test(fs.readFileSync(f, "utf8"))) offenders.push(path.relative(ROOT, f));
    }
  })(path.join(ROOT, "src", "app"));
  same(offenders, []);
  assert.match(read("src/app/drive-vision/devices/page.tsx"), /return null;/);
  assert.match(read("src/app/page.tsx"), /<RootRedirect \/>/);
  const root = read("src/components/drive-vision/auth/root-redirect.tsx");
  assert.match(root, /^"use client";/);
  assert.match(root, /router\.replace\("\/drive-vision"\)/);
});

test("next.config: static export with trailing slashes and unoptimised images; no server-only routing config", () => {
  const cfg = read("next.config.ts");
  assert.match(cfg, /^\s*output: "export",/m);
  assert.match(cfg, /^\s*trailingSlash: true,/m);
  assert.match(cfg, /unoptimized: true/);
  assert.match(cfg, /reactStrictMode: true/);
  assert.match(cfg, /poweredByHeader: false/);
  assert.match(cfg, /devIndicators: false/);
  assert.doesNotMatch(cfg, /\b(redirects|rewrites|headers)\s*[:(]/);
});
