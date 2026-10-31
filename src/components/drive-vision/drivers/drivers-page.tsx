"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, IdCard, Link2Off, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operationsService } from "@/features/drive-vision/api/operations-service";
import { insightService } from "@/features/drive-vision/api/insight-service";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { AssignmentDto, DriverDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDate, formatDateTime, formatKm, formatNumber, initials } from "@/features/drive-vision/utils/format";
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
import type { Errors } from "../settings/settings-model";
import {
  DRIVER_MAX,
  EMPTY_DRIVER_FORM,
  LICENCE_META,
  assignRequestBody,
  driverFormFrom,
  driverRequestBody,
  validateAssignForm,
  validateDriverForm,
  type AssignForm,
  type DriverField,
  type DriverForm,
  type DriverTextField,
} from "./drivers-model";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const SCORE_WINDOW_DAYS = 30;
type Tab = "drivers" | "licences";

function LicenceBadge({ driver }: { driver: DriverDto }) {
  const status = driver.licence?.status;
  if (!status) return <span className="text-ink-subtle">—</span>;
  const meta = LICENCE_META[status] ?? { label: status, tone: "neutral" as const };
  const days = driver.licence?.daysToExpiry;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge size="sm" tone={meta.tone}>
        {meta.label}
      </StatusBadge>
      {driver.licence?.expiresOn ? (
        <span className="text-xs text-ink-muted tabular" title={typeof days === "number" ? `${days} days to expiry (server)` : undefined}>
          {formatDate(driver.licence.expiresOn)}
        </span>
      ) : null}
    </span>
  );
}

function DriverStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-ink-subtle">—</span>;
  return (
    <StatusBadge size="sm" tone={status === "ACTIVE" ? "success" : "neutral"}>
      {status}
    </StatusBadge>
  );
}

const vehicleOf = (a?: AssignmentDto) => (a ? a.deviceName || a.terminalNo || (a.deviceId !== undefined ? `Device ${a.deviceId}` : "—") : null);

/**
 * Drivers on live BFF data (driver-controller): GET /drivers (server-paged, keyword/status),
 * /drivers/{id}, /drivers/licence-expiries, /drivers/{id}/assignments, and the driver's
 * safety score/events (safety-controller). Writes — create, edit, delete, assign a vehicle, end
 * an assignment — are each confirmed and reported only after the server answers.
 */
export function DriversPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("licence") ? "licences" : "drivers");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | "ACTIVE" | "INACTIVE">("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(() => {
    const raw = params.get("driver");
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  });
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [withinDays, setWithinDays] = useState<"30" | "60" | "90">("30");

  useEffect(() => {
    const next = searchInput.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => {
      setKeyword(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, keyword]);

  const listQ = useApiQuery(tab === "drivers" ? `drivers:list:${keyword}:${status}:${page}` : null, () =>
    operationsService.listDrivers({ keyword: keyword || undefined, status: status === "all" ? undefined : status, pageNumber: page, pageSize: PAGE_SIZE })
  );
  const expiryQ = useApiQuery(tab === "licences" ? `drivers:licence-expiries:${withinDays}` : null, () => operationsService.licenceExpiries(Number(withinDays)));
  const filtered = keyword !== "" || status !== "all";

  const columns: DataTableColumn<DriverDto>[] = [
    {
      id: "name",
      header: "Driver",
      cell: (d) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunken text-[11px] font-semibold text-ink-muted" aria-hidden>
            {initials(d.name ?? "?")}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{d.name ?? `Driver ${d.id}`}</p>
            <p className="truncate text-xs text-ink-muted">{d.licence?.number ?? d.phone ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { id: "licence", header: "Licence", cell: (d) => <LicenceBadge driver={d} /> },
    { id: "vehicle", header: "Current vehicle", hideBelow: "md", cell: (d) => vehicleOf(d.currentAssignment) ?? <span className="text-ink-subtle">Unassigned</span> },
    { id: "phone", header: "Phone", hideBelow: "lg", cell: (d) => d.phone ?? "—" },
    { id: "status", header: "Status", cell: (d) => <DriverStatusBadge status={d.status} /> },
  ];

  const activeQ = tab === "drivers" ? listQ : expiryQ;

  return (
    <div>
      <PageHeader
        title="Drivers"
        description={tab === "drivers" ? (listQ.data ? `${formatNumber(listQ.data.total)} driver${listQ.data.total === 1 ? "" : "s"}${filtered ? " · filtered" : ""}` : listQ.error ? "Couldn't load drivers" : "Loading drivers…") : "Licences the server reports as expiring"}
        actions={
          <>
            <Button variant="outline" onClick={activeQ.refetch} disabled={activeQ.loading}>
              <RefreshCw className={activeQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            <Button onClick={() => setFormMode("create")}>
              <Plus /> New driver
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "drivers", label: "Drivers" },
            { value: "licences", label: "Licence expiries" },
          ]}
        />
        {tab === "drivers" ? (
          <FilterBar className="max-sm:w-full">
            <SearchInput label="Search drivers" value={searchInput} onChange={setSearchInput} placeholder="Name, licence or phone" className="w-full max-sm:basis-full sm:w-64" />
            <FilterSelect
              label="Status"
              className="max-sm:flex-1"
              value={status}
              onChange={(v: "all" | "ACTIVE" | "INACTIVE") => (setStatus(v), setPage(1))}
              options={[
                { value: "all", label: "Any status" },
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
            />
          </FilterBar>
        ) : (
          <FilterSelect
            label="Window"
            value={withinDays}
            onChange={setWithinDays}
            options={[
              { value: "30", label: "Within 30 days" },
              { value: "60", label: "Within 60 days" },
              { value: "90", label: "Within 90 days" },
            ]}
          />
        )}
      </div>

      <Panel className="overflow-hidden">
        {tab === "drivers" ? (
          listQ.error ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="table" rows={8} />
          ) : (
            <DataTable
              caption="Drivers"
              data={listQ.data.items}
              columns={columns}
              getRowId={(d) => String(d.id)}
              onRowClick={(d) => d.id !== undefined && setOpenId(d.id)}
              activeRowId={openId !== null ? String(openId) : null}
              isLoading={listQ.refreshing}
              pageSize={PAGE_SIZE}
              serverPagination={{ page, total: listQ.data.total, onPageChange: setPage }}
              emptyTitle="No drivers"
              emptyDescription={filtered ? "The server returned no drivers for these filters." : "No driver records yet. Create one to get started."}
            />
          )
        ) : expiryQ.error ? (
          <ApiErrorState error={expiryQ.error} onRetry={expiryQ.refetch} />
        ) : !expiryQ.data ? (
          <LoadingSkeleton variant="table" rows={6} />
        ) : (
          <DataTable
            caption="Licence expiries"
            data={expiryQ.data.items}
            columns={columns}
            getRowId={(d) => String(d.id)}
            onRowClick={(d) => d.id !== undefined && setOpenId(d.id)}
            activeRowId={openId !== null ? String(openId) : null}
            pageSize={PAGE_SIZE}
            emptyTitle="No licences expiring"
            emptyDescription={`The server reports no licences expiring within ${withinDays} days.`}
          />
        )}
      </Panel>

      <DriverDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onEdit={() => setFormMode("edit")}
        onChanged={() => {
          listQ.refetch();
          expiryQ.refetch();
        }}
        onDeleted={() => {
          setOpenId(null);
          listQ.refetch();
          expiryQ.refetch();
        }}
      />
      <DriverFormPanel
        mode={formMode}
        driverId={formMode === "edit" ? openId : null}
        onClose={() => setFormMode(null)}
        onSaved={(d) => {
          setFormMode(null);
          listQ.refetch();
          if (d.id !== undefined) setOpenId(d.id);
        }}
      />
    </div>
  );
}

// ── Detail + actions ────────────────────────────────────────────────────────

type Pending = { kind: "delete" } | { kind: "assign" } | { kind: "end"; assignment: AssignmentDto };

function DriverDrawer({ id, onClose, onEdit, onChanged, onDeleted }: { id: number | null; onClose: () => void; onEdit: () => void; onChanged: () => void; onDeleted: () => void }) {
  const [version, setVersion] = useState(0);
  const detailQ = useApiQuery(id !== null ? `drivers:detail:${id}:${version}` : null, () => operationsService.getDriver(id!));
  const assignQ = useApiQuery(id !== null ? `drivers:assignments:${id}:${version}` : null, () => operationsService.driverAssignments(id!));
  const [scoreWindow] = useState(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - SCORE_WINDOW_DAYS * 86_400_000).toISOString(), to: to.toISOString() };
  });
  const scoreQ = useApiQuery(id !== null ? `drivers:score:${id}:${scoreWindow.from}` : null, () => insightService.driverScore(id!, scoreWindow));
  const eventsQ = useApiQuery(id !== null ? `drivers:events:${id}:${scoreWindow.from}` : null, () => insightService.driverSafetyEvents(id!, { ...scoreWindow, pageNumber: 1, pageSize: 5 }));
  const [pending, setPending] = useState<Pending | null>(null);
  const [assign, setAssign] = useState<AssignForm>({ deviceId: "", from: "", replaceCurrent: false });
  const devicesQ = useApiQuery(pending?.kind === "assign" ? "drivers:devices" : null, () => fleetService.listAllDevices());
  const driver = detailQ.data;
  const assignErrors = validateAssignForm(assign);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  async function run() {
    if (!pending || id === null) return;
    try {
      if (pending.kind === "delete") {
        await operationsService.deleteDriver(id);
        toast.success("Driver deleted");
        onDeleted();
        return;
      }
      if (pending.kind === "assign") {
        const a = await operationsService.assignVehicle(id, assignRequestBody(assign));
        toast.success(`Assigned to ${vehicleOf(a) ?? "vehicle"}`);
        setAssign({ deviceId: "", from: "", replaceCurrent: false });
      } else {
        await operationsService.endAssignment(id, pending.assignment.id!, {});
        toast.success("Assignment ended");
      }
      refresh();
    } catch (err) {
      toast.error("The server rejected the change", { description: describeApiError(err) });
      // Leave the dialog open so the user can correct the input or cancel.
      throw err;
    }
  }

  const score = scoreQ.data?.data.score;

  return (
    <>
      <SlideOverPanel
        open={id !== null}
        onOpenChange={(o) => !o && onClose()}
        title={driver?.name ?? (id !== null ? `Driver ${id}` : "")}
        description={driver?.licence?.number ? `Licence ${driver.licence.number}` : undefined}
        footer={
          driver ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="text-danger" onClick={() => setPending({ kind: "delete" })}>
                <Trash2 /> Delete
              </Button>
              <Button variant="outline" onClick={() => setPending({ kind: "assign" })}>
                <Truck /> Assign vehicle
              </Button>
              <Button onClick={onEdit}>
                <Pencil /> Edit
              </Button>
            </div>
          ) : undefined
        }
      >
        {detailQ.error && !driver ? (
          <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
        ) : !driver ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : (
          <div className="space-y-5">
            <dl className="divide-y divide-line">
              <DetailRow label="Status">
                <DriverStatusBadge status={driver.status} />
              </DetailRow>
              <DetailRow label="Licence">
                <LicenceBadge driver={driver} />
                {driver.licence?.licenceClass ? <span className="ml-1 text-ink-muted">· class {driver.licence.licenceClass}</span> : null}
              </DetailRow>
              <DetailRow label="Current vehicle">
                {driver.currentAssignment ? (
                  driver.currentAssignment.deviceId !== undefined ? (
                    <Link className="font-medium text-brand-deep hover:underline" href={`/drive-vision/vehicles/${driver.currentAssignment.deviceId}`}>
                      {vehicleOf(driver.currentAssignment)}
                    </Link>
                  ) : (
                    vehicleOf(driver.currentAssignment)
                  )
                ) : (
                  "Unassigned"
                )}
              </DetailRow>
              <DetailRow label="Phone">{driver.phone ?? "—"}</DetailRow>
              <DetailRow label="Email">{driver.email ?? "—"}</DetailRow>
              <DetailRow label="IC card">{driver.icCardNo ?? "—"}</DetailRow>
              <DetailRow label="Emergency contact">{[driver.emergencyContactName, driver.emergencyContactPhone].filter(Boolean).join(" · ") || "—"}</DetailRow>
              <DetailRow label="Hired">{driver.hiredOn ? formatDate(driver.hiredOn) : "—"}</DetailRow>
              <DetailRow label="Linked user">{driver.userId !== undefined && driver.userId !== null ? `User ${driver.userId}` : "— (no login)"}</DetailRow>
              {driver.remark ? <DetailRow label="Remark">{driver.remark}</DetailRow> : null}
              <DetailRow label="Updated">{driver.updatedAt ? formatDateTime(driver.updatedAt) : "—"}</DetailRow>
            </dl>

            <section aria-labelledby="dr-score">
              <h3 id="dr-score" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <ShieldCheck className="size-4 text-brand" aria-hidden /> Safety · last {SCORE_WINDOW_DAYS} days
              </h3>
              {scoreQ.error ? (
                <ApiErrorState error={scoreQ.error} onRetry={scoreQ.refetch} compact />
              ) : !scoreQ.data ? (
                <LoadingSkeleton variant="list" rows={2} />
              ) : !score ? (
                <p className="text-[13px] text-ink-muted">The server returned no score for this period.</p>
              ) : (
                <dl className="grid grid-cols-3 gap-2 rounded-inner bg-surface-muted p-3 text-center text-xs">
                  <div>
                    <dt className="text-ink-muted">Score</dt>
                    <dd className="text-lg font-semibold tabular">
                      {typeof score.score === "number" ? formatNumber(score.score) : "—"}
                      {score.grade ? <span className="ml-1 text-xs text-ink-muted">({score.grade})</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Alarms · severe</dt>
                    <dd className="text-lg font-semibold tabular">
                      {score.alarmCount ?? "—"} · {score.severeCount ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Distance</dt>
                    <dd className="text-lg font-semibold tabular">{typeof score.distanceKm === "number" ? formatKm(score.distanceKm) : "—"}</dd>
                  </div>
                </dl>
              )}
              {eventsQ.data && eventsQ.data.items.length > 0 ? (
                <ul className="mt-2 divide-y divide-line text-[13px]">
                  {eventsQ.data.items.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">{e.alarmName ?? `Alarm type ${e.alarmTypeId ?? "?"}`}</span>
                      <span className="shrink-0 text-xs text-ink-muted tabular">{e.alarmTime ? formatDateTime(e.alarmTime) : "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : eventsQ.error ? (
                <p className="mt-2 text-xs text-danger">Safety events unavailable: {describeApiError(eventsQ.error)}</p>
              ) : null}
            </section>

            <section aria-labelledby="dr-assign">
              <h3 id="dr-assign" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <CalendarClock className="size-4 text-brand" aria-hidden /> Vehicle assignments
              </h3>
              {assignQ.error ? (
                <ApiErrorState error={assignQ.error} onRetry={assignQ.refetch} compact />
              ) : !assignQ.data ? (
                <LoadingSkeleton variant="list" rows={3} />
              ) : assignQ.data.items.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No assignments recorded.</p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {assignQ.data.items.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{vehicleOf(a)}</span>
                        <span className="block text-xs text-ink-muted tabular">
                          {a.assignedFrom ? formatDateTime(a.assignedFrom) : "?"} → {a.assignedTo ? formatDateTime(a.assignedTo) : "open"}
                          {a.source ? ` · ${a.source}` : ""}
                        </span>
                      </span>
                      {a.active ? <StatusBadge size="sm" tone="success">Active</StatusBadge> : null}
                      {a.active && a.id !== undefined ? (
                        <Button variant="ghost" size="sm" onClick={() => setPending({ kind: "end", assignment: a })}>
                          <Link2Off /> End
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SlideOverPanel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        tone={pending?.kind === "assign" ? "default" : "danger"}
        title={pending?.kind === "delete" ? `Delete ${driver?.name ?? "this driver"}?` : pending?.kind === "assign" ? `Assign a vehicle to ${driver?.name ?? "this driver"}` : `End assignment to ${vehicleOf(pending?.kind === "end" ? pending.assignment : undefined) ?? "this vehicle"}?`}
        description={
          pending?.kind === "delete"
            ? "Removes the driver record on the server. What happens to its assignments, dispatches and history is decided by the server."
            : pending?.kind === "assign"
              ? "Creates an assignment on the server. The server rejects it if the vehicle or driver is already assigned, unless you choose to replace the current assignment."
              : "Ends the assignment now on the server."
        }
        confirmLabel={pending?.kind === "delete" ? "Delete driver" : pending?.kind === "assign" ? "Assign" : "End assignment"}
        confirmDisabled={pending?.kind === "assign" && Object.keys(assignErrors).length > 0}
        onConfirm={run}
      >
        {pending?.kind === "assign" ? (
          <div className="space-y-3">
            <FormField id="as-device" label="Vehicle" error={assign.deviceId ? assignErrors.deviceId : undefined} required>
              {devicesQ.error ? (
                <p className="text-xs text-danger">{describeApiError(devicesQ.error)}</p>
              ) : (
                <Select value={assign.deviceId} onValueChange={(v) => setAssign({ ...assign, deviceId: v })} disabled={!devicesQ.data}>
                  <SelectTrigger id="as-device" className="w-full">
                    <SelectValue placeholder={devicesQ.data ? "Choose a vehicle" : "Loading vehicles…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(devicesQ.data?.items ?? [])
                      .filter((d) => d.id !== undefined)
                      .map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name ?? d.terminalNo ?? `Device ${d.id}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField id="as-from" label="Starts (IST)" hint="Leave blank to let the server use the current time." error={assignErrors.from}>
              <Input {...fieldA11y("as-from", assignErrors.from, "Leave blank to let the server use the current time.")} type="datetime-local" value={assign.from} onChange={(e) => setAssign({ ...assign, from: e.target.value })} />
            </FormField>
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={assign.replaceCurrent} onCheckedChange={(v) => setAssign({ ...assign, replaceCurrent: v === true })} /> Replace the current assignment
            </label>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

// ── Create / edit ───────────────────────────────────────────────────────────

const FIELD_LABELS: Record<DriverTextField, string> = {
  name: "Full name",
  licenceNo: "Licence number",
  licenceClass: "Licence class",
  licenceIssuedOn: "Licence issued",
  licenceExpiresOn: "Licence expires",
  icCardNo: "IC card number",
  phone: "Phone",
  email: "Email",
  address: "Address",
  dateOfBirth: "Date of birth",
  emergencyContactName: "Emergency contact",
  emergencyContactPhone: "Emergency phone",
  hiredOn: "Hired on",
  remark: "Remark",
};
const DATE_INPUTS = new Set<DriverTextField>(["licenceIssuedOn", "licenceExpiresOn", "dateOfBirth", "hiredOn"]);
const ALL_FIELDS: DriverField[] = [...(Object.keys(FIELD_LABELS) as DriverTextField[]), "gender", "status", "userId"];

function DriverFormPanel({ mode, driverId, onClose, onSaved }: { mode: "create" | "edit" | null; driverId: number | null; onClose: () => void; onSaved: (d: DriverDto) => void }) {
  const detailQ = useApiQuery(mode === "edit" && driverId !== null ? `drivers:form:${driverId}` : null, () => operationsService.getDriver(driverId!));
  const [draft, setDraft] = useState<DriverForm | null>(null);
  const [errors, setErrors] = useState<Errors<DriverField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const base = useMemo(() => (mode === "edit" ? (detailQ.data ? driverFormFrom(detailQ.data) : null) : EMPTY_DRIVER_FORM), [mode, detailQ.data]);
  const form = draft ?? base;

  function close() {
    setDraft(null);
    setErrors({});
    setFailure(null);
    onClose();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !mode || saving) return;
    const found = validateDriverForm(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const body = driverRequestBody(form);
      const saved = mode === "create" ? await operationsService.createDriver(body) : await operationsService.updateDriver(driverId!, body);
      toast.success(mode === "create" ? "Driver created" : "Driver updated");
      setDraft(null);
      onSaved(saved);
    } catch (err) {
      const map = isApiError(err) ? err.fieldErrorMap() : {};
      const known: Errors<DriverField> = {};
      for (const f of ALL_FIELDS) if (map[f]) known[f] = map[f];
      setErrors(known);
      setFailure(Object.keys(known).length > 0 ? null : describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const text = (f: DriverTextField) =>
    form ? (
      <FormField id={`df-${f}`} label={FIELD_LABELS[f]} error={errors[f]} required={f === "name"}>
        {f === "address" || f === "remark" ? (
          <Textarea {...fieldA11y(`df-${f}`, errors[f])} rows={2} maxLength={DRIVER_MAX[f]} value={form[f]} onChange={(e) => setDraft({ ...form, [f]: e.target.value })} />
        ) : (
          <Input {...fieldA11y(`df-${f}`, errors[f])} type={DATE_INPUTS.has(f) ? "date" : f === "email" ? "email" : f.toLowerCase().includes("phone") ? "tel" : "text"} maxLength={DRIVER_MAX[f]} value={form[f]} onChange={(e) => setDraft({ ...form, [f]: e.target.value })} />
        )}
      </FormField>
    ) : null;

  return (
    <SlideOverPanel
      open={mode !== null}
      onOpenChange={(o) => !o && close()}
      title={mode === "create" ? "New driver" : "Edit driver"}
      description={mode === "create" ? "Creates the driver record on the SafeFare server" : detailQ.data?.name}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="driver-form" disabled={!form || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} {mode === "create" ? "Create driver" : "Save changes"}
          </Button>
        </div>
      }
    >
      {mode === "edit" && detailQ.error && !detailQ.data ? (
        <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
      ) : !form ? (
        <LoadingSkeleton variant="list" rows={6} />
      ) : (
        <form id="driver-form" className="space-y-3" onSubmit={onSubmit} noValidate>
          {text("name")}
          <div className="grid gap-3 sm:grid-cols-2">
            {text("phone")}
            {text("email")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("licenceNo")}
            {text("licenceClass")}
            {text("licenceIssuedOn")}
            {text("licenceExpiresOn")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("icCardNo")}
            {text("dateOfBirth")}
            <FormField id="df-gender" label="Gender" error={errors.gender}>
              <Select value={form.gender || "none"} onValueChange={(v) => setDraft({ ...form, gender: v === "none" ? "" : (v as DriverForm["gender"]) })}>
                <SelectTrigger id="df-gender" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  <SelectItem value="M">M</SelectItem>
                  <SelectItem value="F">F</SelectItem>
                  <SelectItem value="U">U</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="df-status" label="Status" error={errors.status}>
              <Select value={form.status} onValueChange={(v) => setDraft({ ...form, status: v as DriverForm["status"] })}>
                <SelectTrigger id="df-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {text("hiredOn")}
            <FormField id="df-userId" label="Linked user id" error={errors.userId} hint="Optional login account for driver self-service.">
              <Input {...fieldA11y("df-userId", errors.userId, "Optional login account for driver self-service.")} inputMode="numeric" value={form.userId} onChange={(e) => setDraft({ ...form, userId: e.target.value })} />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("emergencyContactName")}
            {text("emergencyContactPhone")}
          </div>
          {text("address")}
          {text("remark")}
          {failure ? (
            <p className="text-[13px] text-danger" role="alert">
              {failure}
            </p>
          ) : null}
          <p className="flex items-start gap-1.5 text-xs text-ink-muted">
            <IdCard className="mt-px size-3.5 shrink-0" aria-hidden /> Licence status and days to expiry are calculated by the server from the expiry date.
          </p>
        </form>
      )}
    </SlideOverPanel>
  );
}
