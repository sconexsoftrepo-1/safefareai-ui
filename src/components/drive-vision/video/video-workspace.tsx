"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Download, ExternalLink, Film, Info, RefreshCw, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { ExportRequest, RecordingDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDate, formatDateTime, formatTime } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { FilterBar, FilterSelect } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, UnavailableState } from "../shared/api-states";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import { safeHttpUrl } from "../reports/reports-model";
import { RecordingCalendar } from "./recording-calendar";
import { calendarDayKeys, channelOptions, exportRequestFor, istDayKey, istDayRange } from "./video-model";

const EXPORT_PAGE_SIZE = 10;

/**
 * Historical Video on live BFF data: recording calendar (GET /devices/{id}/recording-calendar),
 * the day's recordings (GET /devices/{id}/recordings) and clip exports (GET/POST /video/exports).
 * In-browser playback needs the vendor video SDK, which isn't available to this app yet, so
 * GET /video/sdk-token is never requested.
 */
export function VideoWorkspace() {
  const params = useSearchParams();
  const linked = /^\d+$/.test(params.get("device") ?? "") ? Number(params.get("device")) : null;
  const [now] = useState(() => new Date());
  const today = istDayKey(now);
  const [deviceId, setDeviceId] = useState<number | null>(linked);
  const [channel, setChannel] = useState("all");
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [exportPage, setExportPage] = useState(1);
  const [pendingExport, setPendingExport] = useState<ExportRequest | null>(null);

  const devicesQ = useApiQuery("video:devices", () => fleetService.listAllDevices());
  const devices = useMemo(() => (devicesQ.data?.items ?? []).filter((d) => d.id !== undefined), [devicesQ.data]);
  const device = devices.find((d) => d.id === deviceId);
  const channels = channelOptions(device);

  const calendarQ = useApiQuery(deviceId !== null ? `video:calendar:${deviceId}:${month}` : null, () => fleetService.recordingCalendar(deviceId!, month));
  const recordedKeys = useMemo(() => calendarDayKeys(month, calendarQ.data?.items), [month, calendarQ.data]);
  const range = istDayRange(day);
  const recQ = useApiQuery(deviceId !== null ? `video:recordings:${deviceId}:${day}:${channel}` : null, () =>
    fleetService.recordings(deviceId!, { ...range, channel: channel === "all" ? undefined : Number(channel) })
  );
  const exportsQ = useApiQuery(deviceId !== null ? `video:exports:${deviceId}:${exportPage}` : null, () => fleetService.listExports({ deviceId: deviceId!, pageNumber: exportPage, pageSize: EXPORT_PAGE_SIZE }));

  const recordings = useMemo(() => [...(recQ.data?.items ?? [])].sort((a, b) => (a.beginTime ?? "").localeCompare(b.beginTime ?? "")), [recQ.data]);
  const is503 = (e: unknown) => isApiError(e) && e.status === 503;

  function pickDevice(v: string) {
    setDeviceId(v === "none" ? null : Number(v));
    setChannel("all");
    setExportPage(1);
  }

  async function confirmExport() {
    if (!pendingExport) return;
    try {
      const job = await fleetService.requestExport(pendingExport);
      toast.success("Clip export requested", { description: job.status ? `Server status: ${job.status}` : undefined });
      exportsQ.refetch();
    } catch (err) {
      toast.error("The server didn't accept the export", { description: describeApiError(err) });
    }
  }

  return (
    <div>
      <PageHeader
        title="Historical Video"
        description={device ? `${device.name ?? `Device ${device.id}`} · ${formatDate(range.from)}` : "Choose a device to see its recordings"}
        actions={
          deviceId !== null ? (
            <Button variant="outline" onClick={() => (calendarQ.refetch(), recQ.refetch(), exportsQ.refetch())} disabled={recQ.loading}>
              <RefreshCw className={recQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
          ) : undefined
        }
      />

      <FilterBar className="mb-3">
        <FilterSelect
          label="Device"
          value={deviceId === null ? "none" : String(deviceId)}
          onChange={pickDevice}
          options={[
            { value: "none", label: devicesQ.data ? "Choose a device" : "Loading devices…" },
            ...devices.map((d) => ({ value: String(d.id), label: `${d.name ?? `Device ${d.id}`}${typeof d.cameraCount === "number" ? ` · ${d.cameraCount} cam` : ""}` })),
          ]}
          className="max-w-64"
        />
        <FilterSelect label="Channel" value={channel} onChange={setChannel} options={[{ value: "all", label: "All channels" }, ...channels.map((c) => ({ value: String(c), label: `Channel ${c}` }))]} />
      </FilterBar>
      {devicesQ.error ? <ApiErrorState error={devicesQ.error} onRetry={devicesQ.refetch} title="Couldn't load devices" compact className="mb-3" /> : null}

      {deviceId === null ? (
        <Panel>
          <EmptyState icon={Film} title="No device selected" description="Pick a device to load its recording calendar from the server." />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="space-y-4">
            <Panel className="p-4">
              <RecordingCalendar
                selectedKey={day}
                onSelect={setDay}
                recordedKeys={recordedKeys}
                todayKey={today}
                month={month}
                onMonthChange={setMonth}
                footer={
                  calendarQ.error ? (
                    <span className="text-danger">{is503(calendarQ.error) ? "Calendar unavailable (HTTP 503)" : describeApiError(calendarQ.error)}</span>
                  ) : !calendarQ.data ? (
                    "Loading recorded days…"
                  ) : undefined
                }
              />
              {calendarQ.error ? (
                <Button variant="ghost" size="sm" className="mt-1" onClick={calendarQ.refetch}>
                  Try again
                </Button>
              ) : null}
            </Panel>
            <Panel>
              <UnavailableState
                title="Playback not available yet"
                reason="Watching recordings in the browser needs the vendor's video SDK, which hasn't been provided to this app. Request a clip export below to get a downloadable file."
                className="py-6"
              />
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel className="overflow-hidden">
              <PanelHeader title="Recordings" description={`${formatDate(range.from)} (IST)${channel !== "all" ? ` · channel ${channel}` : ""}`} />
              {recQ.error ? (
                <>
                  <ApiErrorState error={recQ.error} onRetry={recQ.refetch} title={is503(recQ.error) ? "Recordings unavailable" : undefined} compact />
                  {is503(recQ.error) ? <p className="-mt-2 px-6 pb-6 text-center text-xs text-ink-muted">The server answers 503 both when the device platform is unreachable and when nothing is stored, so this isn&apos;t shown as “no recordings”.</p> : null}
                </>
              ) : !recQ.data ? (
                <LoadingSkeleton variant="list" rows={5} />
              ) : recordings.length === 0 ? (
                <EmptyState icon={Clapperboard} title="No recordings" description="The server returned no recordings for this day." />
              ) : (
                <ul className="divide-y divide-line">
                  {recordings.map((r, i) => (
                    <RecordingRow key={r.id ?? i} rec={r} onExport={(req) => setPendingExport(req)} deviceId={deviceId} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader
                title="Clip exports"
                description="Jobs requested for this device"
                action={
                  exportsQ.data && exportsQ.data.total > EXPORT_PAGE_SIZE ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={exportPage <= 1} onClick={() => setExportPage((p) => p - 1)}>
                        Prev
                      </Button>
                      <span className="text-xs text-ink-muted tabular">
                        {exportPage} / {Math.ceil(exportsQ.data.total / EXPORT_PAGE_SIZE)}
                      </span>
                      <Button variant="ghost" size="sm" disabled={exportPage * EXPORT_PAGE_SIZE >= exportsQ.data.total} onClick={() => setExportPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  ) : undefined
                }
              />
              {exportsQ.error ? (
                <ApiErrorState error={exportsQ.error} onRetry={exportsQ.refetch} compact />
              ) : !exportsQ.data ? (
                <LoadingSkeleton variant="list" rows={3} />
              ) : exportsQ.data.items.length === 0 ? (
                <EmptyState icon={Download} title="No exports" description="No clip exports have been requested for this device." className="py-8" />
              ) : (
                <ul className="divide-y divide-line">
                  {exportsQ.data.items.map((x, i) => {
                    const url = safeHttpUrl(x.url);
                    return (
                      <li key={x.id ?? i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
                        <span className="tabular">
                          {x.startTime ? formatDateTime(x.startTime) : "—"} → {x.endTime ? formatTime(x.endTime) : "—"}
                        </span>
                        <span className="text-ink-muted">Ch {x.channel ?? "—"}</span>
                        <StatusBadge size="sm" tone="neutral">
                          {x.status ?? "No status"}
                        </StatusBadge>
                        {x.error ? <span className="text-xs text-danger">{x.error}</span> : null}
                        <span className="ml-auto">
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-deep hover:underline">
                              Download <ExternalLink className="size-3.5" aria-hidden />
                            </a>
                          ) : x.url ? (
                            <span className="text-xs text-ink-subtle" title="The server returned a link that can't be opened (placeholder or non-web address)">
                              Link not usable
                            </span>
                          ) : (
                            <span className="text-xs text-ink-subtle">No file yet</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <p className="flex items-start gap-1.5 px-1 text-xs text-ink-muted">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>Export status values are shown exactly as the server reports them; their meanings aren&apos;t documented.</span>
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingExport !== null}
        onOpenChange={(o) => !o && setPendingExport(null)}
        tone="default"
        title="Request a clip export?"
        description={
          pendingExport
            ? `Asks the device platform to upload channel ${pendingExport.channel} from ${formatDateTime(pendingExport.from)} to ${formatTime(pendingExport.to)}. This may use the device's mobile data.`
            : undefined
        }
        confirmLabel="Request export"
        onConfirm={confirmExport}
      />
    </div>
  );
}

function RecordingRow({ rec, deviceId, onExport }: { rec: RecordingDto; deviceId: number; onExport: (req: ExportRequest) => void }) {
  const req = exportRequestFor(rec, deviceId);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
      <span className="font-medium tabular">
        {rec.beginTime ? formatTime(rec.beginTime) : "—"} – {rec.endTime ? formatTime(rec.endTime) : "—"}
      </span>
      <span className="text-ink-muted">Channel {rec.channel ?? "—"}</span>
      {typeof rec.fileSizeMb === "number" ? <span className="text-ink-muted tabular">{rec.fileSizeMb} MB</span> : null}
      <Button variant="outline" size="sm" className={cn("ml-auto")} disabled={!req} title={req ? undefined : "Missing channel or times"} onClick={() => req && onExport(req)}>
        <Scissors /> Export clip
      </Button>
    </li>
  );
}
