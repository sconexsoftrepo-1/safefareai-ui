"use client";

import { useState } from "react";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { menuNavStatus } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { retryMenus, useAuth } from "@/features/drive-vision/store/auth-store";

/**
 * Shown when GET /me/menus failed for a user whose navigation is built from it (drivers). The
 * navigation then keeps only the policy-allowed static entry, so the failure is stated here with
 * Retry instead of the menu silently shrinking. Direct URLs still go through the route guard.
 */
export function MenuLoadError() {
  const access = useAccess();
  const menus = useAuth((s) => s.menus);
  const menusError = useAuth((s) => s.menusError);
  const [retrying, setRetrying] = useState(false);
  if (menuNavStatus(access, menus, menusError) !== "error") return null;

  async function retry() {
    setRetrying(true);
    try {
      await retryMenus();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div role="alert" className="mb-4 flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink sm:flex-row sm:items-center">
      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Your menu couldn&apos;t be loaded.</span> Some sections may be missing from the navigation until it loads. <span className="text-ink-muted">{menusError}</span>
      </p>
      <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => void retry()} disabled={retrying}>
        {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
      </Button>
    </div>
  );
}
