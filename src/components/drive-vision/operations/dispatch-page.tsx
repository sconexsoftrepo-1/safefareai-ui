"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, CircleX, Loader2, Pencil, Plus, RefreshCw, Repeat2, ShieldQuestion, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operationsService } from "@/features/drive-vision/api/operations-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { DispatchCheck, DispatchCheckResult, DispatchDto, SwapRequestDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatNumber } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import type { Errors } from "../settings/settings-model";
import { DISPATCH_MAX, EMPTY_DISPATCH_FORM, dispatchFormFrom, dispatchRequestBody, validateDispatchForm, windowAround, type DispatchField, type DispatchForm } from "./operations-model";
import { usePickers } from "./use-pickers";

const PAGE_SIZE = 20;
type Tab = "dispatches" | "conflicts" | "swaps";
type Window = "upcoming" | "recent" | "all";
const WINDOWS: Record<Exclude<Window, "all">, [number, number]> = { upcoming: [1, 14], recent: [14, 0] };

const time = (v?: string) => (v ? formatDateTime(v) : "—");

function Status({ value }: { value?: string }) {
  return value ? (
    <StatusBadge size="sm" tone="neutral">
      {value}
    </StatusBadge>
  ) : (
    <span className="text-ink-subtle">—</span>
  );
}

/** Checks from /dispatches/check, /verification or /conflicts, as the server worded them. */
export function CheckList({ checks, emptyText }: { checks: DispatchCheck[] | undefined; emptyText: string }) {
  const list = checks ?? [];
  if (list.length === 0) return <p className="text-[13px] text-ink-muted">{emptyText}</p>;
  return (
    <ul className="space-y-1.5 text-[13px]">
      {list.map((c, i) => (
        <li key={`${c.code}-${i}`} className="flex items-start gap-2">
          {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-serious" aria-label="Failed" />}
          <span className="min-w-0">
            <span>{c.message ?? c.code ?? "Check"}</span>
            {c.code || c.severity ? <span className="ml-1 font-mono text-[10.5px] text-ink-muted">{[c.code, c.severity].filter(Boolean).join(" · ")}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Dispatch on live BFF data (dispatch-controller): list, create (after a conflict check), edit,
 * cancel, verification, conflicts in a window, swap requests with approve / reject. Nothing is
 * sent without a confirmation; statuses are shown as the server returns them.
 */
export function DispatchPage() {
  const params = useSearchParams();
  const linked = /^\d+$/.test(params.get("dispatch") ?? "") ? Number(params.get("dispatch")) : null;
  const [tab, setTab] = useState<Tab>(params.get("tab") === "swaps" ? "swaps" : params.get("tab") === "conflicts" ? "conflicts" : "dispatches");
  const [win, setWin] = useState<Window>("upcoming");
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const [openId, setOpenId] = useState<number | null>(linked);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [version, setVersion] = useState(0);
  const range: { from?: string; to?: string } = win === "all" ? {} : windowAround(now, ...WINDOWS[win]);
  const listQ = useApiQuery(tab === "dispatches" ? `dispatch:list:${win}:${range.from ?? ""}:${page}:${version}` : null, () => operationsService.listDispatches({ ...range, pageNumber: page, pageSize: PAGE_SIZE }));
  const changed = () => setVersion((v) => v + 1);

  const columns: DataTableColumn<DispatchDto>[] = [
    {
      id: "title",
      header: "Dispatch",
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{d.title ?? `Dispatch ${d.id}`}</p>
          <p className="truncate text-xs text-ink-muted">{[d.origin, d.destination].filter(Boolean).join(" → ") || "—"}</p>
        </div>
      ),
    },
    { id: "start", header: "Scheduled", cell: (d) => <span className="whitespace-nowrap tabular">{time(d.scheduledStart)}</span> },
    { id: "driver", header: "Driver", hideBelow: "md", cell: (d) => d.driverName ?? "—" },
    { id: "vehicle", header: "Vehicle", hideBelow: "lg", cell: (d) => d.deviceName ?? d.terminalNo ?? "—" },
    {
      id: "status",
      header: "Status",
      cell: (d) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Status value={d.status} />
          {d.pendingSwapRequestId !== undefined && d.pendingSwapRequestId !== null ? (
            <StatusBadge size="sm" tone="warning" icon={Repeat2}>
              Swap pending
            </StatusBadge>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Dispatch"
        description={tab === "dispatches" ? (listQ.data ? `${formatNumber(listQ.data.total)} dispatch${listQ.data.total === 1 ? "" : "es"}` : listQ.error ? "Couldn't load dispatches" : "Loading dispatches…") : tab === "conflicts" ? "Scheduling conflicts found by the server" : "Driver swap requests"}
        actions={
          <>
            <Button variant="outline" onClick={() => (setNow(new Date()), changed())}>
              <RefreshCw className={listQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            <Button onClick={() => setFormMode("create")}>
              <Plus /> New dispatch
            </Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={(v) => (setTab(v), setPage(1))}
          options={[
            { value: "dispatches", label: "Dispatches" },
            { value: "conflicts", label: "Conflicts" },
            { value: "swaps", label: "Swap requests" },
          ]}
        />
        {tab !== "swaps" ? (
          <SegmentedControl
            label="Window"
            size="sm"
            value={win}
            onChange={(v) => (setWin(v), setPage(1))}
            options={[
              { value: "upcoming", label: "Next 14 days" },
              { value: "recent", label: "Past 14 days" },
              ...(tab === "dispatches" ? [{ value: "all" as const, label: "All" }] : []),
            ]}
          />
        ) : null}
      </div>

      {tab === "dispatches" ? (
        <Panel className="overflow-hidden">
          {listQ.error ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="table" rows={8} />
          ) : (
            <DataTable
              caption="Dispatches"
              data={listQ.data.items}
              columns={columns}
              getRowId={(d) => String(d.id)}
              onRowClick={(d) => d.id !== undefined && setOpenId(d.id)}
              activeRowId={openId !== null ? String(openId) : null}
              isLoading={listQ.refreshing}
              pageSize={PAGE_SIZE}
              serverPagination={{ page, total: listQ.data.total, onPageChange: setPage }}
              emptyTitle="No dispatches"
              emptyDescription="The server returned no dispatches for this window."
            />
          )}
        </Panel>
      ) : tab === "conflicts" ? (
        <ConflictsPanel range={win === "all" ? windowAround(now, ...WINDOWS.upcoming) : (range as { from: string; to: string })} version={version} onOpen={setOpenId} />
      ) : (
        <SwapsPanel version={version} onChanged={changed} />
      )}

      <DispatchDrawer id={openId} version={version} onClose={() => setOpenId(null)} onEdit={() => setFormMode("edit")} onChanged={changed} />
      <DispatchFormPanel mode={formMode} dispatchId={formMode === "edit" ? openId : null} onClose={() => setFormMode(null)} onSaved={(d) => (setFormMode(null), changed(), d.id !== undefined && setOpenId(d.id))} />
    </div>
  );
}

// ── Conflicts ───────────────────────────────────────────────────────────────

function ConflictsPanel({ range, version, onOpen }: { range: { from: string; to: string }; version: number; onOpen: (id: number) => void }) {
  const q = useApiQuery(`dispatch:conflicts:${range.from}:${version}`, () => operationsService.conflicts(range));
  return (
    <Panel>
      {q.error ? (
        <ApiErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <LoadingSkeleton variant="list" rows={4} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No conflicts" description="The server found no scheduling conflicts in this window." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.items.map((c, i) => (
            <li key={`${c.dispatchId}-${i}`} className="px-5 py-4">
              <button type="button" className="text-left text-[13px] font-semibold hover:underline disabled:no-underline" disabled={c.dispatchId === undefined} onClick={() => c.dispatchId !== undefined && onOpen(c.dispatchId)}>
                {c.title ?? `Dispatch ${c.dispatchId}`}
              </button>
              <p className="mb-2 text-xs text-ink-muted">
                {[c.driverName, c.deviceName].filter(Boolean).join(" · ")} · {time(c.scheduledStart)} → {time(c.scheduledEnd)}
              </p>
              <CheckList checks={c.conflicts} emptyText="No details returned." />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Swap requests ───────────────────────────────────────────────────────────

function SwapsPanel({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const q = useApiQuery(`dispatch:swaps:${page}:${version}`, () => operationsService.listSwaps({ pageNumber: page, pageSize: PAGE_SIZE }));
  const [pending, setPending] = useState<{ swap: SwapRequestDto; decision: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");

  async function decide() {
    if (!pending?.swap.id) return;
    try {
      const res = await operationsService.decideSwap(pending.swap.id, pending.decision, note.trim() ? { note: note.trim() } : {});
      toast.success(pending.decision === "approve" ? "Swap approved" : "Swap rejected", { description: res.status ? `Server status: ${res.status}` : undefined });
      setNote("");
      onChanged();
    } catch (err) {
      toast.error("The server rejected the decision", { description: describeApiError(err) });
      throw err;
    }
  }

  const columns: DataTableColumn<SwapRequestDto>[] = [
    { id: "dispatch", header: "Dispatch", cell: (s) => <span className="font-medium">{s.dispatchTitle ?? `Dispatch ${s.dispatchId}`}</span> },
    { id: "drivers", header: "From → to", cell: (s) => `${s.fromDriverName ?? "—"} → ${s.toDriverName ?? "any"}` },
    { id: "when", header: "Scheduled", hideBelow: "md", cell: (s) => <span className="tabular">{time(s.scheduledStart)}</span> },
    { id: "reason", header: "Reason", hideBelow: "lg", cell: (s) => <span className="line-clamp-2 text-ink-muted">{s.reason ?? "—"}</span> },
    { id: "status", header: "Status", cell: (s) => <Status value={s.status} /> },
    {
      id: "actions",
      header: "Decision",
      align: "right",
      cell: (s) =>
        s.decidedAt ? (
          <span className="text-xs text-ink-muted">{time(s.decidedAt)}</span>
        ) : (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setPending({ swap: s, decision: "reject" })}>
              Reject
            </Button>
            <Button size="sm" onClick={() => setPending({ swap: s, decision: "approve" })}>
              Approve
            </Button>
          </span>
        ),
    },
  ];

  return (
    <Panel className="overflow-hidden">
      {q.error ? (
        <ApiErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <LoadingSkeleton variant="table" rows={5} />
      ) : (
        <DataTable
          caption="Swap requests"
          data={q.data.items}
          columns={columns}
          getRowId={(s) => String(s.id)}
          isLoading={q.refreshing}
          pageSize={PAGE_SIZE}
          serverPagination={{ page, total: q.data.total, onPageChange: setPage }}
          emptyTitle="No swap requests"
          emptyDescription="The server returned no swap requests."
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && (setPending(null), setNote(""))}
        tone={pending?.decision === "reject" ? "danger" : "default"}
        title={pending?.decision === "approve" ? "Approve this swap?" : "Reject this swap?"}
        description={pending ? `${pending.swap.dispatchTitle ?? `Dispatch ${pending.swap.dispatchId}`}: ${pending.swap.fromDriverName ?? "—"} → ${pending.swap.toDriverName ?? "any driver"}. The server applies the decision and any reassignment.` : undefined}
        confirmLabel={pending?.decision === "approve" ? "Approve" : "Reject"}
        confirmDisabled={note.length > 500}
        onConfirm={decide}
      >
        <FormField id="swap-note" label="Note (optional)" error={note.length > 500 ? "Use 500 characters or fewer." : undefined}>
          <Textarea id="swap-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </ConfirmDialog>
    </Panel>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────

type Pending = { kind: "cancel" } | { kind: "swap" };

function DispatchDrawer({ id, version, onClose, onEdit, onChanged }: { id: number | null; version: number; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const detailQ = useApiQuery(id !== null ? `dispatch:detail:${id}:${version}` : null, () => operationsService.getDispatch(id!));
  const verifyQ = useApiQuery(id !== null ? `dispatch:verify:${id}:${version}` : null, () => operationsService.verification(id!));
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [toDriver, setToDriver] = useState("");
  const pickers = usePickers(pending?.kind === "swap");
  const d = detailQ.data;

  async function run() {
    if (!pending || id === null) return;
    try {
      if (pending.kind === "cancel") {
        const res = await operationsService.cancelDispatch(id, reason.trim() ? { reason: reason.trim() } : {});
        toast.success("Dispatch cancelled", { description: res.status ? `Server status: ${res.status}` : undefined });
      } else {
        const body = { ...(toDriver ? { toDriverId: Number(toDriver) } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) };
        const res = await operationsService.requestSwap(id, body);
        toast.success("Swap requested", { description: res.status ? `Server status: ${res.status}` : undefined });
      }
      setReason("");
      setToDriver("");
      onChanged();
    } catch (err) {
      toast.error("The server rejected the request", { description: describeApiError(err) });
      throw err;
    }
  }

  return (
    <>
      <SlideOverPanel
        open={id !== null}
        onOpenChange={(o) => !o && onClose()}
        title={d?.title ?? (id !== null ? `Dispatch ${id}` : "")}
        description={d ? `${time(d.scheduledStart)} → ${time(d.scheduledEnd)}` : undefined}
        footer={
          d ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="text-danger" onClick={() => setPending({ kind: "cancel" })}>
                <CircleX /> Cancel dispatch
              </Button>
              <Button variant="outline" onClick={() => setPending({ kind: "swap" })}>
                <Repeat2 /> Request swap
              </Button>
              <Button onClick={onEdit}>
                <Pencil /> Edit
              </Button>
            </div>
          ) : undefined
        }
      >
        {detailQ.error && !d ? (
          <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
        ) : !d ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : (
          <div className="space-y-5">
            <dl className="divide-y divide-line">
              <DetailRow label="Status">
                <Status value={d.status} />
              </DetailRow>
              <DetailRow label="Driver">{d.driverName ?? "—"}</DetailRow>
              <DetailRow label="Vehicle">{d.deviceName ?? d.terminalNo ?? "—"}</DetailRow>
              <DetailRow label="Route">{[d.origin, d.destination].filter(Boolean).join(" → ") || "—"}</DetailRow>
              <DetailRow label="Reporting time">{time(d.reportingTime)}</DetailRow>
              {d.instructions ? <DetailRow label="Instructions">{d.instructions}</DetailRow> : null}
              {d.routeNotes ? <DetailRow label="Route notes">{d.routeNotes}</DetailRow> : null}
              <DetailRow label="Responded · started · completed">
                {time(d.respondedAt)} · {time(d.startedAt)} · {time(d.completedAt)}
              </DetailRow>
              {d.declineReason ? <DetailRow label="Declined">{d.declineReason}</DetailRow> : null}
              {d.cancelReason ? <DetailRow label="Cancelled">{d.cancelReason}</DetailRow> : null}
            </dl>
            <section aria-labelledby="dp-verify">
              <h3 id="dp-verify" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <ShieldQuestion className="size-4 text-brand" aria-hidden /> Verification
                {verifyQ.data ? (
                  <StatusBadge size="sm" tone={verifyQ.data.ready ? "success" : "warning"}>
                    {verifyQ.data.ready ? "Ready" : "Not ready"}
                  </StatusBadge>
                ) : null}
              </h3>
              {verifyQ.error ? <ApiErrorState error={verifyQ.error} onRetry={verifyQ.refetch} compact /> : !verifyQ.data ? <LoadingSkeleton variant="list" rows={2} /> : <CheckList checks={verifyQ.data.checks} emptyText="The server returned no verification checks." />}
            </section>
          </div>
        )}
      </SlideOverPanel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && (setPending(null), setReason(""), setToDriver(""))}
        tone={pending?.kind === "cancel" ? "danger" : "default"}
        title={pending?.kind === "cancel" ? "Cancel this dispatch?" : "Request a driver swap"}
        description={pending?.kind === "cancel" ? "The server cancels the dispatch and notifies whoever it notifies. This can't be undone from here." : "Creates a swap request for approval. Leave the driver blank to let the approver choose."}
        confirmLabel={pending?.kind === "cancel" ? "Cancel dispatch" : "Request swap"}
        confirmDisabled={reason.length > 500}
        onConfirm={run}
      >
        <div className="space-y-3">
          {pending?.kind === "swap" ? (
            <FormField id="dp-to" label="Swap to driver (optional)">
              <Select value={toDriver || "none"} onValueChange={(v) => setToDriver(v === "none" ? "" : v)}>
                <SelectTrigger id="dp-to" className="w-full">
                  <SelectValue placeholder={pickers.loading ? "Loading drivers…" : "Any driver"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any driver</SelectItem>
                  {pickers.drivers
                    .filter((o) => o.value !== String(d?.driverId))
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField id="dp-reason" label="Reason (optional)" error={reason.length > 500 ? "Use 500 characters or fewer." : undefined}>
            <Textarea id="dp-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
      </ConfirmDialog>
    </>
  );
}

// ── Create / edit ───────────────────────────────────────────────────────────

const FIELDS: DispatchField[] = ["deviceId", "driverId", "title", "origin", "destination", "routeNotes", "instructions", "reportingTime", "scheduledStart", "scheduledEnd"];

function PickerField({ id, label, value, options, onChange, error, placeholder }: { id: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; error?: string; placeholder: string }) {
  return (
    <FormField id={id} label={label} error={error} required>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function DispatchFormPanel({ mode, dispatchId, onClose, onSaved }: { mode: "create" | "edit" | null; dispatchId: number | null; onClose: () => void; onSaved: (d: DispatchDto) => void }) {
  const detailQ = useApiQuery(mode === "edit" && dispatchId !== null ? `dispatch:form:${dispatchId}` : null, () => operationsService.getDispatch(dispatchId!));
  const pickers = usePickers(mode !== null);
  const base = useMemo(() => (mode === "edit" ? (detailQ.data ? dispatchFormFrom(detailQ.data) : null) : EMPTY_DISPATCH_FORM), [mode, detailQ.data]);
  const [draft, setDraft] = useState<DispatchForm | null>(null);
  const form = draft ?? base;
  const [errors, setErrors] = useState<Errors<DispatchField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [check, setCheck] = useState<{ form: DispatchForm; result: DispatchCheckResult } | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const checkedCurrent = check !== null && form !== null && JSON.stringify(check.form) === JSON.stringify(form);

  function close() {
    setDraft(null);
    setErrors({});
    setFailure(null);
    setCheck(null);
    onClose();
  }

  const edit = (patch: Partial<DispatchForm>) => form && setDraft({ ...form, ...patch });

  function fieldErrorsFrom(err: unknown) {
    const map = isApiError(err) ? err.fieldErrorMap() : {};
    const known: Errors<DispatchField> = {};
    for (const f of FIELDS) if (map[f]) known[f] = map[f];
    setErrors(known);
    setFailure(Object.keys(known).length > 0 ? null : describeApiError(err));
  }

  /** POST /dispatches/check — validates the draft on the server; creates nothing. */
  async function runCheck(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form || checking) return;
    const found = validateDispatchForm(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setChecking(true);
    try {
      setCheck({ form, result: await operationsService.checkDispatch(dispatchRequestBody(form)) });
    } catch (err) {
      fieldErrorsFrom(err);
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    if (!form || !mode) return;
    try {
      const body = dispatchRequestBody(form);
      const saved = mode === "create" ? await operationsService.createDispatch(body) : await operationsService.updateDispatch(dispatchId!, body);
      toast.success(mode === "create" ? "Dispatch created" : "Dispatch updated", { description: saved.status ? `Server status: ${saved.status}` : undefined });
      setDraft(null);
      setCheck(null);
      onSaved(saved);
    } catch (err) {
      fieldErrorsFrom(err);
      throw err;
    }
  }

  const text = (f: "title" | "origin" | "destination", label: string) =>
    form ? (
      <FormField id={`dpf-${f}`} label={label} error={errors[f]} required={f === "title"}>
        <Input {...fieldA11y(`dpf-${f}`, errors[f])} maxLength={DISPATCH_MAX[f]} value={form[f]} onChange={(e) => edit({ [f]: e.target.value })} />
      </FormField>
    ) : null;
  const when = (f: "scheduledStart" | "scheduledEnd" | "reportingTime", label: string) =>
    form ? (
      <FormField id={`dpf-${f}`} label={label} error={errors[f]} required={f !== "reportingTime"}>
        <Input {...fieldA11y(`dpf-${f}`, errors[f])} type="datetime-local" value={form[f]} onChange={(e) => edit({ [f]: e.target.value })} />
      </FormField>
    ) : null;
  const long = (f: "routeNotes" | "instructions", label: string) =>
    form ? (
      <FormField id={`dpf-${f}`} label={label} error={errors[f]}>
        <Textarea {...fieldA11y(`dpf-${f}`, errors[f])} rows={2} maxLength={DISPATCH_MAX[f]} value={form[f]} onChange={(e) => edit({ [f]: e.target.value })} />
      </FormField>
    ) : null;

  return (
    <SlideOverPanel
      open={mode !== null}
      onOpenChange={(o) => !o && close()}
      title={mode === "create" ? "New dispatch" : "Edit dispatch"}
      description="Times are in fleet time (IST)"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button variant="outline" type="submit" form="dispatch-form" disabled={!form || checking}>
            {checking ? <Loader2 className="animate-spin" /> : <CalendarClock />} Check conflicts
          </Button>
          <Button onClick={() => setConfirming(true)} disabled={!form || !checkedCurrent}>
            {mode === "create" ? "Create dispatch" : "Save changes"}
          </Button>
        </div>
      }
    >
      {mode === "edit" && detailQ.error && !detailQ.data ? (
        <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
      ) : !form ? (
        <LoadingSkeleton variant="list" rows={6} />
      ) : (
        <form id="dispatch-form" className="space-y-3" onSubmit={runCheck} noValidate>
          {pickers.error ? <p className="text-xs text-danger">Couldn&apos;t load drivers or vehicles: {describeApiError(pickers.error)}</p> : null}
          {text("title", "Title")}
          <div className="grid gap-3 sm:grid-cols-2">
            <PickerField id="dpf-driverId" label="Driver" value={form.driverId} options={pickers.drivers} onChange={(v) => edit({ driverId: v })} error={errors.driverId} placeholder={pickers.loading ? "Loading…" : "Choose a driver"} />
            <PickerField id="dpf-deviceId" label="Vehicle" value={form.deviceId} options={pickers.devices} onChange={(v) => edit({ deviceId: v })} error={errors.deviceId} placeholder={pickers.loading ? "Loading…" : "Choose a vehicle"} />
          </div>
          {pickers.driversTruncated ? <p className="text-xs text-ink-muted">Showing the first 100 active drivers.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {when("scheduledStart", "Scheduled start")}
            {when("scheduledEnd", "Scheduled end")}
            {when("reportingTime", "Reporting time")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("origin", "Origin")}
            {text("destination", "Destination")}
          </div>
          {long("instructions", "Instructions")}
          {long("routeNotes", "Route notes")}
          {failure ? (
            <p className="text-[13px] text-danger" role="alert">
              {failure}
            </p>
          ) : null}
          <div className={cn("rounded-inner border p-3", checkedCurrent ? (check.result.ok ? "border-success/30 bg-success-soft/50" : "border-warning/30 bg-warning-soft/50") : "border-dashed border-line")}>
            {checkedCurrent ? (
              <>
                <p className="mb-2 text-[13px] font-semibold">{check.result.ok ? "No conflicts found" : "The server reported conflicts"}</p>
                <CheckList checks={check.result.conflicts} emptyText="No details returned." />
              </>
            ) : (
              <p className="text-xs text-ink-muted">Run “Check conflicts” (POST /dispatches/check) before saving. It validates the draft on the server and creates nothing.</p>
            )}
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="default"
        title={mode === "create" ? "Create this dispatch?" : "Save changes to this dispatch?"}
        description={checkedCurrent && !check.result.ok ? "The server reported conflicts for this draft. It may reject the request." : "The dispatch is saved on the server and the driver may be notified."}
        confirmLabel={mode === "create" ? "Create" : "Save"}
        onConfirm={save}
      />
    </SlideOverPanel>
  );
}
