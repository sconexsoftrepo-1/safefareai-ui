# SafeFare AI — V10 implementation roadmap

Date: 2026-11-02. Inputs: [`project-audit.md`](project-audit.md), [`current-architecture.md`](current-architecture.md), [`v10-api-inventory.md`](v10-api-inventory.md), spec `docs/openapi/api-docs-v10.json`.
Supersedes `implementation-plan.md` for V10 work (that file stays as history).

Rules carried into every phase: no invented endpoints/schemas/role codes; V10 spec is the contract; BFF is the authority (frontend checks are convenience); no writes against the BFF without an approved test tenant; no commits; every phase ends with typecheck · lint · tests · build and an honest verified / not-verified list.

---

## Backend dependencies (blocking items, by phase)

| ID | Needed | Blocks | Ask |
|---|---|---|---|
| **D1** | Test accounts: Safe-Fare Admin, tenant ADMIN, Fleet Owner, Dispatcher, Viewer, Driver — and a designated **test tenant** where writes are allowed | Live verification of Phases 2–7, all of Phase 11 | Backend / QA |
| **D2** | Exact role codes (spec lists none). Brief says `ADMIN` replaces `PLATFORM_ADMIN`/`SUPER_ADMIN`; Fleet Owner / Dispatcher / Viewer codes unknown | Phase 3 role labels (resolver itself will be permission-based and not need them) | Backend |
| **D3** | `menuKey` catalogue and meaning of `routePath` in `ScreenDto`/`MyScreenDto` (backend paths like `/driver/work` don't exist in this app) | Phase 3 dynamic navigation | Backend — or derive from a live `GET /screens` once D1 exists |
| **D4** | `POST /platform/switch-tenant` semantics: is it stateful server-side, or a validation call? What is `TenantSelectionDto.header` (header name? value?). Spec + brief say no new tokens are issued, and every op accepts `X-Tenant-Id`/`tenantId` | Phase 5 | Backend |
| **D5** | `PermissionDto.scope` values (platform vs tenant) and `RolePermissionsDto.editable` / `RoleDto.fullAccess` rules | Phase 6 | Backend |
| **D6** | Confirmation that tenant ADMIN gets 403 on `PUT/POST/DELETE /roles/{id}/permissions` and `/permissions/**` (brief: only Safe-Fare Admin configures) | Phase 6/11 sign-off | Backend + D1 to verify |
| **D7** | Python Swagger, base URL, CORS for the app origin, how it validates the BFF JWT, tenant header contract | Phase 8–9 real integration | Python team |
| **D8** | TLS for the BFF (currently plain HTTP) and auth on `/v3/api-docs` | Production readiness | Infra / backend |

Everything else listed below can proceed on the spec alone.

---

## Progress (2026-11-02)

| Phase | Status | Report |
|---|---|---|
| 0 Audit | ✅ done | `project-audit.md` |
| 1 Contract analysis | ✅ done | `v10-api-frontend-mapping.md`, `v10-compatibility-report.md` |
| 2 Authentication & identity | ✅ code-level done; **live verification blocked (D1)** | `phase2-3-auth-permission-report.md` |
| 3 Permission resolver | ✅ code-level done; **live verification blocked (D1, D3)** | `phase2-3-auth-permission-report.md`, `v10-permission-matrix.md` |
| 4–13 | not started (awaiting review) | — |

Deviations from the plan below, decided during Phases 2–3:
- The login uses an explicit **account-type switch** (Tenant user / Safe-Fare Admin) on the same form; blank codes are never sent in either mode.
- The `createApiClient` seam for the Python client (planned in Phase 2) was **not** done. The brief for Phases 2–3 excluded Python work, and the existing client already shares one session. It moves to Phase 8.
- Screen gates use the V10 permission of each screen's primary read operation (verified against the spec by test). Server `screens` only narrow until D3 provides the `menuKey` / `routePath` catalogue.
- `needsTenantSelection()` exists but is **not** applied to buttons. The 26 tenant-scoped writes are unchanged until Phase 5.

## Phase 1 — V10 contract analysis (docs only)

- Produce `docs/v10-api-frontend-mapping.md`: one row per operation (220) — method/path, purpose, screen, request, response, permission, tenant scope, status (complete / partial / pending), blocker. Generated from the spec + call-site scan (scripts already prototyped in Phase 0) and hand-annotated with screens.
- Point `tests/operations-api.test.cjs` at the V10 spec (keep the old file for history) and add a test that every `api.*` call site resolves to a V10 operation with the same method.
- Exit: mapping complete; contract tests green against V10.

## Phase 2 — Authentication and shared identity

Design (no second auth system):
- `LoginRequest.tenantCode?: string`. Login screen gets an explicit **"Sign in as Safe-Fare Admin"** toggle; when on, the tenant field is hidden and the key is **omitted** from the body (never `""`). Validation requires tenant code only for tenant users.
- `authService.myPermissions()` → `GET /me/permissions` → `MyPermissionsDto` stored in `auth-store` as `identity` (`userId, platform, homeTenantId, tenantId, roleId, roleCode, permissions, screens`). `/me` stays for profile fields. Platform identity comes **only** from `identity.platform` (`CurrentUserDto.platform` as fallback), never from `roleCode`.
- Add V10 types: `MyPermissionsDto`, `MyScreenDto`, `ResourceAccessDto`, `AllowedOperationDto`, `ScreenDto`, `OperationDto`, `TenantDto`, `TenantSelectionDto`, `PermissionMatrixDto`, `RolePermissionsDto`; extend `RoleDto`, `PermissionDto`, `CurrentUserDto`.
- Refactor `client.ts` into `createApiClient({ baseUrl, prefix, name })` that reuses the **same** session module, refresh lock and session-ended listeners; `api` = BFF instance (no behaviour change). This is the seam for Phase 8.
- Tests: payload with/without `tenantCode`; identity parsing (malformed input tolerated); refresh unchanged (existing 11 race tests must still pass).
- Live verification needs D1.

## Phase 3 — Centralised permission resolver

- Replace role-grant logic in `access-policy.ts` with a resolver fed by `identity`:
  - `hasPermission(code)` from `identity.permissions` (exact V10 codes, e.g. `driver.create`, `dispatch.update`, `role.permission.update`, `tenant.all`).
  - Screen access: `identity.screens[]` (`menuKey`, `readOnly`, `operations[].allowed`) mapped to app routes through a single `SCREEN_REGISTRY` (`menuKey → ScreenKey/route/icon`), plus a per-screen fallback permission (the screen's read permission from the spec) so screens work while D3 is open.
  - Operation access: `ACTION_SCREENS` keys re-expressed as V10 permission codes (e.g. drivers create/update/delete → `driver.create|update|delete`; alerts handling → `alarm.handle`; geofence delete → `geofence.delete`; users → `user.*`). `actionGrants` filled from the spec's per-operation permissions — documented, not inferred.
  - Features: assistant → `device.read` (spec), record search → per-type read permissions.
  - Platform: `isPlatform = identity.platform === true`. Platform-only screens gated by `tenant.all`.
  - Remove `PLATFORM_ADMIN` mapping; keep `roleCode` only for display.
- `useAccess()` / `useCan()` keep their signatures so screens don't change.
- Navigation: `useNavGroups` built from the resolver (static `NAV_GROUPS` remain the presentation catalogue; visibility comes from the resolver). Driver nav keeps `/me/menus` until D3 lets it move to `identity.screens`.
- Access-denied panel stays; message no longer mentions "role isn't enabled".
- Tests: matrix of synthetic identities (platform admin, tenant ADMIN with all tenant perms, read-only viewer, dispatcher subset, driver) → screens, actions, nav, route decisions; no legacy codes remain (grep test).

## Phase 4 — Safe-Fare Admin platform dashboard

- Same Overview components, two data modes:
  - **Platform (no tenant selected):** tenants table/cards from `GET /platform/tenants` (total tenants = list length; users/devices/drivers = sums of the returned per-tenant counts — complete because the list is unpaged); fleet KPIs from `/dashboard/overview`, `/dashboard/safety-events`, `/dashboard/trends` **without** `tenantId` (spec: reads cover every tenant). Clearly labelled "All tenants".
  - **Tenant (tenant selected or tenant user):** existing Overview, with tenant name shown.
- Metrics not available from any endpoint are shown as "Not available", never computed from partial data.
- Tenant ADMIN never calls `/platform/*` (gated by `tenant.all`).

## Phase 5 — Tenant management and switching

- `tenant-store` (sessionStorage, tab-scoped like tokens): `{ selectedTenant: TenantSelectionDto | null }`, only for `platform` users; cleared on sign-out/session end.
- `client` injects the tenant selector on **every** BFF request when a tenant is selected (header name from `TenantSelectionDto.header` if D4 confirms it is a header name, else `X-Tenant-Id`). Never sent for tenant users.
- Switch flow (top bar switcher + Tenant Management screen): `POST /platform/switch-tenant {tenantId}` → store result → reload `GET /me/permissions` with the tenant → **remount the page tree with `key={tenantId ?? "all"}`** so every `useApiQuery` restarts (no stale tenant data; no shared cache to invalidate) → notifications/unread count refetched → toast + visible tenant badge. No login, no token change.
- "All tenants" mode: writes are disabled with an explanation (server would answer `TENANT_REQUIRED`).
- Tenant Management screen: list from `GET /platform/tenants` with id, code, name, status, timezone, users/devices/drivers, current; client-side search and status filter (list is unpaged).
- Tests: header injection, store reset on sign-out, remount on switch, tenant user never sends the header.

## Phase 6 — Roles and permission configuration

- Roles screen (Administration): `GET /roles` (+ `GET /roles/{id}`), showing `protectedRole`, `fullAccess`, `assignable`, `activeUsers`.
- Permission matrix: `GET /roles/permission-matrix` for the selected tenant; rows grouped by screen/operation using `GET /screens` (`operations[].permissionCode`) with ungrouped codes listed separately; `scope` shown and platform-scope codes never editable in a tenant matrix.
- Editing only when `identity.platform && hasPermission("role.permission.update")` **and** a tenant is selected **and** the role's `editable` is true; `fullAccess` roles shown as "all permissions", read-only. Save = `PUT /roles/{id}/permissions {permissionCodes}` (full replace) with diff preview + confirmation; 403/409 errors surfaced.
- Role create/edit/delete and permission catalogue edits (`POST/PUT/DELETE /roles`, `/permissions`) only if product confirms they are in scope — the endpoints exist, but they change other tenants' users.
- Verification of backend enforcement for tenant ADMIN requires D1 + D6.

## Phase 7 — Existing screens

Per screen: verify endpoint/params/response against V10, apply resolver + tenant context, loading/empty/error, pagination/filters, responsive. Additions where V10 now provides data and a screen exists: fleet-health on Overview, heatmap and false-positives on Safety, idle report and export on Reports, high-priority steps in the incident drawer, video embed (if the contract is usable). New screens only where V10 offers a full contract: Maintenance reminders, Alarm rules, Report schedules, Audit log, Screen/Menu management. Previously blocked writes (devices, groups, geofences, commands, trips) stay blocked until their semantics are confirmed — they're listed in `missing-backend-apis.md`.
Optional cleanup: delete the unmounted sample-data modules listed in `project-audit.md` §4 (separate, reviewable change).

## Phase 8 — Python client (architecture only)

- `src/services/python/python-config.ts` (`NEXT_PUBLIC_PYTHON_API_BASE_URL`, timeout), `python-api-client.ts` = `createApiClient({ baseUrl: PYTHON_BASE_URL, prefix: "" , name: "python" })` — same token, same refresh, same tenant injection, no own login. `index.ts` exports the client only; **no endpoints** until D7.
- Adapted to the existing layout (the brief's `src/services/...` and `src/context/...` paths map to `src/features/drive-vision/api/` and the existing stores; no duplicate auth context is created).
- Unit tests: token reuse, tenant header, timeout, error normalisation, refresh shared with the BFF client.

## Phase 9 — Assistant / AI review

Document the BFF assistant (permission `device.read`, `AnswerDto.simulated`, intents enum), keep it as is, and list which screens might later use Python APIs — no speculative features.

## Phases 10–13

- **10 Responsive:** browser checks at 320, 375, 390, 768, 1024, 1440 px for shell, switcher, dashboard, tables, dialogs, maps, driver screens — needs a browser session; fixes limited to overflow/clipping/touch targets.
- **11 Security/tenant isolation:** test matrix per role from the brief; 401/403/`TENANT_REQUIRED`/`TENANT_ACCESS_DENIED`/conflicting `tenantId` vs `X-Tenant-Id`. Read-only probes first; writes only in the D1 test tenant. Cases without accounts are reported as blocked.
- **12 QA:** typecheck, lint, unit, contract (V10), build, bundle scan for secrets, regression of login/refresh/logout/driver screens.
- **13 Docs:** the nine documents listed in the brief + final report.

---

## Order and dependencies

```
P0 ✅ → P1 (docs) → P2 (auth, types, client seam) → P3 (resolver) → P5 (tenant context)
                                                              ↘ P4 (platform dashboard; needs P5 header injection for tenant mode)
                                                                 P6 (needs P3 + P5)
P7 per screen after P3/P5 · P8 after P2 seam (independent of D7 for structure) · P9 any time
P10–P12 need a browser session and D1 for meaningful results
```

Highest-risk item: **C1 + C2** (no admin can sign in / get access under V10). Phase 2–3 fix both and should land together.
