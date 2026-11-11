// Live Monitoring vehicle marker on the MapLibre map: a top-down car on a freshness-coloured backing.
// The glyph is rendered for real in jsdom; GeoMap itself needs WebGL, so its wiring is checked in source.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/live", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Event", "DocumentFragment"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const realm = createRealm({ window, document: window.document, process: { env: {} } }, { react: React, "react/jsx-runtime": require("react/jsx-runtime") });
const vm = () => realm.require("components/drive-vision/map/vehicle-marker");
const model = () => realm.require("components/drive-vision/monitoring/live-fleet-model");

const roots = [];
test.afterEach(async () => {
  while (roots.length) {
    const r = roots.pop();
    await act(async () => r.unmount());
  }
  window.document.body.innerHTML = "";
});
async function render(props) {
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(React.createElement(vm().VehicleMarkerGlyph, props)));
  return host;
}
const marker = (patch = {}) => ({ id: "1215", lat: 17.385, lon: 78.4867, label: "AP31Z0044", color: "var(--dv-success)", statusLabel: "Reported ≤ 5 min ago", ...patch });

test("VM glyph: a top-down car on a round backing (not a dot), in a 44 px click target, with a white border and a shadow", async () => {
  const host = await render({ marker: marker(), selected: false, onClick() {} });
  const btn = host.querySelector("button[data-marker-id='1215']");
  assert.ok(btn, "one marker element, clickable");
  same([btn.style.width, btn.style.height], ["44px", "44px"], "hit area larger than the drawn car");
  assert.ok(btn.querySelector("[data-car]"), "car silhouette");
  assert.ok(btn.querySelectorAll("[data-car] rect").length >= 3, "body and mirrors");
  const backing = btn.querySelector("[data-backing]");
  same([backing.getAttribute("r"), backing.getAttribute("stroke"), backing.getAttribute("fill")], ["15", "white", "var(--dv-success)"], "30 px backing, white border");
  assert.match(btn.querySelector("svg").getAttribute("style"), /drop-shadow/);
  assert.equal(btn.getAttribute("aria-label"), "AP31Z0044, Reported ≤ 5 min ago");
});

test("VM freshness: the existing report-age colours (green ≤ 5 min, amber ≤ 1 h, grey stale) colour the backing and the windows", async () => {
  const meta = model().REPORT_AGE_META;
  same([meta.current.color, meta.recent.color, meta.stale.color], ["var(--dv-success)", "var(--dv-warning)", "var(--dv-ink-subtle)"], "thresholds and colours unchanged");
  for (const age of ["current", "recent", "stale", "none"]) {
    const host = await render({ marker: marker({ id: age, color: meta[age].color, statusLabel: meta[age].label }), selected: false });
    assert.equal(host.querySelector("[data-backing]").getAttribute("fill"), meta[age].color, age);
    assert.ok([...host.querySelectorAll("[data-car] path")].every((p) => p.getAttribute("fill") === meta[age].color), `${age}: windows in the status colour`);
  }
  const host = await render({ marker: marker({ id: "nocolor", color: undefined }), selected: false });
  assert.equal(host.querySelector("[data-backing]").getAttribute("fill"), "var(--dv-ink-subtle)", "no colour → neutral grey");
});

test("VM heading: rotates only for a reliable heading (showHeading); otherwise points up; never derived from positions", async () => {
  const { carRotation } = vm();
  same([carRotation({ heading: 90, showHeading: true }), carRotation({ heading: -90, showHeading: true }), carRotation({ heading: 450, showHeading: true })], [90, 270, 90]);
  same([carRotation({ heading: 90, showHeading: false }), carRotation({ heading: undefined, showHeading: true }), carRotation({ heading: NaN, showHeading: true }), carRotation({})], [0, 0, 0, 0], "missing or unreliable → default orientation");
  assert.equal(carRotation({ heading: 90, showHeading: true }, 30), 60, "the map bearing is subtracted (GeoMap keeps it at 0)");
  let host = await render({ marker: marker({ heading: 135, showHeading: true }), selected: false });
  assert.match(host.querySelector("[data-car]").parentElement.getAttribute("transform"), /^rotate\(135\)/);
  host = await render({ marker: marker({ id: "parked", heading: 135, showHeading: false }), selected: false });
  assert.match(host.querySelector("[data-marker-id='parked'] [data-car]").parentElement.getAttribute("transform"), /^rotate\(0\)/);
  const live = read("components/drive-vision/monitoring/live-monitoring.tsx");
  assert.match(live, /heading: s\.directionDeg,\s*showHeading: a === "current" && \(s\.speedKmh \?\? 0\) > 0,/, "the API's directionDeg, trusted only for a fresh report of a moving vehicle (rule unchanged)");
});

test("VM selection and click: selected car is highlighted (colour halo + ring, slightly larger, label); click reports the marker id", async () => {
  const clicks = [];
  let host = await render({ marker: marker(), selected: true, onClick: (id) => clicks.push(id) });
  const btn = host.querySelector("button");
  same([btn.getAttribute("aria-pressed"), btn.dataset.selected, host.querySelector("[data-backing]").getAttribute("r"), host.querySelector("[data-backing]").getAttribute("stroke")], ["true", "true", "17", "white"]);
  const halo = host.querySelector("[data-selected-halo]");
  same([halo.getAttribute("fill"), halo.getAttribute("stroke")], ["var(--dv-success)", "var(--dv-success)"], "in the vehicle's colour, so it shows on dark tiles too");
  assert.ok(host.textContent.includes("AP31Z0044"), "the label shows for the selected car");
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  same(clicks, ["1215"]);
  host = await render({ marker: marker({ id: "2", alarm: true }), selected: false });
  assert.ok(host.querySelector("[data-marker-id='2'] [data-alarm-ring]"), "active alarm ring kept");
  assert.match(host.querySelector("[data-marker-id='2']").getAttribute("aria-label"), /active alarm$/);
  host = await render({ marker: marker({ id: "3" }), selected: false });
  assert.equal(host.querySelector("[data-marker-id='3']").tagName, "DIV", "no onClick → not a button (as before)");
});

test("VM wiring: GeoMap still uses its HTML markers (anchored at the centre, one per vehicle, positions updated in place); only the glyph changed", () => {
  const geo = read("components/drive-vision/map/geo-map.tsx");
  assert.match(geo, /<VehicleMarkerGlyph marker=\{g\.members\[0\]\} selected=\{g\.members\[0\]\.id === selectedId\} onClick=\{onMarkerClick\} mapBearing=\{map\.map\.getBearing\(\)\} \/>/);
  assert.match(geo, /<HtmlMarker key=\{g\.id\} rt=\{map\} lat=\{g\.members\[0\]\.lat\} lon=\{g\.members\[0\]\.lon\}/, "same coordinates as before");
  assert.match(geo, /new rt\.ml\.Marker\(\{ element: el, anchor: "center" \}\)\.setLngLat\(\[lon, lat\]\)/, "centre anchor, lon/lat order unchanged");
  assert.match(geo, /marker\.current\?\.setLngLat\(\[lon, lat\]\)/, "auto-refresh moves the existing marker");
  assert.match(geo, /dragRotate: false/, "bearing stays 0, so the heading is the on-screen angle");
  assert.doesNotMatch(geo, /function MarkerGlyph/, "the old dot glyph is gone");
  assert.doesNotMatch(read("components/drive-vision/map/vehicle-marker.tsx"), /<img|https?:\/\/|\.png|\.svg"/, "inline SVG, no image downloads");
});
