# V10 permission matrix (frontend)

Generated 2026-11-02 from the code: `src/features/drive-vision/access/access-policy.ts` (registries) and its resolver run on the fixtures in `tests/helpers/identities.cjs`. Every code is checked against `docs/openapi/api-docs-v10.json` by `tests/access-v10.test.cjs`.

**The BFF authorises every request.** This matrix is what the UI *offers*; it never replaces backend enforcement.

## Rules

1. **Identity source:** `GET /api/v1/me/permissions` only (`identity.ts`). `GET /me` is profile display.
2. **Platform:** Safe-Fare Admin ⇔ `platform === true` (literal). Platform administration additionally needs `tenant.all`. A role code never implies platform access; a missing flag is `false`.
3. **Tenant ADMIN** ⇔ `platform === false` and `roleCode === "ADMIN"` — display only; access comes from its permissions (the backend gives it every tenant permission).
4. **Screens / features / actions** open only through the exact V10 codes below. An action is offered only on a screen the user can open.
5. **Role codes only narrow:** the driver app (My Work) is for DRIVER logins that are not platform; Settings is not shown to DRIVER logins.
6. **Server `screens`** (`MyScreenDto`) never open anything. A mapped screen with `readOnly: true` removes its write actions; an operation with `allowed: false` removes actions needing that code.
7. **Fail closed:** no identity, a non-object payload, or an empty permission set → no screen at all ("no permissions" panel).

## Screens

| Screen | Route | Requires | Audience | V10 evidence |
|---|---|---|---|---|
| overview | `/drive-vision/overview` | `device.read` | all | `GET /dashboard/overview` |
| monitoring | `/drive-vision/monitoring` | `device.read` | all | `GET /monitor/realtime` |
| video | `/drive-vision/video` | `video.playback` | all | `GET /devices/{id}/recordings` |
| trips | `/drive-vision/trips` | `track.read` | all | `GET /trips` |
| reports | `/drive-vision/reports` | `report.read` | all | `GET /reports/mileage` |
| vehicles | `/drive-vision/vehicles` | `device.read` | all | `GET /devices` |
| drivers | `/drive-vision/drivers` | `driver.read` | all | `GET /drivers` |
| dispatch | `/drive-vision/dispatch` | `dispatch.read` | all | `GET /dispatches` |
| workforce | `/drive-vision/workforce` | `workforce.read` | all | `GET /shifts`, `GET /leave-requests` |
| alerts | `/drive-vision/alerts` | `alarm.read` | all | `GET /alerts` |
| safety | `/drive-vision/safety` | `alarm.read` | all | `GET /safety/analytics` |
| geofences | `/drive-vision/geofences` | `geofence.read` | all | `GET /geofences` |
| commands | `/drive-vision/devices/commands` | `command.send` | all | `GET /commands` |
| users | `/drive-vision/users` | `user.read` | all | `GET /users` |
| settings | `/drive-vision/settings` | signed in (non-empty permission set) | staff | `GET /me/preferences`, `PATCH /me` |
| myWork | `/drive-vision/my-work` | `own.data.read` + `driver.app` (`driver.app` observed: requiredPermissionCode of every driver menu in GET /me/menus, live DRIVER login 2026-10-29) | driver | `GET /driver/me` |

## Shell features

| Feature | Requires | V10 evidence |
|---|---|---|
| assistant | `device.read` | `GET /assistant/prompts`, `POST /assistant/ask` |
| recordSearch | `device.read` | `GET /search` |

## Actions (operation level)

| Action | Screen | Requires | Tenant-scoped write | V10 operations |
|---|---|---|---|---|
| `drivers.create` | drivers | `driver.create` | yes | `POST /drivers` |
| `drivers.update` | drivers | `driver.update` | yes | `PUT /drivers/{id}`, `POST /drivers/{id}/assignments`, `POST /drivers/{id}/assignments/{assignmentId}/end` |
| `drivers.delete` | drivers | `driver.delete` | yes | `DELETE /drivers/{id}` |
| `dispatch.create` | dispatch | `dispatch.create` | yes | `POST /dispatches` |
| `dispatch.update` | dispatch | `dispatch.update` | yes | `PUT /dispatches/{id}`, `POST /dispatches/{id}/cancel`, `POST /dispatches/{id}/swap-requests` |
| `swaps.decide` | dispatch | `dispatch.update` | yes | `POST /swap-requests/{id}/approve`, `POST /swap-requests/{id}/reject` |
| `leave.create` | workforce | `workforce.create` | yes | `POST /leave-requests` |
| `leave.decide` | workforce | `workforce.update` | yes | `POST /leave-requests/{id}/approve`, `POST /leave-requests/{id}/reject` |
| `alerts.handle` | alerts | `alarm.handle` | yes | `POST /alerts/{id}/acknowledge`, `POST /alerts/{id}/comments`, `POST /alerts/{id}/resolve`, `POST /alerts/{id}/dismiss`, `POST /alerts/{id}/reopen` |
| `geofences.delete` | geofences | `geofence.delete` | yes | `DELETE /geofences/{id}` |
| `video.export` | video | `video.playback` | yes | `POST /video/exports` |
| `users.create` | users | `user.create` | yes | `POST /users` |
| `users.update` | users | `user.update` | yes | `PUT /users/{id}`, `PATCH /users/{id}/status`, `POST /users/{id}/unlock`, `POST /users/{id}/password` |
| `settings.manage` | settings | signed in (non-empty permission set) | no | `PATCH /me`, `PUT /me/preferences` |
| `driver.selfService` | myWork | `own.data.read` | no | `PATCH /driver/me`, `POST /driver/shifts/start`, `POST /driver/shifts/end`, `POST /driver/leave-requests`, `POST /driver/leave-requests/{id}/cancel`, `POST /driver/dispatches/{id}/accept`, `POST /driver/dispatches/{id}/start`, `POST /driver/dispatches/{id}/complete`, `POST /driver/dispatches/{id}/decline`, `POST /driver/dispatches/{id}/swap-requests`, `POST /driver/checklists` |
| `account.password` | shell | signed in (non-empty permission set) | no | `POST /me/password` |
| `notifications.markRead` | shell | signed in (non-empty permission set) | no | `POST /notifications/{id}/read`, `POST /notifications/{id}/unread`, `POST /notifications/read-all` |

## Resolved access per identity

\* Synthetic fixtures: the Fleet Owner, Dispatcher and Viewer role codes are **unconfirmed** (no test accounts), so their fixtures use `TEST_*` codes and illustrative permission sets. Safe-Fare Admin and tenant ADMIN follow the brief (not observed live). Driver is the live 2026-10-29 fixture. The table shows how the resolver treats those permission sets — **not** what the backend grants these roles.

| Identity | platform | roleCode | permissions |
|---|---|---|---|
| Safe-Fare Admin | true | `ADMIN` | all 63 V10 codes |
| Tenant ADMIN | false | `ADMIN` | 62 codes (every code except `tenant.all`) |
| Fleet Owner* | false | `TEST_FLEET_OWNER` | `device.read`, `group.read`, `track.read`, `alarm.read`, `report.read`, `driver.read`, `driver.create`, `driver.update`, `dispatch.read`, `dispatch.create`, `dispatch.update`, `workforce.read`, `workforce.create`, `workforce.update` |
| Dispatcher* | false | `TEST_DISPATCHER` | `device.read`, `driver.read`, `dispatch.read`, `dispatch.create`, `dispatch.update`, `workforce.read` |
| Viewer* | false | `TEST_VIEWER` | `alarm.read`, `alarm.rule.read`, `audit.read`, `device.read`, `dispatch.read`, `driver.read`, `geofence.read`, `group.read`, `maintenance.read`, `report.read`, `role.permission.read`, `role.read`, `track.read`, `user.read`, `vendor.user.read`, `voice.read`, `workforce.read` |
| Driver | false | `DRIVER` | `driver.app`, `own.data.read` |

### Screens

| Screen | Safe-Fare Admin | Tenant ADMIN | Fleet Owner* | Dispatcher* | Viewer* | Driver |
|---|---|---|---|---|---|---|
| overview | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| monitoring | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| video | ✅ | ✅ | — | — | — | — |
| trips | ✅ | ✅ | ✅ | — | ✅ | — |
| reports | ✅ | ✅ | ✅ | — | ✅ | — |
| vehicles | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| drivers | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| dispatch | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| workforce | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| alerts | ✅ | ✅ | ✅ | — | ✅ | — |
| safety | ✅ | ✅ | ✅ | — | ✅ | — |
| geofences | ✅ | ✅ | — | — | ✅ | — |
| commands | ✅ | ✅ | — | — | — | — |
| users | ✅ | ✅ | — | — | ✅ | — |
| settings | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| myWork | — | — | — | — | — | ✅ |
| *platform administration* (`canAccessPlatform`) | ✅ | — | — | — | — | — |

### Features and actions

| Feature / action | Safe-Fare Admin | Tenant ADMIN | Fleet Owner* | Dispatcher* | Viewer* | Driver |
|---|---|---|---|---|---|---|
| assistant | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| recordSearch | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `drivers.create` | ✅ | ✅ | ✅ | — | — | — |
| `drivers.update` | ✅ | ✅ | ✅ | — | — | — |
| `drivers.delete` | ✅ | ✅ | — | — | — | — |
| `dispatch.create` | ✅ | ✅ | ✅ | ✅ | — | — |
| `dispatch.update` | ✅ | ✅ | ✅ | ✅ | — | — |
| `swaps.decide` | ✅ | ✅ | ✅ | ✅ | — | — |
| `leave.create` | ✅ | ✅ | ✅ | — | — | — |
| `leave.decide` | ✅ | ✅ | ✅ | — | — | — |
| `alerts.handle` | ✅ | ✅ | — | — | — | — |
| `geofences.delete` | ✅ | ✅ | — | — | — | — |
| `video.export` | ✅ | ✅ | — | — | — | — |
| `users.create` | ✅ | ✅ | — | — | — | — |
| `users.update` | ✅ | ✅ | — | — | — | — |
| `settings.manage` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `driver.selfService` | — | — | — | — | — | ✅ |
| `account.password` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `notifications.markRead` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Tenant context

| | Safe-Fare Admin | Tenant ADMIN | Fleet Owner* | Dispatcher* | Viewer* | Driver |
|---|---|---|---|---|---|---|
| `hasTenantContext` | — | ✅ | ✅ | ✅ | ✅ | ✅ |

Safe-Fare Admin has no tenant until one is selected (Phase 5), so `needsTenantSelection(access, action)` is true for its tenant-scoped writes. **Phase 2–3 does not change those writes** (they're still offered and would answer 400 `TENANT_REQUIRED`); the 26 affected operations are listed in `v10-api-frontend-mapping.md` as PARTIALLY_INTEGRATED.

## Server routePath → app route

Only values the backend has returned, plus the app's own `/drive-vision/…` routes (1:1). Anything else is "unmapped" (reported in `access.unmappedServerPaths`, opens nothing).

| routePath | App route | Source |
|---|---|---|
| `/driver/work` | `/drive-vision/my-work` | live DRIVER `/me/menus`, 2026-10-29 |
| `/driver/shifts` | `/drive-vision/my-work/shifts` | live DRIVER `/me/menus`, 2026-10-29 |
| `/driver/leave` | `/drive-vision/my-work/leave` | live DRIVER `/me/menus`, 2026-10-29 |
| `/driver/checklist` | `/drive-vision/my-work/checklist` | live DRIVER `/me/menus`, 2026-10-29 |
| `/driver/safety` | `/drive-vision/my-work/safety` | live DRIVER `/me/menus`, 2026-10-29 |
| `/driver/profile` | `/drive-vision/my-work/profile` | live DRIVER `/me/menus`, 2026-10-29 |
| `/driver/notifications` | — (no page: notifications live in the header bell) | live DRIVER `/me/menus`, 2026-10-29 |
| `/dashboard` | `/drive-vision/overview` | admin `/me/menus`, 2026-10-27 |
| `/alarms` | `/drive-vision/alerts` | admin `/me/menus`, 2026-10-27 |
| `/reports` | `/drive-vision/reports` | admin `/me/menus`, 2026-10-27 |

The `menuKey` catalogue is still undocumented (D3), so `menuKey` is parsed but not used for routing.

## V10 codes not used by the frontend yet

`alarm.rule.create`, `alarm.rule.delete`, `alarm.rule.read`, `alarm.rule.update`, `audit.read`, `device.create`, `device.delete`, `device.update`, `geofence.create`, `geofence.update`, `group.create`, `group.delete`, `group.read`, `group.update`, `maintenance.create`, `maintenance.read`, `maintenance.update`, `menu.manage`, `permission.manage`, `reference.manage`, `renewal.manage`, `report.schedule`, `role.manage`, `role.permission.create`, `role.permission.delete`, `role.permission.read`, `role.permission.update`, `role.read`, `tenant.all`, `trip.create`, `trip.delete`, `trip.update`, `user.delete`, `vendor.user.create`, `vendor.user.delete`, `vendor.user.read`, `vendor.user.update`, `video.live`, `voice.create`, `voice.read`.

They belong to operations without a screen yet (see `v10-api-frontend-mapping.md`); `tenant.all` is used by `canAccessPlatform`.

## Phase 7 additions — platform configuration (Safe-Fare Admin only)

Product rule: only the Safe-Fare Admin configures roles and permissions in the frontend. Every row below is `platformOnly` (`platform === true`). A tenant ADMIN, Fleet Owner, Operator, Dispatcher, Viewer or Driver gets none of them, even holding the codes. That is tested, including a tenant ADMIN with every V10 code.

| Kind | Key | V10 code(s) | Operation(s) |
|---|---|---|---|
| Screen | `roles` (`/drive-vision/platform/roles`) | `role.read` | GET /roles |
| Screen | `permissions` (`/drive-vision/platform/permissions`) | `permission.manage` (stricter than the read) | POST /permissions, PUT/DELETE /permissions/{code} |
| Widget | `roles.permissions` | `role.permission.read` (+ `platform`) | GET /roles/{id}/permissions |
| Widget | `permissions.catalog` | `role.permission.read` or `permission.manage` (+ `platform`) | GET /permissions |
| Action | `roles.create` / `roles.update` / `roles.delete` | `role.manage` | POST /roles · PUT /roles/{id} · DELETE /roles/{id} |
| Action | `rolePermissions.add` | `role.permission.create` | POST /roles/{id}/permissions |
| Action | `rolePermissions.remove` | `role.permission.delete` | DELETE /roles/{id}/permissions |
| Action | `permissions.create` / `.update` / `.delete` | `permission.manage` | POST /permissions · PUT/DELETE /permissions/{code} |

These actions are **not** tenant writes (`tenantWrite: false`): they target global definitions, are sent without a tenant header, and aren't blocked in all-tenants mode.

Server routePaths now mapped (from the Safe-Fare Admin `GET /me/permissions`, 2026-11-02): `/platform/roles` → Global Roles, `/platform/permissions` → Permission Catalogue, `/tenants` → Tenants.

`role.read`, `role.manage`, `role.permission.read`, `role.permission.create`, `role.permission.delete` and `permission.manage` are now used by the frontend. `role.permission.update` (PUT replace) is still unused, by design.


## Phase 8 additions — drivers and assignments

| Kind | Key | V10 code | Operation(s) |
|---|---|---|---|
| Screen | `drivers` | `driver.read` | GET /drivers (also /drivers/{id}, /drivers/{id}/assignments, /drivers/licence-expiries) |
| Action | `drivers.create` | `driver.create` | POST /drivers |
| Action | `drivers.update` | `driver.update` | PUT /drivers/{id}, POST /drivers/{id}/assignments, POST …/assignments/{assignmentId}/end |
| Action | `drivers.delete` | `driver.delete` | DELETE /drivers/{id} |
| Widget | `drivers.safety` | `alarm.read` | GET /drivers/{id}/safety-score, /safety-events |
| Widget | `drivers.deviceChoices` | `device.read` | GET /devices (assign dialog vehicle picker) |
| Widget | `vehicles.driverAssignments` | `driver.read` | GET /devices/{id}/driver-assignments (vehicle detail, assign dialog) |

Without a widget's code, the request isn't sent; the panel says which code is needed. All driver writes are tenant writes (Phase 5 classes A/B/C): blocked for the Safe-Fare Admin in all-tenants mode.
