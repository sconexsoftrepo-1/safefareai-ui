# Devices & Assets — Label Update Report

Date: 2026-11-10 · Branch `new-features/Prakash` · Nothing committed; existing uncommitted work untouched.

## Summary

The section at `/vehicles` (server `menuKey: "vehicles_assets"`, now titled **"Devices & Assets"** by the login API)
is renamed from **"Vehicles & Assets"** to **"Devices & Assets"** everywhere it is shown to users. This is a naming
change only. The following are unchanged:
- the route (`/drive-vision/vehicles`);
- the screen key (`vehicles`);
- `menuKey`;
- API endpoints, permission codes, resource mappings and role logic.

## How the sidebar gets its labels (finding)

The staff sidebar and the mobile navigation (`MobileNav` renders the same `SidebarNav`) come from the static
catalogue `NAV_GROUPS` in `navigation/nav-config.ts`, filtered by the permission resolver. Only the driver menu
takes its titles from the server (`driverNavEntries`). So for staff, the label had to change in the catalogue.

The server routePath `/vehicles` isn't mapped in `SERVER_ROUTE_PATHS`, so today it is reported as unmapped and its
`title` isn't read. Mapping it would let the sidebar use the server title, but the same mapping would also start
applying that menu's `readOnly` flag and denied operations to device actions. That is a permission-logic change,
which this brief rules out, so it wasn't done. If you want server titles to drive the staff sidebar, it should be a
separate change, made for all screens and tested against the role/permission behaviour.

## Changes

| File | Before | After |
| --- | --- | --- |
| `components/drive-vision/navigation/nav-config.ts` (sidebar, mobile nav, page header, global search) | label "Vehicles & Assets"; description "Vehicles, devices and groups"; subtitle "Vehicles, tracking devices and groups" | label **"Devices & Assets"**; description "Tracking devices, device groups and maintenance reminders"; subtitle **"Manage registered vehicles, tracking devices, device groups and maintenance reminders."** |
| `app/drive-vision/vehicles/page.tsx` | metadata title "Vehicles & Assets" | "Devices & Assets" |
| `components/drive-vision/vehicles/vehicles-page.tsx` | page heading "Vehicles & Assets" | "Devices & Assets" (the device count line under it is unchanged) |
| `components/drive-vision/vehicles/vehicle-detail.tsx` | "Back to vehicles" (links to the section) | "Back to Devices & Assets" |
| `components/drive-vision/dashboard/fleet-overview.tsx` | quick link "Vehicles" and button "Vehicles", both opening `/vehicles` | "Devices & Assets" |
| `components/drive-vision/sensors/sensors-page.tsx` | "Assign one under Vehicles & Assets." | "…under Devices & Assets." |
| `components/drive-vision/vehicle-registry/vehicle-registry-page.tsx` | "Fit one from the device's edit form on Vehicles & Assets." | "…on Devices & Assets." |
| Code comments (`vehicles-page.tsx`, `new-vehicle.tsx`, `vehicle-registry-page.tsx`, `access-policy.ts`) | "Vehicles & Assets" | "Devices & Assets" |
| `tests/devices-assets-label.test.cjs` | — | New, 5 tests |

Page headers for nested routes (e.g. `/vehicles/7`) take the section title automatically through `getPageMeta`, so
they now read "Devices & Assets" too.

## Deliberately unchanged

- **Resource labels from the API:** "Vehicles", "Device groups", "Maintenance reminders".
- **The separate Vehicles registry screen** (`/vehicle-registry`, sidebar "Vehicles"). It is a different section.
- **Vehicle-specific labels:**
  - the "Vehicle" table column;
  - Add vehicle, Search vehicles, "No vehicles match";
  - vehicle forms and vehicle details.
- **"All vehicles"** on the Overview's device-groups panel. It describes what the linked list shows rather than naming the section. It can be renamed if you prefer.
- **Tests that use their own server fixtures** (`tests/role-menu-permission.test.cjs` titles a module "Vehicles & Assets" as fixture data). Also the source-grouping label in `tests/helpers/v10-callers.cjs`, which isn't user-visible.
- **Route, menuKey, permission codes, access policy and API calls.**

## Verification

| Check | Result |
| --- | --- |
| Sidebar shows "Devices & Assets" and links to `/drive-vision/vehicles` | Tested (`navGroupsFor`) |
| Fleet Owner, Safe-Fare Admin (with and without a tenant) and tenant ADMIN each get exactly one entry | Tested |
| Mobile navigation | Renders the same `SidebarNav`; tested by source check |
| Page heading, header title, subtitle and metadata | Tested (`getPageMeta`; source checks for heading, metadata and back link) |
| Access unchanged (`device.read` gates the section; drivers and users without `device.read` don't get it) | Tested |
| No "Vehicles & Assets" left anywhere in `src` | Tested |
| Full suite | 1011 tests, 1007 pass. 2 failures, both already failing before this work (`access-policy` "only unrecognised codes…", `access-v10` "Driver (live fixture)…") |
| `tsc --noEmit` | Pass |
| `eslint .` | 0 errors; 2 warnings, both in `login-screen.tsx`, which already had them |

Not done: a signed-in browser check. All checks above are against code and synthetic identities.
