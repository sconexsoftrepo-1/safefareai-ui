"use client";

import { useMemo, useState } from "react";
import { BookKey, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { canPerform } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import { roleAdminService } from "@/features/drive-vision/api/role-admin-service";
import type { PermissionDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatNumber, formatTime } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { StatusBadge } from "../shared/status-badge";
import { SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { toast } from "../shared/toast-provider";
import { ALL, DESCRIPTION_MAX, PERMISSION_CODE_MAX, PERMISSION_SCOPES, codePrefix, filterPermissions, frontendUsage, groupByPrefix, scopeOptions, validatePermission, type FrontendUse } from "./role-permission-model";

const describeUse = (u: FrontendUse) => `${u.kind} ${u.key}`;

function Usage({ code }: { code: string }) {
  const used = frontendUsage(code);
  if (!used.length) return <span className="text-ink-subtle">Not used by this app</span>;
  return <span title={used.map(describeUse).join(", ")}>Used by {used.length === 1 ? describeUse(used[0]) : `${used.length} app checks`}</span>;
}

/**
 * Permission Catalogue (Phase 7; server routePath /platform/permissions). Safe-Fare Admin with
 * permission.manage (platformOnly). Reads GET /permissions without a tenant header; create, edit
 * (description, scope) and delete use the V10 catalogue operations. Scope values TENANT | PLATFORM come from
 * the V10 request schemas; grouping uses the code prefix (derived from the code, not a backend module).
 */
export function PermissionCatalog() {
  const access = useAccess();
  const can = { create: canPerform(access, "permissions.create"), update: canPerform(access, "permissions.update"), del: canPerform(access, "permissions.delete") };
  const listQ = useApiQuery("platform-permissions:list", () => roleAdminService.listPermissions());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(ALL);
  const [prefix, setPrefix] = useState(ALL);
  const [form, setForm] = useState<{ mode: "create" | "edit"; perm?: PermissionDto } | null>(null);
  const [deleting, setDeleting] = useState<PermissionDto | null>(null);

  const perms = useMemo(() => listQ.data?.items ?? [], [listQ.data]);
  const scopes = useMemo(() => scopeOptions(perms), [perms]);
  const prefixes = useMemo(() => [...new Set(perms.filter((p) => p.code).map((p) => codePrefix(p.code!)))].sort(), [perms]);
  const groups = useMemo(() => groupByPrefix(filterPermissions(perms, query, scope, prefix)), [perms, query, scope, prefix]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  async function confirmDelete() {
    if (!deleting?.code) return;
    try {
      await roleAdminService.deletePermission(deleting.code);
      toast.success(`Permission ${deleting.code} deleted`);
      listQ.refetch();
    } catch (err) {
      toast.error("The server refused the delete", { description: describeApiError(err) });
      throw err;
    }
  }

  return (
    <div>
      <PageHeader
        title="Permission Catalogue"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-semibold text-brand-deep">Platform configuration · not tenant-scoped</span>
            {listQ.data ? <span>{formatNumber(perms.length)} permissions</span> : null}
            {listQ.data && listQ.updatedAt ? <span>Updated {formatTime(new Date(listQ.updatedAt))}</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={listQ.refetch} disabled={listQ.loading || listQ.refreshing} aria-label="Refresh permissions">
              <RefreshCw className={listQ.refreshing ? "animate-spin" : undefined} /> Refresh
            </Button>
            {can.create ? (
              <Button onClick={() => setForm({ mode: "create" })}>
                <Plus /> New permission
              </Button>
            ) : null}
          </>
        }
      />
      {listQ.error && listQ.data ? (
        <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status">
          Refresh failed — showing the catalogue from {listQ.updatedAt ? formatTime(new Date(listQ.updatedAt)) : "earlier"}.
        </p>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 @3xl:flex-row @3xl:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/70 bg-surface px-3 shadow-card">
          <Search className="size-4 text-ink-subtle" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code or description" aria-label="Search permissions" className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
        <div role="radiogroup" aria-label="Filter by scope" className="flex flex-wrap gap-1.5">
          {[{ value: ALL, label: "All scopes", count: perms.length }, ...scopes].map((o) => (
            <button key={o.value || "none"} type="button" role="radio" aria-checked={scope === o.value} onClick={() => setScope(o.value)} className={cn("min-h-10 rounded-full border px-3 text-[12.5px] font-medium", scope === o.value ? "border-ink bg-ink text-white" : "border-line/70 bg-surface text-ink-muted hover:text-ink")}>
              {o.label} <span className="tabular opacity-70">{o.count}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          Code prefix
          <select value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label="Filter by code prefix" className="h-10 rounded-xl border border-line/70 bg-surface px-2 text-[13px] text-ink">
            <option value={ALL}>All</option>
            {prefixes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      {listQ.error && !listQ.data ? (
        <Panel>
          <ApiErrorState error={listQ.error} onRetry={listQ.refetch} title="Couldn't load the permission catalogue" />
        </Panel>
      ) : !listQ.data ? (
        <Panel>
          <LoadingSkeleton variant="table" rows={6} />
        </Panel>
      ) : perms.length === 0 ? (
        <Panel>
          <EmptyState icon={BookKey} title="No permissions returned" description="The server returned an empty catalogue." />
        </Panel>
      ) : shown === 0 ? (
        <Panel>
          <EmptyState icon={Search} title="No matching permissions" description="Change the search or filters." />
        </Panel>
      ) : (
        <div className="space-y-3" data-testid="permission-groups">
          {groups.map((g) => (
            <Panel key={g.prefix} className="overflow-hidden">
              <details open>
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 text-[13px] font-semibold text-ink">
                  <span className="font-mono">{g.prefix}</span>
                  <span className="text-xs font-normal text-ink-muted tabular">{g.items.length}</span>
                </summary>
                <ul className="divide-y divide-line/70 border-t border-line/70">
                  {g.items.map((p) => (
                    <li key={p.code} className="flex flex-col gap-2 px-4 py-2.5 @3xl:flex-row @3xl:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] text-ink">{p.code}</span>
                          {p.scope ? (
                            <StatusBadge size="sm" tone={p.scope.toUpperCase() === "PLATFORM" ? "brand" : "neutral"}>
                              {p.scope}
                            </StatusBadge>
                          ) : (
                            <StatusBadge size="sm" tone="warning">
                              no scope
                            </StatusBadge>
                          )}
                        </p>
                        <p className="text-xs text-ink-muted">{p.description?.trim() || <span className="text-ink-subtle">No description provided by the backend.</span>}</p>
                        <p className="text-[11.5px] text-ink-subtle">
                          <Usage code={p.code!} />
                        </p>
                      </div>
                      {can.update || can.del ? (
                        <div className="flex shrink-0 gap-1.5">
                          {can.update ? (
                            <Button size="sm" variant="outline" className="min-h-9" onClick={() => setForm({ mode: "edit", perm: p })} aria-label={`Edit ${p.code}`}>
                              <Pencil /> Edit
                            </Button>
                          ) : null}
                          {can.del ? (
                            <Button size="sm" variant="outline" className="min-h-9 text-danger" onClick={() => setDeleting(p)} aria-label={`Delete ${p.code}`}>
                              <Trash2 /> Delete
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            </Panel>
          ))}
        </div>
      )}

      {form ? <PermissionForm key={form.perm?.code ?? "new"} mode={form.mode} perm={form.perm} onClose={() => setForm(null)} onSaved={() => (listQ.refetch(), setForm(null))} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete permission ${deleting?.code ?? ""}?`}
        confirmLabel="Delete permission"
        onConfirm={confirmDelete}
        description="This removes the code from the global catalogue. The server refuses it if the code is still in use."
      >
        {deleting?.code && frontendUsage(deleting.code).length ? (
          <p className="mt-3 rounded-lg bg-warning-soft px-2 py-1.5 text-xs text-warning" data-testid="delete-usage-warning">
            This app checks this code for: {frontendUsage(deleting.code).map(describeUse).join(", ")}. Removing it takes that access away from everyone.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/** Create (code, description, scope) or edit (description, scope) a catalogue permission. */
function PermissionForm({ mode, perm, onClose, onSaved }: { mode: "create" | "edit"; perm?: PermissionDto; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(perm?.code ?? "");
  const [description, setDescription] = useState(perm?.description ?? "");
  const initialScope = typeof perm?.scope === "string" && (PERMISSION_SCOPES as readonly string[]).includes(perm.scope) ? perm.scope : "";
  const [scope, setScope] = useState<string>(initialScope);
  const [errors, setErrors] = useState<Partial<Record<"code" | "description" | "scope", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const scopeChanged = mode === "edit" && scope !== initialScope;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const v = validatePermission({ code, description, scope }, mode);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setSaving(true);
    try {
      const s = scope as "TENANT" | "PLATFORM";
      if (mode === "create") await roleAdminService.createPermission({ code: code.trim(), description, scope: s });
      else await roleAdminService.updatePermission(perm!.code!, { description, scope: s });
      toast.success(mode === "create" ? `Permission ${code.trim()} created` : `Permission ${perm!.code} updated`);
      onSaved();
    } catch (err) {
      if (isApiError(err)) {
        const fe = err.fieldErrorMap();
        setErrors({ code: fe.code, description: fe.description, scope: fe.scope });
      }
      setFormError(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel open onOpenChange={(o) => !o && !saving && onClose()} title={mode === "create" ? "New permission" : `Edit ${perm?.code}`} description="Global permission catalogue. Sent without a tenant header." width="sm">
      <form onSubmit={submit} className="space-y-4" noValidate data-testid="permission-form">
        {formError ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
            {formError}
          </p>
        ) : null}
        {mode === "create" ? (
          <FormField id="perm-code" label="Code" error={errors.code} hint="Lowercase dotted code, e.g. device.read (max 60)." required>
            <Input {...fieldA11y("perm-code", errors.code, "x")} value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} maxLength={PERMISSION_CODE_MAX} disabled={saving} autoComplete="off" />
          </FormField>
        ) : null}
        <FormField id="perm-description" label="Description" error={errors.description} hint={`Up to ${DESCRIPTION_MAX} characters.`}>
          <Textarea {...fieldA11y("perm-description", errors.description, "x")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={DESCRIPTION_MAX} rows={3} disabled={saving} />
        </FormField>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink">
            Scope<span className="text-danger" aria-hidden>*</span>
          </legend>
          <div role="radiogroup" aria-label="Scope" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
            {PERMISSION_SCOPES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)} disabled={saving} className={cn("min-h-10 rounded-lg text-[13px] font-medium", scope === s ? "bg-surface text-ink shadow-sm" : "text-ink-muted")}>
                {s}
              </button>
            ))}
          </div>
          {errors.scope ? (
            <p className="mt-1 text-xs text-danger" role="alert">
              {errors.scope}
            </p>
          ) : null}
          {mode === "edit" && !initialScope && perm?.scope ? <p className="mt-1 text-xs text-ink-muted">Current server value &quot;{perm.scope}&quot; isn&apos;t TENANT or PLATFORM; choose one to save.</p> : null}
          {scopeChanged ? (
            <p className="mt-1 rounded-lg bg-warning-soft px-2 py-1.5 text-xs text-warning" data-testid="scope-change-warning">
              Changing the scope can change which roles may hold this permission. The backend decides.
            </p>
          ) : null}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create permission" : "Save"}
          </Button>
        </div>
      </form>
    </SlideOverPanel>
  );
}
