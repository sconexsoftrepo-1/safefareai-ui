# V10 API ↔ frontend mapping

Generated 2026-11-02 (Phase 1; regenerated after Phases 2–3). **220 / 220 operations mapped.** Sources:
- Contract: `docs/openapi/api-docs-v10.json` (164 paths · 220 operations · 297 schemas).
- Code: every BFF call site in `src/features/drive-vision/api/`, resolved with the TypeScript type checker (`tests/helpers/v10-contract.cjs`) — method, path (literal-union `${…}` spans expanded), query type, body type, response type — compared field-by-field with V10.
- Usage: which UI files reach each service method (`tests/helpers/v10-callers.cjs`, wrappers like `listAllDevices` followed). An operation counts as integrated only when a screen reaches it.

The same analysis runs as a test: `tests/v10-contract.test.cjs`. Compatibility summary: [`v10-compatibility-report.md`](v10-compatibility-report.md).

**Live evidence.** Nothing in this phase was sent to the BFF. Pre-V10 live observations (reads, 2026-10-26…29) are in `feature-status.md`; apart from login/logout and two reversible round-trips (`PATCH /me`, `PUT /me/preferences`, 2026-10-27), **no write operation has ever been sent**. "INTEGRATED" therefore means *contract-verified in code*, not *verified against V10 at runtime*.

## Status rules

| Status | Meaning |
|---|---|
| INTEGRATED | Reached from a mounted screen; method, path, query, body, response and value sets agree with V10; auth correct; no V10 requirement unmet for the operation's current use. |
| PARTIALLY_INTEGRATED | Reached and contract-compatible, but a V10 requirement is unmet. **None since Phase 5**: the 26 tenant-scoped writes now carry the Safe-Fare Admin's selected tenant (`X-Tenant-Id`) and aren't offered without one. |
| NOT_INTEGRATED | No screen reaches it (including 7 service methods that exist but have no caller). |
| BACKEND_BLOCKED | Not integrated, disabled, or failing because the backend contract/behaviour is missing, ambiguous or broken (IDs refer to `missing-backend-apis.md`). |
| NOT_APPLICABLE | Not meant for this web app. **None** — every V10 operation has a plausible screen. |

Tenant scope ("SFA" = Safe-Fare Admin): from `info.description` — reads without a tenant cover every tenant; writes need `tenantId` / `X-Tenant-Id`; tenant users may omit it. "Own user" operations (`/auth`, `/me`, `/notifications`, `/driver/**`) act on the caller and are treated as not needing a tenant — **an assumption to verify** with a Safe-Fare Admin login.

## Totals

| Status | Operations | of which new in V10 |
|---|---|---|
| INTEGRATED | 139 | 9 |
| PARTIALLY_INTEGRATED | 0 | 0 |
| NOT_INTEGRATED | 67 | 39 |
| BACKEND_BLOCKED | 14 | 0 |
| NOT_APPLICABLE | 0 | 0 |
| **Total** | **220** | **48** |

Call sites in code: 135 (one per operation). Reached by a screen: 128. Service-only: 7. (Device edit added `PUT /devices/{id}`: +1 call site, reached from the vehicle detail screen.)

### Operations outside V10 (backend-supplied contracts)

These aren't in `api-docs-v10.json`, so they aren't counted in the totals above. Each one is listed in `OFF_SPEC_CALLS` in `tests/v10-contract.test.cjs`; that list must stay exact.

| Op | Source | Permission | Tenant | Screen | Service | Status | Notes |
|---|---|---|---|---|---|---|---|
| POST `/platform/tenants` | Backend team, 2026-11-02 (request body + one observed 201 response) | **Undocumented**; frontend requires `platform === true` + `tenant.all` (assumption) | Platform-wide: no `X-Tenant-Id`, no `?tenantId` | Tenants → Create tenant | `platformService.createTenant` | **INTEGRATED** (mocked only, not live-verified) | Body `{code, name, timezone, status, s3Prefix, copyRolePermissionsFromTenantId: 1}`. See `phase6-tenant-management-report.md` §13 |
> Correction to Phase 0: `project-audit.md` / `v10-api-inventory.md` reported 134 integrated operations. The regex scan used then matched `GET /geofences/events` to `GET /geofences/{id}`; `GET /geofences/{id}` is not called. The type-checker scan finds **133 operations with call sites**, of which **127** are reached from a screen.

## Per operation

Columns: **Op** method + path (`/api/v1` omitted) · **opId** springdoc operationId · **Purpose** derived from method + path (the spec has no summaries) · **Auth** · **Permission** (V10 "Required permission") · **Params** (`*` required; tenant selector omitted — accepted by all but login/refresh) · **Body** request schema (`*` body required) · **Response** 2xx `data` schema · **Tenant** · **Screen** · **Service** · **Status** · **Missing / blocker**.

### alarm-controller — 3 ops (INTEGRATED 2 · BACKEND_BLOCKED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/alarms/ai` | ai | List alarms ai | Bearer | alarm.read | from*, to*, alarmTypeIds, deviceIds, pageNumber, pageSize | — | 200 AlarmDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Alerts & Events, Overview, Vehicles & Assets | api/fleet-service.ts (fleetService.aiAlarms) | **INTEGRATED** | — |
| GET `/alarms/routine` | routine | List alarms routine | Bearer | alarm.read | from*, to*, alarmTypeIds, deviceIds, pageNumber, pageSize | — | 200 AlarmDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Alerts & Events, Overview, Vehicles & Assets | api/fleet-service.ts (fleetService.routineAlarms) | **INTEGRATED** | — |
| GET `/alarms/routine/recent` | recentRoutine | List alarms routine recent | Bearer | alarm.read | alarmTypeIds, deviceIds, pageNumber, pageSize | — | 200 AlarmDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **BACKEND_BLOCKED** | Window / unhandled-only semantics undocumented; no time parameters |

### alarm-rule-controller — 5 ops (NOT_INTEGRATED 5)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/alarm-rules` ✚ | list_14 | List alarm rules | Bearer | alarm.rule.read | enabled, handlingMode, pageNumber, pageSize | — | 200 AlarmRuleDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alarm rules (new screen, Phase 7) |
| POST `/alarm-rules` ✚ | create_13 | Create alarm rule | Bearer | alarm.rule.create | — | AlarmRuleRequest* | 200 AlarmRuleDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alarm rules (new screen, Phase 7) |
| GET `/alarm-rules/{id}` ✚ | get_12 | Get one alarm rule | Bearer | alarm.rule.read | {id}* | — | 200 AlarmRuleDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alarm rules (new screen, Phase 7) |
| PUT `/alarm-rules/{id}` ✚ | update_12 | Update one alarm rule | Bearer | alarm.rule.update | {id}* | AlarmRuleRequest* | 200 AlarmRuleDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alarm rules (new screen, Phase 7) |
| DELETE `/alarm-rules/{id}` ✚ | delete_10 | Delete one alarm rule | Bearer | alarm.rule.delete | {id}* | — | 200 object | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alarm rules (new screen, Phase 7) |

### alert-controller — 13 ops (INTEGRATED 8 · NOT_INTEGRATED 4 · BACKEND_BLOCKED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/alerts` | search_2 | List alerts | Bearer | alarm.read | from, to, status, openOnly, severity, alarmTypeIds, deviceIds, driverId, assigneeUserId, kind, keyword, pageNumber, pageSize | — | 200 AlertRow[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Alerts & Events | api/alert-service.ts (alertService.listAlerts) | **INTEGRATED** | — |
| GET `/alerts/{id}` | get_15 | Get one alert | Bearer | alarm.read | {id}* | — | 200 AlertDetailDto | tenant; SFA all tenants if omitted | Alerts & Events | api/alert-service.ts (alertService.getAlert) | **INTEGRATED** | — |
| POST `/alerts/{id}/acknowledge` | acknowledge | Acknowledge alert | Bearer | alarm.handle | {id}* | NoteRequest | 200 AlertDetailDto | tenant; SFA must send tenantId | Alerts & Events | api/alert-service.ts (alertService.noteAction) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/alerts/{id}/actions` | actions | List actions of one alert | Bearer | alarm.read | {id}* | — | 200 ActionRow[] | tenant; SFA all tenants if omitted |  | api/alert-service.ts (alertService.actions) | **NOT_INTEGRATED** | Service method exists (api/alert-service.ts (alertService.actions)) but no screen calls it |
| POST `/alerts/{id}/assign` | assign_1 | Assign an alert (body is the driver-assignment schema — #32) | Bearer | alarm.handle | {id}* | AssignRequest* | 200 AlertDetailDto | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #32 — body is the driver-assignment schema `AssignRequest` (deviceId, from, to) — no assignee field; unchanged in V10 |
| POST `/alerts/{id}/comments` | comment | Add a comment to an alert | Bearer | alarm.handle | {id}* | CommentRequest* | 200 AlertDetailDto | tenant; SFA must send tenantId | Alerts & Events | api/alert-service.ts (alertService.comment) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/alerts/{id}/dismiss` | dismiss | Dismiss alert | Bearer | alarm.handle | {id}* | NoteRequest | 200 AlertDetailDto | tenant; SFA must send tenantId | Alerts & Events | api/alert-service.ts (alertService.noteAction) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/alerts/{id}/evidence` | evidence | List evidence of one alert | Bearer | alarm.read | {id}* | — | 200 EvidenceRow[] | tenant; SFA all tenants if omitted |  | api/alert-service.ts (alertService.evidence) | **NOT_INTEGRATED** | Service method exists (api/alert-service.ts (alertService.evidence)) but no screen calls it |
| GET `/alerts/{id}/high-priority-steps` ✚ | steps | Get high priority steps of one alert | Bearer | alarm.read | {id}* | — | 200 StepsDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alerts & Events — incident drawer (Phase 7) |
| POST `/alerts/{id}/high-priority-steps` ✚ | step | Create high priority step of one alert | Bearer | alarm.handle | {id}* | StepRequest* | 200 StepsDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Alerts & Events — incident drawer (Phase 7) |
| POST `/alerts/{id}/reopen` | reopen | Reopen alert | Bearer | alarm.handle | {id}* | NoteRequest | 200 AlertDetailDto | tenant; SFA must send tenantId | Alerts & Events | api/alert-service.ts (alertService.noteAction) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/alerts/{id}/resolve` | resolve | Resolve alert | Bearer | alarm.handle | {id}* | ResolveRequest* | 200 AlertDetailDto | tenant; SFA must send tenantId | Alerts & Events | api/alert-service.ts (alertService.resolve) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/devices/{id}/event-markers` | markers | List event markers of one device | Bearer | video.playback or alarm.read | {id}*, from, to | — | 200 AlertRow[] | tenant; SFA all tenants if omitted | Trips & Tracking | api/insight-service.ts (insightService.eventMarkers) | **INTEGRATED** | — |

### asset-tree-controller — 1 ops (NOT_INTEGRATED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/assets/tree` ✚ | tree_2 | Get assets tree | Bearer | device.read | vendorUserId | — | 200 TreeDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Vehicles & Assets tree (Phase 7) |

### assistant-controller — 2 ops (INTEGRATED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST `/assistant/ask` | ask | Ask the fleet assistant (BFF; `simulated` flag in answer) | Bearer | device.read | — | AskRequest* | 200 AnswerDto | tenant; SFA must send tenantId | AI Assistant | api/assistant-service.ts (assistantService.ask) | **INTEGRATED** | Read-style POST; whether Safe-Fare Admin needs `tenantId` here is undocumented — verify in Phase 11 |
| GET `/assistant/prompts` | prompts | List assistant prompts | Bearer | device.read | — | — | 200 Prompt[] | tenant; SFA all tenants if omitted | AI Assistant | api/assistant-service.ts (assistantService.prompts) | **INTEGRATED** | — |

### audit-controller — 1 ops (NOT_INTEGRATED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/audit-logs` ✚ | list_16 | List audit logs | Bearer | audit.read | from, to, actorUserId, action, entityType, entityId, pageNumber, pageSize | — | 200 AuditDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Audit log (new screen, Phase 7) |

### auth-controller — 3 ops (INTEGRATED 3)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST `/auth/login` | login | Sign in (tenant user with `tenantCode`; Safe-Fare Admin without) → tokens + current user | Public | — | — | LoginRequest* | 200 TokenResponse | none (public) | Login | api/auth-service.ts (authService.login) | **INTEGRATED** | Phase 2: tenant users send `tenantCode`; Safe-Fare Admin omits it (login-model.ts). Not verified against the live BFF |
| POST `/auth/logout` | logout | Revoke refresh token | Bearer | none (any signed-in user) | — | RefreshRequest* | 200 object | own user (selector accepted) | Shell (session) | api/auth-service.ts (authService.logout) | **INTEGRATED** | — |
| POST `/auth/refresh` | refresh | Exchange refresh token for new tokens | Public | — | — | RefreshRequest* | 200 TokenResponse | none (public) | Shell (session) | api/client.ts (refreshUnderLock) | **INTEGRATED** | — |

### command-controller — 5 ops (INTEGRATED 2 · BACKEND_BLOCKED 3)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/commands` | list_13 | List commands | Bearer | command.send | type, deviceId, pageNumber, pageSize | — | 200 CommandDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Device Commands | api/fleet-service.ts (fleetService.listCommands) | **INTEGRATED** | — |
| POST `/commands` | send | Create command | Bearer | command.send | — | CommandRequest* | 200 CommandDto | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #25 — V10 now enumerates `type`, but `params` is free-form per type; sends to live devices |
| GET `/commands/{id}` | get_14 | Get one command | Bearer | command.send | {id}*, refresh | — | 200 CommandDto | tenant; SFA all tenants if omitted | Device Commands | api/fleet-service.ts (fleetService.getCommand) | **BACKEND_BLOCKED** | #28 — integrated in code; BFF answered 500 for every id on 2026-10-27; not re-tested on V10 · Optional V10 params not offered: `refresh` |
| GET `/commands/types` | types | List commands types | Bearer | command.send | — | — | 200 Definition[] | tenant; SFA all tenants if omitted | Device Commands | api/fleet-service.ts (fleetService.commandTypes) | **INTEGRATED** | — |
| GET `/devices/{id}/passthrough-data` | passThrough | List passthrough data of one device | Bearer | device.read | {id}*, type*, from*, to* | — | 200 PassThroughDto[] | tenant; SFA all tenants if omitted | — | — | **BACKEND_BLOCKED** | `type*` code list undocumented |

### dashboard-controller — 9 ops (INTEGRATED 5 · NOT_INTEGRATED 4)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/dashboard/active-trips` | activeTrips | Get dashboard active trips | Bearer | device.read | — | — | 200 ActiveTrips | tenant; SFA all tenants if omitted |  | api/insight-service.ts (insightService.activeTrips) | **NOT_INTEGRATED** | Service method exists (api/insight-service.ts (insightService.activeTrips)) but no screen calls it |
| GET `/dashboard/device-health` | health | Get dashboard device health | Bearer | device.read | — | — | 200 DeviceHealth | tenant; SFA all tenants if omitted |  | api/insight-service.ts (insightService.deviceHealth) | **NOT_INTEGRATED** | Service method exists (api/insight-service.ts (insightService.deviceHealth)) but no screen calls it |
| GET `/dashboard/fleet-health` ✚ | fleetHealth | Get dashboard fleet health | Bearer | device.read | offlineHours, lowBatteryPct, expiringDays | — | 200 FleetHealthDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Overview (Phase 4/7) |
| GET `/dashboard/fleet-status` | fleetStatus | List dashboard fleet status | Bearer | device.read | — | — | 200 StatusSlice[] | tenant; SFA all tenants if omitted | Overview | api/insight-service.ts (insightService.fleetStatus) | **INTEGRATED** | — |
| GET `/dashboard/overview` | overview | Get dashboard overview | Bearer | device.read | — | — | 200 OverviewDto | tenant; SFA all tenants if omitted | Overview | api/insight-service.ts (insightService.overview) | **INTEGRATED** | — |
| GET `/dashboard/safety-events` | safety | Get dashboard safety events | Bearer | alarm.read | from, to | — | 200 SafetySummary | tenant; SFA all tenants if omitted | Overview | api/insight-service.ts (insightService.safetyEvents) | **INTEGRATED** | — |
| GET `/dashboard/trends` | trends | List dashboard trends | Bearer | device.read | from, to | — | 200 TrendDay[] | tenant; SFA all tenants if omitted | Overview | api/insight-service.ts (insightService.trends) | **INTEGRATED** | — |
| GET `/dashboard/vehicles` | vehicles | Get dashboard vehicles | Bearer | device.read | — | — | 200 VehicleCounts | tenant; SFA all tenants if omitted |  | api/insight-service.ts (insightService.vehicleCounts) | **NOT_INTEGRATED** | Service method exists (api/insight-service.ts (insightService.vehicleCounts)) but no screen calls it |
| GET `/devices/{id}/summary` | vehicle | Get summary of one device | Bearer | device.read | {id}* | — | 200 VehicleSummaryDto | tenant; SFA all tenants if omitted | Vehicles & Assets | api/insight-service.ts (insightService.vehicleSummary) | **INTEGRATED** | — |

### device-controller — 6 ops (INTEGRATED 2 · BACKEND_BLOCKED 4)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/devices` | list_12 | List devices | Bearer | device.read | groupId, keyword, pageNumber, pageSize | — | 200 DeviceDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Vehicles & Assets, Alerts & Events, Overview, Device Commands, Drivers, Geofences, Live Monitoring, Dispatch / Workforce pickers, Reports, Trips & Tracking, Historical Video | api/fleet-service.ts (fleetService.listDevices) | **INTEGRATED** | — |
| POST `/devices` | create_12 | Create device | Bearer | device.create | — | DeviceRequest* | 200 DeviceDto | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #19 — `confirmChargeableChange` semantics undocumented (vendor charges) |
| GET `/devices/{id}` | get_11 | Get one device | Bearer | device.read | {id}* | — | 200 DeviceDto | tenant; SFA all tenants if omitted | Vehicles & Assets | api/fleet-service.ts (fleetService.getDevice) | **INTEGRATED** | — |
| PUT `/devices/{id}` | update_11 | Update one device | Bearer | device.update | {id}* | DeviceRequest* | 200 DeviceDto | tenant; SFA must send tenantId | Vehicle detail → Edit | `fleetService.updateDevice` | **INTEGRATED** | Descriptive fields only; model / protocol / cameras / terminal / group / object type / driver gender resent unchanged; `confirmChargeableChange` never sent (#19 open). See `device-edit-investigation-and-implementation.md` |
| DELETE `/devices/{id}` | delete_9 | Delete one device | Bearer | device.delete | {id}* | — | 200 object | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #19 — vendor-side effect and charges undocumented |
| POST `/devices/transfer` | transfer | Transfer devices | Bearer | device.update | — | TransferRequest* | 200 DeviceDto[] | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #26 — group vs vendor-account transfer semantics, reversibility and charges undocumented |

### dispatch-controller — 12 ops (INTEGRATED 12)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/dispatches` | list_11 | List dispatches | Bearer | dispatch.read | from, to, status, driverId, deviceId, pageNumber, pageSize | — | 200 Row[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Dispatch | api/operations-service.ts (operationsService.listDispatches) | **INTEGRATED** | — |
| POST `/dispatches` | create_11 | Create dispatch | Bearer | dispatch.create | — | DispatchRequest* | 200 Row | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.createDispatch) | **INTEGRATED** (Phase 5) | Tenant write, class A create. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/dispatches/{id}` | get_10 | Get one dispatch | Bearer | dispatch.read | {id}* | — | 200 Row | tenant; SFA all tenants if omitted | Dispatch | api/operations-service.ts (operationsService.getDispatch) | **INTEGRATED** | — |
| PUT `/dispatches/{id}` | update_10 | Update one dispatch | Bearer | dispatch.update | {id}* | DispatchRequest* | 200 Row | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.updateDispatch) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/dispatches/{id}/cancel` | cancel_1 | Cancel dispatch | Bearer | dispatch.update | {id}* | ReasonRequest | 200 Row | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.cancelDispatch) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/dispatches/{id}/swap-requests` | requestSwap_1 | Create swap request of one dispatch | Bearer | dispatch.update | {id}* | SwapRequest* | 200 SwapRow | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.requestSwap) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/dispatches/{id}/verification` | verify | Get verification of one dispatch | Bearer | dispatch.read | {id}* | — | 200 VerificationDto | tenant; SFA all tenants if omitted | Dispatch | api/operations-service.ts (operationsService.verification) | **INTEGRATED** | — |
| POST `/dispatches/check` | check | Check a planned dispatch for conflicts before saving | Bearer | dispatch.read | — | DispatchRequest* | 200 CheckResultDto | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.checkDispatch) | **INTEGRATED** | Validation POST (no record created); whether Safe-Fare Admin needs `tenantId` is undocumented — verify in Phase 11 |
| GET `/dispatches/conflicts` | conflicts | List dispatches conflicts | Bearer | dispatch.read | from, to | — | 200 ConflictDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Dispatch | api/operations-service.ts (operationsService.conflicts) | **INTEGRATED** | — |
| GET `/swap-requests` | swaps | List swap requests | Bearer | dispatch.read | status, driverId, pageNumber, pageSize | — | 200 SwapRow[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Dispatch | api/operations-service.ts (operationsService.listSwaps) | **INTEGRATED** | — |
| POST `/swap-requests/{id}/approve` | approve | Approve swap request | Bearer | dispatch.update | {id}* | DecisionRequest | 200 SwapRow | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.decideSwap) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/swap-requests/{id}/reject` | reject | Reject swap request | Bearer | dispatch.update | {id}* | DecisionRequest | 200 SwapRow | tenant; SFA must send tenantId | Dispatch | api/operations-service.ts (operationsService.decideSwap) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |

### driver-app-controller — 22 ops (INTEGRATED 21 · NOT_INTEGRATED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/driver/assignment` | assignment | Get driver's assignment | Bearer | own.data.read | — | — | 200 AssignmentOverviewDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.assignment) | **INTEGRATED** | — |
| GET `/driver/checklist-template` | checklistTemplate | List driver's checklist template | Bearer | own.data.read | — | — | 200 ChecklistItem[] | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.checklistTemplate) | **INTEGRATED** | — |
| GET `/driver/checklists` | checklists | List driver's checklists | Bearer | own.data.read | from, to, pageNumber, pageSize | — | 200 ChecklistDto[] | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.checklists) | **INTEGRATED** | — |
| POST `/driver/checklists` | submitChecklist | Create driver's checklist | Bearer | own.data.read | — | ChecklistRequest* | 200 ChecklistDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.submitChecklist) | **INTEGRATED** | — |
| GET `/driver/dispatches` | dispatches | List driver's dispatches | Bearer | own.data.read | from, to, status, pageNumber, pageSize | — | 200 Row[] | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.dispatches) | **INTEGRATED** | — |
| GET `/driver/dispatches/{id}` | dispatch | Driver: one of my dispatches | Bearer | own.data.read | {id}* | — | 200 Row | own user (selector accepted) |  | api/driver-app-service.ts (driverAppService.dispatch) | **NOT_INTEGRATED** | Service method exists (api/driver-app-service.ts (driverAppService.dispatch)) but no screen calls it |
| POST `/driver/dispatches/{id}/accept` | accept | Accept dispatch | Bearer | own.data.read | {id}* | — | 200 Row | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.dispatchAction) | **INTEGRATED** | — |
| POST `/driver/dispatches/{id}/complete` | complete_1 | Complete dispatch | Bearer | own.data.read | {id}* | — | 200 Row | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.dispatchAction) | **INTEGRATED** | — |
| POST `/driver/dispatches/{id}/decline` | decline | Decline dispatch | Bearer | own.data.read | {id}* | ReasonRequest | 200 Row | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.decline) | **INTEGRATED** | — |
| POST `/driver/dispatches/{id}/start` | start | Start dispatch | Bearer | own.data.read | {id}* | — | 200 Row | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.dispatchAction) | **INTEGRATED** | — |
| POST `/driver/dispatches/{id}/swap-requests` | requestSwap | Create swap request of one dispatch | Bearer | own.data.read | {id}* | SwapRequest* | 200 SwapRow | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.requestSwap) | **INTEGRATED** | — |
| GET `/driver/leave-requests` | leave_1 | List driver's leave requests | Bearer | own.data.read | status, pageNumber, pageSize | — | 200 LeaveDto[] | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.leave) | **INTEGRATED** | — |
| POST `/driver/leave-requests` | requestLeave | Create driver's leave request | Bearer | own.data.read | — | LeaveRequest* | 200 LeaveDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.requestLeave) | **INTEGRATED** | — |
| POST `/driver/leave-requests/{id}/cancel` | cancelLeave | Cancel leave request | Bearer | own.data.read | {id}* | — | 200 LeaveDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.cancelLeave) | **INTEGRATED** | — |
| GET `/driver/me` | me | Driver: my driver profile | Bearer | own.data.read | — | — | 200 DriverDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.me) | **INTEGRATED** | — |
| PATCH `/driver/me` | updateMe | Driver: update my contact details | Bearer | own.data.read | — | ContactRequest* | 200 DriverDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.updateContact) | **INTEGRATED** | — |
| GET `/driver/safety-events` | safetyEvents | List driver's safety events | Bearer | own.data.read | from, to, pageNumber, pageSize | — | 200 AlertRow[] | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.safetyEvents) | **INTEGRATED** | — |
| GET `/driver/safety-score` | safetyScore | Get driver's safety score | Bearer | own.data.read | from, to | — | 200 DriverScoreDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.safetyScore) | **INTEGRATED** | — |
| GET `/driver/shifts/current` | currentShift | Driver: my current shift | Bearer | own.data.read | — | — | 200 ShiftDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.currentShift) | **INTEGRATED** | — |
| POST `/driver/shifts/end` | endShift | Driver: end my shift | Bearer | own.data.read | — | ShiftEndRequest | 200 ShiftDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.endShift) | **INTEGRATED** | — |
| POST `/driver/shifts/start` | startShift | Driver: start my shift | Bearer | own.data.read | — | ShiftStartRequest | 200 ShiftDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.startShift) | **INTEGRATED** | — |
| GET `/driver/working-hours` | workingHours | Get driver's working hours | Bearer | own.data.read | from, to | — | 200 ShiftHistoryDto | own user (selector accepted) | My Work (driver) | api/driver-app-service.ts (driverAppService.workingHours) | **INTEGRATED** | — |

### driver-controller — 10 ops (INTEGRATED 10)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/devices/{id}/driver-assignments` | deviceAssignments | List driver assignments of one device | Bearer | driver.read | {id}* | — | 200 AssignmentDto[] | tenant; SFA all tenants if omitted | Vehicles & Assets | api/operations-service.ts (operationsService.deviceAssignments) | **INTEGRATED** | — Phase 8: also read by the assign dialog (vehicle's current driver); gated by widget `vehicles.driverAssignments` (`driver.read`). |
| GET `/drivers` | list_10 | List drivers | Bearer | driver.read | keyword, status, pageNumber, pageSize | — | 200 DriverDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Drivers, Dispatch / Workforce pickers | api/operations-service.ts (operationsService.listDrivers) | **INTEGRATED** | — Phase 8: documented tenant columns (`tenantId`, `tenantName`) typed as `DriverRow` and shown to the Safe-Fare Admin in all-tenants mode. |
| POST `/drivers` | create_10 | Create driver | Bearer | driver.create | — | DriverRequest* | 200 DriverDto | tenant; SFA must send tenantId | Drivers | api/operations-service.ts (operationsService.createDriver) | **INTEGRATED** (Phase 5) | Tenant write, class A create. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/drivers/{id}` | get_9 | Get one driver | Bearer | driver.read | {id}* | — | 200 DriverDto | tenant; SFA all tenants if omitted | Drivers | api/operations-service.ts (operationsService.getDriver) | **INTEGRATED** | — |
| PUT `/drivers/{id}` | update_9 | Update one driver | Bearer | driver.update | {id}* | DriverRequest* | 200 DriverDto | tenant; SFA must send tenantId | Drivers | api/operations-service.ts (operationsService.updateDriver) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| DELETE `/drivers/{id}` | delete_8 | Delete one driver | Bearer | driver.delete | {id}* | — | 200 object | tenant; SFA must send tenantId | Drivers | api/operations-service.ts (operationsService.deleteDriver) | **INTEGRATED** (Phase 5) | Tenant write, class C existing-record delete. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/drivers/{id}/assignments` | assignments | List assignments of one driver | Bearer | driver.read | {id}* | — | 200 AssignmentDto[] | tenant; SFA all tenants if omitted | Drivers | api/operations-service.ts (operationsService.driverAssignments) | **INTEGRATED** | — |
| POST `/drivers/{id}/assignments` | assign | Create assignment of one driver | Bearer | driver.update | {id}* | AssignRequest* | 200 AssignmentDto | tenant; SFA must send tenantId | Drivers | api/operations-service.ts (operationsService.assignVehicle) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header Phase 8: optional `to` sent; pre-submit review (driver, vehicle, from/to, active conflicts); replacing an active assignment needs explicit acknowledgement. |
| POST `/drivers/{id}/assignments/{assignmentId}/end` | endAssignment | End assignment of one driver | Bearer | driver.update | {id}*, {assignmentId}* | EndAssignmentRequest | 200 AssignmentDto | tenant; SFA must send tenantId | Drivers | api/operations-service.ts (operationsService.endAssignment) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header Phase 8: optional `at` (validated after the start); blank ends now. |
| GET `/drivers/licence-expiries` | licenceExpiries | List drivers licence expiries | Bearer | driver.read | withinDays | — | 200 DriverDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Drivers | api/operations-service.ts (operationsService.licenceExpiries) | **INTEGRATED** | — |

### geofence-controller — 5 ops (INTEGRATED 2 · NOT_INTEGRATED 1 · BACKEND_BLOCKED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/geofences` | list_9 | List geofences | Bearer | geofence.read | shape, name | — | 200 GeofenceDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Geofences | api/fleet-service.ts (fleetService.listGeofences) | **INTEGRATED** | — |
| POST `/geofences` | create_9 | Create geofence | Bearer | geofence.create | — | GeofenceRequest* | 200 GeofenceDto | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #22 — `ruleTypes`, `areaType`, `colorIndex` codes still undocumented in V10 (may be served by new `GET /reference/statuses`; unverified) |
| GET `/geofences/{id}` | get_8 | Get one geofence | Bearer | geofence.read | {id}* | — | 200 GeofenceDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Geofences |
| PUT `/geofences/{id}` | update_8 | Update one geofence | Bearer | geofence.update | {id}* | GeofenceRequest* | 200 GeofenceDto | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #22 — same as create |
| DELETE `/geofences/{id}` | delete_7 | Delete one geofence | Bearer | geofence.delete | {id}* | — | 200 object | tenant; SFA must send tenantId | Geofences | api/fleet-service.ts (fleetService.deleteGeofence) | **INTEGRATED** (Phase 5) | Tenant write, class C existing-record delete. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |

### geofence-event-controller — 2 ops (INTEGRATED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/geofences/events` | search_1 | List geofences events | Bearer | geofence.read | from, to, geofenceId, deviceId, eventType, pageNumber, pageSize | — | 200 GeofenceEventDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Geofences | api/insight-service.ts (insightService.geofenceEvents) | **INTEGRATED** | — |
| GET `/geofences/events/summary` | summary_1 | Get geofences events summary | Bearer | geofence.read | from, to, geofenceId, deviceId | — | 200 EventSummary | tenant; SFA all tenants if omitted | Geofences | api/insight-service.ts (insightService.geofenceEventSummary) | **INTEGRATED** | — |

### group-controller — 5 ops (INTEGRATED 1 · NOT_INTEGRATED 4)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/groups` | list_8 | List groups | Bearer | group.read | — | — | 200 GroupDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Overview, Geofences, Vehicles & Assets | api/fleet-service.ts (fleetService.listGroups) | **INTEGRATED** | — |
| POST `/groups` | create_8 | Create group | Bearer | group.create | — | GroupRequest* | 200 GroupDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Vehicles & Assets — groups |
| GET `/groups/{id}` | get_7 | Get one group | Bearer | group.read | {id}* | — | 200 GroupDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Vehicles & Assets — groups |
| PUT `/groups/{id}` | update_7 | Update one group | Bearer | group.update | {id}* | GroupRequest* | 200 GroupDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Vehicles & Assets — groups |
| DELETE `/groups/{id}` | delete_6 | Delete one group | Bearer | group.delete | {id}*, cascadeDevices | — | 200 object | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Vehicles & Assets — groups |

### maintenance-controller — 7 ops (NOT_INTEGRATED 7)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/maintenance-reminders` ✚ | list_7 | List maintenance reminders | Bearer | maintenance.read | status, deviceId, type, pageNumber, pageSize | — | 200 ReminderDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |
| POST `/maintenance-reminders` ✚ | create_6 | Create maintenance reminder | Bearer | maintenance.create | — | ReminderRequest* | 200 ReminderDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |
| GET `/maintenance-reminders/{id}` ✚ | get_6 | Get one maintenance reminder | Bearer | maintenance.read | {id}* | — | 200 ReminderDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |
| PUT `/maintenance-reminders/{id}` ✚ | update_6 | Update one maintenance reminder | Bearer | maintenance.update | {id}* | ReminderRequest* | 200 ReminderDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |
| POST `/maintenance-reminders/{id}/cancel` ✚ | cancel | Cancel maintenance reminder | Bearer | maintenance.update | {id}* | — | 200 ReminderDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |
| POST `/maintenance-reminders/{id}/complete` ✚ | complete | Complete maintenance reminder | Bearer | maintenance.update | {id}* | — | 200 ReminderDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |
| GET `/maintenance-reminders/upcoming` ✚ | upcoming | List maintenance reminders upcoming | Bearer | maintenance.read | withinDays, withinKm, deviceId | — | 200 UpcomingDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Maintenance (new screen, Phase 7) |

### me-controller — 7 ops (INTEGRATED 6 · NOT_INTEGRATED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/me` | get_13 | Current user profile | Bearer | none (any signed-in user) | — | — | 200 CurrentUserDto | own user (selector accepted) | Shell (session) | api/auth-service.ts (authService.me) | **INTEGRATED** | Profile display only since Phase 2–3; not used to authorise |
| PATCH `/me` | update_13 | Update my profile | Bearer | none (any signed-in user) | — | UpdateMeRequest* | 200 CurrentUserDto | own user (selector accepted) | Settings | api/account-service.ts (accountService.updateMe) | **INTEGRATED** | — |
| GET `/me/menus` | menus | Menu tree visible to the current user | Bearer | none (any signed-in user) | — | — | 200 MenuNodeDto[] | own user (selector accepted) |  | api/auth-service.ts (authService.myMenus) | **NOT_INTEGRATED** | Service method exists (api/auth-service.ts (authService.myMenus)) but no screen calls it |
| POST `/me/password` | changePassword | Change my password | Bearer | none (any signed-in user) | — | ChangePasswordRequest* | 200 object | own user (selector accepted) | Settings | api/account-service.ts (accountService.changePassword) | **INTEGRATED** | — |
| GET `/me/permissions` ✚ | permissions_1 | Effective identity: platform flag, home/current tenant, role, permission codes, allowed screens + operations | Bearer | none (any signed-in user) | — | — | 200 MyPermissionsDto | own user (selector accepted) | Shell (session) | api/auth-service.ts (authService.myPermissions) | **INTEGRATED** | Phase 2–3: the only authorisation source (identity.ts → access-policy.ts). Not verified against the live BFF |
| GET `/me/preferences` | preferences | Get my preferences | Bearer | none (any signed-in user) | — | — | 200 PreferencesDto | own user (selector accepted) | Overview, Settings | api/account-service.ts (accountService.preferences) | **INTEGRATED** | — |
| PUT `/me/preferences` | savePreferences | Replace my preferences | Bearer | none (any signed-in user) | — | PreferencesDto* | 200 PreferencesDto | own user (selector accepted) | Settings | api/account-service.ts (accountService.savePreferences) | **INTEGRATED** | Request type marks V10-required `theme`, `homeModules`, `deviceInfoFields`, `videoLayout`, `trackAlarmTypeIds`, `expiryReminderMode` optional (full object is sent back as loaded) |

### menu-controller — 5 ops (NOT_INTEGRATED 5)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/menus` | all | List menus | Bearer | menu.manage | — | — | 200 MenuNodeDto[] | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |
| POST `/menus` | create_5 | Create menu | Bearer | menu.manage | — | MenuItemRequest* | 201 MenuNodeDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |
| GET `/menus/{id}` | get_5 | Get one menu | Bearer | menu.manage | {id}* | — | 200 MenuNodeDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |
| PUT `/menus/{id}` | update_5 | Update one menu | Bearer | menu.manage | {id}* | MenuItemRequest* | 200 MenuNodeDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |
| DELETE `/menus/{id}` | delete_5 | Delete one menu | Bearer | menu.manage | {id}* | — | 200 object | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |

### monitor-controller — 2 ops (INTEGRATED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/devices/{id}/track` | track | GPS track (playback) of a device for a time range | Bearer | track.read | {id}*, from*, to*, includeStops, minStopMinutes, positionFilter | — | 200 TrackDto | tenant; SFA all tenants if omitted | Trips & Tracking | api/fleet-service.ts (fleetService.track) | **INTEGRATED** | — |
| GET `/monitor/realtime` | realtime | Live positions/status of devices | Bearer | device.read | deviceIds | — | 200 RealtimeDto | tenant; SFA all tenants if omitted | Overview, Live Monitoring, Vehicles & Assets | api/fleet-service.ts (fleetService.realtime) | **INTEGRATED** | — |

### notification-controller — 5 ops (INTEGRATED 5)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/notifications` | list_15 | List notifications | Bearer | none (any signed-in user) | unreadOnly, type, pageNumber, pageSize | — | 200 NotificationDto[] | own user (selector accepted) | Shell — notifications | api/alert-service.ts (alertService.listNotifications) | **INTEGRATED** | — |
| POST `/notifications/{id}/read` | read | Mark one notification read | Bearer | none (any signed-in user) | {id}* | — | 200 NotificationDto | own user (selector accepted) | Shell — notifications | api/alert-service.ts (alertService.markNotification) | **INTEGRATED** | — |
| POST `/notifications/{id}/unread` | unread | Mark one notification unread | Bearer | none (any signed-in user) | {id}* | — | 200 NotificationDto | own user (selector accepted) | Shell — notifications | api/alert-service.ts (alertService.markNotification) | **INTEGRATED** | — |
| POST `/notifications/read-all` | readAll | Mark all my notifications read | Bearer | none (any signed-in user) | — | — | 200 object | own user (selector accepted) | Shell — notifications | api/alert-service.ts (alertService.markAllRead) | **INTEGRATED** | — |
| GET `/notifications/unread-count` | unreadCount | Get notifications unread count | Bearer | none (any signed-in user) | — | — | 200 object | own user (selector accepted) | Shell — notifications | api/alert-service.ts (alertService.unreadCount) | **INTEGRATED** | — |

### platform-controller — 2 ops (INTEGRATED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST `/platform/switch-tenant` ✚ | switchTenant | Select the tenant to work in (no new token issued) | Bearer | tenant.all | — | SwitchTenantRequest* | 200 TenantSelectionDto | platform (`tenant.all`) | — | — | **INTEGRATED** (Phase 5) | `platformService.switchTenant()` via top-bar switcher and Tenants screen; body `{tenantId}`, no tenant header; response `header` = header name used afterwards. (Phase 4 doc wrongly marked this row instead of GET `/platform/tenants`; corrected in Phase 5.) |
| GET `/platform/tenants` ✚ | tenants | List all tenants with user/device/driver counts (Safe-Fare Admin) | Bearer | tenant.all | — | — | 200 TenantDto[] | platform (`tenant.all`) | — | — | **INTEGRATED** (Phase 4) | `platformService.tenants()` → Platform Overview, Tenants screen, tenant switcher. PLATFORM_WIDE: never carries the tenant header |

### push-token-controller — 3 ops (NOT_INTEGRATED 3)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/me/push-tokens` ✚ | list_6 | List my push tokens | Bearer | none (any signed-in user) | — | — | 200 PushTokenDto[] | own user (selector accepted) | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Notifications — web push (product decision) |
| POST `/me/push-tokens` ✚ | register | Create my push token | Bearer | none (any signed-in user) | — | PushTokenRequest* | 200 PushTokenDto | own user (selector accepted) | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Notifications — web push (product decision) |
| DELETE `/me/push-tokens` ✚ | unregister | Remove my push tokens | Bearer | none (any signed-in user) | — | TokenRef* | 200 object | own user (selector accepted) | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Notifications — web push (product decision) |

### reference-controller — 6 ops (INTEGRATED 5 · NOT_INTEGRATED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/reference/alarm-types` | alarmTypes | List reference alarm types | Bearer | none (any signed-in user) | category, active | — | 200 AlarmTypeDto[] | tenant; SFA all tenants if omitted | Alerts & Events | api/fleet-service.ts (fleetService.alarmTypes) | **INTEGRATED** | — |
| PATCH `/reference/alarm-types/{id}` | updateAlarmType | Partially update one alarm type | Bearer | reference.manage | {id}* | AlarmTypeUpdate* | 200 AlarmTypeDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Reference Data (Phase 7) |
| GET `/reference/device-models` | deviceModels | List reference device models | Bearer | none (any signed-in user) | — | — | 200 DeviceModelDto[] | tenant; SFA all tenants if omitted | Vehicles & Assets | api/fleet-service.ts (fleetService.deviceModels) | **INTEGRATED** | — |
| GET `/reference/object-types` | objectTypes | List reference object types | Bearer | none (any signed-in user) | category | — | 200 ObjectTypeDto[] | tenant; SFA all tenants if omitted | Vehicles & Assets | api/fleet-service.ts (fleetService.objectTypes) | **INTEGRATED** | — |
| GET `/reference/protocols` | protocols | List reference protocols | Bearer | none (any signed-in user) | — | — | 200 ProtocolDto[] | tenant; SFA all tenants if omitted | Vehicles & Assets | api/fleet-service.ts (fleetService.protocols) | **INTEGRATED** | — |
| GET `/reference/statuses` ✚ | statuses | Status value sets, transitions and API conventions | Bearer | none (any signed-in user) | — | — | 200 CatalogDto | tenant; SFA all tenants if omitted | — | — | **INTEGRATED** (Phase 6) | `fleetService.statusCatalog()` → Tenants screen: documented tenant statuses in the status filter and details (only if a set names tenants; nothing assumed otherwise). Other sets unused (Phase 7) |

### renewal-controller — 2 ops (NOT_INTEGRATED 1 · BACKEND_BLOCKED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/renewals` | list_5 | List renewals | Bearer | renewal.manage | pageNumber, pageSize | — | 200 RenewalDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Vehicles — service renewal |
| POST `/renewals` | renew | Create renewal | Bearer | renewal.manage | — | RenewalRequest* | 200 RenewalDto | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | Consumes vendor coins — product approval needed |

### report-controller — 6 ops (INTEGRATED 4 · NOT_INTEGRATED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/reports/driving` | driving | List reports driving | Bearer | report.read | from*, to*, deviceIds, pageNumber, pageSize | — | 200 ActivityDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Reports | api/fleet-service.ts (fleetService.activityReport) | **INTEGRATED** | — |
| GET `/reports/export` ✚ | export_1 | Get reports export | Bearer | report.read | type*, format, from, to, deviceIds, mediaType | — | 200 — | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Reports (Phase 7) |
| GET `/reports/idle` ✚ | idle | Get reports idle | Bearer | report.read | from, to, deviceIds, idleLitresPerHour | — | 200 IdleReport | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Reports (Phase 7) |
| GET `/reports/media` | media | List reports media | Bearer | report.read | from*, to*, deviceIds, mediaType, pageNumber, pageSize | — | 200 MediaDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Reports | api/fleet-service.ts (fleetService.mediaReport) | **INTEGRATED** | Optional V10 params not offered: `mediaType` |
| GET `/reports/mileage` | mileage | List reports mileage | Bearer | report.read | from*, to*, deviceIds | — | 200 MileageDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Reports | api/fleet-service.ts (fleetService.mileageReport) | **INTEGRATED** | — |
| GET `/reports/parking` | parking | List reports parking | Bearer | report.read | from*, to*, deviceIds, pageNumber, pageSize | — | 200 ActivityDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Reports | api/fleet-service.ts (fleetService.activityReport) | **INTEGRATED** | — |

### report-schedule-controller — 6 ops (NOT_INTEGRATED 6)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/report-schedules` ✚ | list_4 | List report schedules | Bearer | report.schedule | pageNumber, pageSize | — | 200 ScheduleDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Report schedules (new screen, Phase 7) |
| POST `/report-schedules` ✚ | create_4 | Create report schedule | Bearer | report.schedule | — | ScheduleRequest* | 200 ScheduleDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Report schedules (new screen, Phase 7) |
| GET `/report-schedules/{id}` ✚ | get_4 | Get one report schedule | Bearer | report.schedule | {id}* | — | 200 ScheduleDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Report schedules (new screen, Phase 7) |
| PUT `/report-schedules/{id}` ✚ | update_4 | Update one report schedule | Bearer | report.schedule | {id}* | ScheduleRequest* | 200 ScheduleDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Report schedules (new screen, Phase 7) |
| DELETE `/report-schedules/{id}` ✚ | delete_4 | Delete one report schedule | Bearer | report.schedule | {id}* | — | 200 object | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Report schedules (new screen, Phase 7) |
| POST `/report-schedules/{id}/run` ✚ | run | Run one report schedule now | Bearer | report.schedule | {id}* | — | 200 — | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Report schedules (new screen, Phase 7) |

### role-controller — 14 ops (INTEGRATED 11 · NOT_INTEGRATED 3)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/permissions` | permissions | List permissions | Bearer | role.permission.read or permission.manage | — | — | 200 PermissionDto[] | tenant; SFA all tenants if omitted | Users & Sub-Accounts; Permission Catalogue; role editor | api/admin-service.ts (tenant-scoped); api/role-admin-service.ts (PLATFORM_WIDE) | **INTEGRATED** | Phase 7: also the catalogue, sent without a tenant header |
| POST `/permissions` ✚ | createPermission | Create permission | Bearer | permission.manage | — | CreatePermissionRequest* | 201 PermissionDto | tenant; SFA must send tenantId | Permission Catalogue | api/role-admin-service.ts (createPermission) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); schema-validated (code pattern, scope TENANT/PLATFORM) |
| PUT `/permissions/{code}` ✚ | updatePermission | Update one permission | Bearer | permission.manage | {code}* | UpdatePermissionRequest* | 200 PermissionDto | tenant; SFA must send tenantId | Permission Catalogue | api/role-admin-service.ts (updatePermission) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); scope-change warning |
| DELETE `/permissions/{code}` ✚ | deletePermission | Delete one permission | Bearer | permission.manage | {code}* | — | 200 object | tenant; SFA must send tenantId | Permission Catalogue | api/role-admin-service.ts (deletePermission) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); confirmation with frontend-usage warning |
| GET `/roles` | list_3 | List roles | Bearer | role.read | — | — | 200 RoleDto[] | tenant; SFA all tenants if omitted | Users & Sub-Accounts; Global Roles | api/admin-service.ts (listRoles, tenant-scoped); api/role-admin-service.ts (listRoles, PLATFORM_WIDE) | **INTEGRATED** | Phase 7: also the Global Roles list, sent without a tenant header |
| POST `/roles` | create_3 | Create role | Bearer | role.manage | — | CreateRoleRequest* | 201 RoleDto | tenant; SFA must send tenantId | Global Roles | api/role-admin-service.ts (createRole) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header) → global role; server field errors shown |
| GET `/roles/{id}` | get_3 | Get one role | Bearer | role.read | {id}* | — | 200 RoleDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | Not needed: GET /roles returns every field the screens use (Phase 7) |
| PUT `/roles/{id}` | update_3 | Update one role | Bearer | role.manage | {id}* | UpdateRoleRequest* | 200 RoleDto | tenant; SFA must send tenantId | Global Roles | api/role-admin-service.ts (updateRole) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); description only; disabled for protectedRole (frontend choice) |
| DELETE `/roles/{id}` | delete_3 | Delete one role | Bearer | role.manage | {id}* | — | 200 object | tenant; SFA must send tenantId | Global Roles | api/role-admin-service.ts (deleteRole) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); confirmation; disabled for protectedRole / activeUsers > 0 (frontend choice) |
| GET `/roles/{id}/permissions` ✚ | rolePermissions | Get permissions of one role | Bearer | role.permission.read | {id}* | — | 200 RolePermissionsDto | tenant; SFA all tenants if omitted | Global Roles → Permissions | api/role-admin-service.ts (rolePermissions) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); global roles only; editable / fullAccess honoured |
| POST `/roles/{id}/permissions` ✚ | addPermissions | Add permission codes to one role | Bearer | role.permission.create | {id}* | RolePermissionsRequest* | 200 RolePermissionsDto | tenant; SFA must send tenantId | Global Roles → Permissions | api/role-admin-service.ts (addRolePermissions) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); additions after review; re-read after save |
| PUT `/roles/{id}/permissions` | replacePermissions | Replace the permission codes of one role | Bearer | role.permission.update | {id}* | RolePermissionsRequest* | 200 RolePermissionsDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | Deliberately not used (Phase 7): full replace could overwrite concurrent changes; the POST/DELETE deltas are used instead |
| DELETE `/roles/{id}/permissions` ✚ | removePermissions | Remove permission codes (`codes*`) from one role | Bearer | role.permission.delete | {id}*, codes* | — | 200 RolePermissionsDto | tenant; SFA must send tenantId | Global Roles → Permissions | api/role-admin-service.ts (removeRolePermissions) | **INTEGRATED** (Phase 7) | PLATFORM_WIDE (no tenant header); repeated `codes` query; partial failure reported |
| GET `/roles/permission-matrix` ✚ | matrix | Roles × permissions matrix for a tenant | Bearer | role.permission.read | — | — | 200 PermissionMatrixDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | Not used (Phase 7): per-role reads cover the mapping editor; a matrix view is a possible follow-up |

### safety-controller — 7 ops (INTEGRATED 5 · NOT_INTEGRATED 2)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/drivers/{id}/safety-events` | driverEvents | List safety events of one driver | Bearer | alarm.read | {id}*, from, to, pageNumber, pageSize | — | 200 AlertRow[] | tenant; SFA all tenants if omitted | Drivers | api/insight-service.ts (insightService.driverSafetyEvents) | **INTEGRATED** | — Phase 8: requested only with `alarm.read`; attribution is the server's. |
| GET `/drivers/{id}/safety-score` | driverScore | Get safety score of one driver | Bearer | alarm.read | {id}*, from, to | — | 200 DriverScoreDto | tenant; SFA all tenants if omitted | Drivers | api/insight-service.ts (insightService.driverScore) | **INTEGRATED** | — Phase 8: requested only with `alarm.read` (widget `drivers.safety`). |
| GET `/safety/analytics` | analytics | Get safety analytics | Bearer | alarm.read | from, to | — | 200 AnalyticsDto | tenant; SFA all tenants if omitted | Safety Analytics | api/insight-service.ts (insightService.safetyAnalytics) | **INTEGRATED** | — |
| GET `/safety/false-positives` ✚ | falsePositives | Get safety false positives | Bearer | alarm.read | from, to | — | 200 FalsePositiveDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Safety Analytics (Phase 7) |
| GET `/safety/heatmap` ✚ | heatmap | Get safety heatmap | Bearer | alarm.read | from, to, cellDegrees, alarmTypeIds, maxSeverity, south, west, north, east | — | 200 HeatmapDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Safety Analytics (Phase 7) |
| GET `/safety/scores/drivers` | driverScores | List safety scores drivers | Bearer | alarm.read | from, to, pageNumber, pageSize | — | 200 ScoreDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Safety Analytics | api/insight-service.ts (insightService.scores) | **INTEGRATED** | — |
| GET `/safety/scores/vehicles` | vehicleScores | List safety scores vehicles | Bearer | alarm.read | from, to, pageNumber, pageSize | — | 200 ScoreDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Safety Analytics | api/insight-service.ts (insightService.scores) | **INTEGRATED** | — |

### screen-controller — 3 ops (NOT_INTEGRATED 3)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PUT `/menus/{id}/operations` ✚ | replaceOperations | Replace operations of one menu | Bearer | menu.manage | {id}* | OperationsRequest* | 200 OperationDto[] | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |
| GET `/screens` ✚ | screens | Screen catalogue with operations and required permissions | Bearer | role.permission.read or menu.manage | — | — | 200 ScreenDto[] | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |
| GET `/screens/{menuKey}/operations` ✚ | operations | List operations of one screen | Bearer | role.permission.read or menu.manage | {menuKey}* | — | 200 OperationDto[] | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Screen/Menu Management (Phase 7) |

### search-controller — 1 ops (INTEGRATED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/search` | search | Global search across record types | Bearer | device.read | q*, limit | — | 200 object | tenant; SFA all tenants if omitted | Shell — global search | api/assistant-service.ts (assistantService.search) | **INTEGRATED** | — |

### trip-controller — 7 ops (INTEGRATED 4 · NOT_INTEGRATED 3)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/trips` | list_2 | List trips | Bearer | track.read | from, to, deviceId, driverId, pageNumber, pageSize | — | 200 TripDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Trips & Tracking, Vehicles & Assets | api/insight-service.ts (insightService.listTrips) | **INTEGRATED** | — |
| POST `/trips` ✚ | create_2 | Create trip | Bearer | trip.create | — | TripRequest* | 200 TripDetailDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Trips & Tracking (Phase 7) |
| GET `/trips/{id}` | get_2 | Get one trip | Bearer | track.read | {id}* | — | 200 TripDetailDto | tenant; SFA all tenants if omitted | Trips & Tracking | api/insight-service.ts (insightService.tripDetail) | **INTEGRATED** | — |
| PUT `/trips/{id}` ✚ | update_2 | Update one trip | Bearer | trip.update | {id}* | TripRequest* | 200 TripDetailDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Trips & Tracking (Phase 7) |
| DELETE `/trips/{id}` ✚ | delete_2 | Delete one trip | Bearer | trip.delete | {id}* | — | 200 object | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Trips & Tracking (Phase 7) |
| GET `/trips/{id}/route` | route | Get route of one trip | Bearer | track.read | {id}* | — | 200 RouteDto | tenant; SFA all tenants if omitted | Trips & Tracking | api/insight-service.ts (insightService.tripRoute) | **INTEGRATED** | — |
| GET `/trips/summary` | summary | Get trips summary | Bearer | track.read | from, to, deviceId, driverId | — | 200 SummaryDto | tenant; SFA all tenants if omitted | Trips & Tracking | api/insight-service.ts (insightService.tripSummary) | **INTEGRATED** | — |

### user-controller — 9 ops (INTEGRATED 8 · BACKEND_BLOCKED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/users` | list_1 | List users | Bearer | user.read | keyword, status, roleId, parentUserId, pageNumber, pageSize, sort | — | 200 UserSummaryDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Users & Sub-Accounts | api/admin-service.ts (adminService.listUsers) | **INTEGRATED** | Optional V10 params not offered: `sort` |
| POST `/users` | create_1 | Create user | Bearer | user.create | — | CreateUserRequest* | 201 UserDetailDto | tenant; SFA must send tenantId | Users & Sub-Accounts | api/admin-service.ts (adminService.createUser) | **INTEGRATED** (Phase 5) | Tenant write, class A create. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/users/{id}` | get_1 | Get one user | Bearer | user.read | {id}* | — | 200 UserDetailDto | tenant; SFA all tenants if omitted | Users & Sub-Accounts | api/admin-service.ts (adminService.getUser) | **INTEGRATED** | — |
| PUT `/users/{id}` | update_1 | Update one user | Bearer | user.update | {id}* | UpdateUserRequest* | 200 UserDetailDto | tenant; SFA must send tenantId | Users & Sub-Accounts | api/admin-service.ts (adminService.updateUser) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| DELETE `/users/{id}` | delete_1 | Delete one user | Bearer | user.delete | {id}* | — | 200 object | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | #24 — cascade to sub-accounts/devices undocumented (`USER_HAS_SUBUSERS` error exists) |
| POST `/users/{id}/password` | resetPassword | Reset another user's password | Bearer | user.update | {id}* | PasswordResetRequest* | 200 object | tenant; SFA must send tenantId | Users & Sub-Accounts | api/admin-service.ts (adminService.resetPassword) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| PATCH `/users/{id}/status` | status | Enable / disable one user (ACTIVE \| DISABLED) | Bearer | user.update | {id}* | StatusRequest* | 200 UserDetailDto | tenant; SFA must send tenantId | Users & Sub-Accounts | api/admin-service.ts (adminService.setStatus) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/users/{id}/unlock` | unlock | Unlock user | Bearer | user.update | {id}* | — | 200 UserDetailDto | tenant; SFA must send tenantId | Users & Sub-Accounts | api/admin-service.ts (adminService.unlock) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/users/tree` | tree_1 | List users tree | Bearer | user.read | — | — | 200 UserTreeNode[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Users & Sub-Accounts | api/admin-service.ts (adminService.userTree) | **INTEGRATED** | — |

### vendor-user-controller — 6 ops (NOT_INTEGRATED 6)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/vendor-users` | tree | List vendor users | Bearer | vendor.user.read | — | — | 200 VendorUserDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Sub-Accounts (vendor accounts) — scope to confirm |
| POST `/vendor-users` | create | Create vendor user | Bearer | vendor.user.create | — | CreateRequest* | 200 VendorUserDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Sub-Accounts (vendor accounts) — scope to confirm |
| GET `/vendor-users/{id}` | get | Get one vendor user | Bearer | vendor.user.read | {id}* | — | 200 VendorUserDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Sub-Accounts (vendor accounts) — scope to confirm |
| PUT `/vendor-users/{id}` | update | Update one vendor user | Bearer | vendor.user.update | {id}* | UpdateRequest* | 200 VendorUserDto | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Sub-Accounts (vendor accounts) — scope to confirm |
| DELETE `/vendor-users/{id}` | delete | Delete one vendor user | Bearer | vendor.user.delete | {id}*, confirm | — | 200 object | tenant; SFA must send tenantId | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Sub-Accounts (vendor accounts) — scope to confirm |
| GET `/vendor-users/current` | current | Vendor (GPSTrackTech) account of the current tenant | Bearer | vendor.user.read | — | — | 200 VendorUserDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Sub-Accounts (vendor accounts) — scope to confirm |

### video-controller — 7 ops (INTEGRATED 4 · NOT_INTEGRATED 2 · BACKEND_BLOCKED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/devices/{id}/recording-calendar` | calendar | List recording calendar of one device | Bearer | video.playback | {id}*, month* | — | 200 integer[] | tenant; SFA all tenants if omitted | Historical Video | api/fleet-service.ts (fleetService.recordingCalendar) | **INTEGRATED** | — |
| GET `/devices/{id}/recordings` | recordings | List recordings of one device | Bearer | video.playback | {id}*, from*, to*, channel | — | 200 RecordingDto[] | tenant; SFA all tenants if omitted | Historical Video | api/fleet-service.ts (fleetService.recordings) | **INTEGRATED** | — |
| GET `/video/embed` ✚ | embed | Vendor video embed info (demo URL, doc URL, SDK token) for a device | Bearer | video.live or video.playback | deviceId | — | 200 EmbedDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Historical / Live Video (Phase 7) |
| GET `/video/exports` | exports | List video exports | Bearer | video.playback | deviceId, pageNumber, pageSize | — | 200 ExportDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Historical Video | api/fleet-service.ts (fleetService.listExports) | **INTEGRATED** | — |
| POST `/video/exports` | requestExport | Create video export | Bearer | video.playback | — | ExportRequest* | 200 ExportDto | tenant; SFA must send tenantId | Historical Video | api/fleet-service.ts (fleetService.requestExport) | **INTEGRATED** (Phase 5) | Tenant write, class A create. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/video/exports/{id}` | export | Get one export | Bearer | video.playback | {id}* | — | 200 ExportDto | tenant; SFA all tenants if omitted | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Historical / Live Video (Phase 7) |
| GET `/video/sdk-token` | sdkToken | Get video sdk token | Bearer | video.live or video.playback | — | — | 200 SdkTokenDto | tenant; SFA all tenants if omitted | — | — | **BACKEND_BLOCKED** | #20 — vendor video SDK/player not provided; token unusable without it |

### voice-controller — 3 ops (INTEGRATED 1 · NOT_INTEGRATED 1 · BACKEND_BLOCKED 1)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/voices` | list | List voices | Bearer | voice.read | vendorUserId | — | 200 VoiceDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | — | — | **NOT_INTEGRATED** | No service method or UI. Proposed: Geofences — voice prompts |
| POST `/voices` | upload | Create voice | Bearer | voice.create | name*, vendorUserId | object | 200 VoiceDto[] | tenant; SFA must send tenantId | — | — | **BACKEND_BLOCKED** | Uploads change live vendor voice configuration — product approval needed |
| GET `/voices/fence` | fenceVoices | List voices fence | Bearer | geofence.read | — | — | 200 VoiceDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Geofences | api/insight-service.ts (insightService.fenceVoices) | **INTEGRATED** | — |

### workforce-controller — 8 ops (INTEGRATED 8)

| Op | opId | Purpose | Auth | Permission | Params | Body | Response | Tenant | Screen | Service | Status | Missing / blocker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET `/checklist-template` | template | List checklist template | Bearer | workforce.read | — | — | 200 ChecklistItem[] | tenant; SFA all tenants if omitted | Workforce | api/operations-service.ts (operationsService.checklistTemplate) | **INTEGRATED** | — |
| GET `/checklists` | checklists_1 | List checklists | Bearer | workforce.read | driverId, from, to, pageNumber, pageSize | — | 200 ChecklistDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Workforce | api/operations-service.ts (operationsService.listChecklists) | **INTEGRATED** | — |
| GET `/drivers/availability` | availability | Get drivers availability | Bearer | workforce.read | date | — | 200 AvailabilityOverviewDto | tenant; SFA all tenants if omitted | Workforce | api/operations-service.ts (operationsService.availability) | **INTEGRATED** | — |
| GET `/leave-requests` | leave | List leave requests | Bearer | workforce.read | status, driverId, from, to, pageNumber, pageSize | — | 200 LeaveDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Workforce | api/operations-service.ts (operationsService.listLeave) | **INTEGRATED** | — |
| POST `/leave-requests` | create_7 | Create leave request | Bearer | workforce.create | — | LeaveRequest* | 200 LeaveDto | tenant; SFA must send tenantId | Workforce | api/operations-service.ts (operationsService.createLeave) | **INTEGRATED** (Phase 5) | Tenant write, class A create. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/leave-requests/{id}/approve` | approve_1 | Approve leave request | Bearer | workforce.update | {id}* | DecisionRequest | 200 LeaveDto | tenant; SFA must send tenantId | Workforce | api/operations-service.ts (operationsService.decideLeave) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| POST `/leave-requests/{id}/reject` | reject_1 | Reject leave request | Bearer | workforce.update | {id}* | DecisionRequest | 200 LeaveDto | tenant; SFA must send tenantId | Workforce | api/operations-service.ts (operationsService.decideLeave) | **INTEGRATED** (Phase 5) | Tenant write, class B existing-record update. Safe-Fare Admin: sent with `X-Tenant-Id` = selected tenant; not offered without a selection (TENANT_REQUIRED). Tenant users: token tenant, no header |
| GET `/shifts` | shifts | List shifts | Bearer | workforce.read | driverId, from, to, pageNumber, pageSize | — | 200 ShiftDto[] | tenant; SFA all tenants if omitted; rows carry tenantId/tenantName | Workforce | api/operations-service.ts (operationsService.listShifts) | **INTEGRATED** | — |

✚ = new in V10 (not in the 2026-10-29 spec).
