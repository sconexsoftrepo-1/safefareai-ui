"use client";

import { useMemo } from "react";
import { useAuth } from "../store/auth-store";
import { canPerform, computeAccess, type Access, type ActionKey } from "./access-policy";

/** Access for the signed-in user, from GET /me (role, permissions) and GET /me/menus. */
export function useAccess(): Access {
  // Select the stored references (not a derived object) so useSyncExternalStore stays stable.
  const user = useAuth((s) => s.user);
  const menus = useAuth((s) => s.menus);
  return useMemo(() => computeAccess(user, menus), [user, menus]);
}

/** Whether the signed-in user may perform a state-changing action (see ACTION_SCREENS in the access policy). */
export function useCan(action: ActionKey): boolean {
  return canPerform(useAccess(), action);
}
