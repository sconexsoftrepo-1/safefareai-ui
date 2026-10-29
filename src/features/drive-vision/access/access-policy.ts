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
  alerts: `${DV_BASE}/alerts`,
  safety: `${DV_BASE}/safety`,
  geofences: `${DV_BASE}/geofences`,
  commands: `${DV_BASE}/devices/commands`,
  users: `${DV_BASE}/users`,
  settings: `${DV_BASE}/settings`,
} as const;

export type ScreenKey = keyof typeof SCREEN_ROUTES;
export const ALL_SCREENS = Object.keys(SCREEN_ROUTES) as ScreenKey[];

/** Shell features that aren't routes. Both currently read the in-browser sample data. */
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

/**
 * Current policy (2026-10-27).
 * - `PLATFORM_ADMIN` is the only role code observed on the live BFF. It has used every screen
 *   since integration began, so it keeps full access here.
 * - Fleet Owner and Driver role codes are unconfirmed → no codes map to them, and their grants
 *   stay empty. Driver trips, shifts, leave and assignments also need backend APIs that don't
 *   exist yet; don't grant those screens on the strength of a role code alone.
 * - Permission codes and menu routeKeys per screen are unconfirmed → no screen grants yet.
 */
export const ACCESS_POLICY: AccessPolicy = {
  roleCodes: {
    PLATFORM_ADMIN: "admin",
  },
  roleGrants: {
    admin: { screens: ALL_SCREENS, features: ALL_FEATURES },
    "fleet-owner": { screens: [], features: [] },
    driver: { screens: [], features: [] },
    unknown: { screens: [], features: [] },
  },
  screenGrants: {},
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
 * the `recordSearch` grant (they come from the unscoped sample store) and only into openable screens.
 */
export function visibleSearchResults<R extends { href: string }>(access: Access, pages: readonly R[], records: readonly R[]): { pages: R[]; records: R[] } {
  const reachable = (r: R) => canAccessPath(access, r.href);
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
