"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, KeyRound, Loader2, Lock, LockOpen, Pencil, Plus, RefreshCw, ShieldCheck, UserRoundCheck, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminService } from "@/features/drive-vision/api/admin-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { RoleDto, UserDetailDto, UserListStatus, UserSummaryDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { useAuth } from "@/features/drive-vision/store/auth-store";
import { formatDateTime, formatNumber, initials } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { FilterBar, FilterSelect, SearchInput, SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { StatusBadge, type Tone } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import type { Errors } from "../settings/settings-model";
import {
  EMPTY_USER_FORM,
  createUserBody,
  flattenTree,
  nextStatus,
  roleOptions,
  updateUserBody,
  userFormFrom,
  validateResetPassword,
  validateUserForm,
  type UserField,
  type UserForm,
} from "./users-model";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
type Tab = "users" | "tree" | "roles";
type StatusFilter = "all" | UserListStatus;

const STATUS_TONE: Record<string, Tone> = { ACTIVE: "success", INVITED: "info", DISABLED: "neutral" };

function UserStatus({ user }: { user: UserSummaryDto }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {user.status ? (
        <StatusBadge size="sm" tone={STATUS_TONE[user.status] ?? "neutral"}>
          {user.status}
        </StatusBadge>
      ) : (
        <span className="text-ink-subtle">—</span>
      )}
      {user.locked ? (
        <StatusBadge size="sm" tone="warning" icon={Lock}>
          Locked
        </StatusBadge>
      ) : null}
    </span>
  );
}

/**
 * Users & Sub-Accounts on live BFF data: GET /users (server-paged, keyword/status/role filters),
 * /users/{id}, /users/tree, /roles, /permissions. Writes: create, edit, enable/disable, unlock and
 * password reset — each confirmed and reported only after the server answers. Deleting users and
 * editing roles aren't offered (see docs/feature-status.md).
 */
export function UsersPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [roleId, setRoleId] = useState("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);

  useEffect(() => {
    const next = searchInput.trim();
    if (next === keyword) return;
    const timer = setTimeout(() => {
      setKeyword(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, keyword]);

  const filterKey = `${keyword}:${status}:${roleId}`;
  const listQ = useApiQuery(tab === "users" ? `users:list:${filterKey}:${page}` : null, () =>
    adminService.listUsers({ keyword: keyword || undefined, status: status === "all" ? undefined : status, roleId: roleId === "all" ? undefined : Number(roleId), pageNumber: page, pageSize: PAGE_SIZE })
  );
  const rolesQ = useApiQuery("users:roles", () => adminService.listRoles());
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const filtersActive = keyword !== "" || status !== "all" || roleId !== "all";

  const columns: DataTableColumn<UserSummaryDto>[] = [
    {
      id: "name",
      header: "User",
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunken text-[11px] font-semibold text-ink-muted" aria-hidden>
            {initials(u.displayName ?? "?")}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{u.displayName ?? `User ${u.id}`}</p>
            <p className="truncate text-xs text-ink-muted">{u.email ?? u.phone ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { id: "role", header: "Role", cell: (u) => <span className="font-mono text-xs">{u.role?.code ?? "—"}</span> },
    { id: "status", header: "Status", cell: (u) => <UserStatus user={u} /> },
    { id: "last", header: "Last sign-in", hideBelow: "md", cell: (u) => (u.lastLoginAt ? <span className="tabular">{formatDateTime(u.lastLoginAt)}</span> : <span className="text-ink-subtle">Never</span>) },
    { id: "created", header: "Created", hideBelow: "lg", cell: (u) => (u.createdAt ? <span className="tabular">{formatDateTime(u.createdAt)}</span> : "—") },
  ];

  return (
    <div>
      <PageHeader
        title="Users & Sub-Accounts"
        description={tab === "users" ? (listQ.data ? `${formatNumber(listQ.data.total)} user${listQ.data.total === 1 ? "" : "s"}${filtersActive ? " · filtered" : ""}` : listQ.error ? "Couldn't load users" : "Loading users…") : undefined}
        actions={
          <>
            {tab === "users" ? (
              <Button variant="outline" onClick={listQ.refetch} disabled={listQ.loading}>
                <RefreshCw className={listQ.refreshing ? "animate-spin" : undefined} /> Refresh
              </Button>
            ) : null}
            <Button onClick={() => setFormMode("create")} disabled={!rolesQ.data}>
              <Plus /> New user
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "users", label: "Users" },
            { value: "tree", label: "Hierarchy" },
            { value: "roles", label: "Roles & permissions" },
          ]}
        />
        {tab === "users" ? (
          // Below sm: full-width bar, search on its own row, the two selects share the next row.
          <FilterBar className="max-sm:w-full">
            <SearchInput label="Search users" value={searchInput} onChange={setSearchInput} placeholder="Name, email or phone" className="w-full max-sm:basis-full sm:w-64" />
            <FilterSelect
              label="Status"
              className="max-sm:flex-1"
              value={status}
              onChange={(v: StatusFilter) => (setStatus(v), setPage(1))}
              options={[
                { value: "all", label: "Any status" },
                { value: "ACTIVE", label: "Active" },
                { value: "INVITED", label: "Invited" },
                { value: "DISABLED", label: "Disabled" },
              ]}
            />
            <FilterSelect label="Role" value={roleId} onChange={(v) => (setRoleId(v), setPage(1))} options={[{ value: "all", label: "Any role" }, ...roles.filter((r) => r.id !== undefined).map((r) => ({ value: String(r.id), label: r.code ?? `Role ${r.id}` }))]} className="max-w-56 max-sm:flex-1" />
          </FilterBar>
        ) : null}
      </div>

      {tab === "users" ? (
        <Panel className="overflow-hidden">
          {listQ.error ? (
            <ApiErrorState error={listQ.error} onRetry={listQ.refetch} />
          ) : !listQ.data ? (
            <LoadingSkeleton variant="table" rows={8} />
          ) : (
            <DataTable
              caption="Users"
              data={listQ.data.items}
              columns={columns}
              getRowId={(u) => String(u.id)}
              onRowClick={(u) => u.id !== undefined && setOpenId(u.id)}
              activeRowId={openId !== null ? String(openId) : null}
              isLoading={listQ.refreshing}
              pageSize={PAGE_SIZE}
              serverPagination={{ page, total: listQ.data.total, onPageChange: setPage }}
              emptyTitle="No users"
              emptyDescription={filtersActive ? "The server returned no users for these filters." : "The server returned no users."}
            />
          )}
        </Panel>
      ) : tab === "tree" ? (
        <HierarchyPanel onOpen={setOpenId} />
      ) : (
        <RolesPanel rolesQ={rolesQ} />
      )}

      <UserDrawer
        id={openId}
        roles={roles}
        onClose={() => setOpenId(null)}
        onEdit={() => setFormMode("edit")}
        onChanged={() => {
          listQ.refetch();
        }}
      />
      <UserFormPanel
        mode={formMode}
        userId={formMode === "edit" ? openId : null}
        roles={roles}
        onClose={() => setFormMode(null)}
        onSaved={(u) => {
          setFormMode(null);
          listQ.refetch();
          if (u.id !== undefined) setOpenId(u.id);
        }}
      />
    </div>
  );
}

// ── Hierarchy (GET /users/tree) ─────────────────────────────────────────────

function HierarchyPanel({ onOpen }: { onOpen: (id: number) => void }) {
  const treeQ = useApiQuery("users:tree", () => adminService.userTree());
  const rows = useMemo(() => flattenTree(treeQ.data), [treeQ.data]);
  return (
    <Panel>
      <PanelHeader title="Account hierarchy" description="Parent and sub-accounts as returned by the server" />
      {treeQ.error ? (
        <ApiErrorState error={treeQ.error} onRetry={treeQ.refetch} />
      ) : !treeQ.data ? (
        <LoadingSkeleton variant="list" rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="No accounts" description="The server returned an empty hierarchy." />
      ) : (
        <ul className="px-3 pb-3">
          {rows.map(({ node, depth }, i) => (
            <li key={node.id ?? `n${i}`}>
              <button
                type="button"
                disabled={node.id === undefined}
                onClick={() => node.id !== undefined && onOpen(node.id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left text-[13px] hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                style={{ paddingLeft: 8 + Math.min(depth, 8) * 18 }}
              >
                <span className="truncate font-medium">{node.displayName ?? `User ${node.id}`}</span>
                {node.roleCode ? <span className="font-mono text-[11px] text-ink-muted">{node.roleCode}</span> : null}
                {node.status ? (
                  <StatusBadge size="sm" tone={STATUS_TONE[node.status] ?? "neutral"}>
                    {node.status}
                  </StatusBadge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Roles & permissions (read-only) ─────────────────────────────────────────

function RolesPanel({ rolesQ }: { rolesQ: ReturnType<typeof useApiQuery<{ items: RoleDto[] }>> }) {
  const permsQ = useApiQuery("users:permissions", () => adminService.listPermissions());
  const describe = useMemo(() => new Map((permsQ.data?.items ?? []).map((p) => [p.code, p.description])), [permsQ.data]);
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 px-1 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>Read-only for now. Changing a role&apos;s permissions affects every user with that role, so it stays off until the role model for Fleet Owner and Driver is agreed with the backend team.</span>
      </p>
      <Panel>
        {rolesQ.error ? (
          <ApiErrorState error={rolesQ.error} onRetry={rolesQ.refetch} />
        ) : !rolesQ.data ? (
          <LoadingSkeleton variant="list" rows={4} />
        ) : rolesQ.data.items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No roles" description="The server returned no roles." />
        ) : (
          <ul className="divide-y divide-line">
            {rolesQ.data.items.map((r) => (
              <li key={r.id ?? r.code} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold">{r.code ?? `Role ${r.id}`}</span>
                  {r.protectedRole ? <StatusBadge size="sm" tone="lavender">Protected</StatusBadge> : null}
                  {r.assignable === false ? <StatusBadge size="sm" tone="neutral">Not assignable</StatusBadge> : null}
                </div>
                {r.description ? <p className="mt-0.5 text-[13px] text-ink-muted">{r.description}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(r.permissionCodes ?? []).length === 0 ? (
                    <span className="text-xs text-ink-subtle">No permissions</span>
                  ) : (
                    (r.permissionCodes ?? []).map((code) => (
                      <span key={code} title={describe.get(code) ?? undefined} className="rounded-full bg-surface-sunken px-2 py-0.5 font-mono text-[11px] text-ink-muted">
                        {code}
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <PanelHeader title="Permission catalogue" description="GET /permissions" />
        {permsQ.error ? (
          <ApiErrorState error={permsQ.error} onRetry={permsQ.refetch} compact />
        ) : !permsQ.data ? (
          <LoadingSkeleton variant="list" rows={4} />
        ) : (
          <dl className="divide-y divide-line px-5 pb-3">
            {permsQ.data.items.map((p) => (
              <DetailRow key={p.code} label={p.code ?? "—"}>
                {p.description ?? "—"}
              </DetailRow>
            ))}
          </dl>
        )}
      </Panel>
    </div>
  );
}

// ── User detail + account actions ───────────────────────────────────────────

type PendingAction = { kind: "status"; to: "ACTIVE" | "DISABLED" } | { kind: "unlock" } | { kind: "password" };

function UserDrawer({ id, roles, onClose, onEdit, onChanged }: { id: number | null; roles: RoleDto[]; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const me = useAuth((s) => s.user?.id);
  const detailQ = useApiQuery(id !== null ? `users:detail:${id}` : null, () => adminService.getUser(id!));
  const [updated, setUpdated] = useState<UserDetailDto | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<Errors<"newPassword" | "confirm">>({});
  const user = updated?.id === id && id !== null ? updated : detailQ.data;
  const self = user?.id !== undefined && user.id === me;
  const toggle = nextStatus(user?.status);
  const roleName = (rid?: number) => roles.find((r) => r.id === rid)?.description;

  async function run() {
    if (!pending || id === null) return;
    try {
      if (pending.kind === "status") {
        setUpdated(await adminService.setStatus(id, { status: pending.to }));
        toast.success(pending.to === "DISABLED" ? "User disabled" : "User enabled");
      } else if (pending.kind === "unlock") {
        setUpdated(await adminService.unlock(id));
        toast.success("User unlocked");
      } else {
        await adminService.resetPassword(id, { newPassword: pw.next });
        setPw({ next: "", confirm: "" });
        toast.success("Password reset");
      }
      onChanged();
    } catch (err) {
      toast.error("The server rejected the change", { description: describeApiError(err) });
    }
  }

  const passwordInvalid = Object.keys(validateResetPassword(pw.next, pw.confirm)).length > 0;

  return (
    <>
      <SlideOverPanel
        open={id !== null}
        onOpenChange={(o) => !o && (onClose(), setUpdated(null))}
        title={user?.displayName ?? (id !== null ? `User ${id}` : "")}
        description={user?.email ?? undefined}
        footer={
          user ? (
            <div className="flex flex-wrap justify-end gap-2">
              {user.locked ? (
                <Button variant="outline" onClick={() => setPending({ kind: "unlock" })}>
                  <LockOpen /> Unlock
                </Button>
              ) : null}
              {toggle ? (
                <Button variant="outline" onClick={() => setPending({ kind: "status", to: toggle })} disabled={self} title={self ? "You can't change your own status here" : undefined}>
                  {toggle === "DISABLED" ? <UserRoundX /> : <UserRoundCheck />} {toggle === "DISABLED" ? "Disable" : "Enable"}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setPending({ kind: "password" })} disabled={self} title={self ? "Use Settings to change your own password" : undefined}>
                <KeyRound /> Reset password
              </Button>
              <Button onClick={onEdit}>
                <Pencil /> Edit
              </Button>
            </div>
          ) : undefined
        }
      >
        {detailQ.error && !user ? (
          <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
        ) : !user ? (
          <LoadingSkeleton variant="list" rows={6} />
        ) : (
          <dl className="divide-y divide-line">
            <DetailRow label="Status">
              <UserStatus user={user} />
            </DetailRow>
            <DetailRow label="Role">
              <span className="font-mono text-xs">{user.role?.code ?? "—"}</span>
              {roleName(user.role?.id) ? <span className="ml-1 text-ink-muted">· {roleName(user.role?.id)}</span> : null}
            </DetailRow>
            <DetailRow label="Phone">{user.phone ?? "—"}</DetailRow>
            <DetailRow label="Parent account">{user.parentUserId !== undefined && user.parentUserId !== null ? `User ${user.parentUserId}` : "— (top level)"}</DetailRow>
            <DetailRow label="Locale · time zone">{[user.locale, user.timezone].filter(Boolean).join(" · ") || "—"}</DetailRow>
            <DetailRow label="Failed sign-ins">{user.failedLoginCount ?? "—"}</DetailRow>
            {user.lockedUntil ? <DetailRow label="Locked until">{formatDateTime(user.lockedUntil)}</DetailRow> : null}
            <DetailRow label="Last sign-in">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</DetailRow>
            <DetailRow label="Created">{user.createdAt ? formatDateTime(user.createdAt) : "—"}</DetailRow>
            <DetailRow label="Updated">{user.updatedAt ? formatDateTime(user.updatedAt) : "—"}</DetailRow>
          </dl>
        )}
      </SlideOverPanel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && (setPending(null), setPwErrors({}))}
        tone={pending?.kind === "status" && pending.to === "DISABLED" ? "danger" : "default"}
        title={
          pending?.kind === "status" ? `${pending.to === "DISABLED" ? "Disable" : "Enable"} ${user?.displayName ?? "this user"}?` : pending?.kind === "unlock" ? `Unlock ${user?.displayName ?? "this user"}?` : `Reset password for ${user?.displayName ?? "this user"}?`
        }
        description={
          pending?.kind === "status"
            ? pending.to === "DISABLED"
              ? "They won't be able to sign in until the account is enabled again."
              : "They will be able to sign in again."
            : pending?.kind === "unlock"
              ? "Clears the sign-in lock on the server."
              : "Sets a new password on the server. Share it with the user through a secure channel."
        }
        confirmLabel={pending?.kind === "status" ? (pending.to === "DISABLED" ? "Disable" : "Enable") : pending?.kind === "unlock" ? "Unlock" : "Reset password"}
        confirmDisabled={pending?.kind === "password" && passwordInvalid}
        onConfirm={run}
      >
        {pending?.kind === "password" ? (
          <div className="space-y-3">
            <FormField id="rp-new" label="New password" error={pwErrors.newPassword} required>
              <Input {...fieldA11y("rp-new", pwErrors.newPassword)} type="password" autoComplete="new-password" maxLength={72} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} onBlur={() => setPwErrors(validateResetPassword(pw.next, pw.confirm))} />
            </FormField>
            <FormField id="rp-confirm" label="Confirm password" error={pwErrors.confirm} required>
              <Input {...fieldA11y("rp-confirm", pwErrors.confirm)} type="password" autoComplete="new-password" maxLength={72} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} onBlur={() => setPwErrors(validateResetPassword(pw.next, pw.confirm))} />
            </FormField>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

// ── Create / edit form ──────────────────────────────────────────────────────

function UserFormPanel({ mode, userId, roles, onClose, onSaved }: { mode: "create" | "edit" | null; userId: number | null; roles: RoleDto[]; onClose: () => void; onSaved: (u: UserDetailDto) => void }) {
  const detailQ = useApiQuery(mode === "edit" && userId !== null ? `users:detail:${userId}` : null, () => adminService.getUser(userId!));
  const current = mode === "edit" ? detailQ.data : undefined;
  const [draft, setDraft] = useState<UserForm | null>(null);
  const [errors, setErrors] = useState<Errors<UserField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const base = mode === "edit" ? (current ? userFormFrom(current) : null) : EMPTY_USER_FORM;
  const form = draft ?? base;
  const options = roleOptions(roles, current?.role?.id);

  function close() {
    setDraft(null);
    setErrors({});
    setFailure(null);
    onClose();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !mode) return;
    const found = validateUserForm(form, mode);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const saved = mode === "create" ? await adminService.createUser(createUserBody(form)) : await adminService.updateUser(userId!, updateUserBody(form, current!));
      toast.success(mode === "create" ? "User created" : "User updated");
      setDraft(null);
      onSaved(saved);
    } catch (err) {
      const map = isApiError(err) ? err.fieldErrorMap() : {};
      const known: Errors<UserField> = {};
      for (const f of ["displayName", "email", "phone", "password", "roleId", "locale", "timezone"] as const) if (map[f]) known[f] = map[f];
      setErrors(known);
      setFailure(Object.keys(known).length > 0 ? null : describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const text = (f: Exclude<UserField, "roleId">, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) =>
    form ? (
      <FormField id={`uf-${f}`} label={label} error={errors[f]} hint={hint} required={f === "displayName" || f === "password"}>
        <Input {...fieldA11y(`uf-${f}`, errors[f], hint)} value={form[f]} onChange={(e) => setDraft({ ...form, [f]: e.target.value })} {...props} />
      </FormField>
    ) : null;

  return (
    <SlideOverPanel
      open={mode !== null}
      onOpenChange={(o) => !o && close()}
      title={mode === "create" ? "New user" : "Edit user"}
      description={mode === "create" ? "Creates the account on the SafeFare server" : current?.displayName}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={!form || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} {mode === "create" ? "Create user" : "Save changes"}
          </Button>
        </div>
      }
    >
      {mode === "edit" && detailQ.error && !current ? (
        <ApiErrorState error={detailQ.error} onRetry={detailQ.refetch} />
      ) : !form ? (
        <LoadingSkeleton variant="list" rows={6} />
      ) : (
        <form id="user-form" className="space-y-3" onSubmit={onSubmit} noValidate>
          {text("displayName", "Display name", { maxLength: 150 })}
          {text("email", "Email", { type: "email", maxLength: 320 })}
          {text("phone", "Phone", { type: "tel", maxLength: 30 })}
          {mode === "create" ? text("password", "Initial password", { type: "password", autoComplete: "new-password", maxLength: 72 }) : null}
          <FormField id="uf-roleId" label="Role" error={errors.roleId} required>
            <Select value={form.roleId} onValueChange={(v) => setDraft({ ...form, roleId: v })}>
              <SelectTrigger id="uf-roleId" className={cn("w-full")} aria-invalid={errors.roleId ? true : undefined}>
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("locale", "Locale", { maxLength: 5 }, "e.g. en or en_IN")}
            {text("timezone", "Time zone", { maxLength: 50 })}
          </div>
          {failure ? (
            <p className="text-[13px] text-danger" role="alert">
              {failure}
            </p>
          ) : null}
          <p className="text-xs text-ink-muted">Only roles the server marks as assignable are offered. The server decides whether you may create or change this account.</p>
        </form>
      )}
    </SlideOverPanel>
  );
}
