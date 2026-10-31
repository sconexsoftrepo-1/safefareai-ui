"use client";

import { useMemo } from "react";
import { CalendarOff, ClipboardCheck, Clock, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { filterNavGroups, menuNavEntries, type Access } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { useAuth } from "@/features/drive-vision/store/auth-store";
import { ALL_NAV_ITEMS, NAV_GROUPS, type NavGroup } from "./nav-config";

const MENU_ICONS: Record<string, LucideIcon> = { my_shifts: Clock, my_leave: CalendarOff, shift_checklist: ClipboardCheck, my_safety: ShieldCheck, my_profile: UserRound };

/**
 * Driver navigation from the real `/me/menus` response (see menuNavEntries): the server's titles in
 * its sortOrder, limited to routes this app has and the access policy allows. Returns null when the
 * menu yields nothing usable, so the caller falls back to the policy-filtered static navigation.
 */
export function driverMenuGroup(menus: unknown, access: Access): NavGroup | null {
  if (access.role !== "driver") return null;
  const { items } = menuNavEntries(menus, access);
  const base = ALL_NAV_ITEMS.find((i) => i.screen === "myWork");
  if (!base || items.length === 0) return null;
  return {
    label: "My work",
    items: items.map((e) => ({ ...base, label: e.title, href: e.href, icon: MENU_ICONS[e.routeKey] ?? base.icon, description: e.title })),
  };
}

/** Navigation groups the signed-in user may open (empty groups dropped). */
export function useNavGroups(): NavGroup[] {
  const access = useAccess();
  const menus = useAuth((s) => s.menus);
  return useMemo(() => {
    const fromMenu = driverMenuGroup(menus, access);
    return fromMenu ? [fromMenu] : filterNavGroups(NAV_GROUPS, access);
  }, [access, menus]);
}
