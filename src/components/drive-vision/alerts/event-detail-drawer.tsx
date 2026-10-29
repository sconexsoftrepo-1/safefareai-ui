"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ExternalLink, FileVideo, ImageIcon, MapPinOff, Route as RouteIcon } from "lucide-react";
import type { AlarmDto, AlarmTypeDto } from "@/features/drive-vision/api/types";
import { formatDateTime, formatSeconds, formatTimeWithSeconds } from "@/features/drive-vision/utils/format";
import { formatLatLon } from "@/features/drive-vision/utils/geo";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { StatusBadge } from "../shared/status-badge";
import { EmptyState } from "../shared/feedback";
import { UnavailableState } from "../shared/api-states";
import { GeoMap } from "../map/geo-map";
import { snappedBounds } from "../map/projection";
import { alarmLabel, alarmPosition, deviceLabel, safeMediaUrl, type AlarmKind } from "./alerts-model";

/** Shown wherever the old demo offered acknowledge / assign / resolve / notes. */
export const HANDLING_UNSUPPORTED =
  "The API has no endpoint to acknowledge, resolve, assign or annotate an alarm, so handling isn't available here. The status shown is the server's value, read-only.";

/**
 * One alarm from the list response. There is no GET /alarms/{id}, so the drawer shows the
 * row the user picked, as returned; it can't load an alarm that isn't on the current page.
 */
export function EventDetailDrawer({
  alarm,
  kind,
  typeById,
  open,
  onOpenChange,
}: {
  alarm: AlarmDto | undefined;
  kind: AlarmKind;
  typeById: Map<number | undefined, AlarmTypeDto>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <SlideOverPanel
      open={open && Boolean(alarm)}
      onOpenChange={onOpenChange}
      width="lg"
      title={alarm ? alarmLabel(alarm, typeById) : ""}
      description={alarm ? `${deviceLabel(alarm)}${alarm.alarmTime ? ` · ${formatDateTime(alarm.alarmTime)}` : ""}` : undefined}
      headerExtra={
        alarm ? (
          <>
            <StatusBadge tone={kind === "ai" ? "lavender" : "serious"} size="sm">
              {kind === "ai" ? "AI event" : "Routine alarm"}
            </StatusBadge>
            {alarm.handlingStatus ? (
              <StatusBadge tone="neutral" size="sm">
                {alarm.handlingStatus}
              </StatusBadge>
            ) : null}
          </>
        ) : null
      }
    >
      {alarm ? <EventDetailBody key={alarm.id} alarm={alarm} typeById={typeById} /> : null}
    </SlideOverPanel>
  );
}

function EventDetailBody({ alarm, typeById }: { alarm: AlarmDto; typeById: Map<number | undefined, AlarmTypeDto> }) {
  const pos = useMemo(() => alarmPosition(alarm), [alarm]);
  const bounds = useMemo(() => (pos ? snappedBounds([pos]) : null), [pos]);
  const image = safeMediaUrl(alarm.imageUrl);
  const video = safeMediaUrl(alarm.videoUrl);
  const type = typeById.get(alarm.alarmTypeId);

  return (
    <div className="space-y-6">
      <section aria-label="Evidence" className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3 text-[13px]">
        {image || video ? (
          <>
            <span className="text-ink-muted">Evidence from the vendor:</span>
            {image ? (
              <a href={image} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-info hover:underline">
                <ImageIcon className="size-3.5" aria-hidden /> Image <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            {video ? (
              <a href={video} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-info hover:underline">
                <FileVideo className="size-3.5" aria-hidden /> Video <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <ImageIcon className="size-3.5" aria-hidden /> No image or video attached to this alarm.
          </span>
        )}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <dl className="divide-y divide-line">
          <DetailRow label="Device">
            {alarm.deviceId !== undefined ? (
              <Link href={`/drive-vision/vehicles/${alarm.deviceId}`} className="hover:underline">
                {deviceLabel(alarm)}
              </Link>
            ) : (
              deviceLabel(alarm)
            )}
          </DetailRow>
          {alarm.terminalNo ? (
            <DetailRow label="Terminal">
              <span className="font-mono text-xs">{alarm.terminalNo}</span>
            </DetailRow>
          ) : null}
          <DetailRow label="Alarm type">{type?.label ? `${type.label}${type.code ? ` (${type.code})` : ""}` : alarm.alarmTypeId !== undefined ? `#${alarm.alarmTypeId}` : "—"}</DetailRow>
          <DetailRow label="Started">{alarm.alarmTime ? `${formatDateTime(alarm.alarmTime)} (${formatTimeWithSeconds(alarm.alarmTime)})` : "—"}</DetailRow>
          {alarm.endedAt ? <DetailRow label="Ended">{formatDateTime(alarm.endedAt)}</DetailRow> : null}
          {typeof alarm.durationSeconds === "number" ? <DetailRow label="Duration">{formatSeconds(alarm.durationSeconds)}</DetailRow> : null}
          <DetailRow label="Speed">{typeof alarm.speedKmh === "number" ? `${alarm.speedKmh} km/h` : "—"}</DetailRow>
          <DetailRow label="Coordinates">{pos ? <span className="text-xs tabular">{formatLatLon(pos)}</span> : "Not reported"}</DetailRow>
          <DetailRow label="Severity">
            {typeof alarm.severity === "number" ? <span title="The API doesn't document the severity scale, so it's shown as the raw value.">{alarm.severity} (raw)</span> : "—"}
          </DetailRow>
          <DetailRow label="Handling status">{alarm.handlingStatus ?? "—"}</DetailRow>
          {alarm.vendorAlarmTime ? <DetailRow label="Vendor time">{alarm.vendorAlarmTime}</DetailRow> : null}
          <DetailRow label="Reference">
            <span className="font-mono text-[11px] break-all text-ink-muted">
              #{alarm.id}
              {alarm.vendorAlarmId ? ` · vendor ${alarm.vendorAlarmId}` : ""}
            </span>
          </DetailRow>
        </dl>
        <div className="space-y-2">
          <div className="h-[220px] overflow-hidden rounded-2xl">
            {pos ? (
              <GeoMap
                ariaLabel="Alarm location"
                className="min-h-0"
                bounds={bounds}
                pins={[{ id: `alarm-${alarm.id}`, kind: "alarm", ...pos, title: alarmLabel(alarm, typeById) }]}
                focus={{ ...pos, zoom: 15 }}
                showLegend={false}
                dataNote="Alarm position from the API"
              />
            ) : (
              <EmptyState icon={MapPinOff} title="No position" description="This alarm has no usable coordinates." className="h-full bg-surface-muted py-6" />
            )}
          </div>
          {alarm.deviceId !== undefined ? (
            <Link href={`/drive-vision/trips?device=${alarm.deviceId}`} className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">
              <RouteIcon className="size-3.5" aria-hidden /> Track history for this device
            </Link>
          ) : null}
        </div>
      </div>

      <section aria-label="Handling" className="rounded-2xl border border-line">
        <UnavailableState title="Handling not available" reason={HANDLING_UNSUPPORTED} className="py-6" />
      </section>
    </div>
  );
}
