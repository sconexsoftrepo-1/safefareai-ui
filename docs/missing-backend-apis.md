# SafeFare AI — Missing backend APIs

Maintained throughout development. Started 2026-10-27 from the OpenAPI spec (`api-inventory.md`).

**Every endpoint path below is a frontend *proposal*, not an existing API.** None of them exist in the spec. Because the server returns 401 for any path before routing, unauthenticated probes cannot prove an undocumented endpoint is absent, so each item stays *Awaiting backend confirmation* until the backend team answers.

Gap type: **Absent** (not in spec) · **Undocumented** (exists, semantics missing) · **Failing** (exists, errors in dev) · **Awaiting confirmation**

Common rules for every proposal: bearer JWT; tenant isolation by `tenantId`; responses use the existing `ApiResponse` envelope with `total` for paging; `pageNumber`/`pageSize` (max 100) like existing lists; ISO-8601 UTC date-times; 403 with `errorCode` for scope violations; ownership enforced server-side (the frontend guard is not a control).

**Data-scope definitions used below.** *Admin*: whole tenant. *Fleet Owner*: devices in groups they own/are assigned + their sub-users (needs a defined user→group link — today `GroupDto` has no owner). *Driver*: only records linked to their own user id (needs the user↔driver link in item 1).

---

## P0 — Blocks role-based access (Phase 1)

### 1. Driver entity and user link — Absent
- **Purpose:** A driver must be a first-class record linked to a login user, so the Driver role can be scoped to its own data and Fleet Owners can manage drivers. Today the only driver data is `DeviceDto.driver` (name, card, phone, gender, drivingLicense, remark) embedded per device.
- **Roles:** Admin (CRUD all), Fleet Owner (CRUD in own fleet), Driver (read own).
- **Proposed:** `GET /drivers` (q: keyword, status, groupId, pageNumber, pageSize) · `GET /drivers/{id}` · `POST /drivers` · `PUT /drivers/{id}` · `DELETE /drivers/{id}` · `GET /me/driver`
- **Fields:** id, userId (nullable link to login user), name, phone, email, licenceNumber, licenceClass, licenceIssuedAt, licenceExpiresAt, cardNumber, status, groupId, assignedDeviceId, createdAt, updatedAt.
- **Status values (to be defined by backend):** e.g. ACTIVE / INACTIVE / ON_LEAVE / SUSPENDED.
- **Scope:** Fleet Owner limited to their groups; Driver only `/me/driver`.
- **Blocks:** Drivers screen, Driver dashboard, all of Phases 5–6.

### 2. Role catalogue for the three app roles — Awaiting confirmation
- **Purpose:** Map backend roles to Admin / Fleet Owner / Driver. Only `PLATFORM_ADMIN` has been observed.
- **Needed from backend:** the role codes that represent Fleet Owner and Driver (or agreement to create them), their `permissionCodes`, and one test account per role on the dev tenant.
- **Also needed:** Fleet Owner → group ownership. `GroupDto` has no owner/user field and `GET /groups` has no filter, so it's unknown whether the server already scopes groups/devices by user. Confirm whether `/devices`, `/groups`, `/alarms/*`, `/monitor/realtime` are scoped by `parentUserId` hierarchy.
- **Blocks:** Phase 1 role navigation and data isolation tests.
- **Frontend ready (Phase 1A):** confirmed values go into `ACCESS_POLICY` in `src/features/drive-vision/access/access-policy.ts` — `roleCodes` (role code → app role), `roleGrants` (screens per app role) and `screenGrants` (permission codes or menu routeKeys per screen). Needed per screen: the permission code(s) that should open it.
- **Status 2026-10-27 (Phase 1B):** still unconfirmed; no grants added. Also needed: a `PLATFORM_ADMIN` test account usable for browser verification (see `docs/evidence/phase1b-admin-access.md`), and confirmation that `TokenResponse.user` is always populated on login (the guard denies an authenticated session with no user rather than assuming access).

### 3. Menu ↔ route contract — Undocumented
- `GET /me/menus` returns `routePath` `/dashboard`, `/alarms`, `/reports`; app routes are `/drive-vision/overview`, `/alerts`, … Need agreed `routeKey` values for every screen and menu rows for the remaining screens, or confirmation that the frontend should gate by `permissions[]` instead.

---

## P1 — Driver, trip and shift workflows (Phase 5)

### 4. Driver ↔ vehicle assignment — Absent
- **Roles:** Fleet Owner (write), Admin (write), Driver (read own).
- **Proposed:** `GET /assignments` (q: driverId, deviceId, from, to, status) · `POST /assignments` {driverId, deviceId, startsAt, endsAt?, note} · `PATCH /assignments/{id}` {endsAt | status} · `GET /me/assignment`
- **Response:** id, driverId, deviceId, startsAt, endsAt, status, assignedBy, createdAt.
- **Rules:** server rejects overlapping assignments with 409 `ASSIGNMENT_CONFLICT` + the conflicting ids. History retained.
- **Blocks:** Drivers assignment, Driver dashboard "my vehicle", Phase 6.

### 5. Trips — Absent
The API has raw tracks (`/devices/{id}/track`, ≤ 7 days) and driving/parking periods (`/reports/driving`, `/reports/parking`), but no trip entity.
- **Roles:** Fleet Owner (create/assign/view fleet), Driver (view own, accept/reject/start/complete), Admin.
- **Proposed:** `GET /trips` (q: driverId, deviceId, status, from, to, paging) · `GET /trips/{id}` · `POST /trips` · `POST /trips/{id}/accept` · `/reject` {reason} · `/start` · `/complete` {odometerKm?, notes?} · `GET /me/trips`
- **Response:** id, reference, driverId, deviceId, status, scheduledStart, scheduledEnd, actualStart, actualEnd, origin{lat,lon,label}, destination{…}, distanceKm, notes, worksheet[] (time, event, note).
- **States (backend to confirm):** ASSIGNED → ACCEPTED | REJECTED; ACCEPTED → IN_PROGRESS → COMPLETED; CANCELLED from ASSIGNED/ACCEPTED. Invalid transitions → 409.
- **Blocks:** Trip list on Trips screen, Driver trip workflow, worksheet, history.

### 6. Shifts and working hours — Absent
- **Proposed:** `POST /me/shifts/start` {deviceId, checklist[]} · `POST /me/shifts/{id}/end` · `GET /me/shifts/current` · `GET /shifts` (q: driverId, from, to; Fleet Owner/Admin) · `GET /shift-checklist` (items defined server-side)
- **Response:** id, driverId, deviceId, startedAt, endedAt, durationMinutes, checklist[{itemId, label, passed, note}].
- **Rules:** one open shift per driver (409 otherwise); failed mandatory checklist item blocks start (server-validated).

### 7. Leave requests — Absent
- **Proposed:** `POST /me/leave-requests` {from, to, type, reason} · `GET /me/leave-requests` · `DELETE /me/leave-requests/{id}` (cancel while PENDING) · `GET /leave-requests` (Fleet Owner/Admin, q: status, driverId, from, to) · `POST /leave-requests/{id}/approve` · `/reject` {reason}
- **States:** PENDING → APPROVED | REJECTED | CANCELLED.
- **Response:** id, driverId, from, to, type, reason, status, decidedBy, decidedAt, decisionNote.

### 8. Driver safety history — Absent (partly derivable)
- AlarmDto has `deviceId` but no driver. With assignments (item 4) the backend should attribute alarms to the assigned driver: add `driverId` to AlarmDto and a `driverIds` filter to `/alarms/ai` and `/alarms/routine`.

---

## P1 — Fleet Owner operations (Phase 6)

### 9. Availability, conflicts, swaps, dispatch — Absent
- `GET /drivers/availability` (q: from, to, groupId) → per driver: status, current assignment, shift, leave.
- `GET /assignments/conflicts` (q: from, to) → overlapping assignment/leave/shift records.
- Swap/reassignment approval: `POST /assignment-requests` {type: SWAP|REASSIGN, …} · `/approve` · `/reject` — states PENDING → APPROVED | REJECTED.
- Dispatch verification: definition needed from product (what is verified, by whom) before an API can be proposed.

---

## P1 — Alerts (Phases 4, 7)

### 10. Alarm handling — Absent
- **Purpose:** The Alerts screen's assign / note / resolve / false-positive actions. `AlarmDto.handlingStatus` exists but is read-only and its values are undocumented (only `NEW` observed).
- **Proposed:** `PATCH /alarms/{kind}/{id}` {handlingStatus, assigneeUserId?, note?, outcome?} · `GET /alarms/{kind}/{id}/history`
- **Needed:** status list and transitions; whether `id` or `vendorAlarmId` is the key; who may handle (permission code).

### 11. Routine alarms — Failing
- `GET /alarms/routine` returns 503 `DATA_UNAVAILABLE` for 24 h and 7 d windows (2026-10-26). Needs vendor feed or stored data. Also confirm whether `/alarms/routine/recent` is a subset of the same data (time window? unhandled only?) before the UI uses it.

### 12. Severity and status code tables — Undocumented
- `severity` scale, `handlingStatus`, DeviceStateDto `statusCode`/`positionMode`/`networkType`, TrackPointDto `runState`/`positionState`/`pointType`, geofence `ruleTypes`/`areaType`, media/recording `mediaType`/`triggerType`/`dataType`/`streamType`, user `status`, command/export `status`. A reference endpoint or a documented enum for each.

### 13. "No match" returns 503 — Failing
- `GET /devices?keyword=<no match>` and pages past the end return 503 `DATA_UNAVAILABLE` instead of `200 { data: [], total: 0 }`. Same for `/devices/{id}/track` with no points. The UI can't distinguish "empty" from "vendor down". Request: 200 with empty data for empty results; reserve 503 for real unavailability.

---

## P2 — Notifications, analytics, search, assistant (Phase 7)

### 14. Notifications — Absent
- `GET /me/notifications` (q: unreadOnly, paging) · `GET /me/notifications/unread-count` · `POST /me/notifications/{id}/read` · `POST /me/notifications/read-all`
- Response: id, type, title, body, entityType, entityId, createdAt, readAt.
- Types per role: Driver (trip assigned, leave decided, alert on own vehicle), Fleet Owner (alerts, leave requests, conflicts, expiries), Admin (system/device).

### 15. Safety scores and analytics — Absent
- `GET /analytics/safety` (q: from, to, groupId?, deviceIds?, driverIds?, granularity=day|week) → series of event counts by type/severity.
- `GET /analytics/safety/scores` (q: from, to, entity=driver|vehicle, paging, sort) → id, score, eventCount, distanceKm, eventsPer100Km, trend.
- The scoring formula must be defined by the backend/product; the frontend will not compute or display an invented score.

### 16. Dashboard aggregations — Absent (partly derivable)
- Fleet distance and per-vehicle mileage: `GET /reports/mileage` exists — to be tested before requesting anything new.
- Alarm counts per day/type without paging all alarms: `GET /alarms/summary` (q: from, to, groupBy=day|type|device).
- Moving/idle/parked counts: needs the `statusCode` table (item 12) or a summary in `RealtimeDto`.

### 17. Global search — Absent
- `GET /search` (q: q, types[]=device,driver,user,alarm, limit) → [{type, id, title, subtitle}], scoped to the caller. Until then the frontend can combine `/devices?keyword` and `/users?keyword` (Admin only).

### 18. AI Fleet Assistant — Absent
- `POST /assistant/messages` {conversationId?, text} → {conversationId, text, citations[{entityType, entityId}]} and `GET /assistant/suggested-prompts`. Must answer only from data the caller may see. The current in-browser rule engine answers from sample data and must be disabled or replaced.

---

## P2 — Administration (Phase 8)

### 19. Write-operation contracts — Undocumented
- `DeviceRequest.confirmChargeableChange`, `CommandRequest.confirm`, `RenewalRequest.confirm`, `DELETE /vendor-users/{id}?confirm`: what they gate, the error returned when missing, and the cost shown to the user.
- `POST /devices/transfer`: group move vs. vendor-account move; whether `groupId` is the target group.
- Permission code required for each mutation (`POST /commands`, device CRUD, renewals, user/role admin).
- A disposable device, group and user on a non-production tenant for write tests.

### 20. Video playback — Undocumented
- `GET /video/sdk-token` returns a temporary token for the vendor video SDK. Needed: the SDK package or player URL, the playback API, and allowed origins.
- **Phase 2 status:** still blocking. The Video screen shows calendar, recordings and exports; playback shows "not available yet". `sdk-token` is never requested.

---

## Phase 2 findings (2026-10-27)

Discovered while integrating existing endpoints. None of these were reproduced live (no authenticated browser session); they come from the spec.

### 21. Recording calendar contract — Undocumented
- `GET /devices/{id}/recording-calendar?month=` — `month` is a bare string (no format) and the response is `List<Integer>`. The app sends `YYYY-MM` and reads integers as days of that month; values outside 1..days-in-month are ignored. **Confirm both.**

### 22. Geofence rule and area codes — Undocumented (blocks create/edit)
- `GeofenceRequest.ruleTypes` is required (≥ 1 integer); `areaType` (0–9), `colorIndex` (0–5), `ruleParam` (0–1), `threshold`, `BroadcastDto.ruleType` have no value tables. `GeofenceDto` returns `color` (string) but the request takes `colorIndex`, so an edit can't round-trip the colour.
- **Needed:** a reference endpoint or enum list for each, and whether PUT is a full replace.

### 23. Export and media codes — Undocumented
- `ExportRequest.dataType` (0–2), `streamType` (1–2); `ExportDto.status` / `vendorStatus`; `MediaDto.mediaType` / `triggerType`. The app sends neither optional code and shows statuses raw.
- **Needed:** value tables, and whether exports consume device data or vendor credit.

### 24. User administration semantics — Undocumented
- `DELETE /users/{id}`: effect on sub-accounts and owned devices (not exposed).
- `PUT /users/{id}`: whether omitted `parentUserId` / optional fields are cleared (the app resends the current parent and omits empty optionals).
- Which permission code each user/role mutation requires; whether a user may change accounts outside their subtree.
- `GET /users` `sort` format (not sent).

### 25. Command execution contract — Undocumented (blocks sending)
- `POST /commands`: meaning of `confirm`, required permission, ownership check for `deviceIds`, rate limits, and how `params` maps to `Definition.formats`.
- `GET /commands/{id}?refresh=`: whether it polls the vendor (the app never sends it).
- `GET /devices/{id}/passthrough-data` requires `type` (no value list) — diagnostics not integrated.

### 26. Device transfer — Undocumented
- `POST /devices/transfer` (`deviceIds`, `groupId`, `fromVendorUserId`, `toVendorUserId`): group move vs vendor-account move, required permission, reversibility, cost. Not exposed in the UI.

### 27. Preference value sets — Undocumented
- `theme` pattern only, `homeModules` / `deviceInfoFields` item patterns only, `nightModeFrom/To` format, `expiryReminderDays` range. The app edits only fields with documented enums/ranges and keeps the rest as stored.

### 11 (update). Routine alarms — Failing, not re-tested
- Phase 2 could not repeat the authenticated `GET /alarms/routine` read (no session). Still shown as unavailable on 503. `GET /alarms/routine/recent` was **not** adopted as a fallback: it has no `from`/`to`, so it can't answer a historical window.

## Phase 2 browser findings (2026-10-27, live, Admin session)

Evidence: `evidence/phase2-acceptance.md`.

### 28. Command detail fails — Backend error
- `GET /commands/1` → **500 `INTERNAL_ERROR`**, reproducible 3× (request ids `dd04e054-b6c6-4326-b50e-669fbff2cd02`, `b4a2fc03-1881-4469-901d-7aff7ba8c0bc`, `351a2c05-11e4-4ec4-97f0-c7582edfc2ba` at 2026-10-27T10:57:35Z; same value in `extend.requestId` and the `x-request-id` header). `GET /commands` lists the same command (INSTANT_SHOT, PENDING) with 200; `GET /commands/999999` → correct 404 `NOT_FOUND`, so the failure is record-specific.
- The list item has `section: null`, `targets: []` but a numeric `targetCount`, `completedAt: null`. **Unverified hypothesis:** the detail mapping dereferences the null section or the missing targets.
- **Needed:** fix the 500 (server logs for those request ids); confirm whether `targets` should be populated for this command. The app shows the error with the ref and a retry and invents nothing.
- 4th reproduction: `56fb1f41-1ff1-4998-87d6-508c70f9262f`. Full report for the backend owner: `evidence/backend-defect-commands-detail-500.md`.

### 29. Export download URL is a placeholder — Backend data / contract
- `GET /video/exports?deviceId=1` returns a REQUESTED job whose download URL is on host `example.invalid`. The app renders any http(s) URL as "Download", and can't hide it by status because `ExportDto.status` values are undocumented (#23).
- **Needed:** (1) the `ExportDto.status` / `vendorStatus` value table and which value means "file ready"; (2) the URL must be null until the file exists — a placeholder host should never be returned; (3) whether requesting an export consumes device data or vendor credit.
- **Frontend since 2026-10-27:** URLs on reserved placeholder hosts (`*.invalid`, `*.example`, `example.com/.net/.org`) are shown as "Link not usable", never as a link. Real http(s) URLs are still shown regardless of status until the status table exists.

### 30. Freshness metadata inconsistent across filters — Backend behaviour
- `GET /geofences` and `?shape=AREA` → `extend {source: LOCAL, stale: true, fallbackReason: VENDOR_EMPTY}`; `?shape=LINE` (0 rows) → `{source: VENDOR, stale: false, persisted: true, syncedAt: null}`. The app shows each as returned ("Stored data" vs "Live vendor data").
- **Needed:** confirm which is correct for an empty filtered result on a tenant not linked to a vendor.

### 31. Server roles vs app roles — Awaiting confirmation
- `GET /roles` returns ADMIN, DRIVER ("Driver", `own.data.read`), MANAGER ("Fleet manager"), OPERATOR ("Operations user"), PLATFORM_ADMIN. Only `PLATFORM_ADMIN` is mapped in the app.
- **Needed (prerequisite A):** which codes are "Fleet Owner" and "Driver", and one test login for each. Nothing is mapped until confirmed.

### 11 (update 2). Routine alarms
- `GET /alarms/routine` returned **200** on 2026-10-27 (Overview, Alerts, vehicle detail). The 503 from 2026-10-26 was not reproduced.

---

## Open backend questions — consolidated (2026-10-27)

Nothing below is assumed in the frontend. Each feature stays disabled or shows raw codes until answered. "Not confirmed" means the spec doesn't say; it doesn't mean the behaviour doesn't exist.

### Q1. Roles (#31) — blocks Fleet Owner / Driver access
`GET /roles` returns ADMIN ("Full tenant administration"), DRIVER ("Driver", `own.data.read` only), MANAGER ("Fleet manager"), OPERATOR ("Operations user"), PLATFORM_ADMIN.
1. Is MANAGER the product's "Fleet Owner"? Is DRIVER the product's "Driver"? What are ADMIN and OPERATOR in product terms?
2. What does `own.data.read` scope to for a DRIVER (which devices, alarms, tracks)? Is there a user↔device or user↔driver link (#1)?
3. One test login per role on the dev tenant.
Until answered, only `PLATFORM_ADMIN` is mapped and all other roles see "No access for this account yet".

### Q2. Geofence create/edit (#22) — blocks create/edit
1. Value tables for `ruleTypes` (required, ≥ 1), `ruleParam` (0–1), `areaType` (0–9), `colorIndex` (0–5), `threshold` (0–100), `BroadcastDto.ruleType`.
2. Geometry: `points` allows 0–500 items. What's the minimum per shape (AREA ≥ 3? LINE ≥ 2?)? Should an AREA ring be closed (first = last)? Is self-intersection rejected? What are the units and meaning of `threshold` for LINE (corridor width?)?
3. `GeofenceDto.color` is a string but the request takes `colorIndex`. What's the mapping, so an edit can round-trip?
4. Is PUT a full replace, and what happens to `bindIds` / `broadcasts` when they're omitted?
5. Does DELETE also remove the rule from bound devices and the vendor, and is it reversible?

### Q3. Video export (#23, #29) — blocks export requests
1. Does `POST /video/exports` consume vendor credit or device data? What's the cost per minute or request?
2. Value tables for `ExportDto.status` and `vendorStatus`. Which value means ready, failed, expired?
3. Is `readyAt` set exactly when the file can be downloaded?
4. Download URL: `url` should be null until the file exists and must never be a placeholder host (`example.invalid` was returned for a REQUESTED job). Does the URL expire? Is it signed? Does it need the bearer token?
5. Meanings of `dataType` (0–2) and `streamType` (1–2); defaults when omitted.

### Q4. Media report (#23)
Value tables for `MediaDto.mediaType` and `triggerType`. Is `previewUrl` always a directly loadable http(s) URL, and does it expire?

### Q5. Recording calendar (#21)
1. Format of `month` (the app sends `YYYY-MM`). Is that correct?
2. The response is `List<Integer>`: are these days of the month (1–31) in IST or UTC?
3. Recordings window: the app requests the IST calendar day (`from` 18:30Z previous day → `to` 18:30Z). Is the API time zone UTC?

### Q6. Preferences (#27)
1. Allowed values for `theme` (only `sky_blue` seen), `homeModules`, `deviceInfoFields`, `trackAlarmTypeIds`, and the `nightModeFrom/To` format.
2. Range for `expiryReminderDays`.
3. Defaults: `GET` returned server defaults with `updatedAt: null` until the first PUT. Is there a way to reset to defaults (DELETE, or PUT of nulls)? After the 2026-10-27 round-trip test, the Sconex Admin account has a saved record and won't follow default changes.

### Q7. Profile (`PATCH /me`)
Can an optional field be cleared (e.g. send `""` or `null` for `phone`/`timezone`)? The app currently only sends changed non-empty values.

### Q8. Command detail (#28)
Fix `GET /commands/1` (500). Confirm whether `targets` must contain `targetCount` rows and whether `section` may be null.

### Q9. Logout
`POST /auth/logout` requires the bearer token in practice (401 without it). Please document this in the spec, and confirm the refresh token is revoked server-side (not independently verified by the frontend).

---

## 2026-10-29 — spec update status (no new questions repeated)

The spec now has 172 operations (snapshot `docs/openapi/api-docs-2026-10-29.json`). The items below now **have endpoints in the spec** and are integrated in the frontend (see `api-inventory.md` → "Added 2026-10-29"); their semantics questions above still stand where noted:

| Earlier item | Now in spec | Still open |
|---|---|---|
| #1 Driver entity + user link | `/drivers*`, `DriverDto.userId`, `/driver/*` (resolved from the token) | Q1: which role code is a driver; one test login per role |
| #4 Assignment | `/drivers/{id}/assignments*`, `/devices/{id}/driver-assignments` | — |
| #5 Trips | `/trips`, `/trips/summary`, `/trips/{id}`, `/trips/{id}/route` | — |
| #6 Shifts / hours | `/shifts`, `/driver/shifts/*`, `/driver/working-hours` | — |
| #7 Leave | `/leave-requests*`, `/driver/leave-requests*` | Status values undocumented (shown raw) |
| #8 Driver safety | `/drivers/{id}/safety-*`, `/driver/safety-*` | — |
| #9 Availability / conflicts / swaps / dispatch | `/drivers/availability`, `/dispatches*`, `/swap-requests*` | Status values and allowed transitions undocumented (server decides; shown raw) |
| #10 Alarm handling | `/alerts*` (acknowledge, comment, resolve, dismiss, reopen) | Assign: see #32 |
| #14 Notifications | `/notifications*` | Unread-count keys: see #33 |
| #15 Safety scores | `/safety/analytics`, `/safety/scores/*` | — |
| #16 Dashboard aggregations | `/dashboard/*` | — |
| #17 Global search | `/search` | Group keys / `Hit.type` values undocumented (unknown types listed without a link) |
| #18 Assistant | `/assistant/prompts`, `/assistant/ask` | — |

Only the two items below are new, and both directly block a UI action.

### 32. Alert assignment body — Undocumented / likely spec defect (blocks "Assign alert")
`POST /api/v1/alerts/{id}/assign` and `POST /api/v1/drivers/{id}/assignments` both reference the schema `AssignRequest` = `{ deviceId* (int64), from, to, replaceCurrent }`. That is the driver↔vehicle shape: it has no assignee user field, so an alert can't be assigned to a person with it. Most likely two Java classes named `AssignRequest` collided in springdoc. **Needed:** the real body for alert assignment (e.g. `assigneeUserId`, optional `note`). Frontend: the action is not offered; `alertService` has no assign function.

### 33. `GET /notifications/unread-count` response keys — **Answered by observation 2026-10-29**
Live response `{ unread: n }` (ref `4caa4d1e-2983-4e0f-b430-917ac18855cf`); the client now reads only `unread`. Please still document the key in the spec. _Original note:_
Returns `Map<String, Long>` with no documented keys. The client reads the first numeric key among `unread`, `count`, `unreadCount`, `total`; anything else → the bell shows no badge (never a guessed number). **Needed:** the key name(s). Not blocking beyond the badge.

## 2026-10-29 live-verification findings (Admin session, read-only)

Request ids and full context: `evidence/phase3-new-api-integration.md`.

### 34. Alert evidence URL is a placeholder — Backend data (same class as #29)
`GET /alerts/1` → `evidence[0].url` on host `example.invalid` (ref `e8e1b451-3c8b-4fcc-ad35-c8b1a6e194da`). The UI now shows "Link not usable". **Needed:** `url` null until the media exists, never a placeholder host.

### 35. Inconsistent 404 for an unknown driver — Backend behaviour
`GET /drivers/999999`, `/assignments`, `/safety-score` → 404 `NOT_FOUND`, but `/drivers/999999/safety-events` → 200 with an empty list (ref `d5379763-590b-4c42-b2c9-01ffbad24f67`). **Needed:** 404 for all, so "no events" and "no such driver" can be told apart.

### 36. Alert status doesn't reflect its history — Backend data or behaviour
Alert 1: `handlingStatus: NEW` while `actions[]` contains an `ACKNOWLEDGE` (24 Oct, "Demo Tenant Admin"). **Needed:** confirm whether acknowledging changes `handlingStatus` (and to what), or whether this is seed data. This blocks writing a test plan for alert actions.

### 37. Write-test prerequisites — Awaiting confirmation (blocks every write test)
1. Is the dev tenant behind `http://185.193.19.156:9096` designated for test data?
2. Does `POST /dispatches` (or cancel/update) send anything outside the BFF — SMS, push, email — e.g. to driver 1’s phone? Which in-app notifications does it create, and for whom?
3. There is no `DELETE /dispatches/{id}`: is a cancelled test dispatch acceptable as residue, or can the backend purge it?
Details and the exact planned requests: `evidence/phase3-write-test-plan.md`.

### Q1 (update 2026-10-29) — DRIVER role confirmed by live data
A DRIVER login returns role `DRIVER` with permissions `driver.app`, `own.data.read` and seven driver menus. The frontend now maps `DRIVER` → driver and grants My Work via `driver.app`. MANAGER / Fleet Owner remain unmapped.

### 38. Driver login not linked to a driver record — Backend data (blocks every driver workflow)
For the signed-in DRIVER test login, every `/driver/*` read returns **403 `FORBIDDEN` "Your account is not linked to a driver profile"** (e.g. `GET /driver/me` ref `bf02c397-718e-4b1d-bade-aaff9c2fa6d7`; nine refs in `evidence/phase3-new-api-integration.md` → "Driver login access"). **Needed:** link this login to a disposable driver record (`DriverDto.userId`), or provide a test-driver login that is already linked. Also: should the menu offer `driver_notifications`, given that there is no driver notifications page beyond `GET /notifications`?

### 38 (update) — Resolved on the backend, observed 2026-10-29 16:56
The same DRIVER login now gets 200 from all nine `/driver/*` reads (e.g. `GET /driver/me` ref `a29673b7-e114-45a5-b766-affa918b347d`). Driver writes are still untested (write-test prerequisites #37 apply).
