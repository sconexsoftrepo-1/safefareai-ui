# Device–Vehicle Mapping and Sensors Vehicle Source — Implementation Report

Date: 2026-11-10 · Branch: `new-features/Prakash` (nothing committed, pushed, reset or discarded)

> **Evidence level:** every result below comes from unit, service and jsdom component tests against a **stub
> backend**. No request was sent to a live Safe-Fare backend, and no device was created, updated or unlinked.
> The backend behaviours in §11 still need live verification.

## 1. Files inspected

- Vehicles & Assets: `vehicles/vehicles-page.tsx`, `vehicle-detail.tsx`, `device-create-panel.tsx`,
  `device-create-model.ts`, `device-edit-panel.tsx`, `device-edit-model.ts`, `use-fleet-reference.ts`
- Services: `api/fleet-service.ts`, `api/vehicle-registry-service.ts`, `api/sensor-service.ts`, `api/client.ts`,
  `api/tenant-scope.ts`, `api/tenant-context.ts`, `api/errors.ts`, `api/types.ts`, `api/types-operations.ts`,
  `hooks/use-api-query.ts`
- Sensors: `sensors/sensors-page.tsx`, `sensors-model.ts`, `sensor-alerts-panel.tsx`, `api/sensor-alerts*.ts`
- Access: `access/access-policy.ts`, `access/use-access`
- Shared UI: `ui/select.tsx`, `shared/confirm-dialog.tsx`, `shared/form-field.tsx`, `shared/status-badge.tsx`
- Contracts: `docs/contracts/vehicle-api.txt`, `docs/openapi/api-docs-v10.json` (through `tests/helpers/v10-contract.cjs`)
- Tests: `device-edit`, `sensors`, `sensor-alerts`, `vehicle-registry`, `v10-contract`, plus the jsdom harness

(Paths are under `src/components/drive-vision/` or `src/features/drive-vision/`.)

## 2. Files modified / added

| File | Change |
|---|---|
| `features/drive-vision/api/types.ts` | `DeviceRequest.vehicleId?`, `DeviceRequest.unlinkVehicle?` |
| `features/drive-vision/api/fleet-service.ts` | `collectPages` and `MAX_PAGE_SIZE` exported so the vehicle service can reuse them (no behaviour change) |
| `features/drive-vision/api/vehicle-registry-service.ts` | `listAllVehicles(query, maxPages = 20)`: GET `/vehicles` in pages of 100 with a `truncated` flag |
| `features/drive-vision/access/access-policy.ts` | `sensors.deviceChoices` now needs `vehicle.read` (GET `/vehicles`); new `devices.vehicleChoices` (`vehicle.read`); the now-unused `sensors.vehicleNumbers` merged into `sensors.deviceChoices` |
| `components/drive-vision/vehicles/device-vehicle-model.ts` **(new)** | Pure mapping logic: options, Available/Assigned state, current vehicle, `applyMapping`, notices, error text |
| `components/drive-vision/vehicles/vehicle-assign-field.tsx` **(new)** | Shared Assign Vehicle picker, status badge and the "Vehicle Already Assigned" dialog |
| `components/drive-vision/vehicles/device-create-model.ts` | `vehicleId` form field, validation, POST body, conflict mapping |
| `components/drive-vision/vehicles/device-create-panel.tsx` | Assign Vehicle field and reassignment confirmation |
| `components/drive-vision/vehicles/device-edit-panel.tsx` | Vehicle section: staged assign, reassignment confirmation, unlink, duplicate-submit guard |
| `components/drive-vision/sensors/sensors-model.ts` | `SensorVehicle`, `sensorVehicles()`, `pickSensorVehicle()` |
| `components/drive-vision/sensors/sensors-page.tsx` | Picker source: GET `/vehicles?assigned=true` (device paths still use `device.id`) |
| `tests/device-vehicle-mapping.test.cjs` **(new)** | 26 tests (model, service, real components) |
| `tests/sensor-alerts.test.cjs` | Sensors page tests moved to the new source (same intent; see §10) |
| `tests/sensors.test.cjs` | Picker permission is now `vehicle.read` |
| `tests/v10-contract.test.cjs` | Documented off-spec allowlist entry for `vehicleId` / `unlinkVehicle` in the request body |

There are no duplicate screens or services. The vehicle list goes through the existing `vehicleRegistryService`, and
device writes go through the existing `fleetService.createDevice` / `updateDevice`.

## 3. Vehicle selection

- **Source:** `GET /api/v1/vehicles?pageNumber=N&pageSize=100`, with **no `assigned` filter**, so both free and
  assigned vehicles are listed. Further pages are fetched until `total` is reached, up to 20 pages (2,000 vehicles).
  Beyond that the picker says "Showing the first N of T vehicles" instead of silently dropping rows.
  `/vehicles/available` and `/vehicles/summary` are not used.
- **Option layout:** vehicle number and status badge, then "type · make model", then for vehicles held by another
  device, "Currently assigned to: <device name, or terminal no.>".
- **Status:** Available is green (`success`), Assigned is amber (`warning`), and the edited device's own vehicle shows
  "This device" in blue (`info`). Every badge has an icon and a text label, so colour is never the only signal.
- **Value:** the vehicle's numeric `id`. It is never the vehicle number or the device id, and validation rejects
  anything that is not a positive integer.
- **States handled:** loading, failure with Retry, stale data after a failed refresh, empty list, no free vehicle,
  every vehicle assigned, truncated list, and missing `vehicle.read` (the picker is not offered and no vehicle
  request is sent).

## 4. Add Device request

- **Assign Vehicle** is optional and offers "No vehicle", so a device can still be created without one.
- **With a vehicle:** the complete DeviceRequest (the 7 required fields plus any filled optional fields) gets
  `"vehicleId": <id>, "unlinkVehicle": false` added.
- **Without a vehicle:** neither field is sent, which is exactly the previous request. No placeholder id is invented.
- **Assigned vehicle picked:** the same "Vehicle Already Assigned" dialog appears. Cancel keeps the previous choice;
  Confirm selects the vehicle, and the backend decides when the device is created.
- **On success:** the existing `toast.success` names the vehicle. `onCreated` closes the panel and refetches the
  device list (existing `vehicles-page` behaviour). The vehicle list is fetched fresh the next time a form opens.
- **On 409 RESOURCE_IN_USE / OPERATION_NOT_ALLOWED / 400 INVALID_REFERENCE:** the server's message appears on the
  vehicle field, the form is kept, and no success is reported.

## 5. Edit Device and reassignment

- The panel shows "Currently assigned: <number>". The field is labelled **Assigned Vehicle** when the device has a
  vehicle and **Assign Vehicle** when it has none.
- **Current vehicle:** `DeviceDto.vehicleId` when the server sends it (`null` means none). If the field is absent,
  the vehicle whose `device.id` equals this device's id is used.
- **Keep:** no mapping field is sent. The contract says "vehicleId omitted → current vehicle kept", so ordinary
  edits produce the same body as before.
- **Another available vehicle:** the change is staged ("1 change: Vehicle") and sent with **Save changes** as one
  full PUT with `{vehicleId, unlinkVehicle: false}`.
- **A vehicle held by another device:** nothing is sent on pick. **Vehicle Already Assigned** shows the vehicle number,
  the current device's name and terminal number, the move warning, and **Cancel / Confirm Reassignment**.
  - Cancel closes the dialog, keeps the previous selection, and sends nothing.
  - Confirm sends **one** `PUT /api/v1/devices/{editedId}` with the complete DeviceRequest (required fields from the
    existing baseline logic, plus any other edits in the form) and `{vehicleId, unlinkVehicle: false}`.
  - The other device is never unlinked by a separate request, and `POST /devices/transfer` is never used. A test
    scans the touched files for any call to it.
- **Body construction:** the body comes from the existing `baselineRequest` / `buildUpdate`. `modelName` is resolved
  from the catalogue by `modelId` and `protocol` from `protocolCode`, so nothing is copied blindly. Locked-field
  checks still run before every send.
- **Duplicate submissions:** blocked by the `saving` state and an in-flight ref. A test submits again while the PUT
  is pending and only one request goes out.
- **On failure:** the server's message is shown inline and in a toast, and no success toast appears. For a 409 or a
  refused reassignment or unlink, the picker returns to the real current vehicle while the other form edits stay.
  When the outcome is unclear (409, 404, 502, 503, 504 or network) the device is re-read. A 403 names `device.update`.

## 6. Unlink

- **Unlink vehicle** appears only when the device has a vehicle. It opens a confirmation ("AP31Z0044 will be
  removed from Camera-07 …"). Cancel sends nothing.
- Confirm sends the complete DeviceRequest with `"vehicleId": 0, "unlinkVehicle": true`.
- On success: a toast says "Vehicle unlinked", and the panel closes and refetches the device. When the panel reopens,
  it shows "No vehicle assigned.", the field reads **Assign Vehicle**, and the freed vehicle shows as Available,
  provided the backend reports it as unassigned.

## 7. Sensors vehicle source

- The picker now uses `GET /api/v1/vehicles?assigned=true&pageNumber=N&pageSize=100` (all pages) instead of
  `GET /api/v1/devices`.
- Each entry is a `SensorVehicle { vehicleId, vehicleNumber, deviceId, deviceName, terminalNo, vehicleType }`. Rows
  without a vehicle id, a vehicle number or a `device.id`, or marked `deviceAssigned: false`, are dropped because
  there is no device to read sensors from.
- The label is the vehicle number (plus the device name), and the option value is the vehicle id.
- The per-vehicle `GET /vehicles/{id}` lookup is no longer needed because the list already carries the number.
- Unchanged: the tabs, Sensor Alerts (still the default tab), the All vehicles option, the time window, Refresh,
  Recalculate, Add reading, the sensor-type filter, the alcohol card and summary cards, and the Python proxy and its
  business logic.
- Deep links: the new `?vehicle=<vehicleId>` works, and the existing `?device=<deviceId>` still resolves to the
  vehicle that device is fitted in.
- Fallbacks: with no assigned vehicles, the screen says so and Sensor Alerts covers all vehicles. If the list fails,
  the error is shown with Retry.

## 8. Device ID vs vehicle ID

| Purpose | Field | Where |
|---|---|---|
| Sensors dropdown label | `vehicleNumber` | `SensorVehicle.vehicleNumber` |
| Sensors dropdown value, `?vehicle=` | `id` | `SensorVehicle.vehicleId` |
| `/devices/{id}/sensors/readings`, `/bms`, `/stops`, `/stops/comparison`, `/passenger-summary`, `/sensors/alcohol`, `/stops/recalculate` | `device.id` | `const deviceId = bus?.deviceId` |
| Python Sensor Alerts `vehicle_number` | `vehicleNumber` | `cleanVehicleNumber(bus?.vehicleNumber)` |
| Device form `vehicleId` | vehicle `id` | `VehicleOption.vehicleId` |
| Who holds a vehicle | `device.id` / `device.name` / `device.terminalNo` | `VehicleOption.deviceId/deviceName/terminalNo` |

The tests deliberately give vehicles and devices different ids (vehicles 501/502 on devices 101/102). They assert
that device paths use 101/102, that dropdown values are 501/502, and that alerts carry only the vehicle number.

## 9. Tenant and permissions

- **Tenant:** no new tenant logic. Every new request goes through the shared client.
  - `/vehicles` and `/devices` are `TENANT_SCOPED`. The Safe-Fare Admin's selected tenant is sent in `X-Tenant-Id`
    and never as `?tenantId`, and no header is sent in all-tenants mode (cross-tenant read preserved).
  - Tenant users stay in their own tenant. Query keys are tenant-prefixed, so a tenant switch refetches.
  - Sensor Alerts still takes its tenant from `access.tenantId`, not from anything the browser sends, and the proxy
    re-enforces it on the server.
- **Permissions:**

  | Permission | What it gates |
  |---|---|
  | `device.read` | Vehicles & Assets screen (unchanged) |
  | `device.create` | Add device: existing `devices.create` gate; the Safe-Fare Admin must select a tenant |
  | `device.update` | Edit, reassign and unlink: existing `devices.update` gate; the Safe-Fare Admin must select a tenant |
  | `vehicle.read` | The Assign Vehicle picker (`devices.vehicleChoices`) and the Sensors picker (`sensors.deviceChoices`) |
  | `sensor.read` | Sensors screen (unchanged) |

- **Behaviour change:** a user with `device.read` but without `vehicle.read` used to be able to pick a bus on Sensors.
  They now see "All vehicles · choosing one vehicle needs vehicle.read" (Sensor Alerts still works for all vehicles).
  This follows from the requested data-source change.

## 10. Tests executed

| Check | Result |
|---|---|
| `npm test` (full regression, 970 tests) | **966 pass, 2 fail.** The same 2 failed before any change in this work (baseline: 944 tests, 940 pass, 2 fail): `access-policy`'s "only unrecognised codes → just the signed-in screen" and "Driver (live fixture): My Work only…". Both are unrelated and were left alone. |
| `tests/device-vehicle-mapping.test.cjs` (new) | 26/26 pass |
| `tests/sensor-alerts.test.cjs`, `sensors.test.cjs`, `v10-contract.test.cjs` | all pass |
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 problems) |
| `npm run build` | pass |

**Coverage of the requested scenarios:**

- **Add Device:** loads all vehicles (no `assigned`); Available/Assigned labels and holder line; selected id → `vehicleId`; `unlinkVehicle: false`; required fields kept; no vehicle → no mapping fields; 409 keeps the form with no false success; loading, error, Retry, empty list and no `vehicle.read`.
- **Edit Device:** current vehicle selected; change vehicle; assigned vehicle → confirmation; Cancel → no request; Confirm → exactly one PUT, also under a double submit; full DeviceRequest; 409 shows the backend message, restores the mapping and reloads; success → `onSaved` (device refetch) and the vehicle list is re-read on the next open.
- **Unlink:** confirmation; Cancel → no request; Confirm → `vehicleId: 0, unlinkVehicle: true` with the required fields; after success, "Assign Vehicle" with the freed vehicle Available; refusal shown as returned.
- **Sensors:** `/vehicles?assigned=true` with paging; vehicle-number labels; vehicle id and device id kept apart; readings, BMS, stops, comparison, summary and alcohol on `device.id`; alerts on `vehicle_number`; the existing tab, refresh and recalculate regression tests; tenant header and tenant switch.

**Changes to existing tests:** `sensor-alerts.test.cjs` now stubs `GET /vehicles?assigned=true` instead of
`GET /devices` + `GET /vehicles/{id}`, and uses vehicle ids as option values. Each test keeps its intent. One
assertion ("stale response ignored") is now scoped to the alerts panel, because vehicle numbers are now also the
dropdown's own labels. The "bus with no registered vehicle" case became "a row without a device isn't offered", since
the new source only lists assigned vehicles. No assertion was weakened to make a test pass.

## 11. Requires live verification (backend behaviour)

1. **Reassignment in one PUT.** `docs/contracts/vehicle-api.txt` lists **`409 RESOURCE_IN_USE (vehicle already has
   another device)`** for `PUT /devices/{id}` with `vehicleId`, while also saying "another vehicle → device moves". As
   documented, the backend will probably **refuse** to take a vehicle from another device rather than move it. The UI
   sends the single PUT and shows whichever answer comes back. It does not unlink the other device to work around a
   refusal. If the product needs a working reassignment, the backend has to support it.
2. **Unlink body.** The same contract says "unlinkVehicle true → removed; **both → 400 INVALID_VALUE**". As specified,
   the UI sends `vehicleId: 0` with `unlinkVehicle: true`. Whether the backend treats `0` as "absent" or as "both set"
   needs checking. If it answers 400, the UI shows that message, but the request shape would need to change (omit
   `vehicleId`).
3. **`unlinkVehicle: false` on POST.** The contract calls `unlinkVehicle` "PUT only". The Add request sends `false` as
   specified. Confirm that POST accepts it.
4. **Keep = omit.** An ordinary edit omits `vehicleId`. The contract says the current vehicle is kept; confirm this
   against the live service.
5. **List shape.** Confirm that `GET /vehicles` and `GET /vehicles?assigned=true` return `device { id, name, terminalNo }`
   and `deviceAssigned` as documented, and that `GET /devices/{id}` returns `vehicleId`.
6. **Swagger snapshot.** The repository's `api-docs-v10.json` does not yet contain `vehicleId` / `unlinkVehicle` on
   DeviceRequest. They come from the latest Swagger you described and `vehicle-api.txt`, and are recorded as a
   documented off-spec entry in `tests/v10-contract.test.cjs`. Replace the snapshot when the new Swagger file is
   available.

## 12. Unresolved limitations

- No browser run against a real backend and no screenshots. Login needs the live BFF, and production writes were
  out of scope.
- The vehicle picker has no search box. Very large fleets scroll a long list, capped at 2,000 vehicles with a
  truncation notice.
- INACTIVE vehicles are listed by `GET /vehicles`, and the picker does not mark them. The backend refuses them with
  `409 OPERATION_NOT_ALLOWED`, which the UI shows.
- `vehicleRegistryService.vehicleForDevice` (existing uncommitted work) no longer has a caller. It was left in place
  rather than deleted.
- The vehicle registry screen and the device list do not show the device↔vehicle link. Only the device form shows it.
- The 2 pre-existing failing access-policy tests are unrelated to this work and were not touched.
