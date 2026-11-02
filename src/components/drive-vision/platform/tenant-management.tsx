"use client";

import { useMemo, useState } from "react";
import { Building2, Check, ChevronLeft, ChevronRight, Globe2, Info, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAccess, useTenantContext } from "@/features/drive-vision/access/use-access";
import { canPerform } from "@/features/drive-vision/access/access-policy";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { platformService } from "@/features/drive-vision/api/platform-service";
import type { CreatedTenantDto, TenantDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatNumber, formatTime } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { toast } from "../shared/toast-provider";
import { useAfterTenantChange } from "../app-shell/tenant-switcher";
import { serverCount, summarizeTenants } from "../dashboard/platform-dashboard-model";
import { ALL_STATUSES, filterTenants, paginate, selectBlockReason, statusOptions, tenantDetailRows, tenantStatusSet } from "./tenant-management-model";
import { TenantCreatePanel } from "./tenant-create-panel";
import { createdSummary, type CreatedSummary } from "./tenant-create-model";

const MISSING_COUNT = "Not reported by the server";
const n = (v: unknown) => {
  const c = serverCount(v);
  return c === null ? "—" : formatNumber(c);
};
const tenantLabel = (t: TenantDto) => t.name ?? t.code ?? (t.id !== undefined ? `tenant ${t.id}` : "this tenant");

/** A count cell: the server value, or "—" with an explanation (never 0). */
function Count({ value }: { value: unknown }) {
  const c = serverCount(value);
  return c === null ? (
    <span className="text-ink-subtle" title={MISSING_COUNT}>
      —<span className="sr-only"> ({MISSING_COUNT})</span>
    </span>
  ) : (
    <>{formatNumber(c)}</>
  );
}

/**
 * Tenant Management (Phases 5–6; Safe-Fare Admin with tenant.all — enforced by the `tenants` screen).
 * Uses the two V10 tenant operations, GET /platform/tenants (list) and POST /platform/switch-tenant (select),
 * plus POST /platform/tenants (create; backend-supplied contract, not in V10; resolver action tenants.create).
 * No detail, update, status or delete endpoint exists, so none is offered. Creating never changes the selection.
 * Selection goes through the one tenant context (useTenantContext), shared with the top-bar switcher.
 */
export function TenantManagement() {
  const ctx = useTenantContext();
  const afterChange = useAfterTenantChange();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<TenantDto | null>(null);
  const access = useAccess();
  const canCreate = canPerform(access, "tenants.create");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedSummary | null>(null);

  const listQ = useApiQuery("tenants:list", () => platformService.tenants());
  // Optional: the server's status catalogue. Its failure only hides documented-but-unused statuses.
  const catalogQ = useApiQuery("tenants:status-catalog", () => fleetService.statusCatalog());
  const items = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const catalogue = useMemo(() => tenantStatusSet(catalogQ.data?.statusSets), [catalogQ.data]);
  const options = useMemo(() => statusOptions(items, catalogue), [items, catalogue]);
  const summary = useMemo(() => summarizeTenants(listQ.data), [listQ.data]);
  const filtered = useMemo(() => filterTenants(items, query, status), [items, query, status]);
  const view = paginate(filtered, page);
  const pending = ctx.pendingTenantId !== null;

  const setFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  /** After a create: show what the server returned and reload the list. The selection is untouched. */
  function onCreated(t: CreatedTenantDto) {
    setCreating(false);
    setCreated(createdSummary(t));
    setFilter(() => {
      setQuery("");
      setStatus(ALL_STATUSES);
    });
    listQ.refetch();
  }

  async function choose(t: TenantDto) {
    if (pending) return;
    if (await ctx.selectTenant(t)) {
      afterChange();
      toast.success(`Working in ${tenantLabel(t)}`, { description: "Tenant data and actions now apply to this tenant only." });
    }
  }

  return (
    <div>
      <PageHeader
        title="Tenants"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {ctx.isTenantSelected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-semibold text-brand-deep" data-testid="tenant-context">
                <Building2 className="size-3.5" aria-hidden /> Working in {ctx.selectedTenantName ?? ctx.selectedTenantCode ?? `tenant ${ctx.selectedTenantId}`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[12px] font-semibold text-ink" data-testid="tenant-context">
                <Globe2 className="size-3.5" aria-hidden /> All tenants (platform-wide)
              </span>
            )}
            {listQ.updatedAt && listQ.data ? <span>Updated {formatTime(new Date(listQ.updatedAt))}</span> : null}
          </span>
        }
        actions={
          <>
            {ctx.isTenantSelected ? (
              <Button
                variant="outline"
                onClick={() => {
                  ctx.clearTenantSelection();
                  toast.success("Viewing all tenants");
                }}
                disabled={pending}
              >
                <Globe2 /> Return to all tenants
              </Button>
            ) : null}
            <Button variant="outline" onClick={listQ.refetch} disabled={listQ.loading || listQ.refreshing} aria-label="Refresh tenants">
              <RefreshCw className={listQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            {canCreate ? (
              <Button onClick={() => setCreating(true)} data-testid="tenant-create-button">
                <Plus /> Create tenant
              </Button>
            ) : null}
          </>
        }
      />

      {ctx.error ? (
        <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert" data-testid="tenant-error">
          {ctx.error}
        </p>
      ) : null}
      {created ? (
        <p className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success-soft px-3 py-2 text-[13px] text-success" role="status" data-testid="tenant-created">
          <span>
            Created {created.name ?? "tenant"} · ID {created.id ?? "not returned"} · code {created.code ?? "not returned"}
            {created.id !== null && listQ.data && !listQ.refreshing && !items.some((t) => t.id === created.id) ? " — not in the refreshed list yet" : ""}
          </span>
          <button type="button" className="text-xs font-semibold underline-offset-2 hover:underline" onClick={() => setCreated(null)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {listQ.error && listQ.data ? (
        <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status" data-testid="tenant-stale">
          Refresh failed — showing the list from {listQ.updatedAt ? formatTime(new Date(listQ.updatedAt)) : "earlier"}.{" "}
          <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={listQ.refetch}>
            Retry
          </button>
        </p>
      ) : null}

      {/* Summary: server figures; status counts only when the list is complete. */}
      {summary ? (
        <dl className="mb-3 grid grid-cols-2 gap-2 @2xl:grid-cols-4" data-testid="tenant-summary">
          {[
            ["Tenants", formatNumber(summary.tenants)],
            ["Active", summary.active === null ? "—" : formatNumber(summary.active)],
            ["Inactive", summary.inactive === null ? "—" : formatNumber(summary.inactive)],
            ["Other / no status", summary.otherStatus === null ? "—" : formatNumber(summary.otherStatus)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-line/60 bg-surface px-3.5 py-2.5 shadow-card">
              <dt className="text-[11.5px] font-medium text-ink-muted">{label}</dt>
              <dd className="text-[20px] leading-7 font-semibold tabular" title={value === "—" ? "Unavailable: the server's total doesn't match the rows returned" : undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/70 bg-surface px-3 shadow-card">
          <Search className="size-4 text-ink-subtle" aria-hidden />
          <input value={query} onChange={(e) => setFilter(() => setQuery(e.target.value))} placeholder="Search by name, code or id" aria-label="Search tenants" className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
        <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {[{ value: ALL_STATUSES, label: "All", count: items.length, documented: false }, ...options].map((o) => (
            <button
              key={o.value || "none"}
              type="button"
              role="radio"
              aria-checked={status === o.value}
              onClick={() => setFilter(() => setStatus(o.value))}
              title={o.documented ? "Listed in the server's status catalogue" : undefined}
              className={cn("min-h-10 rounded-full border px-3 text-[12.5px] font-medium", status === o.value ? "border-ink bg-ink text-white" : "border-line/70 bg-surface text-ink-muted hover:text-ink")}
            >
              {o.label} <span className="tabular opacity-70">{o.count}</span>
            </button>
          ))}
        </div>
      </div>

      {summary && !summary.complete ? (
        <p className="mb-3 text-xs text-warning" role="status" data-testid="tenant-incomplete">
          The server reports {formatNumber(summary.tenants)} tenants but returned {formatNumber(items.length)}; only those are listed, and status totals are unavailable.
        </p>
      ) : null}

      <Panel className="overflow-hidden">
        {listQ.error && !listQ.data ? (
          <ApiErrorState error={listQ.error} onRetry={listQ.refetch} title="Couldn't load tenants" />
        ) : !listQ.data ? (
          <LoadingSkeleton variant="table" rows={5} />
        ) : items.length === 0 ? (
          <EmptyState icon={Building2} title="No tenants returned" description="The server returned an empty tenant list." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="No matching tenants" description="Change the search or status filter." />
        ) : (
          <>
            {/* Narrow screens: cards. */}
            <ul className="divide-y divide-line/70 @3xl:hidden" aria-label="Tenants">
              {view.rows.map((t, i) => (
                <li key={t.id ?? `m-${i}`} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-ink">{t.name ?? "Unnamed tenant"}</p>
                      <p className="font-mono text-[11px] text-ink-subtle">
                        {t.code ?? "—"} · id {t.id ?? "—"}
                      </p>
                    </div>
                    <TenantStatus status={t.status} />
                  </div>
                  <p className="text-xs text-ink-muted">
                    {n(t.users)} users · {n(t.devices)} devices · {n(t.drivers)} drivers{t.timezone ? ` · ${t.timezone}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <SelectButton tenant={t} current={t.id === ctx.selectedTenantId} busy={ctx.pendingTenantId === t.id} disabled={pending} onSelect={choose} />
                    <Button size="sm" variant="ghost" className="min-h-9" onClick={() => setDetail(t)} aria-label={`Details for ${tenantLabel(t)}`}>
                      <Info /> Details
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {/* Wide screens: table. */}
            <div className="hidden overflow-x-auto @3xl:block">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Tenants returned by GET /platform/tenants</caption>
                <thead className="text-[11.5px] text-ink-muted">
                  <tr>
                    {["ID", "Tenant", "Status", "Timezone", "Users", "Devices", "Drivers", ""].map((h, i) => (
                      <th key={h || i} scope="col" className={cn("px-4 py-2.5 font-medium", i >= 4 && i <= 6 && "text-right")}>
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {view.rows.map((t, i) => {
                    const current = t.id === ctx.selectedTenantId;
                    return (
                      <tr key={t.id ?? `r-${i}`} className={cn(current && "bg-brand-soft/40")} aria-current={current ? "true" : undefined}>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-ink-muted tabular">{t.id ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <button type="button" className="text-left hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => setDetail(t)} aria-label={`Details for ${tenantLabel(t)}`}>
                            <span className="block font-medium text-ink">{t.name ?? "Unnamed tenant"}</span>
                            <span className="block font-mono text-[11px] text-ink-subtle">{t.code ?? "—"}</span>
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <TenantStatus status={t.status} />
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{t.timezone ?? <span title="Not returned">—</span>}</td>
                        <td className="px-4 py-2.5 text-right tabular">
                          <Count value={t.users} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">
                          <Count value={t.devices} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">
                          <Count value={t.drivers} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <SelectButton tenant={t} current={current} busy={ctx.pendingTenantId === t.id} disabled={pending} onSelect={choose} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {view.pages > 1 ? (
              <nav aria-label="Tenant pages" className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5 text-xs text-ink-muted">
                <span data-testid="tenant-page-range">
                  {view.from}–{view.to} of {view.total}
                </span>
                <span className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="min-h-9" onClick={() => setPage(view.page - 1)} disabled={view.page <= 1} aria-label="Previous page">
                    <ChevronLeft />
                  </Button>
                  <span className="tabular">
                    {view.page} / {view.pages}
                  </span>
                  <Button size="sm" variant="outline" className="min-h-9" onClick={() => setPage(view.page + 1)} disabled={view.page >= view.pages} aria-label="Next page">
                    <ChevronRight />
                  </Button>
                </span>
              </nav>
            ) : null}
          </>
        )}
      </Panel>

      <div className="mt-3 space-y-1.5 text-xs text-ink-muted">
        <p>Selecting a tenant validates it with the server and applies it to tenant data and actions in this browser tab only. It doesn&apos;t change your sign-in. Only active tenants can be selected.</p>
        <p data-testid="tenant-unsupported">
          Editing, activating, deactivating or deleting tenants isn&apos;t available here: the API has no such tenant operations.
        </p>
      </div>

      {canCreate && creating ? (
        <TenantCreatePanel open tenants={items} catalogue={catalogue} onClose={() => setCreating(false)} onCreated={onCreated} onUncertain={listQ.refetch} />
      ) : null}

      <SlideOverPanel
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail ? tenantLabel(detail) : "Tenant"}
        description="From the tenant list (V10 has no tenant detail endpoint). Viewing doesn't change your tenant selection."
        width="sm"
        footer={
          detail ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <SelectButton tenant={detail} current={detail.id === ctx.selectedTenantId} busy={ctx.pendingTenantId === detail.id} disabled={pending} onSelect={choose} />
              <Button variant="outline" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <div data-testid="tenant-detail">
            <dl>
              {tenantDetailRows(detail).map((r) => (
                <DetailRow key={r.label} label={r.label}>
                  {r.value ?? <span className="text-ink-subtle">— {r.missing}</span>}
                </DetailRow>
              ))}
              <DetailRow label="Your selection">{detail.id === ctx.selectedTenantId ? "Selected in this tab" : "Not selected"}</DetailRow>
            </dl>
            {catalogue ? (
              <p className="mt-3 text-xs text-ink-muted">
                Server status catalogue ({catalogue.name ?? catalogue.field}): {(catalogue.values ?? []).join(", ") || "no values"}
                {catalogue.notes ? ` — ${catalogue.notes}` : ""}
              </p>
            ) : null}
            {selectBlockReason(detail) ? <p className="mt-2 text-xs text-ink-muted">{selectBlockReason(detail)}</p> : null}
          </div>
        ) : null}
      </SlideOverPanel>
    </div>
  );
}

function TenantStatus({ status }: { status?: string }) {
  if (!status || !status.trim()) return <span className="text-ink-subtle" title="No status returned">—</span>;
  return (
    <StatusBadge size="sm" tone={status.trim().toUpperCase() === "ACTIVE" ? "success" : "neutral"}>
      {status.trim()}
    </StatusBadge>
  );
}

function SelectButton({ tenant, current, busy, disabled, onSelect }: { tenant: TenantDto; current: boolean; busy: boolean; disabled: boolean; onSelect: (t: TenantDto) => void }) {
  if (current)
    return (
      <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-[12.5px] font-semibold text-brand-deep" data-testid="tenant-current">
        <Check className="size-3.5" aria-hidden /> Selected
      </span>
    );
  const blocked = selectBlockReason(tenant);
  if (blocked)
    return (
      <span className="inline-flex min-h-9 items-center rounded-full px-3 text-[12.5px] text-ink-subtle" title={blocked}>
        Not selectable
      </span>
    );
  return (
    <Button size="sm" variant="outline" className="min-h-9" onClick={() => onSelect(tenant)} disabled={disabled} aria-label={`Select ${tenantLabel(tenant)}`}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {busy ? "Switching…" : "Select"}
    </Button>
  );
}
