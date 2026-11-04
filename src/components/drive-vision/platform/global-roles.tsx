"use client";

import { useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { canPerform } from "@/features/drive-vision/access/access-policy";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import { roleAdminService } from "@/features/drive-vision/api/role-admin-service";
import type { RoleDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatNumber, formatTime } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { toast } from "../shared/toast-provider";
import { RolePermissionEditor } from "./role-permission-editor";
import { DESCRIPTION_MAX, filterRoles, isGlobalRole, permissionCount, roleDeleteBlock, roleEditBlock, roleScope, validateRole, type RoleFlagFilter, type RoleScope } from "./role-permission-model";

const SCOPES: { value: RoleScope; label: string }[] = [
  { value: "global", label: "Global roles" },
  { value: "tenant", label: "Tenant roles (view only)" },
];
const FLAGS: { value: RoleFlagFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "protected", label: "Protected" },
  { value: "custom", label: "Not protected" },
  { value: "fullAccess", label: "Full access" },
];

function RoleFlags({ r }: { r: RoleDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      {r.protectedRole === true ? (
        <StatusBadge size="sm" tone="brand">
          Protected
        </StatusBadge>
      ) : null}
      {r.fullAccess === true ? (
        <StatusBadge size="sm" tone="lavender">
          Full access
        </StatusBadge>
      ) : null}
      {r.assignable === false ? (
        <StatusBadge size="sm" tone="neutral">
          Not assignable
        </StatusBadge>
      ) : null}
    </span>
  );
}

const countLabel = (r: RoleDto) => {
  const c = permissionCount(r);
  return c === "all" ? "All" : c === null ? "—" : formatNumber(c);
};

/**
 * Global Roles (Phase 7; server routePath /platform/roles). Safe-Fare Admin only (platformOnly + role.read).
 * Lists GET /roles without a tenant header; roles without a tenantId are global and managed here, tenant roles
 * are shown read-only. Create / edit description / delete use the V10 role operations (role.manage).
 */
export function GlobalRoles() {
  const access = useAccess();
  const can = { create: canPerform(access, "roles.create"), update: canPerform(access, "roles.update"), del: canPerform(access, "roles.delete") };
  const listQ = useApiQuery("platform-roles:list", () => roleAdminService.listRoles());
  const [scope, setScope] = useState<RoleScope>("global");
  const [flag, setFlag] = useState<RoleFlagFilter>("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [form, setForm] = useState<{ mode: "create" | "edit"; role?: RoleDto } | null>(null);
  const [deleting, setDeleting] = useState<RoleDto | null>(null);

  const roles = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const rows = useMemo(() => filterRoles(roles, query, scope, flag), [roles, query, scope, flag]);
  const counts = { global: roles.filter(isGlobalRole).length, tenant: roles.filter((r) => !isGlobalRole(r)).length };
  const detail = detailId === null ? null : (roles.find((r) => r.id === detailId) ?? null);

  async function confirmDelete() {
    if (!deleting?.id) return;
    try {
      await roleAdminService.deleteRole(deleting.id);
      toast.success(`Role ${deleting.code ?? deleting.id} deleted`);
      if (detailId === deleting.id) setDetailId(null);
      listQ.refetch();
    } catch (err) {
      toast.error("The server refused the delete", { description: describeApiError(err) });
      throw err; // keep the dialog open
    }
  }

  return (
    <div>
      <PageHeader
        title="Global Roles"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-semibold text-brand-deep">
              <ShieldCheck className="size-3.5" aria-hidden /> Platform configuration · not tenant-scoped
            </span>
            {listQ.data && listQ.updatedAt ? <span>Updated {formatTime(new Date(listQ.updatedAt))}</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={listQ.refetch} disabled={listQ.loading || listQ.refreshing} aria-label="Refresh roles">
              <RefreshCw className={listQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            {can.create ? (
              <Button onClick={() => setForm({ mode: "create" })}>
                <Plus /> New global role
              </Button>
            ) : null}
          </>
        }
      />

      {listQ.error && listQ.data ? (
        <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status">
          Refresh failed — showing the list from {listQ.updatedAt ? formatTime(new Date(listQ.updatedAt)) : "earlier"}.
        </p>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 @3xl:flex-row @3xl:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/70 bg-surface px-3 shadow-card">
          <Search className="size-4 text-ink-subtle" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code, description or id" aria-label="Search roles" className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl label="Role scope" value={scope} onChange={setScope} options={SCOPES.map((s) => ({ ...s, label: `${s.label} ${listQ.data ? counts[s.value] : ""}`.trim() }))} />
          <SegmentedControl label="Role flags" value={flag} onChange={setFlag} options={FLAGS} />
        </div>
      </div>

      <Panel className="overflow-hidden">
        {listQ.error && !listQ.data ? (
          <ApiErrorState error={listQ.error} onRetry={listQ.refetch} title="Couldn't load roles" />
        ) : !listQ.data ? (
          <LoadingSkeleton variant="table" rows={5} />
        ) : roles.length === 0 ? (
          <EmptyState icon={KeyRound} title="No roles returned" description="The server returned an empty role list." />
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="No matching roles" description={scope === "global" && counts.global === 0 ? "The server returned no role without a tenant." : "Change the search or filters."} />
        ) : (
          <>
            <ul className="divide-y divide-line/70 @3xl:hidden" aria-label="Roles">
              {rows.map((r, i) => (
                <li key={r.id ?? `m-${i}`}>
                  <button type="button" onClick={() => r.id !== undefined && setDetailId(r.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-muted" aria-label={`Open role ${r.code ?? r.id}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold text-ink">{r.code ?? "—"}</span>
                      <span className="text-xs text-ink-muted">id {r.id ?? "—"}</span>
                    </span>
                    <span className="text-[13px] text-ink-muted">{r.description?.trim() || "No description"}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <RoleFlags r={r} />
                      <span>{countLabel(r)} permissions</span>
                      <span>{typeof r.activeUsers === "number" ? `${formatNumber(r.activeUsers)} active users` : "active users —"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto @3xl:block">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Roles from GET /roles</caption>
                <thead className="dv-thead text-[12px]">
                  <tr>
                    {["ID", "Code", "Description", "Flags", "Permissions", "Active users", scope === "tenant" ? "Tenant" : ""].map((h, i) => (
                      <th key={h || i} scope="col" className={cn("px-4 py-3", (i === 4 || i === 5) && "text-right")}>
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {rows.map((r, i) => (
                    <tr key={r.id ?? `r-${i}`} className="hover:bg-surface-muted/60">
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ink-muted">{r.id ?? "—"}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-ink">{r.code ?? "—"}</td>
                      <td className="max-w-[320px] px-4 py-2.5 text-ink-muted">{r.description?.trim() || <span className="text-ink-subtle">No description</span>}</td>
                      <td className="px-4 py-2.5">
                        <RoleFlags r={r} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular" title={permissionCount(r) === null ? "Not returned by the server" : undefined}>
                        {countLabel(r)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular">{typeof r.activeUsers === "number" ? formatNumber(r.activeUsers) : <span title="Not returned by the server">—</span>}</td>
                      <td className="px-4 py-2.5 text-right">
                        {scope === "tenant" ? (
                          <span className="font-mono text-xs text-ink-muted">{r.tenantId}</span>
                        ) : (
                          <Button size="sm" variant="outline" className="min-h-9" onClick={() => r.id !== undefined && setDetailId(r.id)} aria-label={`Open role ${r.code ?? r.id}`}>
                            Open
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <SlideOverPanel
        open={detail !== null}
        onOpenChange={(o) => !o && setDetailId(null)}
        title={detail ? `Role ${detail.code ?? detail.id}` : "Role"}
        description={detail ? (isGlobalRole(detail) ? "Global role · platform configuration" : `Tenant role · tenant ${detail.tenantId} · view only`) : undefined}
        width="lg"
      >
        {detail ? (
          <div className="space-y-5" data-testid="role-detail">
            <dl>
              <DetailRow label="ID">{detail.id ?? "—"}</DetailRow>
              <DetailRow label="Code">{detail.code ?? "—"}</DetailRow>
              <DetailRow label="Description">{detail.description?.trim() || "—"}</DetailRow>
              <DetailRow label="Scope">{roleScope(detail) === "global" ? "Global (no tenant)" : `Tenant ${detail.tenantId}`}</DetailRow>
              <DetailRow label="Flags">
                <RoleFlags r={detail} />
                {detail.protectedRole !== true && detail.fullAccess !== true && detail.assignable !== false ? <span className="text-ink-subtle">—</span> : null}
              </DetailRow>
              <DetailRow label="Active users">{typeof detail.activeUsers === "number" ? formatNumber(detail.activeUsers) : "— Not returned"}</DetailRow>
            </dl>
            {isGlobalRole(detail) ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {can.update ? (
                    <Button variant="outline" onClick={() => setForm({ mode: "edit", role: detail })} disabled={!!roleEditBlock(detail)} title={roleEditBlock(detail) ?? undefined}>
                      <Pencil /> Edit description
                    </Button>
                  ) : null}
                  {can.del ? (
                    <Button variant="outline" className="text-danger" onClick={() => setDeleting(detail)} disabled={!!roleDeleteBlock(detail)} title={roleDeleteBlock(detail) ?? undefined}>
                      <Trash2 /> Delete role
                    </Button>
                  ) : null}
                </div>
                {(can.update && roleEditBlock(detail)) || (can.del && roleDeleteBlock(detail)) ? (
                  <p className="text-xs text-ink-muted" data-testid="role-blocked">
                    {[...new Set([roleEditBlock(detail), roleDeleteBlock(detail)].filter(Boolean))].join(" ")} The backend remains the authority.
                  </p>
                ) : null}
                <section aria-labelledby="role-perms">
                  <h3 id="role-perms" className="mb-2 text-sm font-semibold text-ink">
                    Permissions
                  </h3>
                  <RolePermissionEditor key={detail.id} role={detail} onChanged={listQ.refetch} />
                </section>
              </>
            ) : null}
          </div>
        ) : null}
      </SlideOverPanel>

      {form ? <RoleForm key={form.role?.id ?? "new"} mode={form.mode} role={form.role} onClose={() => setForm(null)} onSaved={(r) => (listQ.refetch(), setForm(null), r.id !== undefined && setDetailId(r.id))} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete role ${deleting?.code ?? ""}?`}
        confirmLabel="Delete role"
        onConfirm={confirmDelete}
        description="This deletes the global role definition. The server refuses it if the role is protected or still in use."
      />
    </div>
  );
}

/** Create (code + description) or edit (description) a global role. No tenant header is sent. */
function RoleForm({ mode, role, onClose, onSaved }: { mode: "create" | "edit"; role?: RoleDto; onClose: () => void; onSaved: (r: RoleDto) => void }) {
  const [code, setCode] = useState(role?.code ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [errors, setErrors] = useState<Partial<Record<"code" | "description", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const v = validateRole({ code, description }, mode);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setSaving(true);
    try {
      const saved = mode === "create" ? await roleAdminService.createRole({ code: code.trim(), description }) : await roleAdminService.updateRole(role!.id!, { description });
      toast.success(mode === "create" ? `Role ${saved.code ?? code.trim()} created` : "Role updated");
      onSaved(saved.id !== undefined ? saved : { ...role, description });
    } catch (err) {
      if (isApiError(err)) {
        const fe = err.fieldErrorMap();
        setErrors({ code: fe.code, description: fe.description });
      }
      setFormError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel open onOpenChange={(o) => !o && !saving && onClose()} title={mode === "create" ? "New global role" : `Edit ${role?.code ?? "role"}`} description="Global role (no tenant). Sent without a tenant header." width="sm">
      <form onSubmit={submit} className="space-y-4" noValidate data-testid="role-form">
        {formError ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
            {formError}
          </p>
        ) : null}
        {mode === "create" ? (
          <FormField id="role-code" label="Role code" error={errors.code} hint="Uppercase letters, digits and _, starting with a letter (2–30)." required>
            <Input {...fieldA11y("role-code", errors.code, "x")} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={30} disabled={saving} autoComplete="off" />
          </FormField>
        ) : null}
        <FormField id="role-description" label="Description" error={errors.description} hint={`Up to ${DESCRIPTION_MAX} characters.`}>
          <Textarea {...fieldA11y("role-description", errors.description, "x")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={DESCRIPTION_MAX} rows={3} disabled={saving} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create role" : "Save"}
          </Button>
        </div>
      </form>
    </SlideOverPanel>
  );
}
