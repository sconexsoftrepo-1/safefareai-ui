"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileVideo, ImageIcon, Info, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { AlarmDto } from "@/features/drive-vision/api/types";
import { isApiError } from "@/features/drive-vision/api/errors";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { formatDateTime, formatNumber, formatRelative, formatSeconds } from "@/features/drive-vision/utils/format";
import { DATE_RANGE_OPTIONS, resolveDateRange } from "@/features/drive-vision/utils/time";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SegmentedControl } from "../shared/filter-bar";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge, DataSourceNotice } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { EventDetailDrawer } from "./event-detail-drawer";
import { ALARM_PAGE_SIZE, alarmLabel, alarmQuery, alertsSearch, deviceLabel, parseAlertsView, typeOptions, type AlarmKind, type AlertsView } from "./alerts-model";

const KIND_LABEL: Record<AlarmKind, string> = { ai: "AI events", routine: "Routine alarms" };

/**
 * Alerts & Events on live BFF data: GET /alarms/ai and /alarms/routine, server-paged, filtered
 * by time window, device and alarm type (the filters the API has). The view lives in the URL so
 * links, reloads and Back keep it. Read-only: the API has no alarm handling endpoints.
 */
export function AlertsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const view = useMemo(() => parseAlertsView(params), [params]);
  const [now, setNow] = useState(() => new Date());

  const go = (patch: Partial<AlertsView>) => router.replace(`/drive-vision/alerts${alertsSearch({ ...view, ...patch })}`, { scroll: false });
  /** Any filter change starts again at page 1 and closes the drawer. */
  const filter = (patch: Partial<AlertsView>) => go({ ...patch, page: 1, alarmId: null });

  const query = useMemo(() => alarmQuery(view, now), [view, now]);
  const filterKey = `${query.from}:${query.to}:${view.deviceId ?? "*"}:${view.typeId ?? "*"}`;
  const fetchKind = (kind: AlarmKind) => (kind === "ai" ? fleetService.aiAlarms : fleetService.routineAlarms);
  const other: AlarmKind = view.kind === "ai" ? "routine" : "ai";

  const listQ = useApiQuery(`alerts:${view.kind}:${filterKey}:${view.page}`, () => fetchKind(view.kind)(query));
  // The other tab's count only: page 1 with one item, for the envelope's `total`.
  const otherQ = useApiQuery(`alerts:count:${other}:${filterKey}`, () => fetchKind(other)({ ...query, pageNumber: 1, pageSize: 1 }));

  const devicesQ = useApiQuery("alerts:devices", () => fleetService.listAllDevices());
  const typesQ = useApiQuery("alerts:alarm-types", () => fleetService.alarmTypes());
  const typeById = useMemo(() => new Map((typesQ.data?.items ?? []).map((t) => [t.id, t])), [typesQ.data]);

  const items = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const total = listQ.data?.total ?? 0;
  const countOf = (kind: AlarmKind) => (kind === view.kind ? listQ.data?.total : otherQ.data?.total);

  const openAlarm = view.alarmId !== null ? items.find((a) => a.id === view.alarmId) : undefined;
  const linkMissing = view.alarmId !== null && !!listQ.data && !openAlarm;
  const range = resolveDateRange(view.range, now);
  const filtersActive = view.deviceId !== null || view.typeId !== null;
  const unavailable503 = isApiError(listQ.error) && listQ.error.status === 503;

  const deviceOptions = useMemo(() => {
    const list = (devicesQ.data?.items ?? []).filter((d) => d.id !== undefined).map((d) => ({ value: String(d.id), label: deviceLabel({ deviceName: d.name, terminalNo: d.terminalNo, deviceId: d.id }) }));
    // Keep a linked device selectable even before (or without) the device list.
    if (view.deviceId !== null && !list.some((o) => o.value === String(view.deviceId))) list.unshift({ value: String(view.deviceId), label: `Device ${view.deviceId}` });
    return [{ value: "all", label: "All devices" }, ...list];
  }, [devicesQ.data, view.deviceId]);
  const alarmTypeOptions = useMemo(() => {
    const list = typeOptions(typesQ.data?.items ?? []);
    if (view.typeId !== null && !list.some((o) => o.value === String(view.typeId))) list.unshift({ value: String(view.typeId), label: `Type #${view.typeId}` });
    return [{ value: "all", label: "All alarm types" }, ...list];
  }, [typesQ.data, view.typeId]);

  const columns: DataTableColumn<AlarmDto>[] = [
    {
      id: "event",
      header: "Event",
      cell: (a) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            {alarmLabel(a, typeById)}
            {a.videoUrl ? <FileVideo className="size-3.5 shrink-0 text-ink-subtle" aria-label="Video attached" /> : null}
            {a.imageUrl ? <ImageIcon className="size-3.5 shrink-0 text-ink-subtle" aria-label="Image attached" /> : null}
          </p>
          <p className="text-xs text-ink-muted">{view.kind === "ai" ? "AI event" : "Routine alarm"}</p>
        </div>
      ),
    },
    {
      id: "device",
      header: "Device",
      cell: (a) => (
        <div className="min-w-0">
          <p className="font-medium">{deviceLabel(a)}</p>
          {a.terminalNo && a.deviceName ? <p className="font-mono text-[11px] text-ink-muted tabular">{a.terminalNo}</p> : null}
        </div>
      ),
    },
    {
      id: "time",
      header: "Time",
      cell: (a) =>
        a.alarmTime ? (
          <div>
            <p className="whitespace-nowrap tabular">{formatDateTime(a.alarmTime)}</p>
            <p className="text-xs text-ink-muted">{formatRelative(a.alarmTime, now)}</p>
          </div>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    { id: "duration", header: "Duration", align: "right", hideBelow: "lg", cell: (a) => (typeof a.durationSeconds === "number" ? formatSeconds(a.durationSeconds) : "—") },
    { id: "speed", header: "Speed", align: "right", hideBelow: "md", cell: (a) => (typeof a.speedKmh === "number" ? `${a.speedKmh} km/h` : "—") },
    {
      id: "severity",
      header: "Severity",
      align: "right",
      hideBelow: "xl",
      cell: (a) => (typeof a.severity === "number" ? <span className="text-ink-muted tabular" title="Raw value; the API doesn't document the scale">{a.severity}</span> : "—"),
    },
    {
      id: "status",
      header: "Status",
      cell: (a) =>
        a.handlingStatus ? (
          <StatusBadge size="sm" tone="neutral">
            {a.handlingStatus}
          </StatusBadge>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={<DataSourceBadge source={listQ.data?.source} />}
        title="Alerts & Events"
        description={
          listQ.data
            ? `${formatNumber(total)} ${KIND_LABEL[view.kind].toLowerCase()} · ${range.label.toLowerCase()}${filtersActive ? " · filtered" : ""}`
            : listQ.error
              ? `Couldn't load ${KIND_LABEL[view.kind].toLowerCase()}`
              : `Loading ${KIND_LABEL[view.kind].toLowerCase()}…`
        }
        actions={
          <Button variant="outline" onClick={() => setNow(new Date())} disabled={listQ.loading} title="Load again up to the current time">
            <RefreshCw className={listQ.loading || listQ.refreshing ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Alarm kind"
          value={view.kind}
          onChange={(kind) => filter({ kind })}
          options={(["ai", "routine"] as const).map((k) => ({ value: k, label: KIND_LABEL[k], count: countOf(k) }))}
        />
        <FilterBar>
          <FilterSelect label="Time range" value={view.range} onChange={(r: DateRangeKey) => filter({ range: r })} options={DATE_RANGE_OPTIONS} />
          <FilterSelect label="Device" value={view.deviceId === null ? "all" : String(view.deviceId)} onChange={(v) => filter({ deviceId: v === "all" ? null : Number(v) })} options={deviceOptions} className="max-w-56" />
          <FilterSelect label="Alarm type" value={view.typeId === null ? "all" : String(view.typeId)} onChange={(v) => filter({ typeId: v === "all" ? null : Number(v) })} options={alarmTypeOptions} className="max-w-56" />
          {filtersActive ? (
            <button type="button" onClick={() => filter({ deviceId: null, typeId: null })} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-[13px] text-ink-muted hover:text-ink">
              <X className="size-3.5" aria-hidden /> Clear filters
            </button>
          ) : null}
        </FilterBar>
      </div>

      <p className="mb-3 flex items-start gap-1.5 px-1 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Read-only: the API has no endpoint to acknowledge, resolve, assign or annotate alarms. It filters by time, device and alarm type only.
          {devicesQ.error || typesQ.error ? ` Couldn't load the ${[devicesQ.error && "device", typesQ.error && "alarm type"].filter(Boolean).join(" and ")} list for the filters.` : ""}
        </span>
      </p>

      <DataSourceNotice source={listQ.data?.source} className="mb-3" />

      {linkMissing ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface-muted px-3.5 py-2.5 text-[13px] text-ink-muted" role="status">
          <Info className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">Alarm #{view.alarmId} isn&apos;t in this page of results, and the API has no way to look up a single alarm.</span>
          <Button variant="ghost" size="icon-sm" onClick={() => go({ alarmId: null })} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      ) : null}

      <Panel className="overflow-hidden">
        {listQ.error ? (
          <>
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} title={unavailable503 ? `${KIND_LABEL[view.kind]} unavailable` : undefined} />
            {unavailable503 ? (
              <p className="-mt-4 px-6 pb-8 text-center text-xs text-ink-muted">
                <span className="mx-auto block max-w-md">
                  This server answers 503 both when its data source is down and when it has no stored {KIND_LABEL[view.kind].toLowerCase()} for the request{view.page > 1 ? " (including pages past the end)" : ""}, so this may mean there are none
                  {filtersActive ? " for these filters" : " in this period"}. It isn&apos;t shown as an empty list because the server didn&apos;t say so.
                </span>
              </p>
            ) : null}
          </>
        ) : !listQ.data ? (
          <LoadingSkeleton variant="table" rows={8} />
        ) : (
          <DataTable
            caption={KIND_LABEL[view.kind]}
            data={items}
            columns={columns}
            getRowId={(a) => String(a.id)}
            onRowClick={(a) => a.id !== undefined && go({ alarmId: a.id })}
            activeRowId={openAlarm ? String(openAlarm.id) : null}
            isLoading={listQ.refreshing}
            pageSize={ALARM_PAGE_SIZE}
            serverPagination={{ page: view.page, total, onPageChange: (page) => go({ page, alarmId: null }) }}
            emptyTitle={`No ${KIND_LABEL[view.kind].toLowerCase()}`}
            emptyDescription={`The server returned no ${KIND_LABEL[view.kind].toLowerCase()} for ${range.label.toLowerCase()}${filtersActive ? " with these filters" : ""}.`}
            emptyAction={
              filtersActive ? (
                <Button variant="outline" size="sm" onClick={() => filter({ deviceId: null, typeId: null })}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>

      <EventDetailDrawer alarm={openAlarm} kind={view.kind} typeById={typeById} open={openAlarm !== undefined} onOpenChange={(o) => !o && go({ alarmId: null })} />
    </div>
  );
}
