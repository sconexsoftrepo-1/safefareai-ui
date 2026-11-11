"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BellRing, CircleHelp, Cigarette, Clock, Loader2, Radar, RefreshCw, ScanLine, ShieldCheck, Timer, Wine, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SENSOR_ALERTS_DEFAULTS, type SensorAlertsResponse } from "@/features/drive-vision/api/sensor-alerts";
import type { ApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { Panel } from "../shared/panel";
import { SearchInput, SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { StatusBadge, type Tone } from "../shared/status-badge";
import {
  DEFAULT_QUERY_FILTERS,
  alertSummary,
  filterByVehicle,
  formatDuration,
  formatIstTimestamp,
  interpretAll,
  latestAlert,
  readDateRange,
  toDateTimeInput,
  type AlertQueryFilters,
  type AlertStatus,
  type SensorAlertView,
  type SensorCount,
  type SummaryType,
} from "./sensor-alerts-model";

/** What the Vehicle dropdown currently asks the Sensor Alerts tab to show. */
export type SensorAlertsScope =
  | { kind: "vehicle"; vehicleNumber: string; busName: string }
  | { kind: "all" }
  | { kind: "resolving"; busName: string }
  | { kind: "no-registration"; busName: string }
  | { kind: "lookup-failed"; busName: string; error: unknown; retry: () => void }
  | { kind: "lookup-forbidden"; busName: string };

/** Cards shown per "Show more" step. */
const PAGE = 30;

type StyleKey = "ULT" | "SMK" | "ALC" | "IRPRS" | "UNKNOWN";
/** Sensor colours: ULT blue, SMK amber, ALC purple; IR and PRS keep the generic style they had; unknown is neutral. */
const KIND_STYLE: Record<StyleKey, { icon: LucideIcon; chip: string; edge: string; tone: Tone }> = {
  ULT: { icon: Radar, chip: "bg-powder text-info", edge: "border-l-info", tone: "info" },
  SMK: { icon: Cigarette, chip: "bg-warning-soft text-warning", edge: "border-l-warning", tone: "warning" },
  ALC: { icon: Wine, chip: "bg-lavender text-ai-ink", edge: "border-l-ai-ink", tone: "lavender" },
  IRPRS: { icon: CircleHelp, chip: "bg-surface-sunken text-ink-muted", edge: "border-l-serious", tone: "serious" },
  UNKNOWN: { icon: CircleHelp, chip: "bg-surface-sunken text-ink-muted", edge: "border-l-line-strong", tone: "neutral" },
};
const styleKey = (v: Pick<SensorAlertView, "kind" | "code">): StyleKey => v.kind ?? (v.code === "IR" || v.code === "PRS" ? "IRPRS" : "UNKNOWN");
const styleOf = (v: Pick<SensorAlertView, "kind" | "code">) => KIND_STYLE[styleKey(v)];

const STATUS_TONE: Record<AlertStatus, Tone> = { ongoing: "serious", ended_gap: "info", ended: "neutral", unknown: "neutral" };
const READING_TONE: Record<NonNullable<SensorAlertView["readingTone"]>, Tone> = { success: "success", warning: "warning", neutral: "neutral" };
const READING_LABEL: Record<NonNullable<SensorAlertView["reading"]>, string> = { safe: "Safe", warning: "Warning", no_echo: "No echo" };

/** "Ultrasonic Sensor · ULT · Sub-ID 2", or "Sensor · XYZ" for an unknown type. */
const sensorLine = (v: SensorAlertView) => [v.sensorName ?? "Sensor", v.code, v.subId !== null ? `Sub-ID ${v.subId}` : null].filter(Boolean).join(" · ");

// The load time is an epoch (this browser's clock), so it is converted to IST here. Alert timestamps are not: they
// are already IST and are formatted from their own digits (formatIstTimestamp).
const istClock = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

const SENSOR_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All sensors" },
  { value: "1", label: "IR" },
  { value: "2", label: "Ultrasonic" },
  { value: "3", label: "Smoke" },
  { value: "4", label: "Alcohol" },
  { value: "5", label: "PRS" },
];

export function SensorAlertsPanel({
  scope,
  query,
  onRetry,
  filters = DEFAULT_QUERY_FILTERS,
  onFiltersChange = () => {},
}: {
  scope: SensorAlertsScope;
  query: ApiQuery<SensorAlertsResponse>;
  onRetry: () => void;
  /** Server-side filters of the current request (sensor, date range). */
  filters?: AlertQueryFilters;
  onFiltersChange?: (next: AlertQueryFilters) => void;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [fromInput, setFromInput] = useState(() => toDateTimeInput(filters.fromTime));
  const [toInput, setToInput] = useState(() => toDateTimeInput(filters.toTime));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const data = query.data;
  const all = useMemo(() => interpretAll(data?.alerts ?? []), [data]);
  const searching = scope.kind === "all" && search.trim() !== "";
  const shown = useMemo(() => (searching ? filterByVehicle(all, search) : all), [all, search, searching]);
  const summary = useMemo(() => alertSummary(shown, data, searching), [shown, data, searching]);
  const latest = latestAlert(shown);
  const rangeApplied = filters.fromTime !== null || filters.toTime !== null;
  const scopeText = scope.kind === "all" ? "All vehicles" : scope.kind === "vehicle" ? scope.vehicleNumber : scope.busName;
  const ready = scope.kind === "all" || scope.kind === "vehicle";

  function apply(e?: FormEvent) {
    e?.preventDefault();
    const range = readDateRange(fromInput, toInput);
    if (!range.ok) return setRangeError(range.error);
    setRangeError(null);
    setLimit(PAGE);
    onFiltersChange({ ...filters, fromTime: range.fromTime, toTime: range.toTime });
  }
  function clearRange() {
    setFromInput("");
    setToInput("");
    setRangeError(null);
    setLimit(PAGE);
    // The sensor and the vehicle stay as chosen; only the date range is removed.
    if (rangeApplied) onFiltersChange({ ...filters, fromTime: null, toTime: null });
  }

  return (
    <section aria-labelledby="sensor-alerts-title" data-testid="sensor-alerts">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="sensor-alerts-title" className="flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
            Sensor alerts
            <span className="rounded-full bg-powder px-2.5 py-0.5 text-[13px] font-semibold text-ink tabular" data-testid="sensor-alerts-scope">
              {scopeText}
            </span>
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">How long each sensor stayed active, for the selected vehicle or fleet.</p>
        </div>
        {data && query.updatedAt ? (
          <p className="flex items-center gap-1.5 text-xs text-ink-muted" role="status">
            {query.refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
            {query.refreshing ? "Refreshing…" : `Loaded ${istClock.format(query.updatedAt)} IST`}
          </p>
        ) : null}
      </div>

      {scope.kind === "resolving" ? (
        <Panel aria-busy="true">
          <LoadingSkeleton variant="list" rows={3} />
        </Panel>
      ) : scope.kind === "no-registration" ? (
        <Panel>
          <EmptyState icon={ScanLine} title="No registration number for this bus" description={`${scope.busName} isn't fitted to a vehicle in the vehicle registry, so its sensor alerts can't be looked up. Fit it to a vehicle, or choose All vehicles.`} />
        </Panel>
      ) : scope.kind === "lookup-forbidden" ? (
        <Panel>
          <EmptyState icon={ScanLine} title="Registration number not available" description="Looking up a bus's registration number needs access to the vehicle registry (vehicle.read). Choose All vehicles to see every alert you can access." />
        </Panel>
      ) : scope.kind === "lookup-failed" ? (
        <Panel>
          <ApiErrorState error={scope.error} onRetry={scope.retry} title="Couldn't look up this bus's registration number" />
        </Panel>
      ) : null}

      {ready ? (
        <>
          <Panel className="mb-4 p-3" aria-label="Sensor alert filters" data-testid="sensor-alert-filters">
            <form className="flex flex-col gap-2.5 @4xl:flex-row @4xl:flex-wrap @4xl:items-end" onSubmit={apply} noValidate>
              <SegmentedControl<string>
                label="Sensor"
                size="sm"
                className="flex-wrap"
                value={filters.sensorSubId === null ? "all" : String(filters.sensorSubId)}
                onChange={(v) => (setLimit(PAGE), onFiltersChange({ ...filters, sensorSubId: v === "all" ? null : Number(v) }))}
                options={SENSOR_OPTIONS}
              />
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-muted">
                From (IST)
                <Input type="datetime-local" step={1} value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="h-9" data-testid="sensor-alert-from" aria-invalid={rangeError ? true : undefined} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-muted">
                To (IST)
                <Input type="datetime-local" step={1} value={toInput} onChange={(e) => setToInput(e.target.value)} className="h-9" data-testid="sensor-alert-to" aria-invalid={rangeError ? true : undefined} />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={query.loading} data-testid="sensor-alert-apply">
                  Apply filters
                </Button>
                {rangeApplied || fromInput || toInput ? (
                  <Button type="button" size="sm" variant="ghost" onClick={clearRange} data-testid="sensor-alert-clear">
                    <X /> Clear filters
                  </Button>
                ) : null}
              </div>
              {scope.kind === "all" ? <SearchInput className="@4xl:ml-auto @4xl:min-w-60" label="Search by registration" placeholder="Registration number" value={search} onChange={(v) => (setSearch(v), setLimit(PAGE))} /> : null}
            </form>
            {rangeError ? (
              <p className="mt-2 text-xs text-danger" role="alert" data-testid="sensor-alert-range-error">
                {rangeError}
              </p>
            ) : null}
            {data && !query.loading && rangeApplied ? (
              <p className="mt-2 text-xs text-ink-muted" data-testid="sensor-alert-range">
                Showing {filters.fromTime ? `from ${formatIstTimestamp(filters.fromTime)}` : "everything"} {filters.toTime ? `to ${formatIstTimestamp(filters.toTime)}` : "until now"}
              </p>
            ) : null}
          </Panel>

          {query.error && !data ? (
            <Panel>
              <ApiErrorState error={query.error} onRetry={onRetry} title="Couldn't load sensor alerts" />
            </Panel>
          ) : !data ? (
            <div aria-busy="true" data-testid="sensor-alerts-loading">
              <LoadingSkeleton variant="card" rows={6} className="mb-4" />
              <Panel>
                <LoadingSkeleton variant="list" rows={4} />
              </Panel>
            </div>
          ) : (
            <>
              {query.error ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-inner bg-warning-soft px-3 py-2 text-[13px] text-warning" role="alert" data-testid="sensor-alerts-stale">
                  <span>Couldn&apos;t refresh sensor alerts. Showing the alerts loaded {query.updatedAt ? `at ${istClock.format(query.updatedAt)} IST` : "earlier"}; they may be out of date.</span>
                  <Button size="sm" variant="outline" onClick={onRetry} disabled={query.refreshing}>
                    <RefreshCw className={query.refreshing ? "animate-spin" : undefined} /> Retry
                  </Button>
                </div>
              ) : null}

              <section aria-label="Sensor alert summary" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="sensor-alert-summary" data-source={summary.source}>
                <SummaryCard label="Total alerts" value={summary.total} note={searching ? `of ${all.length} loaded` : totalNote(summary.source, summary.total, all.length)} icon={BellRing} chip="bg-brand text-white" featured />
                {(["IR", "ULT", "SMK", "ALC", "PRS"] as SummaryType[]).map((t) => (
                  <SummaryCard key={t} label={SUMMARY_LABEL[t]} value={summary.byType[t].count} note={bucketNote(summary.byType[t])} icon={KIND_STYLE[t === "IR" || t === "PRS" ? "IRPRS" : t].icon} chip={KIND_STYLE[t === "IR" || t === "PRS" ? "IRPRS" : t].chip} type={t} />
                ))}
              </section>

              <LatestEvent view={latest} />

              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-ink">Recent sensor alerts</h3>
                {shown.length ? (
                  <p className="text-xs text-ink-muted" role="status">
                    {shown.length} record{shown.length === 1 ? "" : "s"} · newest first · gap {data.filters?.max_gap_seconds ?? SENSOR_ALERTS_DEFAULTS.maxGapSeconds} s
                  </p>
                ) : null}
              </div>

              {shown.length === 0 ? (
                <Panel>
                  <EmptyState
                    icon={BellRing}
                    title={all.length === 0 ? "No sensor alerts" : "No records match this registration"}
                    description={all.length === 0 ? (scope.kind === "vehicle" ? `The sensor service returned no records for ${scope.vehicleNumber} with these filters.` : "The sensor service returned no records with these filters.") : "Try another registration number."}
                  />
                </Panel>
              ) : (
                <>
                  <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Sensor alert history" data-testid="sensor-alert-grid">
                    {shown.slice(0, limit).map((v) => (
                      <li key={v.key} className="min-w-0">
                        <AlertCard view={v} />
                      </li>
                    ))}
                  </ul>
                  {shown.length > limit ? (
                    <div className="mt-3 flex justify-center">
                      <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                        Show more ({shown.length - limit} more record{shown.length - limit === 1 ? "" : "s"})
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

const SUMMARY_LABEL: Record<SummaryType, string> = { IR: "IR alerts", ULT: "Ultrasonic alerts", SMK: "Smoke alerts", ALC: "Alcohol alerts", PRS: "PRS alerts" };

function totalNote(source: "service" | "records", total: number, loaded: number): string {
  if (source === "records") return loaded ? "Counted from the records loaded" : "No records";
  return total !== loaded ? `${loaded} loaded · from the service summary` : "From the service summary";
}

const bucketNote = (c: SensorCount) => (c.seconds === null ? "Duration not reported" : `${formatDuration(c.seconds)} total`);

function SummaryCard({ label, value, note, icon: Icon, chip, featured = false, type }: { label: string; value: number; note: string; icon: LucideIcon; chip: string; featured?: boolean; type?: SummaryType }) {
  return (
    <div className={cn("min-w-0 rounded-card border p-3", featured ? "col-span-2 border-brand/35 bg-brand-tint shadow-brand-soft md:col-span-1" : "border-line bg-surface shadow-card")} data-testid="summary-card" data-label={label} data-type={type}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn("text-[13px] font-semibold", featured ? "text-brand-deep" : "text-ink-muted")}>{label}</p>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-control", chip)} aria-hidden>
          <Icon className="size-4" />
        </span>
      </div>
      <p className={cn("mt-0.5 text-2xl leading-tight font-bold tabular", featured ? "text-brand-deep" : "text-ink")} data-testid="summary-value">
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-ink-muted" data-testid="summary-note">
        {note}
      </p>
    </div>
  );
}

function StatusPill({ view, size = "sm" }: { view: SensorAlertView; size?: "sm" | "md" }) {
  return (
    <span data-testid="sensor-alert-status" data-status={view.status}>
      <StatusBadge size={size} tone={STATUS_TONE[view.status]}>
        {view.statusLabel}
      </StatusBadge>
    </span>
  );
}

/** ULT only: SAFE / WARNING / NO_ECHO as a badge. */
function ReadingBadge({ view }: { view: SensorAlertView }) {
  if (!view.reading || !view.readingTone) return null;
  return (
    <span data-testid="sensor-alert-reading" data-reading={view.reading}>
      <StatusBadge tone={READING_TONE[view.readingTone]}>{READING_LABEL[view.reading]}</StatusBadge>
    </span>
  );
}

function LatestEvent({ view }: { view: SensorAlertView | null }) {
  if (!view) {
    return (
      <Panel className="mb-4 flex items-center gap-3 p-3" data-testid="sensor-alert-latest">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-powder text-info" aria-hidden>
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-wide text-ink-muted uppercase">Latest sensor alert</p>
          <p className="text-[14px] font-semibold text-ink">No sensor alerts</p>
        </div>
      </Panel>
    );
  }
  const st = styleOf(view);
  const Icon = st.icon;
  return (
    <Panel className={cn("mb-4 border-l-[6px] p-3 @xl:p-4", st.edge)} data-testid="sensor-alert-latest">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", st.chip)} aria-hidden>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-[12px] font-semibold tracking-wide text-brand-deep uppercase">Latest sensor alert</p>
          <p className="text-lg font-bold break-words text-ink">
            {view.title}
            {view.distanceText ? <span className="ml-2 text-[15px] font-semibold text-brand-deep tabular">{view.distanceText}</span> : null}
          </p>
          <p className="text-[13px] break-words text-ink-muted">
            <span className="font-semibold text-ink tabular">{view.vehicle ?? "Vehicle not reported"}</span> · {sensorLine(view)}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 @xl:items-end">
          <span className="flex flex-wrap gap-1.5">
            <ReadingBadge view={view} />
            <StatusPill view={view} size="md" />
          </span>
          <p className="text-[13px] font-semibold text-ink tabular">{view.startedText ?? "Start time unavailable"}</p>
          <p className="text-xs text-ink-muted">Lasted {view.durationText}</p>
        </div>
      </div>
    </Panel>
  );
}

function Field({ label, children, wide = false, testId }: { label: string; children: ReactNode; wide?: boolean; testId?: string }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")} data-testid={testId}>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] break-words text-ink tabular">{children}</dd>
    </div>
  );
}

function AlertCard({ view }: { view: SensorAlertView }) {
  const st = styleOf(view);
  const Icon = st.icon;
  return (
    <article className={cn("flex h-full min-w-0 flex-col gap-2 rounded-inner border border-l-4 border-line bg-surface p-3", st.edge)} data-testid="sensor-alert-card" data-sensor={view.code} data-style={styleKey(view)} data-status={view.status}>
      <header className="flex items-start gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", st.chip)} aria-hidden>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-semibold break-words text-ink" data-testid="sensor-alert-title">
            {view.title}
          </p>
          <p className="text-xs text-ink-muted" data-testid="sensor-alert-sensor">
            {sensorLine(view)}
          </p>
        </div>
        <StatusPill view={view} />
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-[15px] font-bold text-ink tabular" data-testid="sensor-alert-duration">
          <Timer className="size-4 text-ink-muted" aria-hidden />
          {view.durationText}
        </p>
        <ReadingBadge view={view} />
        {view.distanceText ? (
          <span className="text-[13px] font-semibold text-brand-deep tabular" data-testid="sensor-alert-distance">
            {view.distanceText}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Field label="Started at (IST)" testId="sensor-alert-started">
          {view.startedText ? view.startedText.replace(/ IST$/, "") : "—"}
        </Field>
        <Field label="Ended at (IST)" testId="sensor-alert-ended">
          {view.endedText.replace(/ IST$/, "")}
        </Field>
        <Field label="Vehicle" testId="sensor-alert-vehicle">
          <span className="font-medium">{view.vehicle ?? "—"}</span>
        </Field>
        <Field label="IoT kit" testId="sensor-alert-kit">
          {view.iotKit ?? "—"}
        </Field>
        <Field label="Ended after inactivity gap" wide testId="sensor-alert-gap">
          {view.gapText}
        </Field>
      </dl>

      <div className="mt-auto min-w-0" data-testid="sensor-alert-data">
        <p className="text-[11px] text-ink-muted">Sensor data</p>
        <code className="block rounded-control bg-surface-muted px-2 py-1 font-mono text-xs break-all text-ink">{view.sensorData ?? "—"}</code>
      </div>
    </article>
  );
}
