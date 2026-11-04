# V10 API inventory — Safe-Fare Fleet BFF

Generated 2026-11-02 from `docs/openapi/api-docs-v10.json` (fetched from `GET http://185.193.19.156:9096/v3/api-docs`, OpenAPI 3.1.0, info.version `v1`).
Frontend usage is from a static scan of `src/` for `api.<method>("…")` call sites (dynamic `${id}/${action}` paths resolved by hand).

## Totals (verified against the file, not assumed)

| Metric | Expected (brief) | Actual V10 | Previous spec (2026-10-29) |
|---|---|---|---|
| Paths | 164 | **164** | 135 |
| Operations | 220 | **220** | 172 |
| Schemas | 297 | **297** | 224 |
| Operations used by the frontend | — | **133** call sites, 127 reached by a screen (Phase 1 correction; was 134 — see note) | — |

> **Phase 1 correction (2026-11-02).** The Phase 0 regex scan matched `GET /geofences/events` to `GET /geofences/{id}`; `GET /geofences/{id}` is not called. The type-checker scan in `tests/helpers/v10-contract.cjs` supersedes this table's **Frontend** column: see [`v10-api-frontend-mapping.md`](v10-api-frontend-mapping.md) for verified usage and status per operation.
| Operations new in V10 | — | **48** (none removed) | — |

## Global conventions (from `info.description`)

- **Envelope** `{code, msg, data, total, extend}`; `code` equals HTTP status. Errors: `extend = {errorCode, fieldErrors[], requestId}`; `requestId` = `X-Request-Id` header.
- **Auth**: global `bearerAuth` (HTTP bearer, JWT). Only `POST /auth/login` and `POST /auth/refresh` are public.
- **Tenant scope**: 218 / 220 operations accept `X-Tenant-Id` header / `tenantId` query. Safe-Fare Admin (signs in **without** `tenantCode`) has no tenant of its own: writes need `tenantId`/`X-Tenant-Id` or answer 400 `TENANT_REQUIRED`; **reads without it cover every tenant**. Tenant users may omit it; another tenant's id answers 403 `TENANT_ACCESS_DENIED`. Records of another tenant answer 404.
- `/driver/**` requires a user linked to a driver profile and only returns that driver's data.
- Status codes: 400 validation, 401 missing/expired token, 403 missing permission, 404 not found, 409 conflict/transition, 502/503/504 vendor or DB, 500 unexpected.
- Times ISO-8601 UTC, ranges `[from, to)`. Paging: `pageNumber` from 1, `pageSize` 1–100 (default 20).
- Vendor-backed reads report `extend.source` (VENDOR | LOCAL), `stale`, `fallbackReason` (e.g. `VENDOR_EMPTY`).

Legend: **Perm** = the operation's documented "Required permission". **T** = accepts tenant selector. `*` = required. **New** = not in the 2026-10-29 spec. **Frontend** = service file(s) calling it (blank = not integrated).


## alarm-controller (3 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/alarms/ai` | alarm.read | from*, to*, alarmTypeIds, deviceIds, pageNumber, pageSize |  | 200 [AlarmDto] | T |  | fleet-service.ts |
| GET | `/alarms/routine` | alarm.read | from*, to*, alarmTypeIds, deviceIds, pageNumber, pageSize |  | 200 [AlarmDto] | T |  | fleet-service.ts |
| GET | `/alarms/routine/recent` | alarm.read | alarmTypeIds, deviceIds, pageNumber, pageSize |  | 200 [AlarmDto] | T |  |  |

## alarm-rule-controller (5 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/alarm-rules` | alarm.rule.read | enabled, handlingMode, pageNumber, pageSize |  | 200 [AlarmRuleDto] | T | ✚ |  |
| POST | `/alarm-rules` | alarm.rule.create |  | AlarmRuleRequest | 200 AlarmRuleDto | T | ✚ |  |
| GET | `/alarm-rules/{id}` | alarm.rule.read | {id}* |  | 200 AlarmRuleDto | T | ✚ |  |
| PUT | `/alarm-rules/{id}` | alarm.rule.update | {id}* | AlarmRuleRequest | 200 AlarmRuleDto | T | ✚ |  |
| DELETE | `/alarm-rules/{id}` | alarm.rule.delete | {id}* |  | 200 object | T | ✚ |  |

## alert-controller (13 ops, 10 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/alerts` | alarm.read | from, to, status, openOnly, severity, alarmTypeIds, deviceIds, driverId, assigneeUserId, kind, keyword, pageNumber, pageSize |  | 200 [AlertRow] | T |  | alert-service.ts |
| GET | `/alerts/{id}` | alarm.read | {id}* |  | 200 AlertDetailDto | T |  | alert-service.ts |
| POST | `/alerts/{id}/acknowledge` | alarm.handle | {id}* | NoteRequest | 200 AlertDetailDto | T |  | alert-service.ts |
| GET | `/alerts/{id}/actions` | alarm.read | {id}* |  | 200 [ActionRow] | T |  | alert-service.ts |
| POST | `/alerts/{id}/assign` | alarm.handle | {id}* | AssignRequest | 200 AlertDetailDto | T |  |  |
| POST | `/alerts/{id}/comments` | alarm.handle | {id}* | CommentRequest | 200 AlertDetailDto | T |  | alert-service.ts |
| POST | `/alerts/{id}/dismiss` | alarm.handle | {id}* | NoteRequest | 200 AlertDetailDto | T |  | alert-service.ts |
| GET | `/alerts/{id}/evidence` | alarm.read | {id}* |  | 200 [EvidenceRow] | T |  | alert-service.ts |
| GET | `/alerts/{id}/high-priority-steps` | alarm.read | {id}* |  | 200 StepsDto | T | ✚ |  |
| POST | `/alerts/{id}/high-priority-steps` | alarm.handle | {id}* | StepRequest | 200 StepsDto | T | ✚ |  |
| POST | `/alerts/{id}/reopen` | alarm.handle | {id}* | NoteRequest | 200 AlertDetailDto | T |  | alert-service.ts |
| POST | `/alerts/{id}/resolve` | alarm.handle | {id}* | ResolveRequest | 200 AlertDetailDto | T |  | alert-service.ts |
| GET | `/devices/{id}/event-markers` | video.playback or alarm.read | {id}*, from, to |  | 200 [AlertRow] | T |  | insight-service.ts |

## asset-tree-controller (1 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/assets/tree` | device.read | vendorUserId |  | 200 TreeDto | T | ✚ |  |

## assistant-controller (2 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| POST | `/assistant/ask` | device.read |  | AskRequest | 200 AnswerDto | T |  | assistant-service.ts |
| GET | `/assistant/prompts` | device.read |  |  | 200 [Prompt] | T |  | assistant-service.ts |

## audit-controller (1 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/audit-logs` | audit.read | from, to, actorUserId, action, entityType, entityId, pageNumber, pageSize |  | 200 [AuditDto] | T | ✚ |  |

## auth-controller (3 ops, 3 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| POST | `/auth/login` | public |  | LoginRequest | 200 TokenResponse | — |  | auth-service.ts |
| POST | `/auth/logout` | none (any signed-in user) |  | RefreshRequest | 200 object | T |  | auth-service.ts |
| POST | `/auth/refresh` | public |  | RefreshRequest | 200 TokenResponse | — |  | client.ts |

## command-controller (5 ops, 3 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/commands` | command.send | type, deviceId, pageNumber, pageSize |  | 200 [CommandDto] | T |  | fleet-service.ts |
| POST | `/commands` | command.send |  | CommandRequest | 200 CommandDto | T |  |  |
| GET | `/commands/{id}` | command.send | {id}*, refresh |  | 200 CommandDto | T |  | fleet-service.ts |
| GET | `/commands/types` | command.send |  |  | 200 [Definition] | T |  | fleet-service.ts |
| GET | `/devices/{id}/passthrough-data` | device.read | {id}*, type*, from*, to* |  | 200 [PassThroughDto] | T |  |  |

## dashboard-controller (9 ops, 8 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/dashboard/active-trips` | device.read |  |  | 200 ActiveTrips | T |  | insight-service.ts |
| GET | `/dashboard/device-health` | device.read |  |  | 200 DeviceHealth | T |  | insight-service.ts |
| GET | `/dashboard/fleet-health` | device.read | offlineHours, lowBatteryPct, expiringDays |  | 200 FleetHealthDto | T | ✚ |  |
| GET | `/dashboard/fleet-status` | device.read |  |  | 200 [StatusSlice] | T |  | insight-service.ts |
| GET | `/dashboard/overview` | device.read |  |  | 200 OverviewDto | T |  | insight-service.ts |
| GET | `/dashboard/safety-events` | alarm.read | from, to |  | 200 SafetySummary | T |  | insight-service.ts |
| GET | `/dashboard/trends` | device.read | from, to |  | 200 [TrendDay] | T |  | insight-service.ts |
| GET | `/dashboard/vehicles` | device.read |  |  | 200 VehicleCounts | T |  | insight-service.ts |
| GET | `/devices/{id}/summary` | device.read | {id}* |  | 200 VehicleSummaryDto | T |  | insight-service.ts |

## device-controller (6 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/devices` | device.read | groupId, keyword, pageNumber, pageSize |  | 200 [DeviceDto] | T |  | fleet-service.ts |
| POST | `/devices` | device.create |  | DeviceRequest | 200 DeviceDto | T |  |  |
| GET | `/devices/{id}` | device.read | {id}* |  | 200 DeviceDto | T |  | fleet-service.ts |
| PUT | `/devices/{id}` | device.update | {id}* | DeviceRequest | 200 DeviceDto | T |  |  |
| DELETE | `/devices/{id}` | device.delete | {id}* |  | 200 object | T |  |  |
| POST | `/devices/transfer` | device.update |  | TransferRequest | 200 [DeviceDto] | T |  |  |

## dispatch-controller (12 ops, 12 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/dispatches` | dispatch.read | from, to, status, driverId, deviceId, pageNumber, pageSize |  | 200 [Row] | T |  | operations-service.ts |
| POST | `/dispatches` | dispatch.create |  | DispatchRequest | 200 Row | T |  | operations-service.ts |
| GET | `/dispatches/{id}` | dispatch.read | {id}* |  | 200 Row | T |  | operations-service.ts |
| PUT | `/dispatches/{id}` | dispatch.update | {id}* | DispatchRequest | 200 Row | T |  | operations-service.ts |
| POST | `/dispatches/{id}/cancel` | dispatch.update | {id}* | ReasonRequest | 200 Row | T |  | operations-service.ts |
| POST | `/dispatches/{id}/swap-requests` | dispatch.update | {id}* | SwapRequest | 200 SwapRow | T |  | operations-service.ts |
| GET | `/dispatches/{id}/verification` | dispatch.read | {id}* |  | 200 VerificationDto | T |  | operations-service.ts |
| POST | `/dispatches/check` | dispatch.read |  | DispatchRequest | 200 CheckResultDto | T |  | operations-service.ts |
| GET | `/dispatches/conflicts` | dispatch.read | from, to |  | 200 [ConflictDto] | T |  | operations-service.ts |
| GET | `/swap-requests` | dispatch.read | status, driverId, pageNumber, pageSize |  | 200 [SwapRow] | T |  | operations-service.ts |
| POST | `/swap-requests/{id}/approve` | dispatch.update | {id}* | DecisionRequest | 200 SwapRow | T |  | operations-service.ts |
| POST | `/swap-requests/{id}/reject` | dispatch.update | {id}* | DecisionRequest | 200 SwapRow | T |  | operations-service.ts |

## driver-app-controller (22 ops, 22 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/driver/assignment` | own.data.read |  |  | 200 AssignmentOverviewDto | T |  | driver-app-service.ts |
| GET | `/driver/checklist-template` | own.data.read |  |  | 200 [ChecklistItem] | T |  | driver-app-service.ts |
| GET | `/driver/checklists` | own.data.read | from, to, pageNumber, pageSize |  | 200 [ChecklistDto] | T |  | driver-app-service.ts |
| POST | `/driver/checklists` | own.data.read |  | ChecklistRequest | 200 ChecklistDto | T |  | driver-app-service.ts |
| GET | `/driver/dispatches` | own.data.read | from, to, status, pageNumber, pageSize |  | 200 [Row] | T |  | driver-app-service.ts |
| GET | `/driver/dispatches/{id}` | own.data.read | {id}* |  | 200 Row | T |  | driver-app-service.ts |
| POST | `/driver/dispatches/{id}/accept` | own.data.read | {id}* |  | 200 Row | T |  | driver-app-service.ts |
| POST | `/driver/dispatches/{id}/complete` | own.data.read | {id}* |  | 200 Row | T |  | driver-app-service.ts |
| POST | `/driver/dispatches/{id}/decline` | own.data.read | {id}* | ReasonRequest | 200 Row | T |  | driver-app-service.ts |
| POST | `/driver/dispatches/{id}/start` | own.data.read | {id}* |  | 200 Row | T |  | driver-app-service.ts |
| POST | `/driver/dispatches/{id}/swap-requests` | own.data.read | {id}* | SwapRequest | 200 SwapRow | T |  | driver-app-service.ts |
| GET | `/driver/leave-requests` | own.data.read | status, pageNumber, pageSize |  | 200 [LeaveDto] | T |  | driver-app-service.ts |
| POST | `/driver/leave-requests` | own.data.read |  | LeaveRequest | 200 LeaveDto | T |  | driver-app-service.ts |
| POST | `/driver/leave-requests/{id}/cancel` | own.data.read | {id}* |  | 200 LeaveDto | T |  | driver-app-service.ts |
| GET | `/driver/me` | own.data.read |  |  | 200 DriverDto | T |  | driver-app-service.ts |
| PATCH | `/driver/me` | own.data.read |  | ContactRequest | 200 DriverDto | T |  | driver-app-service.ts |
| GET | `/driver/safety-events` | own.data.read | from, to, pageNumber, pageSize |  | 200 [AlertRow] | T |  | driver-app-service.ts |
| GET | `/driver/safety-score` | own.data.read | from, to |  | 200 DriverScoreDto | T |  | driver-app-service.ts |
| GET | `/driver/shifts/current` | own.data.read |  |  | 200 ShiftDto | T |  | driver-app-service.ts |
| POST | `/driver/shifts/end` | own.data.read |  | ShiftEndRequest | 200 ShiftDto | T |  | driver-app-service.ts |
| POST | `/driver/shifts/start` | own.data.read |  | ShiftStartRequest | 200 ShiftDto | T |  | driver-app-service.ts |
| GET | `/driver/working-hours` | own.data.read | from, to |  | 200 ShiftHistoryDto | T |  | driver-app-service.ts |

## driver-controller (10 ops, 10 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/devices/{id}/driver-assignments` | driver.read | {id}* |  | 200 [AssignmentDto] | T |  | operations-service.ts |
| GET | `/drivers` | driver.read | keyword, status, pageNumber, pageSize |  | 200 [DriverDto] | T |  | operations-service.ts |
| POST | `/drivers` | driver.create |  | DriverRequest | 200 DriverDto | T |  | operations-service.ts |
| GET | `/drivers/{id}` | driver.read | {id}* |  | 200 DriverDto | T |  | operations-service.ts |
| PUT | `/drivers/{id}` | driver.update | {id}* | DriverRequest | 200 DriverDto | T |  | operations-service.ts |
| DELETE | `/drivers/{id}` | driver.delete | {id}* |  | 200 object | T |  | operations-service.ts |
| GET | `/drivers/{id}/assignments` | driver.read | {id}* |  | 200 [AssignmentDto] | T |  | operations-service.ts |
| POST | `/drivers/{id}/assignments` | driver.update | {id}* | AssignRequest | 200 AssignmentDto | T |  | operations-service.ts |
| POST | `/drivers/{id}/assignments/{assignmentId}/end` | driver.update | {id}*, {assignmentId}* | EndAssignmentRequest | 200 AssignmentDto | T |  | operations-service.ts |
| GET | `/drivers/licence-expiries` | driver.read | withinDays |  | 200 [DriverDto] | T |  | operations-service.ts |

## geofence-controller (5 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/geofences` | geofence.read | shape, name |  | 200 [GeofenceDto] | T |  | fleet-service.ts |
| POST | `/geofences` | geofence.create |  | GeofenceRequest | 200 GeofenceDto | T |  |  |
| GET | `/geofences/{id}` | geofence.read | {id}* |  | 200 GeofenceDto | T |  |  |
| PUT | `/geofences/{id}` | geofence.update | {id}* | GeofenceRequest | 200 GeofenceDto | T |  |  |
| DELETE | `/geofences/{id}` | geofence.delete | {id}* |  | 200 object | T |  | fleet-service.ts |

## geofence-event-controller (2 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/geofences/events` | geofence.read | from, to, geofenceId, deviceId, eventType, pageNumber, pageSize |  | 200 [GeofenceEventDto] | T |  | insight-service.ts |
| GET | `/geofences/events/summary` | geofence.read | from, to, geofenceId, deviceId |  | 200 EventSummary | T |  | insight-service.ts |

## group-controller (5 ops, 1 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/groups` | group.read |  |  | 200 [GroupDto] | T |  | fleet-service.ts |
| POST | `/groups` | group.create |  | GroupRequest | 200 GroupDto | T |  |  |
| GET | `/groups/{id}` | group.read | {id}* |  | 200 GroupDto | T |  |  |
| PUT | `/groups/{id}` | group.update | {id}* | GroupRequest | 200 GroupDto | T |  |  |
| DELETE | `/groups/{id}` | group.delete | {id}*, cascadeDevices |  | 200 object | T |  |  |

## maintenance-controller (7 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/maintenance-reminders` | maintenance.read | status, deviceId, type, pageNumber, pageSize |  | 200 [ReminderDto] | T | ✚ |  |
| POST | `/maintenance-reminders` | maintenance.create |  | ReminderRequest | 200 ReminderDto | T | ✚ |  |
| GET | `/maintenance-reminders/{id}` | maintenance.read | {id}* |  | 200 ReminderDto | T | ✚ |  |
| PUT | `/maintenance-reminders/{id}` | maintenance.update | {id}* | ReminderRequest | 200 ReminderDto | T | ✚ |  |
| POST | `/maintenance-reminders/{id}/cancel` | maintenance.update | {id}* |  | 200 ReminderDto | T | ✚ |  |
| POST | `/maintenance-reminders/{id}/complete` | maintenance.update | {id}* |  | 200 ReminderDto | T | ✚ |  |
| GET | `/maintenance-reminders/upcoming` | maintenance.read | withinDays, withinKm, deviceId |  | 200 [UpcomingDto] | T | ✚ |  |

## me-controller (7 ops, 6 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/me` | none (any signed-in user) |  |  | 200 CurrentUserDto | T |  | auth-service.ts |
| PATCH | `/me` | none (any signed-in user) |  | UpdateMeRequest | 200 CurrentUserDto | T |  | account-service.ts |
| GET | `/me/menus` | none (any signed-in user) |  |  | 200 [MenuNodeDto] | T |  | auth-service.ts |
| POST | `/me/password` | none (any signed-in user) |  | ChangePasswordRequest | 200 object | T |  | account-service.ts |
| GET | `/me/permissions` | none (any signed-in user) |  |  | 200 MyPermissionsDto | T | ✚ |  |
| GET | `/me/preferences` | none (any signed-in user) |  |  | 200 PreferencesDto | T |  | account-service.ts |
| PUT | `/me/preferences` | none (any signed-in user) |  | PreferencesDto | 200 PreferencesDto | T |  | account-service.ts |

## menu-controller (5 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/menus` | menu.manage |  |  | 200 [MenuNodeDto] | T |  |  |
| POST | `/menus` | menu.manage |  | MenuItemRequest | 201 MenuNodeDto | T |  |  |
| GET | `/menus/{id}` | menu.manage | {id}* |  | 200 MenuNodeDto | T |  |  |
| PUT | `/menus/{id}` | menu.manage | {id}* | MenuItemRequest | 200 MenuNodeDto | T |  |  |
| DELETE | `/menus/{id}` | menu.manage | {id}* |  | 200 object | T |  |  |

## monitor-controller (2 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/devices/{id}/track` | track.read | {id}*, from*, to*, includeStops, minStopMinutes, positionFilter |  | 200 TrackDto | T |  | fleet-service.ts |
| GET | `/monitor/realtime` | device.read | deviceIds |  | 200 RealtimeDto | T |  | fleet-service.ts |

## notification-controller (5 ops, 5 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/notifications` | none (any signed-in user) | unreadOnly, type, pageNumber, pageSize |  | 200 [NotificationDto] | T |  | alert-service.ts |
| POST | `/notifications/{id}/read` | none (any signed-in user) | {id}* |  | 200 NotificationDto | T |  | alert-service.ts |
| POST | `/notifications/{id}/unread` | none (any signed-in user) | {id}* |  | 200 NotificationDto | T |  | alert-service.ts |
| POST | `/notifications/read-all` | none (any signed-in user) |  |  | 200 object | T |  | alert-service.ts |
| GET | `/notifications/unread-count` | none (any signed-in user) |  |  | 200 object | T |  | alert-service.ts |

## platform-controller (2 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| POST | `/platform/switch-tenant` | tenant.all |  | SwitchTenantRequest | 200 TenantSelectionDto | T | ✚ |  |
| GET | `/platform/tenants` | tenant.all |  |  | 200 [TenantDto] | T | ✚ |  |

## push-token-controller (3 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/me/push-tokens` | none (any signed-in user) |  |  | 200 [PushTokenDto] | T | ✚ |  |
| POST | `/me/push-tokens` | none (any signed-in user) |  | PushTokenRequest | 200 PushTokenDto | T | ✚ |  |
| DELETE | `/me/push-tokens` | none (any signed-in user) |  | TokenRef | 200 object | T | ✚ |  |

## reference-controller (6 ops, 4 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/reference/alarm-types` | none (any signed-in user) | category, active |  | 200 [AlarmTypeDto] | T |  | fleet-service.ts |
| PATCH | `/reference/alarm-types/{id}` | reference.manage | {id}* | AlarmTypeUpdate | 200 AlarmTypeDto | T |  |  |
| GET | `/reference/device-models` | none (any signed-in user) |  |  | 200 [DeviceModelDto] | T |  | fleet-service.ts |
| GET | `/reference/object-types` | none (any signed-in user) | category |  | 200 [ObjectTypeDto] | T |  | fleet-service.ts |
| GET | `/reference/protocols` | none (any signed-in user) |  |  | 200 [ProtocolDto] | T |  | fleet-service.ts |
| GET | `/reference/statuses` | none (any signed-in user) |  |  | 200 CatalogDto | T | ✚ |  |

## renewal-controller (2 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/renewals` | renewal.manage | pageNumber, pageSize |  | 200 [RenewalDto] | T |  |  |
| POST | `/renewals` | renewal.manage |  | RenewalRequest | 200 RenewalDto | T |  |  |

## report-controller (6 ops, 4 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/reports/driving` | report.read | from*, to*, deviceIds, pageNumber, pageSize |  | 200 [ActivityDto] | T |  | fleet-service.ts |
| GET | `/reports/export` | report.read | type*, format, from, to, deviceIds, mediaType |  | 200 string | T | ✚ |  |
| GET | `/reports/idle` | report.read | from, to, deviceIds, idleLitresPerHour |  | 200 IdleReport | T | ✚ |  |
| GET | `/reports/media` | report.read | from*, to*, deviceIds, mediaType, pageNumber, pageSize |  | 200 [MediaDto] | T |  | fleet-service.ts |
| GET | `/reports/mileage` | report.read | from*, to*, deviceIds |  | 200 [MileageDto] | T |  | fleet-service.ts |
| GET | `/reports/parking` | report.read | from*, to*, deviceIds, pageNumber, pageSize |  | 200 [ActivityDto] | T |  | fleet-service.ts |

## report-schedule-controller (6 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/report-schedules` | report.schedule | pageNumber, pageSize |  | 200 [ScheduleDto] | T | ✚ |  |
| POST | `/report-schedules` | report.schedule |  | ScheduleRequest | 200 ScheduleDto | T | ✚ |  |
| GET | `/report-schedules/{id}` | report.schedule | {id}* |  | 200 ScheduleDto | T | ✚ |  |
| PUT | `/report-schedules/{id}` | report.schedule | {id}* | ScheduleRequest | 200 ScheduleDto | T | ✚ |  |
| DELETE | `/report-schedules/{id}` | report.schedule | {id}* |  | 200 object | T | ✚ |  |
| POST | `/report-schedules/{id}/run` | report.schedule | {id}* |  | 200 string | T | ✚ |  |

## role-controller (14 ops, 2 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/permissions` | role.permission.read or permission.manage |  |  | 200 [PermissionDto] | T |  | admin-service.ts |
| POST | `/permissions` | permission.manage |  | CreatePermissionRequest | 201 PermissionDto | T | ✚ |  |
| PUT | `/permissions/{code}` | permission.manage | {code}* | UpdatePermissionRequest | 200 PermissionDto | T | ✚ |  |
| DELETE | `/permissions/{code}` | permission.manage | {code}* |  | 200 object | T | ✚ |  |
| GET | `/roles` | role.read |  |  | 200 [RoleDto] | T |  | admin-service.ts |
| POST | `/roles` | role.manage |  | CreateRoleRequest | 201 RoleDto | T |  |  |
| GET | `/roles/{id}` | role.read | {id}* |  | 200 RoleDto | T |  |  |
| PUT | `/roles/{id}` | role.manage | {id}* | UpdateRoleRequest | 200 RoleDto | T |  |  |
| DELETE | `/roles/{id}` | role.manage | {id}* |  | 200 object | T |  |  |
| GET | `/roles/{id}/permissions` | role.permission.read | {id}* |  | 200 RolePermissionsDto | T | ✚ |  |
| POST | `/roles/{id}/permissions` | role.permission.create | {id}* | RolePermissionsRequest | 200 RolePermissionsDto | T | ✚ |  |
| PUT | `/roles/{id}/permissions` | role.permission.update | {id}* | RolePermissionsRequest | 200 RolePermissionsDto | T |  |  |
| DELETE | `/roles/{id}/permissions` | role.permission.delete | {id}*, codes* |  | 200 RolePermissionsDto | T | ✚ |  |
| GET | `/roles/permission-matrix` | role.permission.read |  |  | 200 PermissionMatrixDto | T | ✚ |  |

## safety-controller (7 ops, 5 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/drivers/{id}/safety-events` | alarm.read | {id}*, from, to, pageNumber, pageSize |  | 200 [AlertRow] | T |  | insight-service.ts |
| GET | `/drivers/{id}/safety-score` | alarm.read | {id}*, from, to |  | 200 DriverScoreDto | T |  | insight-service.ts |
| GET | `/safety/analytics` | alarm.read | from, to |  | 200 AnalyticsDto | T |  | insight-service.ts |
| GET | `/safety/false-positives` | alarm.read | from, to |  | 200 FalsePositiveDto | T | ✚ |  |
| GET | `/safety/heatmap` | alarm.read | from, to, cellDegrees, alarmTypeIds, maxSeverity, south, west, north, east |  | 200 HeatmapDto | T | ✚ |  |
| GET | `/safety/scores/drivers` | alarm.read | from, to, pageNumber, pageSize |  | 200 [ScoreDto] | T |  | insight-service.ts |
| GET | `/safety/scores/vehicles` | alarm.read | from, to, pageNumber, pageSize |  | 200 [ScoreDto] | T |  | insight-service.ts |

## screen-controller (3 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| PUT | `/menus/{id}/operations` | menu.manage | {id}* | OperationsRequest | 200 [OperationDto] | T | ✚ |  |
| GET | `/screens` | role.permission.read or menu.manage |  |  | 200 [ScreenDto] | T | ✚ |  |
| GET | `/screens/{menuKey}/operations` | role.permission.read or menu.manage | {menuKey}* |  | 200 [OperationDto] | T | ✚ |  |

## search-controller (1 ops, 1 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/search` | device.read | q*, limit |  | 200 object | T |  | assistant-service.ts |

## trip-controller (7 ops, 4 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/trips` | track.read | from, to, deviceId, driverId, pageNumber, pageSize |  | 200 [TripDto] | T |  | insight-service.ts |
| POST | `/trips` | trip.create |  | TripRequest | 200 TripDetailDto | T | ✚ |  |
| GET | `/trips/{id}` | track.read | {id}* |  | 200 TripDetailDto | T |  | insight-service.ts |
| PUT | `/trips/{id}` | trip.update | {id}* | TripRequest | 200 TripDetailDto | T | ✚ |  |
| DELETE | `/trips/{id}` | trip.delete | {id}* |  | 200 object | T | ✚ |  |
| GET | `/trips/{id}/route` | track.read | {id}* |  | 200 RouteDto | T |  | insight-service.ts |
| GET | `/trips/summary` | track.read | from, to, deviceId, driverId |  | 200 SummaryDto | T |  | insight-service.ts |

## user-controller (9 ops, 8 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/users` | user.read | keyword, status, roleId, parentUserId, pageNumber, pageSize, sort |  | 200 [UserSummaryDto] | T |  | admin-service.ts |
| POST | `/users` | user.create |  | CreateUserRequest | 201 UserDetailDto | T |  | admin-service.ts |
| GET | `/users/{id}` | user.read | {id}* |  | 200 UserDetailDto | T |  | admin-service.ts |
| PUT | `/users/{id}` | user.update | {id}* | UpdateUserRequest | 200 UserDetailDto | T |  | admin-service.ts |
| DELETE | `/users/{id}` | user.delete | {id}* |  | 200 object | T |  |  |
| POST | `/users/{id}/password` | user.update | {id}* | PasswordResetRequest | 200 object | T |  | admin-service.ts |
| PATCH | `/users/{id}/status` | user.update | {id}* | StatusRequest | 200 UserDetailDto | T |  | admin-service.ts |
| POST | `/users/{id}/unlock` | user.update | {id}* |  | 200 UserDetailDto | T |  | admin-service.ts |
| GET | `/users/tree` | user.read |  |  | 200 [UserTreeNode] | T |  | admin-service.ts |

## vendor-user-controller (6 ops, 0 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/vendor-users` | vendor.user.read |  |  | 200 [VendorUserDto] | T |  |  |
| POST | `/vendor-users` | vendor.user.create |  | CreateRequest | 200 VendorUserDto | T |  |  |
| GET | `/vendor-users/{id}` | vendor.user.read | {id}* |  | 200 VendorUserDto | T |  |  |
| PUT | `/vendor-users/{id}` | vendor.user.update | {id}* | UpdateRequest | 200 VendorUserDto | T |  |  |
| DELETE | `/vendor-users/{id}` | vendor.user.delete | {id}*, confirm |  | 200 object | T |  |  |
| GET | `/vendor-users/current` | vendor.user.read |  |  | 200 VendorUserDto | T |  |  |

## video-controller (7 ops, 4 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/devices/{id}/recording-calendar` | video.playback | {id}*, month* |  | 200 [integer] | T |  | fleet-service.ts |
| GET | `/devices/{id}/recordings` | video.playback | {id}*, from*, to*, channel |  | 200 [RecordingDto] | T |  | fleet-service.ts |
| GET | `/video/embed` | video.live or video.playback | deviceId |  | 200 EmbedDto | T | ✚ |  |
| GET | `/video/exports` | video.playback | deviceId, pageNumber, pageSize |  | 200 [ExportDto] | T |  | fleet-service.ts |
| POST | `/video/exports` | video.playback |  | ExportRequest | 200 ExportDto | T |  | fleet-service.ts |
| GET | `/video/exports/{id}` | video.playback | {id}* |  | 200 ExportDto | T |  |  |
| GET | `/video/sdk-token` | video.live or video.playback |  |  | 200 SdkTokenDto | T |  |  |

## voice-controller (3 ops, 1 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/voices` | voice.read | vendorUserId |  | 200 [VoiceDto] | T |  |  |
| POST | `/voices` | voice.create | name*, vendorUserId | object | 200 [VoiceDto] | T |  |  |
| GET | `/voices/fence` | geofence.read |  |  | 200 [VoiceDto] | T |  | insight-service.ts |

## workforce-controller (8 ops, 8 used)

| Method | Path | Perm | Params | Body | 2xx data | T | New | Frontend |
|---|---|---|---|---|---|---|---|---|
| GET | `/checklist-template` | workforce.read |  |  | 200 [ChecklistItem] | T |  | operations-service.ts |
| GET | `/checklists` | workforce.read | driverId, from, to, pageNumber, pageSize |  | 200 [ChecklistDto] | T |  | operations-service.ts |
| GET | `/drivers/availability` | workforce.read | date |  | 200 AvailabilityOverviewDto | T |  | operations-service.ts |
| GET | `/leave-requests` | workforce.read | status, driverId, from, to, pageNumber, pageSize |  | 200 [LeaveDto] | T |  | operations-service.ts |
| POST | `/leave-requests` | workforce.create |  | LeaveRequest | 200 LeaveDto | T |  | operations-service.ts |
| POST | `/leave-requests/{id}/approve` | workforce.update | {id}* | DecisionRequest | 200 LeaveDto | T |  | operations-service.ts |
| POST | `/leave-requests/{id}/reject` | workforce.update | {id}* | DecisionRequest | 200 LeaveDto | T |  | operations-service.ts |
| GET | `/shifts` | workforce.read | driverId, from, to, pageNumber, pageSize |  | 200 [ShiftDto] | T |  | operations-service.ts |
