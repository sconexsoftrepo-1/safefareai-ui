# SafeFare AI — Current architecture (updated 2026-11-02 after Phase 8)

This describes the code **as it is**, not the target. Target changes are in [`implementation-roadmap.md`](implementation-roadmap.md). Phase 2–3 changes (authentication, identity, permissions) are summarised in [`phase2-3-auth-permission-report.md`](phase2-3-auth-permission-report.md).

## Stack

Next.js **16.4.2** (App Router, `reactStrictMode`), React 19.3, TypeScript 5.9, Tailwind 4, Radix UI (shadcn-style wrappers in `src/components/ui/`), `motion`, `recharts`, `maplibre-gl` 6.14 (MapTiler or self-hosted style; coordinate-grid fallback), `sonner` toasts. No state library, no data-fetching library. Tests: `node --test` over `tests/*.test.cjs` with a custom TS loader (`tests/helpers/load-ts.cjs`) and browser fakes.

> AGENTS.md: this Next version has breaking changes vs. older releases — read `node_modules/next/dist/docs/` before writing framework-level code (routing, `proxy`/middleware, metadata, caching).

## Runtime topology

```
Browser (Next.js client components)
   │  fetch, Authorization: Bearer <access>, Accept: application/json
   ▼
Spring Boot BFF  ── NEXT_PUBLIC_API_BASE_URL (+ /api/v1)   e.g. http://185.193.19.156:9096
   │
   └─ vendor (GPSTrackTech) — reported via envelope `extend.source/stale`

Python API — not integrated (no client, no env var in use)
```

All pages are client-rendered behind `AuthGate`; the Next server only serves static/prerendered shells (29 routes, 2 dynamic). There is no Next `proxy`/middleware and no server-side API call: tokens live in the browser, so the server cannot authorise.

## Directory map

```
src/
  app/
    layout.tsx, page.tsx (→ /drive-vision), login/page.tsx
    drive-vision/
      layout.tsx         AuthGate + AppShell + RouteGuard
      template.tsx       page transition
      [...slug]/         in-shell "not found"
      overview, monitoring, video, trips, reports, vehicles(/[vehicleId], /new), drivers,
      dispatch, workforce, alerts, safety, geofences, devices(/commands), users, settings,
      my-work(/shifts, /leave, /checklist, /safety, /profile)
  components/
    ui/                  Radix wrappers
    drive-vision/
      app-shell/         shell, sidebar, topbar, mobile nav, search, notifications, profile menu
      auth/              login-screen, auth-gate, route-guard
      navigation/        nav-config (static NAV_GROUPS), use-nav
      shared/            data-table, filter-bar, api-states, dialogs, panels, badges…
      <feature>/         one folder per screen: *-page.tsx + *-model.ts (pure, tested)
  features/drive-vision/
    api/                 BFF client + services + DTO types   ← the only live data layer
    access/              identity.ts (parses GET /me/permissions), access-policy.ts (V10 resolver, pure) + hooks
    store/auth-store.ts  signed-in user state: profile (GET /me) + identity (GET /me/permissions)
    hooks/               use-api-query, use-preferences, use-media-query
    utils/               format, geo, time
    mock-data/, services/, store/fleet-store.ts, selectors.ts, hooks/use-live-simulation.ts
                         ← legacy sample layer; only label tables / helpers still referenced
  config/security-headers.ts
```

## Data layer

**One client** — `api/client.ts` exports `api.get/post/put/patch/delete` and `apiRequest`. Responsibilities: URL building (`API_BASE_URL + /api/v1 + path`, repeated keys for arrays), JSON envelope parsing, `ApiError` normalisation (`kind: http | network | timeout | aborted | parse`, `status`, `errorCode`, `fieldErrors`, `requestId`), timeouts, bearer attachment, refresh, 401 retry, diagnostics.

**Services** (thin, typed, one per area; no caching):

| Service | Controllers covered |
|---|---|
| `auth-service.ts` | auth, `/me`, `/me/permissions` (`/me/menus` kept, not called) |
| `account-service.ts` | `/me` PATCH, preferences, password |
| `admin-service.ts` | users, `GET /roles`, `GET /permissions` |
| `fleet-service.ts` | devices, groups, monitor, track, reports, video, reference, geofences, commands |
| `insight-service.ts` | dashboard, trips (read), safety, geofence events — `sourced()` keeps `extend` freshness |
| `platform-service.ts` | `GET /platform/tenants` (Phase 4), `POST /platform/switch-tenant` (Phase 5); both PLATFORM_WIDE (no tenant header) |
| `role-admin-service.ts` | Phase 7: global roles, role-permission mapping and the permission catalogue. Every call passes `tenant: "none"` (PLATFORM_WIDE). The Users page keeps `admin-service.ts` (tenant-scoped reads). |
| `tenant-context.ts` | Phase 5: in-memory selected tenant `{tenantId, code, name, header}`, header-name / id validation, scope key, rejection events |
| `tenant-scope.ts` | Phase 5: request classification PLATFORM_WIDE / SELF / TENANT_SCOPED and the per-request tenant header |
| `alert-service.ts` | alerts, alarms, notifications |
| `operations-service.ts` | drivers, dispatch, swaps, workforce |
| `driver-app-service.ts` | `/driver/**` |
| `assistant-service.ts` | search, assistant |

**Reads in components** use `useApiQuery(key, fetcher)`: per-component state, in-flight de-duplication by key, stale-response protection, `refetch`. There is **no shared cache** — data disappears when a component unmounts. Keys are built by each screen from its filters; none include a tenant.

## Authentication

```
LoginScreen (mode: tenant | platform) ── login-model.buildLoginRequest
   tenant   → {login, password, tenantCode}
   platform → {login, password}            (tenantCode property absent)
   ──signIn──► authService.login ──► POST /auth/login (no bearer)
                └─ writeSession(tokens) → sessionStorage "safefare:session:v1"
auth-store: GET /me ∥ GET /me/permissions → status authenticated {user, identity}
            (either fails non-401 → status error, retry; nothing rendered)
AuthGate (every /drive-vision page): bootstrapAuth() once per load → GET /me ∥ GET /me/permissions
refreshIdentity(): re-reads GET /me/permissions (tenant switch, permission change)
client: before each call, refresh if access expires within 30 s; on 401 → refresh once → retry once
refresh: single-flight per tab; Web Lock across tabs; BroadcastChannel hand-over of rotated tokens
logout: POST /auth/logout {refreshToken} with bearer → endSession (always clears locally)
session ended → listeners → auth-store {user, identity} cleared, unauthenticated → /login?next=…&reason=expired
```

Tokens are never logged; diagnostics print method, path, status, duration, error code, request id. The token store is shared: a second API client (Python, Phase 8) is meant to reuse this session, not create its own.

## Authorisation (frontend convenience layer)

`identity.ts` parses the untrusted `GET /me/permissions` payload into an `Identity` (`platform` is true only for a literal `true`; codes are exact strings; screens and operations are defensive; a non-object becomes `null`). `access-policy.ts` (pure) → `computeAccess(identity)`:

1. **Screens** from the `SCREENS` registry: each needs exact V10 code(s) (e.g. Vehicles `device.read`, Drivers `driver.read`, Device Commands `command.send`, Settings = signed in) plus an audience (`driver` app only for DRIVER logins; `staff` hides Settings from drivers) and, for platform screens, `platform === true`. The one platform screen is `platform` (`/drive-vision/platform`, Platform Overview, Phase 4): `platformOnly` + `tenant.all`.
2. **Actions** from `ACTIONS` (one per V10 permission boundary: `drivers.create|update|delete`, `dispatch.create|update`, `leave.create|decide`, `users.create|update`, …), offered only on an allowed screen.
3. **Features** (`assistant`, `recordSearch`) need `device.read`.
4. **Server screens** (`MyScreenDto`, mapped by `routePath` via `SERVER_ROUTE_PATHS`) only narrow (`readOnly`, `allowed: false`) and shape driver navigation.
5. **Dashboard widgets** (`WIDGETS`, Phase 4): `platform.tenants` (`tenant.all`, plus platform access), `dashboard.fleet` (`device.read`), `dashboard.safety` (`alarm.read`), `dashboard.groups` (`group.read`), checked with `canViewWidget`. A widget the identity can't read shows "no permission" and sends no request.
6. **Fail closed:** no identity or an empty permission set → nothing.

Every registry entry names the V10 operation(s) it mirrors; `tests/access-v10.test.cjs` checks them against the spec. Matrix: `v10-permission-matrix.md`.

Consumers: `RouteGuard` (`decideRoute` → allow / forbidden panel / landing redirect), `useNavGroups` (one `NAV_GROUPS` catalogue filtered by the resolver; the driver's My Work expands into sections), `useCan(action)` for buttons, search filtering, profile-menu links, notification links. Also: `dataScope(access)` (`all-tenants` for a Safe-Fare Admin with no tenant, `tenant` otherwise; drives the scope badges), `defaultLanding(access)` (post-login: Platform Overview for platform admins, else Overview), `canAccessPlatform` (`platform && tenant.all`), `hasTenantContext`, `needsTenantSelection`.

The BFF remains the authority; denied routes never mount, so they make no requests.

## Tenancy (Phase 5)

| Who | Tenant source | Header |
|---|---|---|
| Tenant users (tenant ADMIN, Fleet Owner, Dispatcher, Viewer, Driver) | Access token (backend). A frontend selection is ignored (`computeAccess` uses `identity.tenantId`) and can't be set (switching needs `platform && tenant.all`). | never |
| Safe-Fare Admin, platform-wide mode | none: reads cover every tenant (V10) | never |
| Safe-Fare Admin, tenant selected | the selection (`api/tenant-context.ts`) after `POST /platform/switch-tenant` succeeded | `<header from switch response>: <tenantId>` on TENANT_SCOPED requests only |

- **Classification** (`api/tenant-scope.ts`):
  - PLATFORM_WIDE: `/platform/*`.
  - SELF: `/auth/*`, `/me`, `/me/*`, `/notifications*`, `/driver/*`.
  - Everything else is TENANT_SCOPED.
  - Requests with `auth: false` or option `tenant: "none"` never carry the header. The tenant is never also sent as `?tenantId`.
- **Client** (`client.ts`):
  - The header is resolved once per request, so the 401 retry keeps the same tenant.
  - Bearer token, proactive refresh, cross-tab lock and the single retry are unchanged.
  - A scoped response with `INVALID_TENANT` / `TENANT_ACCESS_DENIED` clears the selection (`onTenantRejected`).
- **Switching** (`store/tenant-store.ts`):
  - Validates platform access, a valid id and ACTIVE status, then calls the switch endpoint.
  - Checks the response (same `tenantId`, a safe header name), then commits. Any failure leaves the selection unchanged.
  - Concurrency: the latest switch wins, a clear cancels a pending switch, and duplicate clicks are ignored.
  - The selection is cleared on session end, on a new session load, and when a refreshed identity isn't platform.
  - It is in memory only: reload or a new tab returns to platform-wide mode.
- **Access** (`computeAccess(identity, policy, {selectedTenantId})`):
  - `Access.tenantId` = the selection for platform identities.
  - Tenant writes (13 action keys = 26 operations, classes A/B/C) move to `tenantBlockedActions` while a Safe-Fare Admin has no tenant, so `useCan` is false. Create CTAs render disabled with the reason (`TenantRequiredButton`), and screens show `TenantScopeNotice`.
  - `RECORD_TENANT_RESOLUTION_CONFIRMED` (empty) is the switch for record operations the backend confirms it can resolve without a tenant.
- **Cache isolation:**
  - `useApiQuery` keys are prefixed with the scope (`all` / `t:<id>`), so a switch hides old data, refetches, and drops late responses.
  - The page content under the shell is keyed by the scope (local state resets). Switching from a nested detail route goes to the screen root.
- **UI:** a top-bar `TenantSwitcher` (Safe-Fare Admin + `tenant.all` only) and the `tenants` screen (`/drive-vision/tenants`, `platformOnly` + `tenant.all`). Both select through `useTenantContext()`; neither keeps its own selection.
- **Tenant Management (Phase 6):** `platform/tenant-management.tsx` + the pure `platform/tenant-management-model.ts` (search, status options, filtering, client paging, detail rows, selectability). Create Tenant: `platform/tenant-create-panel.tsx` + pure `platform/tenant-create-model.ts`, resolver action `tenants.create` (an off-spec operation, flagged by `Requirement.offSpec`).
  - **Data:** `GET /platform/tenants` (complete list, unpaged) and, optionally, `GET /reference/statuses` (a tenant status set, if the catalogue has one).
  - **Details** come from the list row; V10 has no tenant detail, create, update, status or delete endpoint, so none is offered.
  - Selecting from the details drawer closes it, because page content remounts on a tenant change by design.

## Platform configuration (Phase 7)

| Screen | Route (server routePath) | Gate | Data |
|---|---|---|---|
| Global Roles | `/drive-vision/platform/roles` (`/platform/roles`) | `platformOnly` + `role.read`; actions `role.manage`, `role.permission.create` / `.delete`; widgets `role.permission.read` + catalogue read | `GET/POST /roles`, `PUT/DELETE /roles/{id}`, `GET/POST/DELETE /roles/{id}/permissions` |
| Permission Catalogue | `/drive-vision/platform/permissions` (`/platform/permissions`) | `platformOnly` + `permission.manage` | `GET/POST /permissions`, `PUT/DELETE /permissions/{code}` |

- **Product rule:** only the Safe-Fare Admin configures roles and permissions in the frontend. Both screens are `platformOnly`, so a tenant ADMIN holding the same codes gets neither the screens nor their actions or widgets (the widgets also check `platform`).
- **Global vs tenant roles:** a role without `tenantId` is global and managed here; tenant roles are listed read-only and their mappings are never loaded.
- **Requests:** all are PLATFORM_WIDE (`tenant: "none"`), so the selected tenant never changes global data. The actions are not tenant writes (`tenantWrite: false`), so all-tenants mode doesn't block them.
- **Pure model** (`platform/role-permission-model.ts`): scope classification, filters, schema validation, protection reasons from server flags, change plan (no duplicates or no-ops; unknown-code, permission and 300-code limits; platform-scope, self-lockout and frontend-usage warnings) and apply summary (success / partial / failed).
- **Saving mappings:** POST additions, then DELETE `?codes=` removals, then re-read. `PUT` replace isn't used.

## Drivers and assignments (Phase 8)

- **Screen:** `/drive-vision/drivers` (`driver.read`).
  - Actions: `drivers.create` (`driver.create`), `drivers.update` (`driver.update`: edit, assign, end), `drivers.delete` (`driver.delete`).
  - Secondary reads are widgets, never requested without their code: `drivers.safety` (`alarm.read`), `drivers.deviceChoices` (`device.read`), `vehicles.driverAssignments` (`driver.read`; also on vehicle detail).
- **Tenancy:** tenant-scoped (Phase 5).
  - The Safe-Fare Admin sees all tenants' rows, with the documented `tenantId` / `tenantName` columns (`DriverRow`), until a tenant is selected. Writes need a selected tenant.
  - Tenant users are always on their own tenant.
- **Assignments:** `AssignRequest {deviceId, from?, to?, replaceCurrent?}`, `EndAssignmentRequest {at?}`.
  - `reviewAssignment` lists the driver's and the vehicle's active assignments (the server's `active` flag). Replacing requires acknowledgement; nothing is pre-blocked, because V10 doesn't state one-to-one rules.
- **Historical attribution:** the frontend never assigns an alarm to a driver. Alerts show the server's `AlertRow.driverName` ("Driver (server)").
  - `assignmentAt` (`[from, to)`, null when ambiguous) is the reference rule, covered by tests and **not** wired to the UI until the backend confirms its own semantics.

## Dashboards

| | Fleet Overview (`/drive-vision/overview`) | Platform Overview (`/drive-vision/platform`) |
|---|---|---|
| Who | anyone with `device.read` | `platform === true` + `tenant.all` only |
| Scope | own tenant (tenant users); Safe-Fare Admin: all tenants (badge) or the selected tenant (badge) | tenant KPIs/table always platform-wide; fleet widgets all tenants or the selected tenant |
| Data | `/dashboard/*`, `/devices`, `/groups`, `/monitor/realtime`, `/alarms/*`, `/me/preferences` | `/platform/tenants`, `/groups` (total), `/dashboard/overview`, `/dashboard/fleet-status`, `/dashboard/trends`, `/dashboard/safety-events` |
| Components | shared: `MetricCard`, `Panel`, `FleetStatusCard`, `OperationsSnapshot`, `DailyTrendPanel`, `ApiErrorState` | same, plus `platform-dashboard-model.ts` (pure tenant aggregation) |

Query keys are separate (`overview:*` / `platform:*`), and every key is also prefixed with the tenant scope.

## Configuration (`.env.example`; all `NEXT_PUBLIC_*`, inlined, public by design)

`API_BASE_URL`, `API_TIMEOUT_MS` (15 s), `API_DEBUG`, `DEFAULT_TENANT_CODE` (login prefill), `MAPTILER_KEY`, `MAPTILER_MAP`, `MAP_STYLE_URL`. `.env.local` additionally has a commented `PYTHON_API_BASE_URL`. No server-only variables exist.

## Tests (429, all passing)

Pure-model and service tests with mocked `fetch`: V10 access resolver and registry ↔ spec checks, login payloads and auth store flows, auth refresh races, driver access and navigation, alerts/operations/my-work/track models, operations and V10 contract tests (static type-checker analysis of every call site + runtime request cases) against **`api-docs-v10.json`**, regressions from earlier audits. Browser checks (headless Edge, every API call mocked) are run per phase, with evidence in `docs/evidence/screenshots/phase3-5|phase4/`. They are not part of `npm test`. No live-backend tests.
