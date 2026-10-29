"use client";

import { useMemo, useState } from "react";
import { Info, MapPinned, RefreshCw, Route, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { describeApiError } from "@/features/drive-vision/api/errors";
import type { GeofenceDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatNumber } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge, DataSourceNotice } from "../shared/api-states";
import { DetailRow } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { toast } from "../shared/toast-provider";
import { GeoMap } from "../map/geo-map";
import { snappedBounds } from "../map/projection";
import { bindingSummary, fenceColor, fenceGeometry, fencePath } from "./geofence-model";

type ShapeFilter = "all" | "AREA" | "LINE";

/**
 * Geofences on live BFF data: GET /geofences drawn on the base map, DELETE /geofences/{id} after
 * confirmation. Creating and editing are off: GeofenceRequest requires `ruleTypes` (and uses
 * `areaType` / `colorIndex`) whose integer codes the API doesn't document.
 */
export function GeofencesPage() {
  const [shape, setShape] = useState<ShapeFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GeofenceDto | null>(null);
  const listQ = useApiQuery(`geofences:${shape}`, () => fleetService.listGeofences(shape === "all" ? {} : { shape }));
  const groupsQ = useApiQuery("geofences:groups", () => fleetService.listGroups());
  const devicesQ = useApiQuery("geofences:devices", () => fleetService.listAllDevices());

  const fences = useMemo(() => (listQ.data?.items ?? []).map((f) => ({ f, g: fenceGeometry(f) })), [listQ.data]);
  const selected = fences.find((x) => x.f.id === selectedId) ?? null;
  const drawable = useMemo(() => fences.filter((x) => !x.g.issue), [fences]);
  const routes = drawable.map(({ f, g }) => ({ id: String(f.id), points: fencePath(f, g), color: fenceColor(f), dim: selectedId !== null && f.id !== selectedId }));
  const allPoints = useMemo(() => drawable.flatMap((x) => x.g.points), [drawable]);
  const fitPoints = selected && !selected.g.issue ? selected.g.points : allPoints;
  const bounds = useMemo(() => snappedBounds(allPoints), [allPoints]);

  const nameOf = (f: GeofenceDto, id: number) =>
    f.bindType === "GROUP" ? (groupsQ.data?.items.find((x) => x.id === id)?.name ?? `Group ${id}`) : (devicesQ.data?.items.find((x) => x.id === id)?.name ?? `Device ${id}`);

  async function confirmDelete() {
    if (deleteTarget?.id === undefined) return;
    try {
      await fleetService.deleteGeofence(deleteTarget.id);
      toast.success(`Deleted “${deleteTarget.name ?? `Geofence ${deleteTarget.id}`}”`);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      listQ.refetch();
    } catch (err) {
      toast.error("The server didn't delete the geofence", { description: describeApiError(err) });
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <PageHeader
        eyebrow={<DataSourceBadge source={listQ.data?.source} />}
        title="Geofences"
        description={listQ.data ? `${formatNumber(listQ.data.items.length)} geofence${listQ.data.items.length === 1 ? "" : "s"}${shape !== "all" ? ` · ${shape === "AREA" ? "zones" : "lines"}` : ""}` : listQ.error ? "Couldn't load geofences" : "Loading geofences…"}
        actions={
          <Button variant="outline" onClick={listQ.refetch} disabled={listQ.loading}>
            <RefreshCw className={listQ.refreshing ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />
      <p className="mb-3 flex items-start gap-1.5 px-1 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>Creating and editing geofences is off: the API requires rule-type codes whose meanings aren&apos;t documented yet. Rule codes are shown as returned.</span>
      </p>
      <DataSourceNotice source={listQ.data?.source} className="mb-3" />

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-line p-3">
            <SegmentedControl
              label="Shape"
              size="sm"
              value={shape}
              onChange={(v) => (setShape(v), setSelectedId(null))}
              options={[
                { value: "all", label: "All" },
                { value: "AREA", label: "Zones" },
                { value: "LINE", label: "Lines" },
              ]}
            />
          </div>
          {listQ.error ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="list" rows={6} />
          ) : fences.length === 0 ? (
            <EmptyState icon={MapPinned} title="No geofences" description={shape === "all" ? "The server returned no geofences." : "The server returned none of this shape."} />
          ) : (
            <ul className="scrollbar-thin max-h-[60vh] min-h-0 overflow-y-auto p-2 lg:max-h-none">
              {fences.map(({ f, g }) => {
                const active = f.id === selectedId;
                return (
                  <li key={f.id ?? f.name}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(active ? null : (f.id ?? null))}
                      className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none", active ? "bg-ink text-white" : "hover:bg-surface-muted")}
                    >
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full" style={{ background: fenceColor(f), color: "white" }} aria-hidden>
                        {f.shape === "LINE" ? <Route className="size-3.5" /> : <MapPinned className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{f.name ?? `Geofence ${f.id}`}</span>
                        <span className={cn("block text-xs", active ? "text-white/75" : "text-ink-muted")}>
                          {f.shape === "LINE" ? "Line" : f.shape === "AREA" ? "Zone" : (f.shape ?? "Unknown shape")} · {g.points.length} points · {bindingSummary(f)}
                        </span>
                        {g.issue ? (
                          <span className={cn("mt-0.5 flex items-center gap-1 text-xs", active ? "text-white" : "text-warning")}>
                            <TriangleAlert className="size-3" aria-hidden /> Not drawn: {g.issue}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-4">
          <Panel className="h-[52vh] min-h-[320px] overflow-hidden p-2 lg:h-[60vh]">
            <GeoMap ariaLabel="Geofence map" className="h-full" bounds={bounds} dataNote="Geofence points from the API" routes={routes} fitPoints={fitPoints} fitKey={selectedId ?? `all:${shape}`} />
          </Panel>
          {selected ? (
            <Panel>
              <PanelHeader
                title={selected.f.name ?? `Geofence ${selected.f.id}`}
                description={selected.f.shape === "LINE" ? "Route line" : "Zone"}
                action={
                  <Button variant="outline" size="sm" onClick={() => setDeleteTarget(selected.f)}>
                    <Trash2 /> Delete
                  </Button>
                }
              />
              <dl className="divide-y divide-line px-5 pb-4">
                <DetailRow label="Bound to">
                  {selected.f.global ? "All devices (global)" : (selected.f.bindIds ?? []).length === 0 ? "Not bound" : (selected.f.bindIds ?? []).map((id) => nameOf(selected.f, id)).join(", ")}
                </DetailRow>
                <DetailRow label="Rule codes">{(selected.f.ruleTypes ?? []).join(", ") || "—"}</DetailRow>
                <DetailRow label="Max speed">{typeof selected.f.maxSpeed === "number" ? `${selected.f.maxSpeed} km/h` : "—"}</DetailRow>
                <DetailRow label="Speed limit">{selected.f.speedLimit?.speedLimitKmh !== undefined ? `${selected.f.speedLimit.speedLimitKmh} km/h${selected.f.speedLimit.timeRange ? ` · ${selected.f.speedLimit.timeRange}` : ""}` : "—"}</DetailRow>
                <DetailRow label="Area type code">{selected.f.areaType ?? "—"}</DetailRow>
                <DetailRow label="Voice broadcasts">{selected.f.broadcasts?.length ?? 0}</DetailRow>
                <DetailRow label="Points">
                  {selected.g.points.length}
                  {selected.g.dropped > 0 ? ` (${selected.g.dropped} unusable skipped)` : ""}
                </DetailRow>
                <DetailRow label="Synced">{selected.f.syncedAt ? formatDateTime(selected.f.syncedAt) : "—"}</DetailRow>
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.name ?? `Geofence ${deleteTarget?.id}`}”?`}
        description="The geofence and its rules are removed on the server and from the devices it's bound to. This can't be undone here."
        confirmLabel="Delete geofence"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
