"use client";

import { useMemo, useState } from "react";
import { MapPinOff, RefreshCw, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { insightService } from "@/features/drive-vision/api/insight-service";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { TripDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { DATE_RANGE_OPTIONS, resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatDateTime, formatKm, formatNumber, formatSeconds } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { FilterSelect, SegmentedControl } from "../shared/filter-bar";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge } from "../shared/api-states";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { StatusBadge } from "../shared/status-badge";
import { DetailRow } from "../shared/slide-over-panel";
import type { MapPin } from "../map/fleet-map";
import { GeoMap } from "../map/geo-map";
import { snappedBounds } from "../map/projection";
import { routeGeometry } from "./trip-model";

const PAGE_SIZE = 20;
const n = (v: number | undefined) => (typeof v === "number" ? formatNumber(v) : "—");
const secs = (v: number | undefined) => (typeof v === "number" ? formatSeconds(v) : "—");
const km = (v: number | undefined) => (typeof v === "number" ? formatKm(v) : "—");

/**
 * Trip history on GET /trips, /trips/summary, /trips/{id} and /trips/{id}/route (trip-controller,
 * read-only — the spec has no trip writes). Trips are segmented by the server.
 */
export function TripHistory({ initialDriverId }: { initialDriverId?: number | null }) {
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("7d");
  const [now, setNow] = useState(() => new Date());
  const [deviceId, setDeviceId] = useState("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const range = useMemo(() => resolveDateRange(rangeKey, now), [rangeKey, now]);
  const query = {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    deviceId: deviceId === "all" ? undefined : Number(deviceId),
    driverId: initialDriverId ?? undefined,
  };
  const key = `${query.from}:${query.to}:${deviceId}:${initialDriverId ?? ""}`;

  const devicesQ = useApiQuery("trips:devices", () => fleetService.listAllDevices());
  const summaryQ = useApiQuery(`trips:summary:${key}`, () => insightService.tripSummary(query));
  const listQ = useApiQuery(`trips:list:${key}:${page}`, () => insightService.listTrips({ ...query, pageNumber: page, pageSize: PAGE_SIZE }));
  const s = summaryQ.data?.data;

  const columns: DataTableColumn<TripDto>[] = [
    {
      id: "start",
      header: "Started",
      cell: (t) => (
        <span className="inline-flex items-center gap-1.5 tabular">
          {t.startTime ? formatDateTime(t.startTime) : "—"}
          {t.inProgress ? <StatusBadge size="sm" tone="info">In progress</StatusBadge> : null}
        </span>
      ),
    },
    { id: "vehicle", header: "Vehicle", cell: (t) => t.deviceName ?? t.terminalNo ?? (t.deviceId !== undefined ? `Device ${t.deviceId}` : "—") },
    { id: "driver", header: "Driver", hideBelow: "md", cell: (t) => t.driverName ?? <span className="text-ink-subtle">—</span> },
    { id: "distance", header: "Distance", align: "right", cell: (t) => km(t.distanceKm) },
    { id: "duration", header: "Duration", align: "right", hideBelow: "sm", cell: (t) => secs(t.durationSeconds) },
    { id: "alarms", header: "Alarms", align: "right", hideBelow: "lg", cell: (t) => n(t.alarmCount) },
  ];

  const refresh = () => {
    setNow(new Date());
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        eyebrow={<DataSourceBadge source={listQ.data?.source ?? summaryQ.data?.source} />}
        title="Trips & Tracking"
        description={`Trips segmented by the server · ${range.label.toLowerCase()}`}
        actions={
          <>
            <FilterSelect
              label="Vehicle"
              value={deviceId}
              onChange={(v) => (setDeviceId(v), setPage(1), setOpenId(null))}
              options={[{ value: "all", label: "All vehicles" }, ...(devicesQ.data?.items ?? []).filter((d) => d.id !== undefined).map((d) => ({ value: String(d.id), label: d.name ?? `Device ${d.id}` }))]}
              className="max-w-56"
            />
            <SegmentedControl label="Date range" value={rangeKey} onChange={(v) => (setRangeKey(v), setPage(1), setOpenId(null))} options={DATE_RANGE_OPTIONS} />
            <Button variant="outline" size="sm" onClick={refresh} disabled={listQ.loading}>
              <RefreshCw className={cn(listQ.refreshing && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      <section aria-label="Trip summary" className="mb-4 rounded-card border border-line/60 bg-surface p-4 shadow-card">
        {summaryQ.error && !s ? (
          <ApiErrorState error={summaryQ.error} onRetry={summaryQ.refetch} compact />
        ) : !s ? (
          <LoadingSkeleton variant="list" rows={1} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-center @2xl:grid-cols-3 @5xl:grid-cols-6">
            {[
              ["Trips", n(s.tripCount)],
              ["In progress", n(s.inProgressCount)],
              ["Distance", km(s.totalDistanceKm)],
              ["Driving time", secs(s.totalDrivingSeconds)],
              ["Idle time", secs(s.totalIdleSeconds)],
              ["Alarms", n(s.alarmCount)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11.5px] font-medium text-ink-muted">{label}</dt>
                <dd className="text-[18px] font-semibold tabular">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="overflow-hidden">
          {listQ.error ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="table" rows={8} />
          ) : (
            <DataTable
              caption="Trips"
              data={listQ.data.items}
              columns={columns}
              getRowId={(t) => String(t.id)}
              onRowClick={(t) => t.id !== undefined && setOpenId(t.id)}
              activeRowId={openId !== null ? String(openId) : null}
              isLoading={listQ.refreshing}
              pageSize={PAGE_SIZE}
              serverPagination={{ page, total: listQ.data.total, onPageChange: setPage }}
              emptyTitle="No trips"
              emptyDescription="The server returned no trips for this period and vehicle."
            />
          )}
        </Panel>
        <TripDetailPanel id={openId} />
      </div>
    </div>
  );
}

function TripDetailPanel({ id }: { id: number | null }) {
  const detailQ = useApiQuery(id !== null ? `trips:detail:${id}` : null, () => insightService.tripDetail(id!));
  const routeQ = useApiQuery(id !== null ? `trips:route:${id}` : null, () => insightService.tripRoute(id!));
  const geo = useMemo(() => routeGeometry(routeQ.data?.data), [routeQ.data]);
  const bounds = useMemo(() => snappedBounds(geo.line), [geo]);
  const trip = detailQ.data?.data.trip ?? routeQ.data?.data.trip;
  const stops = detailQ.data?.data.stops ?? routeQ.data?.data.stops ?? [];

  if (id === null)
    return (
      <Panel className="grid min-h-[320px] place-items-center p-6 text-center text-[13px] text-ink-muted">
        <span>
          <RouteIcon className="mx-auto mb-2 size-6 text-ink-subtle" aria-hidden /> Select a trip to see its route, stops and events.
        </span>
      </Panel>
    );

  const pins: MapPin[] = [
    ...(geo.start ? [{ id: "start", kind: "start" as const, ...geo.start, title: "Trip start" }] : []),
    ...(geo.end ? [{ id: "end", kind: "end" as const, ...geo.end, title: "Trip end" }] : []),
    ...geo.stops.map((p, i) => ({ id: `s${i}`, kind: "stop" as const, lat: p.lat, lon: p.lon, title: p.title, glyph: String(i + 1) })),
    ...geo.events.map((p, i) => ({ id: `e${i}`, kind: "alarm" as const, lat: p.lat, lon: p.lon, title: p.title })),
  ];

  return (
    <Panel aria-labelledby="trip-detail-title" className="flex flex-col">
      <PanelHeader titleId="trip-detail-title" title={trip?.deviceName ?? `Trip ${id}`} description={trip?.startTime ? `${formatDateTime(trip.startTime)} → ${trip.endTime ? formatDateTime(trip.endTime) : "in progress"}` : undefined} />
      <div className="px-5 pb-3">
        {routeQ.error ? (
          <ApiErrorState error={routeQ.error} onRetry={routeQ.refetch} compact title="Couldn't load the route" />
        ) : !routeQ.data ? (
          <LoadingSkeleton variant="chart" className="h-[280px]" />
        ) : geo.line.length < 2 ? (
          <div className="grid h-[200px] place-items-center rounded-inner bg-surface-muted text-center text-[13px] text-ink-muted">
            <span>
              <MapPinOff className="mx-auto mb-1 size-5" aria-hidden />
              {geo.line.length === 0 ? "No route points with usable GPS coordinates." : "Only one point with usable GPS coordinates — no line to draw."}
            </span>
          </div>
        ) : (
          <div className="relative h-[300px] overflow-hidden rounded-inner">
            <GeoMap
              ariaLabel="Trip route"
              className="h-full"
              bounds={bounds}
              routes={[{ id: "route", points: geo.line, color: "var(--dv-series-2)" }]}
              pins={pins}
              fitPoints={geo.line}
              fitKey={id}
              showLegend={false}
              dataNote="Route points from GET /trips/{id}/route"
            />
          </div>
        )}
        {routeQ.data ? (
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            {geo.line.length} of {geo.total} points plotted{geo.skipped ? ` · ${geo.skipped} without usable coordinates skipped` : ""}
            {routeQ.data.data.truncated ? " · the server truncated this route" : ""}
          </p>
        ) : null}
      </div>
      {detailQ.error && !trip ? (
        <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} compact />
      ) : trip ? (
        <dl className="divide-y divide-line px-5 pb-4">
          <DetailRow label="Driver">{trip.driverName ?? "—"}</DetailRow>
          <DetailRow label="Distance · duration">
            {km(trip.distanceKm)} · {secs(trip.durationSeconds)}
          </DetailRow>
          <DetailRow label="Driving · idle">
            {secs(trip.drivingSeconds)} · {secs(trip.idleSeconds)}
          </DetailRow>
          <DetailRow label="Speed avg · max">
            {typeof trip.avgSpeedKmh === "number" ? `${formatNumber(Math.round(trip.avgSpeedKmh))} km/h` : "—"} · {typeof trip.maxSpeedKmh === "number" ? `${formatNumber(Math.round(trip.maxSpeedKmh))} km/h` : "—"}
          </DetailRow>
          <DetailRow label="Stops · alarms">
            {n(trip.stopCount)} · {n(trip.alarmCount)}
          </DetailRow>
          {stops.length > 0 ? (
            <DetailRow label="Stops">
              <ol className="space-y-1">
                {stops.map((st, i) => (
                  <li key={st.id ?? i} className="text-xs">
                    <span className="font-medium">{i + 1}.</span> {st.startTime ? formatDateTime(st.startTime) : "?"}
                    {st.stopType ? ` · ${st.stopType}` : ""}
                    {st.address ? ` · ${st.address}` : ""}
                  </li>
                ))}
              </ol>
            </DetailRow>
          ) : null}
        </dl>
      ) : null}
    </Panel>
  );
}
