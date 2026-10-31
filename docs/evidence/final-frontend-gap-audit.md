# SafeFare AI — Final frontend gap audit

**Date:** 2026-10-31 · **Branch:** `new-features/Prakash` (uncommitted working tree on top of `fc2d754`) · **Spec:** `docs/openapi/api-docs-2026-10-29.json` (172 operations)

**This is an audit only. No application code was changed.** Fixes are proposed below in a recommended order.

> **Update 2026-10-31 (fix pass):** GA-04 and GA-10 to GA-16 have been worked on. Resolution status per item, and how far each one is verified, is in **§13**. Read-only security verification (GA-01 **PASS**, GA-02 **BLOCKED**) is in **§14**. Sections 1–12 are the original audit and are left as written.

## 0. Method and limits. Read this first.

| What | Done in this pass | Not done in this pass |
|---|---|---|
| Static review | All routes under `src/app`, the shell, the access policy, the API client, session and refresh code, every feature service, and every screen component | — |
| Spec comparison | Every path literal in `src/features/drive-vision/api/*.ts` compared with the 172 spec operations, by script | Per-field schema diff of every DTO. The existing unit tests already check request shapes against the snapshot (`tests/operations-api.test.cjs`, `phase2-models.test.cjs`). |
| Automated checks | `npm run typecheck` **pass** · `npm run lint` **pass** · `npm test` **196/196 pass** | `npm run build` was not run in this pass. The last recorded result is a pass with 25 routes (2026-10-29). |
| Browser | **None.** No dev server was running and no role session was available. | No screen was opened at any viewport, for any role. No visual or responsive result below is browser-verified unless it cites earlier evidence with a date. |
| Backend | No request was sent: no reads and no writes. | Live results are cited only from the earlier evidence files, with their dates. |

Status terms used below:

- **Verified:** observed live in an authenticated browser session (the evidence file is cited).
- **Implemented, not verified:** code is complete and unit-tested with a mocked fetch, but has never run against the BFF.
- **Partial:** part of the feature is missing on the frontend.
- **UI-only:** placeholder or disabled control.
- **Blocked (backend):** needs a contract, a fix or a value table from the backend or vendor.
- **Missing:** the spec supports it, but no frontend exists.

Priorities: **P0** security or critical data integrity · **P1** blocks release · **P2** important feature or usability issue · **P3** polish or future work.

**Headline:** no P0 *code* defect was found. The access policy is deny-by-default, menus can't widen access, driver endpoints never take a driver id, and no token or body is logged. The P0 items are **missing verification**: the frontend's role isolation has never been backed by an observed server-side 403. Release is blocked mainly by backend role decisions, by zero verified writes, and by the missing visual pass. Development work is a small share of what remains.

---

## 1. Role audit

### 1.1 PLATFORM_ADMIN (`admin`)

- **Mapping:** `PLATFORM_ADMIN` → `admin` (`src/features/drive-vision/access/access-policy.ts`, `ACCESS_POLICY`). The role gets every fleet screen and both shell features. My Work is explicitly removed (`computeAccess`).
- **Screens:** Overview, Live Monitoring, Historical Video, Trips, Reports, Vehicles, Drivers, Dispatch, Workforce, Alerts, Safety, Geofences, Device Commands, Users, Settings. Reads were verified live on 2026-10-26, 10-27 and 10-29 (`phase2-acceptance.md`, `phase3-new-api-integration.md`). The tenant has 0–1 rows per list.
- **Gaps:**
  - No per-action permission check: write buttons are shown whatever `/me.permissions` contains (GA-16).
  - Whether PLATFORM_ADMIN is platform-wide (sees every tenant) or tenant-scoped is undocumented (GA-02).
  - Every admin write is unverified (GA-05).

### 1.2 FLEET_OWNER (`fleet-owner`)

- **Mapping:** none. `roleGrants["fleet-owner"]` grants nothing. Per this audit's rule, **do not enable it** until the backend confirms it.
- **Backend roles seen:** `GET /roles` returns `ADMIN` ("Full tenant administration"), `MANAGER` ("Fleet manager"), `OPERATOR` ("Operations user"), `DRIVER` and `PLATFORM_ADMIN` (`missing-backend-apis.md` Q1).
- **Effect today:** a signed-in ADMIN, MANAGER or OPERATOR user sees "No access for this account yet" on every route. **Only platform admins and drivers can use the app** (GA-03).
- **Screens a Fleet Owner would need:** Dashboard, Vehicles, Drivers, Trips, Alerts, Reports, Geofences, Workforce, Dispatch, Settings. All of them are built and work for Admin. Org-level data isolation can't be assessed: it is a backend guarantee, and the frontend sends no tenant or org id (correct) (GA-02).
- **Before mapping:**
  - A confirmed code and its permission list.
  - Per-action gating (GA-16).
  - A decision on whether Users and Device Commands are in scope for this role.
  - One test login.

### 1.3 DRIVER (`driver`)

- **Mapping:** `DRIVER` → `driver`. My Work opens only through the `driver.app` permission *and* the driver role. No fleet screen or shell feature is granted. Unit-tested (`tests/driver-access.test.cjs`).
- **Navigation:** built from the real `/me/menus` response (`use-nav.ts` `driverMenuGroup`, `access-policy.ts` `menuNavEntries`).
  - Uses the server's titles and `sortOrder`, matched by `routeKey`.
  - `driver_notifications` → `null` (the bell icon instead).
  - Order and the denied-URL behaviour were browser-verified 2026-10-29.

| Route | Section | Server data | Status |
|---|---|---|---|
| `/drive-vision/my-work` | Today, current/next trip, upcoming trips | `/driver/me`, `/driver/assignment`, `/driver/dispatches` | Reads verified live 2026-10-29. Trip actions not verified. |
| `/drive-vision/my-work/shifts` | Current shift, start/end, hours | `/driver/shifts/current`, `/driver/working-hours`, `/driver/shifts/start\|end` | Reads verified. Start/end not verified. |
| `/drive-vision/my-work/leave` | List, request, cancel | `/driver/leave-requests*` | Reads verified. Writes not verified. |
| `/drive-vision/my-work/checklist` | Template, submit, history | `/driver/checklist-template`, `/driver/checklists` | Reads verified. Submit not verified. |
| `/drive-vision/my-work/safety` | Score, events (30 d) | `/driver/safety-score`, `/driver/safety-events` | Reads verified |
| `/drive-vision/my-work/profile` | Profile, licence, contact edit | `/driver/me` GET/PATCH | Read verified. PATCH not verified. |

- **Data isolation, frontend:** correct. `driver-app-service.ts` never sends a driver id: the server resolves the driver from the token. Admin is excluded from My Work.
- **Data isolation, server:** **never verified.** No one has observed the Driver token being refused by fleet endpoints (`/devices`, `/drivers`, `/alerts`, `/users`, `/search`, `/dispatches`, `/notifications` scope) (GA-01).
- **Visual:** the redesigned driver screens have **never been seen** at any viewport (`phase3-new-api-integration.md` §245) (GA-07).
- **Driver-specific defects:** GA-10, GA-12, GA-13, GA-14, GA-15.

---

## 2. Complete feature inventory

| # | Feature group | Route(s) | Classification | Detail |
|---|---|---|---|---|
| 1 | Dashboard & analytics | `/overview` | **Verified (read)** | `/dashboard/overview`, `/fleet-status`, `/trends`, `/safety-events`, plus realtime, devices, groups, alarms, preferences. Verified 2026-10-29 with demo data. Heavy request fan-out (GA-22). |
| 2 | Live Monitoring & maps | `/monitoring` | **Verified** (2026-10-26) | `/monitor/realtime` polled every 30 s while the tab is visible. MapLibre/MapTiler with a coordinate-grid fallback. No push (GA-36). |
| 3 | Trips & route tracking | `/trips` | **Verified (read)** | Trip list, summary, detail and route (0 points → empty state). Track playback and event markers. Read-only by spec. |
| 4 | Vehicles & devices | `/vehicles`, `/vehicles/[id]`, `/vehicles/new` | **Verified (read)**. Writes **Blocked (backend)** | Create, edit, delete and transfer are disabled pending `confirmChargeableChange` semantics and the transfer contract. `/vehicles/new` is an explanatory placeholder (UI-only). |
| 5 | Driver management | `/drivers` | **Verified (read)**. Writes **implemented, not verified** | CRUD plus assign/end assignment, licence expiries, safety score/events. |
| 6 | Dispatch & assignments | `/dispatch` | **Partially verified (read)**. Writes **implemented, not verified** | List, conflicts and swaps returned 200 with empty data. Detail and verification never observed (no dispatch exists). `/dispatches/check` never sent. |
| 7 | Workforce, shifts, leave | `/workforce` | **Verified (read)**. Writes **implemented, not verified** | Availability, shifts, leave, checklists, template. Leave approve/reject and create not sent. |
| 8 | Alerts & event evidence | `/alerts` | AI and routine lists **Verified**. Incidents read **Verified**. Actions **implemented, not verified**. Assign **Blocked** (#32) | Evidence links are filtered (http/https, no placeholder hosts) except in the AI alarm drawer (GA-23). |
| 9 | Safety analytics | `/safety` | **Verified (read)** | Server scores only. |
| 10 | Geofences & events | `/geofences` | List, map, events and voices **Verified**. Delete **implemented, not verified**. Create/edit **Blocked** (Q2) | `GET /geofences/{id}` unused (the list carries the data). |
| 11 | Historical video & SDK playback | `/video` | Calendar, recordings, export list **Verified (empty)**. Export request **implemented, not verified**. **Playback Blocked (vendor SDK)** | `/video/sdk-token` is never called. Export status has no auto-refresh and `GET /video/exports/{id}` is unused (GA-35). Download links from the BFF were placeholders (#29). |
| 12 | Reports & exports | `/reports` | Four report tabs **Verified (empty data)**. File export **Missing** | No CSV/XLSX/PDF download of report tables. The spec has no report-export endpoint (GA-17). |
| 13 | Notifications | header bell | Read **Verified (empty)**. Mark read/unread/all **implemented, not verified** | No polling or push (GA-20). Links aren't role-aware (GA-12). |
| 14 | Global search | header, ⌘K | **Verified** | `/search` only with the `recordSearch` grant. Drivers get page results only, and `/search` is never called for them. |
| 15 | AI assistant | header launcher | Prompts **Verified**. `POST /assistant/ask` **implemented, never sent** | Admin only (`assistant` feature). Stale "sample data" copy in Settings (GA-11). |
| 16 | Users & sub-accounts | `/users` | Read and tree **Verified**. Create, edit, status, unlock and reset **implemented, not verified**. Delete user and role editing **Missing / Blocked** (#24) | `DELETE /users/{id}`, `POST/PUT/DELETE /roles*`, `PUT /roles/{id}/permissions` are not integrated. |
| 17 | Device commands | `/devices/commands` | History and types **Verified**. Detail **Blocked** (`GET /commands/{id}` → 500, #28). Send **UI-only (disabled), Blocked** (#25) | Diagnostics (`passthrough-data`) **Blocked** (undocumented `type`). |
| 18 | Profile & settings | `/settings` | Profile PATCH and preferences PUT **Verified** (reversible round-trip, 2026-10-27). Change password **implemented, not verified** | Fleet-only. Drivers have no password change or preferences (GA-13). |
| 19 | Reference data & configuration | (used inside screens) | Device models, protocols, object types and alarm types (read) **Verified**. Admin configuration **Missing** | `PATCH /reference/alarm-types/{id}`, `/menus` CRUD, `/groups` CRUD (POST, GET/PUT/DELETE `{id}`), `/vendor-users*`, `/renewals`, `GET/POST /voices` are not integrated. Some are deliberately deferred: vendor charges, live vendor configuration. |
| 20 | Driver self-service | `/my-work/*` (6 routes) | Reads **Verified** (9 GETs, 2026-10-29). Writes **implemented, not verified**. Visual **not verified** | See §1.3. `GET /driver/dispatches/{id}` is unused (GA-32). |

**Platform features**

- Login, refresh, cross-tab rotation, logout and `/me`: **Verified**.
- `/me/menus`: **Verified for Driver**. A failure is silent (GA-14).
- Route guards: **Verified** for unauthenticated, Admin and Driver. Unknown paths return a soft 404 (GA-21).

---

## 3. Missing frontend features (development work, the spec allows it)

| ID | Feature | Spec operations | Priority | Notes |
|---|---|---|---|---|
| GA-13 | Driver password change (and optionally preferences) | `POST /me/password`, `GET/PUT /me/preferences` | P2 | Settings is fleet-only, so a driver has no way to change their password in-app. First confirm that `DRIVER` may call these. Add it to My Profile; don't grant the Settings screen. |
| GA-17 | Report export (CSV of the loaded rows) | none (client-side) | P2 | The spec has no report-download endpoint. A client-side CSV of the current filter is possible. A server export needs a backend API. |
| GA-18a | Group management | `POST /groups`, `GET/PUT/DELETE /groups/{id}` | P3 | The old sample-data `NewGroupDialog` exists but is unused. Before building, confirm whether a group change touches vendor billing. |
| GA-18b | Menu administration | `GET/POST /menus`, `GET/PUT/DELETE /menus/{id}` | P3 | Affects every user's navigation. Needs a product decision. |
| GA-18c | Alarm-type configuration | `PATCH /reference/alarm-types/{id}` | P3 | Tenant-wide effect. |
| GA-32 | Driver single-trip deep link | `GET /driver/dispatches/{id}` | P3 | Needed for notification → trip links for drivers. |
| GA-35 | Video export status detail and auto-refresh | `GET /video/exports/{id}` | P3 | Today the list re-reads only on a manual refresh. |

---

## 4. Partially implemented features

| ID | Feature | What exists | What's missing | Kind | Priority |
|---|---|---|---|---|---|
| GA-14 | `/me/menus` failure handling | `menusError` is stored in `auth-store.ts` | It is never displayed. If menus fail, `driverMenuGroup` returns null and the sidebar falls back to the single static "My Work" entry, so 5 of the 6 driver sections can't be reached from navigation (direct URLs still work). | Frontend | P2 |
| GA-15 | Driver trip actions | Accept, Start, Complete, Decline and Swap with confirmation | Every button is shown on every trip, whatever its status (`my-work-page.tsx` `tripActions`). The server rejects invalid transitions, and the driver only sees an error toast. | Frontend + backend (status/transition table undocumented) | P2 |
| GA-16 | Permission-aware actions | Screen-level grants | No action is gated on `/me.permissions`. Required before any less-privileged role (MANAGER, OPERATOR) is mapped. | Frontend, needs a backend permission catalogue | P2 (P1 once GA-03 is resolved) |
| GA-12 | Notification links | `notificationHref` maps alert, leave, swap, vehicle and driver hits | Not filtered by access, and the footer "Open Alerts & Events" is always shown. A driver tapping a leave notification lands on `/workforce` → "You don't have access". | Frontend | P2 |
| GA-20 | Notification freshness | Count on load and when the panel closes | No polling or push, so the badge goes stale during a shift. | Frontend (polling) or backend (push) | P3 |
| GA-31 | Post-login return | `?next=` with a safe-prefix check | `AuthGate` sends only `pathname`, so the query is lost (e.g. `/alerts?kind=incidents`, `/drivers?driver=1`). | Frontend | P3 |

---

## 5. Backend-blocked features

| ID | Feature | Blocker | Ref | Priority |
|---|---|---|---|---|
| GA-03 | Fleet Owner / tenant ADMIN / OPERATOR access | Role meaning and permissions unconfirmed. These users currently see "No access". | Q1, #31 | **P1** |
| GA-08 | Historical video playback | Vendor video SDK/player not provided. `SdkTokenDto` alone isn't enough. | #20 | **P1** (core product capability) |
| GA-05 | Every write flow (≈ 45 fleet + 10 driver operations) | No designated test tenant, side effects undocumented, no dispatch delete; driver writes need #37 | `phase3-write-test-plan.md` | **P1** (missing testing) |
| GA-37 | Command detail | `GET /commands/{id}` → 500 | #28 | P2 |
| GA-38 | Vehicle create, edit, delete and transfer | `confirmChargeableChange` and transfer semantics | #19, #26 | P2 |
| GA-39 | Geofence create/edit | `ruleTypes`, `areaType`, `colorIndex` tables; geometry rules | Q2, #22 | P2 |
| GA-40 | Send device command | Execution contract | #25 | P2 |
| GA-19 | Alert assign | `AssignRequest` has no assignee | #32 | P2 |
| GA-41 | Video export request semantics | Cost, status table, placeholder URL | Q3, #29 | P2 |
| GA-42 | Delete user; role and permission editing | Cascade and role-model semantics | #24 | P3 |
| GA-33 | Device diagnostics (`passthrough-data`) | `type` code undocumented | — | P3 |
| GA-43 | Vendor users, renewals, voice upload | Vendor charges and live vendor configuration | — | P3 |
| GA-44 | Vehicle search with no match → 503 | Backend defect | #13 | P2 |

---

## 6. UI/UX defects

| ID | Defect | Files | Roles | Priority |
|---|---|---|---|---|
| GA-10 | The profile menu shows "Profile & preferences" (`/settings`) and "Users & sub-accounts" (`/users`) to every role. For a driver (or any role without those screens) both lead to the access-denied panel. | `app-shell/user-profile-menu.tsx:67-76` | Driver, any future role | P2 |
| GA-11 | Stale demo copy in a production build: <br>• "Demo workspace · sample data, no live device connections" (`DemoNotice`, shown in the mobile nav). <br>• "About this demo" toast saying "This workspace uses sample data only", in the sidebar and the profile menu. <br>• Settings toggle "Iris launcher (sample data; admins only)". <br>• `package.json` description "frontend demo with mock data". <br>• Stale code comment in `app-shell.tsx:33`. | `app-shell/sidebar.tsx:104-110, 241-249`, `app-shell/mobile-nav.tsx:44`, `app-shell/user-profile-menu.tsx:77-79`, `settings/settings-page.tsx:353`, `package.json` | All | P2 |
| GA-12 | Notification links and footer aren't role-aware (see §4) | `app-shell/notification-center.tsx:65-71, 149-151`, `app-shell/search-model.ts:51-57` | Driver | P2 |
| GA-15 | All trip actions on every trip (see §4) | `operations/my-work-page.tsx` (`tripActions`) | Driver | P2 |
| GA-23 | The AI alarm evidence drawer links any http(s) URL, including placeholder hosts (`example.invalid`). Incidents, Reports and Video already suppress these. | `alerts/alerts-model.ts:101-109` (`safeMediaUrl`), `alerts/event-detail-drawer.tsx:68-69` vs `reports/reports-model.ts:36-50` | Admin | P3 |
| GA-45 | Raw server codes are shown for statuses (`mediaType`, `triggerType`, leave/dispatch/export status) | Reports, Workforce, Dispatch, Video | All | P3 (needs value tables) |
| GA-21 | Unknown `/drive-vision/*` paths return HTTP 200 with the in-shell "Page not found" | `app/drive-vision/[...slug]`, `not-found.tsx` | All | P3 |

**Accessibility (static review only)**

- Icon buttons carry `aria-label`s.
- `DataTable` rows are focusable, with Enter/Space support and `aria-sort`.
- The search box is a combobox/listbox.
- Error panels use `role="alert"`.

Not assessed: map-marker keyboard access, focus order inside the slide-over panels at 320 px, and colour contrast. These need a browser and a screen reader.

---

## 7. Responsive defects and gaps

**No viewport was browser-checked in this pass.** Earlier evidence: the Phase 2 screens at 768, 390 and 360 px (width-constrained frames, 2026-10-27), and a Users filter fix at 390 px (`phase1b-admin-access.md`).

| ID | Item | Priority |
|---|---|---|
| GA-07 | **Missing testing.** The Driver screens have never been seen at 320×640, 375×812, 390×844, 768×1024, 1024×768 or 1440×900. Admin screens have not been checked at 320, 375, 1024 or 1440 (or at any width since the 2026-10-29 screens were added: Dispatch, Workforce, Incidents, Trip history, Geofence events). Fleet Owner can't be checked (no role). | P1 (Driver: the primary mobile users) / P2 (Admin) |
| GA-25 | 12 screens use `DataTable` with columns hidden below `sm`/`md`/`lg` and no mobile card layout. Where rows don't open a detail panel, hidden fields can't be reached on phones. Needs a per-table check at 320–390 px. | P3 |
| — | Static review found no fixed widths that would overflow at 320 px. The widest fixed controls are `w-56`/`w-64` selects, which fit in the 288 px content width. Multi-column grids use breakpoint or container-query prefixes. **This is a code reading, not a verification.** | — |

---

## 8. Security and role-access issues

| ID | Issue | Kind | Priority |
|---|---|---|---|
| GA-01 | **Server enforcement for DRIVER tokens is unverified.** Nobody has observed fleet endpoints (`GET /devices`, `/drivers`, `/alerts`, `/users`, `/search`, `/dispatches`, `/trips`, `/monitor/realtime`) refusing a Driver token, or confirmed that `/notifications` and `/driver/*` return only that driver's rows. The frontend guard is UI-only by design (`route-guard.tsx`). The test is read-only, so it fits the no-write rule. | Missing testing + backend | **P0** |
| GA-02 | **Tenant and org isolation is unverified.** Only one tenant and one admin account have been used. Whether `PLATFORM_ADMIN` sees all tenants is undocumented. Fleet Owner org scoping can't be tested. The frontend correctly sends no tenant id; isolation depends entirely on the BFF. | Missing testing + backend | **P0** |
| GA-04 | **No security response headers.** `next.config.ts` sets only `poweredByHeader: false`: no Content-Security-Policy, no `frame-ancestors`/`X-Frame-Options` (clickjacking on the confirm dialogs), no `Referrer-Policy`, no `X-Content-Type-Options`. Combined with GA-28, an XSS would expose the tokens. Can be set in Next `headers()` or at the hosting layer. | Frontend / deployment | **P1** |
| GA-28 | Access and refresh tokens are stored in `sessionStorage`, readable by JS. This is documented in `api/session.ts`. Fixing it needs the BFF to issue an httpOnly refresh cookie. | Backend dependency | P2 |
| GA-16 | No per-action permission gating (see §4). Not a security hole (the server must authorise), but needed before any less-privileged role is mapped. | Frontend | P2 |
| GA-29 | No idle timeout: a session lasts until the refresh token expires. Matters for shared depot devices. | Product decision | P3 |
| GA-27 | UI preferences (`use-preferences.ts`) are stored in `localStorage` per browser, not per user, so the next user on a shared device inherits display options. No sensitive data is involved. | Frontend | P3 |

**Checked and found correct**

- Deny-by-default policy. Menus can't widen access (`menuNavEntries` requires `canAccessPath`).
- Driver self-service is excluded for non-driver roles.
- Denied pages never mount, so they send no API calls.
- Login `next` is restricted to `/drive-vision…` and rejects `//`.
- 401 → single-flight refresh → retry once → end the session.
- Logout clears local tokens even when the request fails.
- Cross-tab rotation hands over only to tabs that held the retired token.
- Diagnostics never log headers, bodies or tokens and are off in production.
- No `console.*` calls outside `diagnostics.ts`.
- No `dangerouslySetInnerHTML` or `eval`.
- External links use `rel="noopener noreferrer"` and are protocol-filtered.

---

## 9. API integration issues

**Spec coverage.** 108 distinct method+path combinations are used; every one exists in the spec. No call uses a path outside the spec. The script's apparent mismatches were template paths like `/alerts/${id}/${action}`, which resolve to spec operations.

Spec operations not called, by reason:

| Reason | Operations |
|---|---|
| Blocked or deferred by decision (§5) | `POST/PUT/DELETE /devices*`, `POST /devices/transfer`, `POST /commands`, `POST/PUT /geofences*`, `POST /alerts/{id}/assign`, `GET /video/sdk-token`, `GET /devices/{id}/passthrough-data`, `DELETE /users/{id}`, roles writes, `/vendor-users*`, `/renewals`, `GET/POST /voices` |
| Missing (§3) | `/groups` CRUD, `/menus` CRUD, `PATCH /reference/alarm-types/{id}`, `GET /video/exports/{id}`, `GET /driver/dispatches/{id}` |
| Intentionally unused (covered by another call) | `GET /dashboard/vehicles`, `/active-trips`, `/device-health` (inside `/dashboard/overview`), `/alerts/{id}/evidence` and `/actions` (inside the detail), `GET /geofences/{id}`, `GET /roles/{id}`, `GET /menus/{id}`, `GET /vendor-users/current`, `GET /alarms/routine/recent` (no time window) |

| ID | Issue | Files | Priority |
|---|---|---|---|
| GA-22 | **Duplicate and heavy requests.** <br>• `fleetService.listAllDevices()` (up to 20 pages × 100) is fetched again on every screen with no shared cache: Overview, Monitoring, Alerts, Reports, Video, Trips, Geofences, Commands, Drivers, Dispatch/Workforce pickers. <br>• Overview sends about 10 requests, including paging through **all** AI and routine alarms for the range, even though `/dashboard/overview` and `/dashboard/safety-events` already aggregate them. <br>• `listAllDevices` takes no `AbortSignal`, so navigating away doesn't cancel the paging. | `api/fleet-service.ts:86-88`, `dashboard/fleet-overview.tsx:84-94`, `operations/use-pickers.ts` | P3 (P2 for large fleets) |
| GA-23 | Inconsistent URL safety helpers (`safeMediaUrl` vs `safeHttpUrl`) | see §6 | P3 |
| GA-35 | Export status isn't refreshed | `video/video-workspace.tsx` | P3 |
| — | **Sample-data and placeholder dependencies.** No live screen reads sample data. **Dead code** is still in the tree: <br>• `vehicles/vehicle-form.tsx` and `vehicle-dialogs.tsx`: these write to the in-browser store and would "save" locally if re-wired. <br>• `dashboard/activity-feed.tsx`, `monitoring/vehicle-details-panel.tsx`, `store/fleet-store.ts`, `services/*`, `hooks/use-live-simulation.ts`, the demo base map in `map/map-base.tsx`, and most of `mock-data/*`. <br>• `ExpiryBadge` defaults `now` to the fixed `DEMO_NOW` (2026-10-23) (`vehicles/vehicle-cells.tsx:26`). Live callers pass the real clock, so nothing is wrong today. (GA-24) | listed | P3 |
| — | Error handling and response mapping were reviewed and are consistent: <br>• The HTTP status is authoritative, and an error `code` inside a 2xx envelope also counts as an error. <br>• 503 is shown as "unavailable", never as zero. <br>• Missing values show "—". <br>• Field errors are mapped per field. <br>• `requestId` is shown for reporting. | `api/client.ts`, `shared/api-states.tsx` | — |

**Live verification vs mocked testing:** 36 GETs were observed live on 2026-10-29 as Admin, plus 9 `/driver/*` GETs as Driver, plus the earlier phases. Every write operation has only been tested against a mocked `fetch`.

---

## 10. Issue register by priority

| Pri | ID | Title | Type | Route(s) |
|---|---|---|---|---|
| P0 | GA-01 | Server-side denial for DRIVER tokens not verified | Testing / backend | all fleet routes, `/my-work/*` |
| P0 | GA-02 | Tenant/org isolation not verified | Testing / backend | all |
| P1 | GA-03 | ADMIN/MANAGER/OPERATOR (Fleet Owner) unmapped → "No access" | Backend decision | all |
| P1 | GA-04 | No CSP, frame or security headers | Frontend / deploy | all |
| P1 | GA-05 | 0 write operations verified live | Testing / backend | Drivers, Dispatch, Workforce, Alerts, Users, Geofences, Video, Settings, My Work |
| P1 | GA-07 | No visual/responsive pass for Driver; incomplete for Admin | Testing | `/my-work/*`, Phase 3 admin screens |
| P1 | GA-08 | Video playback (vendor SDK) | Backend / vendor | `/video` |
| P2 | GA-10 | Profile menu links to screens the role can't open | Frontend | shell |
| P2 | GA-11 | Stale "demo / sample data" copy | Frontend | shell, `/settings` |
| P2 | GA-12 | Notification links not role-aware | Frontend | shell |
| P2 | GA-13 | Drivers can't change their password | Frontend (+ confirm permission) | `/my-work/profile` |
| P2 | GA-14 | `/me/menus` failure is silent; driver nav collapses | Frontend | `/my-work/*` |
| P2 | GA-15 | Trip actions not status-aware | Frontend + backend | `/my-work` |
| P2 | GA-16 | No per-action permission gating | Frontend | all write screens |
| P2 | GA-17 | No report export | Frontend (CSV) / backend | `/reports` |
| P2 | GA-19, 37–41, 44 | Backend-blocked items in §5 | Backend | various |
| P2 | GA-28 | Tokens readable by JS | Backend | — |
| P3 | GA-18, 20–27, 29, 31–33, 35, 36, 42, 43, 45, 46 | Polish, deferred integrations, cleanup | mixed | various |

GA-36: Live Monitoring is poll-only (30 s). GA-46: documentation drift (§11).

---

## 11. Documentation drift (P3, GA-46)

- `docs/feature-status.md`, **My Work** row: says "no role code maps to it (Q1)… Never exercised", but the same row reports reads verified live with the Driver login. **Driver data ownership** row: still "Blocked only on which role code is a driver (Q1)", although `DRIVER` is mapped.
- `docs/evidence/phase3-new-api-integration.md` line 58: same stale "no backend role code is mapped" statement.
- `package.json` `description`: "frontend demo with mock data".
- The `feature-status.md` baseline says 179/179 tests; the current count is **196/196**.

---

## 12. Recommended implementation order

No code was changed for this audit. Proposed order:

1. **Verification gates (no code; GETs only, safe under the no-write rule).**
   - GA-01: with the Driver login, call 8–10 fleet GETs and record the expected 401/403 and request ids. Check that `/driver/*` and `/notifications` return only that driver's rows.
   - GA-02: ask the backend for a second tenant or account to test cross-tenant reads.
   - Get the answers to Q1 (GA-03) and a designated write-test tenant (GA-05).
2. **Small frontend fixes, low risk, no behaviour change for Admin.**
   - GA-04: security headers in `next.config.ts`, starting with CSP in report-only mode.
   - GA-10, GA-12, GA-14: role-aware shell links and visible menu-failure handling.
   - GA-11: remove the demo copy.
   - GA-23: one URL-safety helper.
3. **Driver release pass.**
   - GA-07: visual pass at the six viewports with the Driver login.
   - GA-15: hide or disable actions by status, once the backend supplies the transition table, or label them clearly.
   - GA-13: password change in My Profile, once the backend confirms the permission.
4. **Write verification (GA-05)** per `phase3-write-test-plan.md`, on the test tenant only, with reversible pairs first.
5. **Fleet Owner enablement**, only after GA-03 is confirmed: GA-16 (permission gating), then the role mapping, then the GA-01/GA-02 tests repeated for that role, then the visual pass.
6. **P2 features:** GA-17 (CSV export), then the backend-blocked items as contracts arrive (GA-08, 37–41).
7. **P3 cleanup:**
   - GA-24: delete the dead sample-data modules.
   - GA-22: request caching and abort.
   - GA-21, GA-31, GA-20, GA-25, GA-46 (docs).

---

## 13. Resolution status — fix pass 2026-10-31

**Scope:** GA-04 and GA-10 to GA-16. No other item was changed. No API request of any kind was sent, no write was sent, and no role session was used.

**Verification of this pass**

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 problems) |
| `npm test` | **217/217 pass** (196 before + 21 new in `tests/final-audit-fixes.test.cjs`) |
| `npm run build` | Pass. 29 static pages generated; routes unchanged. |
| HTTP headers | `next start` of this build on localhost, `curl -I /login`: all six headers present with the expected values. This was a local HTTP check only. No page was opened in a browser and no backend was contacted. |
| Browser | **Not performed.** No role session was available. |
| Backend | **Not performed.** |

Legend: **Code** = fixed in code · **Auto** = covered by automated tests · **Browser** = verified in a browser · **Backend** = verified against the BFF.

| ID | Resolution | Code | Auto | Browser | Backend | Still blocked / remaining |
|---|---|---|---|---|---|---|
| GA-10 | The profile menu builds its shortcuts from `profileMenuLinks(access)`. Settings and Users appear only when the role may open them. Admin keeps both links; Driver and unmapped roles get none. | Yes | Yes | No | n/a | Visual check with the Driver login |
| GA-11 | Removed: the "Demo workspace · sample data" notice (mobile nav), both "About this demo" toasts (rail, profile menu), "sample data" in the Iris setting, the outdated note in vehicle detail, the "demo with sample data" page metadata, and "mock data" in `package.json`. <br>Deliberately kept: the dead sample-data modules (GA-24, out of scope) and the fleet map's "Illustrative map · demo positions" label. That label is only drawn in the no-bounds demo mode, which no live screen uses, and it is accurate for that mode. | Yes | Yes (source scan) | No | n/a | GA-24 dead-code removal |
| GA-12 | Notification links follow the role. **Driver:** leave → `/drive-vision/my-work/leave`; swap and dispatch → `/drive-vision/my-work` (where the driver's trips and swap requests are shown); every other type is left without a link. **Fleet:** mapping unchanged. Every link and the "Open Alerts & Events" footer pass `reachableHref`. An item without a reachable destination is plain text, not a disabled button. No new route was created. | Yes | Yes | No | No | `refType` values are still undocumented (#33); the mapping matches names only |
| GA-13 | Spec: `POST /me/password` (`ChangePasswordRequest {currentPassword*, newPassword*}`, each ≤ 72; global bearer auth, no role restriction documented). The existing Settings form (`PasswordPanel`) is now exported and shown on **My Profile** behind the `account.password` action, which the Driver role has. The Settings screen itself stays fleet-only. Values live only in component state; the confirmation field is never sent. | Yes | Yes | No | No | **Backend dependency:** confirm that `DRIVER` may call `/me/password` (not exercised; the agent doesn't enter passwords). A 403 is shown as "You don't have permission to do that." |
| GA-14 | A failed `GET /me/menus` now shows a visible alert ("Your menu couldn't be loaded" + the server error + **Retry** → `retryMenus()`) in the shell for drivers. While menus load, the driver's navigation stays empty instead of flashing the static entry. After a failure only the policy-allowed static entry (My Work) remains; no item is generated from a failed menu. Direct URLs still go through `decideRoute`. | Yes | Yes | No | No | Visual check; simulating a menu failure in the browser |
| GA-15 | `tripActionAvailability(trip)` withholds an action only on facts the server recorded on the trip, never on `status` codes (transitions are undocumented, and the state list in `missing-backend-apis.md` #5 is our own unconfirmed proposal). <br>• Completed, cancelled (`cancelReason`), declined (`declineReason`) or no id → nothing offered. <br>• `startedAt` → no Accept, Start or Decline. <br>• `respondedAt` → no Accept. <br>• `pendingSwapRequestId` → no Swap. <br>Withheld actions are hidden, and a one-line reason is shown under the trip. Everything else is still offered, and the server decides. | Yes | Yes | No | No | **Backend dependency:** status codes and the allowed transitions (#9). Driver writes untested (#37). |
| GA-16 | New central action policy in `access-policy.ts`: `ACTION_SCREENS`, `canPerform`, `useCan`. Each role keeps exactly the actions it already had. <br>• Admin: all fleet actions. <br>• Driver: `driver.selfService`, `account.password`, `notifications.markRead`. <br>• Fleet Owner and unknown roles: none. <br>An action is dropped when its screen isn't allowed, so a future screen grant never exposes write buttons by itself. `actionGrants` (permission code → action) is empty: Admin's 21 codes were never catalogued, so nothing is inferred. <br>Gated entry points: <br>• Drivers: create, edit, delete, assign, end. <br>• Dispatch: create, edit, cancel, swap request, and swap approve/reject (separate action). <br>• Workforce: leave request, approve/reject. <br>• Incidents: all handling actions. <br>• Geofence delete. Video clip export. <br>• Users: create, edit, status, unlock, reset password. <br>• Settings: profile save, preferences save, password. <br>• My Work: every driver write. <br>• Notifications: mark read/unread/all. | Yes | Yes | No | No | **Backend dependency:** the permission code that authorises each operation, needed before MANAGER/OPERATOR can be mapped (GA-03). The BFF remains the enforcement layer. |
| GA-04 | `next.config.ts` → `headers()` on `/:path*` from `src/config/security-headers.ts`. <br>**Enforced:** CSP `frame-ancestors 'self'; object-src 'none'; base-uri 'self'`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy` denying camera, microphone, geolocation, payment and USB. <br>**Report-only:** the full allow-list. It covers `'self'`, the configured BFF origin, MapTiler (only when a key is set) or the custom style origin, `blob:` workers, inline scripts and styles (no nonces: pages are static), plus `'unsafe-eval'` and `ws:` in development only. | Yes | Yes (+ local `curl -I`) | No | n/a | Browser pass to collect report-only violations (maps, login, every screen) before enforcing. See the deployment notes below. |

**Production deployment notes (GA-04)**

1. **Headers are fixed at build time.** Next evaluates `headers()` during `next build`, so the CSP contains the `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_MAPTILER_KEY` and `NEXT_PUBLIC_MAP_STYLE_URL` of the *build* environment. Build with the production values. In the local check the report-only CSP contained the dev BFF origin.
2. **The BFF is plain HTTP.** The configured dev BFF is `http://<ip>:9096`. Served from an HTTPS origin, browsers block it as mixed content, and bearer and refresh tokens travel unencrypted. Production needs an HTTPS BFF origin. `upgrade-insecure-requests` was deliberately **not** added, because it would break the current HTTP API.
3. **HSTS** (`Strict-Transport-Security: max-age=31536000; includeSubDomains`) belongs on the TLS-terminating reverse proxy or CDN, once every subdomain serves HTTPS. It is not set by the app, because it would be wrong for HTTP development.
4. **Proxy duplicates.** If the reverse proxy also sets `X-Frame-Options`, CSP or other security headers, choose one owner. Duplicate CSP headers are *intersected* by browsers, which can block more than intended.
5. **Moving CSP to enforcing:**
   - Open every screen as each role with maps, a custom style if one is used, login and refresh, and collect the console's report-only violations.
   - Optionally add a `report-to` endpoint.
   - Then rename the header to `Content-Security-Policy` (merging it with the enforced directives).
   - A custom map style that pulls tiles, glyphs or sprites from other hosts needs those origins added to `connect-src` and `img-src`.
   - A future vendor video SDK (GA-08) will need its script, media and connect origins.
6. **CSP is not a token fix.** With `'unsafe-inline'` scripts, the policy limits where data can be sent, but it doesn't stop injected inline script. Tokens stay readable from `sessionStorage` (GA-28) until the BFF issues an httpOnly refresh cookie.

**Files changed in this pass**

| File | Purpose |
|---|---|
| `src/features/drive-vision/access/access-policy.ts` | Action policy (GA-16), `reachableHref`, `profileMenuLinks` (GA-10), `menuNavStatus` (GA-14) |
| `src/features/drive-vision/access/use-access.ts` | `useCan` hook |
| `src/features/drive-vision/store/auth-store.ts` | `retryMenus()` (GA-14) |
| `src/components/drive-vision/app-shell/menu-load-error.tsx` (new) | Menu failure alert with Retry (GA-14) |
| `src/components/drive-vision/app-shell/app-shell.tsx` | Renders `MenuLoadError`; comment wording (GA-11) |
| `src/components/drive-vision/navigation/use-nav.ts` | Driver nav waits for menus; error fallback limited to policy screens (GA-14) |
| `src/components/drive-vision/app-shell/user-profile-menu.tsx` | Role-aware links; demo item removed (GA-10, GA-11) |
| `src/components/drive-vision/app-shell/sidebar.tsx`, `mobile-nav.tsx` | Demo notice and "About this demo" removed (GA-11) |
| `src/components/drive-vision/app-shell/search-model.ts` | Driver mapping in `notificationHref`, `notificationLink` (GA-12) |
| `src/components/drive-vision/app-shell/notification-center.tsx` | Role-aware links, access-filtered footer, no dead buttons, mark-read gating (GA-12, GA-16) |
| `src/components/drive-vision/operations/my-work-model.ts` | `tripActionAvailability`, `withheldTripReason` (GA-15) |
| `src/components/drive-vision/operations/my-work-page.tsx` | Fact-based trip actions, self-service gating, password panel on My Profile (GA-13, GA-15, GA-16) |
| `src/components/drive-vision/settings/settings-page.tsx` | `PasswordPanel` exported; settings and password gating; wording (GA-11, GA-13, GA-16) |
| `src/components/drive-vision/drivers/drivers-page.tsx`, `operations/dispatch-page.tsx`, `operations/workforce-page.tsx`, `alerts/incidents.tsx`, `geofences/geofences-page.tsx`, `video/video-workspace.tsx`, `users/users-page.tsx` | Write entry points behind `useCan` (GA-16) |
| `src/components/drive-vision/vehicles/vehicle-detail.tsx`, `src/app/layout.tsx`, `package.json` | Outdated wording (GA-11) |
| `src/config/security-headers.ts` (new), `next.config.ts` | Security headers (GA-04) |
| `tests/final-audit-fixes.test.cjs` (new) | 21 regression tests |

**Unchanged and still open:**

- GA-01, GA-02: server-side isolation tests. These are read-only and are the next step.
- GA-03: role mapping; Fleet Owner stays disabled.
- GA-05: write verification.
- GA-07: browser and responsive pass. Every fix above needs it too.
- GA-08, GA-17 and later items.

---

## 14. Security verification — GA-01 / GA-02 (2026-10-31)

### 14.1 GA-02 — Fleet Owner tenant isolation: **BLOCKED (missing authorized test accounts)**

- **Prerequisite check:** the user confirmed on 2026-10-31 that there are **no two confirmed Fleet Owner accounts in separate organizations**.
- **Role mapping:** there is still no confirmed Fleet Owner role. The backend roles are `MANAGER` ("Fleet manager") and `ADMIN` ("Full tenant administration"); neither is mapped (GA-03, Q1). Only one tenant (`DEMO-TENANT-01`) has ever been used.
- **Per the instructions, nothing was done.** No account was created, no tenant assignment was changed, and no request was sent for GA-02.
- **Frontend vs backend:** the frontend sends no tenant or organisation id. Isolation therefore rests entirely on the BFF scoping each request to the token's tenant, and that is unverified. Hiding records in the UI is not evidence of isolation.
- **To unblock:**
  - Two authorized accounts with the confirmed Fleet Owner role in two different tenants or organisations, each with at least one device, driver, alert and trip.
  - The confirmed role code (GA-03).
- **Then run:** the read-only cross-lookup plan from the task. Using B's token, `GET` A's resource ids on `/devices/{id}`, `/drivers/{id}`, `/alerts/{id}`, `/trips/{id}`, `/geofences/{id}`, `/users/{id}`, `/dispatches/{id}`, `/groups/{id}`, plus list endpoints filtered by A's ids. Then repeat in the other direction.

### 14.2 GA-01: Driver vs fleet API access. **PASS** (backend, for every GET endpoint tested)

**Session and method**

- **Session:** the user signed in as the Driver themselves in a Chrome tab on `http://localhost:3000` (`next dev`), on 2026-10-31. The agent entered no credentials.
- **Requests:** sent from that tab with its own session through `fetch`: GET only, sequential, with the same bearer token the app uses. No token, cookie or password was printed or stored. Only the status, request id, error code, item count and the ids of scope fields (`driverId`, `deviceId`, `userId`, `tenantId`) were extracted. No names, phone numbers or response bodies were recorded.
- **Not sent:** any POST, PUT, PATCH or DELETE, any refresh or logout, and any write.
- **Skipped as possibly state-changing:** `GET /video/sdk-token` (issues a vendor token), `GET /devices/{id}/passthrough-data` (live vendor query) and `GET /commands/{id}?refresh=true`.

**Driver identity**, which every result is compared against:

| Request | Status | Request id | Observed |
|---|---|---|---|
| `GET /me` | 200 | `f1ec366f-3dd7-4f8f-9800-28602c04c556` | role `DRIVER`, user 469, tenant 1, permissions `driver.app` + `own.data.read` |
| `GET /driver/me` | 200 | `f1d5c138-8476-482e-b796-903ff707d491` | driver 213, linked user 469 |
| `GET /driver/assignment` | 200 | `8507dc99-3ee3-4092-80a3-092fe473049d` | current vehicle: device 993 |

The ids used for other-record lookups come from earlier Admin evidence in the same tenant: device 1, driver 1, alert 1, trip 1, user 71, command 1. The Driver's own ids (device 993, driver 213, user 469) were also tried on the fleet endpoints.

**Fleet-level endpoints: 78 of 78 → `403 FORBIDDEN` "Access denied", no `data` in any response.**

Expected result: denial, because the role carries only `driver.app` and `own.data.read`.

| Area | Endpoint (GET) and request id |
|---|---|
| Devices | `/devices` `5f474f89-d509-48bb-aa1d-a6a718a16aab` · `/devices/1` `bede0c5d-7663-41e0-884a-f09e8c128f0a` · `/devices/993` (own vehicle) `7eaff4ac-2eb5-472f-a753-0d47b090b14a` · `/devices/1/driver-assignments` `dec8d80f-b7ac-4622-9b32-cbcd855ba8ff` · `/devices/1/event-markers` `f63153c5-d083-48de-8d3b-444839e25b9a` · `/devices/1/recording-calendar` `1425e5e3-1388-4369-9877-219c1d3cbe6f` · `/devices/1/recordings` `9d372e5d-5d2e-435c-b87e-b5c6431a9980` · `/devices/1/summary` `94679730-8e20-4612-8388-7c70b367ab54` · `/devices/1/track` `8a7ae6cc-3337-4501-b3c9-67fe73823a32` |
| Drivers | `/drivers` `9798f84e-5dda-4fd7-96e9-49759b1fa354` · `/drivers/1` `59e8beaa-2b80-4432-9f92-bae8c9c939ac` · `/drivers/213` (self) `203e8c97-df81-489d-8b02-37b46271b52b` · `/drivers/1/assignments` `92f379bc-15ca-4a58-822c-9e5ed94b127b` · `/drivers/1/safety-events` `9e800824-0c52-4cfe-b619-efb1e2470dde` · `/drivers/1/safety-score` `1492b316-b0bb-4160-8f18-08e230421a97` · `/drivers/availability` `75b389f9-9c70-4364-b5c8-abd7ee71eee5` · `/drivers/licence-expiries` `3c6cc89f-4c55-4ea6-b809-3e9f9e0f75c6` |
| Alerts / alarms | `/alerts` `d510d33c-3ead-4f4a-ba60-e97c6577fbd4` · `/alerts/1` `c056c04f-3ecc-40cf-9471-b93c84817726` · `/alerts/1/actions` `6a3f94e8-6267-4300-bf78-40173e3ae03b` · `/alerts/1/evidence` `05d8a86f-d94e-4e09-807e-5aab9fce3045` · `/alarms/ai` `6937f832-fb13-49f4-8467-bd5832b8141c` · `/alarms/routine` `9fea988e-97e2-4c0c-9dee-7bf2ad8494e4` · `/alarms/routine/recent` `d7fa098e-98fa-4c41-aca0-12bc28b4edb9` |
| Users / org | `/users` `3a62ae15-a23c-46de-995a-db9e7dd3271f` · `/users/71` `fc2cf25f-1891-4e26-b7ee-41143904681b` · `/users/469` (self) `0bc98b42-4e75-420d-aaad-7f9d5798374f` · `/users/tree` `8fb3bc3a-00eb-4a3c-9b8c-a18ea8799ca8` · `/roles` `1f4af671-7bb8-4b1d-8c61-7fd0741e0c78` · `/roles/1` `6ffa6fd8-7617-429c-a6ba-822898874771` · `/permissions` `ff993d0b-7b31-4489-bb88-6da01fd6f9d7` · `/menus` `6ce08afd-c67e-485b-adcd-7ceae3e8b747` · `/menus/18` `d134b778-db0f-44fe-86aa-55544cf15a5d` · `/groups` `6f7959db-b748-47a3-ae51-e620d24eed64` · `/groups/1` `9df72c01-b97d-4327-93dd-dbfdbec5623c` |
| Trips | `/trips` `9312abdd-37cc-4f06-b250-ea294780ae5c` · `/trips/1` `687cbd9e-8787-4bad-ad8a-90a8e5638820` · `/trips/1/route` `50319e86-cb0e-4a2d-8502-0fe1c7fa7241` · `/trips/summary` `b1c5b823-8a7c-4ac8-853e-c45e18ca2fb1` |
| Dispatch / workforce | `/dispatches` `4269b023-0db1-43f2-8d43-4a755d84a5bc` · `/dispatches/conflicts` `f3a00508-643f-4297-8290-036cf218fd30` · `/swap-requests` `2bf2e255-35fd-40a7-8699-827441d24232` · `/leave-requests` `c3cbcc02-15f1-422a-929a-a2aecbd1b701` · `/shifts` `5d69368e-db7d-4e3a-b03b-2a70dfb8fa6d` · `/checklists` `8d750c9c-bbaf-4430-82f5-6ca59de5a569` · `/checklist-template` `3cda7864-5469-49a9-b9ab-72856ce5b57e` |
| Dashboard / monitoring | `/dashboard/overview` `1ed452c9-7f33-4b94-9d0b-0a57872244d5` · `/dashboard/fleet-status` `75f3534a-958f-49c2-98de-ab70d9a76b30` · `/dashboard/trends` `3f333250-9ee1-4668-8e18-35d9633b323c` · `/dashboard/safety-events` `bcde07c8-5b75-424d-9ff5-3f78779a6d16` · `/dashboard/vehicles` `b1a0508b-8f98-4005-a3a2-46c374e57490` · `/dashboard/device-health` `f74f65a0-7a86-4e02-8fa8-f14c65d30dbc` · `/dashboard/active-trips` `4bba6d0b-9824-478e-8130-c27fb19109c6` · `/monitor/realtime` `baccc570-59d6-4b8b-85be-956a6cb9de51` |
| Geofences | `/geofences` `5f2090b2-657f-405a-b70a-4d702cb20f77` · `/geofences/1` `7af559fc-9705-42cd-94be-c1c629901192` · `/geofences/events` `c775d4af-3085-4f7f-9093-e7d23cae0e9f` · `/geofences/events/summary` `4b47ca05-448d-4df7-920d-03172c42a2d6` |
| Reports / safety | `/reports/mileage` `e79ecc6b-3f25-4bb1-bbfc-a8249f74cc22` · `/reports/driving` `4a2b2d00-2ebb-4b03-830e-4ceeca8f0e4e` · `/reports/parking` `b72c96c9-2e6f-42ed-988d-edd0af81d934` · `/reports/media` `99fffa17-ac52-4a6c-a496-ca9e0514d880` · `/safety/analytics` `fbfc9929-148b-442d-97d3-bc4b84b48dcd` · `/safety/scores/drivers` `55770f64-acad-4051-bc63-fcd207799c61` · `/safety/scores/vehicles` `fd73ffe2-9b30-4c29-9f23-f5edf4627f97` |
| Commands / video | `/commands` `14d32911-c11f-4574-8211-f0386397083e` · `/commands/types` `8be89243-eec8-4367-815f-f36f581b2842` · `/commands/1` `a44bec8e-a505-450d-977a-1f12ab299927` · `/video/exports` `91dd9971-22fb-48ec-b61b-6085d8b41970` · `/video/exports/1` `71429c7a-18c9-4309-a8d1-da5d25148c12` |
| Search / assistant / vendor | `/search?q=Demo` `4608bec1-bbe1-47d2-be36-52feb4b012eb` · `/assistant/prompts` `81184856-90b0-4bcf-9b47-a4ed8edd89da` · `/vendor-users` `5bc2cc48-33bd-4113-9e10-7c55bff012d4` · `/vendor-users/current` `3bc0e8f3-7a45-4bde-a141-7112290d130d` · `/vendor-users/1` `7daec276-6427-4661-8108-195463da8343` · `/renewals` `525a6539-697a-4d71-8845-299998b22657` · `/voices` `e2346a2d-2d6c-4414-b694-5df332bf38ac` · `/voices/fence` `9742f6cf-d605-453c-9102-0948e9d13c47` |

What the 403s show:

- The denial is identical for the Driver's own records (`/devices/993`, `/drivers/213`, `/users/469`) and for other records. The fleet endpoints therefore don't reveal whether an id exists, and the Driver gets nothing through the fleet API, not even their own data. The Driver uses `/driver/*` instead.
- `/commands/1`, which returns 500 for Admin (#28), returns a clean 403 for the Driver, so authorization is checked before the defective handler runs.

**Endpoints that returned data, all scoped or non-personal:**

| Endpoint (GET) | Status | Request id | Data scope observed |
|---|---|---|---|
| `/driver/dispatches` (30 d back → 14 d ahead) | 200 | `3e7e9621-8146-4034-8165-aa0edf9c4d8c`, re-read `ed1db2f7-79d9-4002-a24d-775a6bad1a70` | 3 rows (ids 67, 68, 69); every row driver 213 / user 469 / device 993 |
| `/driver/dispatches/67` (own) | 200 | `ca3b261e-64d7-46e0-8e15-5fea354844ce` | driver 213 |
| `/driver/dispatches/{1, 2, 66, 70}` (not in the Driver's list) | 404 `NOT_FOUND` "Dispatch not found" | id 1 `2730af3b-3e4a-405b-afad-3e75ad189314`, id 2 `ff6b0295-e7d1-4c0c-9afe-e157192355e4`, id 66 `516f6985-b328-4879-8ae5-db6efde07011`, id 70 `59b7d61b-db51-4989-b627-3fa9777e7733` | No data. Whether these ids exist for another driver is unknown from a Driver session, so this shows "no leak", not "ownership check proven". |
| `/driver/safety-events` | 200 | `de240c00-6810-48db-b48a-04a7795b895a`, 90 d `690a73ae-d097-4ba7-8a64-eab285fbaf4d` | ids 151, 153; driver 213 / device 993 only |
| `/driver/leave-requests` | 200 | `eb100764-5db6-44af-82e9-7c8a2d3b89e0`, re-read `1c790db5-8c5d-4797-b021-4cdcb253c1c5` | 3 rows; driver 213 only |
| `/driver/checklists` | 200 | `ff713f22-a838-4933-965f-9adc3b762954` | 3 rows; no foreign driver, device or user id |
| `/notifications` | 200 | `b19271cc-38bf-45c9-a7fd-8835178d8967`, re-read `23b79f90-4a57-4d88-bb35-66f4cf776324` | 4 items. Every reference resolves to the Driver's own records: ALARM 151 (own safety event), DISPATCH 68 and 69 (own trips), LEAVE (no `refId`). |
| `/notifications/unread-count` | 200 | `d1110b9c-3252-4a02-be2f-31b5cf2d5466` | One count object |
| `/reference/alarm-types`, `/device-models`, `/object-types`, `/protocols` | 200 | `b3aeb10a-5de6-4edd-a002-3829d4294fab`, `43ca20f0-54b1-4614-8027-2dabf79b4f7c`, `eb712747-a4fc-412e-88e4-226eb700dfae`, `8834e1bd-6ea1-4a0d-99fb-745f35bdbd0c` | Global vendor catalogues (170, 100, 19 and 5 rows). They contain no tenant, driver, device or user ids. Not personal or organisation data. |

Other observation: `/driver/dispatches` with a 120-day window → `400 INVALID_VALUE` "The time range may not exceed 92 days" (`89999401-ebc6-40ac-9c86-27b9d0ffffd1`). This is an undocumented limit. The app requests 15 days, so it isn't affected.

**GA-01 verdict: PASS.**

- No fleet-wide, other-driver, other-vehicle, alert or organisation data was returned to the Driver token by any of the 78 fleet endpoints.
- Every `/driver/*` and `/notifications` response contained only the Driver's own records.
- The only remaining limit is the one in the 404 note: the Driver session can't confirm that the probed dispatch ids belong to other drivers. A cross-driver id test would need a second Driver account, or ids supplied by an admin.

### 14.3 Frontend route protection with the Driver session (browser-verified 2026-10-31)

This is separate from §14.2. These checks show what the UI renders, not what the API allows.

| Check | Result |
|---|---|
| Navigation | Only the six `/me/menus` driver items (My Work, My Shifts, My Leave, Shift Checklist, My Safety, My Profile). No fleet entry, and no "About this demo" button (GA-11). |
| Direct URLs `/drive-vision/drivers`, `/users`, `/alerts?kind=incidents`, `/vehicles/1`, `/settings`, `/workforce?tab=leave`, `/monitoring` | Each one: "You don't have access to this page · Role: DRIVER" with "Go to My Work". The only API calls on those pages were `/me`, `/me/menus` and `/notifications/unread-count`. **No fleet API request was sent and no protected data was displayed.** |
| `/drive-vision/overview` | Redirected to `/drive-vision/my-work` (landing redirect). |
| GA-10 profile menu | Contains only "Sign out". |
| GA-12 notifications | The two DISPATCH items are clickable (they open My Work). The ALARM item and the LEAVE item (null `refId`) are plain text. There is no "Open Alerts & Events" footer. Mark read and Mark all read are present (driver `notifications.markRead`). Nothing was clicked except opening and closing the panel. |
| GA-13 | My Profile shows a "Change password" panel (3 password fields). **Not submitted.** |
| GA-14 | No menu-error banner (menus loaded). The failure path wasn't simulated. |
| GA-15 | Started trips offer only "Complete trip", with "This trip has already started." One trip also shows "A swap request for this trip is already pending." No action was clicked. |
| Admin → driver-only routes | **Not re-checked in this pass.** The user asked for the GA-01 checks only, and no Admin session was used. The last browser evidence is from 2026-10-29: Admin was denied all six `/my-work*` routes with 0 `/driver/*` requests (`phase3-new-api-integration.md`). It is also covered by unit tests. |
| Viewports | Desktop only (1707 px wide). The responsive pass (GA-07) is still open. |

### 14.4 Status after this pass

| ID | Status |
|---|---|
| GA-01 | **PASS: backend-verified** for the Driver role on 78 fleet GET endpoints (all 403) and 10 own-scope or catalogue endpoints. The cross-driver id check is limited as described above. |
| GA-02 | **BLOCKED:** no two authorized Fleet Owner accounts in separate organizations (§14.1). |
| GA-10, GA-12, GA-15 (Driver) | Now also **browser-verified** for the Driver at desktop width. |
| GA-13 | Panel browser-verified as shown. The endpoint is still not backend-verified for DRIVER: nothing was submitted. |
| Defects found | **None.** No application code was changed in this pass. |

The Driver session was left as it was. Logout is a POST, so it wasn't sent. The agent's tab was closed after the checks, and the session's tokens expire on their own.

---

## 15. GA-07 responsive verification and GA-04 CSP report-only review (browser, 2026-10-31)

**No application code was changed in this pass.** This section is a findings report; nothing has been fixed yet, pending review.

### 15.1 Method and limits

- **Sessions:** the user signed in themselves as **Driver** and as **Admin**, in two Chrome tabs on `http://localhost:3000` (`next dev`). The agent entered no credentials.
- **Requests:** the agent sent only GETs, all from page loads. The user approved `POST /auth/refresh` for normal session renewal; whether the app actually renewed a token during the run wasn't recorded. No other POST, PUT, PATCH or DELETE was sent. There was no logout, and no account, data or setting change.
- **Viewport emulation:** Chrome won't make a window narrower than its minimum, so each route was loaded in a **same-origin iframe** inside the signed-in tab. The iframe shares that tab's session and was sized to the target viewport. For 320–768 px the frame was widened by the scrollbar width, so the page's layout width equals the target, as on a phone with overlay scrollbars. 1024 and 1440 keep a desktop scrollbar (layout width 1004 and 1420–1440).
  - The display scaling is 1.125, so 375 px came out as **376** (±1 px). The other widths are exact.
- **Measured at each viewport:**
  - Horizontal document overflow, and visible elements outside the viewport that aren't clipped by a scroll container.
  - Overlapping interactive elements.
  - Controls whose content is actually clipped.
  - Touch targets under 24 px at ≤ 768 px.
  - Smallest visible font.
  - Navigation mode: menu button below 768 px, rail from 768 px.
  - Every automated flag was then checked by hand, with on-top hit-testing, re-measurement or a screenshot.
- **Rail state:** the browser's saved display preference had the **navigation rail expanded** (228 px). It is shared by both tabs, and the agent didn't change it, so the **collapsed rail wasn't tested**.
- **Not covered:**
  - Dialogs, drawers and slide-overs (except the mobile navigation drawer), the assistant panel and form submission. Every route was checked in its default state only.
  - Real devices, touch emulation and the production build.
- **Evidence:** screenshots are in `docs/evidence/screenshots/ga07/`. They show the dev tenant's test data (a test driver's truncated name, a vehicle plate, `[SAMPLE]` records).

### 15.2 Driver screens: **no defect at any viewport** (browser-verified)

Routes: `/drive-vision/my-work`, `/my-work/shifts`, `/my-work/leave`, `/my-work/checklist`, `/my-work/safety`, `/my-work/profile`. Viewports: 320×640, 375×812, 390×844, 768×1024, 1024×768, 1440×900 (36 combinations).

| Check | Result (all 36) |
|---|---|
| Horizontal overflow | 0 px |
| Elements outside the viewport | 0 |
| Overlapping controls | 0 |
| Clipped controls | 0 |
| Touch targets < 24 px (≤ 768 px) | 0 |
| Smallest visible text | 11 px (one exception: the decorative 10 px bell badge, hidden from screen readers next to an accessible label) |
| Navigation | Menu button < 768 px; rail ≥ 768 px |

At 320 px, the mobile drawer lists the six driver items as 269×40 px targets, with no demo notice (`driver-mobile-nav-320.png`). On My Work, the trip card shows only "Complete trip" plus its withheld reason (`driver-my-work-320-trip-actions.png`).

### 15.3 Admin screens: no horizontal overflow anywhere; six defects (two P2, four P3)

Routes (16): `/overview`, `/monitoring`, `/video`, `/trips`, `/reports`, `/vehicles`, `/vehicles/1`, `/drivers`, `/dispatch`, `/workforce`, `/alerts`, `/safety`, `/geofences`, `/devices/commands`, `/users`, `/settings` (96 combinations).

**Horizontal overflow: 0 px**, and nothing off-screen, on every route at every viewport.

**Defects found:**

| ID | Pri | Route | Viewport | Defect | Evidence | File(s) |
|---|---|---|---|---|---|---|
| R1 | **P2** | `/drive-vision/vehicles` | 375×812, 390×844 (and 340) | In the filter row, the search field's wrapper collapses to 4 px, but the input stays 78 px wide and spills over the **"All groups"** select. The input is on top (hit-test), so the left 31 px at 375, 16 px at 390 and 66 px at 340 of the group filter **can't be clicked**, and its label shows only "ps". At 320 px the row wraps and is fine. This is the same pattern already fixed on Users in phase 1B. | `admin-vehicles-filter-overlap-340.png`; harness overlap `input "Search vehicles" ⨯ button "Group"` | `src/components/drive-vision/vehicles/vehicles-page.tsx` (filter bar), `shared/filter-bar.tsx` |
| R2 | **P2** | `/drive-vision/monitoring`, `/drive-vision/geofences` | 320×640 | The map attribution wraps to two lines (44 px), and **"© OpenStreetMap contributors" is partly hidden behind the "MapTiler" logo button** (61×19 px overlap). OpenStreetMap's licence requires visible attribution. From 375 px up it fits on one line (24 px), with no overlap. Trips draws no map until a trip is selected, so it wasn't measured. | `admin-map-attribution-overlap-320.png`, `admin-geofences-320-map.png` | `src/components/drive-vision/map/geo-map.tsx` (logo link and data chip overlay vs MapLibre attribution control) |
| R3 | P3 | All Admin routes | 1024×768 (expanded rail) | The rail's navigation pill needs 643 px but only 596 px are available, so **"Settings" is hidden until the rail is scrolled**. The code comment says the pill only scrolls below about 540 px of viewport height. | Hit-test: the "Collapse" button is on top where "Settings" would be; the pill's `scrollHeight` 643 > `clientHeight` 596 | `src/components/drive-vision/app-shell/sidebar.tsx` |
| R4 | P3 (unconfirmed on a real device) | All routes; worst on `/vehicles` | Resizing across 768 px | When the width crosses the `md` breakpoint by **resizing** (a desktop window, or rotating a tablet), the rail appears immediately while the content's left padding catches up later. In the test frame it took about 0.3 s on Drivers and up to 3 s on Vehicles (no long tasks recorded), and content sat under the rail in between. A fresh load at any width is correct. Cause not established. | Padding sampled at 300/800/1500/3000 ms: 16, 16, 16, 260 px on Vehicles (2/2 trials) | `src/components/drive-vision/app-shell/app-shell.tsx` (`transition-[padding]` on `main`) |
| R5 | P3 | `/monitoring`, `/settings`, `/safety`, `/vehicles/1`, `/reports`, map routes | ≤ 768 px | **Touch targets under 24 px:** <br>• on/off switches 32×18 px (Monitoring 2, Settings up to 11); <br>• Safety score-table name links 20 px tall (10–22 per width); <br>• Vehicle detail inline links (breadcrumb 20 px, "All trips" 16 px, driver link 16 px, a **5×16 px link "1"**); <br>• Reports sortable "Distance" header 18 px; <br>• map attribution links 13 px. | Harness `smallSamples` | `components/ui/switch.tsx`, `safety/safety-analytics.tsx`, `vehicles/vehicle-detail.tsx`, `shared/data-table.tsx`, `map/geo-map.tsx` |
| R6 | P3 | `/overview`, `/monitoring`, `/geofences` | All | Text below 11 px: the Overview card labels ("Devices", "Events", "Distance") and the map legend chips / MapTiler pill are 10.5 px. | Harness `tinySamples` | `dashboard/fleet-overview.tsx`, `map/geo-map.tsx`, `monitoring/live-monitoring.tsx` |

**Driver UX notes (P3, not layout defects):**
- At 320 px the identity strip shortens the driver's own name to "Satis…" because the status badges take the space.
- Trip titles are cut to one line on mobile.
- An in-progress trip appears both as "Current trip" and under "Upcoming trips" (`driver-my-work-320-top.png`, `driver-my-work-320-trip-actions.png`).

**Flags investigated and rejected as false positives:**

| Flag | Why rejected |
|---|---|
| "Skip to content" link | Screen-reader-only by design |
| Notification bell "clipped" | The unread badge is positioned outside the button on purpose |
| Floating Iris button over cards, inputs and list items (Overview, Settings, Geofences, Monitoring) | Scrolled to the end, it covers **0** controls on every affected route: it's a floating button, and the page leaves `pb-28` clearance |
| Geofence list items over the map's zoom buttons at 320 px | The items are clipped inside their own scroll list; hit-test puts "Zoom in" on top (`admin-geofences-320-map.png`) |
| "Settings" ⨯ "Collapse navigation" at 1024 px | The link is clipped by the rail pill (see R3 for the real issue) |
| First-run overlaps at 768 px on 9 screens | Measured mid-transition. A second measurement at the same width after 1 s gave 0 on every route except Vehicles. The first run had also overlapped with the Driver CSP pass. |
| Settings input "clipped" at 320 px | A text input whose value is longer than the box; normal input behaviour |

### 15.4 GA-04: CSP report-only review (browser, `next dev`)

- **Method:**
  - A `securitypolicyviolation` listener was attached to each framed document while it was still `loading`.
  - After each route, a **control violation** was triggered: a `fetch` to `https://example.invalid/csp-control`, outside `connect-src`. That domain can never resolve, so nothing is sent.
  - A route's result counts only if its control was caught.
- **Two methods were tried first and rejected:**
  - `ReportingObserver` (buffered) didn't receive the control violation.
  - The extension's console reader doesn't capture the browser's own CSP messages.
  - Results from both attempts were discarded.
- **Result: 0 violations on 23 routes:** the 6 Driver routes, `/login`, and the 16 Admin routes. That includes Live Monitoring and Geofences with MapTiler tiles, glyphs, sprites and the MapLibre worker. The control was caught on all 23.
- **Not covered:**
  - The **production** policy (no `'unsafe-eval'`, no `ws:`). This was the dev server.
  - Interactions after load: drawers, track playback, the alert-evidence mini map, video export, the assistant.
  - A custom `NEXT_PUBLIC_MAP_STYLE_URL`.
- **Recommendation:** do not enforce yet. First repeat this pass against `next build && next start` with the production environment, including the interactive flows above. Then follow the §13 deployment notes.

### 15.5 Other items

- **GA-13: pending backend confirmation.** Whether `DRIVER` may call `POST /me/password` is unconfirmed. The panel is shown on My Profile and has been seen in the browser (§14.3). It has never been submitted, and it won't be without an approved test.
- **GA-05: write tests remain disabled.** No write was sent in this pass.
- **GA-02: still BLOCKED** (§14.1).

### 15.6 Status

| ID | Status after this pass |
|---|---|
| GA-07 Driver | **Browser-verified, no defects** at all six viewports (default state, expanded rail) |
| GA-07 Admin | **Browser-verified, with defects R1–R6.** No overflow anywhere. **Not fixed yet**: awaiting review. |
| GA-04 | Report-only CSP: **0 violations on 23 routes** (dev server, default states). Enforcement **not** recommended until a production-build pass. |
| GA-13 | Pending backend confirmation |
| GA-05 | Disabled |

---

## 16. GA-07 R1 and R2: fixes and re-verification (2026-10-31)

Approved scope: **R1 and R2 only.** R3–R6 are unchanged and remain open (§15.3).

### 16.1 Changes

| ID | File | Change |
|---|---|---|
| R1 | `src/components/drive-vision/vehicles/vehicles-page.tsx` | Below `sm`, the Vehicles filter bar uses the pattern already proven on Users (phase 1B): the bar is full width (`max-sm:w-full`), the search box takes its own row (`max-sm:basis-full`), and the two selects share the next row (`max-sm:flex-1`). No change from `sm` up. **Root cause:** the search wrapper is `flex-1 min-w-0` with a 0 basis, so it collapsed to 4 px, while the input's own padding (≈ 78 px) spilled over the "All groups" select. |
| R2 | `src/components/drive-vision/map/geo-map.tsx` | (1) `attributionControl: { compact: false }`. In the installed MapLibre 6, compact mode removes `maplibregl-compact-show` on the map's first `drag`, collapsing the credit to an "i" button. (2) The attribution's fixed `bottom: 40px` is replaced by the caption row's **measured** height through a `ResizeObserver`, so the credit always sits above that row, even when it wraps to two lines on narrow maps. The full credit text is unchanged; nothing is hidden. |
| R2 | `src/components/drive-vision/map/base-map-config.ts` | New pure helper `attributionBottom(captionHeight)` = 12 px inset + caption height + 6 px gap. A one-line caption (22 px) gives the previous 40 px. |
| Tests | `tests/final-audit-fixes.test.cjs` | 3 regression tests: R1 classes; R2 offset maths including invalid input; R2 non-compact control and `ResizeObserver` use. |

`GeoMap` is shared, so the R2 change also applies to the Trips map and the alert-evidence mini map. Neither was browser-checked in this pass: Trips shows no map until a trip is selected, and the mini map opens in a drawer.

### 16.2 Browser re-verification (Admin, `next dev`)

The user signed in as Admin. GET requests only, no clicks on controls that write data, and same-origin frames at exact widths (§15.1). The Driver screens weren't re-tested: no Driver route imports `vehicles-page.tsx`, `geo-map.tsx` or `base-map-config.ts` (checked by search), so their §15.2 results stand.

**R1, `/drive-vision/vehicles`: before (§15.3) → after**

| Width | Before | After |
|---|---|---|
| 320 | wrapped, no overlap | 3 rows (search; each select full width), **0 overlaps**, both selects fully clickable, no overflow |
| 340 | input spilled 66 px over "All groups" (hit-test: input on top) | 2 rows: search 308 px; "All groups" 150 px and "Any expiry" 150 px share row 2. **0 overlaps, fully clickable.** |
| 375 | 31 px overlap | 2 rows: search 343 px; selects 168 + 168 px. **0 overlaps, fully clickable.** |
| 390 | 16 px overlap | 2 rows: search 358 px; selects 175 + 175 px. **0 overlaps, fully clickable.** |
| 768 / 1024 / 1440 | one row, fine | One row, unchanged (search 188/234/234 px, selects 144 px each). **0 overlaps.** |

"Fully clickable" means the select itself is on top at its left edge, centre and right edge. Horizontal overflow was 0 at every width. Screenshot: `after-admin-vehicles-filter-375.png` (device ID and initials redacted).

**R2, `/drive-vision/monitoring` and `/drive-vision/geofences`: before → after**

| Check | Before (320 px) | After (320, 375, 390, 768, 1024, 1440; both routes) |
|---|---|---|
| Attribution vs MapTiler logo | 61×19 px overlap; "contributors" hidden | **No overlap** at any width |
| Attribution vs caption row | Upper caption line overlapped the credit | **No overlap**; 6 px gap above the caption row at every width |
| Credit text | Two lines, partly covered | "© MapTiler © OpenStreetMap contributors" on **one line** (20 px tall, e.g. x 60–295 at 320 px) |
| Hit-test on both credit links (scrolled into view) | Logo on top of part of the OSM link | Both links on top at left, centre and right |
| After a simulated map drag (`dragstart`/`drag`/`dragend` fired on the map) | Compact mode would collapse the credit to an "i" button | Not compact, credit still visible |
| Horizontal overflow | 0 | 0 |

The first hit-test pass reported misses at 320 px on both routes and at 375 px on Geofences. That was a test artifact: the credit was below the frame's visible area, and hit-testing returns nothing for off-screen points. With the credit scrolled into view every point passed.

Screenshots: `after-admin-geofences-map-320.png` and `after-admin-map-attribution-320-closeup.png`.

**During the re-test**, one frame load of `/drive-vision/geofences` hit a slow BFF. The app showed its session-error state ("The server took too long to respond"); the agent did not press Sign out. A plain reload (GET) recovered it. This is backend responsiveness, unrelated to this change, and the error state behaved as designed.

### 16.3 Automated checks after the fixes

| Check | Result |
|---|---|
| `npm run typecheck` | Pass (`tsc` exit 0) |
| `npm run lint` | Pass |
| `npm test` | **220/220 pass** (217 + 3 new) |
| `npm run build` | Pass; 29 static pages generated |

### 16.4 Screenshot review before commit

All ten screenshots in `docs/evidence/screenshots/ga07/` were reviewed.

**Redacted** in place with solid boxes, using `sharp` from the project's dependencies. Unredacted originals exist only in the browser tool's temp folder, outside the repository.

| File | Covered |
|---|---|
| `driver-my-work-320-top.png` | Driver name, email, initials; vehicle plate; header initial |
| `driver-my-work-320-trip-actions.png` | Vehicle plate (×2); header initial |
| `admin-vehicles-filter-overlap-340.png` | Device / terminal ID |
| `after-admin-vehicles-filter-375.png` | Device / terminal ID; header initials |

**Kept as is**: no driver or vehicle data, only navigation, `[SAMPLE]` geofence names, the map and its credit.

- `driver-mobile-nav-320.png`
- `admin-geofences-320-top.png`
- `admin-geofences-320-map.png`
- `admin-map-attribution-overlap-320.png`
- `after-admin-geofences-map-320.png`
- `after-admin-map-attribution-320-closeup.png`

### 16.5 Status

| ID | Status |
|---|---|
| R1 | **Fixed**. Browser-verified at 320/340/375/390/768/1024/1440, plus automated tests. |
| R2 | **Fixed** on `/monitoring` and `/geofences`. Browser-verified at all six widths, plus automated tests. Trips and alert mini maps not browser-checked. |
| R3–R6 | Open (not in scope) |
