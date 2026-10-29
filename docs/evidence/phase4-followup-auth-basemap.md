# Phase 4 follow-up — refresh-token race & base map: evidence

Captured 2026-10-26. No tokens, cookies, keys or bodies recorded.

## Automated tests — `npm test`

`node --test "tests/*.test.cjs"`. Each simulated tab runs the real `src/features/drive-vision/api/client.ts`, `session.ts` and `session-sync.ts` (transpiled by the project's TypeScript) in its own vm context with its own sessionStorage and module state. The tabs share a fake BFF that rotates single-use refresh tokens and returns 401 on reuse, an in-process BroadcastChannel hub, and a Web Locks manager.

| # | Test | Result |
|---|---|---|
| 1 | Concurrent requests in one tab share a single refresh | pass |
| 2 | Two tabs with a duplicated session refreshing at once: one refresh, nobody signed out | pass |
| 3 | Without Web Locks, a stale-token rejection is rescued by the tab that refreshed first | pass |
| 4 | A tab that missed the broadcast asks peers before spending its stale token (server revokes the token family on reuse) | pass |
| 5 | An idle tab adopts the rotated session from the broadcast without any request | pass |
| 6 | Documents sharing one sessionStorage (iframe) re-read storage instead of reusing the old token | pass |
| 7 | Tabs signed in as different users never receive each other's session | pass |
| 8 | A genuinely rejected refresh token still signs out, without retrying the refresh | pass |
| 9 | An expired refresh token signs out without contacting the server | pass |
| 10 | A request still rejected after a successful refresh signs out after one retry | pass |
| 11 | A network failure during refresh keeps the session | pass |
| 12–14 | Track/position model (previous scratchpad script, now in `tests/track-model.test.cjs`) | pass |

Totals: 14 pass, 0 fail. Tests 1, 2, 3 and 8 also assert that no log line contains a token value, `eyJ` or `Bearer `.

**Mutation check.** I disabled the Web Lock, the peer hand-over and the broadcast adoption in `session-sync.ts` and reran the suite. Tests 2–6 failed and the other six passed. With the code restored, all 14 pass. So the race tests do exercise the coordination; they don't pass by accident.

## Live observation

When the existing tab was reloaded on `/drive-vision/monitoring`, the console logged `[auth] session expired — cleared tokens` with no `POST /auth/refresh`. The client treated the stored refresh token as past its expiry and signed out, which is the genuine-expiry path. A live multi-tab test needs a fresh sign-in and has not been run.

## Base map

- `maplibre-gl` 6.14.0 (exact). It is ESM-only, and its worker is configured with `setWorkerUrl(new URL(…, import.meta.url))` in `map/maplibre-runtime.ts`. The library is loaded on demand.
- `npm run build` passes. The worker is emitted as `.next/static/media/maplibre-gl-worker.*.mjs`.

### Blank-map bug (found and fixed 2026-10-26)

Symptom: MapTiler requests succeeded but Live Monitoring showed an empty map.

Diagnosis (in the browser, via a dev-only handle on the map container):
- The style URL was correct: `https://api.maptiler.com/maps/streets-v4/style.json?key=<redacted>`. It is a full style, not raw `/tiles/v4/{z}/{x}/{y}`.
- Style, TileJSON, 8 sprite files and glyphs all returned 200. The style loaded with 166 layers and the sources `maptiler_planet_v4` and `maptiler_attribution`. `loaded()` and `isStyleLoaded()` were both true, and the camera was at 17.6868, 83.2185, zoom 16 (correct).
- WebGL was fine: the canvas existed and was visible.
- **Cause:** the map container `.maplibregl-map` was **594 × 0 px**. `maplibre-gl.css` sets `.maplibregl-map { position: relative }`. That rule is unlayered, so it beats Tailwind 4's `absolute inset-0` utilities, which live in a cascade layer. The container lost its absolute positioning and collapsed to 0 height.
- **Fix:** I set the container's position with an inline style (`position: absolute; inset: 0`). I also moved the attribution control up 40 px so it no longer sits under the caption/legend row, and let that row use the full width so it doesn't wrap on phones. Nothing else in the map code changed.
- Markers and the track layer are only added after MapLibre's `load` event, so the style is always loaded first.

### Browser results (Chrome, signed in, development key configured)

| # | Check | Result |
|---|---|---|
| 1 | Roads and labels render | Pass. Live Monitoring: Gajuwaka–Scindia Road, 1st Street, BC Road, buildings, park. `queryRenderedFeatures` found 36 road features and 10 label features; all tiles loaded. Trips: Gajuwaka, Nadupuru Road, Harini Hospital. |
| 2 | Coordinate alignment | Pass. Live marker centre (297, 261) px equals `map.project(83.2185, 17.6868)` (297.0, 261). Track point (453, 180) vs projected (453.5, 180). My own Web Mercator formula for three other points matches `map.project` exactly (Δ 0.000 px). |
| 3 | Marker selection | Pass. Clicking the marker opens the device panel and highlights the list row. |
| 4 | Track points and path | Pass for the one stored point (marker and time label). The live track has a single point, so no line is drawn from real data. To check the route layers render, I put a synthetic 3-point line into the map's route source in the browser only (no API response faked) and removed it by reloading: casing, faded remainder and played part all drew aligned with the streets (10 rendered features). |
| 5 | 390 px viewport | Pass, using a same-origin 390 px iframe. `scrollWidth` 367 (no horizontal scroll), map 317 × 441 with roads and labels, attribution bottom 662 px vs caption row top 674 px (no overlap). The outer tab stayed signed in. |
| 6a | Missing key | Pass. Commented out the key temporarily: coordinate grid, "Base map off — no map key configured", 0 MapTiler requests, marker selection still works. |
| 6b | Provider failure | Pass. Temporarily set `NEXT_PUBLIC_MAP_STYLE_URL` to a missing localhost style: coordinate grid with "Base map unavailable — the map style could not be loaded", marker still plotted. `.env.local` was restored byte-for-byte afterwards (checked with `cmp`). |
| — | Console | No errors. One warning from MapTiler's own style: image `transportation:road_` missing from its sprite. No key in console output or the DOM. |
| — | lint / typecheck / tests / build | Pass (14/14 tests). |

Sanitized network (one Live Monitoring load): `GET /maps/streets-v4/style.json` 200, `GET /tiles/v4/tiles.json` 200, sprites ×8 200, plus glyph and vector-tile requests from MapLibre's web worker. Those worker requests aren't in the page's Resource Timing; I recorded glyphs 200 earlier from the page context, and the vector tiles come from your report.

Screenshots are in `C:\Users\user\AppData\Local\Temp\claude-chrome-screenshots-rZbrqB\`, not in the repo:
- `screenshot-1793010865043-13.jpg` — Live Monitoring with roads and labels
- `screenshot-1793010645368-5.jpg` — marker selected, device panel open
- `screenshot-1793010677662-6.jpg` — track point on the map
- `screenshot-1793010701021-7.jpg` — synthetic route-layer check
- `screenshot-1793010765228-10.png` — 390 px
- `screenshot-1793010793275-11.jpg` — provider-failure fallback
- `screenshot-1793010818535-12.jpg` — missing-key fallback

Not tested:
- Quota exceeded (429) and rejected key (401/403); the same fallback code handles them.
- A browser without WebGL2.
- A multi-point real track.
- A live two-tab refresh race (the access token did not come up for refresh during testing).
