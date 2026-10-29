"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ChevronRight, FolderPlus, Info, Plus, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { DeviceDto, DeviceStateDto } from "@/features/drive-vision/api/types";
import { isApiError } from "@/features/drive-vision/api/errors";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { expiryStatus } from "@/features/drive-vision/services/vehicle-service";
import { formatDateTime, formatRelative } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SearchInput, SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge } from "../shared/api-states";
import { transitions } from "../shared/motion";
import { ExpiryBadge } from "./vehicle-cells";
import { useFleetReference } from "./use-fleet-reference";

type ExpiryFilter = "all" | "soon" | "expired";

/** API default page size for GET /devices. */
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
export const WRITES_PENDING = "Adding, editing, moving and deleting devices is disabled until write operations are approved.";

/**
 * Vehicles & Assets on live BFF data.
 * - Table: server-paged GET /devices with `keyword` and `groupId` (the API has no sort parameter, so columns aren't sortable).
 * - Expiry filter and asset tree need every device, so they fetch all pages and filter in the browser.
 * - Last report comes from GET /monitor/realtime for the devices on screen.
 */
export function VehiclesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = useFleetReference();
  const [now] = useState(() => new Date());

  const [view, setView] = useState<"table" | "tree">("table");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [groupId, setGroupId] = useState(() => (/^\d+$/.test(params.get("group") ?? "") ? params.get("group")! : "all"));
  const initialExpiry = params.get("expiry");
  const [expiry, setExpiry] = useState<ExpiryFilter>(initialExpiry === "soon" || initialExpiry === "expired" ? initialExpiry : "all");
  const [page, setPage] = useState(1);

  // Debounce typing so each keystroke doesn't hit the server; a new search starts at page 1.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => {
      setKeyword(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, keyword]);

  const query = useMemo(() => ({ groupId: groupId === "all" ? undefined : Number(groupId), keyword: keyword || undefined }), [groupId, keyword]);
  const needsAll = view === "tree" || expiry !== "all";
  const filterKey = `${query.groupId ?? "*"}:${query.keyword ?? ""}`;

  const pageQ = useApiQuery(needsAll ? null : `vehicles:page:${filterKey}:${page}`, () => fleetService.listDevices({ ...query, pageNumber: page, pageSize: PAGE_SIZE }));
  const allQ = useApiQuery(needsAll ? `vehicles:all:${filterKey}` : null, () => fleetService.listAllDevices(query));
  const active = needsAll ? allQ : pageQ;

  const devices = useMemo(() => {
    const list = active.data?.items ?? [];
    return expiry === "all" ? list : list.filter((d) => expiryStatus(d.expiresAt, now) === expiry);
  }, [active.data, expiry, now]);

  // Latest state only for the devices on screen (one realtime request per page / filter).
  const visibleIds = useMemo(() => (needsAll && view === "table" ? devices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : devices).map((d) => d.id!).filter((id) => id !== undefined), [devices, needsAll, view, page]);
  const realtimeQ = useApiQuery(visibleIds.length ? `vehicles:realtime:${visibleIds.join(",")}` : null, () => fleetService.realtime(visibleIds));
  const stateById = useMemo(() => new Map((realtimeQ.data?.data.devices ?? []).map((s) => [s.deviceId, s])), [realtimeQ.data]);

  const filtersActive = !!keyword || groupId !== "all" || expiry !== "all";
  const clearFilters = () => {
    setSearchInput("");
    setKeyword("");
    setGroupId("all");
    setExpiry("all");
    setPage(1);
  };

  const columns: DataTableColumn<DeviceDto>[] = [
    {
      id: "vehicle",
      header: "Vehicle",
      cell: (d) => (
        <div className="min-w-0">
          <p className="font-semibold">{d.name ?? `Device ${d.id}`}</p>
          <p className="font-mono text-[11px] text-ink-muted tabular">{d.terminalNo ?? "—"}</p>
        </div>
      ),
    },
    { id: "model", header: "Model", hideBelow: "md", cell: (d) => <span className="text-ink-muted">{ref.model(d.modelId)}</span> },
    { id: "type", header: "Type", hideBelow: "xl", cell: (d) => <span className="text-ink-muted">{ref.objectType(d.objectTypeId)}</span> },
    { id: "group", header: "Group", hideBelow: "lg", cell: (d) => ref.group(d.groupId) },
    { id: "driver", header: "Driver", hideBelow: "lg", cell: (d) => d.driver?.name || <span className="text-ink-subtle">Not recorded</span> },
    { id: "seen", header: "Last report", hideBelow: "sm", cell: (d) => <LastReport state={stateById.get(d.id)} loading={realtimeQ.loading} failed={!!realtimeQ.error} now={now} /> },
    {
      id: "cams",
      header: "Cams",
      align: "right",
      hideBelow: "xl",
      cell: (d) => (
        <span className="inline-flex items-center gap-1 text-ink-muted">
          <Camera className="size-3.5" aria-hidden />
          {d.cameraCount ?? "—"}
        </span>
      ),
    },
    { id: "expiry", header: "Service expiry", hideBelow: "md", cell: (d) => <ExpiryBadge date={d.expiresAt} now={now} /> },
  ];

  const total = needsAll ? devices.length : (pageQ.data?.total ?? 0);
  const source = active.data?.source;
  const notFound = isApiError(active.error) && active.error.status === 503 && filtersActive;

  return (
    <div>
      <PageHeader
        eyebrow={<DataSourceBadge source={source} />}
        title="Vehicles & Assets"
        description={
          active.data
            ? `${total} device${total === 1 ? "" : "s"}${filtersActive ? " match" : ""} · ${ref.groups.length} group${ref.groups.length === 1 ? "" : "s"}`
            : active.error
              ? "Couldn't load devices"
              : "Loading devices…"
        }
        actions={
          <>
            <Button variant="outline" disabled title={WRITES_PENDING}>
              <FolderPlus /> New group
            </Button>
            <Button disabled title={WRITES_PENDING}>
              <Plus /> Add vehicle
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
          }}
          options={[
            { value: "table", label: "Vehicle list" },
            { value: "tree", label: "Asset tree" },
          ]}
        />
        <FilterBar>
          <SearchInput value={searchInput} onChange={setSearchInput} label="Search vehicles" placeholder="Name or device ID" />
          <FilterSelect
            label="Group"
            value={groupId}
            onChange={(v) => {
              setGroupId(v);
              setPage(1);
            }}
            options={[{ value: "all", label: "All groups" }, ...ref.groups.map((g) => ({ value: String(g.id), label: g.name ?? `Group ${g.id}` }))]}
          />
          <FilterSelect
            label="Service expiry"
            value={expiry}
            onChange={(v) => {
              setExpiry(v);
              setPage(1);
            }}
            options={[
              { value: "all", label: "Any expiry" },
              { value: "soon", label: "Expiring ≤ 30 d" },
              { value: "expired", label: "Expired" },
            ]}
          />
        </FilterBar>
      </div>

      {expiry !== "all" ? (
        <p className="mb-3 flex items-center gap-1.5 px-1 text-xs text-ink-muted">
          <Info className="size-3.5" aria-hidden /> The expiry filter is applied in the browser to all matching devices (the API has no expiry filter).
        </p>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.fast}>
          <Panel className={view === "table" ? "overflow-hidden" : "p-3 sm:p-5"}>
            {active.error ? (
              <>
                <ApiErrorState error={active.error} onRetry={active.refetch} />
                {notFound ? (
                  <div className="-mt-4 flex flex-col items-center gap-3 px-6 pb-8 text-center">
                    <p className="max-w-md text-xs text-ink-muted">This server currently also answers 503 when a search or filter matches no devices, so this may just mean there are no matches.</p>
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </div>
                ) : null}
              </>
            ) : !active.data ? (
              <LoadingSkeleton variant="table" rows={8} />
            ) : view === "table" ? (
              <DataTable
                caption="Vehicles"
                data={needsAll ? devices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : devices}
                columns={columns}
                getRowId={(d) => String(d.id)}
                onRowClick={(d) => router.push(`/drive-vision/vehicles/${d.id}`)}
                pageSize={PAGE_SIZE}
                serverPagination={{ page, total, onPageChange: setPage }}
                emptyTitle="No vehicles match"
                emptyAction={
                  filtersActive ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <AssetTree devices={devices} groups={ref.groups} filtersActive={filtersActive} stateById={stateById} now={now} />
            )}
          </Panel>
        </motion.div>
      </AnimatePresence>
      {ref.errors.length ? <p className="mt-3 px-1 text-xs text-ink-muted">Couldn&apos;t load {ref.errors.join(", ")} — showing ids instead of names.</p> : null}
    </div>
  );
}

function LastReport({ state, loading, failed, now }: { state?: DeviceStateDto; loading: boolean; failed: boolean; now: Date }) {
  if (state?.deviceTime)
    return (
      <time dateTime={state.deviceTime} title={formatDateTime(state.deviceTime)} className="text-xs text-ink-muted">
        {formatRelative(state.deviceTime, now)}
      </time>
    );
  return <span className="text-xs text-ink-subtle" title={failed ? "Realtime data unavailable" : undefined}>{loading ? "…" : "—"}</span>;
}

/** Groups → devices. GroupDto has no owner field, so the user level of the old tree isn't shown. */
function AssetTree({
  devices,
  groups,
  filtersActive,
  stateById,
  now,
}: {
  devices: DeviceDto[];
  groups: { id?: number; name?: string }[];
  filtersActive: boolean;
  stateById: Map<number | undefined, DeviceStateDto>;
  now: Date;
}) {
  const known = new Set(groups.map((g) => g.id));
  const ungrouped = devices.filter((d) => !known.has(d.groupId));
  const sections = [...groups.map((g) => ({ key: String(g.id), name: g.name ?? `Group ${g.id}`, items: devices.filter((d) => d.groupId === g.id) })), ...(ungrouped.length ? [{ key: "other", name: "Other groups", items: ungrouped }] : [])].filter(
    (s) => s.items.length > 0 || !filtersActive
  );
  if (sections.length === 0) return <EmptyState icon={SearchX} title="No vehicles match" />;
  return (
    <ul className="space-y-2" aria-label="Groups and devices">
      {sections.map((s) => (
        <li key={s.key}>
          <details open={s.items.length > 0 && s.items.length <= 10} className="group/d">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium hover:bg-surface-muted">
              <ChevronRight className="size-3.5 text-ink-muted transition-transform group-open/d:rotate-90" aria-hidden />
              {s.name}
              <span className="rounded-full bg-surface-muted px-1.5 text-[11px] text-ink-muted tabular">{s.items.length}</span>
            </summary>
            <ul className="mt-1 ml-5 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {s.items.map((d) => {
                const state = stateById.get(d.id);
                return (
                  <li key={d.id}>
                    <Link href={`/drive-vision/vehicles/${d.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-muted">
                      <span className="truncate font-medium">{d.name ?? `Device ${d.id}`}</span>
                      <span className="truncate font-mono text-[11px] text-ink-muted">{d.terminalNo}</span>
                      {state?.deviceTime ? <span className="ml-auto shrink-0 text-[11px] text-ink-subtle">{formatRelative(state.deviceTime, now)}</span> : null}
                    </Link>
                  </li>
                );
              })}
              {s.items.length === 0 ? <li className="px-2 py-1.5 text-xs text-ink-subtle">No devices</li> : null}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
