# Phase 2 · B — Vehicles & Devices: sanitized network evidence

Captured 2026-10-26 in Chrome (signed in as role `PLATFORM_ADMIN`) against `http://185.193.19.156:9096`, from the browser's Resource Timing entries for the page. Only method, path, query parameter names/values, status and server request ids are recorded — no headers, tokens, cookies or response bodies. All requests are `GET` unless noted; CORS preflights (`OPTIONS`, 200) are omitted.

Backend state at capture time: every read carries `extend.source = LOCAL`, `stale = true`, `fallbackReason = VENDOR_NOT_CONFIGURED` (1 demo device, 1 group).

## Vehicle list — `/drive-vision/vehicles`

| # | Action | Requests (one each) | Result |
|---|---|---|---|
| 1 | Page load | `/groups` 200 · `/reference/device-models` 200 · `/reference/object-types` 200 · `/devices` {pageNumber: 1, pageSize: 20} 200 · `/monitor/realtime` {deviceIds: 1} 200 | 1 row: Demo Truck AP01 / SFDEMO000001 / Demo Model A / Demo Truck / Demo North Fleet / last report 2 d ago / 2 cams |
| 2 | Type `sfdemo` (6 keystrokes, debounced) | `/devices` {keyword: sfdemo, pageNumber: 1, pageSize: 20} 200 · `/monitor/realtime` {deviceIds: 1} 200 | 1 row — one list request for six keystrokes |
| 3 | Type `sfdemo-nomatch` | `/devices` {keyword: sfdemo-nomatch, pageNumber: 1, pageSize: 20} **503** `DATA_UNAVAILABLE`, ref `e2241d18-1d6e-4d41-b019-9c655b22472a` | Error panel with server message, status, code and ref; "may just mean no matches" note; Clear filters |
| 4 | Open `?group=1` | `POST /auth/refresh` 200 (token near expiry — single refresh before the batch) · `/devices` {groupId: 1, pageNumber: 1, pageSize: 20} 200 · realtime 200 | Group select shows "Demo North Fleet"; 1 row |
| 5 | Open `?group=999` | `/devices` {groupId: 999, pageNumber: 1, pageSize: 20} **404** `NOT_FOUND` "Group not found", ref `a3a6c64d-f571-441c-a645-8f260dd1cec5` | Error panel with server message |
| 6 | Open `?expiry=soon` | `/devices` {pageNumber: 1, pageSize: 100} 200 (all pages; filtered in browser) | "0 devices match" (device has no `expiresAt`), browser-filter note, Clear filters |
| 7 | Clear filters → Asset tree | `/devices` {pageNumber: 1, pageSize: 20} 200 · realtime 200 · `/devices` {pageNumber: 1, pageSize: 100} 200 | Tree: Demo North Fleet (1) → Demo Truck AP01 |

## Vehicle detail — `/drive-vision/vehicles/{id}`

| # | URL | Requests | Result |
|---|---|---|---|
| 8 | `/vehicles/1` | `/groups` · `/reference/device-models` · `/reference/object-types` · `/reference/protocols` · `/devices/1` · `/monitor/realtime` {deviceIds: 1} · `/alarms/ai` {from, to (7 d), deviceIds: 1, pageNumber: 1, pageSize: 100} — all 200 · `/alarms/routine` (same params) **503** | All panels populated; routine alarms flagged unavailable; trips marked not available |
| 9 | `/vehicles/999999` | `/devices/999999` **404** "Device not found" — dependent realtime/alarm reads not sent | "Vehicle not found" with server message and ref |
| 10 | `/vehicles/veh-sample-01` | none (non-numeric id rejected client-side) | "Vehicle not found — links from sample-data screens won't resolve" |
| 11 | `/vehicles/new` | none | "Adding devices isn't enabled yet" |

Console: no messages matching `Bearer|eyJ|accessToken|refreshToken|password|Error`.

Direct read-only probes made during the audit (same session): `/devices/abc` → 400 `MALFORMED_REQUEST`; `/devices` {pageSize: 0} / {pageSize: 101} / {pageNumber: 0} → 400 `VALIDATION_FAILED` with `fieldErrors`; `/devices` {pageNumber: 2, pageSize: 1} → 503 `DATA_UNAVAILABLE`; `keyword` is case-insensitive and matches `name` and `terminalNo`.
