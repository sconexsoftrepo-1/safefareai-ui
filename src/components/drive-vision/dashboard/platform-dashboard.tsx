"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Bell, Building2, Cpu, Gauge, Globe2, Layers3, RefreshCw, ShieldAlert, Siren, UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canAccessScreen, canViewWidget, dataScope, WIDGETS, type WidgetKey } from "@/features/drive-vision/access/access-policy";
import { useAccess, useTenantContext } from "@/features/drive-vision/access/use-access";
import { insightService } from "@/features/drive-vision/api/insight-service";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { platformService } from "@/features/drive-vision/api/platform-service";
import type { AlertRow, TenantDto } from "@/features/drive-vision/api/types";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { DATE_RANGE_OPTIONS, resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatDateTime, formatNumber, formatRelative, formatTime } from "@/features/drive-vision/utils/format";
import { useApiQuery, type ApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { PageHeader } from "../shared/page-header";
import { MetricCard } from "../shared/metric-card";
import { Panel, PanelHeader, ProgressMeter } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceNotice, UnavailableState } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { FleetStatusCard, type HealthIssue } from "./fleet-status-card";
import { DailyTrendPanel, OperationsSnapshot } from "./operations-panels";
import { statusSegments, trendRows } from "./dashboard-api-model";
import { serverCount, severityRows, sortTenants, summarizeTenants } from "./platform-dashboard-model";

/**
 * Safe-Fare Admin platform dashboard (Phase 4). Shown only to `platform === true` + `tenant.all`
 * (screen `platform`, enforced by RouteGuard). Every figure is a server value:
 * - Tenants, and users / drivers / devices summed from the complete GET /platform/tenants list.
 * - Device health, fleet status, operations, trends and safety from the existing /dashboard/* aggregates.
 *   V10: the Safe-Fare Admin's reads without X-Tenant-Id cover every tenant, and this client never
 *   sends a tenant selector, so these are all-tenant figures. Tenant selection is Phase 5.
 * - Device groups: the server `total` of GET /groups (a count, not a sum of pages).
 * Each widget loads, fails and retries on its own; a missing value is "—", never 0.
 */

const dash = (v: number | null | undefined) => (typeof v === "number" ? formatNumber(v) : "—");

/** Loading / error / no-permission frame for one widget. `children` renders only with data. */
function WidgetBody<T>({ allowed, widget, query, empty, emptyTitle = "Nothing returned", children, skeleton = "list" }: {
  allowed: boolean;
  widget: WidgetKey;
  query: ApiQuery<T>;
  empty?: (data: T) => boolean;
  emptyTitle?: string;
  children: (data: T) => React.ReactNode;
  skeleton?: "list" | "chart" | "card";
}) {
  if (!allowed) return <UnavailableState title="No permission for this widget" reason={`Needs ${(WIDGETS[widget].anyOf ?? []).join(" or ")}.`} className="py-8" />;
  if (query.error && query.data === undefined) return <ApiErrorState error={query.error} onRetry={query.refetch} compact />;
  if (query.data === undefined) return <LoadingSkeleton variant={skeleton} rows={4} className={skeleton === "chart" ? "h-[220px]" : undefined} />;
  if (empty?.(query.data)) return <EmptyState icon={Layers3} title={emptyTitle} description="The server returned no data for this widget." className="py-8" />;
  return <>{children(query.data)}</>;
}

/** Inline notice when a refresh failed but older data is still shown. */
function StaleNotice({ query }: { query: ApiQuery<unknown> }) {
  if (!query.error || query.data === undefined) return null;
  return (
    <p className="mx-5 mt-3 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning" role="status">
      Refresh failed — showing data from {query.updatedAt ? formatTime(new Date(query.updatedAt)) : "earlier"}.{" "}
      <button type="button" onClick={query.refetch} className="font-semibold underline-offset-2 hover:underline">
        Retry
      </button>
    </p>
  );
}

export function PlatformDashboard() {
  const access = useAccess();
  const scope = dataScope(access);
  const tenantCtx = useTenantContext();
  // Fleet widgets follow the tenant context (header on TENANT_SCOPED requests); the tenant list never does.
  const where = scope === "all-tenants" ? "all tenants" : (tenantCtx.selectedTenantName ?? tenantCtx.selectedTenantCode ?? "the selected tenant");
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("7d");
  const [now, setNow] = useState(() => new Date());
  const range = useMemo(() => resolveDateRange(rangeKey, now), [rangeKey, now]);
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const can = {
    tenants: canViewWidget(access, "platform.tenants"),
    fleet: canViewWidget(access, "dashboard.fleet"),
    safety: canViewWidget(access, "dashboard.safety"),
    groups: canViewWidget(access, "dashboard.groups"),
  };
  // Keys are prefixed "platform:" so they never share an in-flight request with the tenant Overview. `null` = not requested.
  const tenantsQ = useApiQuery(can.tenants ? "platform:tenants" : null, () => platformService.tenants());
  const groupsQ = useApiQuery(can.groups ? "platform:groups" : null, () => fleetService.listGroups());
  const overviewQ = useApiQuery(can.fleet ? "platform:overview" : null, () => insightService.overview());
  const statusQ = useApiQuery(can.fleet ? "platform:fleet-status" : null, () => insightService.fleetStatus());
  const trendsQ = useApiQuery(can.fleet ? `platform:trends:${from}:${to}` : null, () => insightService.trends({ from, to }));
  const safetyQ = useApiQuery(can.safety ? `platform:safety:${from}:${to}` : null, () => insightService.safetyEvents({ from, to }));

  const summary = useMemo(() => summarizeTenants(tenantsQ.data), [tenantsQ.data]);
  const tenants = useMemo(() => sortTenants(tenantsQ.data?.items ?? []), [tenantsQ.data]);
  const slices = useMemo(() => statusSegments(statusQ.data?.items), [statusQ.data]);
  const trend = useMemo(() => trendRows(trendsQ.data?.items), [trendsQ.data]);
  const overview = overviewQ.data?.data;
  const vehicles = overview?.vehicles;
  const health = overview?.health;
  const safety = safetyQ.data?.data;
  const severities = severityRows(safety?.bySeverity);
  const rangeShort = range.key === "today" ? "today" : range.key === "7d" ? "7 d" : "30 d";

  const queries = [tenantsQ, groupsQ, overviewQ, statusQ, trendsQ, safetyQ];
  const refreshing = queries.some((q) => q.refreshing);
  const refresh = () => {
    setNow(new Date());
    queries.forEach((q) => q.refetch());
  };
  const updatedAt = Math.max(0, ...queries.map((q) => q.updatedAt ?? 0)) || null;

  /** A tenant-list KPI: the summed value, or why it isn't shown. */
  const tenantKpi = (value: number | null | undefined) => {
    if (!can.tenants) return { value: "—", note: "Needs tenant.all" };
    if (tenantsQ.error && !tenantsQ.data) return { value: "—", note: "Unavailable — tenant list failed" };
    if (!summary) return { value: "—", note: "Loading…" };
    if (!summary.complete) return { value: "—", note: "Unavailable — tenant list incomplete" };
    if (value === null || value === undefined) return { value: "—", note: "Not reported for every tenant" };
    return { value: formatNumber(value), note: "Sum of per-tenant counts (platform)" };
  };
  const users = tenantKpi(summary?.users);
  const drivers = tenantKpi(summary?.drivers);
  const devices = tenantKpi(summary?.devices);
  const tenantsNote = !can.tenants
    ? "Needs tenant.all"
    : tenantsQ.error && !tenantsQ.data
      ? "Unavailable"
      : !summary
        ? "Loading…"
        : summary.complete
          ? `${summary.active} active · ${summary.inactive} inactive${summary.otherStatus ? ` · ${summary.otherStatus} other status` : ""}`
          : "Status breakdown unavailable — list incomplete";
  const groupsValue = !can.groups ? "—" : groupsQ.data ? formatNumber(groupsQ.data.total) : "—";
  const groupsNote = !can.groups ? "Needs group.read" : groupsQ.error && !groupsQ.data ? "Unavailable" : groupsQ.data ? `Server total · ${where}` : "Loading…";

  const healthIssues: HealthIssue[] = [
    { label: "Stale > 24 h", value: serverCount(health?.staleOver24h), icon: Gauge, href: "/drive-vision/monitoring", note: "Server count" },
    { label: "Low battery", value: serverCount(health?.lowBattery), icon: Gauge, href: "/drive-vision/vehicles", note: "Server count; threshold set by the server" },
    { label: "Never online", value: serverCount(health?.neverOnline), icon: Gauge, href: "/drive-vision/vehicles" },
    { label: "Service expired", value: serverCount(health?.expired), icon: Gauge, href: "/drive-vision/vehicles?expiry=expired" },
  ];
  const vehicleSegments =
    slices.length > 0
      ? slices.map((s) => ({ ...s, href: "/drive-vision/monitoring" }))
      : serverCount(vehicles?.online) !== null && serverCount(vehicles?.offline) !== null
        ? [
            { key: "online", label: "Online", value: vehicles!.online!, color: "var(--dv-success)", href: "/drive-vision/monitoring" },
            { key: "offline", label: "Offline", value: vehicles!.offline!, color: "var(--dv-ink-subtle)", href: "/drive-vision/monitoring?status=offline" },
          ]
        : [];

  const links = [
    { screen: "overview" as const, label: "Fleet Overview", hint: "All-tenant fleet view", href: "/drive-vision/overview", icon: Gauge },
    { screen: "alerts" as const, label: "Alerts & Events", hint: "Review events", href: "/drive-vision/alerts", icon: Bell },
    { screen: "vehicles" as const, label: "Vehicles", hint: "Devices & groups", href: "/drive-vision/vehicles", icon: Cpu },
    { screen: "users" as const, label: "Users", hint: "Accounts & roles", href: "/drive-vision/users", icon: UsersRound },
  ].filter((l) => canAccessScreen(access, l.screen));

  return (
    <div>
      <PageHeader
        title="Platform overview"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-semibold text-brand-deep" data-testid="platform-scope">
              <Globe2 className="size-3.5" aria-hidden />
              {scope === "all-tenants" ? "Platform · all tenants" : `Tenant · ${where}`}
            </span>
            {updatedAt ? <span>Updated {formatTime(new Date(updatedAt))}</span> : <span>Loading platform data…</span>}
          </span>
        }
        actions={
          <>
            <SegmentedControl label="Date range" value={rangeKey} onChange={setRangeKey} options={DATE_RANGE_OPTIONS} />
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} aria-label="Refresh platform data">
              <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      <DataSourceNotice source={overviewQ.data?.source ?? null} className="mb-4" />

      {/* A. Platform overview */}
      <section aria-label="Platform overview" className="grid grid-cols-1 gap-2.5 rounded-card border border-line/60 bg-surface p-2.5 shadow-card @sm:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-5">
        <MetricCard index={1} tone="featured" label="Tenants" value={can.tenants && summary ? formatNumber(summary.tenants) : "—"} sublabel={tenantsNote} icon={Building2} className="min-h-[128px] @sm:col-span-2 @3xl:col-span-1" />
        <MetricCard index={2} tone="muted" label="Users" value={users.value} sublabel={users.note} icon={UsersRound} accent="sky" className="min-h-[128px]" />
        <MetricCard index={3} tone="muted" label="Drivers" value={drivers.value} sublabel={drivers.note} icon={UserRound} accent="mint" className="min-h-[128px]" />
        <MetricCard index={4} tone="muted" label="Devices" value={devices.value} sublabel={devices.note} icon={Cpu} accent="lavender" className="min-h-[128px]" />
        <MetricCard index={5} tone="muted" label="Device groups" value={groupsValue} sublabel={groupsNote} icon={Layers3} accent="peach" className="min-h-[128px]" />
      </section>
      {can.tenants && tenantsQ.error && !tenantsQ.data ? (
        <Panel className="mt-3">
          <ApiErrorState error={tenantsQ.error} onRetry={tenantsQ.refetch} title="Couldn't load the tenant list" compact />
        </Panel>
      ) : null}
      {can.groups && groupsQ.error && !groupsQ.data ? (
        <Panel className="mt-3">
          <ApiErrorState error={groupsQ.error} onRetry={groupsQ.refetch} title="Couldn't load device groups" compact />
        </Panel>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 @4xl:grid-cols-12">
        {/* B. Device health */}
        <Panel aria-labelledby="pf-health" className="flex flex-col @4xl:col-span-5">
          <PanelHeader titleId="pf-health" title="Device health" description={`Vehicle status and device health · ${where} (server aggregates)`} />
          <StaleNotice query={statusQ} />
          <WidgetBody allowed={can.fleet} widget="dashboard.fleet" query={overviewQ} skeleton="card">
            {() =>
              vehicleSegments.length ? (
                <FleetStatusCard total={vehicleSegments.reduce((s, x) => s + x.value, 0)} online={serverCount(vehicles?.online) ?? 0} segments={vehicleSegments} issues={healthIssues} />
              ) : (
                <UnavailableState title="No status breakdown" reason="The server returned no vehicle status counts." className="py-8" />
              )
            }
          </WidgetBody>
        </Panel>

        {/* C. Fleet operations */}
        <Panel aria-labelledby="pf-ops" className="flex flex-col @4xl:col-span-7">
          <PanelHeader titleId="pf-ops" title="Fleet operations" description={`Vehicles, trips and dispatch work today · ${where}`} />
          <StaleNotice query={overviewQ} />
          <WidgetBody allowed={can.fleet} widget="dashboard.fleet" query={overviewQ}>
            {(d) => (
              <>
                <dl className="mx-5 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-inner bg-line/70 text-center @2xl:grid-cols-4">
                  {[
                    ["Vehicles", vehicles?.total],
                    ["Driving", vehicles?.driving],
                    ["Idling", vehicles?.idling],
                    ["Parked", vehicles?.parked],
                  ].map(([label, v]) => (
                    <div key={label as string} className="bg-surface-muted px-2 py-2">
                      <dt className="text-[11.5px] font-medium text-ink-muted">{label}</dt>
                      <dd className="text-[20px] leading-7 font-semibold tabular">{dash(serverCount(v))}</dd>
                    </div>
                  ))}
                </dl>
                <OperationsSnapshot trips={d.data.trips} operations={d.data.operations} />
              </>
            )}
          </WidgetBody>
        </Panel>

        {/* D. Alerts and AI events */}
        <Panel aria-labelledby="pf-safety" className="flex flex-col @4xl:col-span-5">
          <PanelHeader titleId="pf-safety" title="Alerts & AI events" description={`${where.charAt(0).toUpperCase()}${where.slice(1)} · ${range.label.toLowerCase()}`} />
          <StaleNotice query={safetyQ} />
          <WidgetBody allowed={can.safety} widget="dashboard.safety" query={safetyQ}>
            {() => (
              <div className="space-y-3 px-5 pt-3 pb-5">
                <div className="grid grid-cols-1 gap-2.5 @sm:grid-cols-2">
                  <MetricCard index={1} tone="muted" label={`Alarms · ${rangeShort}`} value={dash(serverCount(safety?.total))} sublabel={`${dash(serverCount(safety?.ai))} AI · ${dash(serverCount(safety?.routine))} routine`} icon={ShieldAlert} accent="peach" />
                  <MetricCard index={2} tone="muted" label="Open alerts" value={dash(serverCount(safety?.open))} sublabel={`${dash(serverCount(safety?.severe))} severe`} icon={Bell} accent={serverCount(safety?.open) ? "brand" : "neutral"} />
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">By severity (server scale)</p>
                  {severities.length ? (
                    <ul className="space-y-2">
                      {severities.map((s) => (
                        <li key={s.key} className="text-xs">
                          <span className="mb-1 flex justify-between text-ink-muted">
                            <span>Severity {s.key}</span>
                            <span className="font-semibold text-ink tabular">{formatNumber(s.value)}</span>
                          </span>
                          <ProgressMeter value={s.value} max={Math.max(1, serverCount(safety?.total) ?? s.value)} label={`Severity ${s.key}`} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-muted">No severity breakdown returned.</p>
                  )}
                </div>
              </div>
            )}
          </WidgetBody>
        </Panel>

        {/* E. Recent activity */}
        <Panel aria-labelledby="pf-recent" className="flex flex-col @4xl:col-span-7">
          <PanelHeader titleId="pf-recent" title="Recent open events" description={`Latest open alerts · ${where} (from the safety summary)`} />
          <WidgetBody allowed={can.safety} widget="dashboard.safety" query={safetyQ}>
            {() => <RecentEvents rows={safety?.latestOpen ?? []} now={now} />}
          </WidgetBody>
        </Panel>

        {/* Alarm and trip trend */}
        <Panel aria-labelledby="pf-trend" className="@4xl:col-span-12">
          <PanelHeader titleId="pf-trend" title="Daily trend" description={`Trips, distance and alarms per day · ${where} · ${range.label.toLowerCase()}`} />
          <StaleNotice query={trendsQ} />
          <WidgetBody allowed={can.fleet} widget="dashboard.fleet" query={trendsQ} skeleton="chart">
            {() => <DailyTrendPanel rows={trend} />}
          </WidgetBody>
        </Panel>

        {/* Tenants */}
        <Panel aria-labelledby="pf-tenants" className="@4xl:col-span-12">
          <PanelHeader titleId="pf-tenants" title="Tenants" description="Per-tenant counts reported by the server (always platform-wide)" />
          <WidgetBody allowed={can.tenants} widget="platform.tenants" query={tenantsQ} empty={(d) => d.items.length === 0} emptyTitle="No tenants returned">
            {() => <TenantTable tenants={tenants} />}
          </WidgetBody>
        </Panel>
      </div>

      {links.length ? (
        <nav aria-label="Platform quick links" className="mt-4 grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          {links.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="group flex min-h-11 items-center gap-3 rounded-[18px] border border-line/60 bg-surface p-3 shadow-card transition-[box-shadow,border-color] duration-[180ms] ease-dv hover:border-line-strong hover:shadow-hover focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted">
                <q.icon className="size-[18px] text-ink" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{q.label}</span>
                <span className="block truncate text-xs text-ink-muted">{q.hint}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/** Latest open alerts from SafetySummary.latestOpen. `kind` and `severity` are shown as the server sends them (undocumented values). */
function RecentEvents({ rows, now }: { rows: AlertRow[]; now: Date }) {
  if (rows.length === 0) return <EmptyState icon={Siren} title="No open events" description="The server returned no open alerts for this period." className="py-8" />;
  return (
    <ul className="px-3 pt-2 pb-3">
      {rows.slice(0, 8).map((a, i) => (
        <li key={a.id ?? `row-${i}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-peach text-serious" aria-hidden>
            <Siren className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{a.alarmName ?? `Alarm type ${a.alarmTypeId ?? "?"}`}</span>
            <span className="block truncate text-xs text-ink-muted">{[a.deviceName ?? a.terminalNo, a.driverName, a.kind, typeof a.severity === "number" ? `severity ${a.severity}` : null].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {a.handlingStatus ? (
              <StatusBadge size="sm" tone={a.handlingStatus === "NEW" ? "serious" : "neutral"}>
                {a.handlingStatus}
              </StatusBadge>
            ) : null}
            {a.alarmTime ? (
              <time dateTime={a.alarmTime} title={formatDateTime(a.alarmTime)} className="text-[11px] text-ink-subtle">
                {formatRelative(a.alarmTime, now)}
              </time>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tenant list: scrolls horizontally inside its panel on narrow screens (the page itself never does). */
function TenantTable({ tenants }: { tenants: TenantDto[] }) {
  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="dv-thead text-[12px]">
          <tr>
            <th scope="col" className="px-3 py-2.5">Tenant</th>
            <th scope="col" className="px-3 py-2.5">Status</th>
            <th scope="col" className="px-3 py-2.5 text-right">Users</th>
            <th scope="col" className="px-3 py-2.5 text-right">Devices</th>
            <th scope="col" className="px-3 py-2.5 text-right">Drivers</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {tenants.map((t, i) => (
            <tr key={t.id ?? `t-${i}`}>
              <td className="px-3 py-2.5">
                <span className="block font-medium text-ink">{t.name ?? "Unnamed tenant"}</span>
                <span className="block font-mono text-[11px] text-ink-subtle">{t.code ?? "—"}</span>
              </td>
              <td className="px-3 py-2.5">
                {t.status ? (
                  <StatusBadge size="sm" tone={t.status.toUpperCase() === "ACTIVE" ? "success" : "neutral"}>
                    {t.status}
                  </StatusBadge>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right tabular">{dash(serverCount(t.users))}</td>
              <td className="px-3 py-2.5 text-right tabular">{dash(serverCount(t.devices))}</td>
              <td className="px-3 py-2.5 text-right tabular">{dash(serverCount(t.drivers))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
