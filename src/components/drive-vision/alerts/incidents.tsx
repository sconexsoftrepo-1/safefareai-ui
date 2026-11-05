"use client";

import { useEffect, useState, type RefObject } from "react";
import { CheckCheck, CircleSlash, FileVideo, MessageSquarePlus, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alertService, type AlertNoteAction } from "@/features/drive-vision/api/alert-service";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { RESOLVE_OUTCOMES, type AlarmTypeDto, type AlertDetailDto, type AlertRow, type ResolveOutcome } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { usePolledQuery } from "@/features/drive-vision/hooks/use-polled-query";
import { canAccessScreen } from "@/features/drive-vision/access/access-policy";
import { formatLocalDateTime, formatRelative } from "@/features/drive-vision/utils/format";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField } from "../shared/form-field";
import { SearchInput } from "../shared/filter-bar";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import { useAccess, useCan } from "@/features/drive-vision/access/use-access";
import { safeHttpUrl } from "../reports/reports-model";
import { ALARM_PAGE_SIZE, alarmLabel, deviceLabel, incidentQuery, severityLabel, type AlertKindParam, type AlertsTab, type AlertsView } from "./alerts-model";

const SEARCH_DEBOUNCE_MS = 350;
const KIND_TAB: Record<AlertKindParam, AlertsTab> = { AI: "ai", ROUTINE: "routine" };
const KIND_NAME: Record<AlertKindParam, string> = { AI: "AI events", ROUTINE: "routine alarms" };

/**
 * The live alert list on GET /alerts, polled every 5 seconds while it is on screen: Incidents shows every kind, the
 * AI and Routine tabs pass `alertKind`. Filters: the page's range/device/type plus open-only and keyword; a filter
 * change restarts the loop on the new query at once. The AI and Routine tabs also poll the other tab's total
 * (pageSize 1). Needs `alarm.read`: without it nothing is requested.
 */
export function IncidentsList({
  view,
  now,
  typeById,
  alertKind,
  refreshRef,
  onPage,
  onOpen,
  onTotal,
}: {
  view: AlertsView;
  now: Date;
  typeById: Map<number | undefined, AlarmTypeDto>;
  alertKind?: AlertKindParam;
  /** Set to the list's "poll now", for the page's Refresh button. */
  refreshRef: RefObject<(() => void) | null>;
  onPage: (page: number) => void;
  onOpen: (id: number | null) => void;
  onTotal: (tab: AlertsTab, total: number | undefined) => void;
}) {
  const [openOnly, setOpenOnly] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const canRead = canAccessScreen(useAccess(), "alerts");

  useEffect(() => {
    const next = searchInput.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => {
      setKeyword(next);
      onPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, keyword, onPage]);

  const filters = JSON.stringify([view.range, view.deviceId, view.typeId, openOnly, keyword]);
  const listQ = usePolledQuery(canRead ? `alerts:live:${alertKind ?? "all"}:${filters}:${view.page}` : null, (signal) => alertService.listAlerts(incidentQuery(view, new Date(), { openOnly, keyword, kind: alertKind }), signal));
  const otherKind: AlertKindParam | null = alertKind ? (alertKind === "AI" ? "ROUTINE" : "AI") : null;
  const otherQ = usePolledQuery(canRead && otherKind ? `alerts:live-count:${otherKind}:${filters}` : null, (signal) => alertService.listAlerts({ ...incidentQuery(view, new Date(), { openOnly, keyword, kind: otherKind! }), pageNumber: 1, pageSize: 1 }, signal));

  const total = listQ.data?.total;
  const otherTotal = otherQ.data?.total;
  const { refetch } = listQ;
  useEffect(() => onTotal(alertKind ? KIND_TAB[alertKind] : "incidents", total), [alertKind, total, onTotal]);
  useEffect(() => {
    if (otherKind) onTotal(KIND_TAB[otherKind], otherTotal);
  }, [otherKind, otherTotal, onTotal]);
  useEffect(() => {
    refreshRef.current = refetch;
  }, [refetch, refreshRef]);
  // Alerts close while this is open, so the current page can stop existing.
  useEffect(() => {
    if (total !== undefined && view.page > 1 && (view.page - 1) * ALARM_PAGE_SIZE >= total) onPage(Math.max(1, Math.ceil(total / ALARM_PAGE_SIZE)));
  }, [total, view.page, onPage]);

  const items = listQ.data?.items ?? [];
  const noun = alertKind ? KIND_NAME[alertKind] : "alerts";
  const shownAt = listQ.updatedAt ? new Date(listQ.updatedAt) : now;

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
    {
      id: "device",
      header: "Device",
      cell: (a) => (
        <div className="min-w-0">
          <p className="font-medium">{deviceLabel(a)}</p>
          {a.terminalNo && a.deviceName ? <p className="font-mono text-[11px] text-ink-muted tabular">{a.terminalNo}</p> : null}
        </div>
      ),
    },
    {
      id: "time",
      header: "Time",
      cell: (a) =>
        a.alarmTime ? (
          <div>
            <p className="whitespace-nowrap tabular">{formatLocalDateTime(a.alarmTime)}</p>
            <p className="text-xs text-ink-muted">{formatRelative(a.alarmTime, shownAt)}</p>
          </div>
        ) : (
          "—"
        ),
    },
    { id: "assignee", header: "Assignee", hideBelow: "lg", cell: (a) => a.assigneeName ?? <span className="text-ink-subtle">—</span> },
    { id: "severity", header: "Severity", cell: (a) => <SeverityBadge severity={a.severity} /> },
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
      {listQ.stale ? (
        <p className="mx-4 mt-3 rounded-lg bg-warning-soft px-3 py-1.5 text-xs text-warning" role="status" data-testid="alerts-stale">
          Couldn&apos;t refresh. Showing the last update{listQ.updatedAt ? ` from ${formatLocalDateTime(new Date(listQ.updatedAt))}` : ""}; trying again.
        </p>
      ) : null}
      {listQ.error && !listQ.data ? (
        <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
      ) : !listQ.data ? (
        <LoadingSkeleton variant="table" rows={8} />
      ) : (
        <DataTable
          caption={alertKind ? KIND_NAME[alertKind] : "Incidents"}
          data={items}
          columns={columns}
          getRowId={(a) => String(a.id)}
          onRowClick={(a) => a.id !== undefined && onOpen(a.id)}
          activeRowId={view.alarmId !== null ? String(view.alarmId) : null}
          pageSize={ALARM_PAGE_SIZE}
          serverPagination={{ page: view.page, total: listQ.data.total, onPageChange: onPage }}
          emptyTitle={openOnly ? `No open ${noun}` : `No ${noun}`}
          emptyDescription={`The server returned no ${noun} for these filters.`}
        />
      )}
      <AlertWorkflowDrawer id={view.alarmId} typeById={typeById} onClose={() => onOpen(null)} onChanged={refetch} />
    </>
  );
}

function SeverityBadge({ severity }: { severity: number | null | undefined }) {
  if (typeof severity !== "number") return <span className="text-ink-subtle">—</span>;
  return (
    <StatusBadge size="sm" tone={severity === 1 ? "serious" : severity === 2 ? "warning" : "neutral"}>
      {severityLabel(severity)}
    </StatusBadge>
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
        description={alert ? `${deviceLabel(alert)}${alert.alarmTime ? ` · ${formatLocalDateTime(alert.alarmTime)}` : ""}` : undefined}
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
              <DetailRow label="Severity">
                <SeverityBadge severity={alert.severity} />
              </DetailRow>
              <DetailRow label="Kind">{alert.kind ?? "—"}</DetailRow>
              <DetailRow label="Device">{deviceLabel(alert)}</DetailRow>
              {alert.terminalNo ? (
                <DetailRow label="Terminal">
                  <span className="font-mono text-xs">{alert.terminalNo}</span>
                </DetailRow>
              ) : null}
              <DetailRow label="Alarm time">{alert.alarmTime ? formatLocalDateTime(alert.alarmTime) : "—"}</DetailRow>
              <DetailRow label="Driver (server)">
                <span title="As reported by the server for this alert. The app never derives an alarm's driver from the vehicle's current assignment.">{alert.driverName ?? "—"}</span>
              </DetailRow>
              <DetailRow label="Assignee">{alert.assigneeName ?? "—"}</DetailRow>
              <DetailRow label="Speed">{typeof alert.speedKmh === "number" ? `${alert.speedKmh} km/h` : "—"}</DetailRow>
              <DetailRow label="Location">{alert.address ?? (typeof alert.lat === "number" && typeof alert.lon === "number" ? `${alert.lat.toFixed(5)}, ${alert.lon.toFixed(5)}` : "—")}</DetailRow>
              <DetailRow label="Handled">{alert.handledAt ? formatLocalDateTime(alert.handledAt) : "—"}</DetailRow>
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
                        {a.assigneeName ? <span className="text-ink-muted">→ {a.assigneeName}</span> : null}
                        <span className="ml-auto text-xs text-ink-subtle tabular">{a.createdAt ? formatLocalDateTime(a.createdAt) : ""}</span>
                      </p>
                      {a.note ? <p className="mt-0.5 text-ink-muted">{a.note}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
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
