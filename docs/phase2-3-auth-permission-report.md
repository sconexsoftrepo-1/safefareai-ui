# Phases 2–3 — V10 authentication, identity and permission migration

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits made).
Inputs: `project-audit.md`, `v10-compatibility-report.md`, `v10-api-frontend-mapping.md`, spec `docs/openapi/api-docs-v10.json`.

> **Verification level (updated in Phase 3.5, 2026-11-02).** Everything below is verified **in code** (unit tests, static contract tests, mutation checks, production build).
> **One item is now LIVE VERIFIED:** Safe-Fare Admin login. The user tested it in the browser after the Phase 2 changes: the Safe-Fare Admin option was selected, sign-in succeeded and no tenant code was required.
> Nothing else is live verified. That includes tenant ADMIN, Fleet Owner, Dispatcher, Viewer and Driver logins, platform permission enforcement, tenant switching, cross-tenant isolation and permission-matrix editing. During Phases 2–3, Claude sent nothing to the BFF. Full Phase 3.5 results: [`phase3-5-validation-report.md`](phase3-5-validation-report.md).

Starting state (`git status`, before any edit): only the Phase 0/1 outputs, `M tests/operations-api.test.cjs` and 10 untracked docs/tests. All preserved.

---

## 1. Authentication changes (Phase 2)

| Area | Before | After |
|---|---|---|
| Login request | Form required `tenantCode` and always sent it | Account-type switch on the same form. **Tenant user:** `{tenantCode, login, password}`. **Safe-Fare Admin:** `{login, password}`, with the `tenantCode` property **absent** (never `""`, `null` or a filled-in value). A blank code is never sent in either mode. Logic is in `auth/login-model.ts` (pure, tested). Validation messages unchanged. |
| `LoginRequest` type | `tenantCode: string` | `tenantCode?: string` (V10) |
| Identity source | `GET /me` role code + `GET /me/menus` | **`GET /me/permissions`** (`MyPermissionsDto`), parsed by `access/identity.ts`. `GET /me` stays as profile (name, email, tenant name) and is never used to authorise. `GET /me/menus` is no longer called (service method kept for the Menu Management phase). |
| Session start | `authenticated` set from the login response, `/me` loaded afterwards | `authenticated` only once `/me` **and** `/me/permissions` both arrived. If either fails with a non-401 error, the state is the retryable `error` (AuthGate "Couldn't load your session / Try again"). The shell never renders with an unverified identity. Tokens are kept for the retry. |
| Session restoration | `bootstrapAuth` → `/me` | `bootstrapAuth` → `/me` + `/me/permissions` in parallel |
| Identity refresh | — | `refreshIdentity()` re-reads `/me/permissions`. On failure the identity is dropped (not kept stale). Ready for tenant switching (Phase 5). |
| Logout / session end | Cleared user + menus | Clears `user`, `identity`, `bootError` together (`SIGNED_OUT`). Tokens are cleared by the unchanged client. |
| Token handling | — | **Unchanged:** single client, `sessionStorage`, proactive refresh, single-flight + cross-tab refresh lock, one retry after 401, no tokens or bodies in logs. The future Python client will reuse this session (no second token store). |

### Login payloads

```jsonc
// Tenant user (mode "tenant")
{ "login": "ops@acme.example", "password": "…", "tenantCode": "ACME" }
// Safe-Fare Admin (mode "platform") — no tenantCode property
{ "login": "admin@safefare.example", "password": "…" }
```

## 2. Platform identification

| Kind (`identityKind`) | Rule | Grants |
|---|---|---|
| Safe-Fare Admin (`platform-admin`) | `identity.platform === true` (literal `true` only; `"true"`, `1`, missing → false) | Nothing by itself. Platform administration = `platform && tenant.all` (`canAccessPlatform`). |
| Tenant ADMIN (`tenant-admin`) | `platform === false && roleCode === "ADMIN"` | Nothing by itself; its permissions decide (backend: every tenant permission) |
| Driver (`driver`) | not platform, `roleCode === "DRIVER"` (confirmed live 2026-10-29) | Narrows only: the driver app is for driver logins |
| Tenant user (`tenant-user`) | any other identity (Fleet Owner, Dispatcher, Viewer…) | Its permissions |
| `none` | no / non-object identity | Nothing |

The obsolete `PLATFORM_ADMIN` mapping and every role-code grant (`roleCodes`, `roleGrants`, `screenGrants`, `actionGrants`) are removed. A test (`access-v10.test.cjs`) fails if `PLATFORM_ADMIN`, `SUPER_ADMIN`, `roleGrants`, `roleCodes`, menu-error state or `access.role` reappear in app code.

## 3. Permission resolver (Phase 3)

One module: `src/features/drive-vision/access/access-policy.ts`, consumed only through `useAccess()` / `useCan()` and the check functions. No screen has its own permission logic.

- **Registries** (`SCREENS`, `FEATURES`, `ACTIONS`). Each entry has the exact V10 code(s) **and the V10 operation(s) it mirrors**. `access-v10.test.cjs` checks every entry against the spec's "Required permission" for those operations, so a code can't be invented or drift.
- **Checks:** `hasPermission`, `canAccessScreen`, `canPerform`, `canUseFeature`, `canAccessPlatform`, `hasTenantContext`, `needsTenantSelection`, `canAccessPath`, `decideRoute`.
- **Operation level:** the coarse keys were split at V10 permission boundaries:

  | Before | After (code) |
  |---|---|
  | `drivers.manage` | `drivers.create` (`driver.create`), `drivers.update` (`driver.update`: edit, assign, end assignment), `drivers.delete` (`driver.delete`) |
  | `dispatch.manage` | `dispatch.create` (`dispatch.create`), `dispatch.update` (`dispatch.update`: edit, cancel, request swap) |
  | `leave.manage` | `leave.create` (`workforce.create`), `leave.decide` (`workforce.update`) |
  | `users.manage` | `users.create` (`user.create`), `users.update` (`user.update`: edit, status, unlock, reset password) |
  | unchanged | `swaps.decide` (`dispatch.update`), `alerts.handle` (`alarm.handle`), `geofences.delete` (`geofence.delete`), `video.export` (`video.playback`), `settings.manage` / `account.password` / `notifications.markRead` (signed in), `driver.selfService` (`own.data.read`) |

  Buttons on Drivers, Dispatch, Workforce and Users now follow the finer keys (e.g. a user with `driver.update` but not `driver.delete` sees Edit / Assign but not Delete).
- **Server screens** (`MyScreenDto`): mapped by `routePath`. They can only narrow (`readOnly` → no writes on that screen; `allowed: false` → no action needing that code) and shape driver navigation (server order and titles). They never open a screen.
- **Fail closed:** no identity, a non-object payload or an **empty permission set** → no screen at all, not even Settings ("no permissions" panel). Unknown codes and look-alikes grant nothing. Prototype-chain strings are inert.
- **Secondary reads** inside a screen (e.g. `GET /groups` = `group.read`, `GET /roles` = `role.read`) are not screen gates. If the backend refuses one, that panel shows its existing error state.

Full screen/action/feature × identity table: [`v10-permission-matrix.md`](v10-permission-matrix.md).

## 4. Screen mapping

`MyScreenDto` has no `routeKey`. The app maps `routePath` with `SERVER_ROUTE_PATHS`, which lists **only values the backend has returned**:
- `/driver/work|shifts|leave|checklist|safety|profile` → My Work sections, and `/driver/notifications` → no page (live DRIVER, 2026-10-29).
- `/dashboard` → Overview, `/alarms` → Alerts, `/reports` → Reports (admin menus, 2026-10-27).

The app's own `/drive-vision/…` routes map 1:1. Anything else is reported as unmapped and opens nothing. `menuKey` is parsed but not used, because its catalogue is undocumented (D3). All existing URLs are unchanged.

## 5. Navigation

One catalogue (`NAV_GROUPS`) filtered by the resolver: there is no per-role menu. The driver's single "My Work" entry expands into its sections (server titles and order when `screens` map; otherwise all six). Settings is staff-only (drivers use My Profile, as before). The `MenuLoadError` banner was removed, because navigation no longer has a separate request that can fail on its own. `app-shell/menu-load-error.tsx` was deleted after confirming nothing else used it.

## 6. Route protection

Unchanged mechanics (AuthGate → login redirect with `next`; RouteGuard → allow / forbidden panel; landing redirect only from `/drive-vision` and Overview). The only change is in what feeds them:
- Unauthenticated → `/login?next=…`, with no API calls.
- Typed URLs follow the same screen check as navigation (a test asserts nav ⇔ route agreement for every screen and identity).
- Platform-only screens need `platform === true` plus their code. The mechanism is tested with a test registry; no platform screen exists before Phase 5.
- Reasons: `unknown-route`, `no-access`, `no-permissions` (replaces `no-role`). The panel shows the role code and a "platform" marker.

## 7. Tenant context (prepared, behaviour unchanged)

`Access.tenantId` = `identity.tenantId`. `hasTenantContext` is true for tenant users (their tenant comes from the token) and for the Safe-Fare Admin only once a tenant is set. Every action records `tenantWrite`, and `needsTenantSelection(access, action)` reports when a write would hit `TENANT_REQUIRED`.

**Per the brief, the 26 tenant-scoped writes are not changed:** they still send no tenant selector, and they're still offered to the Safe-Fare Admin. That is Phase 5. List: `v10-api-frontend-mapping.md` (PARTIALLY_INTEGRATED).

## 8. Behaviour changes to note

| Change | Why |
|---|---|
| Every `ADMIN` user now gets screens (before V10 fix: none) | Permissions, not role codes |
| Fleet Owner / Dispatcher / Viewer get screens from their permissions without code changes | Same |
| A DRIVER the backend grants a fleet read code (e.g. `alarm.read`) now sees that screen | Permissions decide. Before, a DRIVER never saw fleet screens. Settings stays hidden for drivers. |
| Device Commands needs `command.send` even to read history | V10 documents `GET /commands` with `command.send` |
| Assistant and record search need `device.read` | V10 permission of `/assistant/*` and `/search` |
| My Work needs `own.data.read` (V10) **and** `driver.app` (observed) **and** a DRIVER login | Spec + live observation. An admin holding both codes doesn't get it. |
| An identity with zero permissions gets the "no permissions" panel (no Settings) | Fail closed |
| Login failure after a successful token exchange (identity unavailable) → session error with retry | No shell without an identity |

## 9. Tests

**Code-level (all mocked, no network): 312 / 312 pass** (Phase 1 baseline 281).

| Suite | Tests | What |
|---|---|---|
| `auth-login.test.cjs` (new) | 12 | Tenant and admin payloads, blank code omitted, validation messages, signIn → `/me/permissions`, `platform` true / false / missing / non-boolean, invalid login (401, no session, no identity calls), identity 503 → retryable error, token rejected → signed out and state cleared, `refreshIdentity`, no password / token / Authorization in logs |
| `access-v10.test.cjs` (new) | 23 | Every registry code ↔ V10 spec, `tenantWrite` ↔ scope, no legacy assumptions in source, Safe-Fare Admin vs tenant ADMIN, platform-only screens, tenant context, Fleet Owner / Dispatcher / Viewer (synthetic codes), create / update / delete boundaries, server-screen narrowing, Driver app and nav, routePath mapping |
| `access-policy.test.cjs` (rewritten) | 18 | Identity parsing, deny by default, role code alone grants nothing (incl. PLATFORM_ADMIN / SUPER_ADMIN), exact codes, prototype chain, routes, landing, nav ⇔ route agreement, search |
| `driver-access.test.cjs` (rewritten) | 7 | Real sidebar groups (use-nav), staff never see driver app, fallback, hostile screens, typed URLs |
| `auth-access.test.cjs` (updated) | 10 | Session restoration via `/me` + `/me/permissions` (no `/me/menus`), refresh near expiry, rejection → login, offline → retry, malformed identity → forbidden, identity 5xx → retry, logout clears identity |
| `final-audit-fixes.test.cjs` (updated) | 24 | GA-10/12/14/16 ported to V10 identities and the finer action keys |
| `not-found-route.test.cjs`, `phase2-models.test.cjs` (fixtures) | 4 / 15 | V10 fixtures |
| `v10-contract.test.cjs` (updated) | 63 | Static V10 contract: 0 errors. The "unmapped response fields" ratchet is now empty (all 15 mapped). New runtime cases for `GET /me/permissions` and the admin login body. |
| Others unchanged | — | `auth-refresh` (cross-tab refresh races), operations, models |

Pre-V10 tests encoding the role-code model (`PLATFORM_ADMIN` grants, `/me/menus` routeKey navigation, menu-failure banner) were **replaced** by the V10 equivalents above, not deleted without replacement. Their invariants (deny by default, exact codes, prototype chain, admin excluded from driver app, typed-URL denial, nav ⇔ route agreement) are kept.

**Mutation check** (temporary edits, each file restored from backup afterwards; the suite is green after restore):

| Mutation | Failing tests |
|---|---|
| `platform: !!raw.platform` (truthy instead of `=== true`) | 2 |
| Always send `tenantCode` | 3 |
| Empty identity gets signed-in screens | 6 |
| Ignore `platformOnly` | 1 |
| Ignore server `readOnly` | 1 |

**Static checks:** `npm run typecheck` ✅ · `npm run lint` ✅ (0 warnings) · `npm run build` ✅ (29 routes; `/login` prerenders with the new form).

**Live backend tests:** one item verified by the user in a browser after Phase 2: **Safe-Fare Admin login (LIVE VERIFIED)**. Option selected, sign-in succeeded, no tenant code required. All other live checks are blocked:
- No test accounts (Safe-Fare Admin, tenant ADMIN, Fleet Owner, Dispatcher, Viewer, Driver).
- Plain-HTTP BFF, so no real credentials were used.

Not verified live:
- that `/me/permissions` returns what the fixtures assume;
- the actual `screens` / `routePath` values for each role;
- `platform` values (Safe-Fare Admin login succeeded, but the `/me/permissions` payload, including `platform` and whether `tenant.all` is present, was not captured);
- that tenant ADMIN holds every tenant code.

**Browser tests:** Safe-Fare Admin login was live-tested by the user (see above). In Phase 3.5 the login page was checked in headless Edge at 6 viewports with every `/api/v1/*` request mocked in the browser. Results: [`phase3-5-validation-report.md`](phase3-5-validation-report.md) §8–9.

## 10. Remaining backend dependencies

| ID | Needed for |
|---|---|
| D1 | Test accounts + test tenant: every live check above |
| D2 | Role codes for Fleet Owner, Dispatcher, Viewer (only labels; access doesn't depend on them) |
| D3 | `menuKey` catalogue and `routePath` values for all screens (to make `screens` authoritative for navigation) |
| D4 | `switch-tenant` semantics / `TenantSelectionDto.header` (Phase 5) |
| D5 | `PermissionDto.scope` values; `editable` / `fullAccess` rules (Phase 6) |
| — | Confirm `identity.tenantId` is `null` for the Safe-Fare Admin before selection, and set for tenant users |
| — | Confirm DRIVER logins keep `driver.app` (the driver app requires it in addition to V10's `own.data.read`) |
| D8 | TLS for the BFF before any real-credential test |
