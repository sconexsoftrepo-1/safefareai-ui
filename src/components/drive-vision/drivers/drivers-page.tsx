"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard, Mail, Pencil, Phone, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFleet } from "@/features/drive-vision/store/fleet-store";
import { driverService } from "@/features/drive-vision/services/entity-services";
import { driverScores, alarmsInRange, isSafetyEvent, scoreBand } from "@/features/drive-vision/selectors";
import { ALARM_TYPES, DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import type { Driver, DriverStatus } from "@/features/drive-vision/types";
import { resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatDate, formatDateTime, formatKm, initials } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SearchInput } from "../shared/filter-bar";
import { DemoBadge, useSimulatedLoading } from "../shared/feedback";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { SeverityBadge, StatusBadge, type Tone } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import { ExpiryBadge } from "../vehicles/vehicle-cells";
import { DriverForm } from "./driver-form";

const STATUS_META: Record<DriverStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  off_duty: { label: "Off duty", tone: "neutral" },
  on_leave: { label: "On leave", tone: "warning" },
};

export function DriversPage() {
  const router = useRouter();
  const params = useSearchParams();
  const drivers = useFleet((s) => s.drivers);
  const vehicles = useFleet((s) => s.vehicles);
  const alarms = useFleet((s) => s.alarms);
  const trips = useFleet((s) => s.trips);
  const loading = useSimulatedLoading("drivers");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DriverStatus | "all">("all");
  const [assignment, setAssignment] = useState<"all" | "assigned" | "unassigned">("all");
  const [detailId, setDetailId] = useState<string | null>(params.get("driver"));
  const [formOpen, setFormOpen] = useState<"new" | "edit" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const range30 = useMemo(() => resolveDateRange("30d", DEMO_NOW), []);
  const scores = useMemo(() => new Map(driverScores(alarms, trips, range30).map((r) => [r.id, r])), [alarms, trips, range30]);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.vehicleId, v])), [vehicles]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drivers.filter((d) => {
      if (q && ![d.name, d.licenceNo, d.phone, d.icCardNo].some((x) => x.toLowerCase().includes(q))) return false;
      if (status !== "all" && d.status !== status) return false;
      if (assignment === "assigned" && !d.assignedVehicleId) return false;
      if (assignment === "unassigned" && d.assignedVehicleId) return false;
      return true;
    });
  }, [drivers, search, status, assignment]);

  const detail = drivers.find((d) => d.driverId === detailId);
  const detailScore = detail ? scores.get(detail.driverId) : undefined;
  const detailEvents = detail ? alarmsInRange(alarms, range30).filter((a) => a.driverId === detail.driverId && isSafetyEvent(a)) : [];

  const columns: DataTableColumn<Driver>[] = [
    {
      id: "name",
      header: "Driver",
      sortValue: (d) => d.name,
      cell: (d) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-peach text-xs font-semibold">{initials(d.name)}</span>
          <div className="min-w-0">
            <p className="font-semibold">{d.name}</p>
            <p className="truncate text-xs text-ink-muted">{d.phone}</p>
          </div>
        </div>
      ),
    },
    {
      id: "licence",
      header: "Licence",
      sortValue: (d) => d.licenceNo,
      hideBelow: "md",
      cell: (d) => (
        <div>
          <p className="font-mono text-xs">{d.licenceNo}</p>
          <p className="text-xs text-ink-muted">{d.licenceClass}</p>
        </div>
      ),
    },
    { id: "expiry", header: "Licence expiry", sortValue: (d) => d.licenceExpiry, hideBelow: "lg", cell: (d) => <ExpiryBadge date={d.licenceExpiry} label="Licence" /> },
    {
      id: "vehicle",
      header: "Vehicle",
      sortValue: (d) => vehicleById.get(d.assignedVehicleId ?? "")?.vehicleName ?? "~",
      hideBelow: "sm",
      cell: (d) => {
        const v = vehicleById.get(d.assignedVehicleId ?? "");
        return v ? `${v.vehicleName} · ${v.plate}` : <span className="text-ink-subtle">Not assigned</span>;
      },
    },
    { id: "status", header: "Status", sortValue: (d) => d.status, cell: (d) => <StatusBadge tone={STATUS_META[d.status].tone} size="sm">{STATUS_META[d.status].label}</StatusBadge> },
    {
      id: "score",
      header: "Safety (30 d)",
      align: "right",
      sortValue: (d) => scores.get(d.driverId)?.score ?? 101,
      hideBelow: "md",
      cell: (d) => {
        const s = scores.get(d.driverId);
        if (!s || s.distanceKm === 0) return <span className="text-ink-subtle">—</span>;
        return (
          <span className="inline-flex items-center gap-2">
            <span className="font-semibold tabular">{s.score}</span>
            <StatusBadge tone={scoreBand(s.score).tone} size="sm">
              {scoreBand(s.score).label}
            </StatusBadge>
          </span>
        );
      },
    },
  ];

  function closeDetail(o: boolean) {
    if (o) return;
    setDetailId(null);
    if (params.get("driver")) router.replace("/drive-vision/drivers", { scroll: false });
  }

  return (
    <div>
      <PageHeader
        eyebrow={<DemoBadge />}
        title="Drivers"
        description={`${drivers.length} drivers · ${drivers.filter((d) => d.assignedVehicleId).length} assigned to vehicles`}
        actions={
          <Button onClick={() => setFormOpen("new")}>
            <Plus /> Add driver
          </Button>
        }
      />

      <FilterBar className="mb-3">
        <SearchInput value={search} onChange={setSearch} label="Search drivers" placeholder="Name, licence, phone, IC card" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all" as const, label: "All statuses" }, ...(Object.keys(STATUS_META) as DriverStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }))]} />
        <FilterSelect
          label="Assignment"
          value={assignment}
          onChange={setAssignment}
          options={[
            { value: "all", label: "Any assignment" },
            { value: "assigned", label: "Assigned" },
            { value: "unassigned", label: "Unassigned" },
          ]}
        />
      </FilterBar>

      <Panel className="overflow-hidden">
        <DataTable caption="Drivers" data={rows} columns={columns} getRowId={(d) => d.driverId} onRowClick={(d) => setDetailId(d.driverId)} activeRowId={detailId} isLoading={loading} pageSize={12} initialSort={{ id: "name", dir: "asc" }} emptyTitle="No drivers match" />
      </Panel>

      <SlideOverPanel
        open={Boolean(detail)}
        onOpenChange={closeDetail}
        title={detail?.name ?? ""}
        description={detail ? `Joined ${formatDate(detail.joinDate)} · ${detail.icCardNo}` : undefined}
        headerExtra={detail ? <StatusBadge tone={STATUS_META[detail.status].tone} size="sm">{STATUS_META[detail.status].label}</StatusBadge> : null}
        footer={
          detail ? (
            <>
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete
              </Button>
              <Button onClick={() => setFormOpen("edit")}>
                <Pencil /> Edit
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-mint px-3 py-2.5">
                <p className="text-[11px] text-brand-deep">Safety score</p>
                <p className="text-xl font-semibold tabular">{detailScore && detailScore.distanceKm > 0 ? detailScore.score : "—"}</p>
              </div>
              <div className="rounded-xl bg-peach px-3 py-2.5">
                <p className="text-[11px] text-serious">Events · 30 d</p>
                <p className="text-xl font-semibold tabular">{detailEvents.length}</p>
              </div>
              <div className="rounded-xl bg-sky px-3 py-2.5">
                <p className="text-[11px] text-info">Distance · 30 d</p>
                <p className="text-xl font-semibold tabular">{formatKm(detailScore?.distanceKm ?? 0)}</p>
              </div>
            </div>

            <dl className="divide-y divide-line">
              <DetailRow label="Phone">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-ink-muted" /> {detail.phone}
                </span>
              </DetailRow>
              <DetailRow label="Email">
                <span className="inline-flex items-center gap-1.5 break-all">
                  <Mail className="size-3.5 shrink-0 text-ink-muted" /> {detail.email ?? "—"}
                </span>
              </DetailRow>
              <DetailRow label="Licence">
                <span className="font-mono text-xs">{detail.licenceNo}</span> · {detail.licenceClass}
              </DetailRow>
              <DetailRow label="Licence expiry">
                <span className="inline-flex items-center gap-2">
                  {formatDate(detail.licenceExpiry)} <ExpiryBadge date={detail.licenceExpiry} expiredText="Expired" showOkDate={false} />
                </span>
              </DetailRow>
              <DetailRow label="IC card">
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="size-3.5 text-ink-muted" /> {detail.icCardNo}
                </span>
              </DetailRow>
            </dl>

            <section>
              <p className="mb-2 text-[13px] font-semibold">Vehicle assignment</p>
              <div className="flex items-center gap-2">
                <Select
                  value={detail.assignedVehicleId ?? "__none__"}
                  onValueChange={async (v) => {
                    await driverService.updateDriver(detail.driverId, { ...detail, assignedVehicleId: v === "__none__" ? undefined : v });
                    toast.success(v === "__none__" ? "Driver unassigned" : `Assigned to ${vehicleById.get(v)?.vehicleName}`);
                  }}
                >
                  <SelectTrigger aria-label="Assigned vehicle" className="flex-1">
                    <Truck className="size-4" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">Not assigned</SelectItem>
                    {vehicles
                      .filter((v) => !v.driverId || v.driverId === detail.driverId)
                      .map((v) => (
                        <SelectItem key={v.vehicleId} value={v.vehicleId}>
                          {v.vehicleName} · {v.plate}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {detail.assignedVehicleId ? (
                  <Button asChild variant="outline">
                    <Link href={`/drive-vision/vehicles/${detail.assignedVehicleId}`}>View</Link>
                  </Button>
                ) : null}
              </div>
            </section>

            <section>
              <p className="mb-2 text-[13px] font-semibold">Safety history · last 30 days</p>
              {detailEvents.length === 0 ? (
                <p className="text-xs text-ink-muted">No safety events recorded.</p>
              ) : (
                <ul className="space-y-1">
                  {detailEvents.slice(0, 8).map((a) => (
                    <li key={a.alarmId}>
                      <Link href={`/drive-vision/alerts?alarm=${a.alarmId}`} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-muted">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{ALARM_TYPES[a.alarmType].label}</span>
                          <span className="block text-xs text-ink-muted">{formatDateTime(a.alarmTime)}</span>
                        </span>
                        <SeverityBadge severity={a.severity} size="sm" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </SlideOverPanel>

      <SlideOverPanel open={formOpen !== null} onOpenChange={(o) => !o && setFormOpen(null)} title={formOpen === "edit" ? `Edit ${detail?.name ?? "driver"}` : "Add driver"} description="Driver records are stored locally in this demo." width="lg">
        {formOpen ? (
          <DriverForm
            key={formOpen === "edit" ? detail?.driverId : "new"}
            driver={formOpen === "edit" ? detail : undefined}
            onCancel={() => setFormOpen(null)}
            onSubmit={async (input) => {
              if (formOpen === "edit" && detail) {
                await driverService.updateDriver(detail.driverId, input);
                toast.success("Driver updated");
              } else {
                const d = await driverService.createDriver(input);
                toast.success(`${d.name} added`);
                setDetailId(d.driverId);
              }
              setFormOpen(null);
            }}
          />
        ) : null}
      </SlideOverPanel>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${detail?.name ?? "driver"}?`}
        description="The driver will be removed and unassigned from any vehicle. Past events keep their history in this demo."
        confirmLabel="Delete driver"
        onConfirm={async () => {
          if (!detail) return;
          await driverService.deleteDriver(detail.driverId);
          toast.success(`${detail.name} deleted`);
          setDetailId(null);
        }}
      />
    </div>
  );
}
