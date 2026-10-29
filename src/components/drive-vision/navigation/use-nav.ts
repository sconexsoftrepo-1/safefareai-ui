"use client";

import { useMemo } from "react";
import { filterNavGroups } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { NAV_GROUPS, type NavGroup } from "./nav-config";

/** Navigation groups the signed-in user may open (empty groups dropped). */
export function useNavGroups(): NavGroup[] {
  const access = useAccess();
  return useMemo(() => filterNavGroups(NAV_GROUPS, access), [access]);
}
