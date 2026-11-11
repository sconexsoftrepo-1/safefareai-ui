"use client";

import { Suspense, lazy, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, BellRing, BusFront, Gauge, Info, Loader2, Plus, RefreshCw, RotateCw, ScanLine, TriangleAlert, Users, Wine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { sensorService } from "@/features/drive-vision/api/sensor-service";
import { sensorAlertsService } from "@/features/drive-vision/api/sensor-alerts-service";
import { cleanVehicleNumber } from "@/features/drive-vision/api/sensor-alerts";
import { vehicleRegistryService } from "@/features/drive-vision/api/vehicle-registry-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { AlcoholDetectionDto, ComparisonStopDto, SensorReadingDto, StopVisitDto } from "@/features/drive-vision/api/types";
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
import { SensorAlertsPanel, type SensorAlertsScope } from "./sensor-alerts-panel";
import { SENSORS_TABPANEL_ID, SensorsTabs, sensorsTabId } from "./sensors-tabs";
import { DEFAULT_QUERY_FILTERS, totalAlerts, type AlertQueryFilters } from "./sensor-alerts-model";
import {
  pickSensorVehicle,
  sensorVehicles,
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
import { DEMO_JOURNEY, demoDateLabel, passengerDemoEnabled, passengerDemoSource, type BmsTableRow } from "./passenger-demo";

// Demo-only charts: loaded when the demo journey shows them, so the live screen's code and imports are unchanged.
const PassengerDemoCharts = lazy(() => import("./passenger-demo-charts").then((m) => ({ default: m.PassengerDemoCharts })));

type Tab = "comparison" | "stops" | "bms" | "readings" | "alerts";
/** The Bus dropdown's "All vehicles" choice: Sensor Alerts for every vehicle; the per-bus views need a bus. */
const ALL_VEHICLES = "all";
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
 * Sensor Alerts tab (first and default): GET /api/sensors/alerts (same-origin proxy to the Python service) for the
 * chosen vehicle's number or, with "All vehicles", without one. It has no time window, so the window selector,
 * per-bus cards, Recalculate and Add reading belong to the four reconciliation tabs.
 * Vehicle picker: GET /api/v1/vehicles?assigned=true (vehicle.read) — only vehicles with a device. The vehicle's
 * device.id drives every /devices/{id}/… call; its vehicleNumber is Sensor Alerts' vehicle_number (sensors-model.ts).
 */
export function SensorsPage() {
  const params = useSearchParams();
  const access = useAccess();
  const canPickBus = canViewWidget(access, "sensors.deviceChoices");
  // Deep links: ?vehicle=<vehicle id>, or the older ?device=<device id> (matched to the vehicle that device is fitted in).
  const [link] = useState(() => ({ vehicleId: /^\d+$/.test(params.get("vehicle") ?? "") ? Number(params.get("vehicle")) : null, deviceId: /^\d+$/.test(params.get("device") ?? "") ? Number(params.get("device")) : null }));
  const ingestGate = useActionGate("sensors.ingest");
  const recalcGate = useActionGate("sensors.recalculate");
  // The chosen vehicle's id (never its device id), "all", or null = not chosen yet.
  const [chosenId, setVehicleId] = useState<number | typeof ALL_VEHICLES | null>(null);
  // Passenger Analytics sample journey (NEXT_PUBLIC_PASSENGER_DEMO_MODE=true only, no switch on screen): the four
  // passenger tabs read the sample journey. Sensor Alerts never does — it keeps the live vehicle selection, requests and
  // filters below exactly as without the flag. Off: the screen is exactly the live screen.
  const demo = passengerDemoEnabled();
  const [preset, setPreset] = useState<WindowPreset>("24h");
  const [custom, setCustom] = useState(() => ({ from: dateToIstInput(new Date(Date.now() - 86_400_000)), to: dateToIstInput(new Date()) }));
  // "Now" for relative presets; Refresh moves it forward so "Last 24 hours" really is the last 24 hours.
  const [now, setNow] = useState(() => new Date());
  // Sensor Alerts is the default on every fresh entry (the app keeps no per-screen tab state).
  const [tab, setTab] = useState<Tab>("alerts");
  const [sensorSubId, setSensorSubId] = useState("all");
  // Sensor Alerts' server-side filters (sensor, date range). Kept when the vehicle changes.
  const [alertFilters, setAlertFilters] = useState<AlertQueryFilters>(DEFAULT_QUERY_FILTERS);
  const [readingsPage, setReadingsPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Vehicles with a device fitted (pages of 100). Tenant-scoped like every fleet read (shared client + query key).
  const vehiclesQ = useApiQuery(canPickBus ? "sensors:assigned-vehicles" : null, () => vehicleRegistryService.listAllVehicles({ assigned: true }));
  const typesQ = useApiQuery("sensors:types", () => sensorService.sensorTypes());
  const vehicles = useMemo(() => sensorVehicles(vehiclesQ.data?.items), [vehiclesQ.data]);
  // Without a vehicle to choose (no vehicle.read, the list failed or has no assigned vehicle) Sensor Alerts covers
  // every permitted vehicle and the per-bus tabs ask for one.
  const noBusChoice = !canPickBus || (!!vehiclesQ.error && !vehiclesQ.data) || (vehiclesQ.data !== undefined && vehicles.length === 0);
  const allVehicles = chosenId === ALL_VEHICLES || noBusChoice;
  const bus = allVehicles ? null : pickSensorVehicle(vehicles, typeof chosenId === "number" ? chosenId : null, link);
  // device.id of the chosen vehicle — the {id} of every device-based sensor path below. Never the vehicle id.
  const deviceId = bus?.deviceId ?? null;

  const resolved = useMemo(() => resolveWindow(preset, custom, now), [preset, custom, now]);
  const win = resolved.window;
  // Sample journey: one fixed journey, its own keys (never a device's), and the demo source — same shapes, no request.
  // Only these passenger reads switch; the live vehicle above still drives Sensor Alerts.
  const source = demo ? passengerDemoSource : sensorService;
  const key = demo ? `demo:${DEMO_JOURNEY.id}` : deviceId !== null && win ? `${deviceId}:${win.fromUtc}:${win.toUtc}` : null;
  const summaryQ = useApiQuery(key ? `sensors:summary:${key}` : null, () => source.passengerSummary(deviceId!, win!));
  const comparisonQ = useApiQuery(key && tab === "comparison" ? `sensors:comparison:${key}` : null, () => source.comparison(deviceId!, win!));
  const stopsQ = useApiQuery(key && tab === "stops" ? `sensors:stops:${key}` : null, () => source.stops(deviceId!, win!));
  const bmsQ = useApiQuery(key && tab === "bms" ? `sensors:bms:${key}` : null, () => source.bms(deviceId!, win!));
  const readingsQ = useApiQuery(key && tab === "readings" ? `sensors:readings:${key}:${demo ? "all" : sensorSubId}:${readingsPage}` : null, () =>
    source.readings(deviceId!, { ...win!, sensorSubId: demo || sensorSubId === "all" ? undefined : Number(sensorSubId), pageNumber: readingsPage, pageSize: READINGS_PAGE_SIZE })
  );
  // On Sensor Alerts no per-bus table is shown; comparisonQ is idle there (its key needs tab === "comparison"), so
  // refreshing it is a no-op.
  const activeQ = { comparison: comparisonQ, stops: stopsQ, bms: bmsQ, readings: readingsQ }[tab === "alerts" ? "comparison" : tab];
  const alcoholQ = useApiQuery(key ? `sensors:alcohol:${key}` : null, () => source.alcohol(deviceId!, win!));

  // Sensor Alerts: vehicle_number is the chosen vehicle's vehicleNumber — never the vehicle id, device id, terminal
  // number or sensor kit. The caller's effective tenant (a tenant user's own; the Safe-Fare Admin's selected one)
  // only decides whether the Python demo may be shown: the request always carries the demo tenant (python-client.ts).
  const registration = cleanVehicleNumber(bus?.vehicleNumber);
  const alertsTenant = access.tenantId;
  const alertsVehicle = allVehicles ? null : registration;
  const alertsScopeKey = allVehicles || registration ? `${alertsTenant ?? "-"}:${alertsVehicle ?? "*"}` : null;
  // Every filter is part of the key: a new filter is a new request (loading state, never another filter's data).
  const alertsKey = alertsScopeKey ? `sensors:alerts:${alertsScopeKey}:${alertFilters.sensorSubId ?? "*"}:${alertFilters.fromTime ?? "-"}:${alertFilters.toTime ?? "-"}` : null;
  const alertsQ = useApiQuery(alertsKey, () => sensorAlertsService.list({ vehicleNumber: alertsVehicle, sensorSubId: alertFilters.sensorSubId, fromTime: alertFilters.fromTime, toTime: alertFilters.toTime }, alertsTenant));
  const busLabel = bus ? (bus.deviceName ? `${bus.vehicleNumber} · ${bus.deviceName}` : bus.vehicleNumber) : "This vehicle";
  const alertsScope: SensorAlertsScope = allVehicles
    ? { kind: "all" }
    : !bus
      ? vehiclesQ.error && !vehiclesQ.data
        ? { kind: "lookup-failed", busName: busLabel, error: vehiclesQ.error, retry: vehiclesQ.refetch }
        : { kind: "resolving", busName: busLabel }
      : registration
        ? { kind: "vehicle", vehicleNumber: registration, busName: busLabel }
        : { kind: "no-registration", busName: busLabel };

  function refreshAll() {
    if (preset === "custom") {
      summaryQ.refetch();
      alcoholQ.refetch();
      activeQ.refetch();
    } else setNow(new Date());
  }

  const onAlerts = tab === "alerts";
  /** The Refresh button reloads the active tab's data: Sensor Alerts, or the per-bus views (never both). */
  function refreshScreen() {
    if (!onAlerts) {
      if (deviceId !== null || demo) refreshAll();
      return;
    }
    if (vehiclesQ.error && vehiclesQ.data === undefined) vehiclesQ.refetch();
    if (alertsKey && !alertsQ.loading && !alertsQ.refreshing) alertsQ.refetch();
  }
  const refreshBusy = onAlerts ? alertsQ.loading || alertsQ.refreshing : summaryQ.loading;
  const refreshSpinning = onAlerts ? alertsQ.refreshing : summaryQ.refreshing;
  const refreshDisabled = onAlerts ? (!alertsKey && !(vehiclesQ.error && vehiclesQ.data === undefined)) || refreshBusy : (deviceId === null && !demo) || refreshBusy;
  const alertCount = useMemo(() => (alertsQ.data ? totalAlerts(alertsQ.data) : null), [alertsQ.data]);

  const s = summaryQ.data;
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

  const bmsColumns: DataTableColumn<BmsTableRow>[] = [
    { id: "time", header: "Time", cell: (r) => <span className="whitespace-nowrap tabular">{r.stopVisitTime ? formatDateTime(r.stopVisitTime) : "—"}</span> },
    { id: "stop", header: "Stop", cell: (r) => <span className="font-medium">{r.stopName ?? `Stop ${r.stopId ?? "?"}`}</span> },
    { id: "seq", header: "Seq", align: "right", cell: (r) => showCount(r.stopSequence) },
    { id: "in", header: "Boarded", align: "right", cell: (r) => <span className="text-success tabular">{showCount(r.passengersBoarded)}</span> },
    { id: "out", header: "Alighted", align: "right", cell: (r) => <span className="text-danger tabular">{showCount(r.passengersAlighted)}</span> },
    { id: "count", header: "On board (BMS)", align: "right", cell: (r) => <span className="font-semibold tabular">{showCount(r.passengerCount)}</span> },
    { id: "id", header: "BMS id", hideBelow: "md", cell: (r) => <span className="font-mono text-xs text-ink-muted">{r.bmsLabel ?? r.bmsId ?? "—"}</span> },
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

  // The passenger tabs show the sample journey's own context row instead of the vehicle picker and window.
  const passengerDemo = demo && !onAlerts;

  const busLine = allVehicles
    ? "All vehicles"
    : bus
      ? `${bus.vehicleNumber} · ${bus.deviceName ?? `Device ${bus.deviceId}`}${bus.terminalNo ? ` · ${bus.terminalNo}` : ""}${!onAlerts && s?.lastUpdatedAt ? ` · last data ${formatDateTime(s.lastUpdatedAt)}` : ""}`
      : "Choose a vehicle";

  return (
    <div>
      <PageHeader
        // The shell shows the title and subtitle ("Sensors & Safety Monitoring", nav-config.ts); this is the toolbar.
        title="Sensors & Safety Monitoring"
        actions={
          <>
            <Button variant="outline" onClick={refreshScreen} disabled={refreshDisabled}>
              <RefreshCw className={refreshSpinning ? "animate-spin" : undefined} /> Refresh
            </Button>
            {!onAlerts && !demo && recalcGate.allowed ? (
              <Button variant="outline" onClick={() => setRecalculating(true)} disabled={deviceId === null || recalcWhy !== null} title={recalcWhy ?? undefined}>
                <RotateCw /> Recalculate
              </Button>
            ) : null}
            {onAlerts || demo ? null : ingestGate.allowed ? (
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
          {passengerDemo ? (
            <JourneyContext />
          ) : (
            <>
              <FormField id="sn-bus" label="Vehicle" className="@3xl:w-72">
                {!canPickBus ? (
                  <p className="text-xs text-ink-muted">All vehicles · choosing one vehicle needs vehicle.read.</p>
                ) : vehiclesQ.error && !vehiclesQ.data ? (
                  <p className="text-xs text-danger" role="alert">
                    {describeApiError(vehiclesQ.error)} Showing all vehicles.{" "}
                    <button type="button" className="font-medium underline" onClick={vehiclesQ.refetch}>
                      Retry
                    </button>
                  </p>
                ) : vehiclesQ.data && vehicles.length === 0 ? (
                  <p className="text-xs text-ink-muted" data-testid="sensors-no-assigned-vehicles">
                    No vehicle has a device assigned yet. Assign one under Devices &amp; Assets. Showing all vehicles.
                  </p>
                ) : (
                  <Select value={allVehicles ? ALL_VEHICLES : bus ? String(bus.vehicleId) : ""} onValueChange={(v) => (setVehicleId(v === ALL_VEHICLES ? ALL_VEHICLES : Number(v)), setReadingsPage(1))} disabled={!vehiclesQ.data}>
                    <SelectTrigger id="sn-bus" className="h-10 w-full">
                      <SelectValue placeholder={vehiclesQ.data ? "Choose a vehicle" : "Loading vehicles…"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VEHICLES}>All vehicles</SelectItem>
                      {vehicles.map((v) => (
                        <SelectItem key={v.vehicleId} value={String(v.vehicleId)}>
                          {v.vehicleNumber}
                          {v.deviceName || v.terminalNo ? <span className="ml-1.5 text-[11px] text-ink-muted">{v.deviceName ?? <span className="font-mono">{v.terminalNo}</span>}</span> : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {vehiclesQ.data?.truncated ? <p className="text-[11px] text-ink-muted">Showing the first {vehicles.length} of {vehiclesQ.data.total} vehicles.</p> : null}
              </FormField>
              {onAlerts ? (
                <p className="flex items-start gap-2 rounded-inner bg-powder/60 px-3 py-2 text-[13px] text-ink @3xl:max-w-xl" data-testid="alerts-window-note">
                  <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  Sensor alerts show how long each sensor stayed active; filter them by date and time below. The time window applies to Sensor vs BMS, Stops, BMS records and Sensor readings only.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5" data-testid="time-window">
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
                </>
              )}
            </>
          )}
        </div>
        {passengerDemo ? null : (
          <p className="mt-2 text-xs text-ink-muted tabular" data-testid="vehicle-scope-line">
            {busLine}
          </p>
        )}
        {!onAlerts && !demo && resolved.error ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {resolved.error}
          </p>
        ) : null}
      </Panel>

      <SensorsTabs<Tab>
        label="Sensors views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "alerts", label: "Sensor Alerts", icon: BellRing, badge: alertCount, badgeLabel: alertCount === null ? undefined : `${alertCount} sensor alert${alertCount === 1 ? "" : "s"}` },
          { value: "comparison", label: "Sensor vs BMS" },
          { value: "stops", label: "Stops" },
          { value: "bms", label: "BMS records" },
          { value: "readings", label: "Sensor readings" },
        ]}
      />

      <div role="tabpanel" id={SENSORS_TABPANEL_ID} aria-labelledby={sensorsTabId(tab)}>
        {onAlerts ? (
          <SensorAlertsPanel key={alertsScopeKey ?? alertsScope.kind} scope={alertsScope} query={alertsQ} onRetry={alertsQ.refetch} filters={alertFilters} onFiltersChange={setAlertFilters} />
        ) : deviceId === null && !demo ? (
          <Panel>
            <EmptyState icon={BusFront} title="Choose a vehicle" description="Passenger counts, stops, BMS records and sensor readings are per bus. Choose one in the Vehicle list above; Sensor Alerts covers all vehicles." />
          </Panel>
        ) : (
          <>
            <AlcoholCard query={alcoholQ} missing={demo ? "Unavailable" : "—"} />
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

            {tab === "readings" && !demo ? (
              <FilterBar className="mb-3">
                <FilterSelect
                  label="Sensor type"
                  value={sensorSubId}
                  onChange={(v: string) => (setSensorSubId(v), setReadingsPage(1))}
                  options={[{ value: "all", label: "All sensors" }, ...(typesQ.data?.items ?? []).filter((t) => t.sensorSubId !== undefined).map((t) => ({ value: String(t.sensorSubId), label: t.sensorName ?? `Type ${t.sensorSubId}` }))]}
                />
              </FilterBar>
            ) : null}
            {tab === "comparison" && comparisonQ.data?.summary ? <ComparisonStrip summary={comparisonQ.data.summary} /> : null}
            {tab === "comparison" && demo && comparisonQ.data ? (
              <Suspense fallback={<LoadingSkeleton variant="chart" className="mb-3 h-[240px]" />}>
                <PassengerDemoCharts journey={DEMO_JOURNEY} />
              </Suspense>
            ) : null}
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
      </div>

      {adding && deviceId !== null && !demo ? (
        <AddReadingPanel
          deviceId={deviceId}
          busName={busLabel}
          types={(typesQ.data?.items ?? []).filter((t) => t.sensorSubId !== undefined).map((t) => ({ id: t.sensorSubId!, name: t.sensorName ?? `Type ${t.sensorSubId}` }))}
          onClose={() => setAdding(false)}
          onSaved={() => (setAdding(false), refreshAll())}
        />
      ) : null}

      <ConfirmDialog
        open={recalculating}
        onOpenChange={setRecalculating}
        tone="default"
        title={`Recalculate stops for ${bus?.vehicleNumber ?? "this bus"}?`}
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
function AlcoholCard({ query, missing }: { query: ApiQuery<AlcoholDetectionDto>; missing: string }) {
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
              <dd className="font-medium tabular">{a.timestamp ? formatDateTime(a.timestamp) : missing}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Sensor</dt>
              <dd className="font-mono">{a.sensorId ?? missing}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Value</dt>
              <dd className="font-mono">{a.sensorData ?? missing}</dd>
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}

/**
 * The sample journey's context on the four passenger tabs: one compact row (wraps on phones) with the bus, route and
 * date, and a neutral "Sample journey" note so the values are never taken for live telemetry.
 */
function JourneyContext() {
  const { bus } = DEMO_JOURNEY;
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]" data-testid="journey-context" aria-label="Journey">
      <span className="inline-flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-sunken text-ink-muted" aria-hidden>
          <BusFront className="size-4" />
        </span>
        <span className="font-semibold text-ink tabular" data-testid="journey-bus">
          {bus.busNumber}
        </span>
      </span>
      <span className="text-ink-subtle" aria-hidden>
        ·
      </span>
      <span className="text-ink">Route {bus.route}</span>
      <span className="text-ink-muted">{bus.routeName}</span>
      <span className="text-ink-subtle" aria-hidden>
        ·
      </span>
      <span className="text-ink tabular" data-testid="journey-date">
        {demoDateLabel(bus.date)}
      </span>
      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted" data-testid="sample-journey-note">
        Sample journey
      </span>
    </div>
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
