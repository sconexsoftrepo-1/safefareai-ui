"use client";

import { useMemo, useState } from "react";
import { Info, RefreshCw, ShieldAlert, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { CommandDefinitionDto, CommandDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDateTime, formatNumber } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { StatusBadge } from "../shared/status-badge";
import { commandDetailView, rawValue } from "./commands-model";

const PAGE_SIZE = 20;
type Tab = "history" | "types";


/**
 * Device Commands — read-only on live BFF data: GET /commands (history, server-paged),
 * GET /commands/{id} (detail) and GET /commands/types (catalogue). Sending (POST /commands) is
 * deliberately not available: permissions, target ownership and the `confirm` flag's semantics
 * are unconfirmed, and commands act on real vehicles.
 */
export function DeviceCommands() {
  const [tab, setTab] = useState<Tab>("history");
  const [type, setType] = useState("all");
  const [deviceId, setDeviceId] = useState("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const typesQ = useApiQuery("commands:types", () => fleetService.commandTypes());
  const devicesQ = useApiQuery("commands:devices", () => fleetService.listAllDevices());
  const listQ = useApiQuery(tab === "history" ? `commands:list:${type}:${deviceId}:${page}` : null, () =>
    fleetService.listCommands({ type: type === "all" ? undefined : type, deviceId: deviceId === "all" ? undefined : Number(deviceId), pageNumber: page, pageSize: PAGE_SIZE })
  );
  const detailQ = useApiQuery(openId !== null ? `commands:detail:${openId}` : null, () => fleetService.getCommand(openId!));

  const types = useMemo(() => typesQ.data?.items ?? [], [typesQ.data]);
  const typeOptions = [{ value: "all", label: "All types" }, ...types.filter((t) => t.type).map((t) => ({ value: t.type!, label: t.type! }))];
  const deviceName = (id?: number) => devicesQ.data?.items.find((d) => d.id === id)?.name ?? (id !== undefined ? `Device ${id}` : "—");

  const columns: DataTableColumn<CommandDto>[] = [
    { id: "type", header: "Command", cell: (c) => <span className="font-mono text-xs font-medium">{c.type ?? "—"}</span> },
    { id: "status", header: "Status", cell: (c) => <StatusBadge size="sm" tone="neutral">{c.status ?? "No status"}</StatusBadge> },
    { id: "targets", header: "Devices", align: "right", cell: (c) => c.targetCount ?? c.targets?.length ?? "—" },
    { id: "created", header: "Requested", cell: (c) => (c.createdAt ? <span className="tabular">{formatDateTime(c.createdAt)}</span> : "—") },
    { id: "completed", header: "Completed", hideBelow: "md", cell: (c) => (c.completedAt ? <span className="tabular">{formatDateTime(c.completedAt)}</span> : "—") },
  ];

  const detail = detailQ.data ? commandDetailView(detailQ.data) : null;

  return (
    <div>
      <PageHeader
        title="Device Commands"
        description={tab === "history" ? (listQ.data ? `${formatNumber(listQ.data.total)} command${listQ.data.total === 1 ? "" : "s"}` : listQ.error ? "Couldn't load commands" : "Loading commands…") : `${types.length} command type${types.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="outline" onClick={() => (tab === "history" ? listQ.refetch() : typesQ.refetch())} disabled={tab === "history" ? listQ.loading : typesQ.loading}>
            <RefreshCw className={listQ.refreshing || typesQ.refreshing ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />

      <div className="mb-3 flex items-start gap-3 rounded-card border border-line bg-surface-muted px-4 py-3 text-[13px] text-ink-muted" role="note">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <strong className="text-ink">Read-only.</strong> Sending commands is turned off until the required permission, device ownership checks and the server&apos;s confirmation rules are agreed. Commands act on real vehicles.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "history", label: "History" },
            { value: "types", label: "Command types" },
          ]}
        />
        {tab === "history" ? (
          <FilterBar>
            <FilterSelect label="Type" value={type} onChange={(v) => (setType(v), setPage(1))} options={typeOptions} className="max-w-56" />
            <FilterSelect
              label="Device"
              value={deviceId}
              onChange={(v) => (setDeviceId(v), setPage(1))}
              options={[{ value: "all", label: "All devices" }, ...(devicesQ.data?.items ?? []).filter((d) => d.id !== undefined).map((d) => ({ value: String(d.id), label: d.name ?? `Device ${d.id}` }))]}
              className="max-w-56"
            />
          </FilterBar>
        ) : null}
      </div>

      {tab === "history" ? (
        <Panel className="overflow-hidden">
          {listQ.error ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="table" rows={8} />
          ) : (
            <DataTable
              caption="Command history"
              data={listQ.data.items}
              columns={columns}
              getRowId={(c) => String(c.id)}
              onRowClick={(c) => c.id !== undefined && setOpenId(c.id)}
              activeRowId={openId !== null ? String(openId) : null}
              isLoading={listQ.refreshing}
              pageSize={PAGE_SIZE}
              serverPagination={{ page, total: listQ.data.total, onPageChange: setPage }}
              emptyTitle="No commands"
              emptyDescription="The server returned no commands for these filters."
            />
          )}
        </Panel>
      ) : (
        <TypesPanel q={typesQ} types={types} />
      )}

      <SlideOverPanel open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)} title={detail?.type ?? (openId !== null ? `Command ${openId}` : "")} description={detail?.section ?? undefined}>
        {detailQ.error ? (
          <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
        ) : !detail ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : (
          <div className="space-y-4">
            <dl className="divide-y divide-line">
              <DetailRow label="Status">{detail.status ?? "—"}</DetailRow>
              <DetailRow label="Requested">{detail.createdAt ? formatDateTime(detail.createdAt) : "—"}</DetailRow>
              <DetailRow label="Completed">{detail.completedAt ? formatDateTime(detail.completedAt) : "—"}</DetailRow>
              <DetailRow label="Requested by">{detail.requestedBy !== null ? `User ${detail.requestedBy}` : "—"}</DetailRow>
              <DetailRow label="Parameters">
                <code className="text-xs break-all">{detail.params}</code>
              </DetailRow>
            </dl>
            <div>
              <p className="mb-2 text-[13px] font-semibold">Targets</p>
              {detail.targetCountMismatch || detail.droppedTargets > 0 ? (
                <p className="mb-2 text-xs text-warning">
                  {[
                    detail.targetCountMismatch ? `The server counts ${detail.targetCount} target${detail.targetCount === 1 ? "" : "s"} but returned ${detail.targets.length}.` : null,
                    detail.droppedTargets > 0 ? `${detail.droppedTargets} malformed target entr${detail.droppedTargets === 1 ? "y was" : "ies were"} skipped.` : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              ) : null}
              {detail.targets.length === 0 ? (
                <p className="text-xs text-ink-muted">No targets returned.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.targets.map((t) => (
                    <li key={t.key} className="rounded-xl border border-line p-3 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.deviceId !== null ? deviceName(t.deviceId) : "Unknown device"}</span>
                        {t.terminalNo ? <span className="font-mono text-[11px] text-ink-muted">{t.terminalNo}</span> : null}
                        <StatusBadge size="sm" tone="neutral">
                          {t.status ?? "No status"}
                        </StatusBadge>
                      </div>
                      {t.failReason ? <p className="mt-1 text-xs text-danger">{t.failReason}</p> : null}
                      <p className="mt-1 text-xs text-ink-muted">
                        Sent {t.sentAt ? formatDateTime(t.sentAt) : "—"} · finished {t.finishedAt ? formatDateTime(t.finishedAt) : "—"}
                      </p>
                      {t.result !== undefined && t.result !== null ? <code className="mt-1 block text-xs break-all text-ink-muted">{rawValue(t.result)}</code> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SlideOverPanel>
    </div>
  );
}

function TypesPanel({ q, types }: { q: { error: unknown; data: unknown; refetch: () => void }; types: CommandDefinitionDto[] }) {
  const sections = useMemo(() => {
    const map = new Map<string, CommandDefinitionDto[]>();
    for (const t of types) map.set(t.section ?? "Other", [...(map.get(t.section ?? "Other") ?? []), t]);
    return [...map.entries()];
  }, [types]);
  if (q.error) return <Panel><ApiErrorState error={q.error} onRetry={q.refetch} /></Panel>;
  if (!q.data) return <Panel><LoadingSkeleton variant="list" rows={6} /></Panel>;
  if (types.length === 0) return <Panel><EmptyState icon={SquareTerminal} title="No command types" description="The server returned no command types." /></Panel>;
  return (
    <div className="space-y-4">
      {sections.map(([section, list]) => (
        <Panel key={section}>
          <PanelHeader title={section} />
          <ul className="divide-y divide-line">
            {list.map((t) => (
              <li key={t.type} className="px-5 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{t.type}</span>
                  {t.critical ? <StatusBadge size="sm" tone="danger">Critical</StatusBadge> : null}
                  {t.singleDevice ? <StatusBadge size="sm" tone="info">One device at a time</StatusBadge> : null}
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Required: {(t.required ?? []).join(", ") || "none"} · Optional: {(t.optional ?? []).join(", ") || "none"}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      <p className="flex items-start gap-1.5 px-1 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>Catalogue from GET /commands/types. Field formats are listed by the server but sending stays off.</span>
      </p>
    </div>
  );
}
