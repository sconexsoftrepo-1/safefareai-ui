import type { CurrentUserDto, MenuNodeDto } from "../api/types";

/**
 * Frontend access policy: which screens and shell features a signed-in user may open.
 *
 * This is a convenience layer, not security. The BFF must still authorise every request;
 * hiding a screen here never isolates data. Everything is deny-by-default: a screen opens
 * only through a grant listed below, and grants are added only once the backend confirms
 * them (see docs/missing-backend-apis.md #2, #3). Never infer access from a role's
 * description or display name.
 *
 * Pure module (no React) so tests can load it directly.
 */

export const DV_BASE = "/drive-vision";

/** Every routed screen. Nested routes (e.g. /vehicles/[id]) belong to their parent screen. */
export const SCREEN_ROUTES = {
  overview: `${DV_BASE}/overview`,
  monitoring: `${DV_BASE}/monitoring`,
  video: `${DV_BASE}/video`,
  trips: `${DV_BASE}/trips`,
  reports: `${DV_BASE}/reports`,
  vehicles: `${DV_BASE}/vehicles`,
  drivers: `${DV_BASE}/drivers`,
  dispatch: `${DV_BASE}/dispatch`,
  workforce: `${DV_BASE}/workforce`,
  alerts: `${DV_BASE}/alerts`,
  safety: `${DV_BASE}/safety`,
  geofences: `${DV_BASE}/geofences`,
  commands: `${DV_BASE}/devices/commands`,
  users: `${DV_BASE}/users`,
  settings: `${DV_BASE}/settings`,
  myWork: `${DV_BASE}/my-work`,
} as const;

export type ScreenKey = keyof typeof SCREEN_ROUTES;
export const ALL_SCREENS = Object.keys(SCREEN_ROUTES) as ScreenKey[];

/**
 * Driver self-service (/driver/* endpoints, resolved from the caller's own token). Never part of
 * an admin or fleet grant: an administrator is not a driver, and granting it would only produce
 * server errors or, worse, act on whichever driver record the backend links to that login.
 */
export const DRIVER_SELF_SERVICE_SCREENS: readonly ScreenKey[] = ["myWork"];

/** Fleet-management screens: everything except driver self-service. */
export const FLEET_SCREENS: readonly ScreenKey[] = ALL_SCREENS.filter((s) => !DRIVER_SELF_SERVICE_SCREENS.includes(s));

/** Shell features that aren't routes: the assistant (GET/POST /assistant/*) and record results in global search (GET /search). */
export type FeatureKey = "assistant" | "recordSearch";
export const ALL_FEATURES: FeatureKey[] = ["assistant", "recordSearch"];

export type AppRole = "admin" | "fleet-owner" | "driver" | "unknown";

export interface AccessPolicy {
  /** Backend role code (exact, case-sensitive) → app role. Confirmed codes only. */
  roleCodes: Readonly<Record<string, AppRole>>;
  /** Screens and features each app role opens without a per-screen permission. */
  roleGrants: Readonly<Record<AppRole, { screens: readonly ScreenKey[]; features: readonly FeatureKey[] }>>;
  /** Per-screen grants from `/me` permissions[] or a `/me/menus` routeKey. Confirmed values only. */
  screenGrants: Readonly<Partial<Record<ScreenKey, { permissions?: readonly string[]; menuRouteKeys?: readonly string[] }>>>;
}

/** Permission the BFF gives Driver logins for the driver app (/me permissions, /me/menus requiredPermissionCode). */
export const DRIVER_APP_PERMISSION = "driver.app";

/**
 * Current policy (2026-10-29).
 * - `PLATFORM_ADMIN` keeps every fleet screen. It never gets driver self-service (My Work).
 * - `DRIVER` → "driver". Confirmed from a signed-in Driver login on the dev BFF (2026-10-29):
 *   `/me` role `{ code: "DRIVER", description: "Driver" }`, permissions `["driver.app", "own.data.read"]`,
 *   and `/me/menus` returns seven driver-app items requiring `driver.app`. The role itself grants no
 *   screen; My Work opens only through the `driver.app` permission, and only for the driver role
 *   (see computeAccess). No fleet screen or shell feature is granted to drivers.
 * - Fleet Owner: no role code confirmed → no mapping, no grants.
 * - Menus never grant access on their own; they only shape navigation (see menuNavEntries).
 */
export const ACCESS_POLICY: AccessPolicy = {
  roleCodes: {
    PLATFORM_ADMIN: "admin",
    DRIVER: "driver",
  },
  roleGrants: {
    admin: { screens: FLEET_SCREENS, features: ALL_FEATURES },
    "fleet-owner": { screens: [], features: [] },
    driver: { screens: [], features: [] },
    unknown: { screens: [], features: [] },
  },
  screenGrants: {
    myWork: { permissions: [DRIVER_APP_PERMISSION] },
  },
};

export interface Access {
  role: AppRole;
  /** Raw backend role code, when it's a non-empty string. Shown on the no-access screen. */
  roleCode: string | null;
  permissions: ReadonlySet<string>;
  screens: ReadonlySet<ScreenKey>;
  features: ReadonlySet<FeatureKey>;
}

export const NO_ACCESS: Access = { role: "unknown", roleCode: null, permissions: new Set(), screens: new Set(), features: new Set() };

/** Role code from an untrusted `/me` payload, or null when missing or malformed. */
export function readRoleCode(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  const role = (user as { role?: unknown }).role;
  if (!role || typeof role !== "object") return null;
  const code = (role as { code?: unknown }).code;
  return typeof code === "string" && code.trim() !== "" ? code : null;
}

/** String permission codes from `/me`; anything else (missing, not an array, non-strings) is dropped. */
export function readPermissions(user: unknown): Set<string> {
  const raw = user && typeof user === "object" ? (user as { permissions?: unknown }).permissions : undefined;
  return new Set(Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p !== "") : []);
}

/** Every routeKey in a `/me/menus` tree (visible + active nodes only). Tolerates malformed input. */
export function readMenuRouteKeys(menus: unknown): Set<string> {
  const keys = new Set<string>();
  const visit = (nodes: unknown, depth: number) => {
    if (!Array.isArray(nodes) || depth > 10) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const n = node as MenuNodeDto & { children?: unknown };
      if (n.visible === false || n.active === false) continue;
      if (typeof n.routeKey === "string" && n.routeKey !== "") keys.add(n.routeKey);
      visit(n.children, depth + 1);
    }
  };
  visit(menus, 0);
  return keys;
}

export function resolveAppRole(user: unknown, policy: AccessPolicy = ACCESS_POLICY): AppRole {
  const code = readRoleCode(user);
  return code !== null && Object.hasOwn(policy.roleCodes, code) ? policy.roleCodes[code] : "unknown";
}

export function computeAccess(user: CurrentUserDto | null | undefined, menus: MenuNodeDto[] | null | undefined, policy: AccessPolicy = ACCESS_POLICY): Access {
  if (!user) return NO_ACCESS;
  const role = resolveAppRole(user, policy);
  const permissions = readPermissions(user);
  const routeKeys = readMenuRouteKeys(menus);
  const grant = policy.roleGrants[role];

  const screens = new Set<ScreenKey>(grant.screens);
  for (const screen of ALL_SCREENS) {
    const g = policy.screenGrants[screen];
    if (!g) continue;
    if (g.permissions?.some((p) => permissions.has(p)) || g.menuRouteKeys?.some((k) => routeKeys.has(k))) screens.add(screen);
  }
  // Driver self-service is for driver logins only, whatever permissions or menus another role carries.
  if (role !== "driver") for (const s of DRIVER_SELF_SERVICE_SCREENS) screens.delete(s);
  return { role, roleCode: readRoleCode(user), permissions, screens, features: new Set(grant.features) };
}

/** The screen a pathname belongs to (longest route prefix on a segment boundary), or null. */
export function screenForPath(pathname: string): ScreenKey | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  let best: ScreenKey | null = null;
  for (const screen of ALL_SCREENS) {
    const route = SCREEN_ROUTES[screen];
    if ((path === route || path.startsWith(`${route}/`)) && (best === null || route.length > SCREEN_ROUTES[best].length)) best = screen;
  }
  return best;
}

export const canAccessScreen = (access: Access, screen: ScreenKey) => access.screens.has(screen);
export const canUseFeature = (access: Access, feature: FeatureKey) => access.features.has(feature);

/** A path is reachable only when it belongs to a known screen the user may open. Unknown paths are denied. */
export function canAccessPath(access: Access, pathname: string): boolean {
  const screen = screenForPath(pathname);
  return screen !== null && access.screens.has(screen);
}

/**
 * Search results the user may see: page results for openable screens; record results only with
 * the `recordSearch` grant and only into openable screens. The server scopes GET /search, but a
 * hit is still dropped when it would link to a screen this user can't open.
 */
export function visibleSearchResults<R extends { href: string | null }>(access: Access, pages: readonly R[], records: readonly R[]): { pages: R[]; records: R[] } {
  const reachable = (r: R) => r.href !== null && canAccessPath(access, r.href);
  return { pages: pages.filter(reachable), records: canUseFeature(access, "recordSearch") ? records.filter(reachable) : [] };
}

/** First screen the user may open, in route order — the landing page for a denied route. */
export function homeScreen(access: Access): ScreenKey | null {
  return ALL_SCREENS.find((s) => access.screens.has(s)) ?? null;
}

/** Keeps nav items whose screen is allowed and drops groups that end up empty. */
export function filterNavGroups<G extends { items: readonly { screen: ScreenKey }[] }>(groups: readonly G[], access: Access): G[] {
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => access.screens.has(i.screen)) })).filter((g) => g.items.length > 0);
}

export type AuthStatusInput = "unknown" | "authenticated" | "unauthenticated" | "error";

export type RouteDecision =
  | { kind: "checking" }
  | { kind: "login"; next: string }
  | { kind: "session-error" }
  | { kind: "allow"; screen: ScreenKey }
  | { kind: "forbidden"; screen: ScreenKey | null; reason: "unknown-route" | "no-access" | "no-role" };

/**
 * What a /drive-vision route renders. Authentication is decided first (AuthGate), then the
 * screen grant (shell). Anything that can't be verified is denied.
 */
export function decideRoute(status: AuthStatusInput, access: Access, pathname: string): RouteDecision {
  if (status === "unknown") return { kind: "checking" };
  if (status === "unauthenticated") return { kind: "login", next: pathname };
  if (status === "error") return { kind: "session-error" };
  const screen = screenForPath(pathname);
  if (screen === null) return { kind: "forbidden", screen: null, reason: "unknown-route" };
  if (access.screens.has(screen)) return { kind: "allow", screen };
  return { kind: "forbidden", screen, reason: access.screens.size === 0 && access.role === "unknown" ? "no-role" : "no-access" };
}

// ── Menu-driven navigation (/me/menus) ───────────────────────────────────────

/**
 * Backend menu routeKey → app route. `routePath` values from the BFF (e.g. `/driver/work`) are the
 * backend's own paths and don't exist in this app, so items are matched by `routeKey`. Each item has
 * its own route under the My Work screen (`/drive-vision/my-work/<section>`, mirroring the backend's
 * `/driver/<section>`), so the access guard for `myWork` covers all of them. `null` = no page yet.
 */
export const MENU_ROUTES: Readonly<Record<string, string | null>> = {
  my_work: SCREEN_ROUTES.myWork,
  my_shifts: `${SCREEN_ROUTES.myWork}/shifts`,
  my_leave: `${SCREEN_ROUTES.myWork}/leave`,
  shift_checklist: `${SCREEN_ROUTES.myWork}/checklist`,
  my_safety: `${SCREEN_ROUTES.myWork}/safety`,
  my_profile: `${SCREEN_ROUTES.myWork}/profile`,
  // Notifications live in the header bell (GET /notifications); there is no notifications page.
  driver_notifications: null,
};

export interface MenuNavEntry {
  routeKey: string;
  title: string;
  href: string;
  sortOrder: number;
}

/**
 * Navigation entries from an untrusted `/me/menus` tree. Only visible + active nodes count (a hidden
 * or inactive parent hides its children); a node with a `requiredPermissionCode` needs that code in
 * the user's permissions; its routeKey must map to an app route; and that route must be a screen the
 * access policy already allows — so a menu can never widen access. Ordered by `sortOrder` (missing →
 * last), then server order. `unmapped` lists routeKeys that would be shown but have no page.
 */
export function menuNavEntries(menus: unknown, access: Access, routes: Readonly<Record<string, string | null>> = MENU_ROUTES): { items: MenuNavEntry[]; unmapped: string[] } {
  const found: (MenuNavEntry & { index: number })[] = [];
  const unmapped: string[] = [];
  const seen = new Set<unknown>();
  let index = 0;
  const visit = (nodes: unknown, depth: number) => {
    if (!Array.isArray(nodes) || depth > 10) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const n = node as MenuNodeDto & { children?: unknown };
      if (n.visible === false || n.active === false) continue;
      const required = typeof n.requiredPermissionCode === "string" && n.requiredPermissionCode !== "" ? n.requiredPermissionCode : null;
      if (required !== null && !access.permissions.has(required)) continue;
      if (typeof n.routeKey === "string" && n.routeKey !== "") {
        const href = Object.hasOwn(routes, n.routeKey) ? routes[n.routeKey] : null;
        if (href === null) unmapped.push(n.routeKey);
        else if (canAccessPath(access, href) && !found.some((f) => f.href === href)) {
          const title = typeof n.title === "string" && n.title.trim() ? n.title.trim() : typeof n.menuKey === "string" && n.menuKey ? n.menuKey : n.routeKey;
          const sortOrder = typeof n.sortOrder === "number" && Number.isFinite(n.sortOrder) ? n.sortOrder : Number.POSITIVE_INFINITY;
          found.push({ routeKey: n.routeKey, title, href, sortOrder, index: index++ });
        }
      }
      visit(n.children, depth + 1);
    }
  };
  visit(menus, 0);
  found.sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index);
  return { items: found.map((e) => ({ routeKey: e.routeKey, title: e.title, href: e.href, sortOrder: e.sortOrder })), unmapped };
}

/**
 * Where a user should land instead of a screen they can't open: only for the generic landing pages
 * (`/drive-vision` and Overview), and only when another screen is allowed. Deep links to any other
 * screen keep showing the access-denied panel, so a typed URL is never silently rewritten.
 */
export function landingRedirect(access: Access, pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  if (path !== DV_BASE && path !== SCREEN_ROUTES.overview) return null;
  if (access.screens.has("overview")) return null;
  const home = homeScreen(access);
  return home ? SCREEN_ROUTES[home] : null;
}

/**
 * The nav item to highlight: the longest item href that equals the path or is its parent on a
 * segment boundary (query and hash ignored). Computed from the items actually shown, so menu-built
 * driver items highlight themselves rather than the static My Work entry.
 */
export function activeNavHref(hrefs: readonly string[], pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  let best: string | null = null;
  for (const href of hrefs) {
    const h = href.split(/[?#]/)[0].replace(/\/+$/, "");
    if ((path === h || path.startsWith(`${h}/`)) && (best === null || h.length > best.split(/[?#]/)[0].length)) best = href;
  }
  return best;
}
