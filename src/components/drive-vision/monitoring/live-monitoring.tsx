"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { BellRing, MapPinOff, Radio, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { DeviceStateDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatRelative, formatTime } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import type { MapMarker } from "../map/fleet-map";
import { GeoMap } from "../map/geo-map";
import { snappedBounds } from "../map/projection";
import { PageHeader } from "../shared/page-header";
import { FilterSelect, SearchInput, SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge, apiErrorMeta } from "../shared/api-states";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { useFleetReference } from "../vehicles/use-fleet-reference";
import { LiveDevicePanel } from "./live-device-panel";
import { REALTIME_POLL_MS, REPORT_AGE_META, checkPosition, reportAge, type ReportAge } from "./live-fleet-model";

type AgeFilter = ReportAge | "all" | "nopos";
const AGE_FILTERS: AgeFilter[] = ["all", "current", "recent", "stale", "nopos"];

/**
 * Live Monitoring on GET /monitor/realtime, polled every REALTIME_POLL_MS while the tab is visible.
 * Group names come from GET /devices (groupId) + GET /groups; DeviceStateDto itself has no group.
 * There is no real base map yet: positions are plotted on a coordinate grid fitted to the data.
 */
export function LiveMonitoring() {
  const params = useSearchParams();
  const ref = useFleetReference();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("all");
  const [age, setAge] = useState<AgeFilter>("all");
  const [alarmsOnly, setAlarmsOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(() => (/^\d+$/.test(params.get("vehicle") ?? "") ? Number(params.get("vehicle")) : null));

  const realtimeQ = useApiQuery("monitor:realtime", () => fleetService.realtime());
  const devicesQ = useApiQuery("monitor:devices", () => fleetService.listAllDevices());

  // "Now" advances with each response so report ages stay honest between polls.
  const [mountedAt] = useState(() => new Date());
  const now = useMemo(() => (realtimeQ.updatedAt ? new Date(realtimeQ.updatedAt) : mountedAt), [realtimeQ.updatedAt, mountedAt]);

  // Poll while visible; skip a tick if the previous request is still running.
  const busy = useRef(false);
  useEffect(() => {
    busy.current = realtimeQ.loading || realtimeQ.refreshing;
  }, [realtimeQ.loading, realtimeQ.refreshing]);
  const { refetch } = realtimeQ;
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !busy.current) refetch();
    }, REALTIME_POLL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, refetch]);

  const groupOf = useMemo(() => new Map((devicesQ.data?.items ?? []).map((d) => [d.id, d.groupId])), [devicesQ.data]);
  const states = useMemo(() => [...(realtimeQ.data?.data.devices ?? [])].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), [realtimeQ.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return states.filter((s) => {
      if (q && !`${s.name ?? ""} ${s.terminalNo ?? ""}`.toLowerCase().includes(q)) return false;
      if (groupId !== "all" && String(groupOf.get(s.deviceId) ?? "") !== groupId) return false;
      if (alarmsOnly && !s.activeAlarm) return false;
      if (age === "nopos") return !checkPosition(s).ok;
      if (age !== "all" && reportAge(s, now) !== age) return false;
      return true;
    });
  }, [states, search, groupId, groupOf, alarmsOnly, age, now]);

  const selected = states.find((s) => s.deviceId === selectedId) ?? null;

  const markers: MapMarker[] = useMemo(() => {
    const list = selected && !visible.includes(selected) ? [...visible, selected] : visible;
    return list.flatMap((s) => {
      const pos = checkPosition(s);
      if (!pos.ok) return [];
      const a = reportAge(s, now);
      return [
        {
          id: String(s.deviceId),
          lat: pos.lat,
          lon: pos.lon,
          color: REPORT_AGE_META[a].color,
          statusLabel: REPORT_AGE_META[a].label,
          heading: s.directionDeg,
          showHeading: a === "current" && (s.speedKmh ?? 0) > 0,
          label: s.name ?? s.terminalNo ?? `Device ${s.deviceId}`,
          alarm: !!s.activeAlarm,
        },
      ];
    });
  }, [visible, selected, now]);

  // Bounds snap to a 0.25° grid so polling doesn't shift the view unless a device leaves the area.
  const boundsKey = useMemo(() => {
    const b = snappedBounds(markers);
    return b ? `${b.minLat}|${b.maxLat}|${b.minLon}|${b.maxLon}` : "";
  }, [markers]);
  const bounds = useMemo(() => {
    if (!boundsKey) return null;
    const [minLat, maxLat, minLon, maxLon] = boundsKey.split("|").map(Number);
    return { minLat, maxLat, minLon, maxLon };
  }, [boundsKey]);
  const fitPoints = useMemo(() => markers.map((m) => ({ lat: m.lat, lon: m.lon })), [markers]);
  const selectedPos = selected ? checkPosition(selected) : null;
  const focus = selectedPos?.ok ? { lat: selectedPos.lat, lon: selectedPos.lon } : null;

  const ageCount = (a: AgeFilter) => (a === "nopos" ? states.filter((s) => !checkPosition(s).ok).length : states.filter((s) => reportAge(s, now) === a).length);
  const counts = realtimeQ.data?.data;
  const unplotted = visible.filter((s) => !checkPosition(s).ok).length;

  return (
    <div>
      <PageHeader
        eyebrow={<DataSourceBadge source={realtimeQ.data?.source} />}
        title="Live Monitoring"
        description={
          counts
            ? `${counts.onlineCount ?? 0} online · ${counts.offlineCount ?? 0} offline (server counts) · updated ${formatTime(now)}`
            : realtimeQ.error
              ? "Couldn't load live positions"
              : "Loading live positions…"
        }
        actions={
          <>
            <label className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-medium">
              <Radio className={cn("size-4", autoRefresh ? "text-success" : "text-ink-subtle")} aria-hidden />
              Auto-refresh · {Math.round(REALTIME_POLL_MS / 1000)} s
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label={`Refresh positions every ${Math.round(REALTIME_POLL_MS / 1000)} seconds`} />
            </label>
            <Button variant="outline" onClick={refetch} disabled={realtimeQ.loading || realtimeQ.refreshing} aria-label="Refresh positions now">
              <RefreshCw className={cn(realtimeQ.refreshing && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      {realtimeQ.error && realtimeQ.data ? (
        <p className="mb-3 flex flex-wrap items-center gap-x-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert" title={apiErrorMeta(realtimeQ.error) ?? undefined}>
          Last refresh failed: {describeApiError(realtimeQ.error)} Showing positions from {formatTime(now)}.
          <span className="font-mono opacity-75">{apiErrorMeta(realtimeQ.error)}</span>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[372px_minmax(0,1fr)]">
        <section aria-label="Vehicle list" className="order-2 flex min-h-0 min-w-0 flex-col rounded-card border border-line/70 bg-surface shadow-card lg:order-1 lg:h-[calc(100dvh-204px)] lg:min-h-[540px]">
          <div className="space-y-2.5 border-b border-line p-4">
            <SearchInput value={search} onChange={setSearch} label="Search vehicles" placeholder="Name or device ID" className="sm:max-w-none" />
            <SegmentedControl
              size="sm"
              label="Report age filter"
              value={age}
              onChange={setAge}
              options={AGE_FILTERS.map((a) => ({
                value: a,
                label: a === "all" ? "All" : a === "nopos" ? "No position" : REPORT_AGE_META[a].short,
                count: a === "all" ? undefined : ageCount(a),
              }))}
              className="w-full"
            />
            <div className="flex items-center gap-2">
              <FilterSelect
                label="Group"
                value={groupId}
                onChange={setGroupId}
                options={[{ value: "all", label: "All groups" }, ...ref.groups.map((g) => ({ value: String(g.id), label: g.name ?? `Group ${g.id}` }))]}
                className="h-9 min-w-0 flex-1"
              />
              <label className={cn("flex h-9 shrink-0 items-center gap-2 rounded-xl border px-2.5 text-xs font-medium", alarmsOnly ? "border-danger/30 bg-danger-soft text-danger" : "border-line text-ink-muted")}>
                <BellRing className="size-3.5" aria-hidden />
                Alarms
                <Switch checked={alarmsOnly} onCheckedChange={setAlarmsOnly} aria-label="Show only devices reporting an active alarm" className="scale-90" />
              </label>
            </div>
          </div>
          <p className="px-4 pt-3 pb-1 text-xs text-ink-muted" aria-live="polite">
            {realtimeQ.data ? `${visible.length} device${visible.length === 1 ? "" : "s"}${unplotted ? ` · ${unplotted} without a usable position` : ""}` : ""}
          </p>
          {realtimeQ.error && !realtimeQ.data ? (
            <ApiErrorState error={realtimeQ.error} onRetry={refetch} compact />
          ) : !realtimeQ.data ? (
            <LoadingSkeleton variant="list" rows={6} />
          ) : visible.length === 0 ? (
            <EmptyState icon={SearchX} title={states.length ? "No devices match" : "No devices reported"} description={states.length ? "Clear the search or change the filters." : "The realtime feed returned no devices."} className="py-10" />
          ) : (
            <ul className="scrollbar-thin max-h-[420px] min-h-0 flex-1 overflow-y-auto px-2 pb-2 lg:max-h-none">
              {visible.map((s) => (
                <DeviceRow key={s.deviceId} state={s} active={s.deviceId === selectedId} now={now} groupName={ref.group(groupOf.get(s.deviceId))} onSelect={() => setSelectedId(s.deviceId === selectedId ? null : (s.deviceId ?? null))} />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Live map" className="order-1 h-[62vh] min-h-[420px] min-w-0 rounded-card border border-line/70 bg-surface p-2 shadow-card lg:order-2 lg:h-[calc(100dvh-204px)] lg:min-h-[540px]">
          {realtimeQ.error && !realtimeQ.data ? (
            <ApiErrorState error={realtimeQ.error} onRetry={refetch} className="h-full" />
          ) : !realtimeQ.data ? (
            <LoadingSkeleton variant="chart" className="h-full" />
          ) : markers.length === 0 ? (
            <EmptyState icon={MapPinOff} title="Nothing to plot" description={states.length ? "None of the matching devices reported a usable position." : "The realtime feed returned no devices."} className="h-full" />
          ) : (
            <GeoMap
              ariaLabel="Live device positions"
              markers={markers}
              selectedId={selectedId === null ? null : String(selectedId)}
              onMarkerClick={(id) => setSelectedId(String(selectedId) === id ? null : Number(id))}
              cluster
              bounds={bounds}
              fitPoints={fitPoints}
              fitKey={`${age}|${groupId}|${alarmsOnly}|${search}`}
              focus={focus}
              controlsPosition="left"
              focusPadRight={selected ? 356 : 0}
              legend={(["current", "recent", "stale"] as const).map((a) => ({ label: REPORT_AGE_META[a].short, color: REPORT_AGE_META[a].color }))}
              dataNote="Positions from API coordinates"
            >
              <AnimatePresence>{selected ? <LiveDevicePanel state={selected} groupName={ref.group(groupOf.get(selected.deviceId))} now={now} onClose={() => setSelectedId(null)} /> : null}</AnimatePresence>
            </GeoMap>
          )}
        </section>
      </div>
    </div>
  );
}

function DeviceRow({ state, active, now, groupName, onSelect }: { state: DeviceStateDto; active: boolean; now: Date; groupName: string; onSelect: () => void }) {
  const a = reportAge(state, now);
  const meta = REPORT_AGE_META[a];
  const pos = checkPosition(state);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          active ? "bg-ink text-white" : "hover:bg-surface-muted"
        )}
      >
        <span className="relative grid size-9 shrink-0 place-items-center rounded-full" style={{ background: active ? "rgb(255 255 255 / 0.12)" : `color-mix(in oklab, ${meta.color} 16%, white)` }}>
          {pos.ok ? <Radio className="size-4" style={{ color: active ? "white" : meta.color }} aria-hidden /> : <MapPinOff className="size-4" style={{ color: active ? "white" : "var(--dv-warning)" }} aria-hidden />}
          {state.activeAlarm ? <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-danger" aria-label="Active alarm" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold">{state.name ?? `Device ${state.deviceId}`}</span>
            <span className={cn("shrink-0 text-xs tabular", active ? "text-white/80" : "text-ink-muted")}>{state.deviceTime ? formatRelative(state.deviceTime, now) : "no time"}</span>
          </span>
          <span className={cn("block truncate text-xs", active ? "text-white/70" : "text-ink-muted")}>
            {[state.terminalNo, groupName !== "—" ? groupName : null, typeof state.speedKmh === "number" ? `${state.speedKmh} km/h` : null, pos.ok ? null : pos.reason].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}
