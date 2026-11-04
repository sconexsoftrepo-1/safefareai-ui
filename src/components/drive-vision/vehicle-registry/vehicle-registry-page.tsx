"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BusFront, Cpu, Info, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vehicleRegistryService } from "@/features/drive-vision/api/vehicle-registry-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { VehicleDto, VehicleRow } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatNumber } from "@/features/drive-vision/utils/format";
import { useAccess, useActionGate, useCan } from "@/features/drive-vision/access/use-access";
import { SCREEN_ROUTES, dataScope } from "@/features/drive-vision/access/access-policy";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SearchInput, SegmentedControl } from "../shared/filter-bar";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import { TenantRequiredButton } from "../shared/tenant-required";
import type { Errors } from "../settings/settings-model";
import {
  EMPTY_VEHICLE_FORM,
  UPPERCASE_FIELDS,
  VEHICLE_MAX,
  VEHICLE_TYPE_SUGGESTIONS,
  YEAR_MIN,
  deviceLabel,
  maxYear,
  validateVehicleForm,
  vehicleFormFrom,
  vehicleRequestBody,
  vehicleSummary,
  type VehicleField,
  type VehicleForm,
  type VehicleTextField,
} from "./vehicle-registry-model";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
type Tab = "all" | "available";
type StatusFilter = "all" | "ACTIVE" | "INACTIVE";
type DeviceFilter = "all" | "fitted" | "none";

/** Device detail lives on the devices screen ("Vehicles & Assets"). */
const deviceHref = (id: number) => `${SCREEN_ROUTES.vehicles}/${id}`;

function VehicleStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-ink-subtle">—</span>;
  return (
    <StatusBadge size="sm" tone={status === "ACTIVE" ? "success" : "neutral"}>
      {status === "ACTIVE" ? "Active" : status === "INACTIVE" ? "Inactive" : status}
    </StatusBadge>
  );
}

function DeviceCell({ vehicle }: { vehicle: VehicleDto }) {
  const label = deviceLabel(vehicle);
  if (!label) return <span className="text-ink-subtle">No device</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Cpu className="size-3.5 shrink-0 text-brand" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * Vehicle registry on live BFF data (vehicle-controller, docs/contracts/vehicle-api.txt):
 * GET /vehicles (server-paged; keyword, status, type, device filters), GET /vehicles/available,
 * GET /vehicles/{id}, and the confirmed writes POST, PUT (full replace) and DELETE /vehicles.
 * Devices are fitted to vehicles on the devices screen, not here.
 */
export function VehicleRegistryPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("all");
  const createGate = useActionGate("vehicleRegistry.create");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [vehicleType, setVehicleType] = useState<string>("all");
  const [device, setDevice] = useState<DeviceFilter>("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(() => {
    const raw = params.get("vehicle");
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  });
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);

  useEffect(() => {
    const next = searchInput.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => {
      setKeyword(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, keyword]);

  const listQ = useApiQuery(tab === "all" ? `vehicles:list:${keyword}:${status}:${vehicleType}:${device}:${page}` : null, () =>
    vehicleRegistryService.listVehicles({
      keyword: keyword || undefined,
      status: status === "all" ? undefined : status,
      vehicleType: vehicleType === "all" ? undefined : vehicleType,
      assigned: device === "all" ? undefined : device === "fitted",
      pageNumber: page,
      pageSize: PAGE_SIZE,
    })
  );
  const availableQ = useApiQuery(tab === "available" ? `vehicles:available:${keyword}:${page}` : null, () =>
    vehicleRegistryService.listAvailableVehicles({ keyword: keyword || undefined, pageNumber: page, pageSize: PAGE_SIZE })
  );
  const activeQ = tab === "all" ? listQ : availableQ;
  const filtered = keyword !== "" || (tab === "all" && (status !== "all" || vehicleType !== "all" || device !== "all"));
  // Safe-Fare Admin in all-tenants mode: rows of every tenant — show which tenant.
  const allTenants = dataScope(useAccess()) === "all-tenants";

  const columns: DataTableColumn<VehicleRow>[] = [
    {
      id: "number",
      header: "Vehicle",
      cell: (v) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-deep" aria-hidden>
            <BusFront className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold tracking-wide">{v.vehicleNumber ?? `Vehicle ${v.id}`}</p>
            <p className="truncate text-xs text-ink-muted">{vehicleSummary(v) ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { id: "type", header: "Type", hideBelow: "md", cell: (v) => v.vehicleType ?? <span className="text-ink-subtle">—</span> },
    { id: "color", header: "Colour", hideBelow: "xl", cell: (v) => v.color ?? <span className="text-ink-subtle">—</span> },
    { id: "chassis", header: "Chassis no.", hideBelow: "xl", cell: (v) => <span className="font-mono text-xs">{v.chassisNumber ?? "—"}</span> },
    { id: "device", header: "Device", hideBelow: "sm", cell: (v) => <DeviceCell vehicle={v} /> },
    ...(allTenants ? [{ id: "tenant", header: "Tenant", hideBelow: "lg" as const, cell: (v: VehicleRow) => v.tenantName ?? (v.tenantId !== undefined ? `Tenant ${v.tenantId}` : "—") }] : []),
    { id: "status", header: "Status", cell: (v) => <VehicleStatusBadge status={v.status} /> },
  ];

  const total = activeQ.data?.total;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  return (
    <div>
      <PageHeader
        title="Vehicles"
        description={
          activeQ.data
            ? `${formatNumber(total ?? 0)} ${tab === "available" ? "available " : ""}vehicle${total === 1 ? "" : "s"}${filtered ? " · filtered" : ""}`
            : activeQ.error
              ? "Couldn't load vehicles"
              : "Loading vehicles…"
        }
        actions={
          <>
            <Button variant="outline" onClick={activeQ.refetch} disabled={activeQ.loading}>
              <RefreshCw className={activeQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            {createGate.allowed ? (
              <Button onClick={() => setFormMode("create")}>
                <Plus /> Register vehicle
              </Button>
            ) : createGate.tenantBlocked ? (
              <TenantRequiredButton label="Register vehicle" />
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={(t) => (setTab(t), setPage(1))}
          options={[
            { value: "all", label: "All vehicles" },
            { value: "available", label: "Without a device" },
          ]}
        />
        <FilterBar className="max-sm:w-full">
          <SearchInput label="Search vehicles" value={searchInput} onChange={setSearchInput} placeholder="Number, make, model, chassis…" className="w-full max-sm:basis-full sm:w-64" />
          {tab === "all" ? (
            <>
              <FilterSelect
                label="Status"
                className="max-sm:flex-1"
                value={status}
                onChange={resetPage(setStatus)}
                options={[
                  { value: "all", label: "Any status" },
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                ]}
              />
              <FilterSelect
                label="Type"
                className="max-sm:flex-1"
                value={vehicleType}
                onChange={resetPage(setVehicleType)}
                options={[{ value: "all", label: "Any type" }, ...VEHICLE_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t }))]}
              />
              <FilterSelect
                label="Device"
                className="max-sm:flex-1"
                value={device}
                onChange={resetPage(setDevice)}
                options={[
                  { value: "all", label: "Any device" },
                  { value: "fitted", label: "Device fitted" },
                  { value: "none", label: "No device" },
                ]}
              />
            </>
          ) : null}
        </FilterBar>
      </div>


      <Panel className="overflow-hidden">
        {activeQ.error ? (
          <ApiErrorState error={activeQ.error} onRetry={activeQ.refetch} />
        ) : !activeQ.data ? (
          <LoadingSkeleton variant="table" rows={8} />
        ) : (
          <DataTable
            caption={tab === "all" ? "Vehicles" : "Vehicles without a device"}
            data={activeQ.data.items}
            columns={columns}
            getRowId={(v) => String(v.id)}
            onRowClick={(v) => v.id !== undefined && setOpenId(v.id)}
            activeRowId={openId !== null ? String(openId) : null}
            isLoading={activeQ.refreshing}
            pageSize={PAGE_SIZE}
            serverPagination={{ page, total: activeQ.data.total, onPageChange: setPage }}
            emptyTitle={tab === "all" ? "No vehicles" : "No vehicles without a device"}
            emptyDescription={
              filtered ? "The server returned no vehicles for these filters." : tab === "all" ? "No vehicles registered yet. Register one to get started." : "Every active vehicle has a device fitted."
            }
          />
        )}
      </Panel>

      <VehicleDrawer
        id={openId}
        version={savedVersion}
        onClose={() => setOpenId(null)}
        onEdit={() => setFormMode("edit")}
        onDeleted={() => {
          setOpenId(null);
          activeQ.refetch();
        }}
      />
      <VehicleFormPanel
        mode={formMode}
        vehicleId={formMode === "edit" ? openId : null}
        onClose={() => setFormMode(null)}
        onSaved={(v) => {
          setFormMode(null);
          setSavedVersion((n) => n + 1);
          activeQ.refetch();
          if (v.id !== undefined) setOpenId(v.id);
        }}
      />
    </div>
  );
}

// ── Detail + delete ─────────────────────────────────────────────────────────

function VehicleDrawer({ id, version, onClose, onEdit, onDeleted }: { id: number | null; version: number; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  // `version` changes after a save, so the drawer re-reads the record the form just wrote.
  const detailQ = useApiQuery(id !== null ? `vehicles:detail:${id}:${version}` : null, () => vehicleRegistryService.getVehicle(id!));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canUpdate = useCan("vehicleRegistry.update");
  const canDelete = useCan("vehicleRegistry.delete");
  const vehicle = detailQ.data;
  const fitted = deviceLabel(vehicle ?? {});

  async function remove() {
    if (id === null) return;
    try {
      await vehicleRegistryService.deleteVehicle(id);
      toast.success(`Vehicle ${vehicle?.vehicleNumber ?? id} deleted`);
      onDeleted();
    } catch (err) {
      // 409 RESOURCE_IN_USE: the server's message names the fitted device.
      toast.error("The server refused the delete", { description: describeApiError(err) });
      throw err;
    }
  }

  return (
    <>
      <SlideOverPanel
        open={id !== null}
        onOpenChange={(o) => !o && onClose()}
        title={vehicle?.vehicleNumber ?? (id !== null ? `Vehicle ${id}` : "")}
        description={vehicle ? (vehicleSummary(vehicle) ?? undefined) : undefined}
        footer={
          vehicle && (canUpdate || canDelete) ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canDelete ? (
                <Button variant="outline" className="text-danger" onClick={() => setConfirmDelete(true)} disabled={vehicle.deviceAssigned === true} title={vehicle.deviceAssigned ? "Remove the fitted device first" : undefined}>
                  <Trash2 /> Delete
                </Button>
              ) : null}
              {canUpdate ? (
                <Button onClick={onEdit}>
                  <Pencil /> Edit
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {detailQ.error && !vehicle ? (
          <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
        ) : !vehicle ? (
          <LoadingSkeleton variant="list" rows={8} />
        ) : (
          <div className="space-y-5">
            <dl className="divide-y divide-line">
              <DetailRow label="Status">
                <VehicleStatusBadge status={vehicle.status} />
              </DetailRow>
              <DetailRow label="Vehicle number">
                <span className="font-mono">{vehicle.vehicleNumber ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Type">{vehicle.vehicleType ?? "—"}</DetailRow>
              <DetailRow label="Make">{vehicle.make ?? "—"}</DetailRow>
              <DetailRow label="Model">{vehicle.model ?? "—"}</DetailRow>
              <DetailRow label="Year">{vehicle.yearOfManufacture ?? "—"}</DetailRow>
              <DetailRow label="Colour">{vehicle.color ?? "—"}</DetailRow>
              <DetailRow label="Chassis number">
                <span className="font-mono">{vehicle.chassisNumber ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Engine number">
                <span className="font-mono">{vehicle.engineNumber ?? "—"}</span>
              </DetailRow>
              {vehicle.remarks ? <DetailRow label="Remarks">{vehicle.remarks}</DetailRow> : null}
              <DetailRow label="Registered">{vehicle.createdAt ? formatDateTime(vehicle.createdAt) : "—"}</DetailRow>
              <DetailRow label="Updated">{vehicle.updatedAt ? formatDateTime(vehicle.updatedAt) : "—"}</DetailRow>
            </dl>

            <section aria-labelledby="vr-device" className="rounded-xl bg-surface-muted p-3">
              <h3 id="vr-device" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                <Cpu className="size-4 text-brand" aria-hidden /> Tracking device
              </h3>
              {vehicle.device && fitted ? (
                <div className="space-y-1 text-[13px]">
                  <p>
                    {vehicle.device.id !== undefined ? (
                      <Link className="font-medium text-brand-deep hover:underline" href={deviceHref(vehicle.device.id)}>
                        {fitted}
                      </Link>
                    ) : (
                      <span className="font-medium">{fitted}</span>
                    )}
                    {vehicle.device.terminalNo && vehicle.device.terminalNo !== fitted ? <span className="ml-1.5 font-mono text-xs text-ink-muted">{vehicle.device.terminalNo}</span> : null}
                  </p>
                  <p className="text-xs text-ink-muted">To delete this vehicle, first remove the device from it (edit the device) or delete the device.</p>
                  {vehicle.status === "INACTIVE" ? <p className="text-xs text-warning">Inactive: the device stays fitted, but no other device can be fitted until the vehicle is active again.</p> : null}
                </div>
              ) : (
                <p className="text-[13px] text-ink-muted">
                  No device fitted. {vehicle.status === "ACTIVE" ? "Fit one from the device's edit form on Vehicles & Assets." : "Only active vehicles can have a device fitted."}
                </p>
              )}
            </section>
          </div>
        )}
      </SlideOverPanel>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title={`Delete vehicle ${vehicle?.vehicleNumber ?? ""}?`}
        description="The vehicle disappears from all lists. Its number stays reserved and can't be registered again."
        confirmLabel="Delete vehicle"
        onConfirm={remove}
      />
    </>
  );
}

// ── Register / edit ─────────────────────────────────────────────────────────

const FIELD_LABELS: Record<VehicleTextField, string> = {
  vehicleNumber: "Vehicle number",
  vehicleType: "Type",
  make: "Make",
  model: "Model",
  chassisNumber: "Chassis number",
  engineNumber: "Engine number",
  color: "Colour",
  remarks: "Remarks",
};
const PLACEHOLDERS: Partial<Record<VehicleTextField, string>> = {
  vehicleNumber: "TS09AB1234",
  make: "Ashok Leyland",
  model: "Viking",
  color: "White",
};
const ALL_FIELDS: VehicleField[] = [...(Object.keys(FIELD_LABELS) as VehicleTextField[]), "yearOfManufacture", "status"];

function VehicleFormPanel({ mode, vehicleId, onClose, onSaved }: { mode: "create" | "edit" | null; vehicleId: number | null; onClose: () => void; onSaved: (v: VehicleDto) => void }) {
  const detailQ = useApiQuery(mode === "edit" && vehicleId !== null ? `vehicles:form:${vehicleId}` : null, () => vehicleRegistryService.getVehicle(vehicleId!));
  const [draft, setDraft] = useState<VehicleForm | null>(null);
  const [errors, setErrors] = useState<Errors<VehicleField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const base = useMemo(() => (mode === "edit" ? (detailQ.data ? vehicleFormFrom(detailQ.data) : null) : EMPTY_VEHICLE_FORM), [mode, detailQ.data]);
  const form = draft ?? base;
  const latestYear = maxYear();

  function close() {
    setDraft(null);
    setErrors({});
    setFailure(null);
    onClose();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !mode || saving) return;
    const found = validateVehicleForm(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const body = vehicleRequestBody(form);
      const saved = mode === "create" ? await vehicleRegistryService.createVehicle(body) : await vehicleRegistryService.updateVehicle(vehicleId!, body);
      toast.success(mode === "create" ? `Vehicle ${saved.vehicleNumber ?? body.vehicleNumber} registered` : "Vehicle updated");
      setDraft(null);
      onSaved(saved);
    } catch (err) {
      const map = isApiError(err) ? err.fieldErrorMap() : {};
      const known: Errors<VehicleField> = {};
      for (const f of ALL_FIELDS) if (map[f]) known[f] = map[f];
      // 409 DUPLICATE belongs to the number field.
      if (isApiError(err) && err.errorCode === "DUPLICATE" && !known.vehicleNumber) known.vehicleNumber = err.message || "This vehicle number is already registered.";
      if (isApiError(err) && err.errorCode === "INVALID_VALUE" && !known.yearOfManufacture && form.yearOfManufacture) known.yearOfManufacture = err.message || "The server rejected this year.";
      setErrors(known);
      setFailure(Object.keys(known).length > 0 ? null : describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const text = (f: VehicleTextField) =>
    form ? (
      <FormField id={`vf-${f}`} label={FIELD_LABELS[f]} error={errors[f]} required={f === "vehicleNumber"}>
        {f === "remarks" ? (
          <Textarea {...fieldA11y(`vf-${f}`, errors[f])} rows={3} maxLength={VEHICLE_MAX[f]} value={form[f]} onChange={(e) => setDraft({ ...form, [f]: e.target.value })} />
        ) : (
          <Input
            {...fieldA11y(`vf-${f}`, errors[f])}
            maxLength={VEHICLE_MAX[f]}
            placeholder={PLACEHOLDERS[f]}
            className={UPPERCASE_FIELDS.has(f) ? "font-mono uppercase placeholder:normal-case" : undefined}
            value={form[f]}
            onChange={(e) => setDraft({ ...form, [f]: e.target.value })}
            list={f === "vehicleType" ? "vf-type-suggestions" : undefined}
          />
        )}
      </FormField>
    ) : null;

  return (
    <SlideOverPanel
      open={mode !== null}
      onOpenChange={(o) => !o && close()}
      title={mode === "create" ? "Register vehicle" : "Edit vehicle"}
      description={mode === "create" ? "Adds the vehicle to your organisation's registry" : (detailQ.data?.vehicleNumber ?? undefined)}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="vehicle-form" disabled={!form || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} {mode === "create" ? "Register vehicle" : "Save changes"}
          </Button>
        </div>
      }
    >
      {mode === "edit" && detailQ.error && !detailQ.data ? (
        <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
      ) : !form ? (
        <LoadingSkeleton variant="list" rows={6} />
      ) : (
        <form id="vehicle-form" className="space-y-3" onSubmit={onSubmit} noValidate>
          {text("vehicleNumber")}
          <div className="grid gap-3 sm:grid-cols-2">
            {text("vehicleType")}
            <FormField id="vf-status" label="Status" error={errors.status}>
              <Select value={form.status} onValueChange={(v) => setDraft({ ...form, status: v as VehicleForm["status"] })}>
                <SelectTrigger id="vf-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {text("make")}
            {text("model")}
            <FormField id="vf-year" label="Year of manufacture" error={errors.yearOfManufacture}>
              <Input
                {...fieldA11y("vf-year", errors.yearOfManufacture)}
                type="number"
                inputMode="numeric"
                min={YEAR_MIN}
                max={latestYear}
                placeholder={String(latestYear - 1)}
                value={form.yearOfManufacture}
                onChange={(e) => setDraft({ ...form, yearOfManufacture: e.target.value })}
              />
            </FormField>
            {text("color")}
            {text("chassisNumber")}
            {text("engineNumber")}
          </div>
          {text("remarks")}
          <datalist id="vf-type-suggestions">
            {VEHICLE_TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {failure ? (
            <p className="text-[13px] text-danger" role="alert">
              {failure}
            </p>
          ) : null}
          <p className="flex items-start gap-1.5 text-xs text-ink-muted">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {mode === "edit"
              ? "Saving replaces every field: a field you leave blank is cleared. Vehicle, chassis and engine numbers are stored in upper case."
              : "Vehicle, chassis and engine numbers are stored in upper case. A number can be registered only once, even after the vehicle is deleted."}
          </p>
        </form>
      )}
    </SlideOverPanel>
  );
}
