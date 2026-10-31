"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, BatteryLow, Bell, CalendarX2, Cctv, Clock, Layers3, Navigation, Radar, RefreshCw, Route, SatelliteDish, ShieldAlert, Truck, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/features/drive-vision/hooks/use-preferences";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { accountService } from "@/features/drive-vision/api/account-service";
import { insightService } from "@/features/drive-vision/api/insight-service";
import { reminderDaysFrom } from "../settings/settings-model";
import { useAuth } from "@/features/drive-vision/store/auth-store";
import { bucketTrend } from "@/features/drive-vision/selectors";
import { DATE_RANGE_OPTIONS, greeting, resolveDateRange } from "@/features/drive-vision/utils/time";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { formatDateTime, formatKm, formatRelative, formatTime } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { MetricCard } from "../shared/metric-card";
import { InsetPanel, Panel, PanelHeader, ProgressMeter } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge, DataSourceNotice, apiErrorMeta } from "../shared/api-states";
import { EASE_OUT } from "../shared/motion";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { AlarmTrendChart, TrendViewToggle, type TrendView } from "./alarm-trend-chart";
import { FleetStatusCard, type HealthIssue } from "./fleet-status-card";
import { LiveActivityList } from "./live-activity-list";
import { RemindersList } from "./reminders-list";
import { FleetGroups } from "./fleet-groups";
import { statusSegments, trendRows } from "./dashboard-api-model";
import { DailyTrendPanel, OperationsSnapshot } from "./operations-panels";
import { CURRENT_REPORT_MS, EXPIRING_DAYS, LOW_BATTERY_PCT, deviceReminders, deviceStats, groupCards, mergeAlarms } from "./live-dashboard-model";

const QUICK_LINKS = [
  { label: "Live Monitoring", hint: "Map & vehicle status", href: "/drive-vision/monitoring", icon: Radar, tone: "bg-sky" },
  { label: "Vehicles", hint: "Devices & groups", href: "/drive-vision/vehicles", icon: Truck, tone: "bg-mint" },
  { label: "Historical Video", hint: "Camera playback", href: "/drive-vision/video", icon: Cctv, tone: "bg-lavender" },
  { label: "Trips", hint: "Routes & playback", href: "/drive-vision/trips", icon: Route, tone: "bg-peach" },
  { label: "Alerts", hint: "Events to review", href: "/drive-vision/alerts", icon: Bell, tone: "bg-brand-soft" },
];

const MINUTES = (ms: number) => Math.round(ms / 60_000);

/** One-line error inside a card, with retry — for sections where a full error panel would be too heavy. */
function InlineError({ error, onRetry, label }: { error: unknown; onRetry: () => void; label: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert" title={apiErrorMeta(error) ?? undefined}>
      <span className="min-w-0 flex-1">
        {label}: {describeApiError(error)}
      </span>
      <button type="button" onClick={onRetry} className="font-semibold underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
        Retry
      </button>
    </p>
  );
}

/**
 * Fleet Overview on live BFF data. Server aggregates: GET /dashboard/overview (vehicle counts,
 * active trips, device health, operations — one call, so /dashboard/vehicles, /active-trips and
 * /device-health aren't requested separately), /dashboard/fleet-status, /dashboard/trends and
 * /dashboard/safety-events for the selected range. Device lists, groups, realtime state and the
 * alarm lists (GET /devices, /groups, /monitor/realtime, /alarms/*) still feed reminders, group
 * cards, GPS freshness, the hourly/daily alarm chart and recent activity.
 */
/** Used when the saved reminder window can't be loaded or isn't a positive whole number. */
const DEFAULT_REMINDER_DAYS = 30;

export function FleetOverview() {
  const prefs = usePreferences();
  const user = useAuth((s) => s.user);
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("7d");
  const [trendView, setTrendView] = useState<TrendView>("chart");
  const [now, setNow] = useState(() => new Date());
  const modules = prefs.dashboardModules;

  const range = useMemo(() => resolveDateRange(rangeKey, now), [rangeKey, now]);
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const devicesQ = useApiQuery("overview:devices", () => fleetService.listAllDevices());
  const groupsQ = useApiQuery("overview:groups", () => fleetService.listGroups());
  const realtimeQ = useApiQuery("overview:realtime", () => fleetService.realtime());
  const aiQ = useApiQuery(`overview:ai:${from}:${to}`, () => fleetService.listAllAlarms("ai", { from, to }));
  const routineQ = useApiQuery(`overview:routine:${from}:${to}`, () => fleetService.listAllAlarms("routine", { from, to }));
  // Reminder window from GET /me/preferences; the default is used (and labelled) when it is unavailable.
  const prefsQ = useApiQuery("overview:preferences", () => accountService.preferences());
  const dashQ = useApiQuery("overview:dashboard", () => insightService.overview());
  const statusQ = useApiQuery("overview:fleet-status", () => insightService.fleetStatus());
  const trendsQ = useApiQuery(`overview:trends:${from}:${to}`, () => insightService.trends({ from, to }));
  const safetyQ = useApiQuery(`overview:safety:${from}:${to}`, () => insightService.safetyEvents({ from, to }));
  const dash = dashQ.data?.data;
  const health = dash?.health;
  const slices = useMemo(() => statusSegments(statusQ.data?.items), [statusQ.data]);
  const trendDays = useMemo(() => trendRows(trendsQ.data?.items), [trendsQ.data]);
  const openAlerts = safetyQ.data?.data.open;
  const savedDays = reminderDaysFrom(prefsQ.data);
  const reminderDays = savedDays ?? DEFAULT_REMINDER_DAYS;

  const refresh = () => {
    setNow(new Date());
    devicesQ.refetch();
    groupsQ.refetch();
    realtimeQ.refetch();
    dashQ.refetch();
    statusQ.refetch();
  };
  const refreshing = devicesQ.refreshing || groupsQ.refreshing || realtimeQ.refreshing || dashQ.refreshing || statusQ.refreshing || aiQ.loading || routineQ.loading;

  const devices = devicesQ.data?.items;
  const states = realtimeQ.data?.data.devices;
  const online = realtimeQ.data?.data.onlineCount ?? 0;
  const offline = realtimeQ.data?.data.offlineCount ?? 0;
  const reported = online + offline;
  const onlinePct = reported ? Math.round((online / reported) * 100) : 0;

  const stats = useMemo(() => deviceStats(devices ?? [], states ?? [], now), [devices, states, now]);
  const alarms = useMemo(() => (aiQ.data || routineQ.data ? mergeAlarms(aiQ.data?.items, routineQ.data?.items) : null), [aiQ.data, routineQ.data]);
  const alarmsLoading = (aiQ.loading && !aiQ.error) || (routineQ.loading && !routineQ.error);
  const trend = useMemo(() => bucketTrend((alarms ?? []).filter((a) => a.alarmTime).map((a) => ({ time: a.alarmTime!, ai: a.kind === "ai" })), range), [alarms, range]);
  const awaiting = alarms?.filter((a) => a.handlingStatus === "NEW").length;
  const reminders = useMemo(() => deviceReminders(devices ?? [], reminderDays, now), [devices, reminderDays, now]);
  const cards = useMemo(() => groupCards(groupsQ.data?.items ?? [], devices ?? [], alarms), [groupsQ.data, devices, alarms]);

  const source = realtimeQ.data?.source ?? devicesQ.data?.source ?? null;
  const updatedAt = realtimeQ.updatedAt;
  const rangeShort = range.key === "today" ? "today" : range.key === "7d" ? "7 d" : "30 d";
  const freshStates = (states?.length ?? 0) - stats.staleGps;
  const truncatedNote = [aiQ.data?.truncated ? `first ${aiQ.data.items.length} of ${aiQ.data.total} AI events` : null, routineQ.data?.truncated ? `first ${routineQ.data.items.length} of ${routineQ.data.total} routine alarms` : null]
    .filter(Boolean)
    .join(" · ");

  const deviceTiles = [
    { label: "Online", value: realtimeQ.data ? online : "—", note: "Reporting", tone: "text-success", dot: "bg-success", href: "/drive-vision/monitoring" },
    { label: "Offline", value: realtimeQ.data ? offline : "—", note: "Not reporting", tone: "text-ink-muted", dot: "bg-ink-subtle", href: "/drive-vision/monitoring?status=offline" },
    {
      label: "Expiring",
      value: devices ? stats.expiringSoon : "—",
      note: `≤ ${EXPIRING_DAYS} days`,
      tone: stats.expiringSoon ? "text-warning" : "text-success",
      dot: "bg-warning",
      href: "/drive-vision/vehicles?expiry=soon",
    },
  ];

  // Server-computed device health (GET /dashboard/overview → health); thresholds are the server's.
  // Until it loads (or if it fails) the realtime-derived figures are shown, as before.
  const num = (v: number | undefined) => (typeof v === "number" ? v : null);
  const healthIssues: HealthIssue[] = health
    ? [
        { label: "Stale > 24 h", value: num(health.staleOver24h), icon: Clock, href: "/drive-vision/monitoring", note: "No report for over 24 hours (server count)" },
        { label: "Low battery", value: num(health.lowBattery), icon: BatteryLow, href: "/drive-vision/vehicles", note: "Server count; threshold set by the server" },
        { label: "Never online", value: num(health.neverOnline), icon: WifiOff, href: "/drive-vision/vehicles" },
        { label: "Service expired", value: num(health.expired), icon: CalendarX2, href: "/drive-vision/vehicles?expiry=expired" },
      ]
    : [
        { label: "Stale GPS > 1 h", value: states ? stats.staleGps : null, icon: Clock, href: "/drive-vision/monitoring", note: "Latest device report older than 1 hour" },
        { label: `Battery < ${LOW_BATTERY_PCT}%`, value: states ? stats.lowBattery : null, icon: BatteryLow, href: "/drive-vision/vehicles" },
        { label: "No GPS fix", value: null, icon: SatelliteDish, href: "/drive-vision/monitoring", note: "Not available: the API's positionMode codes aren't documented" },
        { label: "Service expired", value: devices ? stats.expired : null, icon: CalendarX2, href: "/drive-vision/vehicles?expiry=expired" },
      ];

  return (
    <div>
      <PageHeader
        title={`${greeting(now)}, ${user?.displayName || prefs.displayName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source={source} />
            {updatedAt ? <span>Updated {formatTime(new Date(updatedAt))}</span> : <span>Loading fleet data…</span>}
          </span>
        }
        actions={
          <>
            <SegmentedControl label="Date range" value={rangeKey} onChange={setRangeKey} options={DATE_RANGE_OPTIONS} />
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} aria-label="Refresh dashboard data">
              <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      <DataSourceNotice source={source} className="mb-4" />

      {/* 12-col: summary · KPIs · status / trend · reminders. 2-col: trend goes full width, status pairs with reminders. */}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-12">
        {modules.metrics ? (
          <>
            {/* Fleet summary: device count + actions, connectivity strip, GPS-freshness footer */}
            <motion.section
              aria-labelledby="summary-title"
              className="flex flex-col justify-between gap-3.5 rounded-card border border-line/60 bg-surface p-5 shadow-card transition-[box-shadow,border-color] duration-200 ease-dv hover:border-line-strong/70 hover:shadow-hover @6xl:col-span-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 id="summary-title" className="text-[13px] font-medium text-ink-muted">
                    Total devices
                  </h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[11.5px] font-medium text-ink-muted">
                    <Layers3 className="size-3.5" aria-hidden /> {groupsQ.data ? `${groupsQ.data.total} group${groupsQ.data.total === 1 ? "" : "s"}` : "— groups"}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-1.5">
                  <p className="text-[34px] leading-none font-semibold tracking-[-0.025em] text-ink tabular">{devicesQ.data ? devicesQ.data.total : "—"}</p>
                  {realtimeQ.data ? (
                    <p className="flex items-center gap-2 pb-0.5 text-xs text-ink-muted">
                      <span className="rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success tabular">{onlinePct}% online</span>
                      <span className="tabular">
                        {online} of {reported} reporting
                      </span>
                    </p>
                  ) : null}
                </div>
                {devicesQ.error ? <div className="mt-2"><InlineError label="Devices" error={devicesQ.error} onRetry={devicesQ.refetch} /></div> : null}
                {realtimeQ.error ? <div className="mt-2"><InlineError label="Realtime status" error={realtimeQ.error} onRetry={realtimeQ.refetch} /></div> : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button asChild>
                    <Link href="/drive-vision/monitoring">
                      <Radar /> Live map
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/drive-vision/vehicles">
                      <Truck /> Vehicles
                    </Link>
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">Devices</p>
                <ul className="grid grid-cols-3 divide-x divide-line/80 rounded-inner bg-surface-muted py-0.5" aria-label="Device connectivity and service">
                  {deviceTiles.map((d) => (
                    <li key={d.label} className="min-w-0 px-1">
                      <Link
                        href={d.href}
                        className="block rounded-xl px-2.5 py-1.5 transition-colors duration-150 ease-dv hover:bg-surface focus-visible:bg-surface focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
                      >
                        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-muted">
                          <span className={cn("size-1.5 shrink-0 rounded-full", d.dot)} aria-hidden />
                          {d.label}
                        </span>
                        <span className="mt-0.5 block text-[20px] leading-7 font-semibold text-ink tabular">{d.value}</span>
                        <span className={cn("block truncate text-[11px] font-medium", d.tone)}>{d.note}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                href="/drive-vision/monitoring"
                className="group block rounded-xl focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none"
                aria-label={`GPS freshness: ${freshStates} of ${states?.length ?? 0} devices reported within the last hour. Open live map`}
              >
                <span className="block border-t border-line/70 pt-3">
                  <span className="mb-2 flex items-center justify-between gap-3 text-[13px]">
                    <span className="flex items-center gap-1.5 font-medium text-ink">
                      <SatelliteDish className="size-4 text-brand" aria-hidden /> GPS freshness
                    </span>
                    <span className="text-ink-muted tabular">
                      {states ? (
                        <>
                          <span className="font-semibold text-ink">{freshStates}</span> of {states.length} current
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </span>
                  <ProgressMeter value={Math.max(0, freshStates)} max={Math.max(1, states?.length ?? 0)} label="Devices reporting within the last hour" />
                  <span className="mt-1 flex items-center justify-end gap-1 text-[12px] font-medium text-ink-muted transition-colors duration-150 group-hover:text-ink">
                    {stats.latestReport ? <span title={formatDateTime(stats.latestReport)}>Latest report {formatRelative(stats.latestReport, now)}</span> : "No reports yet"}
                    <ArrowUpRight className="size-3.5 transition-transform duration-150 ease-dv group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
                  </span>
                </span>
              </Link>
            </motion.section>

            {/* KPI cluster (reference: 2×2 tile group with a single coral tile) */}
            <section aria-label="Key metrics" className="grid grid-cols-2 gap-2.5 rounded-card border border-line/60 bg-surface p-2.5 shadow-card @6xl:col-span-4">
              <MetricCard
                index={1}
                tone="featured"
                label="Moving now"
                value={states ? stats.movingNow : "—"}
                sublabel={`speed > 0 · report ≤ ${MINUTES(CURRENT_REPORT_MS)} min old`}
                icon={Navigation}
                href="/drive-vision/monitoring?status=moving"
                className="min-h-[132px] @3xl:min-h-[170px]"
              />
              <MetricCard
                index={2}
                tone="muted"
                label={`AI events · ${rangeShort}`}
                value={aiQ.data ? aiQ.data.total : "—"}
                sublabel={aiQ.error ? "Unavailable" : "Driver-safety AI"}
                icon={ShieldAlert}
                accent="peach"
                href="/drive-vision/alerts"
                className="min-h-[132px] @3xl:min-h-[170px]"
              />
              <MetricCard
                index={3}
                tone="muted"
                label={typeof openAlerts === "number" ? "Open alerts" : "Awaiting handling"}
                value={openAlerts ?? awaiting ?? "—"}
                sublabel={
                  typeof openAlerts === "number"
                    ? `${safetyQ.data?.data.severe ?? "—"} severe · ${rangeShort}`
                    : alarms
                      ? `status NEW · ${aiQ.error ? "routine only" : routineQ.error ? "AI events only" : rangeShort}`
                      : "Unavailable"
                }
                icon={Bell}
                accent={(openAlerts ?? awaiting) ? "brand" : "neutral"}
                href="/drive-vision/alerts"
                spark={alarms ? trend.slice(-10).map((b) => b.total) : undefined}
                className="min-h-[132px] @3xl:min-h-[170px]"
              />
              <MetricCard
                index={4}
                tone="muted"
                label="Distance today"
                value={typeof dash?.trips?.distanceTodayKm === "number" ? formatKm(dash.trips.distanceTodayKm) : "—"}
                sublabel={dashQ.error ? "Unavailable" : dash ? `${dash.trips?.tripsToday ?? "—"} trips today` : "Loading…"}
                href="/drive-vision/trips"
                icon={Route}
                accent="sky"
                className="min-h-[132px] @3xl:min-h-[170px]"
              />
            </section>
          </>
        ) : null}

        {modules.status ? (
          <Panel className="flex flex-col @3xl:order-2 @6xl:order-none @6xl:col-span-4" aria-labelledby="status-title">
            <PanelHeader titleId="status-title" title="Fleet status" description={slices.length ? "Vehicle status from the server, and device health" : "Online / offline from the realtime feed, and device health"} />
            {slices.length > 0 ? (
              <FleetStatusCard
                total={slices.reduce((s, x) => s + x.value, 0)}
                online={dash?.vehicles?.online ?? online}
                segments={slices.map((s) => ({ ...s, href: "/drive-vision/monitoring" }))}
                issues={healthIssues}
              />
            ) : realtimeQ.error && !realtimeQ.data ? (
              <ApiErrorState error={realtimeQ.error} onRetry={realtimeQ.refetch} compact />
            ) : !realtimeQ.data ? (
              <LoadingSkeleton />
            ) : (
              <FleetStatusCard
                total={reported}
                online={online}
                segments={[
                  { key: "online", label: "Online", value: online, color: "var(--dv-success)", href: "/drive-vision/monitoring" },
                  { key: "offline", label: "Offline", value: offline, color: "var(--dv-ink-subtle)", href: "/drive-vision/monitoring?status=offline" },
                ]}
                issues={healthIssues}
              />
            )}
          </Panel>
        ) : null}

        {modules.trend ? (
          <Panel className="flex flex-col @3xl:order-1 @3xl:col-span-2 @6xl:order-none @6xl:col-span-8" aria-labelledby="trend-title">
            <PanelHeader
              titleId="trend-title"
              title="Fleet activity"
              description={`AI events and routine alarms · ${range.key === "today" ? "hourly counts today" : `daily counts, ${range.label.toLowerCase()}`}`}
              action={
                <>
                  <TrendViewToggle view={trendView} onChange={setTrendView} />
                  <Button asChild variant="ghost" size="sm" className="text-ink-muted">
                    <Link href="/drive-vision/safety">
                      Analytics <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  </Button>
                </>
              }
            />
            {aiQ.error && routineQ.error ? (
              <ApiErrorState
                error={aiQ.error}
                title="Couldn't load alarms for this period"
                onRetry={() => {
                  aiQ.refetch();
                  routineQ.refetch();
                }}
              />
            ) : alarmsLoading ? (
              <LoadingSkeleton variant="chart" className="h-[300px]" />
            ) : (
              <>
                <div className="space-y-2 px-5 pt-4 empty:hidden">
                  {aiQ.error ? <InlineError label="AI events unavailable" error={aiQ.error} onRetry={aiQ.refetch} /> : null}
                  {routineQ.error ? <InlineError label="Routine alarms unavailable" error={routineQ.error} onRetry={routineQ.refetch} /> : null}
                  {truncatedNote ? <p className="text-xs text-ink-muted">Chart counts the {truncatedNote}.</p> : null}
                </div>
                <InsetPanel className="mx-5 mt-4 mb-5 flex min-h-0 flex-1 flex-col">
                  <AlarmTrendChart data={trend} rangeKey={rangeKey} view={trendView} unavailable={{ ai: !!aiQ.error, general: !!routineQ.error }} />
                </InsetPanel>
              </>
            )}
          </Panel>
        ) : null}

        {modules.reminders ? (
          <Panel aria-labelledby="reminders-title" className="@3xl:order-2 @6xl:order-none @6xl:col-span-4">
            <PanelHeader
              titleId="reminders-title"
              title="Upcoming reminders"
              description={`Service expiry, insurance & maintenance · next ${reminderDays} days${savedDays === null && !prefsQ.loading ? " (default)" : ""}`}
              action={devices ? <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-deep tabular">{reminders.length} due</span> : undefined}
            />
            {devicesQ.error && !devices ? (
              <ApiErrorState error={devicesQ.error} onRetry={devicesQ.refetch} compact />
            ) : !devices ? (
              <LoadingSkeleton variant="list" rows={5} />
            ) : (
              <RemindersList reminders={reminders} />
            )}
          </Panel>
        ) : null}
      </div>

      <section aria-labelledby="groups-title" className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <h2 id="groups-title" className="text-[18px] font-semibold tracking-[-0.015em] text-ink">
              Fleet groups
            </h2>
            <p className="text-[13px] text-ink-muted">Devices and events per group · {range.label.toLowerCase()}</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/drive-vision/vehicles">
              All vehicles <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
        {groupsQ.error && !groupsQ.data ? (
          <Panel>
            <ApiErrorState error={groupsQ.error} onRetry={groupsQ.refetch} compact />
          </Panel>
        ) : !groupsQ.data || !devices ? (
          <Panel>
            <LoadingSkeleton variant="list" rows={3} />
          </Panel>
        ) : cards.length === 0 ? (
          <Panel>
            <EmptyState icon={Layers3} title="No groups yet" description="Groups you can access will appear here." />
          </Panel>
        ) : (
          <FleetGroups cards={cards} />
        )}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-4 @4xl:grid-cols-12">
        {modules.activity ? (
          <Panel aria-labelledby="activity-title" className="@4xl:col-span-7">
            <PanelHeader titleId="activity-title" title="Recent activity" description={`Latest AI events and routine alarms · ${range.label.toLowerCase()}`} />
            {aiQ.error && routineQ.error ? (
              <ApiErrorState
                error={aiQ.error}
                onRetry={() => {
                  aiQ.refetch();
                  routineQ.refetch();
                }}
                compact
              />
            ) : alarmsLoading || !alarms ? (
              <LoadingSkeleton variant="list" rows={5} />
            ) : (
              <LiveActivityList alarms={alarms} now={now} />
            )}
          </Panel>
        ) : null}
        <Panel aria-labelledby="ops-title" className="@4xl:col-span-5">
          <PanelHeader titleId="ops-title" title="Today's operations" description="Trips, dispatches and pending workforce items" />
          {dashQ.error && !dash ? <ApiErrorState error={dashQ.error} onRetry={dashQ.refetch} compact /> : !dash ? <LoadingSkeleton variant="list" rows={4} /> : <OperationsSnapshot trips={dash.trips} operations={dash.operations} />}
        </Panel>
        {modules.mileage ? (
          <Panel aria-labelledby="usage-title" className="@4xl:col-span-12">
            <PanelHeader titleId="usage-title" title="Daily trend" description={`Trips, distance and alarms per day · ${range.label.toLowerCase()}`} />
            {trendsQ.error && !trendsQ.data ? (
              <ApiErrorState error={trendsQ.error} onRetry={trendsQ.refetch} compact />
            ) : !trendsQ.data ? (
              <LoadingSkeleton variant="chart" className="h-[220px]" />
            ) : (
              <DailyTrendPanel rows={trendDays} />
            )}
          </Panel>
        ) : null}
      </div>

      {modules.quickLinks ? (
        <nav aria-label="Quick links" className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-3 @5xl:grid-cols-5">
          {QUICK_LINKS.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="group flex items-center gap-3 rounded-[18px] border border-line/60 bg-surface p-3 shadow-card transition-[box-shadow,transform,border-color] duration-[180ms] ease-dv hover:-translate-y-0.5 hover:border-line-strong hover:shadow-hover focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
            >
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", q.tone)}>
                <q.icon className="size-[18px] text-ink" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{q.label}</span>
                <span className="block truncate text-xs text-ink-muted">{q.hint}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-ink-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
