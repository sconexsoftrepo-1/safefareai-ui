# SafeFare Design System Update Report

**Status:** implemented and tested on mocked data. Awaiting your review, including the contrast decisions below. All of this work is uncommitted. `HEAD` moved during this session to `ca2005f`, "role permissions changes", a commit from your account that holds the earlier rounds; this work did not create it.

**Date:** 2026-11-05

**Mocked versus live.** Every screenshot uses synthetic figures written for this check, in the script's own mock. They exist only there, and nothing reached the backend. The app itself shows no invented data. Some Fleet Overview and "today" figures appear as 0 or a dash because the mock doesn't fill those fields, not because of a fault.

## Decisions for you

### 1. Three approved colours fall short of readable text contrast

The normal requirement for small text is 4.5:1. I used your approved values as specified, and measured them.

| Combination | Contrast | Where it appears | Option that passes |
|---|---|---|---|
| White on `#F16A45` | **3.05:1** | Primary buttons, 13–14 px | Darken the button to `#D2451E` (4.55:1) |
| `#718096` on `#F7F8FC` | **3.78:1** | Supporting text on the page background | Darken to `#5F6E85` (4.88:1) |
| `#718096` on `#FFFFFF` | **4.02:1** | Supporting text on cards | Same |

Each option is a one-line token change. **Your brief asked for both the exact hex and readable text, and they conflict here, so this needs your decision.** Until then, the buttons and supporting text are below that standard.

Selected navigation, tabs and filters avoid the problem. They use a light coral fill with darker coral text (`#BA3C1A`, at least 4.5:1).

### 2. The reference image was not available

The Platform Overview dashboard image didn't arrive and isn't on this machine. The only recent screenshot in Downloads is an unrelated permission screen. The design follows your written specification. Please compare it with your image.

### 3. Values that differ from the suggestions

| Suggested | Used | Why |
|---|---|---|
| `#DCEEFF` for chart series and progress bars | `#5FA4E3` for those marks; `#DCEEFF` for backgrounds | `#DCEEFF` on white is 1.19:1, so bars would barely show |
| `--sf-success` `#16A36A`, `--sf-warning` `#D99A27`, `--sf-danger` `#DC4C45` | Kept the existing darker status colours | As text on white they measure 3.24, 2.44 and 4.07:1. You also asked to preserve status colours |
| `--sf-*` variable names | Existing `--dv-*` names | Adding a second set would duplicate the token system |
| Navy as a chart colour | Teal and violet in the third and fourth chart slots | The dataviz validator rejected navy: it reads as grey |

## Before

| Item | Previous |
|---|---|
| Font | Plus Jakarta Sans through `next/font/google`, all weights, variable `--font-dv-sans` |
| Font features | `ss01` and `cv11`, left over from another typeface |
| Page background | `#F0EFF5`, lavender grey |
| Text | `#1F1E26`, charcoal |
| Secondary text | `#6F6C7B` |
| Brand | `#E8644A` |
| Primary button | Charcoal |
| Selected state | Black pill |
| Table header | Dark grey band, hard-coded in `globals.css` |
| Card radius | 22 px |

The font was already correct, and no banned font was in use. The work there was the variable name, the weights and the hierarchy.

## New typography

- `next/font/google`, self-hosted at build time, so there is no runtime font CDN.
- Weights 400, 500, 600 and 700 only. Variable `--font-plus-jakarta-sans`.
- Page headings 700. Section and card headings 600. Buttons 600. KPI values 700.
- Measured on all 10 screens: the page heading is weight 700, at 30 px (22 px on Live Monitoring). Text is Plus Jakarta Sans.
- `font-extrabold` on the login page became `font-bold`, because weight 800 is no longer loaded.
- A monospace font remains only for codes and IDs, such as role codes and terminal numbers. That was left in place on purpose.

## Final tokens

All live in `src/styles/drive-vision-theme.css`, the one token file.

| Token | Value | Source |
|---|---|---|
| `--dv-surface` | `#FFFFFF` | Approved |
| `--dv-brand` | `#F16A45` | Approved |
| `--dv-powder`, `--dv-sky`, `--dv-info-soft` | `#DCEEFF` | Approved |
| `--dv-ink` | `#24344D` | Approved |
| `--dv-canvas` | `#F7F8FC` | Approved |
| `--dv-ink-muted` | `#718096` | Approved |
| `--dv-border` | `#E7EBF2` | Approved |
| `--dv-brand-hover` | `#E65C38` | Suggested |
| `--dv-brand-deep` | `#BA3C1A` | Derived: coral text, permission ticks |
| `--dv-brand-soft`, `--dv-brand-tint` | `#FDE9E3`, `#FEF3EF` | Derived: selected states |
| `--dv-powder-strong` | `#5FA4E3` | Derived: chart marks and bars |
| `--dv-surface-muted`, `--dv-surface-sunken` | `#F1F4F9`, `#E9EDF4` | Derived |
| `--dv-ink-subtle` | `#7C8BA1` | Derived |
| `--dv-series-1` to `4` | `#5FA4E3`, `#F16A45`, `#2A9D8F`, `#8A63D2` | Passed the dataviz validator |
| `--dv-warning` | `#8A5A06` | Changed: see below |

Radii are now 16, 12 and 10 px. Shadows use navy at low strength.

**Chart palette.** All validator checks pass. It warns that two slots sit just under 3:1, which is allowed when a chart has a legend and a table view; the fleet activity chart has both.

## Shared components updated

| Component | Change |
|---|---|
| Theme and `globals.css` | Tokens; table header from tokens; gradients and hatch patterns removed from cards and bars |
| `button.tsx` | Primary is coral; secondary is powder blue; outline is white and navy; disabled is grey and readable; weight 600; less rounded |
| `panel.tsx`, `metric-card.tsx` | White cards, consistent borders, coral and powder icon chips, bold values |
| `data-table.tsx` | Powder hover; selected rows stay coral tint |
| `filter-bar.tsx` | Search, selects and segmented controls restyled |
| `sidebar.tsx`, `topbar.tsx`, `header-styles.ts` | Navy text, coral active state, powder hover, fewer pills |
| `chart-kit.tsx` | Larger, darker axis labels |
| `feedback.tsx`, `page-intro.tsx` | Empty states and page headings |
| Login screen | Brand colours updated |

Most screens changed through these alone, so few screen files were touched. Business logic, API calls, access rules and tenant handling were not changed.

## Screens updated

**Platform Overview, the reference screen:**

- The KPI row is Tenants, Devices, Drivers, Safety alerts, Users and Device groups.
- **Fleet activity** is the renamed daily trend, with coral for alarms and blue for trips.
- **Fleet status** puts the total vehicle count in the centre.
- **Recent open events** colours icons from the app's existing severity scale. Unknown levels stay neutral.
- **Top tenants by fleet size** is new, built from the device counts already returned by the tenant list.
- Every earlier widget is still there.

**Two things differ from your list:**

- **No trend indicators on the KPI cards.** No API returns a trend, and showing one would mean inventing data.
- **"Total vehicles" stays labelled "Devices".** It is the sum of per-tenant device counts, and renaming it could change what the figure seems to mean. The vehicle total shown in Fleet status comes from a different API.

**Other screens** follow the shared styles: all the Safe-Fare Admin, Fleet Owner and Driver screens you listed. On My Work, list rows now use outline buttons, and coral is kept for the featured trip, so the screen doesn't turn orange. Driver Notifications are in the header bell, so they follow the shared styles but weren't captured separately.

**Two fixes found along the way:**

- **Warning badges were hard to read.** The new test found them under 4:1, so `--dv-warning` was darkened. This improves every Pending and warning badge.
- **Dark-mode styles followed the OS setting**, which the permission work had patched for one grid only. `dark:` styles now apply only under `.dark`, so the OS setting can't change this light app anywhere.
- **The off switch became hard to see, as a result of that fix.** Its dark thumb had come from a stray `dark:` style, and light mode had no proper off state. The shared Switch now has a white thumb on a darker track in both states.

**Reading the `before/` shots.** This machine's OS is in dark mode, so they include those stray styles, such as tinted inputs and the dark switch thumb. A user with a light OS would have seen slightly different controls.

## Screenshots

In `docs/evidence/screenshots/design-system/`, with matching names in `before/` and `after/`. The script is `cdp-design-system.cjs.txt`.

| # | Screen | File |
|---|---|---|
| 1 | Platform Overview | `01-platform-overview.png` |
| 2 | Fleet Overview | `02-fleet-overview.png` |
| 3 | Live Monitoring | `03-live-monitoring.png` |
| 4 | Vehicles & Assets | `04-vehicles-assets.png` |
| 5 | Global Roles | `05-global-roles.png` |
| 6 | Permission Catalogue | `06-permission-catalogue.png` |
| 7 | Driver My Work | `07-driver-my-work.png` |
| 8 | My Leave | `08-my-leave.png` |
| 9 | Shift Checklist | `09-shift-checklist.png` |
| 10 | My Profile | `10-my-profile.png` |

`after/` also holds `permission-matrix-1440x900.png`, `login-1440x900.png`, dialogs at 320 px, and samples at 320, 768 and 1920 px.

## Responsive verification (mocked)

22 screens across all three roles, at 320, 375, 768, 1024, 1440 and 1920 px, on the production build: 132 checks.

| Check | Result |
|---|---|
| Horizontal page overflow | None |
| Crashes or uncaught errors | None |
| Pages denied that shouldn't be | None |
| Request leave panel at 320 px | Fits |
| Cancel leave dialog at 320 px | Fits, 288 px wide |
| Permission checkbox | 20 px, 36 px click target |
| Checkbox and page colours in OS dark mode | Identical to light |

## Test results

| Check | Result |
|---|---|
| Full test suite | **811 tests: 809 pass, 0 fail, 2 todo** |
| New `tests/design-system.test.cjs` | 16 pass |
| TypeScript, lint, production build | Pass |
| Contract checks | Pass, as part of the suite |
| Dataviz palette validator | All checks pass, with the warning noted above |

The 2 `todo` tests are from an earlier round. No existing test needed changing, including the permission checkbox contrast tests.

**Visual regression.** The repository has no pixel-comparison tool, so this was a manual review of the screenshots plus the automated page checks. All 10 `after` screens were reviewed by eye, and pairs compared where something looked different. That comparison found the switch problem above. The Switch fix came after the six-width sweep, so only the 10 main screens were rerun on the final build, at 1440 px. It changes colours only, not layout.

## Remaining inconsistencies

- **`before/06-permission-catalogue.png`** shows a faded dropdown at the left. The screenshot script caused it, not the app. The `after` shot was retaken without it.
- **Live Monitoring's filter row** cuts off the last chip at this width, and scrolls sideways. It did the same before.
- **Fleet groups cards** keep their pastel illustrations in green, peach and others, with hard-coded colours.
- **Selected rows** in Live Monitoring, Trips and Geofences lists are navy with white text, not coral tint. They are readable, but differ from other selected states.
- **Other pill shapes** remain in status badges, the mobile tenant control and some small filters.
- **`text-brand` on white** is 3.05:1. It appears in 47 places. Many are icons, which is acceptable, but any used as small text fall short.
- **`text-ink-subtle`** appears in 116 places at 3.46:1. It improved from about 2.6:1, but is still under 4.5:1 for small text.
- **The login page** keeps fixed colours because it sits on a photo, and its Sign in button keeps a gradient. The Tenant user tab is navy.
- **The AI assistant button** keeps its colour orb.
- **Tabular numerals** are used where the app already applied them. Not every ID or timestamp was audited.
- **Earlier reports** quote contrast figures for the old palette, for example in `docs/role-menu-permission-integration-report.md`. The same tests still pass, but those numbers are out of date.

## Before release

1. Decide on the contrast options above.
2. Compare Platform Overview with your reference image.
3. Review the screens with real data, especially dense tables and charts with many days.

Nothing was committed, pushed, reset or discarded. Backend code, API contracts and access rules were not changed.
