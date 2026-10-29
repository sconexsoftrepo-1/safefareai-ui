"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowLeftRight, MapPin, Pencil, SearchX, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { isApiError } from "@/features/drive-vision/api/errors";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { DAY } from "@/features/drive-vision/utils/time";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { DetailRow } from "../shared/slide-over-panel";
import { StatusBadge } from "../shared/status-badge";
import { ApiErrorState, DataSourceBadge, UnavailableState } from "../shared/api-states";
import { LiveActivityList } from "../dashboard/live-activity-list";
import { mergeAlarms } from "../dashboard/live-dashboard-model";
import { ExpiryBadge } from "./vehicle-cells";
import { useFleetReference } from "./use-fleet-reference";
import { WRITES_PENDING } from "./vehicles-page";

/** Days of alarm history shown under "Recent events". */
const EVENT_WINDOW_DAYS = 7;

function NotFound({ message }: { message: string }) {
  return (
    <Panel className="mt-6">
      <EmptyState
        icon={SearchX}
        title="Vehicle not found"
        description={message}
        action={
          <Button asChild variant="outline">
            <Link href="/drive-vision/vehicles">
              <ArrowLeft /> Back to vehicles
            </Link>
          </Button>
        }
      />
    </Panel>
  );
}

/**
 * Vehicle detail from GET /devices/{id}, with the device's latest state (GET /monitor/realtime?deviceIds=)
 * and alarms from the last 7 days (GET /alarms/ai, /alarms/routine with deviceIds).
 */
export function VehicleDetail({ vehicleId }: { vehicleId: string }) {
  const id = /^\d+$/.test(vehicleId) ? Number(vehicleId) : null;
  if (id === null) return <NotFound message="This link doesn't point to a device record. Links from screens that still use sample data won't resolve here." />;
  return <LiveVehicleDetail id={id} />;
}

function LiveVehicleDetail({ id }: { id: number }) {
  const ref = useFleetReference({ protocols: true });
  const [now] = useState(() => new Date());
  const alarmWindow = useMemo(() => ({ from: new Date(now.getTime() - EVENT_WINDOW_DAYS * DAY).toISOString(), to: now.toISOString(), deviceIds: [id] }), [now, id]);

  const deviceQ = useApiQuery(`vehicle:${id}`, () => fleetService.getDevice(id));
  // Dependent reads wait for the device record, so an unknown id costs one request, not four.
  const found = !!deviceQ.data;
  const realtimeQ = useApiQuery(found ? `vehicle:${id}:realtime` : null, () => fleetService.realtime([id]));
  const aiQ = useApiQuery(found ? `vehicle:${id}:ai:${alarmWindow.from}` : null, () => fleetService.listAllAlarms("ai", alarmWindow));
  const routineQ = useApiQuery(found ? `vehicle:${id}:routine:${alarmWindow.from}` : null, () => fleetService.listAllAlarms("routine", alarmWindow));

  const alarms = useMemo(() => (aiQ.data || routineQ.data ? mergeAlarms(aiQ.data?.items, routineQ.data?.items) : null), [aiQ.data, routineQ.data]);

  if (deviceQ.error) {
    if (isApiError(deviceQ.error) && deviceQ.error.status === 404) return <NotFound message={`${deviceQ.error.message || "Device not found"}${deviceQ.error.requestId ? ` (ref ${deviceQ.error.requestId})` : ""}.`} />;
    return (
      <Panel className="mt-6">
        <ApiErrorState error={deviceQ.error} onRetry={deviceQ.refetch} />
      </Panel>
    );
  }
  if (!deviceQ.data) return <LoadingSkeleton variant="card" className="mt-6" />;

  const d = deviceQ.data.data;
  const state = realtimeQ.data?.data.devices?.find((s) => s.deviceId === id);
  const driver = d.driver;
  const hasDriver = !!(driver && (driver.name || driver.phone || driver.card || driver.drivingLicense || driver.remark));
  const name = d.name ?? `Device ${d.id}`;

  return (
    <div>
      <Link href="/drive-vision/vehicles" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> All vehicles
      </Link>
      <PageHeader
        showTitle
        eyebrow={
          <>
            <DataSourceBadge source={deviceQ.data.source} />
            {state?.activeAlarm ? (
              <StatusBadge tone="danger" size="sm">
                Active alarm: {state.activeAlarm}
              </StatusBadge>
            ) : null}
          </>
        }
        title={name}
        description={[ref.objectType(d.objectTypeId), ref.group(d.groupId), state?.deviceTime ? `last report ${formatRelative(state.deviceTime, now)}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button variant="outline" disabled title={WRITES_PENDING}>
              <ArrowLeftRight /> Transfer
            </Button>
            <Button variant="outline" disabled title={WRITES_PENDING}>
              <Trash2 /> Delete
            </Button>
            <Button disabled title={WRITES_PENDING}>
              <Pencil /> Edit
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-7">
          <PanelHeader title="Latest reported state" description={state?.deviceTime ? `Device time ${formatDateTime(state.deviceTime)}${state.receivedAt ? ` · received ${formatDateTime(state.receivedAt)}` : ""}` : "From the realtime feed"} />
          {realtimeQ.error ? (
            <ApiErrorState error={realtimeQ.error} onRetry={realtimeQ.refetch} compact />
          ) : !realtimeQ.data ? (
            <LoadingSkeleton />
          ) : !state ? (
            <EmptyState icon={MapPin} title="No reported state" description="The realtime feed returned no state for this device." className="py-8" />
          ) : (
            <>
              <div className="mx-5 flex items-center gap-2 rounded-xl bg-surface-muted/80 px-3 py-2.5 text-[13px]">
                <MapPin className="size-4 shrink-0 text-brand" aria-hidden />
                {typeof state.lat === "number" && typeof state.lon === "number" ? (
                  <span className="font-mono tabular">
                    {state.lat.toFixed(5)}, {state.lon.toFixed(5)}
                  </span>
                ) : (
                  <span className="text-ink-muted">No coordinates reported</span>
                )}
                <span className="ml-auto text-xs text-ink-subtle">Map view comes with live-monitoring integration</span>
              </div>
              <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-4">
                {[
                  ["Speed", typeof state.speedKmh === "number" ? `${state.speedKmh} km/h` : "—"],
                  ["Odometer", typeof state.mileageKm === "number" ? `${formatNumber(state.mileageKm)} km` : "—"],
                  ["Battery", typeof state.batteryPct === "number" ? `${state.batteryPct}%` : "—"],
                  ["Heading", typeof state.directionDeg === "number" ? `${state.directionDeg}°` : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-surface-muted/80 px-3 py-2.5">
                    <p className="text-[11px] text-ink-muted">{label}</p>
                    <p className="text-[15px] font-semibold tabular">{value}</p>
                  </div>
                ))}
              </div>
              <p className="px-5 pb-5 text-[11px] text-ink-subtle" title="These codes are returned by the API but their meanings aren't documented, so they aren't interpreted.">
                Raw codes (undocumented): status {state.statusCode ?? "—"} · position mode {state.positionMode ?? "—"} · network {state.networkType ?? "—"} · GSM signal {state.gsmSignal ?? "—"}
              </p>
            </>
          )}
        </Panel>

        <div className="grid gap-4 xl:col-span-5">
          <Panel>
            <PanelHeader title="Device & SIM" />
            <dl className="divide-y divide-line px-5 pb-3">
              <DetailRow label="Device ID">
                <span className="font-mono tabular">{d.terminalNo ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Model">{ref.model(d.modelId)}</DetailRow>
              <DetailRow label="Protocol">{ref.protocol(d.protocolCode)}</DetailRow>
              <DetailRow label="Object type">{ref.objectType(d.objectTypeId)}</DetailRow>
              <DetailRow label="Cameras">{d.cameraCount ?? "—"}{d.cameraLines?.length ? ` · channels ${d.cameraLines.join(", ")}` : ""}</DetailRow>
              <DetailRow label="SIM">
                <span className="font-mono text-xs tabular">{d.simNumber ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Frame / VIN">{d.frameNo ?? "—"}</DetailRow>
              <DetailRow label="Plate colour">{d.plateColor ?? "—"}</DetailRow>
              <DetailRow label="Group">{ref.group(d.groupId)}</DetailRow>
              <DetailRow label="Last vendor sync">{d.syncedAt ? formatDateTime(d.syncedAt) : "Never"}</DetailRow>
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title="Dates & reminders" />
            <dl className="divide-y divide-line px-5 pb-3">
              <DetailRow label="Activated">{d.activatedAt ? formatDate(d.activatedAt) : "—"}</DetailRow>
              <DetailRow label="Service expiry">
                <span className="inline-flex items-center gap-2">
                  {d.expiresAt ? formatDate(d.expiresAt) : "—"} <ExpiryBadge date={d.expiresAt} showOkDate={false} now={now} />
                </span>
              </DetailRow>
              <DetailRow label="Insurance due">
                <span className="inline-flex items-center gap-2">
                  {d.insuranceDueAt ? formatDate(d.insuranceDueAt) : "—"} <ExpiryBadge date={d.insuranceDueAt} expiredText="Overdue" showOkDate={false} now={now} />
                </span>
              </DetailRow>
              <DetailRow label="Next maintenance">
                <span className="inline-flex items-center gap-2">
                  {d.maintenanceDueAt ? formatDate(d.maintenanceDueAt) : "—"} <ExpiryBadge date={d.maintenanceDueAt} expiredText="Overdue" showOkDate={false} now={now} />
                </span>
              </DetailRow>
            </dl>
          </Panel>
        </div>

        <Panel className="xl:col-span-4">
          <PanelHeader title="Driver" description="Stored on the device record" />
          <div className="px-5 pb-5">
            {hasDriver ? (
              <dl className="divide-y divide-line">
                <DetailRow label="Name">{driver?.name || "—"}</DetailRow>
                <DetailRow label="Phone">{driver?.phone || "—"}</DetailRow>
                <DetailRow label="Card">{driver?.card || "—"}</DetailRow>
                <DetailRow label="Licence">{driver?.drivingLicense || "—"}</DetailRow>
                {driver?.remark ? <DetailRow label="Remark">{driver.remark}</DetailRow> : null}
              </dl>
            ) : (
              <EmptyState icon={UserRound} title="No driver recorded" description="This device record has no driver details." className="py-6" />
            )}
            {d.remark ? <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-ink-muted">{d.remark}</p> : null}
          </div>
        </Panel>

        <Panel className="xl:col-span-4">
          <PanelHeader title="Recent events" description={`AI events and routine alarms · last ${EVENT_WINDOW_DAYS} days`} />
          {aiQ.error && routineQ.error ? (
            <ApiErrorState
              error={aiQ.error}
              onRetry={() => {
                aiQ.refetch();
                routineQ.refetch();
              }}
              compact
            />
          ) : !alarms || aiQ.loading || routineQ.loading ? (
            <LoadingSkeleton variant="list" rows={3} />
          ) : (
            <>
              {aiQ.error || routineQ.error ? <p className="mx-5 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{aiQ.error ? "AI events" : "Routine alarms"} unavailable for this period — showing the rest.</p> : null}
              <LiveActivityList alarms={alarms} now={now} />
            </>
          )}
        </Panel>

        <Panel className="xl:col-span-4">
          <PanelHeader title="Recent trips" />
          <UnavailableState reason="Trip history comes with track integration (GET /devices/{id}/track). The API has no trip list." />
        </Panel>
      </div>
    </div>
  );
}
