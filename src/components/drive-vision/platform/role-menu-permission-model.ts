import { apiErrorMeta, describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { RoleMenuCellDto, RoleMenuDto, RoleMenuPermissionsDto, RoleMenuResourceDto } from "@/features/drive-vision/api/types";

/**
 * The role menu permission grid (docs/contracts/role-menu-permission-api.txt). Pure: unit-tested.
 *
 * The backend decides everything shown: rows, labels, codes, `granted` and `editable`. Nothing here knows a
 * menu name or a permission code. One permission code is one permission, however many boxes show it, so the
 * ticks are a single set of codes and every box reads from it. `editable` belongs to each cell on its own: no cell's
 * flag decides another cell's. A null cell has no code, so it can't be selected or saved (see unmappedColumns).
 */

export interface GridCell {
  code: string;
  granted: boolean;
  editable: boolean;
}
export interface GridActionCell extends GridCell {
  label: string;
}
export interface GridResource {
  label: string;
  view: GridCell | null;
  add: GridCell | null;
  edit: GridCell | null;
  delete: GridCell | null;
  actions: GridActionCell[];
}
export interface GridMenu {
  menuId: number | null;
  menuKey: string;
  title: string;
  /** 0 for a top-level menu, 1+ under its parent. */
  depth: number;
  access: GridCell | null;
  resources: GridResource[];
}
export interface RoleMenuGrid {
  tenantId: number | null;
  roleId: number | null;
  roleCode: string | null;
  fullAccess: boolean;
  /** false = the whole grid is read-only. */
  editable: boolean;
  menus: GridMenu[];
  otherPermissionCodes: string[];
}

/** Add / Edit / Delete / View, in column order. */
export const OPERATIONS = [
  { key: "add", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "view", label: "View" },
] as const;

/** PUT body limit (contract: "Max 300"). */
export const MAX_PERMISSION_CODES = 300;

// ── Reading the response ────────────────────────────────────────────────────

/** A cell, or null. Only an explicit `true` grants or allows editing. */
function readCell(raw: RoleMenuCellDto | null | undefined): GridCell | null {
  if (!raw || typeof raw.permissionCode !== "string" || raw.permissionCode === "") return null;
  return { code: raw.permissionCode, granted: raw.granted === true, editable: raw.editable === true };
}

function readResource(raw: RoleMenuResourceDto, index: number): GridResource {
  const actions: GridActionCell[] = [];
  for (const a of Array.isArray(raw.actions) ? raw.actions : []) {
    const cell = readCell(a);
    if (cell) actions.push({ ...cell, label: a.label || cell.code });
  }
  return { label: raw.label || `Resource ${index + 1}`, view: readCell(raw.view), add: readCell(raw.add), edit: readCell(raw.edit), delete: readCell(raw.delete), actions };
}

/** Children directly after their parent; siblings by sortOrder, ties in server order. */
function orderMenus(menus: readonly RoleMenuDto[]): { menu: RoleMenuDto; depth: number }[] {
  const ids = new Set(menus.map((m) => m.menuId));
  const parentOf = (m: RoleMenuDto) => (typeof m.parentId === "number" && m.parentId !== m.menuId && ids.has(m.parentId) ? m.parentId : null);
  const bySort = (a: RoleMenuDto, b: RoleMenuDto) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
  const out: { menu: RoleMenuDto; depth: number }[] = [];
  const seen = new Set<RoleMenuDto>();
  const add = (parent: number | null, depth: number) => {
    for (const menu of menus.filter((m) => parentOf(m) === parent).sort(bySort)) {
      if (seen.has(menu)) continue;
      seen.add(menu);
      out.push({ menu, depth });
      if (typeof menu.menuId === "number") add(menu.menuId, depth + 1);
    }
  };
  add(null, 0);
  // A parent loop in the data would otherwise hide menus.
  for (const menu of menus) if (!seen.has(menu)) out.push({ menu, depth: 0 });
  return out;
}

export function readGrid(dto: RoleMenuPermissionsDto | undefined): RoleMenuGrid {
  const menus = Array.isArray(dto?.menus) ? dto.menus.filter((m) => m && typeof m === "object") : [];
  return {
    tenantId: typeof dto?.tenantId === "number" ? dto.tenantId : null,
    roleId: typeof dto?.roleId === "number" ? dto.roleId : null,
    roleCode: dto?.roleCode ?? null,
    fullAccess: dto?.fullAccess === true,
    editable: dto?.editable === true,
    menus: orderMenus(menus).map(({ menu, depth }, i) => ({
      menuId: typeof menu.menuId === "number" ? menu.menuId : null,
      menuKey: menu.menuKey || `menu-${i}`,
      title: menu.title || menu.menuKey || `Menu ${i + 1}`,
      depth,
      access: readCell(menu.access),
      resources: (Array.isArray(menu.resources) ? menu.resources : []).map(readResource),
    })),
    otherPermissionCodes: Array.isArray(dto?.otherPermissionCodes) ? dto.otherPermissionCodes.filter((c) => typeof c === "string") : [],
  };
}

/**
 * Why a response can't be shown for this request, or null. A grid of another tenant or role must never appear
 * under the selected one. `tenantId` is the tenant the screen is working in (null = not known to the client).
 */
export function gridMismatch(grid: RoleMenuGrid, expected: { tenantId: number | null; roleId: number }): string | null {
  if (grid.roleId !== null && grid.roleId !== expected.roleId) return `The server returned role ${grid.roleId} instead of role ${expected.roleId}.`;
  if (expected.tenantId !== null && grid.tenantId !== null && grid.tenantId !== expected.tenantId) return `The server returned tenant ${grid.tenantId} instead of tenant ${expected.tenantId}.`;
  return null;
}

// ── Cells and codes ─────────────────────────────────────────────────────────

/** Every cell of a resource row, null cells left out. */
export function resourceCells(r: GridResource): GridCell[] {
  return [r.view, r.add, r.edit, r.delete, ...r.actions].filter((c): c is GridCell => c !== null);
}

/** The cells a menu's module checkbox governs (not the module checkbox itself). */
export const menuCells = (m: GridMenu): GridCell[] => m.resources.flatMap(resourceCells);

/** Every cell of the grid, module checkboxes included. */
export function allCells(grid: RoleMenuGrid): GridCell[] {
  return grid.menus.flatMap((m) => [...(m.access ? [m.access] : []), ...menuCells(m)]);
}

/** The ticked codes as the server sent them. */
export const grantedCodes = (grid: RoleMenuGrid) => new Set(allCells(grid).filter((c) => c.granted).map((c) => c.code));

/**
 * Codes the user can change through at least one box. A box's own `editable` decides whether that box is enabled
 * (see cellDisabled); a shared code still moves as one, so a tick made in an editable box also shows in a read-only
 * box of the same code. The backend has the last word on the save. A read-only grid has none.
 */
export function editableCodes(grid: RoleMenuGrid): Set<string> {
  if (!grid.editable) return new Set();
  return new Set(allCells(grid).filter((c) => c.editable).map((c) => c.code));
}

/** How many boxes show each code. */
export function codeUsage(grid: RoleMenuGrid): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of allCells(grid)) out.set(c.code, (out.get(c.code) ?? 0) + 1);
  return out;
}

/** The module checkbox is unticked. A menu without one (access null) needs no permission and is never off. */
export const isMenuOff = (m: GridMenu, selected: ReadonlySet<string>) => m.access !== null && !selected.has(m.access.code);

/**
 * Ticks or unticks a code, returning the new selection; a code that can't be changed returns the same set.
 *
 * Ticking changes that code only: re-ticking a module never grants what it had before. Unticking a code that is
 * a module checkbox unticks the rest of that menu, and because shared codes move as one, that is every menu
 * using the code as its module checkbox, and onward through any module code unticked on the way. Read-only
 * codes stay as they are: the backend refuses changes the user may not make.
 */
export function setPermission(grid: RoleMenuGrid, selected: ReadonlySet<string>, code: string, checked: boolean): ReadonlySet<string> {
  if (!editableCodes(grid).has(code) || selected.has(code) === checked) return selected;
  const next = new Set(selected);
  if (checked) return next.add(code);
  next.delete(code);
  const queue = [code];
  while (queue.length) {
    const off = queue.pop();
    for (const menu of grid.menus) {
      if (menu.access?.code !== off) continue;
      for (const cell of menuCells(menu)) {
        if (cell.editable && next.delete(cell.code)) queue.push(cell.code);
      }
    }
  }
  return next;
}

/** Every code a menu shows, module checkbox included. */
const menuCodes = (m: GridMenu) => new Set([...(m.access ? [m.access.code] : []), ...menuCells(m).map((c) => c.code)]);

export interface RemovedPermission {
  code: string;
  /** Other modules showing this code. */
  modules: string[];
}
/** What unticking a code would do, so a change reaching other modules can be confirmed first. */
export interface RemovalImpact {
  code: string;
  /** The module the user unticked it in. */
  origin: string;
  /** The selection if confirmed. */
  next: ReadonlySet<string>;
  /** The unticked code first, then everything that goes with it. */
  removed: RemovedPermission[];
  /** Other modules losing at least one permission. Empty = nothing outside the origin changes. */
  affected: string[];
  /** Of those, the ones whose module checkbox gets unticked. */
  closed: string[];
}

/** The effect of unticking `code` from `origin`, or null if it can't be unticked. Changes nothing. */
export function removalImpact(grid: RoleMenuGrid, selected: ReadonlySet<string>, code: string, origin: GridMenu): RemovalImpact | null {
  const next = setPermission(grid, selected, code, false);
  if (next === selected) return null;
  const others = grid.menus.filter((m) => m.menuKey !== origin.menuKey).map((menu) => ({ menu, codes: menuCodes(menu) }));
  const gone = [...selected].filter((c) => !next.has(c)).sort((a, b) => Number(b === code) - Number(a === code) || a.localeCompare(b));
  return {
    code,
    origin: origin.title,
    next,
    removed: gone.map((c) => ({ code: c, modules: others.filter((o) => o.codes.has(c)).map((o) => o.menu.title) })),
    affected: others.filter((o) => gone.some((c) => o.codes.has(c))).map((o) => o.menu.title),
    closed: others.filter(({ menu }) => menu.access !== null && selected.has(menu.access.code) && !next.has(menu.access.code)).map((o) => o.menu.title),
  };
}

/**
 * Whether one box can't be changed now: its own `editable`, or a locked screen. Nothing else: no other cell's flag or
 * tick decides it, and an unticked module doesn't either (it unticks its boxes once, in setPermission, and they stay
 * usable). This departs from the contract's "untick and disable the other boxes", by request.
 */
export function cellDisabled(cell: GridCell, ctx: { locked: boolean }): boolean {
  return ctx.locked || !cell.editable;
}

// ── Cells with no permission code ───────────────────────────────────────────

/**
 * A null cell means the operation isn't mapped for that row, not that a permission is missing from the role. It has
 * no code, and PUT refuses any code that isn't on the grid (400 INVALID_VALUE), so it shows as a disabled empty box:
 * it can't be selected and can't reach the ticked codes, the diff or the save body.
 */
export const unmappedColumns = (r: GridResource) => OPERATIONS.filter((o) => r[o.key] === null);

/** The rows to draw. A menu with no resources gets one row of unmapped cells, so every menu has the same columns. */
export function menuRows(menu: GridMenu): GridResource[] {
  return menu.resources.length ? menu.resources : [{ label: menu.title, view: null, add: null, edit: null, delete: null, actions: [] }];
}

/** Whether any row of the grid has an unmapped cell, which is when the explanation is shown. */
export const hasUnmappedCells = (grid: RoleMenuGrid) => grid.menus.some((m) => menuRows(m).some((r) => unmappedColumns(r).length > 0));

// ── Saving ──────────────────────────────────────────────────────────────────

/**
 * PUT body: every ticked code of the grid, once each, read-only ones included (a grid code left out is removed
 * from the role). `otherPermissionCodes` never goes in: the backend keeps those and refuses them in the list.
 */
export function permissionCodesToSave(grid: RoleMenuGrid, selected: ReadonlySet<string>): string[] {
  const codes = new Set(allCells(grid).map((c) => c.code));
  return [...selected].filter((c) => codes.has(c)).sort();
}

export interface PermissionDiff {
  added: string[];
  removed: string[];
  /** Ticked before and after. */
  unchanged: string[];
}

export function diffPermissions(grid: RoleMenuGrid, selected: ReadonlySet<string>): PermissionDiff {
  const before = grantedCodes(grid);
  const after = permissionCodesToSave(grid, selected);
  return { added: after.filter((c) => !before.has(c)), removed: [...before].filter((c) => !selected.has(c)).sort(), unchanged: after.filter((c) => before.has(c)) };
}

export const hasChanges = (d: PermissionDiff) => d.added.length > 0 || d.removed.length > 0;

/** Why the review can't be sent (null = it can). */
export function saveBlock(grid: RoleMenuGrid, selected: ReadonlySet<string>, ctx: { canUpdate: boolean; conflict?: boolean }): string | null {
  if (!hasChanges(diffPermissions(grid, selected))) return "No changes to save.";
  if (ctx.conflict) return CONFLICT_MESSAGE;
  if (!grid.editable) return "This role's permissions can't be edited.";
  if (!ctx.canUpdate) return "Saving needs role.permission.update.";
  const count = permissionCodesToSave(grid, selected).length;
  if (count > MAX_PERMISSION_CODES) return `At most ${MAX_PERMISSION_CODES} permissions can be saved at once; ${count} are ticked.`;
  return null;
}

// ── Concurrent edits ────────────────────────────────────────────────────────

export const CONFLICT_MESSAGE = "This role's permissions were changed by another administrator. Reload the latest permissions before saving.";

/** A grid's permissions, comparable between two reads: what is ticked and what the grid doesn't show. */
export function permissionState(grid: RoleMenuGrid): string {
  return JSON.stringify([[...grantedCodes(grid)].sort(), [...grid.otherPermissionCodes].sort()]);
}

/**
 * `unconfirmed`: codes where the saved response disagrees with what was sent (not granted though sent, or granted
 * though not sent). Empty means the server confirmed the save.
 */
export type SaveOutcome = { status: "saved"; dto: RoleMenuPermissionsDto; unconfirmed: string[] } | { status: "conflict" };

/** The codes a saved grid disagrees on. A grid of another tenant or role confirms nothing. */
export function unconfirmedCodes(sent: readonly string[], dto: RoleMenuPermissionsDto, expected: { tenantId: number | null; roleId: number }): string[] {
  const saved = readGrid(dto);
  if (gridMismatch(saved, expected)) return [...sent];
  const granted = grantedCodes(saved);
  const asked = new Set(sent);
  return [...sent.filter((c) => !granted.has(c)), ...[...granted].filter((c) => !asked.has(c))].sort();
}

/**
 * Saves only if the role still has the permissions the edits started from, so a newer change isn't overwritten.
 * The API has no version, timestamp or conditional request, so this is a read just before the write: a change
 * landing between the two is still overwritten. A failed read rejects without saving.
 */
export async function saveIfUnchanged(
  base: RoleMenuGrid,
  selected: ReadonlySet<string>,
  expected: { tenantId: number | null; roleId: number },
  api: { getMatrix(roleId: number): Promise<RoleMenuPermissionsDto>; saveMatrix(roleId: number, permissionCodes: string[]): Promise<RoleMenuPermissionsDto> }
): Promise<SaveOutcome> {
  const latest = readGrid(await api.getMatrix(expected.roleId));
  const mismatch = gridMismatch(latest, expected);
  if (mismatch) throw new Error(mismatch);
  if (permissionState(latest) !== permissionState(base)) return { status: "conflict" };
  const sent = permissionCodesToSave(latest, selected);
  const dto = await api.saveMatrix(expected.roleId, sent);
  return { status: "saved", dto, unconfirmed: unconfirmedCodes(sent, dto, expected) };
}

// ── Search ──────────────────────────────────────────────────────────────────

/** Menus matching on title, resource label or code. A matching menu keeps all its rows. */
export function filterMenus(menus: readonly GridMenu[], query: string): GridMenu[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...menus];
  const hit = (s: string) => s.toLowerCase().includes(q);
  return menus.filter((m) => hit(m.title) || m.resources.some((r) => hit(r.label) || r.actions.some((a) => hit(a.label))) || [...(m.access ? [m.access] : []), ...menuCells(m)].some((c) => hit(c.code)));
}

// ── Errors ──────────────────────────────────────────────────────────────────

const ERROR_TITLES: Record<string, string> = {
  TENANT_REQUIRED: "Select a tenant first",
  INVALID_TENANT: "This tenant can't be used",
  TENANT_ACCESS_DENIED: "This tenant isn't available to your account",
  PROTECTED_ROLE: "This role can't be edited",
  VALIDATION_FAILED: "The server rejected the permission list",
  INVALID_VALUE: "The server rejected a permission",
  FORBIDDEN: "You don't have permission to do this",
  NOT_FOUND: "This role no longer exists",
  UNAUTHENTICATED: "Your session has ended",
};

const CODE_FOR_STATUS: Record<number, string> = { 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND" };

/** A heading for the failure, the server's own message (with its field errors), and the reference to quote. */
export function matrixError(err: unknown): { title: string; detail: string; meta: string | null } {
  const code = isApiError(err) ? (err.errorCode ?? (err.kind === "http" ? CODE_FOR_STATUS[err.status] : undefined)) : undefined;
  const fields = isApiError(err) ? err.fieldErrors.map((f) => `${f.field}: ${f.message}`) : [];
  return {
    title: (code && ERROR_TITLES[code]) || "The server refused the change",
    detail: [describeApiError(err), ...fields].join(" "),
    meta: apiErrorMeta(err) || null,
  };
}
