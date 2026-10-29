# SafeFare AI — Feature status

Updated 2026-10-27 (after Phase 2 and the Phase 1B fixes). Evidence: the code under `src/`, the OpenAPI spec (`api-inventory.md`), authenticated browser tests from 2026-10-26 (`api-integration-checklist.md`, `docs/evidence/`), and the baseline below.

**Baseline (2026-10-27, after the Phase 1B fixes):** `npm run typecheck` pass · `npm run lint` pass · `npm test` 64/64 pass · `npm run build` pass (22 routes incl. `ƒ /drive-vision/[...slug]`). Details: `evidence/phase1b-admin-access.md`.

Status values: **Implemented and verified** · **Partially implemented** · **Requires frontend implementation** · **Requires backend API** · **Blocked by backend failure** · **Awaiting backend confirmation**

**Phase 2 verification caveat.** Every Phase 2 integration below was built from the OpenAPI contract and covered by unit tests of its request/validation logic, but **none has been exercised against the live BFF in a browser**: no authenticated browser session was available (Chrome extension timed out). They are therefore "Partially implemented — integrated, not browser-verified", never "verified". **Update 2026-10-27:** the read paths of Reports (Mileage tab), Historical Video, Geofences, Device Commands (history) and Users (list) were exercised in an authenticated Admin browser session — every read returned 200 (marked "read path browser-verified" below). Write paths remain unexercised. Full Phase 2 matrix (second pass, same day): `evidence/phase2-acceptance.md`.

"Mock" means the screen reads the in-browser sample store (`features/drive-vision/store/fleet-store.ts`, `mock-data/`, `services/`), not the BFF.

## Platform

| Feature | Status | Evidence / notes |
|---|---|---|
| Login (`POST /auth/login`) | Implemented and verified | 200, 401 `INVALID_CREDENTIALS`, 400 `VALIDATION_FAILED` observed (2026-10-26). User reports login works (2026-10-27). |
| Refresh / cross-tab rotation (`POST /auth/refresh`) | Implemented and verified | 11 automated race tests; live genuine-expiry path observed. Live multi-tab test not run. |
| Logout (`POST /auth/logout`) | Implemented and verified | 2026-10-27: without a bearer token the BFF answered 401 "Authentication required" (clean test, body carried the current refresh token). The spec's global `bearerAuth` isn't overridden for logout, so the client now sends the bearer token plus the refresh token of that same session (refreshed first if near expiry). Clean browser retest: 200 "Success", session cleared, protected routes → `/login?next=…` with 0 API calls. The earlier "user-reported pass" (2026-10-26) only reflected the local sign-out. |
| Current user (`GET /me`) | Implemented and verified | Drives AuthGate, profile menu, Settings profile. |
| Menus (`GET /me/menus`) | Partially implemented | Fetched; visible/active `routeKey`s feed the access policy, but no routeKey→screen mapping is confirmed, so menus grant nothing. |
| Permission-driven navigation & route guards | Partially implemented | `access/access-policy.ts`, deny by default. Unit + session-recovery tests. **Browser-verified:** unauthenticated → `/login?next=…`, 0 API calls. **Phase 1B authenticated Admin checks (2026-10-27): 9/9 pass** after fixes (see `evidence/phase1b-admin-access.md`). Unknown `/drive-vision/*` paths render the in-shell "Page not found" panel via `app/drive-vision/[...slug]` + `not-found.tsx` (HTTP 200 with a streamed 404 fallback — a real 404 status would need a Proxy check). A permission-denied state could not be shown in the browser: only an Admin account is available; it's covered by unit tests. New Reports screen added to `SCREEN_ROUTES`; Admin gets it via the existing all-screens grant — no new grant. |
| Admin / Fleet Owner / Driver role mapping | Awaiting backend confirmation | Only `PLATFORM_ADMIN` → admin. Fleet Owner / Driver not configured. |
| Driver data ownership | Requires backend API | No user↔driver↔device link. Frontend guards do not isolate data. |
| Profile edit (`PATCH /me`) | Implemented and verified — validation (blank name blocked, 0 requests) and a reversible change+restore round-trip, 200 each, re-read equals snapshot (2026-10-27, `evidence/phase2-acceptance.md` Pass 3) | Settings → Profile. Sends only changed fields; client checks mirror `UpdateMeRequest` patterns; server field errors shown per field; auth store updated from the response. |
| Change password (`POST /me/password`) | Partially implemented — integrated, not browser-verified (not approved for testing; the agent doesn't enter passwords) | Settings → Change password. Required, ≤ 72, new ≠ current, confirmation. No strength rule (none documented). Never logged. |
| Preferences (`GET/PUT /me/preferences`) | Implemented and verified — GET, range validation and a reversible PUT round-trip (alarmPopupMax 10→11→10, all 14 fields sent, re-read equals snapshot; `updatedAt` now set) (2026-10-27). **Note:** this account now has a saved preferences record, so it keeps these values and won't inherit future backend default changes | Settings → Workspace preferences. PUT sends the loaded object with edits (full replace); blocked when stored data lacks a required field. Editable: video layout, auto-stop, reminder mode/days, alarm pop-up limits, map clustering, night mode. Theme, home modules, device info fields, track alarm types kept as stored (allowed values undocumented). Overview reminders now read `expiryReminderDays` from the server (labelled "default" when unavailable). Browser-only display options (reduce motion, Iris launcher, Overview cards) remain local and are labelled so. |
| Responsive layout | Partially implemented | 2026-10-27: Phase 2 screens checked at desktop and at 768 / 390 / 360 px (same-origin width-constrained frames — the Chrome window couldn't be resized): no horizontal overflow. Users filter row overlapped at ≤ 390 px → fixed (search on its own row below `sm`), re-verified at all four widths. Other screens' interactions at mobile widths not exercised. |

## Screens

| Screen | Feature | Status | Evidence / notes |
|---|---|---|---|
| Overview | Device/group counts, online/offline, AI events | Implemented and verified | 2026-10-26. |
| Overview | Routine alarms | Implemented and verified | 2026-10-27: `/alarms/routine` 200 on Overview, Alerts and vehicle detail (the 2026-10-26 503 was not reproduced). 503 is still handled as unavailable. |
| Overview | Distance, mileage/driving ranking | Requires frontend implementation | Data now reachable through the Reports screen; Overview cards not yet wired. |
| Live Monitoring | Map, list, polling, panel | Implemented and verified | 2026-10-26. |
| Trips & Tracking | Track playback | Implemented and verified | 2026-10-26. |
| Trips & Tracking | Trip list / summaries | Requires backend API | Raw points only. |
| Vehicles | List, search, group filter, detail | Implemented and verified | 2026-10-26. No-match search → 503 (backend defect). |
| Vehicles | Create / edit / delete, new group | Awaiting backend confirmation | `confirmChargeableChange` semantics. |
| Vehicles | Device transfer (`POST /devices/transfer`) | Awaiting backend confirmation | **Not exposed.** `TransferRequest` mixes `groupId` with `fromVendorUserId`/`toVendorUserId`; whether it moves devices between groups or between vendor accounts, which permission it needs, and whether it is reversible or chargeable are undocumented. Nothing sent. |
| Alerts & Events | AI list | Implemented and verified | 2026-10-26. |
| Alerts & Events | Routine list | Implemented and verified | 2026-10-27: 200 (0 rows, 7 d). 503 handled as "unavailable", never as zero. |
| Alerts & Events | Recent routine alarms (`/alarms/routine/recent`) | Awaiting backend confirmation | Not used as a fallback: no time window parameters, so it can't stand in for a historical query; semantics (window, unhandled-only?) unknown. |
| Alerts & Events | Handling actions | Requires backend API | No alarm mutation endpoint. |
| **Reports** (new, `/drive-vision/reports`) | Mileage, driving, parking, media | Implemented and verified (empty data) — all four tabs, 7/30-day range and device filter 200 on 2026-10-27; 503 state checked with a simulated response. No non-empty data on the tenant | `GET /reports/mileage` (unpaged; total km summed from rows), `/driving`, `/parking`, `/media` (server-paged, 20). Time range + device filters. 503 shown as unavailable, not empty. Media links rendered only for http(s) URLs. `mediaType`/`triggerType` shown as raw codes. |
| Historical Video | Recording calendar | Implemented and verified (empty data) — month navigation 200 (2026-10, 2026-09) | `GET /devices/{id}/recording-calendar?month=YYYY-MM`. **Month format and the meaning of the returned integers (assumed day-of-month) are undocumented**; out-of-range values ignored. |
| Historical Video | Recordings of a day | Implemented and verified (empty data) — IST day window and channel filter 200 | `GET /devices/{id}/recordings` for the IST day, optional channel (from `cameraLines` / `cameraCount`). |
| Historical Video | Clip exports | Partially implemented — list verified; placeholder download URLs (`example.invalid`, #29) are now shown as "Link not usable" instead of a dead link (browser-verified 2026-10-27); export request not exercised (not approved; no recordings) | List `GET /video/exports?deviceId`; request `POST /video/exports` per recording segment after confirmation. Status shown raw. **No export was requested during development.** |
| Historical Video | Playback | Requires backend API | Needs the vendor video SDK/player (not provided). `GET /video/sdk-token` is never called. The old synthetic demo feed was removed. |
| Geofences | List + map | Implemented and verified — list, map, AREA/LINE filter, detail (2026-10-27). LINE freshness metadata inconsistent (#30) | `GET /geofences` (shape filter), drawn on the MapLibre base map (AREA rings closed; LINE polylines); invalid geometry listed with the reason, not drawn. Bindings resolved to group/device names. |
| Geofences | Delete | Partially implemented — confirmation dialog verified (cancelled, 0 requests); delete not sent | `DELETE /geofences/{id}` after confirmation. **Not executed during development.** |
| Geofences | Create / edit | Awaiting backend confirmation | `ruleTypes` (required, ≥ 1) and `areaType` / `colorIndex` codes undocumented; the old mock editor (with a circle shape the API lacks) was removed. |
| Device Commands | History, detail, types | Partially implemented — history, type filter and types verified 2026-10-27; **detail blocked: `GET /commands/1` → 500**, reproducible 4×; unknown id → correct 404 (#28, report: `evidence/backend-defect-commands-detail-500.md`). Detail panel hardened against malformed data (automated tests only — no 200 detail exists to view) | `GET /commands` (type/device filters, paged), `GET /commands/{id}` (without `refresh`), `GET /commands/types`. |
| Device Commands | Send | Awaiting backend confirmation | **Disabled.** No `POST /commands` call exists in the app. Simulated sending removed. |
| Device Commands | Diagnostics (`/devices/{id}/passthrough-data`) | Requires frontend implementation | Requires a `type` code (undocumented); not integrated. |
| Users & Sub-Accounts | List, filters, detail, hierarchy | Implemented and verified — list, keyword, status and role filters, detail, hierarchy (2026-10-27). Pagination unexercised (4 users) | `GET /users` (keyword debounced, status, role; paged 20), `/users/{id}`, `/users/tree`. Mock users removed from this screen. |
| Users & Sub-Accounts | Create, edit, enable/disable, unlock, reset password | Partially implemented — Disable confirmation verified (cancelled, 0 requests); no write sent | `POST /users`, `PUT /users/{id}` (parent resent), `PATCH /users/{id}/status` (ACTIVE⇄DISABLED only), `POST /users/{id}/unlock`, `POST /users/{id}/password`. Each confirmed; success only after the server answers. Own-account status/password changes blocked in the UI. **None executed during development** (shared data). |
| Users & Sub-Accounts | Roles & permissions | Implemented and verified (read-only) — `/permissions` 200, 5 roles with codes (2026-10-27) | Read-only: `GET /roles`, `GET /permissions`. Role create/edit/permission changes not exposed (affects all users of a role; role model unagreed). |
| Users & Sub-Accounts | Delete user | Awaiting backend confirmation | Not exposed: cascade behaviour for sub-accounts/devices undocumented. |
| Drivers | Records, licence, assignment | Requires backend API | Still mock. |
| Safety Analytics | Scores, trends | Requires backend API | Still mock. |
| Global search | Pages + sample records | Partially implemented | Sample records (admin only). |
| Notifications | Feed | Requires backend API | — |
| AI Assistant | Answers | Requires backend API | Sample data, admin only. |
| Vendor users / renewals / voices | — | Requires frontend implementation | Not in Phase 2 scope; renewals consume vendor coins. |

## Still sample-based after Phase 2

Drivers, Safety Analytics, Global search record results, AI assistant (Iris). (Users, Geofences, Device Commands, Historical Video and Settings no longer use sample data.)

## Driver workflows (all Requires backend API)

Driver profile & licence, driver↔vehicle assignment, assigned trip, trip accept/reject/start/complete, trip worksheet & history, shift start/end, working hours, readiness checklist, leave requests, driver notifications, driver safety history.

## Fleet Owner workflows (all Requires backend API)

Assign/reassign drivers, availability, conflict detection/resolution, swaps & approvals, dispatch verification, leave approval, availability overview.
