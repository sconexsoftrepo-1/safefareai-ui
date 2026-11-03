"use client";

import { useMemo, useState } from "react";
import { Loader2, Lock, RotateCcw, Save, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { canPerform, canViewWidget } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { roleAdminService } from "@/features/drive-vision/api/role-admin-service";
import type { PermissionDto, RoleDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatNumber } from "@/features/drive-vision/utils/format";
import { Panel } from "../shared/panel";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { toast } from "../shared/toast-provider";
import {
  MATRIX_ACTIONS,
  NO_CHANGES,
  buildPermissionMatrix,
  codeEditable,
  desiredSelection,
  filterMatrix,
  groupState,
  isGlobalRole,
  mappingEditBlock,
  permissionModule,
  planChanges,
  replaceRequest,
  setCodes,
  type PendingChanges,
  type SelectionRights,
} from "./role-permission-model";

const checkedOf = (state: "all" | "none" | "some") => (state === "all" ? true : state === "some" ? "indeterminate" : false);

/**
 * Role permissions as a module × Add / Edit / Delete / View grid (Permission Catalogue, Safe-Fare Admin).
 * Choose a role, then GET /permissions (the catalogue) and GET /roles/{id}/permissions (what it holds) load.
 * Changes stay local until Save, which sends the role's whole list with PUT /roles/{id}/permissions after a
 * review. Every call is platform-wide (no tenant header).
 */
export function RolePermissionMatrix() {
  const access = useAccess();
  const canReplace = canPerform(access, "rolePermissions.replace");
  const canReadAssignments = canViewWidget(access, "roles.permissions");
  const rolesQ = useApiQuery("platform-roles:list", () => roleAdminService.listRoles());
  const [roleId, setRoleId] = useState<number | null>(null);
  const [pendingRole, setPendingRole] = useState<number | null>(null);
  const catalogQ = useApiQuery(roleId !== null ? "platform-permissions:list" : null, () => roleAdminService.listPermissions());
  const assignedQ = useApiQuery(roleId !== null && canReadAssignments ? `platform-role-permissions:${roleId}` : null, () => roleAdminService.rolePermissions(roleId!));
  const [pending, setPending] = useState<PendingChanges>(NO_CHANGES);
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const roles = useMemo(() => [...(rolesQ.data?.items ?? [])].filter((r) => typeof r.id === "number").sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "")), [rolesQ.data]);
  const role = roles.find((r) => r.id === roleId);
  const catalog = useMemo(() => catalogQ.data?.items ?? [], [catalogQ.data]);
  const assigned = useMemo(() => new Set(assignedQ.data?.permissionCodes ?? []), [assignedQ.data]);
  const describe = useMemo(() => new Map(catalog.filter((p): p is PermissionDto & { code: string } => !!p.code).map((p) => [p.code, p])), [catalog]);
  const rows = useMemo(() => buildPermissionMatrix([...catalog.map((p) => p.code).filter((c): c is string => !!c), ...assigned]), [catalog, assigned]);
  const shown = useMemo(() => filterMatrix(rows, query), [rows, query]);
  const selected = desiredSelection(assigned, pending);

  const block = !role ? "Choose a role." : !canReadAssignments ? "Needs role.permission.read to show this role's permissions." : mappingEditBlock(role, assignedQ.data);
  const rights: SelectionRights = { locked: block !== null || !canReplace || saving, canAdd: true, canRemove: true };
  const changes = pending.additions.size + pending.removals.size;
  const ownRole = access.identity?.roleId === roleId;
  const plan = planChanges(pending, assigned, { catalog, canAdd: canReplace, canRemove: canReplace, ownRole });
  const request = replaceRequest(assigned, pending);
  const problems = [...plan.problems, ...request.problems];
  const loaded = catalogQ.data !== undefined && assignedQ.data !== undefined;

  const toggle = (codes: readonly string[], checked: boolean) => setPending((p) => setCodes(p, codes, checked, assigned, rights));

  function chooseRole(next: number) {
    if (next === roleId) return;
    if (changes > 0) setPendingRole(next);
    else switchRole(next);
  }
  function switchRole(next: number) {
    setRoleId(next);
    setPending(NO_CHANGES);
    setQuery("");
  }

  async function save() {
    if (roleId === null || problems.length) return;
    setSaving(true);
    try {
      await roleAdminService.replaceRolePermissions(roleId, request.permissionCodes);
      toast.success(`Permissions saved for ${role?.code ?? `role ${roleId}`}`, { description: `${plan.add.length} added · ${plan.remove.length} removed` });
      setPending(NO_CHANGES);
      assignedQ.refetch();
    } catch (err) {
      // Nothing changed on the server: keep the selection so the user can retry or reset.
      toast.error("The server refused the change", { description: describeApiError(err) });
      throw err;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Panel className="p-4">
        <div className="grid items-center gap-3 @2xl:grid-cols-[minmax(0,180px)_minmax(0,420px)_1fr]">
          <label htmlFor="rpm-role" className="text-[13px] font-medium text-ink">
            Select role<span className="text-danger" aria-hidden>*</span>
          </label>
          {rolesQ.error && !rolesQ.data ? (
            <ApiErrorState error={rolesQ.error} onRetry={rolesQ.refetch} compact />
          ) : (
            <Select value={roleId !== null ? String(roleId) : ""} onValueChange={(v) => chooseRole(Number(v))} disabled={!rolesQ.data || saving}>
              <SelectTrigger id="rpm-role" className="h-11 w-full" data-testid="role-select">
                <SelectValue placeholder={rolesQ.data ? "Choose a role" : "Loading roles…"} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    <RoleOption role={r} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {role ? (
            <p className="text-xs text-ink-muted @2xl:justify-self-end">
              {role.description || "No description"} · {isGlobalRole(role) ? "Global role" : `Tenant ${role.tenantId} role`}
              {typeof role.activeUsers === "number" ? ` · ${formatNumber(role.activeUsers)} active user${role.activeUsers === 1 ? "" : "s"}` : ""}
            </p>
          ) : null}
        </div>
      </Panel>

      {roleId === null ? (
        <Panel>
          <EmptyState icon={ShieldCheck} title="Select a role" description="Choose a role to load the permission catalogue and tick what that role may do." />
        </Panel>
      ) : catalogQ.error && !catalogQ.data ? (
        <Panel>
          <ApiErrorState error={catalogQ.error} onRetry={catalogQ.refetch} title="Couldn't load the permission catalogue" />
        </Panel>
      ) : assignedQ.error && !assignedQ.data ? (
        <Panel>
          <ApiErrorState error={assignedQ.error} onRetry={assignedQ.refetch} title="Couldn't load this role's permissions" />
        </Panel>
      ) : !loaded && canReadAssignments ? (
        <Panel>
          <LoadingSkeleton variant="table" rows={8} />
        </Panel>
      ) : (
        <>
          {block || !canReplace ? (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status" data-testid="matrix-locked">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {block ?? "Read-only: saving needs role.permission.update."}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/70 bg-surface px-3 shadow-card">
              <Search className="size-4 text-ink-subtle" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search module or code" aria-label="Search modules" className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
            </label>
            <p className="text-[12.5px] text-ink-muted tabular @3xl:px-2">
              {formatNumber(selected.size)} of {formatNumber(rows.reduce((n, r) => n + r.codes.length, 0))} selected
              {changes ? (
                <span className="ml-1.5 font-medium text-brand-deep">
                  · +{pending.additions.size} −{pending.removals.size} unsaved
                </span>
              ) : null}
            </p>
            {!rights.locked || changes ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPending(NO_CHANGES)} disabled={!changes || saving}>
                  <RotateCcw /> Reset
                </Button>
                <Button onClick={() => setReviewing(true)} disabled={!changes || saving || !canReplace} data-testid="matrix-save">
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
                </Button>
              </div>
            ) : null}
          </div>

          <Panel className="overflow-hidden">
            {shown.length === 0 ? (
              <EmptyState icon={Search} title="No matching modules" description="Change the search." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]" data-testid="permission-matrix">
                  <caption className="sr-only">Permissions of role {role?.code}</caption>
                  <thead className="dv-thead text-left text-xs">
                    <tr>
                      <th scope="col" className="w-12 px-4 py-3">
                        <Checkbox
                          aria-label="Select every shown permission"
                          checked={checkedOf(groupState(shown.flatMap((r) => r.codes), selected))}
                          onCheckedChange={(v) => toggle(shown.flatMap((r) => r.codes), v === true)}
                          disabled={rights.locked}
                        />
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Module name
                      </th>
                      {MATRIX_ACTIONS.map((a) => {
                        const codes = shown.map((r) => r.cells[a.key]).filter((c): c is string => !!c);
                        return (
                          <th key={a.key} scope="col" className="w-24 px-3 py-3">
                            <span className="inline-flex items-center gap-2">
                              <Checkbox aria-label={`Select ${a.label} for every shown module`} checked={checkedOf(groupState(codes, selected))} onCheckedChange={(v) => toggle(codes, v === true)} disabled={rights.locked || codes.length === 0} />
                              {a.label}
                            </span>
                          </th>
                        );
                      })}
                      <th scope="col" className="px-3 py-3">
                        Other
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {shown.map((row) => (
                      <tr key={row.module} className={cn("align-middle even:bg-surface-muted/40", row.codes.some((c) => pending.additions.has(c) || pending.removals.has(c)) && "bg-brand-tint/40 even:bg-brand-tint/40")}>
                        <td className="px-4 py-2.5">
                          <Checkbox aria-label={`All ${row.label} permissions`} checked={checkedOf(groupState(row.codes, selected))} onCheckedChange={(v) => toggle(row.codes, v === true)} disabled={rights.locked} />
                        </td>
                        <th scope="row" className="px-3 py-2.5 text-left font-normal">
                          <span className="block font-medium text-ink">{row.label}</span>
                          <span className="block font-mono text-[11px] text-ink-subtle">{row.module}</span>
                        </th>
                        {MATRIX_ACTIONS.map((a) => {
                          const code = row.cells[a.key];
                          return (
                            <td key={a.key} className="px-3 py-2.5">
                              {code ? <CodeBox code={code} label={`${a.label} ${row.label}`} checked={selected.has(code)} changed={pending.additions.has(code) || pending.removals.has(code)} disabled={!codeEditable(code, assigned, rights)} title={describeCode(describe.get(code), code)} onChange={(v) => toggle([code], v)} /> : null}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          {row.others.length ? (
                            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                              {row.others.map((code) => (
                                <span key={code} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                  <CodeBox code={code} label={code} checked={selected.has(code)} changed={pending.additions.has(code) || pending.removals.has(code)} disabled={!codeEditable(code, assigned, rights)} title={describeCode(describe.get(code), code)} onChange={(v) => toggle([code], v)} />
                                  <span className={cn("text-xs", selected.has(code) ? "text-ink" : "text-ink-muted")} aria-hidden>
                                    {permissionModule(code).action || code}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={reviewing}
        onOpenChange={(o) => !o && !saving && setReviewing(false)}
        tone="default"
        title={`Save permissions for ${role?.code ?? "this role"}?`}
        description="Replaces the role's whole permission list on the server. Everyone holding this role is affected on their next sign-in or token refresh."
        confirmLabel="Save permissions"
        confirmDisabled={problems.length > 0}
        onConfirm={save}
      >
        <div className="space-y-2 text-[13px]" data-testid="matrix-review">
          <p>
            <span className="font-medium text-success">+{plan.add.length} added</span> · <span className="font-medium text-danger">−{plan.remove.length} removed</span> · {request.permissionCodes.length} in total
          </p>
          {plan.add.length ? <CodeList label="Added" codes={plan.add} /> : null}
          {plan.remove.length ? <CodeList label="Removed" codes={plan.remove} /> : null}
          {[...problems.map((t) => ({ t, tone: "text-danger bg-danger-soft" })), ...plan.warnings.map((t) => ({ t, tone: "text-warning bg-warning-soft" }))].map(({ t, tone }) => (
            <p key={t} className={cn("rounded-lg px-2 py-1.5 text-xs", tone)}>
              {t}
            </p>
          ))}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(o) => !o && setPendingRole(null)}
        tone="danger"
        title="Discard unsaved changes?"
        description={`You have ${changes} unsaved change${changes === 1 ? "" : "s"} for ${role?.code ?? "this role"}. Switching roles discards them.`}
        confirmLabel="Discard and switch"
        onConfirm={() => {
          if (pendingRole !== null) switchRole(pendingRole);
          setPendingRole(null);
        }}
      />
    </div>
  );
}

function RoleOption({ role }: { role: RoleDto }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium">{role.code}</span>
      {role.description ? <span className="truncate text-xs text-ink-muted">{role.description}</span> : null}
      {!isGlobalRole(role) ? (
        <StatusBadge size="sm" tone="neutral">
          Tenant
        </StatusBadge>
      ) : null}
    </span>
  );
}

function describeCode(p: PermissionDto | undefined, code: string) {
  if (!p) return `${code} — not in the catalogue (held by this role)`;
  return `${code}${p.description ? ` — ${p.description}` : ""}${p.scope ? ` (${p.scope})` : ""}`;
}

function CodeBox({ code, label, checked, changed, disabled, title, onChange }: { code: string; label: string; checked: boolean; changed: boolean; disabled: boolean; title?: string; onChange: (v: boolean) => void }) {
  return (
    <span title={title} className={cn("inline-grid rounded-[6px] p-0.5", changed && "ring-2 ring-brand/40")} data-code={code}>
      <Checkbox aria-label={label} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
    </span>
  );
}

function CodeList({ label, codes }: { label: string; codes: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="max-h-28 overflow-y-auto font-mono text-[11.5px] break-words text-ink">{codes.join(", ")}</p>
    </div>
  );
}
