// Google Maps migration: activation switch, loader and GeoMap behaviour.
// MOCKED ONLY. No real API key is used and no request reaches Google: `google.maps.importLibrary` is a test double,
// jsdom loads no external scripts, and the one test that lets the bootstrap build a <script> captures it instead of
// inserting it. Coordinates are synthetic test points.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want, msg) => assert.equal(JSON.stringify(got), JSON.stringify(want), msg);
const FAKE_KEY = "test-placeholder-not-a-key";

// ── DOM + React host ──────────────────────────────────────────────────────────────────────────────────────────────
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost:3000/drive-vision/live", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Event", "DocumentFragment", "navigator"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
for (const key of Object.getOwnPropertyNames(window)) {
  if (/^(HTML|SVG|Mouse|Keyboard|Pointer|Focus|Custom|UI|Input)\w*$/.test(key) && !(key in globalThis)) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

function modulesWith(stubs) {
  const base = { react: React, "react/jsx-runtime": require("react/jsx-runtime"), "motion/react": { ...require("motion/react"), useReducedMotion: () => false }, ...stubs };
  return new Proxy(base, {
    getOwnPropertyDescriptor(target, spec) {
      if (Object.hasOwn(target, spec)) return Object.getOwnPropertyDescriptor(target, spec);
      if (typeof spec === "string" && !spec.startsWith(".") && !spec.startsWith("@/")) {
        target[spec] = require(spec);
        return Object.getOwnPropertyDescriptor(target, spec);
      }
      return undefined;
    },
  });
}
const realmFor = (env, stubs = {}) =>
  createRealm(
    { window, document: window.document, HTMLElement: window.HTMLElement, navigator: window.navigator, getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: globalThis.ResizeObserver, Intl, Date, URL, URLSearchParams, process: { env: { NODE_ENV: "test", ...env } }, console: { ...console, error() {}, warn() {} } },
    modulesWith(stubs)
  );
const ENABLED = { NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: "true", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: FAKE_KEY };

// ── Fake Google Maps (maps + core libraries) ─────────────────────────────────────────────────────────────────────
function fakeGoogle({ fail = 0 } = {}) {
  const log = { imports: [], maps: [], mapType: [], polylines: [], overlays: [], removedOverlays: 0 };
  let failures = fail;
  class MVC {
    constructor() {
      this.a = [];
    }
    push(e) {
      return this.a.push(e);
    }
    getArray() {
      return this.a;
    }
    removeAt(i) {
      return this.a.splice(i, 1)[0];
    }
  }
  const ControlPosition = { TOP_LEFT: 1, TOP_RIGHT: 3, LEFT_TOP: 5, LEFT_BOTTOM: 6, RIGHT_TOP: 7, RIGHT_BOTTOM: 9, BOTTOM_LEFT: 10 };
  class Map {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.type = opts.mapTypeId;
      this.zoom = opts.zoom;
      this.center = opts.center;
      this.controls = Array.from({ length: 14 }, () => new MVC());
      this.pane = window.document.createElement("div");
      this.pane.setAttribute("data-fake-pane", "");
      el.appendChild(this.pane);
      log.maps.push(this);
    }
    getDiv() {
      return this.el;
    }
    getZoom() {
      return this.zoom;
    }
    setZoom(z) {
      this.zoom = z;
    }
    getHeading() {
      return 0;
    }
    getMapTypeId() {
      return this.type;
    }
    setMapTypeId(t) {
      this.type = t;
      log.mapType.push(t);
    }
    panTo(c) {
      this.center = c;
    }
    panBy() {}
    moveCamera(o) {
      if (o.center) this.center = o.center;
      if (o.zoom !== undefined) this.zoom = o.zoom;
    }
    fitBounds(b) {
      this.fitted = b.pts;
    }
  }
  class OverlayView {
    setMap(m) {
      if (m) {
        this.map = m;
        log.overlays.push(this);
        this.onAdd?.();
        this.draw?.();
      } else if (this.map) {
        this.onRemove?.();
        this.map = null;
        log.removedOverlays++;
      }
    }
    getPanes() {
      return this.map ? { overlayMouseTarget: this.map.pane } : null;
    }
    getProjection() {
      return this.map ? { fromLatLngToDivPixel: (ll) => ({ x: ll.lng * 1000, y: -ll.lat * 1000 }) } : null;
    }
    static preventMapHitsAndGesturesFrom() {}
  }
  class Polyline {
    constructor(o) {
      this.o = { ...o };
      this.map = o.map;
      log.polylines.push(this);
    }
    setOptions(o) {
      Object.assign(this.o, o);
    }
    setPath(p) {
      this.o.path = p;
    }
    setMap(m) {
      this.map = m;
    }
  }
  class LatLngBounds {
    constructor() {
      this.pts = [];
    }
    extend(p) {
      this.pts.push(p);
      return this;
    }
  }
  const event = { addListener: () => ({ remove() {} }), addListenerOnce: () => ({ remove() {} }) };
  const libs = { maps: { Map, Polyline, OverlayView }, core: { LatLngBounds, ControlPosition, event } };
  const google = {
    maps: {
      importLibrary: async (name) => {
        log.imports.push(name);
        if (failures > 0) {
          failures--;
          throw new Error("mock load failure");
        }
        return libs[name];
      },
    },
  };
  return { google, log, ControlPosition };
}

// ── Rendering helpers ────────────────────────────────────────────────────────────────────────────────────────────
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const roots = [];
test.afterEach(async () => {
  while (roots.length) {
    const r = roots.pop();
    await act(async () => r.unmount());
  }
  window.document.body.innerHTML = "";
  window.document.head.innerHTML = "";
  delete window.google;
  delete window.gm_authFailure;
});
async function mountMap(realm, props) {
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  const GeoMap = realm.require("components/drive-vision/map/geo-map").GeoMap;
  const render = (p) => act(async () => root.render(React.createElement(GeoMap, { ariaLabel: "Test map", dataNote: "Positions from API coordinates", ...p })));
  await render(props);
  await settle();
  return { host, rerender: async (p) => (await render(p), await settle()) };
}
const click = (el) => act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const MARKERS = [
  { id: "1", lat: 17.385, lon: 78.4867, label: "Bus 1", color: "var(--dv-success)" },
  { id: "2", lat: 17.44, lon: 78.35, label: "Bus 2", color: "var(--dv-warning)" },
];
const ROUTE = { id: "r", points: [{ lat: 17.38, lon: 78.48 }, { lat: 17.4, lon: 78.5 }, { lat: 17.42, lon: 78.52 }], color: "#243451" };

// ── Activation switch ────────────────────────────────────────────────────────────────────────────────────────────
test("GM config: Google Maps is enabled only with ENABLED === 'true' AND a non-empty key", () => {
  const cfg = realmFor({}).require("components/drive-vision/map/google-maps-config");
  const r = (env) => cfg.resolveGoogleMapsConfig(env);
  same(r({}), { enabled: false, reason: "disabled" }, "nothing set");
  same(r({ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: FAKE_KEY }), { enabled: false, reason: "disabled" }, "key without the switch");
  for (const v of ["false", "TRUE", "1", "yes", ""]) same(r({ NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: v, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: FAKE_KEY }).enabled, false, `switch "${v}"`);
  same(r({ NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: "true" }), { enabled: false, reason: "missing-key" });
  same(r({ NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: "true", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "   " }), { enabled: false, reason: "missing-key" });
  same(r(ENABLED), { enabled: true, apiKey: FAKE_KEY });
  same(cfg.DEFAULT_MAP_TYPE, "roadmap");
  same(cfg.MAP_TYPES.map((t) => t.id), ["roadmap", "satellite", "hybrid"], "exactly three views, no terrain");
});

test("GM config: the build reads the two variables by their literal names (inlined by Next.js)", () => {
  const src = read("components/drive-vision/map/google-maps-config.ts");
  assert.ok(src.includes("process.env.NEXT_PUBLIC_GOOGLE_MAPS_ENABLED"));
  assert.ok(src.includes("process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"));
});

// ── Disabled / missing key ───────────────────────────────────────────────────────────────────────────────────────
for (const [name, env] of [
  ["disabled", {}],
  ["switch off with a key", { NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: "false", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: FAKE_KEY }],
  ["missing key", { NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: "true" }],
]) {
  test(`GM placeholder (${name}): no script, no importLibrary call, placeholder text, children still render`, async () => {
    const fake = fakeGoogle();
    window.google = fake.google; // present but must not be touched
    const realm = realmFor(env);
    const { host } = await mountMap(realm, { markers: MARKERS, routes: [ROUTE], children: React.createElement("aside", { "data-panel": "" }, "Vehicle panel") });
    const region = host.querySelector('[role="region"]');
    assert.equal(region.getAttribute("data-map-state"), "disabled");
    assert.ok(host.textContent.includes("Google Maps is currently disabled."));
    assert.ok(host.textContent.includes("Enable Google Maps configuration to view the interactive map."));
    assert.ok(host.querySelector("[data-panel]"), "Live Monitoring's vehicle panel (a child) still renders");
    same(fake.log.imports, [], "importLibrary never called");
    same(fake.log.maps.length, 0, "no map created");
    assert.equal(window.document.querySelectorAll("script").length, 0, "no script element");
    assert.equal(window.gm_authFailure, undefined, "loader never ran");
  });
}

// ── Enabled with a mocked loader ─────────────────────────────────────────────────────────────────────────────────
test("GM enabled (mocked): one map, Roadmap by default, only the maps + core libraries requested", async () => {
  const fake = fakeGoogle();
  window.google = fake.google;
  const { host } = await mountMap(realmFor(ENABLED), { markers: MARKERS });
  assert.equal(fake.log.maps.length, 1);
  const map = fake.log.maps[0];
  assert.equal(map.opts.mapTypeId, "roadmap");
  same([...new Set(fake.log.imports)].sort(), ["core", "maps"], "no Places / Directions / Geocoding");
  assert.equal(map.opts.mapTypeControl, false, "custom selector instead");
  assert.equal(map.opts.zoomControl, true, "native zoom kept");
  assert.equal(map.opts.fullscreenControl, true, "native fullscreen kept");
  assert.equal(map.opts.streetViewControl, false);
  assert.equal(host.querySelector('[role="region"]').getAttribute("data-map-state"), "ready");
  assert.equal(window.document.querySelectorAll("script").length, 0, "the mock is used; no script added");
  const selector = map.controls[fake.ControlPosition.TOP_RIGHT].getArray()[0];
  const radios = [...selector.querySelectorAll('[role="radio"]')];
  same(radios.map((r) => r.textContent), ["Roadmap", "Satellite", "Hybrid"]);
  same(radios.map((r) => r.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.ok(map.pane.querySelector("[data-marker-id='1']") && map.pane.querySelector("[data-marker-id='2']"), "both vehicles drawn at their coordinates");
});

test("GM map type: Satellite then Hybrid then Roadmap via setMapTypeId — same map, markers, selection, polylines and view kept", async () => {
  const fake = fakeGoogle();
  window.google = fake.google;
  const { host } = await mountMap(realmFor(ENABLED), { markers: MARKERS, selectedId: "2", routes: [ROUTE], pins: [{ id: "s", kind: "start", lat: 17.38, lon: 78.48, title: "Start" }] });
  const map = fake.log.maps[0];
  map.zoom = 13;
  map.center = { lat: 17.4, lng: 78.45 };
  const overlaysBefore = fake.log.overlays.length;
  const polylinesBefore = fake.log.polylines.length;
  const radio = (id) => map.controls[fake.ControlPosition.TOP_RIGHT].getArray()[0].querySelector(`[data-map-type="${id}"]`);

  for (const id of ["satellite", "hybrid", "roadmap"]) {
    await click(radio(id));
    await settle();
    assert.equal(map.getMapTypeId(), id);
    assert.equal(radio(id).getAttribute("aria-checked"), "true");
    assert.equal(host.querySelector('[role="region"]').getAttribute("data-map-type"), id);
  }
  same(fake.log.mapType, ["satellite", "hybrid", "roadmap"], "switched in place");
  assert.equal(fake.log.maps.length, 1, "map never recreated");
  assert.equal(fake.log.overlays.length, overlaysBefore, "no marker re-created");
  assert.equal(fake.log.removedOverlays, 0, "no marker removed");
  assert.equal(fake.log.polylines.length, polylinesBefore, "no polyline re-created");
  assert.ok(fake.log.polylines.every((p) => p.map === map), "polylines still on the map");
  same([map.zoom, map.center], [13, { lat: 17.4, lng: 78.45 }], "centre and zoom kept");
  assert.equal(map.pane.querySelector("[data-marker-id='2']").getAttribute("data-selected"), "true", "selection kept");
  assert.ok(map.pane.querySelector("[data-pin-id='s']"), "start pin kept");
});

test("GM live updates: new GPS positions move the existing marker; vehicle clicks still select", async () => {
  const fake = fakeGoogle();
  window.google = fake.google;
  const clicks = [];
  const { rerender } = await mountMap(realmFor(ENABLED), { markers: MARKERS, onMarkerClick: (id) => clicks.push(id) });
  const map = fake.log.maps[0];
  const created = fake.log.overlays.length;
  const el = map.pane.querySelector("[data-marker-id='1']").parentElement;
  const leftBefore = el.style.left;
  await rerender({ markers: [{ ...MARKERS[0], lat: 17.5, lon: 78.6 }, MARKERS[1]], onMarkerClick: (id) => clicks.push(id) });
  assert.equal(fake.log.overlays.length, created, "no new overlay");
  assert.equal(fake.log.maps.length, 1, "no new map");
  assert.notEqual(el.style.left, leftBefore, "moved in place");
  assert.equal(el.style.left, `${78.6 * 1000}px`);
  await click(map.pane.querySelector("button[data-marker-id='2']"));
  same(clicks, ["2"]);
});

test("GM routes: casing + line polylines from the real points; played progress adds a third, updated in place", async () => {
  const fake = fakeGoogle();
  window.google = fake.google;
  const { rerender } = await mountMap(realmFor(ENABLED), { routes: [ROUTE], fitPoints: ROUTE.points, fitKey: "a" });
  same(fake.log.polylines.length, 2);
  same(fake.log.polylines[1].o.path, [{ lat: 17.38, lng: 78.48 }, { lat: 17.4, lng: 78.5 }, { lat: 17.42, lng: 78.52 }], "API coordinates, lat/lng unchanged");
  same(fake.log.maps[0].fitted.length, 3, "fit to the route points");
  await rerender({ routes: [{ ...ROUTE, progress: 0.5 }], fitPoints: ROUTE.points, fitKey: "a" });
  same(fake.log.polylines.length, 3, "played part added; others updated, not recreated");
  same(fake.log.polylines[2].o.path.length, 2);
  await rerender({ routes: [], fitPoints: ROUTE.points, fitKey: "a" });
  assert.ok(fake.log.polylines.every((p) => p.map === null), "removed routes leave the map");
});

test("GM loading failure: an error with Retry; Retry loads again and the map appears", async () => {
  const fake = fakeGoogle({ fail: 1 });
  window.google = fake.google;
  const { host } = await mountMap(realmFor(ENABLED), { markers: MARKERS, children: React.createElement("aside", { "data-panel": "" }) });
  const alert = host.querySelector('[role="alert"]');
  assert.ok(alert && alert.textContent.includes("Map unavailable"));
  assert.equal(fake.log.maps.length, 0);
  assert.ok(host.querySelector("[data-panel]"), "children still render on failure");
  const retry = [...alert.querySelectorAll("button")].find((b) => b.textContent.includes("Retry"));
  await click(retry);
  await settle();
  assert.equal(host.querySelector('[role="alert"]'), null);
  assert.equal(fake.log.maps.length, 1);
  assert.equal(host.querySelector('[role="region"]').getAttribute("data-map-state"), "ready");
});

test("GM key rejected (gm_authFailure): a clear message and no retry loop", async () => {
  const fake = fakeGoogle();
  window.google = fake.google;
  const { host } = await mountMap(realmFor(ENABLED), { markers: MARKERS });
  await act(async () => window.gm_authFailure());
  await settle();
  const alert = host.querySelector('[role="alert"]');
  assert.ok(alert.textContent.includes("rejected the API key"));
  assert.equal([...alert.querySelectorAll("button")].length, 0);
});

// ── Loader (bootstrap) without the network ───────────────────────────────────────────────────────────────────────
test("GM loader: one script at most, built only on the first importLibrary call; a failed script is retryable", async () => {
  const captured = [];
  const realAppend = window.document.head.append;
  window.document.head.append = (el) => captured.push(el); // capture; never insert, so nothing is fetched
  try {
    const loader = realmFor(ENABLED).require("components/drive-vision/map/google-maps-loader");
    assert.equal(captured.length, 0, "importing the module loads nothing");
    const first = loader.loadGoogleMaps(FAKE_KEY);
    const second = loader.loadGoogleMaps(FAKE_KEY);
    assert.equal(first, second, "single shared promise");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 1, "exactly one script");
    const url = new URL(captured[0].src);
    same([url.origin, url.pathname, url.searchParams.get("v"), url.searchParams.get("callback"), url.searchParams.get("libraries")], ["https://maps.googleapis.com", "/maps/api/js", "weekly", "google.maps.__ib__", "maps,core"]);
    assert.ok(captured[0].async);
    captured[0].onerror();
    await assert.rejects(first);
    assert.equal(window.google.maps.importLibrary, undefined, "stub removed so a retry starts fresh");
    // Retry, then simulate the API arriving: it replaces importLibrary and calls the bootstrap callback.
    const retry = loader.loadGoogleMaps(FAKE_KEY);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 2);
    const fake = fakeGoogle();
    window.google.maps.importLibrary = fake.google.maps.importLibrary;
    window.google.maps.__ib__();
    const rt = await retry;
    assert.ok(rt.maps.Map && rt.core.LatLngBounds);
  } finally {
    window.document.head.append = realAppend;
  }
});

// ── Whole screen with maps disabled ──────────────────────────────────────────────────────────────────────────────
test("GM screen: Trips & Tracking works with maps disabled — trip detail renders with the placeholder in the map slot", async () => {
  const TRIP = { id: 2, deviceId: 7, deviceName: "Bus 7", driverName: "Driver A", startTime: "2026-11-10T20:43:27Z", endTime: "2026-11-10T23:59:59Z", inProgress: false, distanceKm: 31.5, durationSeconds: 11_792, alarmCount: 0 };
  const insightService = {
    listTrips: async () => ({ items: [TRIP], total: 1, source: "api" }),
    tripSummary: async () => ({ data: { tripCount: 1, inProgressCount: 0, totalDistanceKm: 31.5, totalDrivingSeconds: 10_000, totalIdleSeconds: 0, alarmCount: 0 }, source: "api" }),
    tripDetail: async () => ({ data: { trip: TRIP, stops: [] }, source: "api" }),
    tripRoute: async () => ({ data: { trip: TRIP, points: [{ lat: 17.38, lon: 78.48, deviceTime: "2026-11-10T20:44:00Z" }, { lat: 17.42, lon: 78.52, deviceTime: "2026-11-10T21:00:00Z" }], stops: [], events: [] }, source: "api" }),
  };
  const fleetService = { listAllDevices: async () => ({ items: [{ id: 7, name: "Bus 7" }], total: 1 }) };
  const realm = realmFor({}, { "@/features/drive-vision/api/insight-service": { insightService }, "@/features/drive-vision/api/fleet-service": { fleetService } });
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(React.createElement(realm.require("components/drive-vision/trips/trip-history").TripHistory, {})));
  await settle();
  await click(host.querySelector("tbody tr"));
  await settle();
  const panel = host.querySelector('[aria-labelledby="trip-detail-title"]');
  assert.ok(panel, "trip detail opens");
  assert.ok(panel.textContent.includes("Google Maps is currently disabled."), "placeholder in the map slot");
  assert.ok(panel.textContent.includes("2 of 2 points plotted"), "route data still processed and summarised");
  assert.ok(panel.textContent.includes("Driver A"), "trip details unaffected");
  assert.equal(window.document.querySelectorAll("script").length, 0);
  assert.equal(window.google, undefined, "nothing Google-related was set up");
});

// ── Static guarantees ────────────────────────────────────────────────────────────────────────────────────────────
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test("GM source: no MapTiler / MapLibre left in the app, package.json or tests", () => {
  const files = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /maptiler|maplibre/i, path.relative(ROOT, f));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(!("maplibre-gl" in { ...pkg.dependencies, ...pkg.devDependencies }));
});

test("GM source: no Google Maps key in source or tests; no extra Google services; client-only loading", () => {
  const files = [...walk(SRC), ...walk(__dirname)].filter((f) => /\.(tsx?|c?js|mjs|json)$/.test(f));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /AIza[0-9A-Za-z_-]{20,}/, `${path.relative(ROOT, f)} contains something shaped like a Google API key`);
  const map = ["geo-map.tsx", "google-maps-loader.ts", "google-maps-config.ts"].map((f) => read(`components/drive-vision/map/${f}`)).join("\n");
  assert.doesNotMatch(map, /importLibrary\(["'](places|routes|geocoding|streetView|elevation|marker)["']\)/);
  assert.doesNotMatch(map, /new [\w.]*(DirectionsService|Geocoder|PlacesService|StreetViewPanorama|AdvancedMarkerElement)|mapId\s*:/);
  assert.ok(read("components/drive-vision/map/geo-map.tsx").startsWith('"use client";'), "client component");
  assert.match(read("components/drive-vision/map/google-maps-loader.ts"), /typeof window === "undefined"/, "refuses to run on the server");
  // Every screen reaches Google Maps only through GeoMap.
  for (const f of walk(path.join(SRC, "components")).filter((x) => !x.includes(`${path.sep}map${path.sep}`))) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /google-maps-loader|importLibrary|maps\.googleapis/, path.relative(ROOT, f));
  }
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8"), /maps\.googleapis|google-maps/, "no global map script");
});
