"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clock, Gauge, Info, ListOrdered, MapPinOff, Pause, Play, RotateCcw, Route as RouteIcon, SearchX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { TrackQuery } from "@/features/drive-vision/api/types";
import { isApiError } from "@/features/drive-vision/api/errors";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { DAY, HOUR } from "@/features/drive-vision/utils/time";
import { formatDateTime, formatNumber, formatSeconds, formatTimeWithSeconds } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { SegmentedControl, FilterSelect } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge } from "../shared/api-states";
import type { MapPin as TrackPin } from "../map/fleet-map";
import { GeoMap } from "../map/geo-map";
import { snappedBounds } from "../map/projection";
import { useFleetReference } from "../vehicles/use-fleet-reference";
import { MAX_TRACK_RANGE_MS, dateToIstInput, istInputToDate, prepareTrack, trackStats, validateRange, type TrackPoint } from "./track-model";

type Preset = "24h" | "3d" | "7d" | "custom";
const PRESETS: { value: Preset; label: string; ms?: number }[] = [
  { value: "24h", label: "24 h", ms: DAY },
  { value: "3d", label: "3 days", ms: 3 * DAY },
  { value: "7d", label: "7 days", ms: 7 * DAY },
  { value: "custom", label: "Custom" },
];
const POSITION_FILTERS: { value: NonNullable<TrackQuery["positionFilter"]>; label: string }[] = [
  { value: "LOCATED", label: "Located points" },
  { value: "ALL", label: "All points" },
  { value: "UNLOCATED", label: "Unlocated only" },
];
const PLAY_STEP_MS = 500;

/**
 * Trips & Tracking on GET /devices/{id}/track. The API returns raw track points, not trips,
 * so this screen shows the recorded points for one device and time range (≤ 7 days).
 * Playback steps through recorded points only — nothing is interpolated between them.
 */
export function TripsPage() {
  const params = useSearchParams();
  const ref = useFleetReference();
  const devicesQ = useApiQuery("tracks:devices", () => fleetService.listAllDevices());
  const devices = useMemo(() => devicesQ.data?.items ?? [], [devicesQ.data]);

  const linked = /^\d+$/.test(params.get("device") ?? "") ? Number(params.get("device")) : null;
  const [chosenId, setChosenId] = useState<number | null>(linked);
  const deviceId = chosenId ?? devices[0]?.id ?? null;

  const [now] = useState(() => new Date());
  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState(() => dateToIstInput(new Date(now.getTime() - DAY)));
  const [customTo, setCustomTo] = useState(() => dateToIstInput(now));
  const [positionFilter, setPositionFilter] = useState<NonNullable<TrackQuery["positionFilter"]>>("LOCATED");

  const presetMs = PRESETS.find((p) => p.value === preset)?.ms;
  const from = presetMs ? new Date(now.getTime() - presetMs) : istInputToDate(customFrom);
  const to = presetMs ? now : istInputToDate(customTo);
  const rangeError = validateRange(from, to, now);
  const fromIso = from?.toISOString();
  const toIso = to?.toISOString();

  const trackQ = useApiQuery(deviceId !== null && !rangeError ? `track:${deviceId}:${fromIso}:${toIso}:${positionFilter}` : null, () =>
    fleetService.track(deviceId!, { from: fromIso!, to: toIso!, positionFilter })
  );
  const prepared = useMemo(() => prepareTrack(trackQ.data?.data.points), [trackQ.data]);
  const stats = useMemo(() => trackStats(prepared.points), [prepared]);
  const track = trackQ.data?.data;

  // Playback over recorded points (index-based).
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trackKey, setTrackKey] = useState<unknown>(null);
  if (trackKey !== trackQ.data) {
    // New track → reset playback (adjust-state-during-render pattern).
    setTrackKey(trackQ.data);
    setCursor(0);
    setPlaying(false);
  }
  const last = Math.max(0, prepared.points.length - 1);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setCursor((c) => (c >= last ? c : c + 1)), PLAY_STEP_MS);
    return () => clearInterval(timer);
  }, [playing, last]);
  if (playing && cursor >= last) setPlaying(false);

  const current: TrackPoint | undefined = prepared.points[Math.min(cursor, last)];
  const played = prepared.plotted.filter((p) => current && p.time <= current.time);

  const boundsKey = useMemo(() => {
    const b = snappedBounds(prepared.plotted.map((p) => p.pos!));
    return b ? `${b.minLat}|${b.maxLat}|${b.minLon}|${b.maxLon}` : "";
  }, [prepared]);
  const bounds = useMemo(() => {
    if (!boundsKey) return null;
    const [minLat, maxLat, minLon, maxLon] = boundsKey.split("|").map(Number);
    return { minLat, maxLat, minLon, maxLon };
  }, [boundsKey]);

  const pins: TrackPin[] = [];
  const first = prepared.plotted[0];
  const final = prepared.plotted[prepared.plotted.length - 1];
  if (first) pins.push({ id: `p${first.index}`, kind: "start", ...first.pos!, title: `First point · ${formatDateTime(first.deviceTime!)}` });
  if (final && final !== first) pins.push({ id: `p${final.index}`, kind: "end", ...final.pos!, title: `Last point · ${formatDateTime(final.deviceTime!)}` });
  prepared.plotted
    .filter((p) => (p.stopSeconds ?? 0) > 0 && p !== first && p !== final)
    .forEach((p, i) => pins.push({ id: `p${p.index}`, kind: "stop", ...p.pos!, title: `Stopped ${formatSeconds(p.stopSeconds!)} · ${formatDateTime(p.deviceTime!)}`, glyph: String(i + 1) }));
  prepared.plotted.filter((p) => p.alarm).forEach((p) => pins.push({ id: `a${p.index}`, kind: "alarm", ...p.pos!, title: `${p.alarm} · ${formatDateTime(p.deviceTime!)}` }));

  const jumpToPin = (id: string) => {
    const index = Number(id.slice(1));
    const i = prepared.points.findIndex((p) => p.index === index);
    if (i >= 0) {
      setPlaying(false);
      setCursor(i);
    }
  };

  const device = devices.find((d) => d.id === deviceId);
  const noData = isApiError(trackQ.error) && trackQ.error.status === 503;
  const pct = (i: number) => (last ? (i / last) * 100 : 0);

  return (
    <div>
      <PageHeader
        eyebrow={<DataSourceBadge source={trackQ.data?.source ?? devicesQ.data?.source} />}
        title="Trips & Tracking"
        description={device ? `${device.name ?? `Device ${device.id}`} · ${device.terminalNo ?? ""} · recorded track points` : "Recorded track points per device"}
        actions={
          <>
            <Select
              value={deviceId === null ? undefined : String(deviceId)}
              onValueChange={(v) => setChosenId(Number(v))}
              disabled={!devices.length}
            >
              <SelectTrigger aria-label="Device" className="min-w-52">
                <SelectValue placeholder={devicesQ.error ? "Devices unavailable" : "Loading devices…"} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {[...new Set(devices.map((d) => d.groupId))].map((gid) => (
                  <SelectGroup key={String(gid)}>
                    <SelectLabel>{ref.group(gid)}</SelectLabel>
                    {devices
                      .filter((d) => d.groupId === gid)
                      .map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name ?? `Device ${d.id}`} · {d.terminalNo}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <SegmentedControl label="Time range" value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} />
          </>
        }
      />

      {preset === "custom" ? (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            From (IST)
            <Input type="datetime-local" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="mt-1 h-9 w-auto" aria-invalid={!!rangeError} />
          </label>
          <label className="text-xs text-ink-muted">
            To (IST)
            <Input type="datetime-local" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="mt-1 h-9 w-auto" aria-invalid={!!rangeError} />
          </label>
          <p className="pb-2 text-xs text-ink-muted">Up to {MAX_TRACK_RANGE_MS / DAY} days per request.</p>
        </div>
      ) : null}

      {devicesQ.error && !devicesQ.data ? (
        <Panel>
          <ApiErrorState error={devicesQ.error} onRetry={devicesQ.refetch} title="Couldn't load devices" />
        </Panel>
      ) : devicesQ.data && devices.length === 0 ? (
        <Panel>
          <EmptyState icon={SearchX} title="No devices" description="There are no devices to show a track for." />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section aria-label="Track points" className="order-2 flex min-w-0 flex-col rounded-card border border-line/70 bg-surface shadow-card xl:order-1 xl:h-[calc(100dvh-204px)] xl:min-h-[600px]">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="text-[13px] text-ink-muted" aria-live="polite">
                {track ? (
                  <>
                    <span className="font-semibold text-ink">{prepared.points.length}</span> point{prepared.points.length === 1 ? "" : "s"}
                  </>
                ) : (
                  "Track points"
                )}
              </p>
              <FilterSelect label="Position filter" value={positionFilter} onChange={setPositionFilter} options={POSITION_FILTERS} className="h-8 w-40 text-xs" />
            </div>
            {track && (prepared.withoutPosition || prepared.withoutTime || prepared.reordered) ? (
              <p className="mx-4 mt-3 flex gap-1.5 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                {[
                  prepared.withoutPosition ? `${prepared.withoutPosition} without a usable position (listed, not drawn)` : null,
                  prepared.withoutTime ? `${prepared.withoutTime} without a time (skipped)` : null,
                  prepared.reordered ? "re-sorted by time" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {track ? (
              <ol className="scrollbar-thin max-h-[420px] min-h-0 flex-1 overflow-y-auto p-2 xl:max-h-none">
                {prepared.points.map((p, i) => (
                  <li key={p.index}>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaying(false);
                        setCursor(i);
                      }}
                      aria-current={i === cursor ? "true" : undefined}
                      className={cn("w-full rounded-xl px-3 py-2 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none", i === cursor ? "bg-ink text-white" : "hover:bg-surface-muted")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold tabular">{formatDateTime(p.deviceTime!)}</span>
                        <span className="tabular">{typeof p.speedKmh === "number" ? `${p.speedKmh} km/h` : "—"}</span>
                      </span>
                      <span className={cn("mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px]", i === cursor ? "text-white/70" : "text-ink-muted")}>
                        {p.pos ? `${p.pos.lat.toFixed(5)}, ${p.pos.lon.toFixed(5)}` : <span className="font-sans text-warning">no usable position</span>}
                        {(p.stopSeconds ?? 0) > 0 ? <span className="font-sans">stopped {formatSeconds(p.stopSeconds!)}</span> : null}
                        {p.alarm ? <span className="font-sans text-danger">{p.alarm}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : trackQ.loading ? (
              <LoadingSkeleton variant="list" rows={6} />
            ) : null}
          </section>

          <div className="order-1 min-w-0 space-y-4 xl:order-2">
            {rangeError ? (
              <Panel>
                <EmptyState icon={Clock} title="Adjust the time range" description={rangeError} />
              </Panel>
            ) : trackQ.error && !trackQ.data ? (
              <Panel>
                <ApiErrorState error={trackQ.error} onRetry={trackQ.refetch} title={noData ? "No track available for this range" : "Couldn't load the track"} />
                {noData ? <p className="-mt-4 px-6 pb-8 text-center text-xs text-ink-muted">This server answers 503 when it has no stored points for the range, so this may simply mean the device recorded nothing. Try a longer range (up to 7 days).</p> : null}
              </Panel>
            ) : !track ? (
              <Panel>
                <LoadingSkeleton variant="chart" className="h-[46vh] min-h-[360px]" />
              </Panel>
            ) : prepared.points.length === 0 ? (
              <Panel>
                <EmptyState icon={RouteIcon} title="No points in this range" description="The server returned an empty track for this device and time range." />
              </Panel>
            ) : (
              <>
                <Panel className="p-2">
                  <div className="h-[46vh] min-h-[360px]">
                    {prepared.plotted.length ? (
                      <GeoMap
                        ariaLabel="Recorded track"
                        className="min-h-0"
                        bounds={bounds}
                        routes={prepared.plotted.length > 1 ? [{ id: "track", points: prepared.plotted.map((p) => p.pos!), color: "var(--dv-series-2)", progress: played.length > 0 ? (played.length - 1) / Math.max(1, prepared.plotted.length - 1) : 0 }] : []}
                        pins={pins}
                        activePinId={current ? `p${current.index}` : null}
                        onPinClick={jumpToPin}
                        markers={
                          current?.pos
                            ? [{ id: "cursor", ...current.pos, color: "var(--dv-ink)", statusLabel: "Selected point", heading: current.directionDeg, showHeading: (current.speedKmh ?? 0) > 0, label: formatTimeWithSeconds(current.deviceTime!) }]
                            : []
                        }
                        selectedId="cursor"
                        fitPoints={prepared.plotted.map((p) => p.pos!)}
                        fitKey={`${deviceId}|${fromIso}|${toIso}|${positionFilter}`}
                        showLegend={false}
                        dataNote="Recorded points from the API"
                      />
                    ) : (
                      <EmptyState icon={MapPinOff} title="Nothing to draw" description="None of the returned points has a usable position." className="h-full" />
                    )}
                  </div>
                </Panel>

                <Panel className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!playing && cursor >= last) setCursor(0);
                        setPlaying((p) => !p);
                      }}
                      disabled={last === 0}
                      className="grid size-11 place-items-center rounded-full bg-ink text-white shadow-[0_6px_14px_-8px_rgb(31_30_38/0.55)] transition-[background-color,transform] duration-150 ease-dv hover:bg-ink/85 focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none active:scale-95 active:duration-75 disabled:opacity-45"
                      aria-label={playing ? "Pause playback" : "Play through points"}
                    >
                      {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
                    </button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full"
                      onClick={() => {
                        setPlaying(false);
                        setCursor(0);
                      }}
                      aria-label="Back to first point"
                    >
                      <RotateCcw />
                    </Button>
                    <div>
                      <p className="font-mono text-[15px] font-semibold tabular">{current ? formatTimeWithSeconds(current.deviceTime!) : "—"}</p>
                      <p className="text-xs text-ink-muted">
                        Point {Math.min(cursor, last) + 1} of {prepared.points.length}
                        {typeof current?.speedKmh === "number" ? ` · ${current.speedKmh} km/h` : ""}
                        {typeof current?.batteryPct === "number" ? ` · battery ${current.batteryPct}%` : ""}
                      </p>
                    </div>
                    <p className="ml-auto max-w-56 text-right text-[11px] text-ink-subtle">Steps through recorded points; positions between points aren&apos;t interpolated.</p>
                  </div>
                  <div className="relative mt-4">
                    <div className="relative h-2 rounded-full bg-surface-muted">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--dv-series-2)]" style={{ width: `${pct(cursor)}%` }} />
                      <input
                        type="range"
                        min={0}
                        max={last}
                        step={1}
                        value={Math.min(cursor, last)}
                        disabled={last === 0}
                        onChange={(e) => {
                          setPlaying(false);
                          setCursor(Number(e.target.value));
                        }}
                        aria-label="Track point"
                        aria-valuetext={current ? `${formatDateTime(current.deviceTime!)}` : undefined}
                        className="absolute -inset-y-2 inset-x-0 h-6 w-full cursor-pointer opacity-0 disabled:cursor-default"
                      />
                      <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--dv-series-2)] shadow" style={{ left: `${pct(cursor)}%` }} aria-hidden />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-ink-muted tabular">
                      <span>{prepared.points[0] ? formatDateTime(prepared.points[0].deviceTime!) : ""}</span>
                      <span>{prepared.points[last] && last > 0 ? formatDateTime(prepared.points[last].deviceTime!) : ""}</span>
                    </div>
                  </div>
                  {current ? (
                    <p className="mt-3 text-[11px] text-ink-subtle" title="Returned by the API; meanings aren't documented, so they aren't interpreted.">
                      Raw codes (undocumented): run state {current.runState ?? "—"} · position state {current.positionState ?? "—"} · point type {current.pointType ?? "—"}
                    </p>
                  ) : null}
                </Panel>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { icon: ListOrdered, label: "Points (server count)", value: String(track.pointCount ?? prepared.points.length), hint: undefined },
                    {
                      icon: RouteIcon,
                      label: "Distance",
                      value: typeof track.relativeMileageKm === "number" ? `${formatNumber(track.relativeMileageKm)} km` : stats.odometerSpanKm !== null ? `${formatNumber(stats.odometerSpanKm)} km` : "—",
                      hint: typeof track.relativeMileageKm === "number" ? "relativeMileageKm from the API" : stats.odometerSpanKm !== null ? "Odometer difference, first → last point" : "Not provided (needs ≥ 2 odometer readings)",
                    },
                    { icon: Gauge, label: "Max reported speed", value: stats.maxSpeed !== null ? `${stats.maxSpeed} km/h` : "—", hint: "Highest speedKmh among returned points" },
                    {
                      icon: Clock,
                      label: "Recorded span",
                      value: track.firstTime && track.lastTime ? (new Date(track.lastTime).getTime() - new Date(track.firstTime).getTime() < HOUR ? formatSeconds(Math.round((new Date(track.lastTime).getTime() - new Date(track.firstTime).getTime()) / 1000)) : `${formatNumber(Math.round(((new Date(track.lastTime).getTime() - new Date(track.firstTime).getTime()) / HOUR) * 10) / 10)} h`) : "—",
                      hint: track.firstTime ? `${formatDateTime(track.firstTime)} → ${track.lastTime ? formatDateTime(track.lastTime) : "—"}` : undefined,
                    },
                  ].map((s) => (
                    <Panel key={s.label} className="px-4 py-3.5" title={s.hint}>
                      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <s.icon className="size-3.5" aria-hidden /> {s.label}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold tabular">{s.value}</p>
                      {s.hint ? <p className="truncate text-[11px] text-ink-subtle">{s.hint}</p> : null}
                    </Panel>
                  ))}
                </div>

                {pins.some((p) => p.kind === "alarm") ? (
                  <Panel className="flex flex-wrap gap-2 px-5 py-4">
                    {prepared.plotted
                      .filter((p) => p.alarm)
                      .map((p) => (
                        <button key={p.index} type="button" onClick={() => jumpToPin(`a${p.index}`)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-muted">
                          <TriangleAlert className="size-3 text-danger" aria-hidden />
                          {p.alarm} · {formatTimeWithSeconds(p.deviceTime!)}
                        </button>
                      ))}
                  </Panel>
                ) : null}
              </>
            )}
            <p className="flex items-start gap-1.5 px-1 text-xs text-ink-muted">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden /> The API provides raw track points, not detected trips, so trip lists, idle time and trip summaries aren&apos;t shown.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
