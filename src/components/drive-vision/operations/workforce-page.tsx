"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Loader2, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operationsService } from "@/features/drive-vision/api/operations-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import { LEAVE_TYPES, type AvailabilityDto, type ChecklistDto, type LeaveDto, type ShiftDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDate, formatDateTime, formatKm, formatNumber, formatSeconds } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterSelect, SegmentedControl } from "../shared/filter-bar";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import type { Errors } from "../settings/settings-model";
import { EMPTY_LEAVE_FORM, istDate, leaveRequestBody, validateLeaveForm, windowAround, type LeaveField, type LeaveForm } from "./operations-model";
import { usePickers } from "./use-pickers";

const PAGE_SIZE = 20;
type Tab = "availability" | "shifts" | "leave" | "checklists";
const TABS: Tab[] = ["availability", "shifts", "leave", "checklists"];
const time = (v?: string) => (v ? formatDateTime(v) : "—");
const yes = (v?: boolean) => (v === undefined ? "—" : v ? "Yes" : "No");

const Raw = ({ value }: { value?: string }) =>
  value ? (
    <StatusBadge size="sm" tone="neutral">
      {value}
    </StatusBadge>
  ) : (
    <span className="text-ink-subtle">—</span>
  );

/**
 * Workforce on live BFF data (workforce-controller): driver availability for a day, shifts,
 * leave requests (list, request on behalf of a driver, approve / reject) and pre-trip checklists
 * with the checklist template. Lifecycle rules (who can approve, what a decision changes) are the
 * server's; statuses are shown as returned.
 */
export function WorkforcePage() {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : "availability");
  const [version, setVersion] = useState(0);
  return (
    <div>
      <PageHeader
        title="Workforce"
        description="Availability, shifts, leave and checklists from the SafeFare server"
        actions={
          <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      <div className="mb-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "availability", label: "Availability" },
            { value: "shifts", label: "Shifts" },
            { value: "leave", label: "Leave" },
            { value: "checklists", label: "Checklists" },
          ]}
        />
      </div>
      {tab === "availability" ? <AvailabilityPanel version={version} /> : tab === "shifts" ? <ShiftsPanel version={version} /> : tab === "leave" ? <LeavePanel version={version} /> : <ChecklistsPanel version={version} />}
    </div>
  );
}

// ── Availability ────────────────────────────────────────────────────────────

function AvailabilityPanel({ version }: { version: number }) {
  const [date, setDate] = useState(() => istDate(new Date()));
  const q = useApiQuery(`workforce:availability:${date}:${version}`, () => operationsService.availability(date || undefined));
  const counts = Object.entries(q.data?.counts ?? {}).filter(([, n]) => typeof n === "number");
  const columns: DataTableColumn<AvailabilityDto>[] = [
    { id: "name", header: "Driver", cell: (a) => <span className="font-medium">{a.name ?? `Driver ${a.driverId}`}</span> },
    {
      id: "status",
      header: "Status",
      cell: (a) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Raw value={a.status} />
          {a.leaveType ? <span className="text-xs text-ink-muted">{a.leaveType}</span> : null}
          {a.pendingLeave ? <StatusBadge size="sm" tone="warning">Leave pending</StatusBadge> : null}
        </span>
      ),
    },
    { id: "shift", header: "On shift", cell: (a) => yes(a.onShift) },
    { id: "dispatches", header: "Dispatches", align: "right", cell: (a) => (typeof a.dispatchesOnDay === "number" ? formatNumber(a.dispatchesOnDay) : "—") },
    { id: "hours", header: "Scheduled h", align: "right", hideBelow: "md", cell: (a) => (typeof a.scheduledHours === "number" ? formatNumber(Math.round(a.scheduledHours * 10) / 10) : "—") },
    { id: "upcoming", header: "Upcoming", align: "right", hideBelow: "lg", cell: (a) => (typeof a.upcomingDispatches === "number" ? formatNumber(a.upcomingDispatches) : "—") },
    { id: "phone", header: "Phone", hideBelow: "lg", cell: (a) => a.phone ?? "—" },
  ];
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-5 pt-4 pb-2">
        <label className="text-xs text-ink-muted">
          Day (IST)
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9 w-auto" />
        </label>
        <div className="flex flex-wrap gap-1.5 pb-1">
          {counts.map(([k, n]) => (
            <span key={k} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs">
              <span className="font-mono text-[11px]">{k}</span> <span className="font-semibold tabular">{formatNumber(n)}</span>
            </span>
          ))}
        </div>
      </div>
      {q.error ? (
        <ApiErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <LoadingSkeleton variant="table" rows={6} />
      ) : (
        <DataTable caption="Driver availability" data={q.data.drivers ?? []} columns={columns} getRowId={(a) => String(a.driverId)} pageSize={PAGE_SIZE} emptyTitle="No drivers" emptyDescription="The server returned no drivers for this day." />
      )}
    </Panel>
  );
}

// ── Shifts ──────────────────────────────────────────────────────────────────

function ShiftsPanel({ version }: { version: number }) {
  const [driverId, setDriverId] = useState("all");
  const [page, setPage] = useState(1);
  const [now] = useState(() => new Date());
  const range = windowAround(now, 7, 0);
  const pickers = usePickers(true);
  const q = useApiQuery(`workforce:shifts:${driverId}:${page}:${version}`, () =>
    operationsService.listShifts({ ...range, driverId: driverId === "all" ? undefined : Number(driverId), pageNumber: page, pageSize: PAGE_SIZE })
  );
  const columns: DataTableColumn<ShiftDto>[] = [
    { id: "driver", header: "Driver", cell: (s) => <span className="font-medium">{s.driverName ?? `Driver ${s.driverId}`}</span> },
    {
      id: "start",
      header: "Started",
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 tabular">
          {time(s.startedAt)}
          {s.open ? <StatusBadge size="sm" tone="info">Open</StatusBadge> : null}
        </span>
      ),
    },
    { id: "end", header: "Ended", hideBelow: "md", cell: (s) => <span className="tabular">{time(s.endedAt)}</span> },
    { id: "duration", header: "Duration", align: "right", cell: (s) => (typeof s.durationSeconds === "number" ? formatSeconds(s.durationSeconds) : "—") },
    { id: "distance", header: "Distance", align: "right", hideBelow: "lg", cell: (s) => (typeof s.distanceKm === "number" ? formatKm(s.distanceKm) : "—") },
    { id: "vehicle", header: "Vehicle", hideBelow: "lg", cell: (s) => s.deviceName ?? "—" },
  ];
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Shifts · last 7 days"
        action={<FilterSelect label="Driver" value={driverId} onChange={(v) => (setDriverId(v), setPage(1))} options={[{ value: "all", label: "All drivers" }, ...pickers.drivers]} className="max-w-56" />}
      />
      {q.error ? (
        <ApiErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <LoadingSkeleton variant="table" rows={6} />
      ) : (
        <DataTable
          caption="Shifts"
          data={q.data.items}
          columns={columns}
          getRowId={(s) => String(s.id)}
          isLoading={q.refreshing}
          pageSize={PAGE_SIZE}
          serverPagination={{ page, total: q.data.total, onPageChange: setPage }}
          emptyTitle="No shifts"
          emptyDescription="The server returned no shifts for this period."
        />
      )}
    </Panel>
  );
}

// ── Leave ───────────────────────────────────────────────────────────────────

function LeavePanel({ version }: { version: number }) {
  const [page, setPage] = useState(1);
  const [local, setLocal] = useState(0);
  const q = useApiQuery(`workforce:leave:${page}:${version}:${local}`, () => operationsService.listLeave({ pageNumber: page, pageSize: PAGE_SIZE }));
  const [pending, setPending] = useState<{ leave: LeaveDto; decision: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const refresh = () => setLocal((v) => v + 1);

  async function decide() {
    if (!pending?.leave.id) return;
    try {
      const res = await operationsService.decideLeave(pending.leave.id, pending.decision, note.trim() ? { note: note.trim() } : {});
      toast.success(pending.decision === "approve" ? "Leave approved" : "Leave rejected", { description: res.status ? `Server status: ${res.status}` : undefined });
      setNote("");
      refresh();
    } catch (err) {
      toast.error("The server rejected the decision", { description: describeApiError(err) });
      throw err;
    }
  }

  const columns: DataTableColumn<LeaveDto>[] = [
    { id: "driver", header: "Driver", cell: (l) => <span className="font-medium">{l.driverName ?? `Driver ${l.driverId}`}</span> },
    { id: "type", header: "Type", cell: (l) => l.leaveType ?? "—" },
    {
      id: "dates",
      header: "Dates",
      cell: (l) => (
        <span className="tabular">
          {l.startDate ? formatDate(l.startDate) : "?"} – {l.endDate ? formatDate(l.endDate) : "?"}
          {typeof l.days === "number" ? <span className="ml-1 text-xs text-ink-muted">({l.days} d)</span> : null}
        </span>
      ),
    },
    { id: "reason", header: "Reason", hideBelow: "lg", cell: (l) => <span className="line-clamp-2 text-ink-muted">{l.reason ?? "—"}</span> },
    {
      id: "status",
      header: "Status",
      cell: (l) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Raw value={l.status} />
          {l.affectedDispatchIds?.length ? <StatusBadge size="sm" tone="warning">{l.affectedDispatchIds.length} dispatch(es) affected</StatusBadge> : null}
        </span>
      ),
    },
    {
      id: "decision",
      header: "Decision",
      align: "right",
      cell: (l) =>
        l.decidedAt ? (
          <span className="text-xs text-ink-muted">
            {l.decidedByName ?? "Decided"} · {time(l.decidedAt)}
          </span>
        ) : (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setPending({ leave: l, decision: "reject" })}>
              Reject
            </Button>
            <Button size="sm" onClick={() => setPending({ leave: l, decision: "approve" })}>
              Approve
            </Button>
          </span>
        ),
    },
  ];

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Leave requests"
        action={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus /> Request leave for a driver
          </Button>
        }
      />
      {q.error ? (
        <ApiErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <LoadingSkeleton variant="table" rows={6} />
      ) : (
        <DataTable
          caption="Leave requests"
          data={q.data.items}
          columns={columns}
          getRowId={(l) => String(l.id)}
          isLoading={q.refreshing}
          pageSize={PAGE_SIZE}
          serverPagination={{ page, total: q.data.total, onPageChange: setPage }}
          emptyTitle="No leave requests"
          emptyDescription="The server returned no leave requests."
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && (setPending(null), setNote(""))}
        tone={pending?.decision === "reject" ? "danger" : "default"}
        title={pending?.decision === "approve" ? "Approve this leave?" : "Reject this leave?"}
        description={
          pending
            ? `${pending.leave.driverName ?? "Driver"} · ${pending.leave.leaveType ?? ""} · ${pending.leave.startDate ?? "?"} – ${pending.leave.endDate ?? "?"}.${pending.leave.affectedDispatchIds?.length ? ` The server lists ${pending.leave.affectedDispatchIds.length} dispatch(es) in this period; what happens to them is decided by the server.` : ""}`
            : undefined
        }
        confirmLabel={pending?.decision === "approve" ? "Approve" : "Reject"}
        confirmDisabled={note.length > 500}
        onConfirm={decide}
      >
        <FormField id="lv-note" label="Note (optional)" error={note.length > 500 ? "Use 500 characters or fewer." : undefined}>
          <Textarea id="lv-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </ConfirmDialog>
      <LeaveFormPanel open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => (setFormOpen(false), refresh())} />
    </Panel>
  );
}

/** Leave request form, shared with the driver app (`forDriver` hides the driver picker). */
export function LeaveFields({ form, onChange, errors, forDriver, drivers }: { form: LeaveForm; onChange: (f: LeaveForm) => void; errors: Errors<LeaveField>; forDriver: boolean; drivers: { value: string; label: string }[] }) {
  return (
    <div className="space-y-3">
      {!forDriver ? (
        <FormField id="lf-driver" label="Driver" error={errors.driverId} required>
          <Select value={form.driverId} onValueChange={(v) => onChange({ ...form, driverId: v })}>
            <SelectTrigger id="lf-driver" className="w-full">
              <SelectValue placeholder="Choose a driver" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {drivers.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : null}
      <FormField id="lf-type" label="Leave type" error={errors.leaveType} required>
        <Select value={form.leaveType} onValueChange={(v) => onChange({ ...form, leaveType: v as LeaveForm["leaveType"] })}>
          <SelectTrigger id="lf-type" className="w-full">
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {LEAVE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="lf-start" label="First day" error={errors.startDate} required>
          <Input {...fieldA11y("lf-start", errors.startDate)} type="date" value={form.startDate} onChange={(e) => onChange({ ...form, startDate: e.target.value })} />
        </FormField>
        <FormField id="lf-end" label="Last day" error={errors.endDate} required>
          <Input {...fieldA11y("lf-end", errors.endDate)} type="date" value={form.endDate} onChange={(e) => onChange({ ...form, endDate: e.target.value })} />
        </FormField>
      </div>
      <FormField id="lf-reason" label="Reason" error={errors.reason}>
        <Textarea {...fieldA11y("lf-reason", errors.reason)} rows={2} maxLength={500} value={form.reason} onChange={(e) => onChange({ ...form, reason: e.target.value })} />
      </FormField>
    </div>
  );
}

function LeaveFormPanel({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const pickers = usePickers(open);
  const [form, setForm] = useState<LeaveForm>(EMPTY_LEAVE_FORM);
  const [errors, setErrors] = useState<Errors<LeaveField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setForm(EMPTY_LEAVE_FORM);
    setErrors({});
    setFailure(null);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validateLeaveForm(form, { requireDriver: true });
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const res = await operationsService.createLeave(leaveRequestBody(form, { includeDriver: true }));
      toast.success("Leave request created", { description: res.status ? `Server status: ${res.status}` : undefined });
      setForm(EMPTY_LEAVE_FORM);
      onSaved();
    } catch (err) {
      const map = isApiError(err) ? err.fieldErrorMap() : {};
      const known: Errors<LeaveField> = {};
      for (const f of ["driverId", "leaveType", "startDate", "endDate", "reason"] as const) if (map[f]) known[f] = map[f];
      setErrors(known);
      setFailure(Object.keys(known).length ? null : describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Request leave for a driver"
      description="Creates a leave request on the server (POST /leave-requests)"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="leave-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Submit request
          </Button>
        </div>
      }
    >
      <form id="leave-form" onSubmit={submit} noValidate>
        {pickers.error ? <p className="mb-2 text-xs text-danger">Couldn&apos;t load drivers: {describeApiError(pickers.error)}</p> : null}
        <LeaveFields form={form} onChange={setForm} errors={errors} forDriver={false} drivers={pickers.drivers} />
        {failure ? (
          <p className="mt-3 text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
    </SlideOverPanel>
  );
}

// ── Checklists ──────────────────────────────────────────────────────────────

function ChecklistsPanel({ version }: { version: number }) {
  const [page, setPage] = useState(1);
  const [now] = useState(() => new Date());
  const range = windowAround(now, 7, 0);
  const templateQ = useApiQuery(`workforce:checklist-template:${version}`, () => operationsService.checklistTemplate());
  const q = useApiQuery(`workforce:checklists:${page}:${version}`, () => operationsService.listChecklists({ ...range, pageNumber: page, pageSize: PAGE_SIZE }));
  const [open, setOpen] = useState<ChecklistDto | null>(null);
  const columns: DataTableColumn<ChecklistDto>[] = [
    { id: "driver", header: "Driver", cell: (c) => <span className="font-medium">{c.driverName ?? `Driver ${c.driverId}`}</span> },
    { id: "vehicle", header: "Vehicle", hideBelow: "md", cell: (c) => c.deviceName ?? "—" },
    { id: "submitted", header: "Submitted", cell: (c) => <span className="tabular">{time(c.submittedAt)}</span> },
    {
      id: "result",
      header: "Result",
      cell: (c) =>
        c.allPassed ? (
          <StatusBadge size="sm" tone="success" icon={CheckCircle2}>
            All passed
          </StatusBadge>
        ) : (
          <StatusBadge size="sm" tone={c.criticalFailed ? "danger" : "warning"} icon={TriangleAlert}>
            {typeof c.failedCount === "number" ? `${c.failedCount} failed` : "Failed"}
            {c.criticalFailed ? " · critical" : ""}
          </StatusBadge>
        ),
    },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Panel className="overflow-hidden">
        <PanelHeader title="Submitted checklists · last 7 days" />
        {q.error ? (
          <ApiErrorState error={q.error} onRetry={q.refetch} />
        ) : !q.data ? (
          <LoadingSkeleton variant="table" rows={6} />
        ) : (
          <DataTable
            caption="Checklists"
            data={q.data.items}
            columns={columns}
            getRowId={(c) => String(c.id)}
            onRowClick={setOpen}
            activeRowId={open ? String(open.id) : null}
            isLoading={q.refreshing}
            pageSize={PAGE_SIZE}
            serverPagination={{ page, total: q.data.total, onPageChange: setPage }}
            emptyTitle="No checklists"
            emptyDescription="No checklists were submitted in this period."
          />
        )}
        {open ? (
          <div className="border-t border-line px-5 py-4">
            <p className="mb-2 text-[13px] font-semibold">
              {open.driverName ?? "Checklist"} · {time(open.submittedAt)}
            </p>
            <ul className="space-y-1 text-[13px]">
              {(open.items ?? []).map((it, i) => (
                <li key={it.key ?? i} className="flex items-start gap-2">
                  {it.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-serious" aria-label="Failed" />}
                  <span>
                    {it.label ?? it.key}
                    {it.critical ? <span className="ml-1 text-xs text-danger">critical</span> : null}
                    {it.note ? <span className="block text-xs text-ink-muted">{it.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {open.note ? <p className="mt-2 text-xs text-ink-muted">{open.note}</p> : null}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <PanelHeader title="Checklist template" description="Items drivers are asked to check" />
        {templateQ.error ? (
          <ApiErrorState error={templateQ.error} onRetry={templateQ.refetch} compact />
        ) : !templateQ.data ? (
          <LoadingSkeleton variant="list" rows={4} />
        ) : templateQ.data.items.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-ink-muted">The server returned an empty template.</p>
        ) : (
          <ul className="space-y-1.5 px-5 pb-5 text-[13px]">
            {templateQ.data.items.map((it, i) => (
              <li key={it.key ?? i} className="flex items-start gap-2">
                <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
                <span>
                  {it.label ?? it.key}
                  <span className="ml-1 text-xs text-ink-muted">{[it.category, it.critical ? "critical" : null].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
