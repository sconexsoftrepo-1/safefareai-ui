# SafeFare AI — Implementation plan

Written 2026-10-27 after the Phase 0 audit. Companion docs: `api-inventory.md` (what the API offers), `feature-status.md` (where each feature stands), `missing-backend-apis.md` (what the backend must add), `api-integration-checklist.md` (per-endpoint test log from earlier work).

## Phase 0 findings (summary)

1. **The backend is a fleet-telematics BFF, not a workforce API.** 82 operations cover auth, users/roles/menus, devices/groups, realtime/track, alarms, geofences, reports, video, commands, and vendor accounts. There are **no** driver, assignment, trip, shift, leave, notification, safety-score, search or assistant endpoints.
2. **The Driver role cannot be scoped today.** There is no link between a login user and a driver or vehicle. A Driver account would see whatever the server returns for that user's tenant/hierarchy. This blocks Phase 1 data isolation for Driver and all of Phases 5–6.
3. **Already on real data:** sign-in/refresh/logout, `/me`, Overview, Live Monitoring, Trips (track playback), Vehicles (read), Alerts (read).
4. **Endpoints that exist but aren't wired:** `/me/preferences`, `PATCH /me`, `/me/password`, users/roles/permissions/menus admin, geofence CRUD, commands, `/reports/*`, video calendar/recordings/exports/sdk-token, `/devices/transfer`, `/alarms/routine/recent`, vendor users, renewals, voices, passthrough.
5. **Still mock:** Users, Geofences, Device Commands (simulated), Historical Video, Drivers, Safety Analytics, Global search, AI assistant, Settings (localStorage). Two mock components are dead code.
6. **Backend defects:** routine alarms 503; empty results returned as 503; many integer codes undocumented.
7. **Engineering baseline is clean** (typecheck, lint, 20/20 tests).

## Prerequisites from the backend / product team

| # | Needed | Blocks |
|---|---|---|
| A | Role codes for Fleet Owner and Driver, and one test login per role (Admin, Fleet Owner, Driver) on the dev tenant | Phase 1 verification |
| B | How data is scoped per user (hierarchy? groups?) for `/devices`, `/groups`, `/alarms/*`, `/monitor/realtime` | Phase 1 isolation tests |
| C | Driver entity + user link (missing-backend-apis #1) | Driver role beyond read-only device views; Phases 5–6 |
| D | Video SDK package/docs | Video playback (calendar/list/export can proceed) |
| E | Semantics of `confirm` / `confirmChargeableChange` and a disposable test device/group | Any write test in Phases 3 & 8 |

## Phases

| Phase | Scope that can proceed now | Waits on |
|---|---|---|
| 1 RBAC | `lib/access.ts`: map role code + `permissions[]` → app role; filter `NAV_GROUPS` by role; route guard in the shell with a "no access" state; hide actions without permission. Driver nav: My dashboard, My vehicle (if linkable), Alerts on own vehicle, Settings. | A, B for verification; C for real Driver scoping |
| 2 Responsive | Audit at 360/390/768/1280; table→card lists; mobile bottom nav for Driver; dialog/filter sheets. | — |
| 3 Core APIs | Preferences + profile + password; Users/Roles/Permissions (read first, writes behind confirmation); Geofences (read + map); Reports screen (mileage/driving/parking/media); Video calendar + recordings + exports; Commands read (types, history). Remove dead mock components. | E for writes, D for playback |
| 4 Monitoring | Overview distance/ranking from `/reports/mileage` & `/reports/driving` (if they return data); alarm type breakdown; recent routine alarms as a separate "live" view. | Backend fix for routine 503 |
| 5 Driver | Driver dashboard from what exists: profile (`/me`), assigned device via `DeviceDto.driver` match **only if** the backend confirms a reliable key; otherwise "awaiting backend" panels. Trip/shift/leave screens shown as unavailable. | C and #4–#8 |
| 6 Fleet Owner | Nothing beyond read views until #4, #7, #9 exist. | C, #4, #7, #9 |
| 7 Notifications/analytics/search/AI | Search: devices + users via existing keyword params. Safety analytics: real event counts from alarm lists only, no score. Assistant: disable sample-data answers. | #14–#18 |
| 8 Admin ops | Commands send flow behind permission + explicit confirm, never auto; device CRUD/transfer; user/role admin. | E, permission codes |
| 9 Backend requirements | Keep `missing-backend-apis.md` current each phase. | — |
| 10 Verification | Per phase: typecheck, lint, `npm test`, `npm run build`, browser check per role and width. | Test accounts (A) |

## Rules carried into every phase

- No new mock data; failed calls show the real error (401/403/404/503/timeout/network are distinct, via `ApiErrorState`).
- Mutations disabled unless contract, permission and ownership are confirmed; device commands are never sent automatically.
- No tokens or credentials in logs; `[api]` console diagnostics stay on in dev.
- A feature is "Implemented and verified" only after a live test is recorded.

## 2026-10-29 — integration of the 90 new spec operations

The re-downloaded spec (172 ops, snapshot `docs/openapi/api-docs-2026-10-29.json`) added the driver, assignment, trip, shift, leave, dispatch, notification, safety, search and assistant APIs that Phase 0 found missing. Done in this pass:

| Area | Done | Status |
|---|---|---|
| Foundations | Typed DTOs (`api/types-operations.ts`), 5 services (`insight`, `operations`, `alert`, `assistant`, `driver-app`) on the existing client; no new libraries, no second base URL | Typecheck/lint clean |
| Access | New screens `dispatch`, `workforce`, `myWork`; `myWork` is driver-only and excluded from the admin grant; no new role codes mapped | Unit-tested |
| Screens on real data | Overview aggregates, Trips list/detail/route, Drivers (mock removed), Safety Analytics (mock + local scoring removed), Alerts → Incidents, notifications bell, global search, Iris (local engine removed), Geofence events + voices, vehicle detail trips/assignment; new Dispatch, Workforce, My Work | Integrated — **not backend- or browser-verified** |
| Writes | 35 write operations wired behind confirmations (24 fleet, 11 driver) | **None executed** |
| Tests | `tests/operations-api.test.cjs` (89/90 ops' request construction vs. the snapshot, mocked fetch), `tests/operations-models.test.cjs` | 179/179 pass |

Classification of the 90: 62 connected to Admin-reachable screens · 21 connected only to the driver-only My Work screen · 6 service only · 1 disabled (`POST /alerts/{id}/assign`, #32). **Live verification (same day, user-signed-in Admin session): 36 operations observed — 36 × 200, schema consistent, rendered; 0 failed.** Three frontend defects found and fixed (placeholder evidence link, unread-count key, plural). Evidence: `evidence/phase3-new-api-integration.md`.

### Remaining sequence

1. ~~Authenticated read verification (Admin, dev tenant)~~ — **done 2026-10-29** for 36 of the 38 Admin-reachable reads (see evidence). Remaining: `GET /dispatches/{id}` and `/dispatches/{id}/verification` — they need a dispatch to exist, which comes with step 2.
2. **Write tests on disposable records only** — preflight done 2026-10-29, **blocked** (see `evidence/phase3-write-test-plan.md` → “Needed before the first write”); 0 writes sent. — needs a confirmed test tenant: create a driver → assign/end → edit → delete; dispatch check → create → swap request → approve/reject → cancel; leave create → approve/reject; alert acknowledge/comment/resolve on a test alert; notification read/unread. Write plans first, as in `evidence/phase2-write-test-plans.md`.
3. **Role mapping (Q1)** — **DRIVER done 2026-10-29** (live role + `driver.app` + menus). #38 resolved on the backend (16:56); driver reads verified live (9 × 200). Remaining: driver writes (needs #37) and the schema-shape check for driver responses. Fleet Owner (MANAGER?) still unconfirmed.
4. **#32 / #33** — wire alert assignment and the unread badge key once the backend answers.
5. **Service-only operations** — keep unused unless a workflow needs them (see evidence file): standalone dashboard blocks for per-widget refresh, `/alerts/{id}/evidence` + `/actions` for refreshing history without reloading the alert, `/driver/dispatches/{id}` for a driver deep link.
6. Video playback stays blocked on the vendor SDK (#20); `/video/sdk-token` is not called until then.
