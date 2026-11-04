# SafeFare AI — Project audit (Phase 0, V10)

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` · Working tree clean at start.
Scope: the whole Next.js frontend, read against the **V10** Spring Boot BFF spec.
Method: static reading of `src/`, `tests/`, `docs/`, config; a scripted scan of every BFF call site matched against the spec; a scripted contract diff between the previous spec (2026-10-29) and V10; baseline checks. **No browser session and no authenticated API call were made in this phase** — every "observed live" statement below is quoted from earlier evidence files, not re-tested.

Companion documents: [`current-architecture.md`](current-architecture.md) · [`v10-api-inventory.md`](v10-api-inventory.md) · [`implementation-roadmap.md`](implementation-roadmap.md). Earlier docs (`feature-status.md`, `missing-backend-apis.md`, `api-inventory.md`, `evidence/*`) remain valid history for the 2026-10-29 spec and are not modified.

---

## 1. The V10 spec

| | Expected (brief) | Verified |
|---|---|---|
| Source | "latest V10 Swagger" | Not in the repo. The only spec in the repo was `docs/openapi/api-docs-2026-10-29.json` (135 paths / 172 ops / 224 schemas). V10 was fetched read-only from the dev BFF, `GET http://185.193.19.156:9096/v3/api-docs` (unauthenticated, 200), and saved as **`docs/openapi/api-docs-v10.json`** (new file; the old spec is kept — `tests/operations-api.test.cjs` loads it). |
| Paths | 164 | **164** ✓ |
| Operations | 220 | **220** ✓ |
| Schemas | 297 | **297** ✓ |

**Diff 2026-10-29 → V10:** 48 operations added, **0 removed**. 64 existing operations changed, all **additive or tightening** (status strings became enums, new fields such as `platform`, `fullAccess`, `tenantId`, `activeUsers`, `scope`, `stepNo`). Two changes matter to the frontend:

1. `LoginRequest.tenantCode` is **no longer required** (Safe-Fare Admin signs in without it).
2. `PUT /roles/{id}/permissions` now returns `RolePermissionsDto` instead of `RoleDto` (not used by the frontend today).

V10 also documents, for the first time, a **required permission per operation** (69 distinct codes) and the tenant rules (`info.description`):
- Safe-Fare Admin has no tenant: writes need `?tenantId=` or `X-Tenant-Id`, else 400 `TENANT_REQUIRED`; **reads without it cover every tenant**.
- Tenant users may omit it; another tenant's id → 403 `TENANT_ACCESS_DENIED`; another tenant's record → 404.
- 218 / 220 operations accept the tenant selector (all except login and refresh).

**What the spec does *not* contain** (so it must come from the backend team, not be assumed): the role catalogue (no role code — `ADMIN`, `FLEET_OWNER`, `DISPATCHER`, `VIEWER`, `DRIVER` — appears anywhere in the spec), the `PLATFORM_ADMIN`/`SUPER_ADMIN` → `ADMIN` merge, the list of permission codes and their `scope` values, the `menuKey` catalogue, what `TenantSelectionDto.header` contains, whether `switch-tenant` has server-side state, and any property descriptions on DTOs.

---

## 2. What already works

Baseline on 2026-11-02 (this audit, unchanged code):

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass, 0 warnings |
| `npm test` (node:test) | ✅ **220 / 220** |
| `npm run build` (Next 16.4.2) | ✅ pass, 29 routes |

**Authentication** (`src/features/drive-vision/api/`) — solid, keep as is:
- `client.ts`: one typed fetch wrapper; bearer header; proactive refresh 30 s before expiry; one retry after 401; single-flight refresh per tab, serialised across tabs with Web Locks + BroadcastChannel hand-over (`session-sync.ts`); refresh never retried; timeouts via `AbortSignal.timeout`; envelope `code ≥ 400` treated as error; `X-Request-Id` captured; diagnostics never log bodies or tokens.
- `session.ts`: tokens in `sessionStorage` (tab-scoped), expiry from JWT `exp`. Known trade-off documented in-file (XSS-readable; httpOnly cookie needs a backend change).
- `auth-store.ts`: `unknown → authenticated | unauthenticated | error` state machine, `GET /me` boot validation, `GET /me/menus`, session-ended listener.
- Login / refresh / logout / `/me` previously verified live (see `feature-status.md`).

**Access control** (`src/features/drive-vision/access/access-policy.ts`) — pure, unit-tested, deny-by-default: screen grants, action grants, route decisions, nav filtering, driver menus from `/me/menus`, search-result filtering, landing redirect. `RouteGuard` keeps denied pages unmounted (no API calls).

**Screens** — 133 of 220 V10 operations have call sites, 127 of them reached from a screen (*Phase 1 correction: Phase 0 said 134 — a regex mis-match on `GET /geofences/{id}`; see `v10-compatibility-report.md`*) (full list with file references in `v10-api-inventory.md`). Per-screen status from the 2026-10-29 evidence, still valid because no used operation changed incompatibly:

| Screen | Status before V10 |
|---|---|
| Overview, Live Monitoring, Trips & Tracking, Reports, Safety Analytics, Geofences (read), Users (read), Global search, Drivers (read), Workforce (read), Dispatch (read), My Work (driver, read) | Integrated, read path verified live on 2026-10-26…29 |
| Alerts (incidents + handling), Notifications, Users writes, Drivers writes, Dispatch/Workforce writes, My Work writes, Video exports, Geofence delete | Integrated, **writes never sent** (no approved test tenant) |
| AI Assistant | Prompts verified; `ask` never sent |
| Device Commands | History/types verified; detail blocked by backend 500 (#28); sending disabled |
| Vehicles | Read verified; create/edit/delete not exposed (`/vehicles/new` shows "writes pending") |
| Historical Video playback | Not possible — vendor player/SDK not provided |

**Quality**: loading / empty / error states (`shared/api-states.tsx`), 503-as-unavailable handling, `extend.source`/`stale` freshness badges, confirmation dialogs for writes, no secrets in source, security headers (`src/config/security-headers.ts`), `.env*` git-ignored.

---

## 3. What conflicts with V10 (must fix before anything else)

| # | Conflict | Where | Effect |
|---|---|---|---|
| **C1** | Role mapping knows only `PLATFORM_ADMIN` and `DRIVER`. V10 merges `PLATFORM_ADMIN`/`SUPER_ADMIN` into `ADMIN`. | `access-policy.ts` `ACCESS_POLICY.roleCodes` | Every `ADMIN` user — Safe-Fare Admin **and** tenant ADMIN — resolves to app role `unknown` → zero screens → "No access for this account yet". *Predicted from code; not observed live in this audit.* |
| **C2** | Login form requires and always sends `tenantCode`. | `login-screen.tsx` `validate()` + `signIn({tenantCode, …})`; `types.ts` `LoginRequest.tenantCode: string` | Safe-Fare Admin cannot sign in at all. Sending `""` would also violate the brief ("omit entirely"). |
| **C3** | No tenant context anywhere: no `X-Tenant-Id`, no `tenantId`, no tenant store. | `client.ts` and all services | Safe-Fare Admin writes → 400 `TENANT_REQUIRED`. Safe-Fare Admin reads silently aggregate **all tenants** inside screens designed for one tenant (e.g. Users, Drivers, Overview), with no label saying so. |
| **C4** | Authorisation is role-code based, not permission based. `actionGrants` is empty; every action comes from `roleGrants`. `GET /me/permissions` (V10's identity + screens + operations source) is not called. | `access-policy.ts`, `use-access.ts`, `auth-store.ts` | Fleet Owner / Dispatcher / Viewer can never get access without code changes; operation-level buttons ignore the 69 V10 permission codes. |
| **C5** | `platform` flag ignored; `CurrentUserDto` type lacks it. | `types.ts`, everywhere | Can't tell Safe-Fare Admin from tenant ADMIN. |
| **C6** | Menu → route mapping uses `MenuNodeDto.routeKey`; V10 `MyScreenDto` (from `/me/permissions`) has `menuKey` + `routePath` and **no** `routeKey`. | `MENU_ROUTES`, `menuNavEntries` | Dynamic nav must be re-keyed by `menuKey` once the `menuKey` catalogue is known. `/me/menus` still exists, so driver nav keeps working meanwhile. |
| **C7** | DTO types are behind V10: `RoleDto` lacks `fullAccess`/`tenantId`/`activeUsers`; `PermissionDto` lacks `scope`; no types for `MyPermissionsDto`, `ScreenDto`, `TenantDto`, `TenantSelectionDto`, `PermissionMatrixDto`, `RolePermissionsDto`. | `types.ts` | Typing only; fields arrive at runtime but are invisible to TS. |
| **C8** | Contract tests load the 10-29 spec. | `tests/operations-api.test.cjs:11` | Tests can pass against an outdated contract. |

Non-conflicts checked: no endpoint the frontend calls was removed or renamed; no request body or parameter of a used operation changed; tightened enums are rendered as strings already.

---

## 4. Incomplete / needs enhancement

**Not integrated (87 operations without a call site; Phase 1 correction from 86).** All 48 V10 additions plus 39 older ones deliberately not exposed (incl. `GET /geofences/{id}`). Grouped:

| Area | Operations not integrated | Note |
|---|---|---|
| Identity / platform | `GET /me/permissions`, `GET /platform/tenants`, `POST /platform/switch-tenant` | Phases 2–5 |
| Roles & permissions | `GET/PUT/DELETE /roles/{id}`, `POST /roles`, `GET/PUT/POST/DELETE /roles/{id}/permissions`, `GET /roles/permission-matrix`, `POST /permissions`, `PUT/DELETE /permissions/{code}` | Phase 6 (only `GET /roles`, `GET /permissions` used) |
| Screens / menus admin | `GET /screens`, `GET /screens/{menuKey}/operations`, `PUT /menus/{id}/operations`, `GET/POST /menus`, `GET/PUT/DELETE /menus/{id}` | Phase 3/7 |
| New business modules | maintenance-reminders (7), alarm-rules (5), report-schedules (6), `GET /audit-logs`, `GET /assets/tree`, `GET /reference/statuses` | Phase 7 — no screens exist yet |
| New reads on existing screens | `/dashboard/fleet-health`, `/safety/heatmap`, `/safety/false-positives`, `/reports/idle`, `/reports/export`, `/alerts/{id}/high-priority-steps` (GET/POST), `/video/embed` | Phase 7 |
| Writes not exposed | trips `POST/PUT/DELETE`, devices `POST/PUT/DELETE/transfer`, groups `POST/PUT/DELETE`, geofences `POST/PUT`, `POST /commands`, `DELETE /users/{id}`, `POST /alerts/{id}/assign`, `PATCH /reference/alarm-types/{id}` | Previously blocked by undocumented semantics (`missing-backend-apis.md` #19, #22, #25, #26, #32) |
| Vendor / misc | vendor-users (6), renewals (2), voices `GET/POST`, push-tokens (3), `/video/sdk-token`, `/video/exports/{id}`, `/alarms/routine/recent`, `/devices/{id}/passthrough-data` | Out of scope or blocked (vendor coins, live vendor config, no SDK) |

**Screens missing entirely** (brief lists them, app has no route): Tenant Management, Roles / Permission matrix, Screen/Menu Management, Reference Data, Maintenance, Alarm rules, Report schedules, Audit log, Sub-account tree as its own screen (lives inside Users), Device Groups as its own screen (lives inside Vehicles), Live Video (only historical exists).

**Dead code (sample data, not mounted by any route):** `dashboard/activity-feed.tsx`, `dashboard/usage-ranking.tsx`, `monitoring/vehicle-details-panel.tsx`, `vehicles/vehicle-dialogs.tsx`, `vehicles/vehicle-form.tsx`, and their sources `store/fleet-store.ts`, `mock-data/seed.ts`, `services/*`, `hooks/use-live-simulation.ts`. They import `CURRENT_USER_ID`, mock users/groups and a fixed `DEMO_NOW` clock. No mounted screen renders sample records. Remaining live uses of `mock-data/catalog.ts` are label tables, the `DEMO_NOW` *default* argument of `ExpiryBadge` (all callers pass a real `now`), and decorative city outlines in the coordinate-grid map fallback (shown only when no MapTiler key is set). Removal is a cleanup candidate, not a correctness fix — kept untouched in Phase 0.

**Test gaps:** unit/model tests only (node:test with a TS loader and mocked fetch). No browser/e2e, no responsive tests, no live contract tests. Write paths have never been exercised against the BFF.

---

## 5. Hardcoded assumptions found

| Assumption | Location |
|---|---|
| `PLATFORM_ADMIN` role code (obsolete in V10) | `access-policy.ts:124`, comments, `docs/evidence/final-frontend-gap-audit.md` |
| `DRIVER` role code and `driver.app` permission | `access-policy.ts` — confirmed live 2026-10-29; still valid, but V10's documented driver permission on `/driver/**` is `own.data.read` |
| App roles `admin` / `fleet-owner` / `driver` / `unknown` | `AppRole` — no dispatcher/viewer; fleet-owner has no code |
| Internal action keys (`drivers.manage`, `users.manage`, …) granted by role, not by V10 codes | `ACTION_SCREENS`, `roleGrants` |
| Admin gets assistant + record search by role | `roleGrants.admin.features`; V10 says assistant needs `device.read` |
| `tenantCode` mandatory | login form + type |
| Single tenant per session | everywhere (no tenant context) |
| Mock `UserRole = "Admin" \| "Manager" \| "Driver"` | `types/index.ts` (dead-code type) |
| Static navigation (`NAV_GROUPS`) for every non-driver role | `nav-config.ts`, `use-nav.ts` |

No hardcoded user IDs, tenant IDs or tenant codes in live code (`CURRENT_USER_ID` only in dead code; `NEXT_PUBLIC_DEFAULT_TENANT_CODE` is an optional, empty-by-default prefill).

---

## 6. Security observations

| Finding | Severity | Owner |
|---|---|---|
| BFF origin is plain **HTTP** (`http://185.193.19.156:9096`): passwords and bearer tokens cross the network unencrypted. | High for production | Backend / infra (TLS) |
| `/v3/api-docs` is served **without authentication**, exposing the full contract incl. platform endpoints. | Medium | Backend |
| Tokens (incl. refresh) in `sessionStorage` — readable by any XSS. Documented; mitigated by CSP headers. | Medium | Backend change needed for httpOnly cookie |
| Route guards are client-side only (no `proxy`/middleware). Consistent with bearer-in-storage model; the BFF is the authority. | Info | — |
| After V10, a Safe-Fare Admin would see cross-tenant data in tenant-style screens without a tenant label (C3). Not a leak (the user is entitled), but misleading. | Medium (UX/compliance) | Frontend (Phase 5) |
| `NEXT_PUBLIC_MAPTILER_KEY` is public by design; `.env.example` instructs origin restriction. | Info | Ops |
| No secrets, passwords or tokens found in `src/`; `.env.local` is untracked. | ✓ | — |

---

## 7. Python service

Nothing exists yet: no client, no config, no calls. `.env.local` contains a commented `NEXT_PUBLIC_PYTHON_API_BASE_URL`. The BFF's own assistant (`POST /assistant/ask`, `GET /assistant/prompts`, permission `device.read`) returns `AnswerDto` with a `simulated` flag that the UI already labels — it is a BFF feature, **not** the Python service. Python Swagger: not supplied.

---

## 8. Files that will need modification (forecast)

| File | Why | Phase |
|---|---|---|
| `src/features/drive-vision/api/types.ts` | V10 DTOs; `LoginRequest.tenantCode?`; `platform` | 2 |
| `src/components/drive-vision/auth/login-screen.tsx` | Admin sign-in without `tenantCode` | 2 |
| `src/features/drive-vision/store/auth-store.ts` | Load `GET /me/permissions`; reload on tenant switch | 2–3, 5 |
| `src/features/drive-vision/api/auth-service.ts` | `myPermissions()` | 2 |
| `src/features/drive-vision/api/client.ts` | Inject tenant selector; reusable by a second base URL | 5, 8 |
| `src/features/drive-vision/access/access-policy.ts` (+ `use-access.ts`) | Permission-based resolver; `ADMIN` + `platform`; V10 codes | 3 |
| `src/components/drive-vision/navigation/*`, `app-shell/sidebar.tsx`, `topbar.tsx` | Dynamic nav, platform nav, tenant switcher | 3–5 |
| `src/features/drive-vision/api/admin-service.ts` | Roles, matrix, platform tenants | 5–6 |
| `tests/operations-api.test.cjs` (+ new tests) | V10 spec, permission and tenant tests | 1–3 |
| New: tenant store, platform dashboard, tenant management, roles/permission matrix screens, Python client | — | 4–8 |

---

## 9. Phase 0 acceptance

| Criterion | Result |
|---|---|
| Entire application structure understood | ✅ all 242 non-generated files catalogued; core modules read in full |
| Latest Swagger inspected | ✅ V10 verified 164 / 220 / 297; diffed against previous spec |
| Existing functionality documented | ✅ §2, inventory with per-operation frontend usage |
| Implementation plan created | ✅ `implementation-roadmap.md` |
| Existing uncommitted changes preserved | ✅ tree was clean; only new docs + `docs/openapi/api-docs-v10.json` added; no source file changed |
