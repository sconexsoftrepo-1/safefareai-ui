"use client";

import { useMemo, useState } from "react";
import { Volume2 } from "lucide-react";
import { insightService } from "@/features/drive-vision/api/insight-service";
import type { GeofenceEventDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { DATE_RANGE_OPTIONS, resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatDateTime, formatNumber, formatSeconds } from "@/features/drive-vision/utils/format";
import { Panel, PanelHeader } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { StatusBadge } from "../shared/status-badge";

const PAGE_SIZE = 20;

/**
 * Geofence crossings on GET /geofences/events and /geofences/events/summary, scoped to the
 * selected geofence when one is chosen. Event types are shown as the server names them.
 */
export function GeofenceEvents({ geofenceId, geofenceName }: { geofenceId: number | null; geofenceName?: string }) {
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("7d");
  const [eventType, setEventType] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [now] = useState(() => new Date());
  const range = useMemo(() => resolveDateRange(rangeKey, now), [rangeKey, now]);
  const base = { from: range.from.toISOString(), to: range.to.toISOString(), geofenceId: geofenceId ?? undefined };
  const key = `${base.from}:${geofenceId ?? "*"}`;
  const summaryQ = useApiQuery(`geofence-events:summary:${key}`, () => insightService.geofenceEventSummary(base));
  const listQ = useApiQuery(`geofence-events:list:${key}:${eventType ?? "*"}:${page}`, () => insightService.geofenceEvents({ ...base, eventType: eventType ?? undefined, pageNumber: page, pageSize: PAGE_SIZE }));
  const byType = Object.entries(summaryQ.data?.data.byType ?? {}).filter(([, n]) => typeof n === "number");

  const columns: DataTableColumn<GeofenceEventDto>[] = [
    { id: "time", header: "Time", cell: (e) => (e.eventTime ? <span className="tabular">{formatDateTime(e.eventTime)}</span> : "—") },
    { id: "type", header: "Event", cell: (e) => (e.eventType ? <StatusBadge size="sm" tone="info">{e.eventType}</StatusBadge> : "—") },
    { id: "fence", header: "Geofence", hideBelow: "md", cell: (e) => e.geofenceName ?? (e.geofenceId !== undefined ? `Geofence ${e.geofenceId}` : "—") },
    { id: "device", header: "Device", cell: (e) => e.deviceName ?? e.terminalNo ?? (e.deviceId !== undefined ? `Device ${e.deviceId}` : "—") },
    { id: "speed", header: "Speed", align: "right", hideBelow: "lg", cell: (e) => (typeof e.speedKmh === "number" ? `${e.speedKmh} km/h` : "—") },
    { id: "duration", header: "Duration", align: "right", hideBelow: "lg", cell: (e) => (typeof e.durationSec === "number" ? formatSeconds(e.durationSec) : "—") },
  ];

  return (
    <Panel className="mt-4 overflow-hidden" aria-labelledby="gf-events">
      <PanelHeader
        titleId="gf-events"
        title="Geofence events"
        description={geofenceId !== null ? `For ${geofenceName ?? `geofence ${geofenceId}`} · ${range.label.toLowerCase()}` : `All geofences · ${range.label.toLowerCase()}`}
        action={<SegmentedControl label="Date range" size="sm" value={rangeKey} onChange={(v) => (setRangeKey(v), setPage(1))} options={DATE_RANGE_OPTIONS} />}
      />
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {summaryQ.error ? (
          <span className="text-xs text-danger">Summary unavailable</span>
        ) : (
          <>
            <button type="button" onClick={() => (setEventType(null), setPage(1))} aria-pressed={eventType === null} className="rounded-full border border-line px-2.5 py-1 text-xs aria-pressed:bg-ink aria-pressed:text-white">
              All types
            </button>
            {byType.map(([type, count]) => (
              <button key={type} type="button" onClick={() => (setEventType(type), setPage(1))} aria-pressed={eventType === type} className="rounded-full border border-line px-2.5 py-1 text-xs aria-pressed:bg-ink aria-pressed:text-white">
                {type} <span className="tabular opacity-75">{formatNumber(count)}</span>
              </button>
            ))}
          </>
        )}
      </div>
      {listQ.error ? (
        <ApiErrorState error={listQ.error} onRetry={listQ.refetch} compact />
      ) : !listQ.data ? (
        <LoadingSkeleton variant="table" rows={5} />
      ) : (
        <DataTable
          caption="Geofence events"
          data={listQ.data.items}
          columns={columns}
          getRowId={(e) => String(e.id)}
          isLoading={listQ.refreshing}
          pageSize={PAGE_SIZE}
          serverPagination={{ page, total: listQ.data.total, onPageChange: setPage }}
          emptyTitle="No geofence events"
          emptyDescription="The server recorded no crossings for this period."
        />
      )}
    </Panel>
  );
}

/** Voice prompts available to geofence rules — GET /voices/fence, read-only (uploading isn't offered). */
export function FenceVoices() {
  const voicesQ = useApiQuery("geofences:voices", () => insightService.fenceVoices());
  return (
    <Panel className="mt-4" aria-labelledby="gf-voices">
      <PanelHeader titleId="gf-voices" title="Geofence voice prompts" description="Read-only list from the server" />
      {voicesQ.error ? (
        <ApiErrorState error={voicesQ.error} onRetry={voicesQ.refetch} compact />
      ) : !voicesQ.data ? (
        <LoadingSkeleton variant="list" rows={2} />
      ) : voicesQ.data.items.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-ink-muted">No voice prompts.</p>
      ) : (
        <ul className="divide-y divide-line px-5 pb-3 text-[13px]">
          {voicesQ.data.items.map((v, i) => (
            <li key={v.id ?? i} className="flex items-center gap-2 py-2">
              <Volume2 className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{v.name ?? `Voice ${v.id}`}</span>
              {typeof v.fileSizeMb === "number" ? <span className="text-xs text-ink-muted tabular">{v.fileSizeMb} MB</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
