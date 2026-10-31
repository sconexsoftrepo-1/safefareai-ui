import type { SearchHit } from "@/features/drive-vision/api/types";

/**
 * GET /search returns `{ [group]: Hit[] }`; neither the group keys nor `Hit.type` values are
 * enumerated in the spec. A hit gets a link only when its type (or group) clearly names an entity
 * this app has a screen for; anything else is listed without a link. Pure: unit-tested.
 */
const ROUTES: { match: RegExp; href: (id: number) => string }[] = [
  { match: /^(device|vehicle)s?$/i, href: (id) => `/drive-vision/vehicles/${id}` },
  { match: /^drivers?$/i, href: (id) => `/drive-vision/drivers?driver=${id}` },
  { match: /^(alert|alarm)s?$/i, href: (id) => `/drive-vision/alerts?kind=incidents&alarm=${id}` },
  { match: /^dispatch(es)?$/i, href: (id) => `/drive-vision/dispatch?dispatch=${id}` },
];

export function searchHitHref(group: string, hit: SearchHit): string | null {
  if (typeof hit.id !== "number" || !Number.isSafeInteger(hit.id) || hit.id <= 0) return null;
  for (const key of [hit.type, group]) {
    if (!key) continue;
    const route = ROUTES.find((r) => r.match.test(key.trim()));
    if (route) return route.href(hit.id);
  }
  return null;
}

export interface FlatHit {
  group: string;
  hit: SearchHit;
  href: string | null;
}

/** Groups in server order; malformed groups (non-arrays) and hits without a title are skipped. */
export function flattenSearch(data: Record<string, unknown> | undefined): FlatHit[] {
  const out: FlatHit[] = [];
  for (const [group, list] of Object.entries(data ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const hit of list as SearchHit[]) {
      if (!hit || typeof hit !== "object" || !hit.title) continue;
      out.push({ group, hit, href: searchHitHref(group, hit) });
    }
  }
  return out;
}

/** "drivers" → "Drivers", "ALERT" → "Alert". */
export function groupLabel(group: string) {
  const s = group.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : "Results";
}

/** Link for a notification's `refType`/`refId` (both undocumented), or null when there is no matching screen. */
export function notificationHref(refType: string | undefined, refId: string | undefined): string | null {
  if (!refType || !refId || !/^\d{1,15}$/.test(refId)) return null;
  const type = refType.trim();
  if (/^leave(_request)?s?$/i.test(type)) return "/drive-vision/workforce?tab=leave";
  if (/^swap(_request)?s?$/i.test(type)) return "/drive-vision/dispatch?tab=swaps";
  return searchHitHref(type, { id: Number(refId), type });
}
