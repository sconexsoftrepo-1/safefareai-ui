# SafeFare AI — API integration checklist

Backend: Safe-Fare Fleet BFF, `NEXT_PUBLIC_API_BASE_URL` (dev: `http://185.193.19.156:9096`), prefix `/api/v1`.
Spec: `/v3/api-docs` (OpenAPI 3.1.0, bearer JWT). Only 200 responses are documented; the error envelope below was observed on the live server.

```json
{ "code": 401, "msg": "Invalid credentials", "data": null, "total": null,
  "extend": { "errorCode": "INVALID_CREDENTIALS", "fieldErrors": [], "requestId": "…" } }
```

CORS (checked 2026-10-26): preflight from `http://localhost:3000` allowed for GET/POST/PUT/PATCH/DELETE with `content-type, authorization`; `X-Request-Id` exposed. No dev proxy needed. Other origins (staging/prod hosts) must be added server-side.

Vendor-backed reads also carry data-source metadata in `extend` (observed 2026-10-26):

```json
{ "source": "LOCAL", "stale": true, "fallbackReason": "VENDOR_NOT_CONFIGURED", "syncedAt": "2026-10-24T11:05:43Z", "persisted": null }
```

The UI shows this as a "Stored data · may be stale" chip and a banner (`DataSourceBadge` / `DataSourceNotice`). When no stored data exists the server answers **503 `DATA_UNAVAILABLE`**.

Status values: Pending · In Progress · Integrated · Verified · Blocked

## Phase 1 — Foundation & authentication

| Module | Screen / component | Method & endpoint | Status | Last test (2026-10-26) | Outstanding |
|---|---|---|---|---|---|
| Auth | `/login` (LoginScreen) | POST `/auth/login` | Verified | User-reported PASS: 200 with network evidence. Earlier: invalid creds → 401 `INVALID_CREDENTIALS`, empty body → 400 `VALIDATION_FAILED`, client validation blocks empty submit. | — |
| Auth | api/client (refresh) | POST `/auth/refresh` | Verified | User-reported PASS. Earlier: invalid session → 401 → tokens cleared → `/login?…&reason=expired`. | — |
| Auth | Profile menu → Sign out | POST `/auth/logout` (bearer + refreshToken) | Verified | 2026-10-27 browser: 200 "Success" after sending the bearer token (without it: 401 "Authentication required") — see `evidence/phase1b-admin-access.md` | Server-side revocation of the refresh token not independently tested |
| Me | AuthGate, profile menu, page greeting | GET `/me` | Verified | User-reported PASS; observed 200 in browser (resource timing) | — |
| Me | auth-store (`menus`) | GET `/me/menus` | Integrated (fetched, not rendered) | Observed 200 — 3 items: `/dashboard`, `/alarms`, `/reports` | Route mapping needed before driving the sidebar (Phase 2 D) |

## Phase 2 — Real data on existing screens

### A. Dashboard — `/drive-vision/overview` (FleetOverview)

| Feature | Method & endpoint | Status | Test result (2026-10-26, browser, signed in as PLATFORM_ADMIN) | Known limitations |
|---|---|---|---|---|
| Device total, reminders, expiring/expired, group device counts | GET `/devices` (pageNumber, pageSize=100; pages until `total`, cap 20) | Verified | 200, 1 device, one request per load | All due dates are null in current data → "Nothing due" empty state. No driver-licence dates in the API. |
| Group count, group cards | GET `/groups` | Verified | 200, 1 group ("Demo North Fleet") | Per-group online share and distance not derivable (shown "—"). |
| Online/offline, GPS freshness, battery, "moving now" | GET `/monitor/realtime` | Verified | 200, onlineCount 1 / offlineCount 0; source LOCAL, stale. Banner and chip render. | `statusCode` / `positionMode` meanings undocumented → moving/idle/parked and "No GPS fix" not shown. "Moving now" = speed > 0 and report ≤ 5 min old. |
| AI events KPI, trend, recent activity, "awaiting handling" | GET `/alarms/ai` (from, to, pageNumber, pageSize=100; cap 5 pages) | Verified | 7 d: 200, 1 event (Sat 24 Oct, NEW). Today: 503 `DATA_UNAVAILABLE` → "Unavailable" KPI and error panel. Range switch and Retry each sent one new request. | `handlingStatus` values undocumented (only `NEW` observed). `severity` scale undocumented → not mapped to critical/high. |
| Routine alarms in trend and activity | GET `/alarms/routine` | Integrated (backend returns 503) | 503 `DATA_UNAVAILABLE` for 24 h and 7 d → inline error with retry; legend "n/a" | Needs vendor feed or stored routine alarms. |
| Distance driven, top vehicles by mileage/driving time | — | Blocked (no endpoint) | Shown as "Not provided by the API" | Could derive from GET `/devices/{id}/track` (`relativeMileageKm`) at one request per device; needs agreement. |
| Header bell / sidebar alert badge | — | Pending (still mock) | — | Part of shell chrome; moves to alarms work (Phase 5). |

Not yet tested: network-failure/timeout and 403 states on this screen (shared `ApiErrorState` handles them), empty fleet (0 devices), mobile layout.

### B. Vehicles & devices — `/drive-vision/vehicles`, `/vehicles/{id}`, `/vehicles/new`

Read-only integration. Evidence: [evidence/phase2-b-vehicles-network.md](evidence/phase2-b-vehicles-network.md).

| Feature | Method & endpoint | Status | Test result (2026-10-26, browser) | Known limitations |
|---|---|---|---|---|
| Vehicle list (table) | GET `/devices` {pageNumber, pageSize=20} | Verified | 200, 1 row; one request per load | No sort parameter → columns not sortable. Multi-page UI not exercised (only 1 device exists). |
| Search | GET `/devices` {keyword} (debounced 350 ms) | Verified | 6 keystrokes → 1 request; match 200; no match → **503 `DATA_UNAVAILABLE`** shown with note | Backend returns 503 instead of an empty list for no matches (and for pages past the end). Keyword matches name and terminalNo, case-insensitive. |
| Group filter | GET `/groups` + GET `/devices` {groupId} | Verified | groupId=1 → 200; groupId=999 → 404 "Group not found" | — |
| Expiry filter | GET `/devices` all pages (pageSize=100, cap 20 pages) + browser filter | Verified | 1 request; 0 matches (no `expiresAt` in data); "filtered in browser" note shown | No server-side expiry filter. |
| Asset tree | same as expiry filter | Verified | Group → device tree rendered | GroupDto has no owner, so the old user level is gone. |
| Last report column | GET `/monitor/realtime` {deviceIds: ids on screen} | Verified | 200, "2 d ago" | Status column removed: `statusCode` meaning undocumented. |
| Name lookups | GET `/reference/device-models`, `/reference/object-types`, `/reference/protocols` | Verified | 200 each; ids resolved to names | A failed lookup falls back to ids with a note. |
| Detail | GET `/devices/{id}` | Verified | 1 → 200 all panels; 999999 → 404 (dependent reads skipped); non-numeric → no request | No plate number field in DeviceDto. Driver gender not shown (coding undocumented). |
| Detail: latest state | GET `/monitor/realtime` {deviceIds: id} | Verified | 200: coordinates, speed, odometer, battery, heading | statusCode / positionMode / networkType / gsmSignal shown as raw "undocumented" codes. Map deferred to Phase 4. |
| Detail: recent events | GET `/alarms/ai`, `/alarms/routine` {from, to = 7 d, deviceIds} | Verified | AI 200 (1 event); routine 503 → flagged | — |
| Detail: recent trips | — | Blocked (no endpoint) | "Not available yet" | Needs track integration (Phase 4). |
| Create / update / delete device, transfer, new group | POST `/devices`, PUT/DELETE `/devices/{id}`, POST `/groups` | Pending — product-owner decision | Not executed. Buttons disabled with reason; `/vehicles/new` shows a notice instead of the sample form. | See write-operation review below. |

#### Write-operation review (not executed)

| Operation | Endpoint | Required fields (spec) | Charge / risk notes |
|---|---|---|---|
| Add device | POST `/devices` (DeviceRequest) | groupId, name ≤100, terminalNo (`^[0-9A-Za-z]{11,20}$`), modelName ≤60, protocol 1–3, objectTypeId, cameraCount 0–16 | Registers a device with the vendor (1.1 addVehicle) once the vendor feed is configured. No documented charge for adding, but activation/expiry is vendor-managed. Responds 200 (not 201). |
| Edit device | PUT `/devices/{id}` (DeviceRequest — same required fields; full replace) | as above | Vendor 1.2 updateVehicle: **"terminalType change may deduct coins"** (Fleet_Feature_API_Mapping.xlsx). `modelName` maps to vendor terminalType. |
| `confirmChargeableChange` | boolean on DeviceRequest | optional | **Undocumented** in the spec (no description, no error contract). Inferred — not confirmed — to be the BFF's opt-in for a coin-deducting model change. Neither true nor false is known to be safe. |
| Move to another group ("transfer") | PUT `/devices/{id}` with a new groupId | full DeviceRequest | No transfer endpoint. A PUT must resend every field, so it can also trigger the model-change charge if modelName differs. |
| Delete device | DELETE `/devices/{id}` | — | Irreversible at the vendor (1.3 delVehicle). |
| Delete group | DELETE `/groups/{id}` {cascadeDevices} | — | `cascadeDevices` deletes the group's devices too (vendor 2.3). |
| Renewal | — | — | Coin-consuming vendor 7.1 is **not** exposed by the BFF. |

Decisions needed before any write test: (1) backend to document `confirmChargeableChange` (what triggers a charge, the error returned when it's missing, cost shown to the user); (2) whether operators may change models / delete devices at all; (3) a disposable test device and group on a non-production tenant.

### C. Drivers — Blocked
No driver endpoints in the spec. Driver data exists only as `DeviceDto.driver` / `DeviceRequest.driver*` fields (one driver per device; no availability, status or licence expiry).

### D. Dynamic sidebar & permissions — Pending
`/me/menus` returns 3 items whose `routePath` values (`/dashboard`, `/alarms`, `/reports`) don't match app routes. Needs an agreed routeKey → screen mapping, and menus for the remaining screens, before the sidebar is driven by it. Permission codes are available on `/me` (`permissions[]`).

## Phase 4 — Live map & track history

Evidence: [evidence/phase4-live-map-track-network.md](evidence/phase4-live-map-track-network.md). Map: the existing `FleetMap` now takes `bounds` (projection fitted to API coordinates, snapped to a 0.25° grid) and draws a labelled lat/lon grid instead of the illustrative Hyderabad base map. Real base map added in the follow-up below (MapLibre + MapTiler, coordinate grid as fallback).

| Feature | Method & endpoint | Status | Test result (2026-10-26, browser) | Known limitations |
|---|---|---|---|---|
| Live map + list (`/monitoring`) | GET `/monitor/realtime` (no deviceIds) | Verified | 200; 1 marker; server online/offline counts shown | Marker colour = report age from deviceTime (≤ 5 min / ≤ 1 h / stale). statusCode not used (undocumented). |
| Polling | GET `/monitor/realtime` every `NEXT_PUBLIC_REALTIME_POLL_MS` (default 30 s, min 10 s) | Verified | Requests at 1.1 / 31.0 / 61.0 s; none after leaving the page (77 s) | Paused while the tab is hidden and while a request is in flight (logic in place; hidden-tab pause not observed). |
| Group filter / names | GET `/devices` (all pages) + GET `/groups` | Verified | 200; group shown in list and panel | DeviceStateDto has no groupId — joined via device list. |
| Device panel | (realtime data) | Verified | Speed, heading, odometer, battery, altitude, sensors (raw), coordinates, device/received time | Sensor units undocumented → raw values. No address / reverse geocoding. |
| Missing / invalid coordinates | — | Verified (unit tests) | 8 cases: missing, null, NaN, out of range, (0, 0) → not plotted, listed with reason | No such data in the live backend to observe in the UI. |
| Deep links | `?vehicle=<id>` on monitoring, `?device=<id>` on trips | Verified | Preselect works | Links from sample-data screens use non-numeric ids and are ignored. |
| Track history (`/trips`) | GET `/devices/{id}/track` {from, to, positionFilter} | Verified | 7 d → 200 (1 point); 1 h window around the point → 200; ALL → 200 | Backend: range ≤ 7 days, from < to (400 otherwise). No stored points → **503**, not an empty track. |
| Range selection | presets 24 h / 3 d / 7 d + custom (IST) | Verified | >7 d blocked client-side (no request); IST→UTC conversion correct | — |
| Empty vs unavailable track | — | Verified (503) / unit-tested (empty) | 503 → "No track available" + server message + note; empty 200 → "No points in this range" (not observed live) | Backend uses 503 for both "no data" and "vendor down". |
| Ordering / bad points | — | Verified (unit tests) | Unordered re-sorted with note; no time → skipped; no position → listed, not drawn | — |
| Playback | (recorded points) | Verified (1 point) | Scrubber + list; stepping disabled with a single point | Steps between recorded points only; no interpolation. Multi-point playback not exercised (no data). |
| Stops / alarms on track | `stopSeconds`, `alarm` per point | Integrated | Not observed (null in data) | `pointType`, `runState`, `positionState` undocumented → raw codes only. `includeStops` / `minStopMinutes` sent as defaults; no visible effect observed. |
| Trip list / summaries | — | Blocked (no endpoint) | Notice shown | API returns raw points only. |

Not tested: network failure and timeout on these screens (shared `ApiErrorState` handles both; offline simulation wasn't available), 403, multi-point tracks, hidden-tab polling pause, Geofences screen visual regression after the `FleetMap` change (typechecks; demo path unchanged by default).

Shared-code changes: `useApiQuery` keeps the last good data when a refetch fails (needed for polling); `FleetMap` gained `bounds` / `basemap` / `legend` / `maxZoom` / `mapNote` and optional marker `state`.

Auth finding: refresh tokens are single-use (rotated). Two app instances sharing one stored session (observed with an iframe) sign each other out; a browser "Duplicate tab" copies the session and will sign out whichever tab refreshes second. → Fixed in the follow-up below.

### Phase 2 — browser pass (2026-10-27, Admin session)

Full matrix: [evidence/phase2-acceptance.md](evidence/phase2-acceptance.md). Live = real BFF request; simulated = page-local stub.

| Feature | Method & endpoint | Status | Test result | Known limitations |
|---|---|---|---|---|
| Users list / keyword / status / role | GET `/users`, `/roles` | Verified | 200; match, no-match (200 empty), DISABLED (0), ACTIVE (4), roleId 3 (1) | Pagination unexercised (4 users) |
| User detail / hierarchy / roles & permissions | GET `/users/{id}`, `/users/tree`, `/permissions` | Verified | 200 each | Parent shown by id when not on the current page |
| User admin writes | POST/PUT/PATCH `/users…` | Not executed | Disable confirmation opened and cancelled, 0 requests | Needs a disposable user + approval |
| Profile | PATCH `/me` | Verified | Change + restore, 200 each (`d2d70532…`, `a8cf0541…`); re-read equals snapshot | — |
| Preferences | PUT `/me/preferences` | Verified | alarmPopupMax 10→11→10, 200 each (`3743a858…`, `7bf10a24…`); all 14 fields sent; re-read equals snapshot apart from `updatedAt` | Value sets #27 |
| Password | POST `/me/password` | Not executed | — | User-operated plan in `evidence/phase2-write-test-plans.md` |
| Reports (4 kinds) | GET `/reports/*` | Verified (empty) | 200, 0 rows; range + device filters; 503 state **simulated** | No data on tenant |
| Geofences | GET `/geofences` {shape} | Verified | 200; AREA 1, LINE 0 | LINE freshness metadata (#30) |
| Geofence delete | DELETE `/geofences/{id}` | Not executed | Confirmation opened and cancelled, 0 requests | Not approved |
| Video calendar / recordings / exports list | GET `/devices/{id}/recording-calendar`, `/recordings`, `/video/exports` | Verified (empty) | 200; month nav, channel filter | Placeholder export URL now "Link not usable" (#29) |
| Video export request | POST `/video/exports` | Not executed | — | Not approved; cost unconfirmed |
| Command history / types | GET `/commands`, `/commands/types` | Verified | 200; type filter | — |
| Command detail | GET `/commands/{id}` | **Blocked by backend** | `/commands/1` 500 ×4 (refs in `evidence/backend-defect-commands-detail-500.md`); `/commands/999999` 404. UI: error + ref + Try again (browser); malformed-data handling (automated only) | #28 |

### Phase 4 follow-up — refresh-token race & geographic base map

Evidence: [evidence/phase4-followup-auth-basemap.md](evidence/phase4-followup-auth-basemap.md). Automated tests: `npm test` (Node test runner, no new dependencies).

| Item | Status | Result | Limitations |
|---|---|---|---|
| Cross-tab refresh coordination (`api/session-sync.ts`, `api/client.ts`) | Verified (automated) | 11/11 auth tests pass; 5 of them fail when coordination is disabled (mutation check) | Live multi-tab test against the BFF not yet run (session expired before testing). Without Web Locks the rescue path depends on the server *not* revoking the token family on reuse (unknown). |
| Concurrent requests in one tab | Verified (automated) | 5 parallel requests → 1 refresh | — |
| Duplicated tab, simultaneous refresh | Verified (automated) | 1 refresh call, no reuse, no sign-out, both tabs end with the same session | — |
| Stale refresh rejected after another tab succeeded | Verified (automated) | Without Web Locks: loser gets 401, adopts the winner's session, no sign-out | — |
| Tab that missed the broadcast (asleep/discarded) | Verified (automated) | Asks peers before refreshing; never sends the stale token (passes on a family-revoking server) | A tab closed in between can't answer; the remaining tab then signs out. |
| Same-storage documents (iframe) | Verified (automated) | Fresh storage read under the lock → 1 refresh | — |
| Different users in two tabs | Verified (automated) | Sessions never cross | — |
| Genuine expiry | Verified (automated) + observed live | Rejected refresh → one call, no retry, signed out; expired refresh token → signed out with no request. Live: an old session signed out locally with no refresh request (`[auth] session expired`). | — |
| Network failure during refresh | Verified (automated) | Session kept, no automatic retry; next request refreshes | — |
| No tokens in logs | Verified (automated) | Every log line checked for token values / `eyJ` / `Bearer` | — |
| Base map (MapLibre GL 6.14.0 + MapTiler `streets-v4`) — `map/geo-map.tsx` | Verified (browser) | Roads and labels render on Live Monitoring and Track history. Markers align with `map.project` to under 1 px. Selection, panel, track point and route layers work. 390 px: no horizontal scroll. Geofences and the alert drawer keep the legacy map. | Blank-map bug fixed: maplibre-gl.css overrode Tailwind's layered `absolute` (container 0 px high) → inline positioning. Real multi-point track line not observed (1-point data). |
| Fallback without key | Verified (browser) | Coordinate grid + "Base map off — no map key configured"; 0 MapTiler requests; selection works | — |
| Provider failure fallback | Verified (browser, missing style) | Coordinate grid + "the map style could not be loaded"; marker still plotted | 401 / 403 / 429 / no-WebGL2 / timeout paths not exercised live. |

#### Base map — provider notes

- **Key is public.** The browser sends `NEXT_PUBLIC_MAPTILER_KEY` with every style/tile request; it is not a secret. In the MapTiler dashboard restrict it under *Allowed HTTP origins* (e.g. `localhost:3000`, the production domain). Do not add `?` (accepts requests with no Origin). Never use a MapTiler service token in the frontend.
- **Privacy.** Every map view tells MapTiler which area (tile coordinates) is being viewed — for this app, where fleet vehicles are. Positions/markers themselves are drawn locally and are not sent.
- **Usage limits / pricing (MapTiler pricing page, checked 2026-10-26).** Free: 5,000 map sessions and 100,000 API requests per month; service pauses for the rest of the month when exceeded; intended for testing / non-commercial use, and shows the MapTiler logo. Flex: from $30/month, overage billed, spending limit available. A map session = a page load that initialises a map. Re-check before production.
- **Attribution.** MapLibre's attribution control shows the style's credits (© MapTiler © OpenStreetMap contributors); a MapTiler link is shown bottom-left.
- **Self-hosting.** `NEXT_PUBLIC_MAP_STYLE_URL` replaces MapTiler with any MapLibre style URL; no key is then sent.

## Phases 3, 5–7

Pending.
