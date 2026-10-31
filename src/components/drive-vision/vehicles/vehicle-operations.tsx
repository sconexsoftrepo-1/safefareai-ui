"use client";

import Link from "next/link";
import { insightService } from "@/features/drive-vision/api/insight-service";
import { operationsService } from "@/features/drive-vision/api/operations-service";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatKm, formatNumber, formatSeconds } from "@/features/drive-vision/utils/format";
import { Panel, PanelHeader } from "../shared/panel";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow } from "../shared/slide-over-panel";
import { StatusBadge } from "../shared/status-badge";

/**
 * Assigned driver and current work for one vehicle: GET /devices/{id}/summary (status, current
 * driver, open alerts, current dispatch) and /devices/{id}/driver-assignments (history).
 */
export function VehicleAssignmentPanel({ id }: { id: number }) {
  const summaryQ = useApiQuery(`vehicle:${id}:summary`, () => insightService.vehicleSummary(id));
  const assignQ = useApiQuery(`vehicle:${id}:assignments`, () => operationsService.deviceAssignments(id));
  const s = summaryQ.data?.data;
  const current = s?.currentDriver;
  return (
    <Panel className="xl:col-span-4">
      <PanelHeader title="Assignment & work" description="From the SafeFare server" />
      <div className="px-5 pb-5">
        {summaryQ.error && !s ? (
          <ApiErrorState error={summaryQ.error} onRetry={summaryQ.refetch} compact />
        ) : !s ? (
          <LoadingSkeleton variant="list" rows={3} />
        ) : (
          <dl className="divide-y divide-line">
            <DetailRow label="Status">{s.statusLabel || s.status ? <StatusBadge size="sm" tone="neutral">{s.statusLabel || s.status}</StatusBadge> : "—"}</DetailRow>
            <DetailRow label="Assigned driver">
              {current?.driverId !== undefined ? (
                <Link className="font-medium text-brand-deep hover:underline" href={`/drive-vision/drivers?driver=${current.driverId}`}>
                  {current.driverName ?? `Driver ${current.driverId}`}
                </Link>
              ) : (
                (s.vendorDriverName ?? "None")
              )}
              {current?.assignedFrom ? <span className="ml-1 text-xs text-ink-muted">since {formatDateTime(current.assignedFrom)}</span> : null}
            </DetailRow>
            <DetailRow label="Open alerts">
              {typeof s.openAlerts === "number" ? (
                <Link className="hover:underline" href={`/drive-vision/alerts?kind=incidents&device=${id}`}>
                  {formatNumber(s.openAlerts)}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Current dispatch">
              {s.currentDispatch?.id !== undefined ? (
                <Link className="hover:underline" href={`/drive-vision/dispatch?dispatch=${s.currentDispatch.id}`}>
                  {s.currentDispatch.title ?? `Dispatch ${s.currentDispatch.id}`}
                  {s.currentDispatch.status ? ` · ${s.currentDispatch.status}` : ""}
                </Link>
              ) : (
                "None"
              )}
            </DetailRow>
          </dl>
        )}
        <h3 className="mt-4 mb-1 text-[12px] font-semibold text-ink-muted">Assignment history</h3>
        {assignQ.error ? (
          <p className="text-xs text-danger">Unavailable</p>
        ) : !assignQ.data ? (
          <LoadingSkeleton variant="list" rows={2} />
        ) : assignQ.data.items.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No driver assignments recorded.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {assignQ.data.items.slice(0, 6).map((a, i) => (
              <li key={a.id ?? i} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{a.driverName ?? (a.driverId !== undefined ? `Driver ${a.driverId}` : "—")}</span>
                <span className="text-xs text-ink-muted tabular">
                  {a.assignedFrom ? formatDateTime(a.assignedFrom) : "?"} → {a.assignedTo ? formatDateTime(a.assignedTo) : "open"}
                </span>
                {a.active ? <StatusBadge size="sm" tone="success">Active</StatusBadge> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** Latest trips for one vehicle — GET /trips?deviceId=. */
export function VehicleRecentTrips({ id }: { id: number }) {
  const tripsQ = useApiQuery(`vehicle:${id}:trips`, () => insightService.listTrips({ deviceId: id, pageNumber: 1, pageSize: 5 }));
  return (
    <Panel className="xl:col-span-4">
      <PanelHeader
        title="Recent trips"
        action={
          <Link href="/drive-vision/trips" className="text-xs font-medium text-ink-muted hover:text-ink">
            All trips
          </Link>
        }
      />
      {tripsQ.error ? (
        <ApiErrorState error={tripsQ.error} onRetry={tripsQ.refetch} compact />
      ) : !tripsQ.data ? (
        <LoadingSkeleton variant="list" rows={3} />
      ) : tripsQ.data.items.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-ink-muted">The server returned no trips for this vehicle.</p>
      ) : (
        <ul className="divide-y divide-line px-5 pb-3 text-[13px]">
          {tripsQ.data.items.map((t, i) => (
            <li key={t.id ?? i} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block tabular">{t.startTime ? formatDateTime(t.startTime) : "—"}</span>
                <span className="block truncate text-xs text-ink-muted">{t.driverName ?? "No driver"}</span>
              </span>
              <span className="text-right text-xs tabular">
                {typeof t.distanceKm === "number" ? formatKm(t.distanceKm) : "—"}
                <span className="block text-ink-muted">{typeof t.durationSeconds === "number" ? formatSeconds(t.durationSeconds) : ""}</span>
              </span>
              {t.inProgress ? <StatusBadge size="sm" tone="info">Live</StatusBadge> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
