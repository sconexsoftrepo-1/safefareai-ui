"use client";

import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SCREEN_ROUTES, tenantBlockedScreens, type ScreenKey } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";

export const TENANT_REQUIRED_HINT = "Select a tenant first: in all-tenants mode the server can't tell which tenant a new or changed record belongs to.";

/**
 * A create action the Safe-Fare Admin may perform but only inside a tenant (class A). Rendered disabled
 * with the reason; it never sends a request.
 */
export function TenantRequiredButton({ label, size }: { label: string; size?: "sm" | "default" }) {
  return (
    <span title={TENANT_REQUIRED_HINT} className="inline-flex">
      <Button size={size} disabled aria-describedby="tenant-required-hint" data-testid="tenant-required-action">
        <Plus /> {label}
      </Button>
      <span id="tenant-required-hint" className="sr-only">
        {TENANT_REQUIRED_HINT}
      </span>
    </span>
  );
}

/**
 * Shown on a screen whose writes are blocked only because no tenant is selected (Safe-Fare Admin,
 * all-tenants mode). Record actions are hidden there; this says why and where to pick a tenant.
 */
export function TenantScopeNotice({ screen }: { screen: ScreenKey }) {
  const access = useAccess();
  if (!tenantBlockedScreens(access).has(screen)) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line/70 bg-surface px-4 py-3 text-[13px] text-ink-muted shadow-card" role="status" data-testid="tenant-scope-notice">
      <Building2 className="size-4 shrink-0 text-brand" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium text-ink">Viewing all tenants.</span> Select a tenant to create or change records on this page.
      </p>
      {access.screens.has("tenants") ? (
        <Button asChild size="sm" variant="outline" className="min-h-9">
          <Link href={SCREEN_ROUTES.tenants}>Select tenant</Link>
        </Button>
      ) : null}
    </div>
  );
}
