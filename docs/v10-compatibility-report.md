# V10 compatibility report (Phase 1)

> **Update 2026-11-02, after Phases 2–3.** §3.1's login and `GET /me` items are resolved (Safe-Fare Admin login omits `tenantCode`; authorisation reads `GET /me/permissions`). All 15 type-only response fields in §3.3 are now declared. Current totals: INTEGRATED 100 · PARTIALLY_INTEGRATED 26 (the tenant-scoped writes, unchanged by design until Phase 5) · NOT_INTEGRATED 79 · BACKEND_BLOCKED 15. Call sites: 134 (incl. `GET /me/permissions`); 127 reached by a screen; `GET /me/menus` is now service-only. None of this is verified live. See `phase2-3-auth-permission-report.md`. The rest of this report is the Phase 1 snapshot.

Date: 2026-11-02 · Spec: `docs/openapi/api-docs-v10.json` (164 paths · 220 operations · 297 schemas) vs. the previous `api-docs-2026-10-29.json` (135 · 172 · 224).
Per-operation detail: [`v10-api-frontend-mapping.md`](v10-api-frontend-mapping.md). Enforced by `tests/v10-contract.test.cjs`.

**How this was verified.** Static, not runtime. Every BFF call site in `src/features/drive-vision/api/` was resolved with the TypeScript type checker: method, path (including literal-union `${…}` spans such as `"approve" | "reject"`), the query object's type, the body's type and the response type argument. Each was compared field by field (recursively) with V10's parameters, request schema and 2xx `data` schema, including value sets written as `enum` **or** as V10's `pattern: "A|B|C"`. In addition, 43 service calls for fleet / admin / account / auth / refresh were executed against a stub `fetch`, and the built request (URL, query, body, bearer) was checked against V10. **Nothing was sent to the BFF in this phase**, so runtime behaviour of V10 (status codes, tenant rules, data) is not verified here.

---

## 1. Headline numbers

| | Count |
|---|---|
| V10 operations mapped | **220 / 220** |
| Frontend BFF call sites (type-checker scan) | **133** (one per operation) |
| … reached from a mounted screen | **127** |
| … service method exists, no screen calls it | **6** |
| Call sites with a **contract error** against V10 (path, method, params, body, response field, value set, auth) | **0** |
| Call sites with a **contract warning** | **1** (`PUT /me/preferences`, type-level only, §3.3) |
| Integrations needing a **functional change** for V10 (status PARTIALLY_INTEGRATED) | **28** |
| Integrated but **backend-blocked** | **1** (`GET /commands/{id}`, last seen 500) |

> **Correction to Phase 0.** `project-audit.md` and `v10-api-inventory.md` said 134 integrated operations. The regex scan used then mapped `GET /geofences/events` to `GET /geofences/{id}`, which is not called. The correct figures are **133 operations with call sites, 127 reached by a screen**.

Status totals (mapping doc): INTEGRATED **98** · PARTIALLY_INTEGRATED **28** · NOT_INTEGRATED **79** · BACKEND_BLOCKED **15** · NOT_APPLICABLE **0**.

---

## 2. Existing integrations compatible with V10

**All 133 call sites are wire-compatible with V10.** No endpoint the frontend calls was removed, renamed or re-methoded. No query parameter it sends is unknown to V10. No V10-required query parameter is missing. No request field it sends is outside the V10 schema. No V10-required request field is missing from its types. Every response field it reads exists in V10. The 30 literal-typed fields (for example `StatusRequest.status`, `ResolveRequest.outcome`, report `kind`, notification `read`/`unread`) all stay inside V10's value sets. Bearer handling is correct: only login and refresh go without a token.

98 operations are classified **INTEGRATED**. Their contract matches, and their current use has no unmet V10 requirement (all tenant-scoped reads, self-scoped `/me`, `/notifications` and `/driver/**` operations, logout and refresh, plus two read-style POSTs). The full list is in the mapping doc.

---

## 3. Integrations requiring changes

### 3.1 Functional changes (28 × PARTIALLY_INTEGRATED)

| Operation(s) | Required change | Phase |
|---|---|---|
| `POST /auth/login` | `LoginRequest.tenantCode` is **optional** in V10 (Safe-Fare Admin signs in without it). The login form requires it and always sends it. Omit the key for admin sign-in; never send `""`. | 2 |
| `GET /me` | V10 adds `CurrentUserDto.platform`. Identity and authorisation must come from `GET /me/permissions` (`platform`, `homeTenantId`, `tenantId`, `roleCode`, `permissions`, `screens`), not from `role.code` mapping (`PLATFORM_ADMIN` is obsolete). | 2–3 |
| **26 tenant-scoped writes:** users `POST`, `PUT /{id}`, `PATCH /{id}/status`, `POST /{id}/unlock`, `POST /{id}/password` · drivers `POST`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/assignments`, `POST /{id}/assignments/{aid}/end` · dispatches `POST`, `PUT /{id}`, `POST /{id}/cancel`, `POST /{id}/swap-requests` · swap-requests approve / reject · leave-requests `POST`, approve / reject · alerts acknowledge / comments / dismiss / reopen / resolve · `DELETE /geofences/{id}` · `POST /video/exports` | V10: Safe-Fare Admin has no tenant, so **create/update/delete without `tenantId` / `X-Tenant-Id` answer 400 `TENANT_REQUIRED`**. The client never sends a tenant selector. Tenant users are unaffected (they may omit it). | 5 |

### 3.2 Backend-blocked integration (1)

`GET /commands/{id}` (`fleetService.getCommand`, Device Commands detail). The contract is compatible (V10 adds an optional `refresh` query flag). The BFF answered **500 for every id** on 2026-10-27 (#28, `evidence/backend-defect-commands-detail-500.md`). This has **not been re-tested on V10**.

### 3.3 Type-only gaps (no wire impact; fix when the types are touched)

| Item | Detail |
|---|---|
| `PUT /me/preferences` request type | V10 requires `theme`, `homeModules`, `deviceInfoFields`, `videoLayout`, `trackAlarmTypeIds`, `expiryReminderMode`. `PreferencesDto` marks them optional. At runtime the screen sends back the full object it loaded (a reversible round-trip was verified live on 2026-10-27), so the request is valid. The type just doesn't enforce it. |
| V10 response fields not declared in frontend types (15 occurrences) | `CurrentUserDto.platform` (login, refresh, `GET`/`PATCH /me`) · `RoleDto.fullAccess`, `.tenantId`, `.activeUsers` · `PermissionDto.scope` · `ActionRow.stepNo` (alert detail, actions, and all 5 handling responses). They arrive at runtime but are invisible to TypeScript. |
| Undeclared tenant columns | 40 list operations say in their description that "every row also has `tenantId` and `tenantName`", but these fields are **not in their schemas** (e.g. `GET /devices`, `/users`, `/drivers`, `/alerts`, `/trips`, reports, alarms). Frontend types don't have them. They're needed for Safe-Fare Admin's all-tenant views (Phase 4/5). |
| Newly enumerated values rendered generically | Values such as dispatch / swap / leave `CANCELLED`, command `SENT|PARTIAL|SUCCESS|FAILED`, target statuses, alert `ACKNOWLEDGED|RESOLVED|DISMISSED`, availability `AVAILABLE|ON_SHIFT|ON_TRIP|ON_LEAVE` and the 10 notification types are shown as raw or humanised text with a neutral tone. No crash, no contract issue; Phase 7 polish. |

### 3.4 Service-only methods (6; not counted as integrated)

These methods exist in `src/features/drive-vision/api/`, but no screen calls them: `GET /dashboard/vehicles`, `/dashboard/device-health`, `/dashboard/active-trips` (Overview uses the combined `GET /dashboard/overview`), `GET /alerts/{id}/evidence` and `/alerts/{id}/actions` (the drawer gets both inline from `GET /alerts/{id}`), and `GET /driver/dispatches/{id}` (My Work uses the list). Their contracts are compatible. They're candidates for removal or for future use.

---

## 4. New operations in V10 (48, none integrated)

| Area | Operations (required permission) | Target |
|---|---|---|
| Identity | `GET /me/permissions` (signed-in) | Phase 2–3 |
| Platform | `GET /platform/tenants`, `POST /platform/switch-tenant` (`tenant.all`) | Phase 4–5 |
| Roles & permissions | `GET /roles/permission-matrix`, `GET /roles/{id}/permissions` (`role.permission.read`) · `POST` / `DELETE /roles/{id}/permissions` (`role.permission.create` / `.delete`) · `POST /permissions`, `PUT` / `DELETE /permissions/{code}` (`permission.manage`) | Phase 6 |
| Screens | `GET /screens`, `GET /screens/{menuKey}/operations` (`role.permission.read` or `menu.manage`) · `PUT /menus/{id}/operations` (`menu.manage`) | Phase 3 / 7 |
| Maintenance | 7 × `/maintenance-reminders…` (`maintenance.read` / `.create` / `.update`) | Phase 7 (new screen) |
| Alarm rules | 5 × `/alarm-rules…` (`alarm.rule.read` / `.create` / `.update` / `.delete`) | Phase 7 (new screen) |
| Report schedules | 6 × `/report-schedules…` incl. `/{id}/run` (`report.schedule`) | Phase 7 (new screen) |
| Trips (writes) | `POST /trips`, `PUT` / `DELETE /trips/{id}` (`trip.create` / `.update` / `.delete`) | Phase 7, needs test tenant |
| Alerts | `GET` / `POST /alerts/{id}/high-priority-steps` (`alarm.read` / `alarm.handle`) | Phase 7 |
| Analytics & reports | `GET /safety/heatmap`, `/safety/false-positives` (`alarm.read`) · `GET /reports/idle`, `/reports/export` (`report.read`) · `GET /dashboard/fleet-health` (`device.read`) | Phase 4 / 7 |
| Other | `GET /audit-logs` (`audit.read`) · `GET /assets/tree` (`device.read`) · `GET /reference/statuses` (signed-in: value sets, transitions, conventions) · `GET /video/embed` (`video.live` or `video.playback`) · `GET` / `POST` / `DELETE /me/push-tokens` (signed-in; platforms ANDROID / IOS / WEB) | Phase 7 / product decision |

`PUT /roles/{id}/permissions` already existed, but its response changed from `RoleDto` to `RolePermissionsDto`. It isn't used by the frontend.

---

## 5. Missing frontend functionality

- **Identity / access (blocking for V10):** Safe-Fare Admin sign-in; `GET /me/permissions`; permission-based resolver; `platform` handling; removal of the `PLATFORM_ADMIN` mapping (under V10 every `ADMIN` user currently resolves to "no access"); dynamic navigation from `screens`.
- **Tenancy:** tenant store, tenant selector injection, switcher in top bar and Tenant Management, data reload on switch, "all tenants" labelling of Safe-Fare Admin reads (tenant columns).
- **Screens that don't exist:** Tenant Management, Roles & Permission matrix, Screen/Menu Management, Maintenance, Alarm rules, Report schedules, Audit log, Reference Data, asset tree, Live Video.
- **Writes still not exposed** (see BACKEND_BLOCKED): device / group create / edit / delete, device transfer, geofence create / edit, command sending, user delete, alert assignment, renewals, voice upload. Group writes (`POST`/`PUT`/`DELETE /groups`) and alarm-type edits (`PATCH /reference/alarm-types/{id}`) have usable contracts but are NOT_INTEGRATED.
- **Vendor accounts:** `/vendor-users` (6). Whether these are the brief's "Sub-Accounts" is unconfirmed.

---

## 6. Schema changes (2026-10-29 → V10)

- **+73 schemas, 0 removed.** New non-envelope schemas: `MyPermissionsDto`, `MyScreenDto`, `ResourceAccessDto`, `AllowedOperationDto`, `ScreenDto`, `OperationDto`, `OperationRequest(s)`, `TenantDto`, `TenantSelectionDto`, `SwitchTenantRequest`, `PermissionMatrixDto`, `RolePermissionsDto`, `CreatePermissionRequest`, `UpdatePermissionRequest`, `TripRequest`, `ScheduleRequest` / `Dto`, `ReminderRequest` / `Dto`, `UpcomingDto`, `AlarmRuleRequest` / `Dto`, `AlarmTypeRef`, `StepRequest` / `Dto` / `StepsDto`, `EmbedDto`, `HeatmapDto`, `HeatCell`, `FalsePositiveDto`, `FpRow`, `IdleReport`, `IdleRow`, `CatalogDto`, `Conventions`, `StatusSet`, `Transition`, `FleetHealthDto`, `Issue`, `AuditDto`, `TreeDto`, `GroupNode`, `PushTokenRequest` / `Dto`, `TokenRef`, `ErrorResponse`.
- **15 existing schemas changed, all additive or tightening:**
  - `LoginRequest`: `tenantCode` no longer required.
  - `CurrentUserDto`: `+platform`.
  - `RoleDto`: `+fullAccess`, `+tenantId`, `+activeUsers`.
  - `PermissionDto`: `+scope`.
  - `ActionRow`: `+stepNo`.
  - `RolePermissionsRequest.permissionCodes`: now `uniqueItems`, max 300.
  - Free strings became enums on `DriverDto.status`, dispatch `Row.status`, `SwapRow.status`, `LeaveDto.leaveType` and `.status`, `CommandDto.status`, `TargetDto.status`, `AlertRow.handlingStatus`, `NotificationDto.type`, `AvailabilityDto.status`.
- **Envelope / errors:** `ErrorResponse` is now a named schema. Error codes include `TENANT_REQUIRED`, `INVALID_TENANT`, `TENANT_ACCESS_DENIED`, `PLATFORM_PERMISSION`, `PROTECTED_ROLE`, `ROLE_IN_USE`, `PERMISSION_CODE_TAKEN`, `MENU_HAS_CHILDREN`, `CONFIRMATION_REQUIRED`. The client already surfaces `extend.errorCode` generically.
- **Contracts still unchanged that block writes:** `GeofenceRequest.ruleTypes` / `areaType` / `colorIndex` codes (#22), `DeviceRequest.confirmChargeableChange` (#19), `TransferRequest` semantics (#26), `AssignRequest` used for alert assignment (#32). `CommandRequest.type` is now an enum, but `params` is still free-form (#25 partly answered).

---

## 7. Permission changes

- **The previous spec documented no permissions (0 / 172 operations).** V10 documents a requirement on **all 220**: 2 public, 21 "any signed-in user", and the rest across **63 distinct codes**. Some operations accept alternatives, e.g. `video.live or video.playback`, `role.permission.read or menu.manage`.
- Permissions the existing screens depend on (from integrated operations):

| Screen | Reads | Writes |
|---|---|---|
| Overview | `device.read`, `alarm.read`, `group.read` | — |
| Live Monitoring | `device.read` | — |
| Trips & Tracking | `track.read`, `device.read`, `video.playback` or `alarm.read` (event markers) | — |
| Reports | `report.read`, `device.read` | — |
| Historical Video | `video.playback`, `device.read` | `video.playback` (export) |
| Vehicles & Assets | `device.read`, `group.read`, `track.read`, `driver.read`, `alarm.read` | — |
| Drivers | `driver.read`, `device.read`, `alarm.read` | `driver.create` / `.update` / `.delete` |
| Dispatch | `dispatch.read` | `dispatch.create` / `.update` (`dispatch.read` for check) |
| Workforce | `workforce.read` | `workforce.create` / `.update` |
| Alerts & Events | `alarm.read`, `device.read` | `alarm.handle` |
| Safety Analytics | `alarm.read` | — |
| Geofences | `geofence.read`, `group.read`, `device.read` | `geofence.delete` |
| Device Commands | `command.send` (**even to read history**), `device.read` | — |
| Users & Sub-Accounts | `user.read`, `role.read`, `role.permission.read` or `permission.manage` | `user.create` / `.update` |
| AI Assistant, global search | `device.read` | — |
| My Work (driver) | `own.data.read` | `own.data.read` |
| Settings, notifications, session | signed-in | signed-in |

- Frontend implications for Phase 3:
  - The access policy grants screens and actions by role code, so none of these codes are consulted today.
  - My Work is gated on `driver.app`, while V10 documents `own.data.read` for `/driver/**`. The live Driver login carried both on 2026-10-29.
  - A user with read-only access to Device Commands cannot read history without `command.send`.
- Configuring permissions needs `role.permission.update` / `.create` / `.delete` and `permission.manage`. Platform endpoints need `tenant.all`. Who holds which code is a backend fact (D2/D5/D6). The spec lists the codes per operation, not per role.

---

## 8. Tenant-related changes

| Change | Frontend status |
|---|---|
| 218 / 220 operations accept `X-Tenant-Id` header or `?tenantId=` (all except login, refresh) | Never sent |
| Safe-Fare Admin: reads without a tenant span **all tenants**; writes without one → 400 `TENANT_REQUIRED` | Not handled (28 PARTIAL rows; unlabelled cross-tenant reads) |
| Tenant users: another tenant's id → 403 `TENANT_ACCESS_DENIED`; another tenant's record → 404 | Errors surface generically; nothing sends a foreign id |
| 40 list operations: rows carry undeclared `tenantId` / `tenantName` | Not typed or shown |
| `MyPermissionsDto.homeTenantId` / `tenantId`, `RoleDto.tenantId`, `PermissionMatrixDto.tenantId`, `RolePermissionsDto.tenantId` | Not read |
| `GET /platform/tenants` (`TenantDto`: id, code, name, status, timezone, users, devices, drivers, current) · `POST /platform/switch-tenant` → `TenantSelectionDto {tenantId, code, name, header}` | Not integrated |
| `LoginRequest.tenantCode` optional | Form still requires it |

The spec does **not** say whether `switch-tenant` changes server-side state or only validates and returns the selector to send (`header`), nor how a conflicting `tenantId` and `X-Tenant-Id` are resolved (D4, Phase 11).

---

## 9. Outstanding backend dependencies

| ID | Dependency | Blocks |
|---|---|---|
| D1 | Test accounts for Safe-Fare Admin, tenant ADMIN, Fleet Owner, Dispatcher, Viewer, Driver, and a test tenant where writes are allowed | Every runtime verification of V10, all writes |
| D2 | Exact role codes (none are in the spec; `ADMIN` merge is from the brief) | Role labels, test matrix |
| D3 | `menuKey` catalogue; meaning of `routePath` in `ScreenDto` / `MyScreenDto` | Dynamic navigation |
| D4 | `switch-tenant` semantics; content of `TenantSelectionDto.header`; `tenantId` vs `X-Tenant-Id` precedence | Tenant switching |
| D5 | `PermissionDto.scope` values; when `RolePermissionsDto.editable` / `RoleDto.fullAccess` are set | Permission matrix |
| D6 | Confirmation (and a test) that tenant ADMIN gets 403 on role-permission and permission writes | Phase 6 sign-off |
| D7 | Python Swagger, base URL, CORS, JWT validation, tenant header | Phases 8–9 |
| D8 | TLS for the BFF; authentication on `/v3/api-docs` | Production |
| #19 #22 #25 #26 #32 | Device writes (charges), geofence codes, command params, transfer semantics, alert assignment body (spec defect) | The corresponding writes |
| #28 | `GET /commands/{id}` 500. Re-test on V10 once D1 exists | Device Commands detail |
| — | Document the 40 "tenant columns" in the response schemas (currently description-only) | Typed all-tenant views |
| — | Confirm whether `/me/*`, `/notifications/*` and `/driver/**` writes need a tenant for Safe-Fare Admin (assumed not), and whether read-style POSTs (`/assistant/ask`, `/dispatches/check`) do | Phase 5 / 11 |
