import type { PermissionDto, RoleDto, RolePermissionsDto } from "@/features/drive-vision/api/types";
import { ACTIONS, ALL_ACTIONS, ALL_FEATURES, ALL_SCREENS, ALL_WIDGETS, FEATURES, SCREENS, WIDGETS, type Requirement } from "@/features/drive-vision/access/access-policy";

/**
 * Global roles, permission catalogue and role-permission mapping (Phase 7). Pure: unit-tested.
 *
 * Only server data and V10 schema rules are used. Where V10 defines a flag but not its rule (protectedRole,
 * activeUsers, editable, fullAccess, scope), the UI is conservative and says it is a frontend choice; the
 * backend stays the authority (its errors, e.g. PROTECTED_ROLE / ROLE_IN_USE / PLATFORM_PERMISSION, are shown).
 */

// ── Roles ───────────────────────────────────────────────────────────────────

/**
 * V10 serves global and tenant roles from the same /roles endpoints; the only discriminator is
 * RoleDto.tenantId. A role without a tenant is treated as global (backend dependency: confirm).
 */
export type RoleScope = "global" | "tenant";
export const roleScope = (r: RoleDto): RoleScope => (typeof r.tenantId === "number" ? "tenant" : "global");
export const isGlobalRole = (r: RoleDto) => roleScope(r) === "global";

export type RoleFlagFilter = "all" | "protected" | "custom" | "fullAccess";

/** Roles of one scope, filtered by search (code, description, id) and server flags; sorted by code. */
export function filterRoles(roles: readonly RoleDto[], query: string, scope: RoleScope, flag: RoleFlagFilter = "all"): RoleDto[] {
  const q = query.trim().toLowerCase();
  return roles
    .filter((r) => roleScope(r) === scope)
    .filter((r) => !q || [r.code, r.description, r.id !== undefined ? String(r.id) : undefined].some((v) => typeof v === "string" && v.toLowerCase().includes(q)))
    .filter((r) => (flag === "protected" ? r.protectedRole === true : flag === "custom" ? r.protectedRole === false : flag === "fullAccess" ? r.fullAccess === true : true))
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "") || (a.id ?? 0) - (b.id ?? 0));
}

/** "all" for full-access roles, the size of the server's code list, or null when the server sent none. */
export function permissionCount(r: RoleDto): number | "all" | null {
  if (r.fullAccess === true) return "all";
  return Array.isArray(r.permissionCodes) ? new Set(r.permissionCodes.filter((c) => typeof c === "string")).size : null;
}

export const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,29}$/;
export const DESCRIPTION_MAX = 200;

/** CreateRoleRequest validation (V10 schema: code pattern, description ≤ 200; both required, description may be empty). */
export function validateRole(form: { code?: string; description: string }, mode: "create" | "edit"): Partial<Record<"code" | "description", string>> {
  const errors: Partial<Record<"code" | "description", string>> = {};
  if (mode === "create") {
    const code = (form.code ?? "").trim();
    if (!code) errors.code = "Role code is required.";
    else if (!ROLE_CODE_PATTERN.test(code)) errors.code = "2–30 characters: an uppercase letter, then uppercase letters, digits or _.";
  }
  if (form.description.length > DESCRIPTION_MAX) errors.description = `At most ${DESCRIPTION_MAX} characters.`;
  return errors;
}

/** Why a role can't be deleted from the frontend (null = offer it; the backend still decides). */
export function roleDeleteBlock(r: RoleDto): string | null {
  if (!isGlobalRole(r)) return "Tenant roles aren't managed on this platform screen.";
  if (typeof r.id !== "number") return "This role has no id.";
  if (r.protectedRole === true) return "The server marks this role as protected.";
  if (typeof r.activeUsers === "number" && r.activeUsers > 0) return `${r.activeUsers} active user${r.activeUsers === 1 ? "" : "s"} hold this role.`;
  return null;
}

/** Why a role's description can't be edited from the frontend (null = offer it). */
export function roleEditBlock(r: RoleDto): string | null {
  if (!isGlobalRole(r)) return "Tenant roles aren't managed on this platform screen.";
  if (typeof r.id !== "number") return "This role has no id.";
  if (r.protectedRole === true) return "The server marks this role as protected.";
  return null;
}

/** Why a role's permission list can't be changed (from GET /roles/{id}/permissions). */
export function mappingEditBlock(role: RoleDto, rp: RolePermissionsDto | undefined): string | null {
  if (!isGlobalRole(role)) return "Tenant roles aren't managed on this platform screen.";
  if (!rp) return "Assignments not loaded.";
  if (rp.fullAccess === true || role.fullAccess === true) return "This role has full access (every permission); there is no list to edit.";
  if (rp.editable === false) return "The server marks this role's permissions as not editable.";
  return null;
}

// ── Permission catalogue ────────────────────────────────────────────────────

export const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
export const PERMISSION_CODE_MAX = 60;
/** V10 request schemas: scope pattern "TENANT|PLATFORM". */
export const PERMISSION_SCOPES = ["TENANT", "PLATFORM"] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** The code's first segment ("device.read" → "device"). Derived from the code format, not a backend "module". */
export const codePrefix = (code: string) => code.split(".")[0] || code;

export function validatePermission(form: { code?: string; description: string; scope: string }, mode: "create" | "edit"): Partial<Record<"code" | "description" | "scope", string>> {
  const errors: Partial<Record<"code" | "description" | "scope", string>> = {};
  if (mode === "create") {
    const code = (form.code ?? "").trim();
    if (!code) errors.code = "Permission code is required.";
    else if (code.length > PERMISSION_CODE_MAX) errors.code = `At most ${PERMISSION_CODE_MAX} characters.`;
    else if (!PERMISSION_CODE_PATTERN.test(code)) errors.code = "Lowercase dotted code, e.g. device.read.";
  }
  if (form.description.length > DESCRIPTION_MAX) errors.description = `At most ${DESCRIPTION_MAX} characters.`;
  if (!(PERMISSION_SCOPES as readonly string[]).includes(form.scope)) errors.scope = "Choose TENANT or PLATFORM.";
  return errors;
}

/** Scope filter options: values present in the catalogue (V10's TENANT/PLATFORM or anything else returned), plus "No scope". */
export function scopeOptions(perms: readonly PermissionDto[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of perms) {
    const s = typeof p.scope === "string" ? p.scope.trim() : "";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0]))).map(([value, count]) => ({ value, label: value || "No scope", count }));
}

export const ALL = "__all__";

export function filterPermissions(perms: readonly PermissionDto[], query: string, scope: string = ALL, prefix: string = ALL): PermissionDto[] {
  const q = query.trim().toLowerCase();
  return perms
    .filter((p) => typeof p.code === "string" && p.code !== "")
    .filter((p) => !q || [p.code, p.description].some((v) => typeof v === "string" && v.toLowerCase().includes(q)))
    .filter((p) => scope === ALL || (typeof p.scope === "string" ? p.scope.trim() : "") === scope)
    .filter((p) => prefix === ALL || codePrefix(p.code!) === prefix)
    .sort((a, b) => a.code!.localeCompare(b.code!));
}

/** Catalogue grouped by code prefix, groups and items sorted. */
export function groupByPrefix<T extends { code?: string }>(items: readonly T[]): { prefix: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (typeof it.code !== "string" || !it.code) continue;
    const k = codePrefix(it.code);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([prefix, list]) => ({ prefix, items: list.sort((a, b) => a.code!.localeCompare(b.code!)) }));
}

// ── Effect on frontend access ───────────────────────────────────────────────

export interface FrontendUse {
  kind: "screen" | "action" | "feature" | "widget";
  key: string;
}

const uses = (req: Requirement, code: string) => (req.anyOf ?? []).includes(code) || (req.allOf ?? []).includes(code);

/** Where the frontend's own access policy uses a permission code (what a change to it affects in this app). */
export function frontendUsage(code: string): FrontendUse[] {
  const out: FrontendUse[] = [];
  for (const s of ALL_SCREENS) if (uses(SCREENS[s].requires, code)) out.push({ kind: "screen", key: s });
  for (const a of ALL_ACTIONS) if (uses(ACTIONS[a].requires, code)) out.push({ kind: "action", key: a });
  for (const f of ALL_FEATURES) if (uses(FEATURES[f], code)) out.push({ kind: "feature", key: f });
  for (const w of ALL_WIDGETS) if (uses(WIDGETS[w], code)) out.push({ kind: "widget", key: w });
  return out;
}

/** Codes the platform administration screens depend on — removing them from your own role can lock you out. */
export const SELF_LOCKOUT_CODES = ["tenant.all", "role.read", "role.manage", "role.permission.read", "role.permission.create", "role.permission.update", "role.permission.delete", "permission.manage"] as const;

// ── Role-permission changes ─────────────────────────────────────────────────

export interface PendingChanges {
  additions: ReadonlySet<string>;
  removals: ReadonlySet<string>;
}
export const NO_CHANGES: PendingChanges = { additions: new Set(), removals: new Set() };

/** Toggles a code: assigned codes go in/out of removals, unassigned ones in/out of additions (never both, never duplicates). */
export function toggleCode(pending: PendingChanges, code: string, assigned: ReadonlySet<string>): PendingChanges {
  const additions = new Set(pending.additions);
  const removals = new Set(pending.removals);
  if (assigned.has(code)) {
    if (removals.has(code)) removals.delete(code);
    else removals.add(code);
    additions.delete(code);
  } else {
    if (additions.has(code)) additions.delete(code);
    else additions.add(code);
    removals.delete(code);
  }
  return { additions, removals };
}

/** V10 RolePermissionsRequest / codes query: maxItems 300 per request. */
export const MAX_CODES_PER_REQUEST = 300;

export interface ChangePlan {
  add: string[];
  remove: string[];
  /** Blocking problems (nothing is sent while any exist). */
  problems: string[];
  /** Non-blocking warnings shown in the review step. */
  warnings: string[];
}

/**
 * What will actually be sent: additions not already assigned, removals that are assigned (so duplicates and
 * no-ops never reach the server), with blocking problems and review warnings.
 */
export function planChanges(
  pending: PendingChanges,
  assigned: ReadonlySet<string>,
  ctx: { catalog: readonly PermissionDto[]; canAdd: boolean; canRemove: boolean; ownRole: boolean }
): ChangePlan {
  const add = [...pending.additions].filter((c) => !assigned.has(c)).sort();
  const remove = [...pending.removals].filter((c) => assigned.has(c)).sort();
  const problems: string[] = [];
  const warnings: string[] = [];
  if (add.length && !ctx.canAdd) problems.push("You can't add permissions (needs role.permission.create).");
  if (remove.length && !ctx.canRemove) problems.push("You can't remove permissions (needs role.permission.delete).");
  if (add.length > MAX_CODES_PER_REQUEST || remove.length > MAX_CODES_PER_REQUEST) problems.push(`At most ${MAX_CODES_PER_REQUEST} codes per change (V10 limit).`);
  const known = new Set(ctx.catalog.map((p) => p.code).filter(Boolean));
  const unknown = add.filter((c) => !known.has(c));
  if (unknown.length) problems.push(`Not in the permission catalogue: ${unknown.join(", ")}.`);
  const scopeOf = new Map(ctx.catalog.map((p) => [p.code, typeof p.scope === "string" ? p.scope.trim().toUpperCase() : ""]));
  const platformAdds = add.filter((c) => scopeOf.get(c) === "PLATFORM");
  if (platformAdds.length) warnings.push(`Platform-scope permission${platformAdds.length > 1 ? "s" : ""}: ${platformAdds.join(", ")}. The server may refuse them for some roles (PLATFORM_PERMISSION).`);
  if (ctx.ownRole) {
    const risky = remove.filter((c) => (SELF_LOCKOUT_CODES as readonly string[]).includes(c));
    if (risky.length) warnings.push(`You hold this role. Removing ${risky.join(", ")} can remove your own access to platform administration.`);
  }
  const affected = remove.filter((c) => frontendUsage(c).length > 0);
  if (affected.length) warnings.push(`Holders of this role lose frontend access tied to: ${affected.join(", ")}.`);
  return { add, remove, problems, warnings };
}

export type StepResult = { ok: true; codes: string[] } | { ok: false; codes: string[]; error: unknown } | null;

/** Summary of an apply run (add first, then remove). `partial` = one step succeeded and the other failed. */
export function summarizeApply(added: StepResult, removed: StepResult): { status: "success" | "partial" | "failed" | "nothing"; message: string } {
  const steps = [added, removed].filter((s): s is NonNullable<StepResult> => s !== null);
  if (steps.length === 0) return { status: "nothing", message: "No changes to save." };
  const ok = steps.filter((s) => s.ok);
  if (ok.length === steps.length) return { status: "success", message: "Permissions updated." };
  if (ok.length === 0) return { status: "failed", message: "No changes were saved." };
  const done = added?.ok ? `added ${added.codes.length}` : `removed ${removed!.codes.length}`;
  const failed = added && !added.ok ? "adding" : "removing";
  return { status: "partial", message: `Partly saved: ${done}; ${failed} failed. The list below is the server's current state.` };
}

// ── Checkbox selection (Phase 7 UI enhancement) ─────────────────────────────

/** What the checkboxes show: server assignments, minus pending removals, plus pending additions. */
export function desiredSelection(assigned: ReadonlySet<string>, pending: PendingChanges): Set<string> {
  const out = new Set([...assigned].filter((c) => !pending.removals.has(c)));
  for (const c of pending.additions) if (!assigned.has(c)) out.add(c);
  return out;
}

export interface SelectionRights {
  /** Read-only role (full access, editable === false, tenant role, not loaded): nothing changes. */
  locked: boolean;
  /** role.permission.create — may check unassigned codes. */
  canAdd: boolean;
  /** role.permission.delete — may uncheck assigned codes. */
  canRemove: boolean;
}

/**
 * Checks or unchecks many codes at once (single box, a module, Select / Deselect all). Respects the same
 * rights as a single checkbox, so bulk selection can't bypass them:
 * - checking an unassigned code needs canAdd; checking an assigned one only undoes a pending removal;
 * - unchecking an assigned code needs canRemove; unchecking an unassigned one only undoes a pending addition;
 * - a locked role changes nothing.
 */
export function setCodes(pending: PendingChanges, codes: Iterable<string>, checked: boolean, assigned: ReadonlySet<string>, rights: SelectionRights): PendingChanges {
  if (rights.locked) return pending;
  const additions = new Set(pending.additions);
  const removals = new Set(pending.removals);
  for (const code of codes) {
    if (assigned.has(code)) {
      if (checked) removals.delete(code);
      else if (rights.canRemove) removals.add(code);
    } else if (checked) {
      if (rights.canAdd) additions.add(code);
    } else additions.delete(code);
  }
  return { additions, removals };
}

/** Whether a box can be changed by the user (same rules as setCodes, for one code). */
export function codeEditable(code: string, assigned: ReadonlySet<string>, rights: SelectionRights): boolean {
  if (rights.locked) return false;
  return assigned.has(code) ? rights.canRemove : rights.canAdd;
}

/** A group's checkbox state over the given codes: all / none / some (indeterminate). */
export function groupState(codes: readonly string[], selected: ReadonlySet<string>): "all" | "none" | "some" {
  if (codes.length === 0) return "none";
  const n = codes.filter((c) => selected.has(c)).length;
  return n === 0 ? "none" : n === codes.length ? "all" : "some";
}

/**
 * Pending changes to keep after a save attempt, so nothing the server didn't accept is lost:
 * success → none; failed → all; partial → only the step that failed. (No-ops against the re-read
 * server state are dropped again by planChanges.)
 */
export function pendingAfterApply(pending: PendingChanges, added: StepResult, removed: StepResult): PendingChanges {
  return {
    additions: added && !added.ok ? new Set(pending.additions) : new Set(),
    removals: removed && !removed.ok ? new Set(pending.removals) : new Set(),
  };
}
