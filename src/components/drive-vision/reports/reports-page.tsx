"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService, type ListResult } from "@/features/drive-vision/api/fleet-service";
import { isApiError } from "@/features/drive-vision/api/errors";
import type { ActivityDto, MediaDto, MileageDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { formatDate, formatDateTime, formatNumber, formatSeconds } from "@/features/drive-vision/utils/format";
import { DATE_RANGE_OPTIONS, resolveDateRange } from "@/features/drive-vision/utils/time";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SegmentedControl } from "../shared/filter-bar";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge, DataSourceNotice } from "../shared/api-states";
import { REPORT_KINDS, REPORT_LABEL, REPORT_PAGE_SIZE, isPaged, mileageTotal, reportQuery, safeHttpUrl, type ReportKind } from "./reports-model";

type Row = MileageDto | ActivityDto | MediaDto;

const device = (r: { deviceName?: string; terminalNo?: string; deviceId?: number }) => (
  <div className="min-w-0">
    <p className="truncate font-medium">{r.deviceName ?? (r.deviceId !== undefined ? `Device ${r.deviceId}` : "—")}</p>
    {r.terminalNo ? <p className="font-mono text-[11px] text-ink-muted tabular">{r.terminalNo}</p> : null}
  </div>
);
const time = (iso?: string) => (iso ? <span className="whitespace-nowrap tabular">{formatDateTime(iso)}</span> : <span className="text-ink-subtle">—</span>);
const km = (v?: number) => (typeof v === "number" ? `${formatNumber(Math.round(v * 10) / 10)} km` : "—");

const MILEAGE_COLUMNS: DataTableColumn<MileageDto>[] = [
  { id: "device", header: "Device", cell: device },
  { id: "period", header: "Period", cell: (r) => (r.periodStart ? `${formatDate(r.periodStart)}${r.periodEnd && r.periodEnd !== r.periodStart ? ` – ${formatDate(r.periodEnd)}` : ""}` : "—") },
  { id: "distance", header: "Distance", align: "right", cell: (r) => km(r.distanceKm), sortValue: (r) => r.distanceKm ?? -1 },
  { id: "start", header: "Odometer start", align: "right", hideBelow: "md", cell: (r) => km(r.startMileageKm) },
  { id: "end", header: "Odometer end", align: "right", hideBelow: "md", cell: (r) => km(r.endMileageKm) },
];

const ACTIVITY_COLUMNS: DataTableColumn<ActivityDto>[] = [
  { id: "device", header: "Device", cell: device },
  { id: "start", header: "Start", cell: (r) => time(r.startTime) },
  { id: "end", header: "End", hideBelow: "sm", cell: (r) => time(r.endTime) },
  { id: "duration", header: "Duration", align: "right", cell: (r) => r.durationText ?? (typeof r.durationSeconds === "number" ? formatSeconds(r.durationSeconds) : "—") },
];

const MEDIA_COLUMNS: DataTableColumn<MediaDto>[] = [
  { id: "device", header: "Device", cell: device },
  { id: "captured", header: "Captured", cell: (r) => time(r.capturedAt ?? r.startTime) },
  { id: "channel", header: "Channel", align: "right", hideBelow: "sm", cell: (r) => r.channel ?? "—" },
  { id: "codes", header: "Type · trigger", hideBelow: "md", cell: (r) => <span className="font-mono text-xs text-ink-muted" title="Raw codes; meanings aren't documented">{`${r.mediaType ?? "—"} · ${r.triggerType ?? "—"}`}</span> },
  {
    id: "open",
    header: "File",
    align: "right",
    cell: (r) => {
      const url = safeHttpUrl(r.previewUrl);
      return url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-deep hover:underline" onClick={(e) => e.stopPropagation()}>
          Open <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : r.previewUrl ? (
        <span className="text-xs text-ink-subtle" title="The server returned a link that can't be opened (placeholder or non-web address)">
          Link not usable
        </span>
      ) : (
        <span className="text-ink-subtle">—</span>
      );
    },
  },
];

/**
 * Reports on live BFF data: GET /reports/mileage, /driving, /parking, /media for a time window and
 * optional device. Mileage isn't paged by the API; the others are server-paged.
 */
export function ReportsPage() {
  const [kind, setKind] = useState<ReportKind>("mileage");
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("7d");
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const range = useMemo(() => resolveDateRange(rangeKey, now), [rangeKey, now]);
  const query = useMemo(() => reportQuery(kind, range, deviceId, page), [kind, range, deviceId, page]);

  const listQ = useApiQuery<ListResult<Row>>(`reports:${kind}:${JSON.stringify(query)}`, () => {
    if (kind === "mileage") return fleetService.mileageReport(query);
    if (kind === "media") return fleetService.mediaReport(query);
    return fleetService.activityReport(kind, query);
  });
  const devicesQ = useApiQuery("reports:devices", () => fleetService.listAllDevices());
  const deviceOptions = useMemo(
    () => [{ value: "all", label: "All devices" }, ...(devicesQ.data?.items ?? []).filter((d) => d.id !== undefined).map((d) => ({ value: String(d.id), label: d.name ?? d.terminalNo ?? `Device ${d.id}` }))],
    [devicesQ.data]
  );
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));
  const unavailable503 = isApiError(listQ.error) && listQ.error.status === 503;
  const items = listQ.data?.items ?? [];
  const total = kind === "mileage" ? mileageTotal(items as MileageDto[]) : null;
  const label = REPORT_LABEL[kind].toLowerCase();

  const table = () => {
    const common = {
      caption: `${REPORT_LABEL[kind]} report`,
      isLoading: listQ.refreshing,
      pageSize: REPORT_PAGE_SIZE,
      emptyTitle: `No ${label} records`,
      emptyDescription: `The server returned no ${label} records for ${range.label.toLowerCase()}${deviceId !== null ? " for this device" : ""}.`,
      serverPagination: isPaged(kind) ? { page, total: listQ.data?.total ?? 0, onPageChange: setPage } : undefined,
    };
    const rowId = (r: Row) => String(r.id ?? `${r.deviceId}:${"startTime" in r ? r.startTime : ""}:${"periodStart" in r ? r.periodStart : ""}`);
    if (kind === "mileage") return <DataTable {...common} data={items as MileageDto[]} columns={MILEAGE_COLUMNS} getRowId={rowId} />;
    if (kind === "media") return <DataTable {...common} data={items as MediaDto[]} columns={MEDIA_COLUMNS} getRowId={rowId} />;
    return <DataTable {...common} data={items as ActivityDto[]} columns={ACTIVITY_COLUMNS} getRowId={rowId} />;
  };

  return (
    <div>
      <PageHeader
        eyebrow={<DataSourceBadge source={listQ.data?.source} />}
        title="Reports"
        description={
          listQ.data
            ? `${formatNumber(listQ.data.total)} ${label} record${listQ.data.total === 1 ? "" : "s"} · ${range.label.toLowerCase()}${total ? ` · ${formatNumber(total.km)} km total` : ""}`
            : listQ.error
              ? `Couldn't load the ${label} report`
              : `Loading the ${label} report…`
        }
        actions={
          <Button variant="outline" onClick={() => setNow(new Date())} disabled={listQ.loading} title="Load again up to the current time">
            <RefreshCw className={listQ.loading || listQ.refreshing ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl label="Report" value={kind} onChange={reset(setKind)} options={REPORT_KINDS.map((k) => ({ value: k, label: REPORT_LABEL[k] }))} />
        <FilterBar>
          <FilterSelect label="Time range" value={rangeKey} onChange={reset(setRangeKey)} options={DATE_RANGE_OPTIONS} />
          <FilterSelect label="Device" value={deviceId === null ? "all" : String(deviceId)} onChange={reset((v: string) => setDeviceId(v === "all" ? null : Number(v)))} options={deviceOptions} className="max-w-56" />
        </FilterBar>
      </div>

      {total && total.missing > 0 ? (
        <p className="mb-3 flex items-start gap-1.5 px-1 text-xs text-ink-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{total.missing} rows have no distance and aren&apos;t included in the total.</span>
        </p>
      ) : null}
      {devicesQ.error ? <p className="mb-3 px-1 text-xs text-ink-muted">Couldn&apos;t load the device list for the filter.</p> : null}
      <DataSourceNotice source={listQ.data?.source} className="mb-3" />

      <Panel className="overflow-hidden">
        {listQ.error ? (
          <>
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} title={unavailable503 ? `${REPORT_LABEL[kind]} report unavailable` : undefined} />
            {unavailable503 ? (
              <p className="-mt-4 px-6 pb-8 text-center text-xs text-ink-muted">
                <span className="mx-auto block max-w-md">This server answers 503 both when its data source is down and when it has nothing stored for the request, so this isn&apos;t shown as an empty report.</span>
              </p>
            ) : null}
          </>
        ) : !listQ.data ? (
          <LoadingSkeleton variant="table" rows={8} />
        ) : (
          table()
        )}
      </Panel>
    </div>
  );
}
