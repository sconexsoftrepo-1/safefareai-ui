"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, BusFront, Gauge, Loader2, Plus, RefreshCw, RotateCw, ScanLine, TriangleAlert, Users, Wine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { sensorService } from "@/features/drive-vision/api/sensor-service";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { AlcoholDetectionDto, BmsRowDto, ComparisonStopDto, SensorReadingDto, StopVisitDto } from "@/features/drive-vision/api/types";
import { useApiQuery, type ApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { useAccess, useActionGate } from "@/features/drive-vision/access/use-access";
import { canViewWidget } from "@/features/drive-vision/access/access-policy";
import { formatDateTime, formatNumber } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { MetricCard } from "../shared/metric-card";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { SlideOverPanel } from "../shared/slide-over-panel";
import { FormField, fieldA11y } from "../shared/form-field";
import { TenantRequiredButton } from "../shared/tenant-required";
import { toast } from "../shared/toast-provider";
import { dateToIstInput } from "../trips/track-model";
import {
  ALCOHOL_SENSOR_SUB_ID,
  IR_SENSOR_SUB_ID,
  alcoholMeta,
  describeSensorData,
  emptyReadingForm,
  noteText,
  readingBody,
  recalcBlock,
  resolveWindow,
  showCount,
  showPct,
  showSigned,
  statusMeta,
  validateReading,
  type ReadingField,
  type ReadingForm,
  type WindowPreset,
} from "./sensors-model";

type Tab = "comparison" | "stops" | "bms" | "readings";
const READINGS_PAGE_SIZE = 20;
const TABLE_PAGE_SIZE = 25;

function Status({ status }: { status?: string | null }) {
  const m = statusMeta(status);
  return (
    <StatusBadge size="sm" tone={m.tone}>
      {m.label}
    </StatusBadge>
  );
}

/** A count with its over-capacity excess ("47 +3"). Unknown counts show "—". */
function Count({ value, over, by }: { value?: number | null; over?: boolean; by?: number }) {
  return (
    <span className={cn("font-semibold tabular", over ? "text-danger" : "text-ink")}>
      {showCount(value)}
      {over && by ? <span className="ml-1 text-[11px] font-medium">+{by}</span> : null}
    </span>
  );
}

function Notes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {notes.map((n) => (
        <span key={n} title={noteText(n)} className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted">
          {n}
        </span>
      ))}
    </span>
  );
}

const plusMinus = (inn?: number | null, out?: number | null) => (
  <span className="tabular">
    <span className="text-success">+{showCount(inn)}</span> <span className="text-ink-subtle">/</span> <span className="text-danger">−{showCount(out)}</span>
  </span>
);

/**
 * Sensors (docs/contracts/passenger-counting-api.txt): choose a bus and a time window, then
 * GET /devices/{id}/sensors/alcohol (alcohol check card, docs/contracts/alcohol-detection-api.txt),
 * GET /devices/{id}/passenger-summary (cards), /stops/comparison (sensor vs BMS), /stops, /bms and
 * /sensors/readings (with GET /sensors/types). Writes: POST /sensors/readings (add a reading) and
 * POST /devices/{id}/stops/recalculate, each confirmed and reported after the server answers.
 */
export function SensorsPage() {
  const params = useSearchParams();
  const access = useAccess();
  const canPickBus = canViewWidget(access, "sensors.deviceChoices");
  const ingestGate = useActionGate("sensors.ingest");
  const recalcGate = useActionGate("sensors.recalculate");
  const [chosenId, setDeviceId] = useState<number | null>(() => (/^\d+$/.test(params.get("device") ?? "") ? Number(params.get("device")) : null));
  const [preset, setPreset] = useState<WindowPreset>("24h");
  const [custom, setCustom] = useState(() => ({ from: dateToIstInput(new Date(Date.now() - 86_400_000)), to: dateToIstInput(new Date()) }));
  // "Now" for relative presets; Refresh moves it forward so "Last 24 hours" really is the last 24 hours.
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>("comparison");
  const [sensorSubId, setSensorSubId] = useState("all");
  const [readingsPage, setReadingsPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const devicesQ = useApiQuery(canPickBus ? "sensors:devices" : null, () => fleetService.listAllDevices());
  const typesQ = useApiQuery("sensors:types", () => sensorService.sensorTypes());
  const devices = useMemo(() => [...(devicesQ.data?.items ?? [])].filter((d) => typeof d.id === "number").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), [devicesQ.data]);
  // The chosen bus, else the first one, so the screen opens with data.
  const deviceId = chosenId ?? devices[0]?.id ?? null;

  const resolved = useMemo(() => resolveWindow(preset, custom, now), [preset, custom, now]);
  const win = resolved.window;
  const key = deviceId !== null && win ? `${deviceId}:${win.fromUtc}:${win.toUtc}` : null;
  const summaryQ = useApiQuery(key ? `sensors:summary:${key}` : null, () => sensorService.passengerSummary(deviceId!, win!));
  const comparisonQ = useApiQuery(key && tab === "comparison" ? `sensors:comparison:${key}` : null, () => sensorService.comparison(deviceId!, win!));
  const stopsQ = useApiQuery(key && tab === "stops" ? `sensors:stops:${key}` : null, () => sensorService.stops(deviceId!, win!));
  const bmsQ = useApiQuery(key && tab === "bms" ? `sensors:bms:${key}` : null, () => sensorService.bms(deviceId!, win!));
  const readingsQ = useApiQuery(key && tab === "readings" ? `sensors:readings:${key}:${sensorSubId}:${readingsPage}` : null, () =>
    sensorService.readings(deviceId!, { ...win!, sensorSubId: sensorSubId === "all" ? undefined : Number(sensorSubId), pageNumber: readingsPage, pageSize: READINGS_PAGE_SIZE })
  );
  const activeQ = { comparison: comparisonQ, stops: stopsQ, bms: bmsQ, readings: readingsQ }[tab];
  const alcoholQ = useApiQuery(key ? `sensors:alcohol:${key}` : null, () => sensorService.alcohol(deviceId!, win!));

  function refreshAll() {
    if (preset === "custom") {
      summaryQ.refetch();
      alcoholQ.refetch();
      activeQ.refetch();
    } else setNow(new Date());
  }

  const s = summaryQ.data;
  const bus = devices.find((d) => d.id === deviceId);
  const capacityNote = s ? `${s.capacitySource === "VEHICLE" ? "From the vehicle" : "Default"}${s.truncated ? " · window truncated" : ""}` : undefined;
  const truncated = (tab === "comparison" && comparisonQ.data?.truncated) || (tab === "stops" && stopsQ.data?.truncated) || (tab === "bms" && bmsQ.data?.truncated);

  const comparisonColumns: DataTableColumn<ComparisonStopDto>[] = [
    { id: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap tabular">{r.stopVisitTime ? formatDateTime(r.stopVisitTime) : "—"}</span> },
    {
      id: "stop",
      header: "Stop",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.stopName ?? `Stop ${r.stopId ?? "?"}`}</p>
          <p className="text-xs text-ink-muted">Seq {showCount(r.bms?.stopSequence)}</p>
        </div>
      ),
    },
    { id: "bmsMoves", header: "BMS in / out", hideBelow: "md", cell: (r) => (r.bms ? plusMinus(r.bms.boarded, r.bms.alighted) : <span className="text-ink-subtle">—</span>) },
    { id: "actual", header: "Actual", align: "right", cell: (r) => <Count value={r.bms?.actualCount} over={r.capacity?.actualOverCapacity} by={r.capacity?.actualOverCapacityBy} /> },
    { id: "sensorMoves", header: "Sensor in / out", hideBelow: "md", cell: (r) => (r.sensor ? plusMinus(r.sensor.boarded, r.sensor.alighted) : <span className="text-ink-subtle">—</span>) },
    { id: "sensor", header: "Sensor", align: "right", cell: (r) => <Count value={r.sensor?.sensorCount} over={r.capacity?.sensorOverCapacity} by={r.capacity?.sensorOverCapacityBy} /> },
    { id: "diff", header: "Difference", align: "right", cell: (r) => <span className={cn("tabular", r.difference?.count ? "font-semibold text-warning" : "")}>{showSigned(r.difference?.count)}</span> },
    { id: "status", header: "Status", cell: (r) => <Status status={r.comparisonStatus ?? r.status} /> },
    { id: "notes", header: "Notes", hideBelow: "lg", cell: (r) => <Notes notes={r.notes} /> },
  ];

  const stopColumns: DataTableColumn<StopVisitDto>[] = [
    { id: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap tabular">{r.stopVisitTime ? formatDateTime(r.stopVisitTime) : "—"}</span> },
    { id: "stop", header: "Stop", cell: (r) => <span className="font-medium">{r.stopName ?? `Stop ${r.stopId ?? "?"}`}</span> },
    { id: "seq", header: "Seq", align: "right", hideBelow: "md", cell: (r) => showCount(r.bmsStopSequence) },
    { id: "bms", header: "BMS in / out", hideBelow: "md", cell: (r) => plusMinus(r.bmsBoarded, r.bmsAlighted) },
    { id: "actual", header: "Actual", align: "right", cell: (r) => <Count value={r.actualCount} over={r.actualOverCapacity} by={r.actualOverCapacityBy} /> },
    { id: "sensorMoves", header: "Sensor in / out", hideBelow: "md", cell: (r) => plusMinus(r.sensorBoarded, r.sensorAlighted) },
    { id: "sensor", header: "Sensor", align: "right", cell: (r) => <Count value={r.sensorCount} over={r.sensorOverCapacity} by={r.sensorOverCapacityBy} /> },
    { id: "reported", header: "Sensor reported", align: "right", hideBelow: "lg", cell: (r) => <span className="text-ink-muted tabular">{showCount(r.countOfPeople)}</span> },
    { id: "diff", header: "Difference", align: "right", cell: (r) => <span className={cn("tabular", r.difference ? "font-semibold text-warning" : "")}>{showSigned(r.difference)}</span> },
    { id: "status", header: "Status", cell: (r) => <Status status={r.comparisonStatus} /> },
    { id: "notes", header: "Notes", hideBelow: "xl", cell: (r) => <Notes notes={r.notes} /> },
  ];

  const bmsColumns: DataTableColumn<BmsRowDto>[] = [
    { id: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap tabular">{r.stopVisitTime ? formatDateTime(r.stopVisitTime) : "—"}</span> },
    { id: "stop", header: "Stop", cell: (r) => <span className="font-medium">{r.stopName ?? `Stop ${r.stopId ?? "?"}`}</span> },
    { id: "seq", header: "Seq", align: "right", cell: (r) => showCount(r.stopSequence) },
    { id: "in", header: "Boarded", align: "right", cell: (r) => <span className="text-success tabular">{showCount(r.passengersBoarded)}</span> },
    { id: "out", header: "Alighted", align: "right", cell: (r) => <span className="text-danger tabular">{showCount(r.passengersAlighted)}</span> },
    { id: "count", header: "On board (BMS)", align: "right", cell: (r) => <span className="font-semibold tabular">{showCount(r.passengerCount)}</span> },
    { id: "id", header: "BMS id", hideBelow: "md", cell: (r) => <span className="font-mono text-xs text-ink-muted">{r.bmsId ?? "—"}</span> },
  ];

  const readingColumns: DataTableColumn<SensorReadingDto>[] = [
    { id: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap tabular">{r.timestamp ? formatDateTime(r.timestamp) : "—"}</span> },
    { id: "sensor", header: "Sensor", cell: (r) => <span className="font-mono text-[12.5px]">{r.sensorId ?? "—"}</span> },
    { id: "type", header: "Type", cell: (r) => r.sensorName ?? (r.sensorSubId !== undefined ? `Type ${r.sensorSubId}` : "—") },
    { id: "data", header: "Data", cell: (r) => <span className="text-[12.5px]">{describeSensorData(r.sensorData)}</span> },
    { id: "value", header: "Value", align: "right", hideBelow: "md", cell: (r) => showCount(r.numericValue) },
    {
      id: "active",
      header: "Active",
      cell: (r) => (
        <StatusBadge size="sm" tone={r.activeStatus === false ? "neutral" : "success"}>
          {r.activeStatus === false ? "Inactive" : "Active"}
        </StatusBadge>
      ),
    },
  ];

  const recalcWhy = recalcBlock(win);

  return (
    <div>
      <PageHeader
        title="Sensors"
        description={bus ? `${bus.name ?? `Device ${bus.id}`}${bus.terminalNo ? ` · ${bus.terminalNo}` : ""}${s?.lastUpdatedAt ? ` · last data ${formatDateTime(s.lastUpdatedAt)}` : ""}` : "Choose a bus"}
        actions={
          <>
            <Button variant="outline" onClick={refreshAll} disabled={deviceId === null || summaryQ.loading}>
              <RefreshCw className={summaryQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            {recalcGate.allowed ? (
              <Button variant="outline" onClick={() => setRecalculating(true)} disabled={deviceId === null || recalcWhy !== null} title={recalcWhy ?? undefined}>
                <RotateCw /> Recalculate
              </Button>
            ) : null}
            {ingestGate.allowed ? (
              <Button onClick={() => setAdding(true)} disabled={deviceId === null}>
                <Plus /> Add reading
              </Button>
            ) : ingestGate.tenantBlocked ? (
              <TenantRequiredButton label="Add reading" />
            ) : null}
          </>
        }
      />

      <Panel className="mb-4 p-4">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:flex-wrap @3xl:items-end">
          <FormField id="sn-bus" label="Bus" className="@3xl:w-72">
            {!canPickBus ? (
              <p className="text-xs text-ink-muted">Choosing a bus needs device.read.</p>
            ) : devicesQ.error ? (
              <p className="text-xs text-danger">{describeApiError(devicesQ.error)}</p>
            ) : (
              <Select value={deviceId !== null ? String(deviceId) : ""} onValueChange={(v) => (setDeviceId(Number(v)), setReadingsPage(1))} disabled={!devicesQ.data}>
                <SelectTrigger id="sn-bus" className="h-10 w-full">
                  <SelectValue placeholder={devicesQ.data ? "Choose a bus" : "Loading buses…"} />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name ?? `Device ${d.id}`}
                      {d.terminalNo ? <span className="ml-1.5 font-mono text-[11px] text-ink-muted">{d.terminalNo}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-ink">Time window (IST)</p>
            <SegmentedControl
              label="Time window"
              value={preset}
              onChange={(p) => (setPreset(p), setNow(new Date()), setReadingsPage(1))}
              options={[
                { value: "24h", label: "Last 24 h" },
                { value: "today", label: "Today" },
                { value: "yesterday", label: "Yesterday" },
                { value: "7d", label: "7 days" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </div>
          {preset === "custom" ? (
            <div className="flex flex-wrap items-end gap-2">
              <FormField id="sn-from" label="From">
                <Input id="sn-from" type="datetime-local" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </FormField>
              <FormField id="sn-to" label="To">
                <Input id="sn-to" type="datetime-local" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </FormField>
            </div>
          ) : null}
        </div>
        {resolved.error ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {resolved.error}
          </p>
        ) : null}
      </Panel>

      {deviceId === null ? (
        <Panel>
          <EmptyState icon={BusFront} title="Choose a bus" description="Pick a bus to see its passenger counts." />
        </Panel>
      ) : (
        <>
          <AlcoholCard query={alcoholQ} />
          {summaryQ.error && !s ? (
            <Panel className="mb-4">
              <ApiErrorState error={summaryQ.error} onRetry={summaryQ.refetch} compact />
            </Panel>
          ) : (
            <section aria-label="Passenger summary" className="mb-4 grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-6">
              <MetricCard index={0} tone="featured" label="Bus capacity" value={s ? formatNumber(s.busCapacity ?? 0) : "—"} sublabel={capacityNote} icon={BusFront} />
              <MetricCard
                index={1}
                tone="muted"
                accent="sky"
                label="On board · BMS"
                value={<span className={cn(s?.actualOverCapacity && "text-danger")}>{showCount(s?.latestActualCount)}</span>}
                sublabel={s?.actualOverCapacity ? `Over capacity by ${s.actualOverCapacityBy}` : s?.latestActualAt ? formatDateTime(s.latestActualAt) : "No count"}
                icon={Users}
              />
              <MetricCard
                index={2}
                tone="muted"
                accent="lavender"
                label="On board · sensor"
                value={<span className={cn(s?.sensorOverCapacity && "text-danger")}>{showCount(s?.latestSensorCount)}</span>}
                sublabel={s?.sensorOverCapacity ? `Over capacity by ${s.sensorOverCapacityBy}` : s?.latestSensorAt ? formatDateTime(s.latestSensorAt) : "No count"}
                icon={ScanLine}
              />
              <MetricCard index={3} tone="muted" accent="peach" label="Latest difference" value={showSigned(s?.latestDifference)} sublabel={s?.latestComparedAt ? formatDateTime(s.latestComparedAt) : "Sensor − BMS"} icon={Activity} />
              <MetricCard index={4} tone="muted" accent="mint" label="Match rate" value={showPct(s?.matchRatePct)} sublabel={s ? `${s.matchedStops ?? 0} of ${s.comparedStops ?? 0} compared stops` : undefined} icon={Gauge} />
              <MetricCard
                index={5}
                tone="muted"
                accent="brand"
                label="Over-capacity stops"
                value={s ? formatNumber(s.overCapacityStops ?? 0) : "—"}
                sublabel={s ? `${s.totalStops ?? 0} stops · max ${showCount(s.maximumActualPassengerCount)} BMS / ${showCount(s.maximumSensorPassengerCount)} sensor` : undefined}
                icon={TriangleAlert}
              />
            </section>
          )}
          {s && (s.missingBmsStops || s.missingSensorStops || s.mismatchedStops) ? (
            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              <StatusBadge size="sm" tone="warning">
                {s.mismatchedStops ?? 0} mismatched
              </StatusBadge>
              <StatusBadge size="sm" tone="neutral">
                {s.missingBmsStops ?? 0} without BMS
              </StatusBadge>
              <StatusBadge size="sm" tone="neutral">
                {s.missingSensorStops ?? 0} without sensor count
              </StatusBadge>
            </div>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="View"
              value={tab}
              onChange={setTab}
              options={[
                { value: "comparison", label: "Sensor vs BMS" },
                { value: "stops", label: "Stops" },
                { value: "bms", label: "BMS records" },
                { value: "readings", label: "Sensor readings" },
              ]}
            />
            {tab === "readings" ? (
              <FilterBar>
                <FilterSelect
                  label="Sensor type"
                  value={sensorSubId}
                  onChange={(v: string) => (setSensorSubId(v), setReadingsPage(1))}
                  options={[{ value: "all", label: "All sensors" }, ...(typesQ.data?.items ?? []).filter((t) => t.sensorSubId !== undefined).map((t) => ({ value: String(t.sensorSubId), label: t.sensorName ?? `Type ${t.sensorSubId}` }))]}
                />
              </FilterBar>
            ) : null}
          </div>

          {tab === "comparison" && comparisonQ.data?.summary ? <ComparisonStrip summary={comparisonQ.data.summary} /> : null}
          {truncated ? (
            <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning" role="status">
              Only the first 1000 rows are shown — narrow the time window.
            </p>
          ) : null}

          <Panel className="overflow-hidden">
            {activeQ.error && !activeQ.data ? (
              <ApiErrorState error={activeQ.error} onRetry={activeQ.refetch} />
            ) : !activeQ.data ? (
              <LoadingSkeleton variant="table" rows={8} />
            ) : tab === "comparison" ? (
              <DataTable caption="Sensor vs BMS by stop" data={comparisonQ.data?.stops ?? []} columns={comparisonColumns} getRowId={(r) => `${r.stopId}-${r.stopVisitTime}`} pageSize={TABLE_PAGE_SIZE} isLoading={comparisonQ.refreshing} emptyTitle="No stops in this window" emptyDescription="Try a wider time window." />
            ) : tab === "stops" ? (
              <DataTable caption="Stop-wise passenger counts" data={stopsQ.data?.stops ?? []} columns={stopColumns} getRowId={(r) => `${r.stopId}-${r.stopVisitTime}`} pageSize={TABLE_PAGE_SIZE} isLoading={stopsQ.refreshing} emptyTitle="No stops in this window" emptyDescription="Try a wider time window." />
            ) : tab === "bms" ? (
              <DataTable caption="BMS records" data={bmsQ.data?.rows ?? []} columns={bmsColumns} getRowId={(r) => String(r.bmsId ?? `${r.stopId}-${r.stopVisitTime}`)} pageSize={TABLE_PAGE_SIZE} isLoading={bmsQ.refreshing} emptyTitle="No BMS records" emptyDescription="No BMS records in this window." />
            ) : (
              <DataTable
                caption="Sensor readings"
                data={readingsQ.data?.items ?? []}
                columns={readingColumns}
                getRowId={(r) => `${r.sensorId}-${r.timestamp}-${r.sensorSubId}`}
                pageSize={READINGS_PAGE_SIZE}
                isLoading={readingsQ.refreshing}
                serverPagination={{ page: readingsPage, total: readingsQ.data?.total ?? 0, onPageChange: setReadingsPage }}
                emptyTitle="No readings"
                emptyDescription="No sensor readings in this window."
              />
            )}
          </Panel>
        </>
      )}

      {adding && deviceId !== null ? (
        <AddReadingPanel
          deviceId={deviceId}
          busName={bus?.name ?? `Device ${deviceId}`}
          types={(typesQ.data?.items ?? []).filter((t) => t.sensorSubId !== undefined).map((t) => ({ id: t.sensorSubId!, name: t.sensorName ?? `Type ${t.sensorSubId}` }))}
          onClose={() => setAdding(false)}
          onSaved={() => (setAdding(false), refreshAll())}
        />
      ) : null}

      <ConfirmDialog
        open={recalculating}
        onOpenChange={setRecalculating}
        tone="default"
        title={`Recalculate stops for ${bus?.name ?? "this bus"}?`}
        description="Rebuilds stop visits from GPS and raises any new over-capacity or mismatch alerts for the selected window. Running it again changes nothing."
        confirmLabel="Recalculate"
        onConfirm={async () => {
          try {
            const r = await sensorService.recalculate(deviceId!, win!);
            toast.success("Stops recalculated", { description: `${r.stopVisitsUpdated ?? 0} stop visits updated · ${r.passengerAlerts ?? 0} passenger alerts` });
            refreshAll();
          } catch (err) {
            toast.error("The server refused the recalculation", { description: describeApiError(err) });
            throw err;
          }
        }}
      />
    </div>
  );
}

/** Latest alcohol test of the bus in the window (GET /devices/{id}/sensors/alcohol). */
function AlcoholCard({ query }: { query: ApiQuery<AlcoholDetectionDto> }) {
  const a = query.data;
  const meta = alcoholMeta(a?.detectionStatus);
  const detected = a?.detectionStatus === "DETECTED";
  return (
    <Panel className={cn("mb-4 p-4", detected && "border-danger/40 bg-danger-soft/40")} data-testid="alcohol-card">
      {query.error && !a ? (
        <ApiErrorState error={query.error} onRetry={query.refetch} compact title="Couldn't load the alcohol check" />
      ) : !a ? (
        <LoadingSkeleton variant="list" rows={1} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", detected ? "bg-danger text-white" : "bg-surface-sunken text-ink-muted")} aria-hidden>
            <Wine className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-ink-muted">Alcohol check · latest reading</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
              <span className="text-[13px] text-ink-muted">{meta.detail}</span>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <div>
              <dt className="text-xs text-ink-muted">Time</dt>
              <dd className="font-medium tabular">{a.timestamp ? formatDateTime(a.timestamp) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Sensor</dt>
              <dd className="font-mono">{a.sensorId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Value</dt>
              <dd className="font-mono">{a.sensorData ?? "—"}</dd>
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}

function ComparisonStrip({ summary: m }: { summary: NonNullable<import("@/features/drive-vision/api/types").StopComparisonDto["summary"]> }) {
  const items: [string, string][] = [
    ["Stops", showCount(m.visits)],
    ["Compared", showCount(m.compared)],
    ["Exact matches", showCount(m.exactMatches)],
    ["Mismatches", showCount(m.mismatches)],
    ["Match rate", showPct(m.matchRatePct)],
    ["Mean abs. error", typeof m.meanAbsoluteError === "number" ? String(Math.round(m.meanAbsoluteError * 100) / 100) : "—"],
    ["Max abs. error", showCount(m.maxAbsoluteError)],
    ["Boarded BMS / sensor", `${showCount(m.bmsTotalBoarded)} / ${showCount(m.sensorTotalBoarded)}`],
    ["Alighted BMS / sensor", `${showCount(m.bmsTotalAlighted)} / ${showCount(m.sensorTotalAlighted)}`],
  ];
  return (
    <dl className="mb-3 grid grid-cols-2 gap-2 rounded-card border border-line/70 bg-surface p-3 text-xs shadow-card @2xl:grid-cols-3 @5xl:grid-cols-9" data-testid="comparison-summary">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-inner bg-surface-muted px-3 py-2">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold text-ink tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const READING_FIELDS: ReadingField[] = ["sensorSubId", "sensorId", "time", "inCount", "outCount", "count", "data"];

function AddReadingPanel({ deviceId, busName, types, onClose, onSaved }: { deviceId: number; busName: string; types: { id: number; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ReadingForm>(() => emptyReadingForm(new Date()));
  const [errors, setErrors] = useState<Partial<Record<ReadingField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ir = Number(form.sensorSubId) === IR_SENSOR_SUB_ID;
  const set = (patch: Partial<ReadingForm>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validateReading(form, new Date());
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const r = await sensorService.sendReadings([readingBody(form, deviceId)]);
      if (r.duplicates) toast.info("Reading already stored", { description: "An identical reading exists; nothing was counted twice." });
      else toast.success("Reading saved", { description: r.passengerAlerts ? `${r.passengerAlerts} passenger alert${r.passengerAlerts === 1 ? "" : "s"} raised` : undefined });
      onSaved();
    } catch (err) {
      const map = isApiError(err) ? err.fieldErrorMap() : {};
      const known: Partial<Record<ReadingField, string>> = {};
      for (const f of READING_FIELDS) if (map[f]) known[f] = map[f];
      if (map.sensorData) known[ir ? "count" : "data"] = map.sensorData;
      if (map.timestamp) known.time = map.timestamp;
      setErrors(known);
      setFailure(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const num = (f: "inCount" | "outCount" | "count", label: string) => (
    <FormField id={`rd-${f}`} label={label} error={errors[f]} required>
      <Input {...fieldA11y(`rd-${f}`, errors[f])} inputMode="numeric" value={form[f]} onChange={(e) => set({ [f]: e.target.value })} />
    </FormField>
  );

  return (
    <SlideOverPanel
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Add sensor reading"
      description={busName}
      width="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="reading-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save reading
          </Button>
        </div>
      }
    >
      <form id="reading-form" className="space-y-3" onSubmit={submit} noValidate>
        {failure ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
        <FormField id="rd-type" label="Sensor type" error={errors.sensorSubId} required>
          <Select value={form.sensorSubId} onValueChange={(v) => set({ sensorSubId: v })}>
            <SelectTrigger id="rd-type" className="w-full">
              <SelectValue placeholder="Choose a sensor type" />
            </SelectTrigger>
            <SelectContent>
              {(types.length
                ? types
                : [
                    { id: IR_SENSOR_SUB_ID, name: "IR Sensor" },
                    { id: ALCOHOL_SENSOR_SUB_ID, name: "Alcohol Sensor" },
                  ]
              ).map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="rd-sensor" label="Sensor ID" error={errors.sensorId} required>
          <Input {...fieldA11y("rd-sensor", errors.sensorId)} placeholder="IR-01" maxLength={100} value={form.sensorId} onChange={(e) => set({ sensorId: e.target.value })} />
        </FormField>
        <FormField id="rd-time" label="Time (IST)" error={errors.time} required>
          <Input {...fieldA11y("rd-time", errors.time)} type="datetime-local" value={form.time} onChange={(e) => set({ time: e.target.value })} />
        </FormField>
        {ir ? (
          <div className="grid grid-cols-3 gap-3">
            {num("inCount", "In")}
            {num("outCount", "Out")}
            {num("count", "On board")}
          </div>
        ) : Number(form.sensorSubId) === ALCOHOL_SENSOR_SUB_ID ? (
          <FormField id="rd-alcohol" label="Result" error={errors.data} required>
            <Select value={form.data} onValueChange={(v) => set({ data: v })}>
              <SelectTrigger id="rd-alcohol" className="w-full">
                <SelectValue placeholder="Choose a result" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Alcohol detected (1)</SelectItem>
                <SelectItem value="0">Not detected (0)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <FormField id="rd-data" label="Data" error={errors.data} required>
            <Input {...fieldA11y("rd-data", errors.data)} maxLength={500} placeholder="SMOKE_DETECTED" value={form.data} onChange={(e) => set({ data: e.target.value })} />
          </FormField>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={form.active} onCheckedChange={(v) => set({ active: v === true })} /> Active reading
        </label>
      </form>
    </SlideOverPanel>
  );
}
