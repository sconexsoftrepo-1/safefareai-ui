"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCheck, CircleSlash, FileVideo, Info, MessageSquarePlus, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alertService, type AlertNoteAction } from "@/features/drive-vision/api/alert-service";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { RESOLVE_OUTCOMES, type AlarmTypeDto, type AlertDetailDto, type AlertRow, type ResolveOutcome } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatRelative } from "@/features/drive-vision/utils/format";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField } from "../shared/form-field";
import { SearchInput } from "../shared/filter-bar";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import { useCan } from "@/features/drive-vision/access/use-access";
import { safeHttpUrl } from "../reports/reports-model";
import { ALARM_PAGE_SIZE, alarmLabel, deviceLabel, incidentQuery, type AlertsView } from "./alerts-model";

const SEARCH_DEBOUNCE_MS = 350;

/** Incident list on GET /alerts. Filters: the page's range/device/type plus open-only and keyword. */
export function IncidentsList({
  view,
  now,
  typeById,
  onPage,
  onOpen,
  onTotal,
}: {
  view: AlertsView;
  now: Date;
  typeById: Map<number | undefined, AlarmTypeDto>;
  onPage: (page: number) => void;
  onOpen: (id: number | null) => void;
  onTotal: (total: number | undefined) => void;
}) {
  const [openOnly, setOpenOnly] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const next = searchInput.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => {
      setKeyword(next);
      onPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, keyword, onPage]);

  const query = useMemo(() => incidentQuery(view, now, { openOnly, keyword }), [view, now, openOnly, keyword]);
  const listQ = useApiQuery(`incidents:${JSON.stringify(query)}:${version}`, () => alertService.listAlerts(query));
  useEffect(() => onTotal(listQ.data?.total), [listQ.data, onTotal]);
  const items = listQ.data?.items ?? [];

  const columns: DataTableColumn<AlertRow>[] = [
    {
      id: "event",
      header: "Alert",
      cell: (a) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            {alarmLabel(a, typeById)}
            {a.mediaStatus ? <FileVideo className="size-3.5 shrink-0 text-ink-subtle" aria-label={`Media: ${a.mediaStatus}`} /> : null}
          </p>
          <p className="text-xs text-ink-muted">{[a.kind, a.driverName].filter(Boolean).join(" · ") || "—"}</p>
        </div>
      ),
    },
    { id: "device", header: "Device", cell: (a) => deviceLabel(a) },
    {
      id: "time",
      header: "Time",
      cell: (a) =>
        a.alarmTime ? (
          <div>
            <p className="whitespace-nowrap tabular">{formatDateTime(a.alarmTime)}</p>
            <p className="text-xs text-ink-muted">{formatRelative(a.alarmTime, now)}</p>
          </div>
        ) : (
          "—"
        ),
    },
    { id: "assignee", header: "Assignee", hideBelow: "lg", cell: (a) => a.assigneeName ?? <span className="text-ink-subtle">—</span> },
    { id: "severity", header: "Severity", align: "right", hideBelow: "xl", cell: (a) => (typeof a.severity === "number" ? <span className="text-ink-muted tabular" title="Raw value; the scale is undocumented">{a.severity}</span> : "—") },
    { id: "status", header: "Status", cell: (a) => <HandlingBadge alert={a} /> },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <SearchInput label="Search alerts" value={searchInput} onChange={setSearchInput} placeholder="Keyword" className="w-full sm:w-56" />
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Checkbox checked={openOnly} onCheckedChange={(v) => (setOpenOnly(v === true), onPage(1))} /> Open only
        </label>
      </div>
      {listQ.error ? (
        <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
      ) : !listQ.data ? (
        <LoadingSkeleton variant="table" rows={8} />
      ) : (
        <DataTable
          caption="Incidents"
          data={items}
          columns={columns}
          getRowId={(a) => String(a.id)}
          onRowClick={(a) => a.id !== undefined && onOpen(a.id)}
          activeRowId={view.alarmId !== null ? String(view.alarmId) : null}
          isLoading={listQ.refreshing}
          pageSize={ALARM_PAGE_SIZE}
          serverPagination={{ page: view.page, total: listQ.data.total, onPageChange: onPage }}
          emptyTitle={openOnly ? "No open alerts" : "No alerts"}
          emptyDescription="The server returned no alerts for these filters."
        />
      )}
      <AlertWorkflowDrawer id={view.alarmId} typeById={typeById} onClose={() => onOpen(null)} onChanged={() => setVersion((v) => v + 1)} />
    </>
  );
}

function HandlingBadge({ alert }: { alert: AlertRow }) {
  if (!alert.handlingStatus) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge size="sm" tone={alert.handlingStatus === "NEW" ? "serious" : "neutral"}>
        {alert.handlingStatus}
      </StatusBadge>
      {alert.handlingOutcome ? <span className="font-mono text-[10.5px] text-ink-muted">{alert.handlingOutcome}</span> : null}
    </span>
  );
}

type Pending = { kind: AlertNoteAction } | { kind: "resolve" } | { kind: "comment" };

const ACTION_COPY: Record<Pending["kind"], { title: string; label: string; description: string; noteRequired?: boolean }> = {
  acknowledge: { title: "Acknowledge this alert?", label: "Acknowledge", description: "Records that you have seen the alert." },
  dismiss: { title: "Dismiss this alert?", label: "Dismiss", description: "Closes the alert without a resolution outcome." },
  reopen: { title: "Reopen this alert?", label: "Reopen", description: "Returns a closed alert to open handling." },
  resolve: { title: "Resolve this alert", label: "Resolve", description: "Closes the alert with an outcome." },
  comment: { title: "Add a comment", label: "Add comment", description: "Adds a note to the alert's history.", noteRequired: true },
};

/**
 * Alert detail and handling on GET /alerts/{id} (alert + actions + evidence). Every action is
 * confirmed, sent once, and the drawer then shows the alert exactly as the server returned it.
 * The server decides which transitions are allowed; a rejected one is shown with its message.
 * Assigning is not offered: the spec's body for POST /alerts/{id}/assign has no assignee field.
 */
export function AlertWorkflowDrawer({ id, typeById, onClose, onChanged }: { id: number | null; typeById: Map<number | undefined, AlarmTypeDto>; onClose: () => void; onChanged: () => void }) {
  const detailQ = useApiQuery(id !== null ? `incidents:detail:${id}` : null, () => alertService.getAlert(id!));
  const [updated, setUpdated] = useState<{ id: number; data: AlertDetailDto } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<ResolveOutcome | "">("");
  const canHandle = useCan("alerts.handle");
  const detail = updated && updated.id === id ? updated.data : detailQ.data;
  const alert = detail?.alert;
  const copy = pending ? ACTION_COPY[pending.kind] : null;
  const invalid = !pending || note.length > 1000 || (pending.kind === "comment" && !note.trim()) || (pending.kind === "resolve" && !outcome);

  async function run() {
    if (!pending || id === null) return;
    try {
      const body = note.trim() ? { note: note.trim() } : {};
      const next =
        pending.kind === "resolve"
          ? await alertService.resolve(id, { outcome: outcome as ResolveOutcome, ...body })
          : pending.kind === "comment"
            ? await alertService.comment(id, { note: note.trim() })
            : await alertService.noteAction(id, pending.kind, body);
      setUpdated({ id, data: next });
      setNote("");
      setOutcome("");
      toast.success(`${ACTION_COPY[pending.kind].label} sent`, { description: next.alert?.handlingStatus ? `Server status: ${next.alert.handlingStatus}` : undefined });
      onChanged();
    } catch (err) {
      toast.error("The server rejected the action", { description: describeApiError(err) });
      throw err;
    }
  }

  const evidence = detail?.evidence ?? [];
  const actions = detail?.actions ?? [];

  return (
    <>
      <SlideOverPanel
        open={id !== null}
        onOpenChange={(o) => !o && (onClose(), setUpdated(null))}
        title={alert ? alarmLabel(alert, typeById) : id !== null ? `Alert ${id}` : ""}
        description={alert ? `${deviceLabel(alert)}${alert.alarmTime ? ` · ${formatDateTime(alert.alarmTime)}` : ""}` : undefined}
        footer={
          alert && canHandle ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setPending({ kind: "comment" })}>
                <MessageSquarePlus /> Comment
              </Button>
              <Button variant="outline" onClick={() => setPending({ kind: "acknowledge" })}>
                <CheckCheck /> Acknowledge
              </Button>
              <Button variant="outline" onClick={() => setPending({ kind: "dismiss" })}>
                <CircleSlash /> Dismiss
              </Button>
              <Button variant="outline" onClick={() => setPending({ kind: "reopen" })}>
                <RotateCcw /> Reopen
              </Button>
              <Button onClick={() => setPending({ kind: "resolve" })}>
                <ShieldCheck /> Resolve
              </Button>
            </div>
          ) : undefined
        }
      >
        {detailQ.error && !detail ? (
          <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
        ) : !alert ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : (
          <div className="space-y-5">
            <dl className="divide-y divide-line">
              <DetailRow label="Status">
                <HandlingBadge alert={alert} />
              </DetailRow>
              <DetailRow label="Kind">{alert.kind ?? "—"}</DetailRow>
              <DetailRow label="Driver">{alert.driverName ?? "—"}</DetailRow>
              <DetailRow label="Assignee">{alert.assigneeName ?? "—"}</DetailRow>
              <DetailRow label="Speed">{typeof alert.speedKmh === "number" ? `${alert.speedKmh} km/h` : "—"}</DetailRow>
              <DetailRow label="Location">{alert.address ?? (typeof alert.lat === "number" && typeof alert.lon === "number" ? `${alert.lat.toFixed(5)}, ${alert.lon.toFixed(5)}` : "—")}</DetailRow>
              <DetailRow label="Handled">{alert.handledAt ? formatDateTime(alert.handledAt) : "—"}</DetailRow>
            </dl>

            <section aria-labelledby="inc-evidence">
              <h3 id="inc-evidence" className="mb-2 text-[13px] font-semibold">
                Evidence
              </h3>
              {evidence.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No evidence attached{alert.mediaStatus ? ` (media status: ${alert.mediaStatus})` : ""}.</p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {evidence.map((e, i) => {
                    // Placeholder hosts (the BFF returned https://example.invalid/… on 2026-10-29, #29) are never linked.
                    const url = safeHttpUrl(e.url);
                    return (
                      <li key={e.id ?? i} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate">
                          {e.mediaType ?? "Media"}
                          {typeof e.channel === "number" ? ` · ch ${e.channel}` : ""}
                          {e.status ? ` · ${e.status}` : ""}
                        </span>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-deep hover:underline">
                            Open
                          </a>
                        ) : (
                          <span className="text-xs text-ink-subtle" title={e.url ? "The server returned a link that can't be opened (placeholder or non-web address)" : undefined}>
                            {e.url ? "Link not usable" : "No link"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="inc-history">
              <h3 id="inc-history" className="mb-2 text-[13px] font-semibold">
                History
              </h3>
              {actions.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No handling actions yet.</p>
              ) : (
                <ol className="space-y-2 text-[13px]">
                  {actions.map((a, i) => (
                    <li key={a.id ?? i} className="rounded-xl bg-surface-muted px-3 py-2">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold">{a.actionType ?? "ACTION"}</span>
                        <span className="text-ink-muted">{a.automatic ? "automatic" : (a.actorName ?? (a.actorUserId !== undefined ? `User ${a.actorUserId}` : ""))}</span>
                        <span className="ml-auto text-xs text-ink-subtle tabular">{a.createdAt ? formatDateTime(a.createdAt) : ""}</span>
                      </p>
                      {a.note ? <p className="mt-0.5 text-ink-muted">{a.note}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <p className="flex items-start gap-1.5 text-xs text-ink-muted">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden /> The server decides which actions are allowed for the current status. Assigning alerts isn&apos;t available yet (the API contract for it is unclear).
            </p>
          </div>
        )}
      </SlideOverPanel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && (setPending(null), setNote(""), setOutcome(""))}
        tone={pending?.kind === "dismiss" ? "danger" : "default"}
        title={copy?.title ?? ""}
        description={copy?.description}
        confirmLabel={copy?.label}
        confirmDisabled={invalid}
        onConfirm={run}
      >
        <div className="space-y-3">
          {pending?.kind === "resolve" ? (
            <FormField id="inc-outcome" label="Outcome" required>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as ResolveOutcome)}>
                <SelectTrigger id="inc-outcome" className="w-full">
                  <SelectValue placeholder="Choose an outcome" />
                </SelectTrigger>
                <SelectContent>
                  {RESOLVE_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField id="inc-note" label={copy?.noteRequired ? "Comment" : "Note (optional)"} required={copy?.noteRequired} error={note.length > 1000 ? "Use 1000 characters or fewer." : undefined}>
            <Textarea id="inc-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
      </ConfirmDialog>
    </>
  );
}
