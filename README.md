# SafeFare AI — Fleet Management UI (frontend demo)

> Formerly *Drive Vision*. Routes, folders and component names keep the internal `drive-vision` / `DriveVision*` identifiers so URLs, imports and saved preferences stay stable.

AI-powered fleet monitoring and driver-safety UI built with Next.js (App Router), React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui, Framer Motion (`motion` package) and Recharts.

> **Integration in progress.** Sign-in and the current user come from the Safe-Fare Fleet BFF (copy `.env.example` to `.env.local`; see `docs/api-integration-checklist.md`). Every other screen is still deterministic sample data generated in the browser. In development, each API call is logged to the console as `[api] METHOD /path → status · ms` (never bodies or tokens).

## Run

```bash
npm install
npm run dev        # http://localhost:3000  → redirects to /drive-vision/overview
npm run build && npm start
npm run lint
npm run typecheck
```

Requires Node ≥ 20.9.

## Screens

| Route | Screen |
|---|---|
| `/drive-vision/overview` | Fleet Overview — KPIs, alarm/AI trend, status donut, activity, mileage/driving-time ranking, reminders |
| `/drive-vision/monitoring` | Live Monitoring — illustrative map, clustering, filters, vehicle sheet, follow mode (simulated polling) |
| `/drive-vision/video` | Historical Video — recording calendar, 1/2/4 layouts, timeline with events, speed, snapshot/clip (simulated) |
| `/drive-vision/trips` | Trips & Tracking — trip list, route playback, stops, event markers |
| `/drive-vision/vehicles`, `/new`, `/[vehicleId]` | Vehicles & Assets — table + asset tree, CRUD, validation, transfer, groups |
| `/drive-vision/alerts` | Alerts & Events — filters, bulk actions, evidence placeholder, assign / notes / resolve / false positive, 5-step critical closure |
| `/drive-vision/safety` | Safety Analytics — illustrative score, weekly severity, categories, driver/vehicle rankings |
| `/drive-vision/drivers` | Drivers — records, licence expiry, assignment, safety history |
| `/drive-vision/geofences` | Geofences — circle / polygon / route-line drawing, rules, vehicle binding |
| `/drive-vision/devices/commands` | Device Commands — **simulated only**, payload preview, high-risk acknowledgement, async results |
| `/drive-vision/users` | Users & Sub-Accounts — user tree, roles, permission summary, cascade-aware delete |
| `/drive-vision/settings` | Preferences (stored in `localStorage`) |

A floating rule-based assistant (“Iris”) is available on every screen and answers only from the sample data.

## Architecture

```
src/
  app/drive-vision/…            routes (thin server pages → client screens)
  components/drive-vision/
    app-shell/                  shell, sidebar, mobile drawer, topbar, search, notifications, profile
    shared/                     Panel, MetricCard, DataTable, FilterBar, StatusBadge, SlideOverPanel,
                                ConfirmDialog, EmptyState, LoadingSkeleton, ToastProvider, FormField
    map/                        FleetMap (SVG, no tiles) + projection + stylised base map
    charts/                     chart tokens / tooltip / legend
    assistant/                  DriveVisionAIAssistant + rule engine
    dashboard|monitoring|video|trips|vehicles|alerts|safety|drivers|geofences|devices|users|settings/
  components/ui/                shadcn/ui primitives
  features/drive-vision/
    types/                      domain types (vendor field names)
    mock-data/                  catalog (alarm dictionary, models, commands), deterministic seed, route builder
    store/                      in-memory store (useSyncExternalStore)
    services/                   async mock services — the integration seam
    selectors.ts                every dashboard number is derived here
    hooks/                      preferences, live-position simulation
    utils/                      formatting (pinned to Asia/Kolkata), time, geo, seeded RNG
  styles/drive-vision-theme.css design tokens
```

- **Deterministic data**: seeded RNG + a fixed snapshot time (23 Oct 2026, 15:30 IST), so the server and client render identically (no hydration drift).
- **Consistency**: counts on Overview, the sidebar badge, Alerts, Safety, and the assistant all come from the same selectors over the same store.
- **Mutations** go through `services/*` (simulated latency), then update the store; they persist across client navigation and reset on reload.

## Future integration (from `Fleet_Feature_API_Mapping.xlsx`)

Replace the bodies in `src/features/drive-vision/services/` with BFF calls; the UI does not need to change.

| Service | Future source |
|---|---|
| `vehicleService` | 1.1 add · 1.2 update · 1.3 delete · 1.4 get · 1.8 list · 1.9 transfer; telemetry from 3.1 (polled + cached — vendor returns 503 when called too often) |
| `groupService` | 2.1–2.5 (note: 2.3 also deletes the group's devices) |
| `alarmService` | reads: 5.1 / 5.8 (5.4 is limited to 24 h); **handling (status, assignee, notes, outcome) is BFF-only** |
| `tripService` | 3.2 track list; **trip detection is BFF-only** |
| `geofenceService` | 10.1–10.5 |
| `commandService` | 8.x → returns `commandNo`; poll 8.2 / 8.4. BFF must add confirmation, permissions, audit log. Only calibration (8.20–8.23) works offline |
| `driverService` | **BFF-only** (vendor has no driver endpoints) |
| `userService` | 6.1–6.6; roles/permissions are **BFF-only**; 6.3 cascades to groups & devices |
| Video | 4.6 calendar · 4.1 record list · 4.4/4.5 clip upload job · 4.7 temp SDK token (never expose the vendor key) |
| Notifications, safety scores, reminders | BFF (push / scoring / scheduled jobs) |

Also from the workbook's *Notes and Risks*: vendor typos (`drvingMileage`, `fileSzie`, `activationTme`), polling-only ingestion, vendor-hosted media that should be copied to S3, and unverified retention.

## Known limitations

- The map is an illustrative SVG of the Hyderabad area (no tiles or geocoding), and positions are synthetic.
- Video tiles are synthetic “demo footage”; there's no sample video in the repository.
- The safety score uses a documented illustrative formula, not real telemetry.
- Language preference is stored but the UI is not translated. Dark theme isn't implemented (light is the reference design).
- Data resets on full page reload; preferences persist per browser.
