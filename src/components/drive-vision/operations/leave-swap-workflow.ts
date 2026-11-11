import { isApiError } from "@/features/drive-vision/api/errors";
import type { DecisionRequest, DispatchDto, LeaveDto, SwapCreateRequest, SwapRequestDto } from "@/features/drive-vision/api/types";

/**
 * Workforce → Leave "Swap & Approve": reassign every dispatch a pending leave affects, then approve the leave.
 * Pure orchestration over the existing endpoints (the service is injected, so it is unit-tested):
 *
 *   GET  /dispatches/{id}                    current status, driver and pendingSwapRequestId (fresh, never the list row)
 *   POST /dispatches/{id}/swap-requests      only when the dispatch has no pending swap request
 *   POST /swap-requests/{swapId}/approve     the swap request's id (never the leave id), with the replacement driver
 *   GET  /dispatches/{id}                    confirms the dispatch left the driver on leave
 *   POST /leave-requests/{leaveId}/approve   only after every affected dispatch was confirmed reassigned
 *
 * The backend has no multi-dispatch transaction, so this is NOT atomic: dispatches are handled one at a time, the
 * run stops at the first failure, the leave stays PENDING, and what already happened is reported. A retry re-reads
 * every dispatch: one already reassigned is skipped, one with a pending swap request has that request approved
 * instead of a new one being created. An in-progress dispatch blocks the whole run before anything is written; it is
 * never reassigned, cancelled or retried automatically. A 409 from the server is shown with its own message.
 */

export interface LeaveSwapService {
  getDispatch(id: number): Promise<DispatchDto>;
  requestSwap(id: number, body: SwapCreateRequest): Promise<SwapRequestDto>;
  decideSwap(id: number, decision: "approve" | "reject", body: DecisionRequest): Promise<SwapRequestDto>;
  decideLeave(id: number, decision: "approve" | "reject", body: DecisionRequest): Promise<LeaveDto>;
}

const upper = (s: string | undefined | null) => (s ?? "").trim().toUpperCase();
const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Running trips: the server refuses to reassign them (409 OPERATION_NOT_ALLOWED). STARTED is the app's synonym. */
export const isDispatchInProgress = (d: Pick<DispatchDto, "status"> | undefined) => ["IN_PROGRESS", "STARTED"].includes(upper(d?.status));
/** Finished dispatches need no replacement driver. */
export const isDispatchClosed = (d: Pick<DispatchDto, "status"> | undefined) => ["COMPLETED", "CANCELLED", "CANCELED"].includes(upper(d?.status));
export const isLeavePending = (l: Pick<LeaveDto, "status">) => upper(l.status) === "PENDING";

/** The leave row's actions: decisions only while PENDING; Swap & Approve instead of Approve when dispatches are affected. */
export function leaveActions(l: Pick<LeaveDto, "status" | "affectedDispatchIds">): "none" | "approve" | "swap_approve" {
  if (!isLeavePending(l)) return "none";
  return (l.affectedDispatchIds?.length ?? 0) > 0 ? "swap_approve" : "approve";
}

/** Dispatch drawer: can a new swap be requested? */
export function dispatchSwapState(d: Pick<DispatchDto, "status" | "pendingSwapRequestId">): { kind: "eligible" } | { kind: "pending"; swapRequestId: number } | { kind: "in_progress" } {
  if (has(d.pendingSwapRequestId)) return { kind: "pending", swapRequestId: d.pendingSwapRequestId };
  if (isDispatchInProgress(d)) return { kind: "in_progress" };
  return { kind: "eligible" };
}

export const IN_PROGRESS_MESSAGE = "This dispatch is in progress, so it can't be reassigned until the trip is completed.";

export type DispatchPlan =
  | { dispatchId: number; kind: "reassign"; dispatch: DispatchDto }
  | { dispatchId: number; kind: "approve_pending"; swapRequestId: number; dispatch: DispatchDto }
  | { dispatchId: number; kind: "in_progress"; dispatch: DispatchDto }
  | { dispatchId: number; kind: "already_reassigned"; dispatch: DispatchDto }
  | { dispatchId: number; kind: "closed"; dispatch: DispatchDto }
  | { dispatchId: number; kind: "unreadable"; message: string };

/** What has to happen to one dispatch. Decided from its current server state, never assumed. */
export function planDispatch(dispatchId: number, d: DispatchDto, leaveDriverId: number | undefined): DispatchPlan {
  if (isDispatchClosed(d)) return { dispatchId, kind: "closed", dispatch: d };
  if (has(d.driverId) && has(leaveDriverId) && d.driverId !== leaveDriverId) return { dispatchId, kind: "already_reassigned", dispatch: d };
  if (isDispatchInProgress(d)) return { dispatchId, kind: "in_progress", dispatch: d };
  if (has(d.pendingSwapRequestId)) return { dispatchId, kind: "approve_pending", swapRequestId: d.pendingSwapRequestId, dispatch: d };
  return { dispatchId, kind: "reassign", dispatch: d };
}

export const planBlocks = (p: DispatchPlan) => p.kind === "in_progress" || p.kind === "unreadable";
export const planNeedsWork = (p: DispatchPlan) => p.kind === "reassign" || p.kind === "approve_pending";

const errorText = (err: unknown) => (isApiError(err) ? err.message || `HTTP ${err.status}` : err instanceof Error ? err.message : "Unexpected error");
const isConflict = (err: unknown) => isApiError(err) && err.status === 409;

/** Reads every affected dispatch (sequentially, in the leave's order). A failed read is "unreadable", which blocks. */
export async function assessLeave(leave: Pick<LeaveDto, "driverId" | "affectedDispatchIds">, service: Pick<LeaveSwapService, "getDispatch">): Promise<DispatchPlan[]> {
  const ids = [...new Set((leave.affectedDispatchIds ?? []).filter(has))];
  const plans: DispatchPlan[] = [];
  for (const id of ids) {
    try {
      plans.push(planDispatch(id, await service.getDispatch(id), leave.driverId));
    } catch (err) {
      plans.push({ dispatchId: id, kind: "unreadable", message: errorText(err) });
    }
  }
  return plans;
}

export type StepResult =
  | { dispatchId: number; outcome: "reassigned"; swapRequestId: number; created: boolean }
  | { dispatchId: number; outcome: "skipped"; reason: "already_reassigned" | "closed" }
  | { dispatchId: number; outcome: "failed"; swapRequestId: number | null; conflict: boolean; message: string }
  | { dispatchId: number; outcome: "not_attempted" };

export type SwapApproveResult =
  /** Nothing written: an affected dispatch is in progress or couldn't be read. Leave still PENDING. */
  | { status: "blocked"; plans: DispatchPlan[] }
  /** Some dispatch failed (409 or otherwise); earlier ones may have been reassigned. Leave NOT approved. */
  | { status: "partial"; plans: DispatchPlan[]; steps: StepResult[] }
  /** Every dispatch reassigned, but the leave approval itself failed. Leave still PENDING; a retry only approves. */
  | { status: "leave_failed"; plans: DispatchPlan[]; steps: StepResult[]; message: string; conflict: boolean }
  | { status: "approved"; plans: DispatchPlan[]; steps: StepResult[]; leave: LeaveDto };

export interface SwapApproveInput {
  leave: Pick<LeaveDto, "id" | "driverId" | "affectedDispatchIds" | "status">;
  /** Replacement driver for every affected dispatch. */
  toDriverId: number;
  note?: string;
}

export async function runSwapAndApprove({ leave, toDriverId, note }: SwapApproveInput, service: LeaveSwapService): Promise<SwapApproveResult> {
  if (!has(leave.id)) throw new Error("Leave request without an id");
  if (!has(toDriverId) || toDriverId === leave.driverId) throw new Error("Choose a replacement driver other than the driver on leave");
  const trimmed = note?.trim() || undefined;

  // 1. Fresh state of every dispatch. Anything in progress or unreadable: stop before writing anything.
  const plans = await assessLeave(leave, service);
  if (plans.some(planBlocks)) return { status: "blocked", plans };

  // 2. One dispatch at a time; stop at the first failure.
  const steps: StepResult[] = [];
  let failed = false;
  for (const plan of plans) {
    if (failed) {
      steps.push({ dispatchId: plan.dispatchId, outcome: "not_attempted" });
      continue;
    }
    if (plan.kind === "already_reassigned" || plan.kind === "closed") {
      steps.push({ dispatchId: plan.dispatchId, outcome: "skipped", reason: plan.kind });
      continue;
    }
    if (plan.kind !== "reassign" && plan.kind !== "approve_pending") continue;
    let swapRequestId: number | null = plan.kind === "approve_pending" ? plan.swapRequestId : null;
    const created = plan.kind === "reassign";
    try {
      if (swapRequestId === null) {
        const swap = await service.requestSwap(plan.dispatchId, { toDriverId, reason: `Driver on leave (leave request #${leave.id})` });
        if (!has(swap.id)) throw new Error("The server created no swap request id, so the swap can't be approved.");
        swapRequestId = swap.id;
      }
      await service.decideSwap(swapRequestId, "approve", { toDriverId, ...(trimmed ? { note: trimmed } : {}) });
      // An approved request is not proof of a reassignment: confirm on the dispatch itself.
      const after = await service.getDispatch(plan.dispatchId);
      const reassigned = has(after.driverId) && after.driverId !== leave.driverId;
      if (!reassigned) throw new Error("The swap was approved, but the dispatch is still assigned to the driver on leave.");
      steps.push({ dispatchId: plan.dispatchId, outcome: "reassigned", swapRequestId, created });
    } catch (err) {
      failed = true;
      steps.push({ dispatchId: plan.dispatchId, outcome: "failed", swapRequestId, conflict: isConflict(err), message: errorText(err) });
    }
  }
  if (failed) return { status: "partial", plans, steps };

  // 3. Every affected dispatch is confirmed off the driver on leave: approve the leave (the leave id).
  try {
    const approved = await service.decideLeave(leave.id, "approve", trimmed ? { note: trimmed } : {});
    return { status: "approved", plans, steps, leave: approved };
  } catch (err) {
    return { status: "leave_failed", plans, steps, message: errorText(err), conflict: isConflict(err) };
  }
}

/** One plain-language line per dispatch for the dialog, before and after a run. */
export function describePlan(p: DispatchPlan): string {
  switch (p.kind) {
    case "reassign":
      return `Dispatch #${p.dispatchId}: a swap request will be created and approved.`;
    case "approve_pending":
      return `Dispatch #${p.dispatchId}: has pending swap request #${p.swapRequestId}; it will be approved (no new request).`;
    case "in_progress":
      return `Dispatch #${p.dispatchId} is in progress and can't be reassigned until the trip is completed.`;
    case "already_reassigned":
      return `Dispatch #${p.dispatchId}: already assigned to ${p.dispatch.driverName ?? `driver ${p.dispatch.driverId}`}; nothing to do.`;
    case "closed":
      return `Dispatch #${p.dispatchId}: ${(p.dispatch.status ?? "").toLowerCase()}; nothing to do.`;
    case "unreadable":
      return `Dispatch #${p.dispatchId} couldn't be checked: ${p.message}`;
  }
}

export function describeStep(s: StepResult): string {
  switch (s.outcome) {
    case "reassigned":
      return `Dispatch #${s.dispatchId}: reassigned (swap request #${s.swapRequestId}${s.created ? ", created now" : ", already pending"}).`;
    case "skipped":
      return `Dispatch #${s.dispatchId}: ${s.reason === "closed" ? "closed" : "already reassigned"}; nothing done.`;
    case "failed":
      return `Dispatch #${s.dispatchId}: ${s.conflict ? "blocked by the server" : "failed"} — ${s.message}${s.swapRequestId !== null ? ` (swap request #${s.swapRequestId} remains; a retry reuses it)` : ""}`;
    case "not_attempted":
      return `Dispatch #${s.dispatchId}: not attempted.`;
  }
}
