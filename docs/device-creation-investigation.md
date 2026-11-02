# Device creation ("Add vehicle") — investigation

Date: 2026-11-02 · Read-only investigation. **No code changed, no button enabled, no form connected, no API write, no backend change.** Frontend branch `new-features/Prakash` @ `eccc41e`; working tree preserved (83 entries before this report).

## 0. Scope and what could not be inspected

| Requested location | Status on this machine |
|---|---|
| Frontend `D:\Fleet-Management-UI\safefareai-ui` | **Not present.** The machine has no `D:` drive. The same application (SafeFare AI, with the exact files named in the brief: `vehicles-page.tsx`, `new-vehicle.tsx`, `vehicle-form.tsx`, `WRITES_PENDING`) is at `C:\Sconex-Projects\Drive Vision`, and that copy was inspected. If the `D:` checkout differs, re-check §1 against it. |
| Python backend `D:\Python-Safe-Fare-APIS` | **Not present anywhere on `C:`.** No folder with that or a similar name, and no Python project markers (`pyproject.toml`, `requirements.txt`, `manage.py`) in any project folder. **No Python source was inspected.** |

Consequently, the following **can't be established from code**:
- the server-side implementation of `POST /api/v1/devices`;
- whether it calls GPSTrackTech synchronously or only writes a local record;
- database tables and columns;
- charging logic.

Everything below is labelled with its evidence:
- **[V10]** — the OpenAPI contract `docs/openapi/api-docs-v10.json`.
- **[Vendor map]** — `C:\Users\user\Downloads\Fleet_Feature_API_Mapping.xlsx`, the team's GPSTrackTech mapping. Read from an isolated copy; sheets "Feature-API Mapping", "API Catalogue", "BFF Added Features", "Notes and Risks".
- **[Repo]** — this repository's code and earlier evidence docs.
- **[Brief]** — stated in the request and not verifiable here (e.g. the real `/me/permissions` payload isn't in the repo).

Also found and checked: `C:\Sconex-Projects\test-api-vehicle\gps-vendor-api-tester`. This is a standalone Next.js key tester that calls only `GET https://y.gpstracktech.com/api/vehicle/getTerminalType` (read-only), so it says nothing about device creation.

---

## 1. Existing frontend behaviour [Repo]

| Item | Behaviour |
|---|---|
| `vehicles/vehicles-page.tsx` | "New group" and "Add vehicle" are **hard-coded `disabled`** with `title={WRITES_PENDING}` ("Adding, editing, moving and deleting devices is disabled until write operations are approved."). No permission check is involved; they're disabled for everyone. |
| `vehicles/vehicle-detail.tsx` | Three write buttons (edit / move / delete) are hard-coded disabled with the same text. |
| `/drive-vision/vehicles/new` → `vehicles/new-vehicle.tsx` | **Placeholder.** An `EmptyState`: "Adding devices isn't enabled yet … Registering a device may involve vendor charges, so it needs a product-owner decision first." Its code comment names `DeviceRequest.confirmChargeableChange` as the open question. |
| `vehicles/vehicle-form.tsx` | **Not mounted anywhere.** A pre-V10 sample form built on the legacy mock layer: `useFleet` store, `mock-data/catalog` (`TERMINAL_MODELS`, `VEHICLE_TYPES`, `PROTOCOL_LABELS`), `services/core` `ServiceError`, `features/drive-vision/types` (`VehicleInput`). Field names follow the **vendor** `addVehicle` API, not V10 (§6). |
| API layer `api/fleet-service.ts` | Read-only for devices: `listDevices`, `listAllDevices`, `getDevice`, `track`, `realtime`, `listGroups`, reference reads (`deviceModels`, `protocols`, `objectTypes`, `alarmTypes`, `statusCatalog`). **No `createDevice` method and no `DeviceRequest` type.** |
| Access policy `access/access-policy.ts` | Screen `vehicles` = `device.read`. **No device write actions** (`devices.create` etc. don't exist). The Phase 5 tenant classes don't cover device writes yet. |
| Mapping doc | `POST /devices` = **BACKEND_BLOCKED**, "#19 — `confirmChargeableChange` semantics undocumented (vendor charges)". |

## 2. Exact backend API contract [V10]

### `POST /api/v1/devices` (operationId `create_12`, device-controller)
- **Permission:** `device.create`.
- **Parameters:** only the generic optional `X-Tenant-Id` (header) / `tenantId` (query).
- **Body:** `DeviceRequest` (required).
- **Responses:**
  - `200 ApiResponseDeviceDto` (200, not 201).
  - `400` "VALIDATION_FAILED, MALFORMED_REQUEST, INVALID_VALUE or another 400 error code; see fieldErrors".
  - `401`, `403`.
  - `409` "Conflict: duplicate, record in use, transition not allowed (OPERATION_NOT_ALLOWED) or CONFIRMATION_REQUIRED".
  - `500`, `502` "VENDOR_AUTH_FAILED or VENDOR_RESPONSE_INVALID", `503`, `504`.
- **Description:** only the permission. No text about tenants, the vendor or charges.

`DeviceRequest` — **required:** `groupId, name, terminalNo, modelName, protocol, objectTypeId, cameraCount`.

| Field | Type / rule |
|---|---|
| `groupId` | int64 |
| `name` | string ≤ 100 |
| `terminalNo` | string, pattern `^[0-9A-Za-z]{11,20}$` |
| `modelName` | string ≤ 60 |
| `protocol` | int32, 1–3 |
| `objectTypeId` | int32 |
| `cameraCount` | int32, 0–16 |
| `plateColor` | string ≤ 30 |
| `simNumber` | string ≤ 30 |
| `serviceCode` | string ≤ 20 |
| `remark` | string ≤ 500 |
| `frameNo` | string ≤ 60 |
| `insuranceDueAt`, `maintenanceDueAt` | date-time |
| `driverName` ≤150, `driverCard` ≤60, `driverPhone` ≤30, `driverGender` int 0–1, `drivingLicense` ≤60, `driverRemark` ≤500 | driver info stored **on the device** |
| `confirmChargeableChange` | boolean — **no description anywhere in V10** |

`DeviceDto` (response): `id, vendorVehicleId, groupId, name, terminalNo, modelId, protocolCode, objectTypeId, plateColor, simNumber, cameraCount, cameraLines[], frameNo, remark, activatedAt, expiresAt, insuranceDueAt, maintenanceDueAt, driver (DriverInfo), terminal (TerminalInfo: iccid, model, hardwareVersion, firmwareVersion, syncedAt), vendorCreatedAt, vendorUpdatedAt, syncedAt`.

**Related operations:**

| Operation | Permission | Notes |
|---|---|---|
| `PUT /devices/{id}` | `device.update` | Same `DeviceRequest` (full replace) |
| `DELETE /devices/{id}` | `device.delete` | — |
| `POST /devices/transfer` | `device.update` | `TransferRequest {deviceIds*, groupId*, fromVendorUserId, toVendorUserId}` |
| `GET /groups` | `group.read` | — |
| `POST /groups` | `group.create` | `GroupRequest {name*, email, phone}` |
| `GET /reference/device-models` | any signed-in user | → `{id, name, protocols[{code, name}]}` |
| `GET /reference/protocols` | any signed-in user | → `{code, name}` |
| `GET /reference/object-types?category=` | any signed-in user | → `{id, name, category}` |
| `GET /vendor-users/current` | `vendor.user.read` | "Vendor (GPSTrackTech) account of the current tenant" |

**Relevant error codes** (global enum): `TERMINAL_NO_TAKEN`, `CHARGEABLE_CHANGE`, `CONFIRMATION_REQUIRED`, `TENANT_REQUIRED`, `INVALID_TENANT`, `VENDOR_AUTH_FAILED`, `VENDOR_RESPONSE_INVALID`, `VENDOR_UNAVAILABLE`, `VENDOR_NOT_CONFIGURED`, `VENDOR_PERMISSION_DENIED`, `GROUP_HAS_DEVICES`.

## 3. Python backend — findings

**Not inspected: the project isn't on this machine (§0).** What can be said about its role:

- **[Vendor map]** "BFF Added Features" proposes this split:
  - **Java** (Spring Security) for authentication and roles, the API, alarm workflow, command audit, push, multi-tenant isolation ("tenant_id on every table"), and the vendor gateway/cache ("Java gateway"; "the key header is a master credential — keep it only in the BFF").
  - **Python** for workers and analytics: alarm ingestion (Celery), the S3 evidence library, position history, safety scores, trip detection, heatmaps, reports.
- **[V10]** The API the frontend uses is the "Safe-Fare Fleet BFF" at `http://185.193.19.156:9096`. Its operationIds (`create_12` …) and conventions point to a Spring service. `POST /api/v1/devices` belongs to **this BFF**, not to a Python API.
- **[Repo]** The frontend has **no Python client**; `NEXT_PUBLIC_PYTHON_API_BASE_URL` is commented out in `.env.local`. No Python Swagger was ever supplied (dependency D7).

Conclusion: by the documented design, device creation isn't a Python responsibility. Whether `D:\Python-Safe-Fare-APIS` nonetheless implements devices (or *is* the BFF) **can only be answered by inspecting that project.**

## 4. Does creation call GPSTrackTech or only save locally?

**Not established by code** (backend source unavailable). The evidence strongly indicates **vendor registration**:

| Evidence | Source |
|---|---|
| "Add device → **1.1 POST /vehicle/addVehicle**" (body groupId, plate, vehicleType, terminalNo, terminalType, cameraNum, protocol 1=808 / 2=GT06 / 3=V3, plateColor; optional sim, serviceCode, remark, driver fields, insuranceDueDate, maintainDate, frameNo → returns the created device with `vehicleId`) | [Vendor map] |
| `DeviceRequest` mirrors that body almost field by field (incl. driver fields, serviceCode, frameNo, protocol 1–3) | [V10] |
| `DeviceDto.vendorVehicleId`, `vendorCreatedAt`, `vendorUpdatedAt`, `syncedAt`; `GroupDto.vendorGroupId` | [V10] |
| `502` on POST `/devices` = "VENDOR_AUTH_FAILED or VENDOR_RESPONSE_INVALID" — a vendor call can fail the request | [V10] |
| Every tenant has a vendor account (`/vendor-users/current`) | [V10] |
| Dev BFF reads answered `source: LOCAL, stale: true, fallbackReason: VENDOR_NOT_CONFIGURED` (observed 2026-10-26) — the dev vendor feed was **not configured** then | [Repo] `api-integration-checklist.md` |

**Unknown:**
- whether the vendor call is synchronous or queued;
- what happens on dev while the vendor is not configured (`VENDOR_NOT_CONFIGURED` error, or a local-only record that is synced later);
- whether a local row survives a vendor failure.

## 5. Vendor side effects and charges

| Vendor operation | Charge documented? | Source |
|---|---|---|
| **1.1 addVehicle** (create) | **No charge documented.** | [Vendor map] |
| 1.2 updateVehicle (edit) | **"terminalType change may deduct coins"** (terminalType ↔ V10 `modelName`) | [Vendor map] |
| 1.3 delVehicle | Irreversible at the vendor | [Vendor map], [Repo] |
| 7.1 vehicleRecharge (renewal) | **Consumes coins** (`data.Coins`) | [Vendor map] |
| Delete group with `cascadeDevices` / delete vendor user | Also deletes devices | [Vendor map], [V10] |

**What is not known, and why it matters:**
- `confirmChargeableChange` is on `DeviceRequest`, which is **shared by POST and PUT**, and `CHARGEABLE_CHANGE` / `CONFIRMATION_REQUIRED` exist. V10 doesn't say whether creating a device can be chargeable, or which change is.
- `activatedAt` / `expiresAt` exist and renewal costs coins, so **registering a device may start a paid service period or consume a licence at the vendor**. Nothing documents this either way.
- **Side effects beyond charges:**
  - the device appears in the tenant's GPSTrackTech account (and the vendor's own UI);
  - `terminalNo` becomes taken (`TERMINAL_NO_TAKEN`);
  - removing it needs `DELETE`, which is irreversible at the vendor.

**Conclusion: the vendor-charge concern is unresolved and can't be closed from code available here.**

## 6. `vehicle-form.tsx` vs. `DeviceRequest`

**It does not match**; it was written against the vendor API and the mock store.

| Form field (FormState) | V10 `DeviceRequest` | Mismatch |
|---|---|---|
| `vehicleName` | `name` (≤100) | rename |
| `plate` (required, 4–14) | — | **no plate field in V10** (`DeviceDto` has none either). The vendor's `plate` appears to be V10 `name`. Needs a decision: drop, merge into `name`, or a backend field |
| `plateColor` (white / yellow / blue / green / black) | `plateColor` string ≤30 | accepted values undocumented |
| `vehicleType` (mock `VEHICLE_TYPES`) | — | no such field |
| `objectType` (car / people / pets / others) | `objectTypeId` int (required) | must be an id from `GET /reference/object-types` |
| `groupId` (string) | `groupId` int64 (required) | type; must come from `GET /groups` of the **target tenant** |
| `terminalNo`: digits only, 10–15 | `^[0-9A-Za-z]{11,20}$` | **wrong rule**: the form rejects letters and 16–20 characters, and accepts 10 digits, which V10 rejects |
| `terminalType` (mock models) | `modelName` ≤60 (required) | must come from `GET /reference/device-models` |
| `protocol` | `protocol` 1–3 | should come from the chosen model's `protocols[].code` |
| `cameraNum` (mock `maxCameras`) | `cameraCount` 0–16 | V10 has no per-model camera maximum |
| `sim` (ICCID, 15–20 digits) | `simNumber` ≤30 | different rule |
| `frameNo` | `frameNo` ≤60 | ok |
| `driverId` (app driver) | — | **no such field.** `DeviceRequest` has free-text vendor driver fields instead (`driverName`, `driverCard`, `driverPhone`, `driverGender` 0–1, `drivingLicense`, `driverRemark`). Linking an app driver is a separate operation: `POST /drivers/{id}/assignments` (`driver.update`) |
| `insuranceDueDate` (date) | `insuranceDueAt` date-time | rename / format |
| `maintainDate` (date) | `maintenanceDueAt` date-time | rename / format |
| `remark` | `remark` ≤500 | ok |
| — | `serviceCode` ≤20, `confirmChargeableChange` | missing |

The data layer (types, validation, option sources, submit) would have to be rewritten against V10. Some layout could be reused.

## 7. Vehicles vs. devices

**One resource.** V10 has no vehicle entity: `/devices` holds both vehicle attributes (`name`, `plateColor`, `frameNo`, `objectTypeId`, insurance and maintenance dates) and tracker attributes (`terminalNo`, `modelName`, `protocol`, `cameraCount`, `simNumber`, `terminal`). The vendor works the same way: `vehicleId` is the device. The UI's "Vehicles & Assets" screen is the `/devices` resource.

There are **two driver concepts**: free-text driver info stored on the device (vendor fields), and the app's Driver entity linked through assignments (Phase 8).

## 8. Tenant context requirements

| Caller | Behaviour |
|---|---|
| Tenant user | Tenant from the access token; send nothing. Another tenant's id → 403 `TENANT_ACCESS_DENIED`. |
| **Safe-Fare Admin** | V10 convention: creates **must** carry the tenant (`X-Tenant-Id` or `?tenantId`), **otherwise 400 `TENANT_REQUIRED`**. Header and query must not disagree (400 `INVALID_TENANT`). The frontend sends the header only (Phase 5). |

- **Group and tenant:** `groupId` must be a group of the target tenant. Loading `GET /groups` with the same tenant header guarantees that in the UI. V10 doesn't say whether the backend rejects a foreign group (likely a 404 or 400).
- **Vendor account:** the device presumably goes into the **target tenant's GPSTrackTech account** (`/vendor-users/current`). Picking the wrong tenant would register the device under the wrong customer's vendor account, a real-world side effect.
- **Phase 5 fit:** `devices.create` would be a class **A** action (create requires a selected tenant). It's blocked for the Safe-Fare Admin in all-tenants mode, with the existing "select a tenant" treatment; tenant users are unaffected.

## 9. Permission requirements

| Need | Code |
|---|---|
| Create a device | `device.create` [V10] — the Safe-Fare Admin holds it, and its server screen shows Vehicles → CREATE allowed [Brief] |
| Group picker | `group.read` (`GET /groups`) |
| Model / protocol / object-type pickers | any signed-in user |
| Vehicles screen | `device.read` (existing) |
| New group (separate button) | `group.create` |
| Link an app driver afterwards | `driver.update` (assignments) |

All of these go through the central resolver; no role names are used.

## 10. Missing information — backend / business confirmation

1. **Charging:** does `POST /devices` (registration) consume vendor coins or start a paid service period? What does `confirmChargeableChange` gate on **POST** and on **PUT**? When are `CHARGEABLE_CHANGE` and `CONFIRMATION_REQUIRED` returned? What cost should the user be shown?
2. **Vendor call:** synchronous or queued? What happens when the vendor is not configured (dev) or fails: is the local record kept, rolled back or synced later? What is the source of `vendorVehicleId`?
3. **Python backend:** access to `D:\Python-Safe-Fare-APIS` (or its repository), and confirmation of whether it implements any device endpoints.
4. **Data model:** database table(s) and columns for devices and groups; uniqueness of `terminalNo` (global or per tenant).
5. **Plate number:** V10 has no plate field. Is `name` the plate (vendor `plate`), or is a field missing?
6. **Values:** accepted `plateColor` values; `driverGender` coding; `serviceCode` meaning.
7. **Tenant:** confirm that the Safe-Fare Admin sends the selected tenant, and that the device is registered under that tenant's vendor account. Confirm the behaviour for a group of another tenant.
8. **Test environment:** a **disposable test tenant** with its own vendor sub-account (or a vendor sandbox), a non-production terminal number, and **HTTPS**, before any live write.
9. **Product decision:** who may add devices (Safe-Fare Admin only, or tenant admins with `device.create`)?

## 11. Recommended safe implementation plan

**Stage 0 — decisions first (blocking):** items 1, 2 and 8 of §10, plus a product-owner sign-off on charges.

**Stage 1 — no writes possible** (can start now, safe):
- Add a typed `DeviceRequest` and a pure, tested model:
  - `validateDeviceForm` mirroring V10 (terminal pattern, lengths, ranges, required fields);
  - `deviceRequestBody` (blank optionals omitted; never `confirmChargeableChange` by default).
- Rebuild `vehicle-form.tsx` on live reference data: groups from `GET /groups` in the target tenant, models with their protocols, object types. Drop `plate`, `vehicleType` and `driverId` until §10.5 is answered; offer the vendor driver fields as optional free text.
- Keep the page behind a hard flag, **off by default**, and keep the button disabled. Add the service method `createDevice` (`tenant` follows the Phase 5 classification), unit-tested against a stub fetch only.

**Stage 2 — wiring, still disabled:**
- Register `devices.create` (`device.create`, `POST /api/v1/devices`, `tenantWrite: true`, class A) in the access policy; the contract test checks it against V10.
- Gate the button with `useActionGate`: hidden without permission; disabled with "select a tenant" for the Safe-Fare Admin in all-tenants mode.

**Stage 3 — submit flow** (only after Stage 0):
- **Review step:** target **tenant name**, group, name, terminal number, model and protocol, cameras, plus a vendor notice worded from the confirmed rules ("registers the device in <tenant>'s GPSTrackTech account; <charge text>").
- **`confirmChargeableChange`:** sent `true` **only** if the backend confirms its meaning **and** the user ticks an explicit acknowledgement. A `CONFIRMATION_REQUIRED` / `CHARGEABLE_CHANGE` response shows the server's `msg` and asks again; it is never auto-retried with `true`.
- **Errors:** handle `TERMINAL_NO_TAKEN`, `TENANT_REQUIRED`, `VENDOR_*` (502 / 503 / 504, "the device may or may not exist at the vendor — check before retrying") and `VALIDATION_FAILED` `fieldErrors`. Prevent duplicate submits.
- **After success:** re-read the list and open the new device's detail (which shows `vendorVehicleId` / `syncedAt`). Link an app driver through the existing assignments flow, not the device form.

**Stage 4 — one controlled live test:** on the disposable tenant over HTTPS, with backend sign-off: create one test device, verify it at the vendor, then delete it, only if deletion has also been approved.

Out of scope until separately approved: edit (coin-deducting model change), delete (irreversible at the vendor), transfer, group create, renewal.

---

**Investigation complete. Nothing was enabled, connected or written.** Waiting for approval, and ideally for access to the Python backend, before any implementation.
