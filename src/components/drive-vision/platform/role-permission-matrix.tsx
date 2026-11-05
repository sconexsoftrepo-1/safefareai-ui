"use client";

import { Fragment, useMemo, useState } from "react";
import { Building2, Loader2, Lock, RefreshCw, RotateCcw, Save, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { canPerform, canViewWidget, hasTenantContext } from "@/features/drive-vision/access/access-policy";
import { useAccess, useTenantContext } from "@/features/drive-vision/access/use-access";
import { onSessionEnded } from "@/features/drive-vision/api/client";
import { platformService } from "@/features/drive-vision/api/platform-service";
import { roleMenuService } from "@/features/drive-vision/api/role-menu-service";
import type { RoleDto, RoleMenuPermissionsDto, TenantDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { useAuth } from "@/features/drive-vision/store/auth-store";
import { tenantSelectable } from "@/features/drive-vision/store/tenant-store";
import { formatNumber } from "@/features/drive-vision/utils/format";
import { Panel } from "../shared/panel";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { toast } from "../shared/toast-provider";
import { useUnsavedGuard } from "../shared/use-unsaved-guard";
import {
  CONFLICT_MESSAGE,
  OPERATIONS,
  cellDisabled,
  codeUsage,
  diffPermissions,
  filterMenus,
  grantedCodes,
  gridMismatch,
  hasChanges,
  hasUnmappedCells,
  isMenuOff,
  matrixError,
  menuRows,
  permissionCodesToSave,
  readGrid,
  removalImpact,
  saveBlock,
  saveIfUnchanged,
  setPermission,
  type GridCell,
  type GridMenu,
  type RemovalImpact,
  type RoleMenuGrid,
} from "./role-menu-permission-model";

const UNSAVED = "You have unsaved permission changes.";

/**
 * The permission boxes, for this grid only (the shared Checkbox is used on other screens). The colours are the
 * theme's: the border and fill stay at 3:1 or better on the white and tinted rows, and the disabled states stay
 * opaque, marked by a dashed border and a grey fill, so a read-only grid can still be read. `after` widens the
 * click target to 36 px without moving the layout. The app has one light theme, but the shared Checkbox carries
 * `dark:` colours that follow the OS setting and turn the box translucent; the `dark:` entries here replace them.
 */
const PERMISSION_CHECKBOX =
  "relative size-5 rounded-[5px] border-2 border-ink-muted bg-surface shadow-none after:absolute after:-inset-2.5 after:content-[''] dark:bg-surface dark:data-[state=checked]:bg-brand-deep enabled:hover:border-brand-deep enabled:hover:ring-[3px] enabled:hover:ring-brand/25 focus-visible:border-brand-deep focus-visible:ring-[3px] focus-visible:ring-brand-deep focus-visible:ring-offset-2 data-[state=checked]:border-brand-deep data-[state=checked]:bg-brand-deep data-[state=checked]:text-white disabled:border-dashed disabled:bg-surface-sunken disabled:opacity-100 disabled:data-[state=checked]:border-solid disabled:data-[state=checked]:border-ink-muted disabled:data-[state=checked]:bg-ink-muted";

const UNMAPPED_NOTE = "Disabled empty boxes in the Add, Edit, Delete and View columns are operations that aren't mapped for that row. They don't mean a permission is missing from the role. They can't be selected and are never saved.";

/** Edits belong to one tenant and role; `key` keeps them from ever showing under another. */
interface Edits {
  key: string;
  codes: ReadonlySet<string>;
  /** The grid the edits started from: what a save checks the server against. */
  base: RoleMenuGrid;
}
/** A grid from a PUT or a reload, shown until the next re-read arrives (or if it fails). */
interface SavedGrid {
  key: string;
  /** matrixQ.updatedAt at save time: a newer read replaces this. */
  readAt: number | null;
  dto: RoleMenuPermissionsDto;
}
type PendingSwitch = { kind: "role"; id: number } | { kind: "tenant"; tenant: TenantDto };

const tenantLabel = (t: TenantDto) => t.name ?? t.code ?? `Tenant ${t.id}`;

/**
 * The app shell remounts the page on a tenant change, which is what keeps tenants' data apart, so this role id is
 * the one thing that outlives it: the same role's grid then loads for the new tenant, if that tenant lists it.
 */
let lastRoleId: number | null = null;
if (typeof window !== "undefined") onSessionEnded(() => (lastRoleId = null));

/**
 * Role menu permissions (Permission Catalogue → Role permissions). Rows, codes and checkbox state come from
 * GET /roles/{roleId}/menu-permissions; a save sends every ticked code with PUT after a review, then re-reads.
 * Role permissions belong to a tenant: the Safe-Fare Admin picks one here (the Phase 5 tenant context, so the API
 * client sends X-Tenant-Id); tenant users work in the tenant of their token and get no picker.
 */
export function RolePermissionMatrix() {
  const access = useAccess();
  const ctx = useTenantContext();
  const profile = useAuth((s) => s.user);
  const tenantReady = hasTenantContext(access);
  const canUpdate = canPerform(access, "roleMenuPermissions.update");
  const canListRoles = canViewWidget(access, "roleMenu.roles");
  const canReadGrid = canViewWidget(access, "roleMenu.matrix");

  // Query keys carry the tenant, so query data blanks on a switch; state keeps the options while the list reloads.
  const [tenants, setTenants] = useState<readonly TenantDto[]>([]);
  const tenantsQ = useApiQuery(ctx.canSelectTenant ? "role-matrix:tenants" : null, async () => {
    const list = await platformService.activeTenants();
    setTenants(list.items.filter(tenantSelectable).sort((x, y) => tenantLabel(x).localeCompare(tenantLabel(y))));
    return list;
  });

  const rolesQ = useApiQuery(tenantReady && canListRoles ? "role-matrix:roles" : null, () => roleMenuService.listRoles());
  const roles = useMemo(() => [...(rolesQ.data?.items ?? [])].filter((r) => typeof r.id === "number").sort((a, b) => (a.id ?? 0) - (b.id ?? 0)), [rolesQ.data]);
  const [roleId, setRoleId] = useState<number | null>(lastRoleId);
  const role = roles.find((r) => r.id === roleId);

  const matrixQ = useApiQuery(role && canReadGrid ? `role-matrix:grid:${roleId}` : null, () => roleMenuService.getMatrix(roleId!));
  const [edits, setEdits] = useState<Edits | null>(null);
  const [saved, setSaved] = useState<SavedGrid | null>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ReturnType<typeof matrixError> | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<RemovalImpact | null>(null);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const editKey = `${access.tenantId ?? "none"}|${roleId}`;
  const dto = saved?.key === editKey && saved.readAt === matrixQ.updatedAt ? saved.dto : matrixQ.data;
  const grid = useMemo<RoleMenuGrid | null>(() => (dto && role ? readGrid(dto) : null), [dto, role]);
  const mismatch = grid && roleId !== null ? gridMismatch(grid, { tenantId: access.tenantId, roleId }) : null;
  const shownGrid = mismatch ? null : grid;

  const granted = useMemo(() => (shownGrid ? grantedCodes(shownGrid) : new Set<string>()), [shownGrid]);
  const selected = edits?.key === editKey ? edits.codes : granted;
  const usage = useMemo(() => (shownGrid ? codeUsage(shownGrid) : new Map<string, number>()), [shownGrid]);
  const diff = useMemo(() => (shownGrid ? diffPermissions(shownGrid, selected) : { added: [], removed: [], unchanged: [] }), [shownGrid, selected]);
  const dirty = hasChanges(diff);
  const changes = diff.added.length + diff.removed.length;
  const conflict = conflictKey === editKey;
  const block = shownGrid ? saveBlock(shownGrid, selected, { canUpdate, conflict }) : "Nothing to save.";
  const shown = useMemo(() => (shownGrid ? filterMenus(shownGrid.menus, query) : []), [shownGrid, query]);
  const locked = !shownGrid?.editable || !canUpdate || saving;
  const guard = useUnsavedGuard(dirty, UNSAVED);

  const selectedTenantName = ctx.isPlatformUser ? (ctx.selectedTenantName ?? ctx.selectedTenantCode) : (profile?.tenantName ?? profile?.tenantCode);
  const tenantText = selectedTenantName ?? (access.tenantId !== null ? `Tenant ${access.tenantId}` : "Your tenant");

  function discardEdits() {
    setEdits(null);
    setNote(null);
    setSaveError(null);
    setConflictKey(null);
  }

  function applySelection(code: string, next: ReadonlySet<string>) {
    if (!shownGrid || next === selected) return;
    const linked = [...selected].filter((c) => c !== code && !next.has(c));
    setNote(linked.length ? `Unticking ${code} closes every menu that depends on it, so ${formatNumber(linked.length)} more permission${linked.length === 1 ? " was" : "s were"} unticked: ${linked.join(", ")}.` : null);
    setEdits({ key: editKey, codes: next, base: edits?.key === editKey ? edits.base : shownGrid });
  }

  function toggle(cell: GridCell, checked: boolean, menu: GridMenu) {
    if (!shownGrid || locked) return;
    const impact = checked ? null : removalImpact(shownGrid, selected, cell.code, menu);
    if (impact?.affected.length) setPendingRemoval(impact); // a shared code: nothing changes until it is confirmed
    else {
      const next = setPermission(shownGrid, selected, cell.code, checked);
      applySelection(cell.code, next);
      // Allowed, but easy to miss: the permission is held and the menu stays hidden.
      if (checked && next !== selected && isMenuOff(menu, next)) setNote(`${menu.title} is unticked, so users of this role won't see that menu until it is ticked.`);
    }
  }

  /** Replaces the edits with the server's current grid; if the read fails, the edits stay. */
  async function reloadLatest() {
    if (roleId === null || reloading) return;
    setReloading(true);
    try {
      const dto = await roleMenuService.getMatrix(roleId);
      setSaved({ key: editKey, readAt: matrixQ.updatedAt, dto });
      setEdits(null);
      discardEdits();
    } catch (err) {
      setSaveError(matrixError(err));
    } finally {
      setReloading(false);
    }
  }

  function switchRole(id: number) {
    lastRoleId = id;
    setRoleId(id);
    setQuery("");
    discardEdits();
  }
  async function switchTenant(t: TenantDto) {
    if (await ctx.selectTenant(t)) discardEdits();
  }
  function chooseRole(id: number) {
    if (id === roleId) return;
    if (dirty) setPendingSwitch({ kind: "role", id });
    else switchRole(id);
  }
  function chooseTenant(id: number) {
    const t = tenants.find((x) => x.id === id);
    if (!t || id === ctx.selectedTenantId) return;
    if (dirty) setPendingSwitch({ kind: "tenant", tenant: t });
    else void switchTenant(t);
  }

  async function save() {
    if (!shownGrid || roleId === null || block !== null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const outcome = await saveIfUnchanged(edits?.key === editKey ? edits.base : shownGrid, selected, { tenantId: access.tenantId, roleId }, roleMenuService);
      if (outcome.status === "conflict") {
        setConflictKey(editKey);
        setReviewing(false);
        return;
      }
      setSaved({ key: editKey, readAt: matrixQ.updatedAt, dto: outcome.dto });
      setEdits(null);
      setNote(null);
      matrixQ.refetch();
      if (outcome.unconfirmed.length) {
        // The server accepted the request, but its response doesn't show the same permissions, so this isn't reported as a success.
        const failure = { title: "The server didn't confirm this save", detail: `The saved permissions differ for: ${outcome.unconfirmed.join(", ")}. The grid shows the server's state.`, meta: null };
        setSaveError(failure);
        toast.error(failure.title, { description: failure.detail });
        return;
      }
      toast.success(`Permissions saved for ${role?.code ?? `role ${roleId}`}`, { description: `${diff.added.length} added · ${diff.removed.length} removed. Users of this role get the change at their next login or token refresh.` });
    } catch (err) {
      // Nothing changed on the server: the edits stay so the user can correct them or retry.
      const failure = matrixError(err);
      setSaveError(failure);
      toast.error(failure.title, { description: failure.detail });
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const switchDescription = pendingSwitch?.kind === "tenant" ? "Switching tenants discards them." : "Switching roles discards them.";

  return (
    <div className="space-y-3">
      <Panel className="space-y-3 p-4">
        {ctx.isPlatformUser ? (
          <div className="grid items-center gap-2 @2xl:grid-cols-[minmax(0,180px)_minmax(0,420px)_1fr]">
            <label htmlFor="rpm-tenant" className="text-[13px] font-medium text-ink">
              Select tenant<span className="text-danger" aria-hidden>*</span>
            </label>
            {!ctx.canSelectTenant ? (
              <p className="text-[13px] text-ink-muted">Selecting a tenant needs tenant.all.</p>
            ) : tenantsQ.error && !tenantsQ.data && tenants.length === 0 ? (
              <ApiErrorState error={tenantsQ.error} onRetry={tenantsQ.refetch} title="Couldn't load tenants" compact />
            ) : (
              <Select value={ctx.selectedTenantId !== null ? String(ctx.selectedTenantId) : ""} onValueChange={(v) => v && chooseTenant(Number(v))} disabled={ctx.pendingTenantId !== null || saving || (tenants.length === 0 && !tenantsQ.data)}>
                <SelectTrigger id="rpm-tenant" className="h-11 w-full" data-testid="tenant-select">
                  <SelectValue placeholder={tenantsQ.data ? "Choose a tenant" : "Loading tenants…"}>{ctx.isTenantSelected ? tenantText : undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      <span className="font-medium">{tenantLabel(t)}</span>
                      {t.code ? <span className="ml-2 font-mono text-xs text-ink-muted">{t.code}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {ctx.pendingTenantId !== null ? <p className="text-xs text-ink-muted">Checking tenant…</p> : tenantsQ.data && tenants.length === 0 ? <p className="text-xs text-ink-muted">No active tenants returned.</p> : null}
            {ctx.error ? (
              <p className="rounded-lg bg-danger-soft px-2 py-1.5 text-xs text-danger @2xl:col-span-3" role="alert">
                {ctx.error}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid items-center gap-2 @2xl:grid-cols-[minmax(0,180px)_minmax(0,420px)_1fr]">
          <label htmlFor="rpm-role" className="text-[13px] font-medium text-ink">
            Select role<span className="text-danger" aria-hidden>*</span>
          </label>
          {rolesQ.error && !rolesQ.data ? (
            <ApiErrorState error={rolesQ.error} onRetry={rolesQ.refetch} title={matrixError(rolesQ.error).title} compact />
          ) : (
            <Select value={role ? String(roleId) : ""} onValueChange={(v) => v && chooseRole(Number(v))} disabled={!rolesQ.data || saving}>
              <SelectTrigger id="rpm-role" className="h-11 w-full" data-testid="role-select">
                <SelectValue placeholder={!tenantReady ? "Select a tenant first" : !canListRoles ? "Needs role.read" : rolesQ.data ? "Choose a role" : "Loading roles…"} />
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
        </div>
      </Panel>

      {!tenantReady ? (
        <Panel>
          <EmptyState icon={Building2} title="Select a tenant" description="Role permissions belong to a tenant. Choose one above; nothing is loaded until you do." />
        </Panel>
      ) : !canReadGrid ? (
        <Panel>
          <EmptyState icon={Lock} title="No access to role permissions" description="Viewing a role's permissions needs role.permission.read." />
        </Panel>
      ) : rolesQ.data && roles.length === 0 ? (
        <Panel>
          <EmptyState icon={ShieldCheck} title="No roles returned" description="The server returned no roles for this tenant." />
        </Panel>
      ) : !role ? (
        <Panel>
          <EmptyState icon={ShieldCheck} title="Select a role" description="Choose a role to load its menu permissions." />
        </Panel>
      ) : mismatch ? (
        <Panel>
          <ApiErrorState error={new Error(mismatch)} title="Couldn't show this role's permissions" onRetry={matrixQ.refetch} />
          <p className="px-6 pb-6 text-center text-[13px] text-ink-muted">{mismatch} Nothing is shown, to keep tenants apart.</p>
        </Panel>
      ) : matrixQ.error && !shownGrid ? (
        <Panel>
          <ApiErrorState error={matrixQ.error} onRetry={matrixQ.refetch} title={matrixError(matrixQ.error).title} />
        </Panel>
      ) : !shownGrid ? (
        <Panel>
          <LoadingSkeleton variant="table" rows={8} />
        </Panel>
      ) : (
        <>
          {matrixQ.error ? (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status">
              Couldn&apos;t re-read this role from the server: {matrixError(matrixQ.error).detail}{" "}
              <button type="button" className="font-semibold underline" onClick={matrixQ.refetch}>
                Try again
              </button>
            </p>
          ) : null}
          {locked && !saving ? (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status" data-testid="matrix-locked">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {shownGrid.fullAccess ? `${role.code} has full access by policy. Its permissions can't be edited.` : !shownGrid.editable ? "The server marks this role's permissions as read-only for you." : "Read-only: saving needs role.permission.update."}
            </p>
          ) : null}
          {conflict ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning" role="alert" data-testid="matrix-conflict">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 basis-56">
                {CONFLICT_MESSAGE}
                {dirty ? " Your changes stay on screen until you reload, which discards them." : ""}
              </p>
              <Button size="sm" variant="outline" onClick={() => void reloadLatest()} disabled={reloading} data-testid="matrix-reload-latest">
                {reloading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reload Latest Permissions
              </Button>
            </div>
          ) : null}
          {saveError ? <SaveError error={saveError} /> : null}
          {note ? (
            <p className="rounded-xl bg-brand-tint px-3 py-2 text-[13px] text-brand-deep" role="status" data-testid="matrix-note">
              {note}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/70 bg-surface px-3 shadow-card">
              <Search className="size-4 text-ink-subtle" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search module or code" aria-label="Search modules" className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
            </label>
            <p className="text-[12.5px] text-ink-muted tabular @3xl:px-2">
              {formatNumber(permissionCodesToSave(shownGrid, selected).length)} granted
              {dirty ? (
                <span className="ml-1.5 font-medium text-brand-deep">
                  · +{diff.added.length} −{diff.removed.length} unsaved
                </span>
              ) : null}
            </p>
            {!locked || dirty ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={conflict ? () => void reloadLatest() : discardEdits} disabled={(!dirty && !conflict) || saving || reloading}>
                  <RotateCcw /> Reset
                </Button>
                <Button onClick={() => setReviewing(true)} disabled={block !== null || saving} data-testid="matrix-save">
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
                </Button>
              </div>
            ) : null}
          </div>

          <Panel className="overflow-hidden">
            {shownGrid.menus.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No menus returned" description="The server returned an empty grid for this role." />
            ) : shown.length === 0 ? (
              <EmptyState icon={Search} title="No matching modules" description="Change the search." />
            ) : (
              <div className="overflow-x-auto" data-testid="matrix-scroll">
                <table className="w-full min-w-[820px] text-[13px]" data-testid="permission-matrix">
                  <caption className="sr-only">
                    Menu permissions of role {role.code} in {tenantText}
                  </caption>
                  <thead className="dv-thead text-left text-xs">
                    <tr>
                      <th scope="col" className="w-12 px-4 py-3">
                        <abbr title="Module access" className="no-underline">
                          #
                        </abbr>
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Module Name
                      </th>
                      {OPERATIONS.map((o) => (
                        <th key={o.key} scope="col" className="w-20 px-3 py-3">
                          {o.label}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-3">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {shown.map((menu) => (
                      <MenuRows
                        key={menu.menuKey}
                        menu={menu}
                        selected={selected}
                        box={(cell, label) => <PermissionBox cell={cell} label={label} checked={selected.has(cell.code)} changed={selected.has(cell.code) !== granted.has(cell.code)} disabled={cellDisabled(cell, { locked })} shared={usage.get(cell.code) ?? 1} onChange={(v) => toggle(cell, v, menu)} />}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {hasUnmappedCells(shownGrid) ? (
            <p className="text-xs text-ink-muted" data-testid="unmapped-note">
              {UNMAPPED_NOTE}
            </p>
          ) : null}
          {shownGrid.otherPermissionCodes.length ? (
            <p className="text-xs text-ink-muted" data-testid="other-codes">
              Also held by this role, not shown as checkboxes and kept on save: <span className="font-mono">{shownGrid.otherPermissionCodes.join(", ")}</span>
            </p>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={reviewing && shownGrid !== null}
        onOpenChange={(o) => !o && !saving && setReviewing(false)}
        tone="default"
        title={`Save permissions for ${role?.code ?? "this role"}?`}
        description="This changes the role in one tenant only. Users of this role get the change at their next login or token refresh; anyone signed in keeps their current permissions until then."
        confirmLabel="Save"
        confirmDisabled={block !== null}
        onConfirm={save}
      >
        <div className="space-y-2 text-[13px]" data-testid="matrix-review">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            <dt className="text-ink-muted">Tenant</dt>
            <dd className="font-medium text-ink">{tenantText}</dd>
            <dt className="text-ink-muted">Role</dt>
            <dd className="font-medium text-ink">{role?.code}</dd>
          </dl>
          <p>
            <span className="font-medium text-success">+{diff.added.length} added</span> · <span className="font-medium text-danger">−{diff.removed.length} removed</span> · {diff.unchanged.length} unchanged
          </p>
          {diff.added.length ? <CodeList label="Added" codes={diff.added} /> : null}
          {diff.removed.length ? <CodeList label="Removed" codes={diff.removed} /> : null}
          {diff.unchanged.length ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-ink-muted">Unchanged ({diff.unchanged.length})</summary>
              <p className="mt-1 max-h-28 overflow-y-auto font-mono text-[11.5px] break-words text-ink">{diff.unchanged.join(", ")}</p>
            </details>
          ) : null}
          {shownGrid?.otherPermissionCodes.length ? <p className="text-xs text-ink-muted">Kept unchanged, not in the grid: {shownGrid.otherPermissionCodes.join(", ")}</p> : null}
          {saveError ? <SaveError error={saveError} /> : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(o) => !o && setPendingRemoval(null)}
        title="Remove from other modules too?"
        description={
          <>
            Unticking <span className="font-mono text-ink">{pendingRemoval?.code}</span> in <span className="font-medium text-ink">{pendingRemoval?.origin}</span> removes it from {role?.code ?? "this role"} everywhere it is used, because one code is one permission.
          </>
        }
        confirmLabel="Remove permissions"
        onConfirm={() => {
          if (pendingRemoval) applySelection(pendingRemoval.code, pendingRemoval.next);
          setPendingRemoval(null);
        }}
      >
        <div className="space-y-2 text-[13px]" data-testid="impact-dialog">
          {pendingRemoval?.closed.length ? (
            <p>
              <span className="font-medium text-ink">Modules that will close:</span> {pendingRemoval.closed.join(", ")}
            </p>
          ) : null}
          <ul className="max-h-48 divide-y divide-line/70 overflow-y-auto rounded-lg border border-line/70">
            {pendingRemoval?.removed.map((r) => (
              <li key={r.code} className="px-2.5 py-1.5" data-removed={r.code}>
                <p className="font-mono text-[12px] break-all text-danger">{r.code}</p>
                <p className="text-xs text-ink-muted">{r.modules.length ? `Also in: ${r.modules.join(", ")}` : `Only in ${pendingRemoval.origin}`}</p>
              </li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => !o && setPendingSwitch(null)}
        title="Discard unsaved changes?"
        description={`You have ${changes} unsaved change${changes === 1 ? "" : "s"} for ${role?.code ?? "this role"}. ${switchDescription}`}
        confirmLabel="Discard and switch"
        onConfirm={async () => {
          const next = pendingSwitch;
          setPendingSwitch(null);
          if (next?.kind === "role") switchRole(next.id);
          else if (next?.kind === "tenant") await switchTenant(next.tenant);
        }}
      />

      <ConfirmDialog
        open={guard.blocked}
        onOpenChange={(o) => !o && guard.stay()}
        title="Leave without saving?"
        description={`You have ${changes} unsaved change${changes === 1 ? "" : "s"} for ${role?.code ?? "this role"}. Leaving this page discards them.`}
        confirmLabel="Discard and leave"
        onConfirm={guard.leave}
      />
    </div>
  );
}

function MenuRows({ menu, box, selected }: { menu: GridMenu; box: (cell: GridCell, label: string) => React.ReactNode; selected: ReadonlySet<string> }) {
  const off = isMenuOff(menu, selected);
  const empty = OPERATIONS.length + 1;
  return (
    <Fragment>
      <tr className="bg-surface-muted/60" data-menu={menu.menuKey}>
        <td className="px-4 py-2.5">{menu.access ? box(menu.access, `${menu.title}: module access`) : null}</td>
        <th scope="row" className={cn("px-3 py-2.5 text-left font-semibold text-ink", menu.depth > 0 && "pl-8", off && "text-ink-muted")}>
          {menu.title}
        </th>
        <td colSpan={empty} />
      </tr>
      {menuRows(menu).map((r, i) => (
        <tr key={`${r.label}-${i}`} data-resource={r.label}>
          <td />
          <th scope="row" className={cn("px-3 py-2.5 text-left font-normal text-ink-muted", menu.depth > 0 ? "pl-12" : "pl-7")}>
            {r.label}
          </th>
          {OPERATIONS.map((o) => {
            const cell = r[o.key];
            return (
              <td key={o.key} className="px-3 py-2.5">
                {cell ? box(cell, `${menu.title}, ${r.label}: ${o.label}`) : <UnmappedBox label={`${menu.title}, ${r.label}: ${o.label}`} operation={o.label} resource={r.label} />}
              </td>
            );
          })}
          <td className="px-3 py-2">
            {r.actions.length ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {r.actions.map((a) => (
                  <span key={a.code} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    {box(a, `${menu.title}, ${r.label}: ${a.label}`)}
                    <span className={cn("text-xs", selected.has(a.code) ? "text-ink" : "text-ink-muted")} aria-hidden>
                      {a.label}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </td>
        </tr>
      ))}
    </Fragment>
  );
}

function PermissionBox({ cell, label, checked, changed, disabled, shared, onChange }: { cell: GridCell; label: string; checked: boolean; changed: boolean; disabled: boolean; shared: number; onChange: (v: boolean) => void }) {
  return (
    <span title={shared > 1 ? `${cell.code} (shared by ${shared} checkboxes)` : cell.code} className={cn("inline-grid rounded-[7px] p-0.5", changed && "ring-2 ring-brand/50")} data-code={cell.code}>
      <Checkbox aria-label={label} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className={PERMISSION_CHECKBOX} data-testid="permission-box" />
    </span>
  );
}

/** A cell the server sent as null: always empty and disabled, with no code, so it has no part in a save. */
function UnmappedBox({ label, operation, resource }: { label: string; operation: string; resource: string }) {
  return (
    <span title={`${operation} isn't mapped for ${resource}, so there is no permission to grant here.`} className="inline-grid rounded-[7px] p-0.5" data-unmapped={label}>
      <Checkbox aria-label={`${label} (not mapped)`} checked={false} disabled className={PERMISSION_CHECKBOX} data-testid="unmapped-box" />
    </span>
  );
}

function RoleOption({ role }: { role: RoleDto }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium">{role.code}</span>
      {role.description ? <span className="truncate text-xs text-ink-muted">{role.description}</span> : null}
    </span>
  );
}

function SaveError({ error }: { error: ReturnType<typeof matrixError> }) {
  return (
    <div className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert" data-testid="matrix-save-error">
      <p className="font-medium">{error.title}</p>
      <p>{error.detail}</p>
      {error.meta ? <p className="font-mono text-[11px] break-all opacity-80">{error.meta}</p> : null}
    </div>
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
