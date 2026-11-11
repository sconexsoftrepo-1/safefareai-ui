"use client";

import { useState } from "react";
import { CircleCheck, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operationsService } from "@/features/drive-vision/api/operations-service";
import type { LeaveDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField } from "../shared/form-field";
import { ApiErrorState } from "../shared/api-states";
import { LoadingSkeleton } from "../shared/feedback";
import { toast } from "../shared/toast-provider";
import { usePickers } from "./use-pickers";
import { assessLeave, describePlan, describeStep, planBlocks, runSwapAndApprove, type SwapApproveResult } from "./leave-swap-workflow";

/**
 * Swap & Approve for a PENDING leave with affected dispatches (leave-swap-workflow.ts). Before anything is written the
 * dialog shows each dispatch's current state; an in-progress dispatch disables the action (retry after the trip is
 * completed). After a failed run the dialog stays open with what happened, and the leave stays PENDING.
 */
export function LeaveSwapDialog({ leave, onOpenChange, onDone }: { leave: LeaveDto | null; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const open = leave !== null;
  const [toDriver, setToDriver] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Exclude<SwapApproveResult, { status: "approved" }> | null>(null);
  const pickers = usePickers(open);
  const assessQ = useApiQuery(leave?.id !== undefined ? `leave:swap-assess:${leave.id}` : null, () => assessLeave(leave!, operationsService));
  const plans = assessQ.data ?? [];
  const blocked = plans.some(planBlocks);

  const reset = () => (setToDriver(""), setNote(""), setResult(null));

  async function run() {
    if (!leave) return;
    let res: SwapApproveResult;
    try {
      res = await runSwapAndApprove({ leave, toDriverId: Number(toDriver), note }, operationsService);
    } catch (err) {
      toast.error("Swap & Approve didn't start", { description: err instanceof Error ? err.message : undefined });
      throw err;
    }
    if (res.status === "approved") {
      toast.success("Dispatches reassigned and leave approved", { description: `${res.steps.filter((s) => s.outcome === "reassigned").length} dispatch(es) reassigned.${res.leave.status ? ` Server status: ${res.leave.status}` : ""}` });
      reset();
      onDone();
      return;
    }
    setResult(res);
    assessQ.refetch();
    toast.error(res.status === "blocked" ? "Leave not approved: a dispatch can't be reassigned now" : res.status === "partial" ? "Leave not approved: a dispatch swap failed" : "Dispatches reassigned, but the leave approval failed", {
      description: "The leave request is still pending.",
    });
    throw new Error(res.status);
  }

  const lines = result && result.status !== "blocked" ? result.steps.map((s) => ({ key: s.dispatchId, text: describeStep(s), bad: s.outcome === "failed" })) : plans.map((p) => ({ key: p.dispatchId, text: describePlan(p), bad: planBlocks(p) }));

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && (reset(), onOpenChange(false))}
      title="Swap & Approve"
      description={
        leave
          ? `${leave.driverName ?? `Driver ${leave.driverId}`} · ${leave.leaveType ?? ""} · ${leave.startDate ?? "?"} – ${leave.endDate ?? "?"}. Each affected dispatch is reassigned through a swap request first; the leave is approved only when all of them are confirmed reassigned. Dispatches are handled one by one — not as a single transaction.`
          : undefined
      }
      confirmLabel={result ? "Retry" : "Swap & Approve"}
      confirmDisabled={!toDriver || blocked || assessQ.loading || assessQ.refreshing || !!assessQ.error || note.length > 500}
      onConfirm={run}
    >
      <div className="space-y-3" data-testid="leave-swap-dialog">
        {assessQ.error ? (
          <ApiErrorState error={assessQ.error} onRetry={assessQ.refetch} compact title="Couldn't check the dispatches" />
        ) : assessQ.loading ? (
          <LoadingSkeleton variant="list" rows={2} />
        ) : (
          <ul className="space-y-1.5 text-[13px]" data-testid="leave-swap-plan">
            {lines.map((l) => (
              <li key={l.key} className={cn("flex items-start gap-1.5", l.bad ? "text-danger" : "text-ink")} data-bad={l.bad ? "true" : undefined}>
                {l.bad ? <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />}
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
        {result?.status === "leave_failed" ? <p className="text-[13px] text-danger">Leave approval failed: {result.message}</p> : null}
        {blocked ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-inner bg-warning-soft px-3 py-2 text-[13px] text-ink" data-testid="leave-swap-blocked">
            <span>The leave stays pending. Try again after the trip is completed.</span>
            <Button size="sm" variant="outline" onClick={assessQ.refetch} disabled={assessQ.refreshing}>
              {assessQ.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
            </Button>
          </div>
        ) : null}
        <FormField id="lsw-to" label="Replacement driver" required>
          <Select value={toDriver} onValueChange={setToDriver}>
            <SelectTrigger id="lsw-to" className="w-full">
              <SelectValue placeholder={pickers.loading ? "Loading drivers…" : "Choose a driver"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {pickers.drivers
                .filter((o) => o.value !== String(leave?.driverId))
                .map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="lsw-note" label="Note (optional)" error={note.length > 500 ? "Use 500 characters or fewer." : undefined}>
          <Textarea id="lsw-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </div>
    </ConfirmDialog>
  );
}
