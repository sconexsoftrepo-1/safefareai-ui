# Device edit — investigation and implementation

Date: 2026-11-02 · Branch `new-features/Prakash` · Spec: `docs/openapi/api-docs-v10.json`

**Verification level:** code, unit / contract tests with a mocked `fetch` and synthetic data, typecheck, lint, production build. **No live backend call and no real write was made.** No browser run was done for this task. Nothing here is live-verified.

## 1. API contract (V10)

`PUT /api/v1/devices/{id}`. operationId `update_11`. Permission `device.update`.

| Item | Contract |
|---|---|
| Path | `id` int64 |
| Tenant | optional `X-Tenant-Id` header or `tenantId` query. The frontend sends only the header, and only when the Safe-Fare Admin has selected a tenant (Phase 5). Tenant users rely on the tenant in their token. Without a tenant, a Safe-Fare Admin write gets `400 TENANT_REQUIRED`. |
| Body | `DeviceRequest`, required. This is a **full replace**. Required fields: `groupId`, `name`, `terminalNo` (`^[0-9A-Za-z]{11,20}$`), `modelName` (≤60), `protocol` (1–3), `objectTypeId`, `cameraCount` (0–16). Optional fields: `plateColor` ≤30, `simNumber` ≤30, `serviceCode` ≤20, `remark` ≤500, `frameNo` ≤60, `insuranceDueAt` / `maintenanceDueAt` (date-time), `driverName` ≤150, `driverCard` ≤60, `driverPhone` ≤30, `driverGender` 0–1, `drivingLicense` ≤60, `driverRemark` ≤500, `confirmChargeableChange` (boolean, undocumented). |
| 200 | `ApiResponseDeviceDto` |
| Errors | 400 `VALIDATION_FAILED` / `MALFORMED_REQUEST` / `INVALID_VALUE` (with `fieldErrors`), 401, 403, 404 `NOT_FOUND` (no such record in the caller's tenant), 409 conflict / `OPERATION_NOT_ALLOWED` / `CONFIRMATION_REQUIRED`, 500, 502 `VENDOR_AUTH_FAILED` / `VENDOR_RESPONSE_INVALID`, 503 `SERVICE_UNAVAILABLE` / `VENDOR_*` / `DATA_UNAVAILABLE`, 504 `VENDOR_OUTCOME_UNKNOWN` ("check the current state before retrying"). The error enum also contains `CHARGEABLE_CHANGE`. |

Contract gaps found while building the request:
- `DeviceDto` returns `modelId`, but the request needs `modelName`. The frontend looks the name up in `GET /reference/device-models` by id. If the name can't be resolved to exactly one model, editing is **blocked**. The app never guesses a model name.
- `DeviceDto` has no `serviceCode`, so a full replace can't resend it. The frontend omits it. **The spec doesn't say whether leaving it out clears the stored value.**
- `activatedAt` and `expiresAt` are managed by the vendor and are not part of the request.

## 2. Charges

The vendor mapping (`Fleet_Feature_API_Mapping.xlsx`) says that edit maps to vendor 1.2 `updateVehicle`, and that a **"terminalType change may deduct coins"**. `terminalType` corresponds to V10 `modelName`. Renewal (7.1) uses coins. Add (1.1) has no documented charge. The backend has not said which `DeviceRequest` fields are chargeable, or what `confirmChargeableChange` does on a PUT.

How the frontend protects against charges:
- The model is **locked** and resent exactly as stored. Protocol, camera count, terminal number, group (changing it is a transfer), object type and driver gender (its coding is undocumented) are also locked.
- `confirmChargeableChange` is **never** sent. `lockedViolations()` re-checks every locked field, and the absence of that flag, immediately before the PUT. If either check fails, the request is not sent.
- `CHARGEABLE_CHANGE` / `CONFIRMATION_REQUIRED` → the user sees "refused", the device is reloaded, nothing is retried, and no "confirm and retry" option is offered.
- `VENDOR_OUTCOME_UNKNOWN` → the device is reloaded and the user is told to check whether the change was applied before trying again.
- Nowhere does the UI claim the operation is free.

## 3. Editable vs locked

| Editable | Locked (resent unchanged, reason shown in the form) |
|---|---|
| name (required), plateColor, simNumber, frameNo, remark, insuranceDueAt, maintenanceDueAt, driverName, driverCard, driverPhone, drivingLicense, driverRemark | modelName (may deduct coins), protocol, cameraCount, terminalNo, groupId (transfer), objectTypeId, driverGender |

- An unchanged date is resent exactly as the stored ISO instant. A date the user edits is sent as 00:00 IST.
- A cleared optional field is omitted from the request. **The spec doesn't say whether the server then clears it.** The form says this too.
- Save stays disabled until something has changed. A second submit is ignored while a save is in progress. The success toast appears only after the PUT resolves, and the device is then re-fetched.

## 4. Permissions and tenant

- New resolver action `devices.update` in `access-policy.ts`: screen `vehicles`, `tenantWrite`, class `EXISTING_RECORD_UPDATE`, `anyOf: ["device.update"]`. No role names are used.
- Safe-Fare Admin with a tenant selected → allowed. In all-tenants mode → the Edit button is shown but disabled, with the "select a tenant" hint. Tenant ADMIN with `device.update` → allowed. Viewer, dispatcher, fleet owner, driver, or any user without `device.update` → no button.
- Server screen narrowing for vehicles is not applied, because the vehicles `routePath` from `/me` is still unknown (D3). This is unchanged from before.

## 5. Not enabled (unchanged)

Add vehicle (`POST /devices`), Delete (`DELETE /devices/{id}`) and Transfer stay disabled with the `WRITES_PENDING` hint. The hint text now reads "Adding, moving and deleting devices…". The `/vehicles/new` placeholder is unchanged. A test asserts that the source has no call sites for those operations.

## 6. Files changed

- `src/features/drive-vision/api/types.ts`: `DeviceRequest`.
- `src/features/drive-vision/api/fleet-service.ts`: `updateDevice(id, body)`.
- `src/features/drive-vision/access/access-policy.ts`: `devices.update`.
- `src/components/drive-vision/vehicles/use-fleet-reference.ts`: exposes `models` / `modelsError`.
- `src/components/drive-vision/vehicles/device-edit-model.ts` (new): baseline, form, validation, build, locked checks, error mapping.
- `src/components/drive-vision/vehicles/device-edit-panel.tsx` (new): slide-over form.
- `src/components/drive-vision/vehicles/vehicle-detail.tsx`: Edit button gated by the resolver; re-fetch after save.
- `src/components/drive-vision/vehicles/vehicles-page.tsx`: `WRITES_PENDING` text.
- Tests: `tests/device-edit.test.cjs` (new, 10 tests). `tests/v10-contract.test.cjs` (runtime case "update device"). `tests/phase5-tenant-context.test.cjs` (class counts 5/20/2; `vehicles` is now tenant-blocked for the Safe-Fare Admin).
- Docs: this report, `v10-api-frontend-mapping.md` (PUT `/devices/{id}` → INTEGRATED; totals 139 / 0 / 67 / 14), `implementation-status.md`.

## 7. Results

| Check | Result |
|---|---|
| `npm test` | 440 / 440 pass |
| `tsc --noEmit` | clean |
| `eslint src tests` | clean |
| `npm run build` | success, 33 routes |
| Browser (mocked) | not run for this task |
| Live backend | not run (HTTP-only BFF, no test tenant) |

## 8. Questions for the backend

1. What does `confirmChargeableChange` do on a PUT? Which fields trigger `CHARGEABLE_CHANGE` / `CONFIRMATION_REQUIRED`? Is it only `modelName`, or also protocol, cameras or object type?
2. `serviceCode` is missing from `DeviceDto`. Does leaving it out of a PUT keep the stored value or clear it? Could it be added to `DeviceDto`?
3. Does leaving out an optional field clear it, or keep it? How should a client clear a field explicitly?
4. Which `plateColor` values are allowed? What do `driverGender` 0 and 1 mean?
5. Vendor sync: is the vendor updated synchronously? On the dev environment, does the PUT return `VENDOR_NOT_CONFIGURED`?
6. Could a test tenant be provided, and the BFF served over HTTPS, so the edit can be verified live without sending real credentials over HTTP?
