"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Globe2, Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SCREEN_ROUTES, screenForPath } from "@/features/drive-vision/access/access-policy";
import { useAccess, useTenantContext } from "@/features/drive-vision/access/use-access";
import { platformService } from "@/features/drive-vision/api/platform-service";
import type { TenantDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { tenantSelectable } from "@/features/drive-vision/store/tenant-store";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { toast } from "../shared/toast-provider";
import { matchTenant } from "../platform/tenant-management-model";

/** After a tenant change, leave nested detail routes (a record of the previous tenant) for the screen root. */
export function useAfterTenantChange() {
  const router = useRouter();
  const pathname = usePathname();
  return () => {
    const screen = screenForPath(pathname);
    if (screen && pathname.replace(/\/+$/, "") !== SCREEN_ROUTES[screen]) router.replace(SCREEN_ROUTES[screen]);
  };
}

export { matchTenant };

/**
 * Top-bar tenant selector for the Safe-Fare Admin (platform === true + tenant.all only; hidden for
 * everyone else). Lists tenants from GET /platform/tenants when opened; selecting one calls
 * POST /platform/switch-tenant and only then changes the context.
 */
export function TenantSwitcher() {
  const ctx = useTenantContext();
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const afterChange = useAfterTenantChange();
  const listQ = useApiQuery(open && ctx.canSelectTenant ? "switcher:tenants" : null, () => platformService.tenants());
  const tenants = useMemo(() => (listQ.data?.items ?? []).filter((t) => matchTenant(t, query)).sort((a, b) => (a.name ?? a.code ?? "").localeCompare(b.name ?? b.code ?? "")), [listQ.data, query]);

  if (!ctx.canSelectTenant) return null;

  const label = ctx.isTenantSelected ? (ctx.selectedTenantName ?? ctx.selectedTenantCode ?? `Tenant ${ctx.selectedTenantId}`) : "All tenants";
  const pending = ctx.pendingTenantId !== null;

  async function choose(t: TenantDto) {
    if (pending || t.id === ctx.selectedTenantId) return;
    const ok = await ctx.selectTenant(t);
    if (ok) {
      setOpen(false);
      afterChange();
      toast.success(`Working in ${t.name ?? t.code ?? `tenant ${t.id}`}`, { description: "Tenant data and actions now apply to this tenant only." });
    }
  }
  function clear() {
    if (!ctx.isTenantSelected) return;
    ctx.clearTenantSelection();
    setOpen(false);
    afterChange();
    toast.success("Viewing all tenants", { description: "Platform-wide data; tenant actions need a selected tenant." });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-10 max-w-[44vw] min-w-10 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium shadow-card transition-colors focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none sm:max-w-[220px]",
            ctx.isTenantSelected ? "border-brand/40 bg-brand-soft text-brand-deep" : "border-line/60 bg-surface text-ink"
          )}
          aria-label={`Tenant context: ${label}. Change tenant`}
          data-testid="tenant-switcher"
        >
          {pending ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : ctx.isTenantSelected ? <Building2 className="size-4 shrink-0" aria-hidden /> : <Globe2 className="size-4 shrink-0" aria-hidden />}
          <span className="truncate max-sm:hidden">{label}</span>
          {ctx.isTenantSelected && ctx.selectedTenantCode ? <span className="truncate font-mono text-[11px] sm:hidden">{ctx.selectedTenantCode}</span> : null}
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,340px)] p-0">
        <div className="border-b border-line/70 p-3">
          <p className="text-[12px] font-semibold tracking-wide text-ink-subtle uppercase">Tenant context</p>
          <label className="mt-2 flex items-center gap-2 rounded-xl border border-line/70 bg-surface-muted px-3">
            <Search className="size-4 text-ink-subtle" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, code or id" aria-label="Search tenants" className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          </label>
        </div>
        {ctx.error ? (
          <p className="mx-3 mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
            {ctx.error}
          </p>
        ) : null}
        <ul className="max-h-[min(60vh,360px)] overflow-y-auto p-1.5" aria-label="Tenants">
          <li>
            <button type="button" onClick={clear} disabled={pending} className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] hover:bg-surface-muted disabled:opacity-60", !ctx.isTenantSelected && "bg-surface-muted")}>
              <Globe2 className="size-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">All tenants</span>
                <span className="block text-[11.5px] text-ink-muted">Platform-wide reads · no tenant actions</span>
              </span>
              {!ctx.isTenantSelected ? <Check className="size-4 text-brand" aria-label="Current" /> : null}
            </button>
          </li>
          {listQ.error && !listQ.data ? (
            <li className="px-2.5 py-3 text-xs text-danger" role="alert">
              Couldn&apos;t load tenants: {describeApiError(listQ.error)}{" "}
              <button type="button" className="font-semibold underline" onClick={listQ.refetch}>
                Retry
              </button>
            </li>
          ) : !listQ.data ? (
            <li className="flex items-center gap-2 px-2.5 py-3 text-xs text-ink-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading tenants…
            </li>
          ) : tenants.length === 0 ? (
            <li className="px-2.5 py-3 text-xs text-ink-muted">{query ? "No tenant matches your search." : "No tenants returned."}</li>
          ) : (
            tenants.map((t, i) => {
              const selectable = tenantSelectable(t);
              const current = t.id === ctx.selectedTenantId;
              const busy = ctx.pendingTenantId === t.id;
              return (
                <li key={t.id ?? `t-${i}`}>
                  <button
                    type="button"
                    onClick={() => void choose(t)}
                    disabled={!selectable || pending}
                    aria-current={current ? "true" : undefined}
                    title={selectable ? undefined : "Only active tenants can be selected"}
                    className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60", current && "bg-surface-muted")}
                  >
                    <Building2 className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{t.name ?? "Unnamed tenant"}</span>
                      <span className="block truncate font-mono text-[11px] text-ink-muted">
                        {t.code ?? "—"}
                        {t.status && t.status.toUpperCase() !== "ACTIVE" ? ` · ${t.status}` : ""}
                      </span>
                    </span>
                    {busy ? <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Switching" /> : current ? <Check className="size-4 text-brand" aria-label="Current" /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        {access.screens.has("tenants") ? (
          <div className="border-t border-line/70 p-2">
            <Link href={SCREEN_ROUTES.tenants} onClick={() => setOpen(false)} className="flex min-h-10 items-center justify-center rounded-xl text-[13px] font-medium text-ink hover:bg-surface-muted">
              Manage tenants
            </Link>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
