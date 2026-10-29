# SafeFare AI — API inventory

Source: `GET http://185.193.19.156:9096/v3/api-docs` (title "Safe-Fare Fleet BFF", version v1), downloaded 2026-10-27. There is one OpenAPI group (`/v3/api-docs/swagger-config` lists only `/v3/api-docs`). **82 operations on 55 paths**, all under `/api/v1`, with a global `bearerAuth` requirement and **no per-operation overrides** (re-checked against the live spec 2026-10-27). In practice `/auth/login` and `/auth/refresh` work without a bearer token, while `/auth/logout` returns 401 "Authentication required" without one — the client sends it authenticated.

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
- **There is no driver entity and no link between a user and a driver or device.** A "Driver" role can be created as a role, but the backend has no way to say which vehicle or records belong to that user.

## Integration status (2026-10-27, after Phase 2)

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
| Not used: POST `/commands`, POST `/devices/transfer`, device/group writes, DELETE `/users/{id}`, role writes, `/menus` admin, geofence POST/PUT, `/video/sdk-token`, `/alarms/routine/recent`, `/devices/{id}/passthrough-data`, `/vendor-users*`, `/renewals`, `/voices*`, PATCH `/reference/alarm-types/{id}` | — | Deliberately not integrated — see `missing-backend-apis.md` #19–#27 |

## Endpoints by controller

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
