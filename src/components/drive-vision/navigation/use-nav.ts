"use client";

import { useMemo } from "react";
import { CalendarOff, ClipboardCheck, Clock, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { driverNavEntries, filterNavGroups, type Access } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { ALL_NAV_ITEMS, NAV_GROUPS, TENANT_NAV_GROUP, navItemFor, type NavGroup } from "./nav-config";

/** Icons for the driver sections, keyed by the backend routePath (see DRIVER_SECTIONS). */
const SECTION_ICONS: Record<string, LucideIcon> = {
  "/driver/shifts": Clock,
  "/driver/leave": CalendarOff,
  "/driver/checklist": ClipboardCheck,
  "/driver/safety": ShieldCheck,
  "/driver/profile": UserRound,
};

/**
 * The driver's "My work" group: one item per driver section, titled and ordered by the server's
 * `screens` (GET /me/permissions) when they map, otherwise the full section list. Null unless the user
 * may open My Work.
 */
export function driverNavGroup(access: Access): NavGroup | null {
  const base = ALL_NAV_ITEMS.find((i) => i.screen === "myWork");
  const entries = driverNavEntries(access);
  if (!base || entries.length === 0) return null;
  return {
    label: "My work",
    items: entries.map((e) => ({ ...base, label: e.title, href: e.href, icon: SECTION_ICONS[e.routePath] ?? base.icon, description: e.title })),
  };
}

/**
 * Navigation groups the signed-in user may open, from one catalogue (NAV_GROUPS) filtered by the
 * permission resolver — not a per-role menu. Empty groups are dropped. The driver app's single
 * "My Work" entry is expanded into its sections.
 */
export function useNavGroups(): NavGroup[] {
  const access = useAccess();
  return useMemo(() => navGroupsFor(access), [access]);
}

/** Moves the item a tenant user sees as Role Permissions out of Platform and into their administration section. */
function placeTenantItems(groups: NavGroup[]): NavGroup[] {
  const item = groups.flatMap((g) => g.items).find((i) => i.screen === "permissions");
  const home = NAV_GROUPS.find((g) => g.label === TENANT_NAV_GROUP);
  if (!item || !home) return groups;
  const entry = navItemFor(item, false);
  const rest = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.screen !== "permissions") })).filter((g) => g.items.length > 0);
  return rest.some((g) => g.label === home.label) ? rest.map((g) => (g.label === home.label ? { ...g, items: [...g.items, entry] } : g)) : [...rest, { ...home, items: [entry] }];
}

export function navGroupsFor(access: Access): NavGroup[] {
  const allowed = filterNavGroups(NAV_GROUPS, access);
  const groups = access.platform ? allowed : placeTenantItems(allowed);
  const driver = driverNavGroup(access);
  if (!driver) return groups;
  return groups.map((g) => (g.items.some((i) => i.screen === "myWork") ? { ...g, items: [...driver.items, ...g.items.filter((i) => i.screen !== "myWork")] } : g));
}
