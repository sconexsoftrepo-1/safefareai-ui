# Phase 3 — integration of the 2026-10-29 spec additions

Date: 2026-10-29. Scope: the 90 operations added to the Safe-Fare Fleet BFF spec since 2026-10-27.

## Spec

- `GET http://185.193.19.156:9096/v3/api-docs` → 200, 172 operations / 135 paths. Saved as `docs/openapi/api-docs-2026-10-29.json`.
- Re-downloaded later the same day and compared: identical (same SHA-256), 172 operations.
- Diff vs. the 2026-10-27 inventory: 0 removed, 90 added (12 new controllers). Existing DTOs unchanged except `DeviceDto.terminal` (`TerminalInfo`).
- No per-operation `security`, no role/permission hints, no tags beyond controller names.

## What was verified, and how

| Kind | Result | Notes |
|---|---|---|
| Typecheck (`npm run typecheck`) | Pass | |
| Lint (`npm run lint`) | Pass, 0 warnings | |
| Unit tests (`npm test`) | 179/179 pass (re-run after the live-verification fixes) | 71 earlier tests + 95 in `operations-api.test.cjs` + 13 in `operations-models.test.cjs` |
| Production build (`npm run build`) | Pass, 25 routes | New: `/drive-vision/dispatch`, `/workforce`, `/my-work` |
| Request construction, 89 of 90 ops | Pass — **mocked fetch** | Real `api/client.ts` + services; asserts method, path, query, body, bearer token, and that each (method, path) exists in the snapshot. A coverage test fails if any new-controller op lacks a case (only `POST /alerts/{id}/assign` is excluded, by design). |
| Error handling | Pass — mocked | Error `code` inside HTTP 200 → error with status/code/request id; 403 → forbidden, one request, no fallback; empty `data` → empty values, never sample data. |
| Access policy | Pass — unit tests | Admin: every fleet screen incl. Dispatch/Workforce, **not** `/my-work` (decideRoute → forbidden/no-access). No role code maps to `driver`. |
| Browser, signed out | Pass | `/drive-vision/dispatch`, `/my-work`, `/overview` → `/login?next=…`, 0 requests to the BFF. |
| Browser, signed in (first pass) | Not run | No session in the test tab at that time. |
| Browser, signed in (second pass, user-signed-in Admin) | **36 of 90 verified** | The agent used the user’s session only (no credentials or tokens handled). See “Live verification” below. |
| Live backend responses | **36 GET operations observed, 36 × 200, schema consistent** | Plus 3 deliberate 404s (unknown driver id) for the error state. |
| Writes | **None sent** | 35 write operations are wired behind confirmation dialogs; none was triggered. `POST /assistant/ask` and `POST /dispatches/check` weren’t sent either. The only non-GET observed was the app’s own automatic `POST /auth/refresh` (200). |

## Classification of the 90 operations

| Category | Count | Reads | Writes |
|---|---|---|---|
| Connected to an Admin-reachable screen | 62 | 38 | 24 |
| Connected only to the role-restricted My Work screen (no Driver role code yet) | 21 | 10 | 11 |
| Service function only (not called by any screen) | 6 | 6 | 0 |
| Disabled | 1 | 0 | 1 |
| **Total** | **90** | 54 | 36 |

Service functions exist for 89 (all but the disabled one). Automated request tests pass for 89. **Real-backend verified: 36. Browser rendering verified: 36** (all reads; see below). Failed: 0.

### Service-only operations — why, and what would connect them

| Operation | Why not called | To connect |
|---|---|---|
| `GET /dashboard/vehicles` | Same `VehicleCounts` block is inside `GET /dashboard/overview`, which the Overview already loads; calling both doubles the requests. | Only if a widget needs its own refresh cadence (e.g. a status tile that polls). |
| `GET /dashboard/active-trips` | Same `ActiveTrips` block as `overview.trips`. | Same as above. |
| `GET /dashboard/device-health` | Same `DeviceHealth` block as `overview.health`. | Same as above. |
| `GET /alerts/{id}/evidence` | `GET /alerts/{id}` returns `AlertDetailDto` with `evidence[]`; the incident drawer uses that. | Use when evidence arrives later than the alert (e.g. `mediaStatus` pending) to refresh evidence alone. Needs the `mediaStatus` values. |
| `GET /alerts/{id}/actions` | `AlertDetailDto.actions[]` already has the history, and every action response returns the updated detail. | Use for a paged/large history view if the backend caps `actions[]` in the detail. |
| `GET /driver/dispatches/{id}` | `GET /driver/dispatches` rows are the same `Row` schema, so My Work needs no extra call. | A driver deep link to one trip (e.g. from a notification). Needs the Driver role mapping first. |

### Disabled

`POST /alerts/{id}/assign` — the spec's body is `AssignRequest { deviceId*, from, to, replaceCurrent }`, the same schema as `POST /drivers/{id}/assignments`. It has no assignee field, so a correct "assign to user" request can't be built; sending `deviceId` would be inventing semantics. Needs the real body (`missing-backend-apis.md` #32).

### Role-restricted (21)

All `/driver/*` operations except `GET /driver/dispatches/{id}`. The server resolves the driver from the token; the client never sends a driver id. The screen is granted only to the `driver` app role, and no backend role code is mapped to it (Q1). Admin is excluded on purpose: an administrator is not a driver identity.

## Model behaviour checked by `operations-models.test.cjs`

- Driver, dispatch, leave and assignment bodies omit blank optionals, use the spec's max lengths, enums/patterns (`gender`, `status`, `leaveType`, `outcome`) and convert IST inputs to ISO instants.
- Dashboard trend rows keep missing values as `null` (rendered "—"), sums ignore them; status slices keep server labels.
- Trip route geometry skips points/stops/events without usable GPS (missing, out of range, 0,0), orders by time, and gives a live trip no end pin.
- Search/notification links only for entity types with a screen; unknown types are shown unlinked.

## Live verification — 2026-10-29, dev tenant, Admin (`PLATFORM_ADMIN`)

**Method.** The user signed in to `http://localhost:3000` in the test tab. The agent never handled credentials or tokens. Statuses and request ids come from the app's own `[api]` console diagnostics and a temporary, passive in-page `fetch` wrapper. That wrapper recorded method, path, status, request id, item count and **only discrepancies** against the saved spec's `data` schema: undocumented keys, type mismatches, and the count of absent optional keys. It recorded no values and no headers beyond `X-Request-Id`, and issued no requests itself. It was removed afterwards (page reloaded, temporary `sessionStorage` debug keys deleted, session key untouched).

The schema check covers the top level of `data` (and each list item). Nested objects were checked by inspecting the first overview response's key names; a full deep comparison wasn't run.

Data on the tenant is the backend's stored demo set: 1 vehicle, 1 driver, 1 trip, 1 alert, 1 geofence, 0 dispatches/shifts/leave/checklists/notifications. Most list endpoints were therefore verified with 0–1 rows.

### Results (all GET; "Schema" = no undocumented keys, no type mismatches)

| Screen | Operation | Status | Rows | Schema | Request id | UI rendering checked |
|---|---|---|---|---|---|---|
| Overview | `/dashboard/overview` | 200 | — | OK, 0 absent | `c11d116a-f020-46ac-9bca-79d10e41e275` | Distance/trips today, operations tiles, device health |
| Overview | `/dashboard/fleet-status` | 200 | 6 | OK | `1d133db8-3697-4e1e-bf5d-b67c0f0098f5` | 6 status rows in the donut legend (Driving 1 = 100 %) |
| Overview | `/dashboard/trends` | 200 | 8 | OK | `9aadb3df-0c2f-487b-9b44-a5ebd1e40a0d` | 8 days on the Daily trend chart; totals 1 trip, 1 alarm, 42.5 km |
| Overview | `/dashboard/safety-events` | 200 | — | OK | `c9af0405-d24b-4a87-bd8c-407960d58523` | "Open alerts 1 · 0 severe · 7 d" |
| Trips | `/trips/summary` | 200 | — | OK | `da4b5fb3-12f2-4b94-a4ca-7aff7b5a234c` | Summary strip (1 trip, 42.5 km, 02:00:00 driving) |
| Trips | `/trips` | 200 | 1 | OK | `1d351af2-0cc4-494b-8715-9d224bc6c926` | Row: 24 Oct 11:35, Demo Truck AP01, Demo Driver One |
| Trips | `/trips/{id}` (1) | 200 | — | OK | `50de355d-ad14-4fd4-91c1-e9ad35f960c0` | Detail incl. 1 stop (PARKING) |
| Trips | `/trips/{id}/route` (1) | 200 | 0 points | OK | `2215d464-ede4-483a-aac5-da9b3cf55ccd` | Empty state "No route points with usable GPS coordinates", no map drawn |
| Trips → playback | `/devices/{id}/event-markers` (1) | 200 | 1 | OK | `52e5e8c6-a974-4ec4-8b6d-006db784e4fd` | Alarm pin "Drowsiness detected · 24 Oct, 16:15" on the map |
| Drivers | `/drivers` | 200 | 1 | OK | `0e57b8ea-f4a1-4987-a6e2-4408a66b5bd6` | Row with licence "Valid", vehicle, phone, ACTIVE |
| Drivers | `/drivers/{id}` (1) | 200 | — | OK | `fde41335-1177-4652-aed4-14a56f4359d8` | Drawer details; "Linked user — (no login)" |
| Drivers | `/drivers/{id}/assignments` | 200 | 1 | OK | `6bae8a31-481a-493b-beb7-a3397583a2f4` | Active MANUAL assignment since 22 Oct |
| Drivers | `/drivers/{id}/safety-score` | 200 | — | OK | `96d320a5-0f4f-4dbe-a4cf-32686339ddd4` | Score 95 (A), 1 alarm, 42.5 km |
| Drivers | `/drivers/{id}/safety-events` | 200 | 1 | OK | `e5257a1f-b85a-4d0c-8eb2-dd623bf22621` | "Drowsiness detected 24 Oct, 16:15" |
| Drivers | `/drivers/licence-expiries?withinDays=30` | 200 | 0 | OK | `15e75e9a-72c1-4fc0-9c5a-18d5c2bf01ff` | Empty state "No licences expiring" |
| Vehicle detail | `/devices/{id}/summary` (1) | 200 | — | OK | `3221c72d-08a1-4c66-99b0-a43508cda608` | Status Driving, assigned driver, open alerts 1, no dispatch |
| Vehicle detail | `/devices/{id}/driver-assignments` (1) | 200 | 1 | OK | `54e65b4d-aa1d-46c7-be7e-00531aee9cd4` | Assignment history row |
| Vehicle detail | `/trips?deviceId=1` | 200 | 1 | OK | `e0f56cf8-614f-4f75-9b5f-da546fa029f1` | Recent trips row |
| Dispatch | `/dispatches` (next 14 d, all) | 200 | 0 | OK | `aea01cc2-75e9-4e58-a26b-cfd7a3ca8eb7` | Empty state |
| Dispatch | `/dispatches/conflicts` | 200 | 0 | OK | `11e00d2c-1eac-47d5-aaff-d82d8a4bc639` | Empty state "No conflicts" |
| Dispatch | `/swap-requests` | 200 | 0 | OK | `22e608f6-a933-4954-a648-93c5bbfac4d3` | Empty state |
| Workforce | `/drivers/availability` | 200 | — | OK | `86b244ea-3092-4b07-bb4e-e7e865e59db3` | Count chips (AVAILABLE 1 … TOTAL 1) + driver row |
| Workforce | `/shifts` | 200 | 0 | OK | `47bca52d-c291-49bf-b797-faf1941a7663` | Empty state |
| Workforce | `/leave-requests` | 200 | 0 | OK | `9752c228-d6a3-4650-b4d6-8d0a2640dc36` | Empty state |
| Workforce | `/checklists` | 200 | 0 | OK | `ab5200e2-a807-461d-a6c4-537d9f752836` | Empty state |
| Workforce | `/checklist-template` | 200 | 12 | OK | `ac79354e-a761-462e-a18f-68e5f3dd375f` | 12 items with category / critical |
| Safety | `/safety/analytics` | 200 | — | OK | `850310a0-ad57-4420-bc4b-61f848e68051` | Totals, by day/type/severity/hour, top drivers/vehicles |
| Safety | `/safety/scores/drivers` | 200 | 1 | OK | `26697030-2da5-48f4-a9f4-c1e525d2f6be` | Demo Driver One 95 A |
| Safety | `/safety/scores/vehicles` | 200 | 1 | OK | `f7549325-1fb8-499e-91fd-8d2603d4c823` | Demo Truck AP01 95 A |
| Alerts → Incidents | `/alerts?openOnly=true` | 200 | 1 | OK | `12c509a6-af61-44a5-b688-410db6388bbb` | Row: Drowsiness detected, NEW |
| Alerts → Incidents | `/alerts/{id}` (1) | 200 | — | OK | `e8e1b451-3c8b-4fcc-ad35-c8b1a6e194da` | Drawer: status, evidence row, 1 history action |
| Header bell | `/notifications` | 200 | 0 | OK | `ac628bf3-c6cf-4d92-b769-a7842be76b11` | Empty state "No notifications" |
| Header bell | `/notifications/unread-count` | 200 | — | map keys `unread` | `4caa4d1e-2983-4e0f-b430-917ac18855cf` | aria-label "Notifications, 0 unread", no badge |
| Global search | `/search?q=Demo&limit=8` | 200 | 5 groups | map: `vehicles, drivers, alerts, geofences, users` | `54345e64-d0bb-46db-9d56-76b6e11e439c` | 5 hits rendered; vehicle/driver/alert linked; geofence/user listed without link |
| Geofences | `/geofences/events` (all, then `geofenceId`) | 200 | 1 | OK | `041d9e00-73ba-458c-82ad-51a0f4b6ad64` | ENTER · Demo Depot North · Demo Truck AP01; scoped request carries `geofenceId` |
| Geofences | `/geofences/events/summary` | 200 | — | OK | `6dbd6a68-f3f6-4e37-a7e4-f12097701b24` | Type chips ENTER 1, EXIT 0, INCOMPLETE 0, OFFSET 0, OVERSPEED 0 |
| Iris | `/assistant/prompts` | 200 | 8 | OK | `d5c400fc-7f52-40ce-9009-e00507e6bc01` | 8 server prompts rendered |

Older operations re-observed on the same screens (not counted in the 90): `GET /voices/fence` 200, 1 item, schema OK (`ffcb86a2-8844-4a0f-b45f-d877e5c089ad`), rendered "Demo Voice One 1.2 MB". `GET /reference/device-models` 200 ×99, `/object-types` 200 ×19, `/alarm-types` 200 ×170, all schema OK. `GET /reference/protocols` isn't requested by any screen visited.

### Error state (read-only, deliberately reproduced)

Deep link `/drive-vision/drivers?driver=999999`:

| Operation | Status | errorCode | Request id |
|---|---|---|---|
| `GET /drivers/999999` | 404 | `NOT_FOUND` "Driver not found" | `f4e23585-ff9c-4782-bec4-496f528a4cfc` |
| `GET /drivers/999999/assignments` | 404 | `NOT_FOUND` | `2acd03cf-2ebb-4129-9960-7efbf05465d7` |
| `GET /drivers/999999/safety-score` | 404 | `NOT_FOUND` | `997c1510-fb2e-4c39-a08e-0203bed89115` |
| `GET /drivers/999999/safety-events` | **200** (empty) | — | `d5379763-590b-4c42-b2c9-01ffbad24f67` |

UI: the drawer shows "Couldn't load this data · Driver not found · HTTP 404 · NOT_FOUND · ref f4e23585…" with Try again. No fabricated data.

### Not observed live (and why)

| Operation(s) | Reason |
|---|---|
| `GET /dispatches/{id}`, `GET /dispatches/{id}/verification` | No dispatch exists on the tenant, so there's no id to open. Creating one would be a write. |
| 24 fleet writes (drivers, assignments, dispatch incl. `/check`, swaps, leave, alert actions, notification read state) | Not sent, by rule: no writes for connectivity testing. |
| 21 `/driver/*` operations | My Work is driver-only. Admin is excluded, and no Driver role code or test-driver account is confirmed. |
| `POST /assistant/ask` | Non-GET, not sent. |
| `POST /alerts/{id}/assign` | Disabled (#32). |
| 6 service-only operations | Not called by any screen (data comes from the combined call). Not a defect. |

### Defects found and fixed

| # | Where | Observation | Fix | Re-verified |
|---|---|---|---|---|
| F1 | Incident drawer evidence | `GET /alerts/1` returned an evidence `url` on host `example.invalid` (placeholder, same as backend item #29). The drawer showed it as a working "Open" link. | Evidence links now use the shared `safeHttpUrl` (rejects reserved placeholder hosts) and show "Link not usable". | Yes, in the browser: "IMAGE · ch 1 · PENDING · Link not usable", 0 links. |
| F2 | Notification count | Live map key is `unread` (#33 answered by observation). The client had also guessed `count`/`unreadCount`/`total`. | `readUnreadCount` reads only `unread`; test updated to match. | Yes: bell label "Notifications, 0 unread". |
| F3 | Overview operations tile | "1 active drivers". | Pluralised. | Yes: "1 active driver". |

### Backend observations (not fixed in the frontend)

1. **Placeholder evidence URL**: `GET /alerts/1` → `evidence[0].url` on `example.invalid` (`e8e1b451-…`). Same class as #29.
2. **Inconsistent 404s**: for an unknown driver id, `/drivers/{id}/safety-events` returns 200 with an empty list while `/drivers/{id}`, `/assignments` and `/safety-score` return 404 (`d5379763-…` vs `997c1510-…`).
3. **Status vs history**: alert 1 has `handlingStatus: NEW`, but its `actions[]` contains an `ACKNOWLEDGE` by "Demo Tenant Admin" on 24 Oct (`e8e1b451-…`). It's either seed data or the action doesn't update the status. Matters before testing handling writes.
4. **Trip route empty**: trip 1 reports 42.5 km and 1 stop, but `/trips/1/route` returns 0 points, while `/devices/1/track` returns 1 point. Probably seed data. The UI shows the empty state correctly.

### Instrumentation note

During this pass the page reloaded several times on soft navigation. Cause: the agent's temporary `fetch` wrapper read `input.url`, which is undefined when Next's router passes a `URL` object. The wrapper threw, the RSC fetch failed, and Next fell back to a hard navigation. With the wrapper fixed, navigation stayed in the same document (`performance.timeOrigin` unchanged). **Not an application defect.**

## Write tests

Preflight on 2026-10-29: **blocked, 0 writes sent** — `phase3-write-test-plan.md`.

## Next verification steps

1. Write tests on disposable records in a confirmed test tenant (plans first), starting with a dispatch, so `/dispatches/{id}` and `/verification` can be read live.
2. Driver role mapping (Q1) plus a test-driver login, then verify My Work end-to-end.
3. Backend answers on #32 and the observations above.

## Driver login access — 2026-10-29

**Symptom.** A signed-in DRIVER login saw "No access for this account yet · Role: DRIVER".

**Root cause (frontend).** `ACCESS_POLICY.roleCodes` mapped only `PLATFORM_ADMIN`, so `DRIVER` resolved to the app role `unknown` with no screens, and `decideRoute` returned `forbidden / no-role`. `/me/menus` was fetched and stored but only fed the (empty) `screenGrants`; navigation was built from the static `NAV_GROUPS`, so the server's menu items were never used and `driver.app` wasn't recognised.

**Backend data observed** (read from the app's in-memory auth state for the signed-in Driver; no request sent, no token read):
- `/me` role `{ code: "DRIVER", description: "Driver" }`, permissions `["driver.app", "own.data.read"]`.
- `/me/menus`: 7 top-level items (ids 18–24), all `visible`, `active`, `requiredPermissionCode: "driver.app"`, no children: `my_work` (10), `my_shifts` (20), `my_leave` (30), `shift_checklist` (40), `my_safety` (50), `driver_notifications` (60), `my_profile` (70). `routePath` values are `/driver/*` (backend paths; not routes in this app).

**Fix.**
- `DRIVER` → `driver`. The role grants no screen by itself. My Work opens through the `driver.app` permission, and only for the driver role; Admin is excluded even with `driver.app`.
- The driver sidebar is built from `/me/menus` (`menuNavEntries`): visible + active, permission-checked, ordered by `sortOrder`, mapped by `routeKey` to My Work sections (`#mw-shift`, `#mw-leave`, `#mw-check`, `#mw-safety`, `#mw-profile`), and limited to screens the policy allows. Menus never grant access.
- `driver_notifications` has no page in this app (notifications are in the header bell), so it isn't rendered.
- `/drive-vision` and Overview redirect a driver to My Work; typed URLs to fleet screens stay denied.
- My Work: Contact details shows the error instead of a perpetual skeleton; Request leave / Submit checklist / Start shift are disabled when `/driver/me` fails.

**Automated (no network):** `tests/driver-access.test.cjs`, 9 tests using the live role/menu fixture. A mutation check (removing the admin exclusion) makes 2 of them fail. `tests/access-policy.test.cjs`: 3 assertions that encoded "DRIVER unconfirmed" were updated.

**Live (signed-in Driver, browser):**
- `/drive-vision/users` → "You don't have access to this page · Role: DRIVER · Go to My Work".
- `/drive-vision` → redirected to `/drive-vision/my-work`.
- Sidebar shows My Work, My Shifts, My Leave, Shift Checklist, My Safety, My Profile in that order.
- My Work sent **9 GETs and no writes**. **All returned 403 `FORBIDDEN` "Your account is not linked to a driver profile"**:

| Operation | Status | Request id |
|---|---|---|
| `GET /driver/me` | 403 | `bf02c397-718e-4b1d-bade-aaff9c2fa6d7` |
| `GET /driver/assignment` | 403 | `ffe6b827-88f4-4448-99d7-c78daa00a891` |
| `GET /driver/shifts/current` | 403 | `4dfceed4-c645-40a8-bff9-eb4fb5b3614d` |
| `GET /driver/working-hours` | 403 | `7cf5b610-2999-4365-a194-23f750a6c31e` |
| `GET /driver/dispatches` | 403 | `c79c4c1c-79ba-4e35-a362-18a2d72f7b56` |
| `GET /driver/leave-requests` | 403 | `f0fd5b78-3547-40db-95a9-d50c0179a4a9` |
| `GET /driver/checklists` | 403 | `b2a75c7a-1673-4dd4-a8a3-7488ef0e365d` |
| `GET /driver/safety-score` | 403 | `eb3afdb1-a597-4379-b4d3-0d7598bc579a` |
| `GET /driver/safety-events` | 403 | `a9e942dc-17e8-4cc9-9055-5f4f06237feb` |

The frontend now admits the Driver and shows each 403 as returned. **The driver workflows themselves are not working end-to-end:** the backend has no driver record linked to this login (`missing-backend-apis.md` #38). Admin denial of `/my-work` is covered by unit tests only; no Admin session was used in this check.

## Driver navigation — section routes (2026-10-29)

**Reproduced** with the signed-in Driver: clicking "My Shifts" did soft-navigate (same document) to `/drive-vision/my-work#mw-shift` and scrolled the Shift heading into view. But:
- the sidebar kept **My Work** highlighted, because the active item was computed from the pathname only, and a hash never changes it;
- every item pointed into the same dashboard, which rendered all sections at once, so no distinct destination appeared.

**Fix — one route per menu item** under the existing My Work screen (mirrors the backend `/driver/<x>` paths). One page component with a `section` prop; each route renders and **fetches only its own section**; no duplicated feature code.

| routeKey | Backend routePath | App route | Requests on that screen |
|---|---|---|---|
| `my_work` | `/driver/work` | `/drive-vision/my-work` | `/driver/me`, `/assignment`, `/dispatches` |
| `my_shifts` | `/driver/shifts` | `/drive-vision/my-work/shifts` | `/driver/me`, `/assignment`, `/shifts/current`, `/working-hours` |
| `my_leave` | `/driver/leave` | `/drive-vision/my-work/leave` | `/driver/me`, `/leave-requests` |
| `shift_checklist` | `/driver/checklist` | `/drive-vision/my-work/checklist` | `/driver/me`, `/assignment`, `/checklists` |
| `my_safety` | `/driver/safety` | `/drive-vision/my-work/safety` | `/driver/me`, `/safety-score`, `/safety-events` |
| `my_profile` | `/driver/profile` | `/drive-vision/my-work/profile` | `/driver/me` |
| `driver_notifications` | `/driver/notifications` | — (header bell; not rendered) | — |

The sidebar highlight now uses the shown items (`activeNavHref`), and the page title comes from the section (`getPageMeta`).

**Browser (signed-in Driver), observed:**
- Each of the six items clicked in turn: URL changed to the route above, the highlight moved to the clicked item, only that section rendered, same document (`performance.timeOrigin` unchanged), and each request was made once.
- Direct load of `/my-work/shifts` and of `/my-work/checklist`, plus a refresh of `/my-work/shifts`: correct title, highlight and section, no redirect loop.
- Back from `/leave` → `/shifts`, forward → `/leave`: soft, correct title, highlight and section.
- Admin denial of these routes: unit tests only (no Admin session used).

**Backend change observed during this check (not made by the agent):** at 16:36 every `/driver/*` GET returned 403 "not linked to a driver profile". From **16:56:22** the same login gets **200** (`GET /driver/me` ref `a29673b7-e114-45a5-b766-affa918b347d`; profile name "Satish (Test Driver)"). All nine driver reads were then observed **200** and rendered: `/driver/me`, `/assignment`, `/dispatches` (`31456c57-…`), `/shifts/current` (`530df7f0-…`), `/working-hours` (`539bf6b0-…`), `/leave-requests` (`61b65dd0-…`, 1 existing PENDING CASUAL leave — not created by the agent), `/checklists` (`9460f396-…`), `/safety-score` (`f318cd7e-…`, 100 A), `/safety-events` (`79489afb-…`). Status and rendering only — the schema-shape comparison was not run for these. No driver write was sent.

## Driver UI redesign (2026-10-29)

Presentation-only change to the six My Work routes. Same services and query keys, plus one request moved: the checklist template is now read on the Checklist screen and reused by the submit form, instead of being read when the form opens. No new endpoints, no writes.

- **Files:** `operations/my-work-page.tsx` (layouts; dialogs unchanged except the checklist form), new `operations/my-work-ui.tsx` (presentational pieces), new `operations/my-work-model.ts` (pure helpers) + `tests/my-work-model.test.cjs` (4 tests).
- **Checks:** typecheck, lint, 196/196 tests, build (30 routes).
- **Browser:** the signed-in account had been switched to Admin (`PLATFORM_ADMIN`). Observed: all six `/drive-vision/my-work*` routes → "You don't have access to this page · Role: PLATFORM_ADMIN", no driver links in the sidebar, **0** `/driver/*` requests. **Not observed:** the redesigned driver screens themselves, at any viewport — no Driver session was available, and credentials weren't requested. Responsive behaviour is by construction (see the code) and still needs a visual pass with the Driver login at 320/375/390/768/1024/1440.
