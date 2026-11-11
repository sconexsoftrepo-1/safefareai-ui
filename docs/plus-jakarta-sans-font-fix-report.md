# Plus Jakarta Sans font fix: Turbopack `next/font/google` build error

Date: 2026-11-09 · Next.js 16.4.2 (Turbopack, the default bundler)

## Root cause

`src/app/layout.tsx` loaded Plus Jakarta Sans through `next/font/google`. Under Turbopack, that loader
resolves the internal module `@vercel/turbopack-next/internal/font/google/font`, which failed:

```
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
Import trace: src/app/layout.tsx
```

The bug was in the Google Font loader path. The font and the app code were fine. Removing the
`next/font/google` dependency removes the failing module resolution completely. Next.js was not upgraded
or downgraded, and the bundler was not changed.

## Previous approach

- `layout.tsx`: `Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-plus-jakarta-sans", display: "swap" })`,
  with `sans.variable` set as a class on `<html>` to define the CSS variable.
- `globals.css` (`@theme inline`): `--font-sans: var(--font-plus-jakarta-sans), ui-sans-serif, system-ui, sans-serif;`
- `body` gets `font-sans` through `@apply`, so every page, heading, table, nav item, card, form and button inherits it.

## New approach (self-hosted, no runtime CDN)

- Package `@fontsource-variable/plus-jakarta-sans` (variable font, `font-weight: 200 800`, `font-display: swap`).
- `layout.tsx` imports `@fontsource-variable/plus-jakarta-sans/wght.css` once, before `globals.css`.
  The `next/font/google` import, the font initialisation and the `className={sans.variable}` on `<html>` are removed.
- `globals.css` defines the same variable on `:root`:
  `--font-plus-jakarta-sans: "Plus Jakarta Sans Variable";`
  The existing Tailwind `--font-sans` mapping is unchanged and still reads that variable, so there is one font
  definition and `font-sans` / `body` behave as before.
- The build bundles the `.woff2` files into `/_next/static/media/` (latin, latin-ext, cyrillic-ext, vietnamese
  subsets, each loaded only when its unicode range is needed). There are no `fonts.googleapis.com` or
  `fonts.gstatic.com` references in the build output.

## Files changed

| File | Change |
| --- | --- |
| `src/app/layout.tsx` | Replaced the `next/font/google` import and initialisation with the Fontsource CSS import, and dropped the `<html>` font class |
| `src/app/globals.css` | Added `:root { --font-plus-jakarta-sans: "Plus Jakarta Sans Variable"; }` |
| `tests/design-system.test.cjs` | The "one token system and one font" test now asserts the Fontsource import, that `next/font/google` is absent, and the `:root` variable, replacing the old `Plus_Jakarta_Sans(` assertions |
| `package.json` / `package-lock.json` | Added `@fontsource-variable/plus-jakarta-sans` `^5.3.0` (npm) |
| `docs/plus-jakarta-sans-font-fix-report.md` | This report |

No other packages were added. The `react-markdown`, `remark-gfm` and `jsdom` entries in the `package.json` diff were
uncommitted changes that existed before this fix.

## Font weights

The variable font covers 200–800 continuously, so 200, 300, 400, 500, 600, 700 and 800 all render. Before,
only 400, 500, 600 and 700 were loaded. The app uses `font-medium` (500), `font-semibold` (600) and `font-bold`
(700) through the existing Tailwind weight tokens, and those are unchanged. The design rule that the login screen
does not use `font-extrabold` is still tested.

`.tabular` (`font-variant-numeric: tabular-nums`) is unchanged, and Plus Jakarta Sans supports `tnum`.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run build` (Turbopack, after clearing `.next`) | Pass. All routes compiled, and no font resolve error |
| `npm run dev` (Turbopack) | Ready in about 2 s with no errors in the log. `/login`, `/drive-vision/platform` (Platform Overview), `/drive-vision/overview` (Fleet Overview), `/drive-vision/monitoring` (Live Monitoring), `/drive-vision/platform/permissions` (Permission Catalogue), `/drive-vision/my-work` (Driver My Work), `/drive-vision/my-work/leave` (My Leave) and `/drive-vision/my-work/checklist` (Shift Checklist) all return 200, and the served CSS contains the `Plus Jakarta Sans Variable` `@font-face` |
| `npm test` | 896 pass, 2 fail. The design-system font test passes. The 2 failures are in `access-policy.test.cjs` (#7) and `access-v10.test.cjs` (#36): a new `assistant` capability appears in the result. That comes from the uncommitted `access-policy.ts` / AI-assistant work and is not related to fonts |
| `--webpack` fallback | Not needed. Turbopack dev and build both succeed |

The dev and build checks confirm that the font loads from the bundle. Each role-specific page was not reviewed
visually in a browser. Every role uses the same root layout and `body` font, so they share the same typography path.

## Visual styling preserved

There were no changes to colours (orange / powder-blue palette, navy ink), spacing, card layouts, component sizes,
navigation, breakpoints, type sizes or the dashboard. The font family is the same Plus Jakarta Sans and
`font-display: swap` is kept. The only difference is where it is loaded from.
