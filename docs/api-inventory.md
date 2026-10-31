# SafeFare AI — API inventory

Source: `GET http://185.193.19.156:9096/v3/api-docs` (title "Safe-Fare Fleet BFF", version v1). **Re-downloaded 2026-10-29: 172 operations on 135 paths** (snapshot: `docs/openapi/api-docs-2026-10-29.json`) — the 82 operations of 2026-10-27 are unchanged (none removed; the only schema change to an existing DTO is a new `DeviceDto.terminal: TerminalInfo`), plus **90 new operations** in 12 new controllers (see “Added 2026-10-29” below). Earlier baseline (2026-10-27): **82 operations on 55 paths**, all under `/api/v1`, with a global `bearerAuth` requirement and **no per-operation overrides** (re-checked against the live spec 2026-10-27). In practice `/auth/login` and `/auth/refresh` work without a bearer token, while `/auth/logout` returns 401 "Authentication required" without one — the client sends it authenticated.

The spec documents **only success responses**. Errors use the envelope observed on the live server:

```json
{ "code": 401, "msg": "Authentication required", "data": null, "total": null,
  "extend": { "errorCode": "UNAUTHENTICATED", "fieldErrors": [], "requestId": "…" } }
```

Error codes observed so far (see `api-integration-checklist.md` and `docs/evidence/`): `UNAUTHENTICATED` (401), `INVALID_CREDENTIALS` (401), `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `DATA_UNAVAILABLE` (503). Vendor-backed reads carry `extend: { source: VENDOR|LOCAL, stale, fallbackReason, syncedAt }`.

## Live reachability (2026-10-27, unauthenticated)

Every probed path returned **401 `UNAUTHENTICATED`**, including paths that are *not* in the spec (`/drivers`, `/trips`, `/notifications`, `/shifts`, `/leaves`). Authentication runs before routing, so an unauthenticated probe cannot tell whether an undocumented path exists. Those checks need a signed-in session; until then, "not in the spec" is the evidence used and is marked *Awaiting backend confirmation* in `missing-backend-apis.md`.

Authenticated results recorded on 2026-10-26 (signed in as `PLATFORM_ADMIN`) are in `api-integration-checklist.md`. Endpoints without an authenticated test are marked "not tested" below.

## Undocumented semantics (affect UI mapping)

| Field | Where | Issue |
|---|---|---|
| `statusCode`, `positionMode`, `networkType`, `gsmSignal` | DeviceStateDto | No value meanings → shown as raw codes; no moving/idle/parked status. |
| `severity` | AlarmDto, AlarmTypeDto.defaultSeverity | Scale undocumented → not mapped to critical/high/low. |
| `handlingStatus` | AlarmDto | Only `NEW` observed; no transitions; **no endpoint to change it**. |
| `status` | UserDetailDto, StatusRequest, CommandDto, TargetDto, ExportDto | Values undocumented. |
| `runState`, `positionState`, `pointType` | TrackPointDto | Undocumented. |
| `ruleTypes`, `areaType`, `colorIndex`, `ruleParam` | GeofenceRequest | Integer codes undocumented. |
| `mediaType`, `triggerType`, `dataType`, `streamType` | MediaDto, RecordingDto, ExportRequest | Integer codes undocumented. |
| `confirmChargeableChange`, `confirm` | DeviceRequest, CommandRequest, RenewalRequest, DELETE `/vendor-users/{id}` | Behaviour undocumented; likely gates vendor charges / critical actions. |
| `params`, `formats` | CommandRequest, Definition | Free-form; per-type schema only via `GET /commands/types`. |
| `sensors` | DeviceStateDto | Free-form JSON, no units. |

## Role / permission model in the spec

- `CurrentUserDto` has `role: { id, code, description }` and `permissions: string[]`. `TokenResponse.user` returns the same.
- `RoleDto` has `permissionCodes`, `assignable`, `protectedRole`. `GET /permissions` lists all permission codes.
- `MenuNodeDto` has `requiredPermissionCode`, `routeKey`, `routePath`. `GET /me/menus` returns the user's menus.
- Users are hierarchical (`parentUserId`, `GET /users/tree`).
- ~~There is no driver entity and no link between a user and a driver or device.~~ **2026-10-29:** the spec now has a driver entity (`DriverDto.userId`), driver↔vehicle assignments and `/driver/*` endpoints that resolve the driver from the token. Which **role code** is a driver is still unconfirmed (`missing-backend-apis.md` Q1), so the Driver app role has no mapping and My Work is unreachable.

## Integration status of the 2026-10-27 operations (after Phase 2; unchanged on 2026-10-29 except where noted)

"Verified" = observed live in a browser. "Integrated" = called by the app per the spec, covered by unit tests of request/validation logic, **not yet observed live**.

| Endpoint | App usage | Status |
|---|---|---|
| POST `/auth/login`, `/auth/refresh`, `/auth/logout`; GET `/me` | Auth | Verified |
| GET `/me/menus` | Access policy input | Verified (fetch) |
| PATCH `/me`, POST `/me/password`, GET/PUT `/me/preferences` | Settings; Overview reminders | Integrated |
| GET `/devices`, `/devices/{id}`, `/groups`, `/monitor/realtime`, `/devices/{id}/track`, `/alarms/ai`, `/reference/*` | Overview, Monitoring, Trips, Vehicles, Alerts | Verified |
| GET `/alarms/routine` | Overview, Alerts | Integrated — backend 503 |
| GET `/users`, `/users/{id}`, `/users/tree`, `/roles`, `/permissions` | Users & Sub-Accounts | Integrated |
| POST `/users`, PUT `/users/{id}`, PATCH `/users/{id}/status`, POST `/users/{id}/unlock`, POST `/users/{id}/password` | Users & Sub-Accounts (confirmed actions) | Integrated — not executed |
| GET `/geofences` | Geofences | Integrated |
| DELETE `/geofences/{id}` | Geofences (confirmed action) | Integrated — not executed |
| GET `/reports/mileage`, `/reports/driving`, `/reports/parking`, `/reports/media` | Reports | Integrated |
| GET `/devices/{id}/recording-calendar`, `/devices/{id}/recordings`, `/video/exports` | Historical Video | Integrated |
| POST `/video/exports` | Historical Video (confirmed action) | Integrated — not executed |
| GET `/commands`, `/commands/{id}`, `/commands/types` | Device Commands (read-only) | Integrated |
| GET `/voices/fence` | Geofences — voice prompts (read-only) | Integrated 2026-10-29 — not backend-verified |
| Not used: POST `/commands`, POST `/devices/transfer`, device/group writes, DELETE `/users/{id}`, role writes, `/menus` admin, geofence POST/PUT, `/video/sdk-token`, `/alarms/routine/recent`, `/devices/{id}/passthrough-data`, `/vendor-users*`, `/renewals`, GET/POST `/voices` (vendor-user scoped list; multipart upload changes live vendor config), PATCH `/reference/alarm-types/{id}` | — | Deliberately not integrated — see `missing-backend-apis.md` #19–#27. `/video/sdk-token` stays uncalled: a token is useless (and needlessly exposed) without the vendor player SDK (#20). |

## Added 2026-10-29 — 90 operations

Status legend: **Verified live 2026-10-29** = observed in the signed-in Admin browser session: HTTP 200, `data` consistent with the spec (no undocumented keys, no type mismatches), values rendered on the screen; request ids in `evidence/phase3-new-api-integration.md`. **Integrated — not backend-verified** = the UI calls it per the spec and the request (method, path, query, body, bearer token) is covered by `tests/operations-api.test.cjs` against the spec snapshot — **mocked fetch, no live response observed** (no authenticated session was available on 2026-10-29). **· not executed** = a write wired behind a confirmation dialog that was never sent. **Service only** = typed function exists but no screen calls it, because another call already returns the same data (no duplicate requests). Authorization for every row: global `bearerAuth`; the spec has no per-operation roles, so the BFF decides — 403 is shown as returned.

| Verification category (90 new ops) | Count |
|---|---|
| Mocked automated request tests (`tests/operations-api.test.cjs`) | 89 pass |
| Real-backend **read** verification | 45 (36 Admin + 9 `/driver/*` with the DRIVER login; driver reads: status + rendering, no schema-shape comparison) |
| Real-backend **write** verification | **0** — blocked, see `evidence/phase3-write-test-plan.md` |
| Signed-in browser verification (rendering) | 45 |

| Totals | Count |
|---|---|
| Real-backend requests observed / successful / browser-rendered | 36 / 36 / 36 (all GET) |
| Integrated in fleet screens (Admin-reachable) | 62 (38 reads, 24 writes — no write executed). **36 of the 38 reads verified live 2026-10-29**; not observed: `GET /dispatches/{id}`, `/dispatches/{id}/verification` (no dispatch on the tenant) |
| Integrated in My Work (driver-only screen; DRIVER mapped 2026-10-29) | 21 (10 reads, 11 writes — none executed). 9 reads observed live with the Driver login: all 403 `FORBIDDEN` "not linked to a driver profile" (#38) |
| Service only (superseded by a combined call) | 6 |
| Disabled | 1 (`POST /alerts/{id}/assign`) |
| Older operation newly integrated | 1 (`GET /voices/fence`, Geofences) |

| Controller | Method | Path | Frontend feature / route | Service function | R/W | Status |
|---|---|---|---|---|---|---|
| alert | GET | `/alerts` | Alerts → Incidents tab | `alertService.listAlerts` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| alert | GET | `/alerts/{id}` | Alerts → incident drawer | `alertService.getAlert` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| alert | POST | `/alerts/{id}/acknowledge` | Incident drawer — Acknowledge (confirm) | `alertService.noteAction` | W | Integrated — not backend-verified · not executed |
| alert | GET | `/alerts/{id}/actions` | — (actions come with GET /alerts/{id}) | `alertService.actions` | R | Service only — not called (detail includes it) |
| alert | POST | `/alerts/{id}/assign` | — | `—` | W | Disabled — body schema is the driver AssignRequest (#32) |
| alert | POST | `/alerts/{id}/comments` | Incident drawer — Comment (confirm) | `alertService.comment` | W | Integrated — not backend-verified · not executed |
| alert | POST | `/alerts/{id}/dismiss` | Incident drawer — Dismiss (confirm) | `alertService.noteAction` | W | Integrated — not backend-verified · not executed |
| alert | GET | `/alerts/{id}/evidence` | — (evidence comes with GET /alerts/{id}) | `alertService.evidence` | R | Service only — not called (detail includes it) |
| alert | POST | `/alerts/{id}/reopen` | Incident drawer — Reopen (confirm) | `alertService.noteAction` | W | Integrated — not backend-verified · not executed |
| alert | POST | `/alerts/{id}/resolve` | Incident drawer — Resolve + outcome (confirm) | `alertService.resolve` | W | Integrated — not backend-verified · not executed |
| alert | GET | `/devices/{id}/event-markers` | Trips → Track playback (map pins) | `insightService.eventMarkers` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| assistant | POST | `/assistant/ask` | Iris assistant — ask | `assistantService.ask` | W | Integrated — not backend-verified |
| assistant | GET | `/assistant/prompts` | Iris assistant — suggested prompts | `assistantService.prompts` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dashboard | GET | `/dashboard/active-trips` | — (same block as overview.trips) | `insightService.activeTrips` | R | Service only — not called (overview supersedes) |
| dashboard | GET | `/dashboard/device-health` | — (same block as overview.health) | `insightService.deviceHealth` | R | Service only — not called (overview supersedes) |
| dashboard | GET | `/dashboard/fleet-status` | Overview — Fleet status donut | `insightService.fleetStatus` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dashboard | GET | `/dashboard/overview` | Overview `/overview` (KPIs, health, operations) | `insightService.overview` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dashboard | GET | `/dashboard/safety-events` | Overview — Open alerts KPI (range) | `insightService.safetyEvents` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dashboard | GET | `/dashboard/trends` | Overview — Daily trend | `insightService.trends` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dashboard | GET | `/dashboard/vehicles` | — (same block as overview.vehicles) | `insightService.vehicleCounts` | R | Service only — not called (overview supersedes) |
| dashboard | GET | `/devices/{id}/summary` | Vehicle detail — Assignment & work | `insightService.vehicleSummary` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dispatch | GET | `/dispatches` | Dispatch `/dispatch` | `operationsService.listDispatches` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dispatch | POST | `/dispatches` | Dispatch — New (after check, confirm) | `operationsService.createDispatch` | W | Integrated — not backend-verified · not executed |
| dispatch | GET | `/dispatches/{id}` | Dispatch — detail, edit form | `operationsService.getDispatch` | R | Integrated — not backend-verified |
| dispatch | PUT | `/dispatches/{id}` | Dispatch — Edit (after check, confirm) | `operationsService.updateDispatch` | W | Integrated — not backend-verified · not executed |
| dispatch | POST | `/dispatches/{id}/cancel` | Dispatch — Cancel (confirm) | `operationsService.cancelDispatch` | W | Integrated — not backend-verified · not executed |
| dispatch | POST | `/dispatches/{id}/swap-requests` | Dispatch — Request swap (confirm) | `operationsService.requestSwap` | W | Integrated — not backend-verified · not executed |
| dispatch | GET | `/dispatches/{id}/verification` | Dispatch — detail, Verification | `operationsService.verification` | R | Integrated — not backend-verified |
| dispatch | POST | `/dispatches/check` | Dispatch form — Check conflicts | `operationsService.checkDispatch` | W | Integrated — not backend-verified · not executed |
| dispatch | GET | `/dispatches/conflicts` | Dispatch — Conflicts tab | `operationsService.conflicts` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dispatch | GET | `/swap-requests` | Dispatch — Swap requests tab | `operationsService.listSwaps` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| dispatch | POST | `/swap-requests/{id}/approve` | Dispatch — Approve swap (confirm) | `operationsService.decideSwap` | W | Integrated — not backend-verified · not executed |
| dispatch | POST | `/swap-requests/{id}/reject` | Dispatch — Reject swap (confirm) | `operationsService.decideSwap` | W | Integrated — not backend-verified · not executed |
| driver | GET | `/devices/{id}/driver-assignments` | Vehicle detail — Assignment history | `operationsService.deviceAssignments` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| driver | GET | `/drivers` | Drivers `/drivers`; pickers (Dispatch, Workforce) | `operationsService.listDrivers` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| driver | POST | `/drivers` | Drivers — New driver (confirmed form) | `operationsService.createDriver` | W | Integrated — not backend-verified · not executed |
| driver | DELETE | `/drivers/{id}` | Drivers — Delete (confirm dialog) | `operationsService.deleteDriver` | W | Integrated — not backend-verified · not executed |
| driver | GET | `/drivers/{id}` | Drivers — detail, edit form | `operationsService.getDriver` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| driver | PUT | `/drivers/{id}` | Drivers — Edit | `operationsService.updateDriver` | W | Integrated — not backend-verified · not executed |
| driver | GET | `/drivers/{id}/assignments` | Drivers — detail, assignments | `operationsService.driverAssignments` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| driver | POST | `/drivers/{id}/assignments` | Drivers — Assign vehicle (confirm) | `operationsService.assignVehicle` | W | Integrated — not backend-verified · not executed |
| driver | POST | `/drivers/{id}/assignments/{assignmentId}/end` | Drivers — End assignment (confirm) | `operationsService.endAssignment` | W | Integrated — not backend-verified · not executed |
| driver | GET | `/drivers/licence-expiries` | Drivers — Licence expiries tab | `operationsService.licenceExpiries` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| driver-app | GET | `/driver/assignment` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.assignment` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | GET | `/driver/checklist-template` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.checklistTemplate` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | GET | `/driver/checklists` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.checklists` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | POST | `/driver/checklists` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.submitChecklist` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | GET | `/driver/dispatches` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.dispatches` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | GET | `/driver/dispatches/{id}` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.dispatch` | R | Service only — not called (list rows are complete) |
| driver-app | POST | `/driver/dispatches/{id}/accept` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.dispatchAction` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | POST | `/driver/dispatches/{id}/complete` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.dispatchAction` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | POST | `/driver/dispatches/{id}/decline` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.decline` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | POST | `/driver/dispatches/{id}/start` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.dispatchAction` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | POST | `/driver/dispatches/{id}/swap-requests` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.requestSwap` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | GET | `/driver/leave-requests` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.leave` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | POST | `/driver/leave-requests` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.requestLeave` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | POST | `/driver/leave-requests/{id}/cancel` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.cancelLeave` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | GET | `/driver/me` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.me` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | PATCH | `/driver/me` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.updateContact` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | GET | `/driver/safety-events` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.safetyEvents` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | GET | `/driver/safety-score` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.safetyScore` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | GET | `/driver/shifts/current` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.currentShift` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| driver-app | POST | `/driver/shifts/end` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.endShift` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | POST | `/driver/shifts/start` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.startShift` | W | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) · not executed |
| driver-app | GET | `/driver/working-hours` | My Work `/my-work` (driver grant only — no role code mapped) | `driverAppService.workingHours` | R | Integrated — DRIVER only; see Driver section of the evidence (reads 200 since 16:56, writes untested) |
| geofence-event | GET | `/geofences/events` | Geofences — Geofence events | `insightService.geofenceEvents` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| geofence-event | GET | `/geofences/events/summary` | Geofences — event type chips | `insightService.geofenceEventSummary` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| notification | GET | `/notifications` | Header bell (panel open) | `alertService.listNotifications` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| notification | POST | `/notifications/{id}/read` | Header bell — mark read / open item | `alertService.markNotification` | W | Integrated — not backend-verified · not executed |
| notification | POST | `/notifications/{id}/unread` | Header bell — mark unread | `alertService.markNotification` | W | Integrated — not backend-verified · not executed |
| notification | POST | `/notifications/read-all` | Header bell — Mark all read | `alertService.markAllRead` | W | Integrated — not backend-verified · not executed |
| notification | GET | `/notifications/unread-count` | Header bell badge | `alertService.unreadCount` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| safety | GET | `/drivers/{id}/safety-events` | Drivers — detail (latest 5) | `insightService.driverSafetyEvents` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| safety | GET | `/drivers/{id}/safety-score` | Drivers — detail (30 d) | `insightService.driverScore` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| safety | GET | `/safety/analytics` | Safety Analytics `/safety` | `insightService.safetyAnalytics` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| safety | GET | `/safety/scores/drivers` | Safety Analytics — scores (drivers) | `insightService.scores` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| safety | GET | `/safety/scores/vehicles` | Safety Analytics — scores (vehicles) | `insightService.scores` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| search | GET | `/search` | Global search (Ctrl K) | `assistantService.search` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| trip | GET | `/trips` | Trips → Trips list; Vehicle detail — Recent trips | `insightService.listTrips` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| trip | GET | `/trips/{id}` | Trips → trip detail | `insightService.tripDetail` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| trip | GET | `/trips/{id}/route` | Trips → route map | `insightService.tripRoute` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| trip | GET | `/trips/summary` | Trips → summary strip | `insightService.tripSummary` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| workforce | GET | `/checklist-template` | Workforce — Checklist template | `operationsService.checklistTemplate` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| workforce | GET | `/checklists` | Workforce — Checklists | `operationsService.listChecklists` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| workforce | GET | `/drivers/availability` | Workforce — Availability | `operationsService.availability` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| workforce | GET | `/leave-requests` | Workforce — Leave | `operationsService.listLeave` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |
| workforce | POST | `/leave-requests` | Workforce — Request leave for a driver | `operationsService.createLeave` | W | Integrated — not backend-verified · not executed |
| workforce | POST | `/leave-requests/{id}/approve` | Workforce — Approve leave (confirm) | `operationsService.decideLeave` | W | Integrated — not backend-verified · not executed |
| workforce | POST | `/leave-requests/{id}/reject` | Workforce — Reject leave (confirm) | `operationsService.decideLeave` | W | Integrated — not backend-verified · not executed |
| workforce | GET | `/shifts` | Workforce `/workforce` — Shifts | `operationsService.listShifts` | R | **Verified live 2026-10-29** — 200, schema consistent, rendered (Admin; see evidence) |

Request/response notes (spec facts that shaped the UI):
- `POST /alerts/{id}/assign` and `POST /drivers/{id}/assignments` reference the **same** `AssignRequest` schema ({ deviceId*, from, to, replaceCurrent }) — almost certainly a springdoc name collision. No assignee field exists, so alert assignment can’t be built (#32).
- Status strings (dispatch, swap, leave, alert `handlingStatus`, availability, `StatusSlice.status`) have **no enum** in the spec. The UI shows them raw and offers every documented action; the server decides which transition is allowed.
- `GET /notifications/unread-count` returns `Map<String, Long>`; the spec names no key. **Observed live: `{ unread: n }`** — the client reads only `unread` (#33 answered by observation).
- `GET /search` returns `Map<String, Hit[]>`; groups and `Hit.type` aren’t enumerated (observed live: `vehicles, drivers, alerts, geofences, users`). Groups render as returned; a hit links only when its type/group names an entity with a screen (vehicle/device, driver, alert, dispatch).
- `AnswerDto.simulated` is surfaced (“the server marked this answer as simulated”); `AnswerDto.data` is free-form and not rendered.
- `ResolveRequest.outcome`, `LeaveRequest.leaveType`, `DriverRequest.gender/status`, `AnswerDto.intent` and `LicenceDto.status` are the only enums/patterns; the UI uses exactly those values.

## Endpoints by controller (2026-10-27 baseline)

### alarm

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/alarms/ai` | `from`*, `to`*, `alarmTypeIds`[], `deviceIds`[], `pageNumber`, `pageSize` | — | 200 `ListAlarmDto` |
| GET | `/alarms/routine/recent` | `alarmTypeIds`[], `deviceIds`[], `pageNumber`, `pageSize` | — | 200 `ListAlarmDto` |
| GET | `/alarms/routine` | `from`*, `to`*, `alarmTypeIds`[], `deviceIds`[], `pageNumber`, `pageSize` | — | 200 `ListAlarmDto` |

### auth

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| POST | `/auth/login` | — | `LoginRequest` (req: login, password, tenantCode) | 200 `TokenResponse` |
| POST | `/auth/logout` | — | `RefreshRequest` (req: refreshToken) | 200 `Void` |
| POST | `/auth/refresh` | — | `RefreshRequest` (req: refreshToken) | 200 `TokenResponse` |

### command

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/commands/types` | — | — | 200 `ListDefinition` |
| GET | `/commands/{id}` | `refresh` | — | 200 `CommandDto` |
| GET | `/commands` | `type`, `deviceId`, `pageNumber`, `pageSize` | — | 200 `ListCommandDto` |
| GET | `/devices/{id}/passthrough-data` | `type`*, `from`*, `to`* | — | 200 `ListPassThroughDto` |
| POST | `/commands` | — | `CommandRequest` (req: deviceIds, type) | 200 `CommandDto` |

### device

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/devices/{id}` | — | — | 200 `Void` |
| GET | `/devices/{id}` | — | — | 200 `DeviceDto` |
| GET | `/devices` | `groupId`, `keyword`, `pageNumber`, `pageSize` | — | 200 `ListDeviceDto` |
| POST | `/devices/transfer` | — | `TransferRequest` (req: deviceIds, groupId) | 200 `ListDeviceDto` |
| POST | `/devices` | — | `DeviceRequest` (req: cameraCount, groupId, modelName, name, objectTypeId, protocol, terminalNo) | 200 `DeviceDto` |
| PUT | `/devices/{id}` | — | `DeviceRequest` (req: cameraCount, groupId, modelName, name, objectTypeId, protocol, terminalNo) | 200 `DeviceDto` |

### geofence

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/geofences/{id}` | — | — | 200 `Void` |
| GET | `/geofences/{id}` | — | — | 200 `GeofenceDto` |
| GET | `/geofences` | `shape`, `name` | — | 200 `ListGeofenceDto` |
| POST | `/geofences` | — | `GeofenceRequest` (req: name, points, ruleTypes, shape) | 200 `GeofenceDto` |
| PUT | `/geofences/{id}` | — | `GeofenceRequest` (req: name, points, ruleTypes, shape) | 200 `GeofenceDto` |

### group

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/groups/{id}` | `cascadeDevices` | — | 200 `Void` |
| GET | `/groups/{id}` | — | — | 200 `GroupDto` |
| GET | `/groups` | — | — | 200 `ListGroupDto` |
| POST | `/groups` | — | `GroupRequest` (req: name) | 200 `GroupDto` |
| PUT | `/groups/{id}` | — | `GroupRequest` (req: name) | 200 `GroupDto` |

### me

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/me/menus` | — | — | 200 `ListMenuNodeDto` |
| GET | `/me/preferences` | — | — | 200 `PreferencesDto` |
| GET | `/me` | — | — | 200 `CurrentUserDto` |
| PATCH | `/me` | — | `UpdateMeRequest` | 200 `CurrentUserDto` |
| POST | `/me/password` | — | `ChangePasswordRequest` (req: currentPassword, newPassword) | 200 `Void` |
| PUT | `/me/preferences` | — | `PreferencesDto` (req: deviceInfoFields, expiryReminderMode, homeModules, theme, trackAlarmTypeIds, videoLayout) | 200 `PreferencesDto` |

### menu

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/menus/{id}` | — | — | 200 `Void` |
| GET | `/menus/{id}` | — | — | 200 `MenuNodeDto` |
| GET | `/menus` | — | — | 200 `ListMenuNodeDto` |
| POST | `/menus` | — | `MenuItemRequest` (req: menuKey, title) | 201 `MenuNodeDto` |
| PUT | `/menus/{id}` | — | `MenuItemRequest` (req: menuKey, title) | 200 `MenuNodeDto` |

### monitor

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/devices/{id}/track` | `from`*, `to`*, `includeStops`, `minStopMinutes`, `positionFilter` | — | 200 `TrackDto` |
| GET | `/monitor/realtime` | `deviceIds`[] | — | 200 `RealtimeDto` |

### reference

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/reference/alarm-types` | `category`, `active` | — | 200 `ListAlarmTypeDto` |
| GET | `/reference/device-models` | — | — | 200 `ListDeviceModelDto` |
| GET | `/reference/object-types` | `category` | — | 200 `ListObjectTypeDto` |
| GET | `/reference/protocols` | — | — | 200 `ListProtocolDto` |
| PATCH | `/reference/alarm-types/{id}` | — | `AlarmTypeUpdate` | 200 `AlarmTypeDto` |

### renewal

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/renewals` | `pageNumber`, `pageSize` | — | 200 `ListRenewalDto` |
| POST | `/renewals` | — | `RenewalRequest` (req: deviceIds, years) | 200 `RenewalDto` |

### report

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/reports/driving` | `from`*, `to`*, `deviceIds`[], `pageNumber`, `pageSize` | — | 200 `ListActivityDto` |
| GET | `/reports/media` | `from`*, `to`*, `deviceIds`[], `mediaType`, `pageNumber`, `pageSize` | — | 200 `ListMediaDto` |
| GET | `/reports/mileage` | `from`*, `to`*, `deviceIds`[] | — | 200 `ListMileageDto` |
| GET | `/reports/parking` | `from`*, `to`*, `deviceIds`[], `pageNumber`, `pageSize` | — | 200 `ListActivityDto` |

### role

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/roles/{id}` | — | — | 200 `Void` |
| GET | `/permissions` | — | — | 200 `ListPermissionDto` |
| GET | `/roles/{id}` | — | — | 200 `RoleDto` |
| GET | `/roles` | — | — | 200 `ListRoleDto` |
| POST | `/roles` | — | `CreateRoleRequest` (req: code, description) | 201 `RoleDto` |
| PUT | `/roles/{id}/permissions` | — | `RolePermissionsRequest` (req: permissionCodes) | 200 `RoleDto` |
| PUT | `/roles/{id}` | — | `UpdateRoleRequest` (req: description) | 200 `RoleDto` |

### user

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/users/{id}` | — | — | 200 `Void` |
| GET | `/users/tree` | — | — | 200 `ListUserTreeNode` |
| GET | `/users/{id}` | — | — | 200 `UserDetailDto` |
| GET | `/users` | `keyword`, `status`, `roleId`, `parentUserId`, `pageNumber`, `pageSize`, `sort` | — | 200 `ListUserSummaryDto` |
| PATCH | `/users/{id}/status` | — | `StatusRequest` (req: status) | 200 `UserDetailDto` |
| POST | `/users/{id}/password` | — | `PasswordResetRequest` (req: newPassword) | 200 `Void` |
| POST | `/users/{id}/unlock` | — | — | 200 `UserDetailDto` |
| POST | `/users` | — | `CreateUserRequest` (req: displayName, password, roleId) | 201 `UserDetailDto` |
| PUT | `/users/{id}` | — | `UpdateUserRequest` (req: displayName, roleId) | 200 `UserDetailDto` |

### vendor-user

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| DELETE | `/vendor-users/{id}` | `confirm` | — | 200 `Void` |
| GET | `/vendor-users/current` | — | — | 200 `VendorUserDto` |
| GET | `/vendor-users/{id}` | — | — | 200 `VendorUserDto` |
| GET | `/vendor-users` | — | — | 200 `ListVendorUserDto` |
| POST | `/vendor-users` | — | `CreateRequest` (req: password, userName) | 200 `VendorUserDto` |
| PUT | `/vendor-users/{id}` | — | `UpdateRequest` (req: userName) | 200 `VendorUserDto` |

### video

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/devices/{id}/recording-calendar` | `month`* | — | 200 `ListInteger` |
| GET | `/devices/{id}/recordings` | `from`*, `to`*, `channel` | — | 200 `ListRecordingDto` |
| GET | `/video/exports/{id}` | — | — | 200 `ExportDto` |
| GET | `/video/exports` | `deviceId`, `pageNumber`, `pageSize` | — | 200 `ListExportDto` |
| GET | `/video/sdk-token` | — | — | 200 `SdkTokenDto` |
| POST | `/video/exports` | — | `ExportRequest` (req: channel, deviceId, from, to) | 200 `ExportDto` |

### voice

| Method | Path | Query (* = required) | Body | Success |
|---|---|---|---|---|
| GET | `/voices/fence` | — | — | 200 `ListVoiceDto` |
| GET | `/voices` | `vendorUserId` | — | 200 `ListVoiceDto` |
| POST | `/voices` | `name`*, `vendorUserId` | `object` | 200 `ListVoiceDto` |
