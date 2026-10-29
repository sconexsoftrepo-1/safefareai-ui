# Phase 4 — Live map & track history: sanitized network evidence

Captured 2026-10-26 in Chrome (role `PLATFORM_ADMIN`) against `http://185.193.19.156:9096`, from the page's Resource Timing entries. Recorded: method (all `GET` unless noted), path, query values, status, start time. No headers, tokens, cookies or bodies. CORS preflights omitted.

Backend state: `extend.source = LOCAL`, `stale = true`, `fallbackReason = VENDOR_NOT_CONFIGURED`; one device (id 1) whose realtime state is from 24 Oct 16:33 IST and whose stored track holds one point (24 Oct 16:32 IST).

## Live Monitoring — `/drive-vision/monitoring`

| # | Action | Requests | Result |
|---|---|---|---|
| 1 | Page load | `/groups` · `/reference/device-models` · `/reference/object-types` · `/monitor/realtime` {} · `/devices` {pageNumber: 1, pageSize: 100} — one each, all 200 | "1 online · 0 offline (server counts)"; 1 marker (grey = last report > 1 h); list row with device ID, group, speed |
| 2 | Select device | none | Panel: speed 48.5 km/h, heading 90°, odometer 12,050.5 km, battery 95 %, altitude 12 m, sensors temperature 31 / humidity 55 (raw), 17.68680, 83.21850, raw codes |
| 3 | Leave the page open | `/monitor/realtime` at 1.1 s, 31.0 s, 61.0 s — 200 | One poll per 30 s, no overlap |
| 4 | Navigate to Trips via "Track history" | no `/monitor/realtime` in the next 77 s | Polling stops on unmount |
| 5 | Open `?vehicle=1` | as #1 | Device preselected, panel open |

## Track history — `/drive-vision/trips?device=1`

| # | Action | Request | Result |
|---|---|---|---|
| 6 | Load (7 days) | `/devices/1/track` {from: now − 168 h, to: now, positionFilter: LOCATED} 200 | 1 point: 24 Oct 16:32, 42 km/h, 17.68000, 83.21000, battery 95 %; distance "—" (relativeMileageKm null, < 2 odometer readings) |
| 7 | 24 h | `/devices/1/track` {span 24 h, LOCATED} **503** `DATA_UNAVAILABLE` | "No track available for this range" + server message, ref, note |
| 8 | Custom, default (last 24 h IST) | {from: 2026-10-25T08:11:00Z …} 503 | IST input 13:41 → 08:11 UTC (correct) |
| 9 | Custom From = 10 Oct 00:00 (16 days) | **none** | "The range can be at most 7 days." |
| 10 | Custom 24 Oct 16:00 → 17:00 IST | {from: 2026-10-24T10:30:00Z, to: 2026-10-24T11:30:00Z, positionFilter: LOCATED} 200 | 1 point |
| 11 | Position filter → All points | same range, positionFilter: ALL — 200 | 1 point |

Direct read-only probes during the audit (`/devices/1/track`): 8, 31 and 90 days → 400 `INVALID_VALUE` "The time range may not exceed 7 days"; from = to or from > to → 400 "from must be before to"; missing `to` or `positionFilter=FOO` → 400 `MALFORMED_REQUEST`; future range / `UNLOCATED` / 1 day → 503 `DATA_UNAVAILABLE`; unknown device → 404 "Device not found". `includeStops=false` and `minStopMinutes=5` → 200, same single point.

## Mobile (390 px, same-origin iframe in the signed-in tab)

Monitoring at innerWidth 387: no horizontal overflow (scrollWidth 367), map above list, device panel as bottom sheet.

Side effect observed: the iframe app refreshed the token (`POST /auth/refresh` 200 at 26.6 s); the outer page then refreshed with its cached, now-rotated refresh token (`POST /auth/refresh` **401** at 31.4 s) and signed out. Shows the server rotates refresh tokens (single use).

Console: no messages matching `Bearer|eyJ|accessToken|refreshToken|password|Uncaught|TypeError`.
