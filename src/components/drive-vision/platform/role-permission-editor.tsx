"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckSquare, Minus, Plus, RefreshCw, Search, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canPerform, canViewWidget } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { roleAdminService } from "@/features/drive-vision/api/role-admin-service";
import type { PermissionDto, RoleDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { ApiErrorState, UnavailableState } from "../shared/api-states";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import {
  NO_CHANGES,
  codeEditable,
  desiredSelection,
  filterPermissions,
  groupByPrefix,
  groupState,
  mappingEditBlock,
  pendingAfterApply,
  planChanges,
  setCodes,
  summarizeApply,
  type PendingChanges,
  type SelectionRights,
  type StepResult,
} from "./role-permission-model";

type View = "all" | "assigned" | "unassigned" | "changed";
const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Assigned" },
  { value: "unassigned", label: "Not assigned" },
  { value: "changed", label: "Changed" },
];

/** A module's checkbox: checked / unchecked / indeterminate (native `indeterminate`, announced as "mixed"). */
function GroupCheckbox({ state, disabled, label, onChange }: { state: "all" | "none" | "some"; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 shrink-0 accent-[var(--dv-brand)] disabled:cursor-not-allowed"
      checked={state === "all"}
      aria-checked={state === "some" ? "mixed" : state === "all"}
      disabled={disabled}
      aria-label={label}
      // From "some" or "none" a click selects the whole module; from "all" it deselects it.
      onChange={() => onChange(state !== "all")}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const moduleTitle = (prefix: string) => `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} permissions`;

/**
 * Role-permission assignments for one GLOBAL role (Phase 7; checkbox UI). Reads GET /roles/{id}/permissions
 * and the catalogue. Every catalogue permission has a checkbox — checked = assigned. Changes stay local
 * (pending additions / removals) until Review → Save, which uses the V10 delta operations:
 * POST /roles/{id}/permissions for additions, then DELETE /roles/{id}/permissions?codes=… for removals,
 * both without a tenant header. Whatever happens, the list is re-read from the server afterwards; success is
 * never assumed, and changes the server didn't accept stay pending.
 */
export function RolePermissionEditor({ role, onChanged }: { role: RoleDto; onChanged: () => void }) {
  const access = useAccess();
  const id = role.id!;
  const canRead = canViewWidget(access, "roles.permissions") && canViewWidget(access, "permissions.catalog");
  const canAdd = canPerform(access, "rolePermissions.add");
  const canRemove = canPerform(access, "rolePermissions.remove");
  const rpQ = useApiQuery(canRead ? `roles:permissions:${id}` : null, () => roleAdminService.rolePermissions(id));
  const catQ = useApiQuery(canRead ? "roles:catalog" : null, () => roleAdminService.listPermissions());
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingChanges>(NO_CHANGES);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string; errors: string[] } | null>(null);

  const assigned = useMemo(() => new Set((rpQ.data?.permissionCodes ?? []).filter((c): c is string => typeof c === "string")), [rpQ.data]);
  const catalog = useMemo(() => catQ.data?.items ?? [], [catQ.data]);
  const block = mappingEditBlock(role, rpQ.data);
  const rights: SelectionRights = { locked: block !== null || saving, canAdd, canRemove };
  const ownRole = access.identity?.roleId === id;
  // Derived values are plain computations (small lists); the React Compiler memoizes them.
  const plan = planChanges(pending, assigned, { catalog, canAdd, canRemove, ownRole });
  const changeCount = plan.add.length + plan.remove.length;
  const selected = desiredSelection(assigned, pending);
  const changed = new Set([...plan.add, ...plan.remove]);

  // Every catalogue permission, plus assigned codes missing from the catalogue (as the server returned them).
  const catalogCodes = new Set(catalog.map((p) => p.code).filter(Boolean));
  const all: PermissionDto[] = [...catalog.filter((p) => p.code), ...[...assigned].filter((c) => !catalogCodes.has(c)).map((c) => ({ code: c }))];
  // Search and the view filter only change what's shown; pending changes are never touched by them.
  const shown = filterPermissions(
    all.filter((p) => (view === "assigned" ? assigned.has(p.code!) : view === "unassigned" ? !assigned.has(p.code!) : view === "changed" ? changed.has(p.code!) : true)),
    query
  );
  const groups = groupByPrefix(shown);

  if (!canRead) return <UnavailableState title="No permission to view assignments" reason="Needs role.permission.read (and the catalogue read)." className="py-8" />;
  if (rpQ.error && !rpQ.data) return <ApiErrorState error={rpQ.error} onRetry={rpQ.refetch} title="Couldn't load this role's permissions" compact />;
  if (catQ.error && !catQ.data) return <ApiErrorState error={catQ.error} onRetry={catQ.refetch} title="Couldn't load the permission catalogue" compact />;
  if (!rpQ.data || !catQ.data) return <LoadingSkeleton variant="list" rows={5} />;

  const known = new Set(catalog.map((p) => p.code));
  const shownCodes = shown.map((p) => p.code!);
  const filtered = query.trim() !== "" || view !== "all";
  const change = (codes: Iterable<string>, checked: boolean) => {
    setResult(null);
    setPending((p) => setCodes(p, codes, checked, assigned, rights));
  };
  // Whether a bulk action would change anything (so its button is disabled when it wouldn't).
  const wouldChange = (codes: string[], checked: boolean) => codes.some((c) => selected.has(c) !== checked && codeEditable(c, assigned, rights));
  const lockReason = (isAssigned: boolean) => (block ? block : isAssigned ? (canRemove ? null : "Needs role.permission.delete") : canAdd ? null : "Needs role.permission.create");

  async function apply() {
    if (saving || plan.problems.length || changeCount === 0) return;
    setSaving(true);
    let added: StepResult = null;
    let removed: StepResult = null;
    if (plan.add.length) {
      try {
        await roleAdminService.addRolePermissions(id, plan.add);
        added = { ok: true, codes: plan.add };
      } catch (error) {
        added = { ok: false, codes: plan.add, error };
      }
    }
    if (plan.remove.length) {
      try {
        await roleAdminService.removeRolePermissions(id, plan.remove);
        removed = { ok: true, codes: plan.remove };
      } catch (error) {
        removed = { ok: false, codes: plan.remove, error };
      }
    }
    const summary = summarizeApply(added, removed);
    const errors = [added, removed].filter((s): s is Extract<StepResult, { ok: false }> => !!s && !s.ok).map((s) => describeApiError(s.error));
    setResult({ ...summary, errors });
    if (summary.status === "success") toast.success(summary.message, { description: `${role.code ?? "Role"}: ${plan.add.length} added, ${plan.remove.length} removed.` });
    else toast.error(summary.message, { description: errors.join(" · ") || undefined });
    // Keep whatever the server didn't accept, so a failed or partial save loses nothing.
    setPending((p) => pendingAfterApply(p, added, removed));
    setReview(false);
    setSaving(false);
    // Always re-read: the server's state is the truth after any write, successful or not.
    rpQ.refetch();
    onChanged();
  }

  return (
    <div className="space-y-3" data-testid="role-permission-editor">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-muted" data-testid="mapping-summary">
        <span>
          <span className="font-semibold text-ink tabular">{rpQ.data.fullAccess ? "All" : assigned.size}</span> assigned of <span className="font-semibold text-ink tabular">{all.length}</span> available ·{" "}
          <span className="font-semibold text-ink tabular">{selected.size}</span> selected
          {changeCount ? (
            <>
              {" "}
              (<span className="text-success">+{plan.add.length}</span> <span className="text-danger">−{plan.remove.length}</span>)
            </>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-9"
          onClick={() => {
            rpQ.refetch();
            catQ.refetch();
          }}
          disabled={rpQ.refreshing || catQ.refreshing || saving}
          aria-label="Reload assignments and catalogue"
        >
          <RefreshCw className={rpQ.refreshing || catQ.refreshing ? "animate-spin" : undefined} /> Reload
        </Button>
      </div>
      {block ? (
        <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-muted" role="status" data-testid="mapping-readonly">
          Read-only: {block}
        </p>
      ) : !canAdd || !canRemove ? (
        <p className="text-xs text-ink-muted" role="status">
          {!canAdd ? "You can't add permissions (needs role.permission.create). " : ""}
          {!canRemove ? "You can't remove permissions (needs role.permission.delete)." : ""}
        </p>
      ) : null}
      {result ? (
        <div className={cn("rounded-xl px-3 py-2 text-xs", result.status === "success" ? "bg-success-soft text-success" : "bg-danger-soft text-danger")} role={result.status === "success" ? "status" : "alert"} data-testid="mapping-result">
          <p className="font-medium">{result.message}</p>
          {result.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
          {result.status !== "success" && changeCount ? <p className="mt-0.5 text-ink-muted">Your unsaved selection is kept below — review and save again, or discard it.</p> : null}
        </div>
      ) : null}
      {rpQ.error && rpQ.data ? <p className="text-xs text-warning">Refresh failed — showing the last loaded assignments.</p> : null}

      <label className="flex items-center gap-2 rounded-xl border border-line/70 bg-surface px-3">
        <Search className="size-4 text-ink-subtle" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code or description" aria-label="Search permissions" className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Show permissions" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button key={v.value} type="button" role="radio" aria-checked={view === v.value} onClick={() => setView(v.value)} className={cn("min-h-9 rounded-full border px-3 text-[12.5px] font-medium", view === v.value ? "border-ink bg-ink text-white" : "border-line/70 bg-surface text-ink-muted hover:text-ink")}>
              {v.label}
              {v.value === "changed" && changeCount ? ` ${changeCount}` : ""}
            </button>
          ))}
        </div>
        {!block ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="min-h-9" onClick={() => change(shownCodes, true)} disabled={!wouldChange(shownCodes, true)} data-testid="select-all">
              <CheckSquare /> {filtered ? "Select shown" : "Select all"}
            </Button>
            <Button size="sm" variant="outline" className="min-h-9" onClick={() => change(shownCodes, false)} disabled={!wouldChange(shownCodes, false)} data-testid="deselect-all">
              <Square /> {filtered ? "Deselect shown" : "Deselect all"}
            </Button>
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={Search} title="No permissions to show" description={filtered ? "No permission matches the search or filter. Your selection is unchanged." : "The catalogue is empty."} className="py-6" />
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const codes = g.items.map((p) => p.code!);
            const state = groupState(codes, selected);
            const count = codes.filter((c) => selected.has(c)).length;
            return (
              <details key={g.prefix} open className="rounded-xl border border-line/70 bg-surface" data-testid={`group-${g.prefix}`}>
                <summary className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 text-[13px] font-medium text-ink">
                  <GroupCheckbox state={state} disabled={block !== null || saving || (!wouldChange(codes, true) && !wouldChange(codes, false))} label={`Select all ${g.prefix} permissions`} onChange={(checked) => change(codes, checked)} />
                  <span className="min-w-0 flex-1 truncate">
                    {moduleTitle(g.prefix)} <span className="font-mono text-[11px] text-ink-subtle">{g.prefix}.*</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted tabular" data-testid={`group-count-${g.prefix}`}>
                    {count}/{codes.length} selected
                  </span>
                </summary>
                <ul className="divide-y divide-line/60 border-t border-line/60">
                  {g.items.map((p) => {
                    const code = p.code!;
                    const isAssigned = assigned.has(code);
                    const isSelected = selected.has(code);
                    const locked = !codeEditable(code, assigned, rights) ? (lockReason(isAssigned) ?? "Saving…") : null;
                    const willAdd = !isAssigned && isSelected;
                    const willRemove = isAssigned && !isSelected;
                    return (
                      <li key={code}>
                        <label className={cn("flex min-h-11 items-start gap-2.5 px-3 py-2", locked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-surface-muted")} title={locked ?? undefined}>
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--dv-brand)]" checked={isSelected} disabled={!!locked} onChange={(e) => change([code], e.target.checked)} aria-label={code} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[12.5px] break-all text-ink">{code}</span>
                              {p.scope ? (
                                <StatusBadge size="sm" tone={p.scope.toUpperCase() === "PLATFORM" ? "brand" : "neutral"}>
                                  {p.scope}
                                </StatusBadge>
                              ) : null}
                              {!known.has(code) ? (
                                <StatusBadge size="sm" tone="warning">
                                  not in catalogue
                                </StatusBadge>
                              ) : null}
                              {willAdd || willRemove ? (
                                <StatusBadge size="sm" tone={willRemove ? "danger" : "success"}>
                                  {willRemove ? "will remove" : "will add"}
                                </StatusBadge>
                              ) : null}
                            </span>
                            <span className="block text-xs text-ink-muted">{p.description?.trim() || "No description provided by the backend."}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      )}

      {/* Only while something is pending: a sticky bar at rest would cover the controls on short screens. */}
      {!block && changeCount > 0 ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 bg-surface px-3 py-2 shadow-card" data-testid="mapping-pending">
          <span className="text-xs text-ink-muted">
            <span className="inline-flex items-center gap-0.5 text-success">
              <Plus className="size-3" aria-hidden />
              {plan.add.length}
            </span>{" "}
            <span className="inline-flex items-center gap-0.5 text-danger">
              <Minus className="size-3" aria-hidden />
              {plan.remove.length}
            </span>{" "}
            pending
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" className="min-h-9" onClick={() => (setPending(NO_CHANGES), setResult(null))} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" className="min-h-9" onClick={() => setReview(true)} disabled={saving}>
              <Check /> Review changes
            </Button>
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={review}
        onOpenChange={(o) => !saving && setReview(o)}
        title={`Change permissions of ${role.code ?? "this role"}?`}
        tone={plan.remove.length ? "danger" : "default"}
        confirmLabel={saving ? "Saving…" : "Save changes"}
        confirmDisabled={saving || plan.problems.length > 0 || changeCount === 0}
        onConfirm={apply}
        description={`Global role · id ${id}. Sent without a tenant: this changes the global role definition.`}
      >
        <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto text-xs" data-testid="mapping-review">
          <p className="font-medium text-ink">
            {plan.add.length} to add · {plan.remove.length} to remove
          </p>
          {plan.add.length ? (
            <p>
              <span className="font-semibold text-success">Add ({plan.add.length}):</span> <span className="font-mono break-all">{plan.add.join(", ")}</span>
            </p>
          ) : null}
          {plan.remove.length ? (
            <p>
              <span className="font-semibold text-danger">Remove ({plan.remove.length}):</span> <span className="font-mono break-all">{plan.remove.join(", ")}</span>
            </p>
          ) : null}
          {plan.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-warning-soft px-2 py-1.5 text-warning">
              {w}
            </p>
          ))}
          {plan.problems.map((w) => (
            <p key={w} className="rounded-lg bg-danger-soft px-2 py-1.5 text-danger" role="alert">
              {w}
            </p>
          ))}
          <p className="text-ink-muted">Additions are sent first, then removals. The list is re-read from the server afterwards. Cancel returns to your selection unchanged.</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
