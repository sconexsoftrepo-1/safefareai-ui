// Workforce → Leave "Swap & Approve" and the dispatch drawer's swap rules. MOCKED ONLY: a stateful fake of the
// dispatch / swap / leave endpoints (behaviour as described in the brief: 409 OPERATION_NOT_ALLOWED for IN_PROGRESS).
// Dispatch 277 IN_PROGRESS is the brief's example; every other record is synthetic.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const realm = createRealm({ process: { env: {} }, URL });
const wf = () => realm.require("components/drive-vision/operations/leave-swap-workflow");
const { ApiError } = realm.require("features/drive-vision/api/errors");

const LEAVE_DRIVER = 11;
const NEW_DRIVER = 22;
const conflict = (path, message) => new ApiError({ kind: "http", status: 409, errorCode: "OPERATION_NOT_ALLOWED", message, method: "POST", path });

/** Fake backend: swap approve reassigns the dispatch; IN_PROGRESS dispatches answer 409 like the real server. */
function backend(dispatches, opts = {}) {
  const state = { dispatches: structuredClone(dispatches), swaps: new Map(), nextSwap: 900, leaves: new Map([[5, { id: 5, status: "PENDING" }]]) };
  const calls = [];
  const svc = {
    async getDispatch(id) {
      calls.push(`GET /dispatches/${id}`);
      if (opts.unreadable === id) throw new ApiError({ kind: "http", status: 404, message: "Dispatch not found", method: "GET", path: `/dispatches/${id}` });
      const d = state.dispatches[id];
      return { ...d };
    },
    async requestSwap(id, body) {
      calls.push(`POST /dispatches/${id}/swap-requests ${JSON.stringify(body)}`);
      const d = state.dispatches[id];
      if (d.status === "IN_PROGRESS") throw conflict(`/dispatches/${id}/swap-requests`, "A dispatch that is IN_PROGRESS cannot be reassigned.");
      if (opts.createConflict === id) throw conflict(`/dispatches/${id}/swap-requests`, "A swap request is already pending for this dispatch.");
      const swap = { id: state.nextSwap++, dispatchId: id, status: "PENDING", toDriverId: body.toDriverId };
      state.swaps.set(swap.id, swap);
      d.pendingSwapRequestId = swap.id;
      return { ...swap };
    },
    async decideSwap(id, decision, body) {
      calls.push(`POST /swap-requests/${id}/${decision} ${JSON.stringify(body)}`);
      const swap = state.swaps.get(id);
      if (!swap) throw new ApiError({ kind: "http", status: 404, message: "Swap request not found", method: "POST", path: `/swap-requests/${id}/${decision}` });
      if (opts.approveFails === swap.dispatchId && !opts.approveFailed) {
        opts.approveFailed = true;
        throw new ApiError({ kind: "http", status: 500, message: "Internal error", method: "POST", path: `/swap-requests/${id}/${decision}` });
      }
      const d = state.dispatches[swap.dispatchId];
      if (d.status === "IN_PROGRESS") throw conflict(`/swap-requests/${id}/approve`, "A dispatch that is IN_PROGRESS cannot be reassigned.");
      swap.status = "APPROVED";
      if (!opts.approveDoesNotReassign) d.driverId = body.toDriverId ?? swap.toDriverId;
      d.pendingSwapRequestId = null;
      return { ...swap };
    },
    async decideLeave(id, decision, body) {
      calls.push(`POST /leave-requests/${id}/${decision} ${JSON.stringify(body)}`);
      if (opts.leaveConflict) throw conflict(`/leave-requests/${id}/${decision}`, "Leave request is not pending.");
      const l = state.leaves.get(id);
      l.status = decision === "approve" ? "APPROVED" : "REJECTED";
      return { ...l };
    },
  };
  return { svc, calls, state };
}
const dispatch = (id, patch = {}) => ({ id, status: "ASSIGNED", driverId: LEAVE_DRIVER, driverName: "Driver on leave", pendingSwapRequestId: null, ...patch });
const leave = (ids) => ({ id: 5, driverId: LEAVE_DRIVER, status: "PENDING", affectedDispatchIds: ids });
const writes = (calls) => calls.filter((c) => c.startsWith("POST"));

test("LS actions: PENDING without dispatches → Reject + Approve; with dispatches → Reject + Swap & Approve; decided → none", () => {
  const { leaveActions } = wf();
  same([leaveActions({ status: "PENDING", affectedDispatchIds: [] }), leaveActions({ status: "PENDING" }), leaveActions({ status: "pending", affectedDispatchIds: [277] })], ["approve", "approve", "swap_approve"]);
  same([leaveActions({ status: "APPROVED", affectedDispatchIds: [277] }), leaveActions({ status: "REJECTED" }), leaveActions({})], ["none", "none", "none"]);
  const page = read("components/drive-vision/operations/workforce-page.tsx");
  assert.match(page, /const actions = leaveActions\(l\);/);
  assert.match(page, /actions === "approve" \? \([\s\S]*?Approve[\s\S]*?Swap &amp; Approve/, "Approve or Swap & Approve, never both");
  assert.match(page, /disabled=\{!canSwap\}/, "Swap & Approve also needs dispatch.update and swaps.decide");
  assert.match(page, /const canDecide = useCan\("leave\.decide"\);/, "existing leave permission kept");
});

test("LS dispatch drawer: Request swap only when eligible; pending swap shows its request id; IN_PROGRESS disabled with the reason", () => {
  const { dispatchSwapState } = wf();
  same(dispatchSwapState({ status: "ASSIGNED", pendingSwapRequestId: null }), { kind: "eligible" });
  same(dispatchSwapState({ status: "ACCEPTED" }), { kind: "eligible" });
  same(dispatchSwapState({ status: "ASSIGNED", pendingSwapRequestId: 41 }), { kind: "pending", swapRequestId: 41 });
  same(dispatchSwapState({ status: "IN_PROGRESS", pendingSwapRequestId: null }), { kind: "in_progress" });
  const page = read("components/drive-vision/operations/dispatch-page.tsx");
  assert.match(page, /if \(pending\.kind === "swap" && swapState\?\.kind !== "eligible"\) return;/, "no request is sent for a pending or in-progress dispatch");
  assert.match(page, /swapState\?\.kind === "in_progress" \? \(\s*<Button variant="outline" disabled title=\{IN_PROGRESS_MESSAGE\}/);
  assert.match(page, /Swap pending · request #\{swapState\.swapRequestId\}/);
  assert.match(page, /const canUpdate = useCan\("dispatch\.update"\);/, "existing dispatch permission kept");
});

test("LS zero affected dispatches: nothing to reassign, the leave is approved directly (no dispatch calls)", async () => {
  const { svc, calls } = backend({});
  const res = await wf().runSwapAndApprove({ leave: leave([]), toDriverId: NEW_DRIVER }, svc);
  same([res.status, res.leave.status], ["approved", "APPROVED"]);
  same(calls, ["POST /leave-requests/5/approve {}"]);
});

test("LS eligible dispatches: each gets a swap request, it is approved with the swap id, the reassignment is confirmed, then the leave is approved", async () => {
  const { svc, calls, state } = backend({ 301: dispatch(301), 302: dispatch(302) });
  const res = await wf().runSwapAndApprove({ leave: leave([301, 302]), toDriverId: NEW_DRIVER, note: " cover " }, svc);
  assert.equal(res.status, "approved");
  same(calls, [
    "GET /dispatches/301",
    "GET /dispatches/302",
    'POST /dispatches/301/swap-requests {"toDriverId":22,"reason":"Driver on leave (leave request #5)"}',
    'POST /swap-requests/900/approve {"toDriverId":22,"note":"cover"}',
    "GET /dispatches/301",
    'POST /dispatches/302/swap-requests {"toDriverId":22,"reason":"Driver on leave (leave request #5)"}',
    'POST /swap-requests/901/approve {"toDriverId":22,"note":"cover"}',
    "GET /dispatches/302",
    'POST /leave-requests/5/approve {"note":"cover"}',
  ], "swap ids (900, 901) go to the swap endpoints; the leave id (5) only to the leave endpoint");
  same([state.dispatches[301].driverId, state.dispatches[302].driverId, state.leaves.get(5).status], [NEW_DRIVER, NEW_DRIVER, "APPROVED"]);
  same(res.steps.map((s) => [s.dispatchId, s.outcome, s.swapRequestId, s.created]), [[301, "reassigned", 900, true], [302, "reassigned", 901, true]]);
});

test("LS IN_PROGRESS dispatch (277): nothing is written — no swap request, no approval, no cancel; leave stays PENDING and the dispatch is named", async () => {
  const { svc, calls, state } = backend({ 277: dispatch(277, { status: "IN_PROGRESS" }), 301: dispatch(301) });
  const res = await wf().runSwapAndApprove({ leave: leave([301, 277]), toDriverId: NEW_DRIVER }, svc);
  assert.equal(res.status, "blocked");
  same(writes(calls), [], "no POST at all");
  assert.equal(state.leaves.get(5).status, "PENDING");
  const blocked = res.plans.filter(wf().planBlocks);
  same(blocked.map((p) => [p.dispatchId, p.kind]), [[277, "in_progress"]]);
  assert.equal(wf().describePlan(blocked[0]), "Dispatch #277 is in progress and can't be reassigned until the trip is completed.");
  same(Object.keys(svc).filter((k) => /cancel/i.test(k)), [], "the workflow has no way to cancel a trip");
});

test("LS dispatch with a pending swap request: approved by its swap id, no duplicate request is created", async () => {
  const { svc, calls, state } = backend({ 301: dispatch(301, { pendingSwapRequestId: 41 }) });
  state.swaps.set(41, { id: 41, dispatchId: 301, status: "PENDING" });
  const plans = await wf().assessLeave(leave([301]), svc);
  same(plans.map((p) => [p.kind, p.swapRequestId]), [["approve_pending", 41]]);
  const res = await wf().runSwapAndApprove({ leave: leave([301]), toDriverId: NEW_DRIVER }, svc);
  assert.equal(res.status, "approved");
  assert.ok(!calls.some((c) => c.includes("/swap-requests {")), "no POST /dispatches/{id}/swap-requests");
  assert.ok(calls.includes('POST /swap-requests/41/approve {"toDriverId":22}'));
});

test("LS swap endpoint 409: blocked operation with the server's message; not retried; leave not approved", async () => {
  const { svc, calls, state } = backend({ 301: dispatch(301) }, { createConflict: 301 });
  const res = await wf().runSwapAndApprove({ leave: leave([301]), toDriverId: NEW_DRIVER }, svc);
  assert.equal(res.status, "partial");
  same(res.steps, [{ dispatchId: 301, outcome: "failed", swapRequestId: null, conflict: true, message: "A swap request is already pending for this dispatch." }]);
  assert.equal(calls.filter((c) => c.startsWith("POST /dispatches/301/swap-requests")).length, 1, "no automatic retry");
  assert.ok(!calls.some((c) => c.includes("/leave-requests/")), "never approve leave after a 409");
  assert.equal(state.leaves.get(5).status, "PENDING");
  assert.match(wf().describeStep(res.steps[0]), /blocked by the server — A swap request is already pending/);
});

test("LS status turns IN_PROGRESS between check and swap: the server's 409 stops the run and the leave stays PENDING", async () => {
  const b = backend({ 301: dispatch(301) });
  const get = b.svc.getDispatch;
  let first = true;
  b.svc.getDispatch = async (id) => {
    const d = await get(id);
    if (first) {
      first = false;
      b.state.dispatches[301].status = "IN_PROGRESS";
    }
    return d;
  };
  const res = await wf().runSwapAndApprove({ leave: leave([301]), toDriverId: NEW_DRIVER }, b.svc);
  same([res.status, res.steps[0].conflict, res.steps[0].message], ["partial", true, "A dispatch that is IN_PROGRESS cannot be reassigned."]);
  assert.equal(b.state.leaves.get(5).status, "PENDING");
});

test("LS several dispatches, one fails: earlier progress reported, later ones not attempted, leave PENDING; the retry reuses the swap request and then approves", async () => {
  const opts = { approveFails: 302 };
  const b = backend({ 301: dispatch(301), 302: dispatch(302), 303: dispatch(303) }, opts);
  const res = await wf().runSwapAndApprove({ leave: leave([301, 302, 303]), toDriverId: NEW_DRIVER }, b.svc);
  assert.equal(res.status, "partial");
  same(res.steps.map((s) => [s.dispatchId, s.outcome]), [[301, "reassigned"], [302, "failed"], [303, "not_attempted"]]);
  same(res.steps[1].swapRequestId, 901, "the created-but-unapproved request is reported");
  assert.equal(b.state.leaves.get(5).status, "PENDING");
  assert.ok(!b.calls.some((c) => c.includes("/leave-requests/")));
  assert.match(wf().describeStep(res.steps[1]), /swap request #901 remains; a retry reuses it/);

  b.calls.length = 0;
  const retry = await wf().runSwapAndApprove({ leave: leave([301, 302, 303]), toDriverId: NEW_DRIVER }, b.svc);
  assert.equal(retry.status, "approved");
  same(retry.steps.map((s) => [s.dispatchId, s.outcome]), [[301, "skipped"], [302, "reassigned"], [303, "reassigned"]]);
  same(b.calls.filter((c) => c.startsWith("POST /dispatches/")).map((c) => c.split(" ")[1]), ["/dispatches/303/swap-requests"], "no duplicate for 301 (done) or 302 (pending #901 approved)");
  assert.ok(b.calls.includes('POST /swap-requests/901/approve {"toDriverId":22}'));
  assert.equal(b.state.leaves.get(5).status, "APPROVED");
});

test("LS an approved swap that did not reassign the dispatch is not treated as done; leave stays PENDING", async () => {
  const b = backend({ 301: dispatch(301) }, { approveDoesNotReassign: true });
  const res = await wf().runSwapAndApprove({ leave: leave([301]), toDriverId: NEW_DRIVER }, b.svc);
  same([res.status, res.steps[0].outcome, res.steps[0].message], ["partial", "failed", "The swap was approved, but the dispatch is still assigned to the driver on leave."]);
  assert.equal(b.state.leaves.get(5).status, "PENDING");
});

test("LS unreadable dispatch blocks before writing; completed / already reassigned dispatches need nothing; leave approval failure is reported", async () => {
  let b = backend({ 301: dispatch(301) }, { unreadable: 301 });
  let res = await wf().runSwapAndApprove({ leave: leave([301]), toDriverId: NEW_DRIVER }, b.svc);
  same([res.status, writes(b.calls)], ["blocked", []]);
  b = backend({ 301: dispatch(301, { status: "COMPLETED" }), 302: dispatch(302, { driverId: 33 }) });
  res = await wf().runSwapAndApprove({ leave: leave([301, 302]), toDriverId: NEW_DRIVER }, b.svc);
  same([res.status, writes(b.calls)], ["approved", ["POST /leave-requests/5/approve {}"]]);
  b = backend({ 301: dispatch(301) }, { leaveConflict: true });
  res = await wf().runSwapAndApprove({ leave: leave([301]), toDriverId: NEW_DRIVER }, b.svc);
  same([res.status, res.conflict, res.message], ["leave_failed", true, "Leave request is not pending."]);
  await assert.rejects(wf().runSwapAndApprove({ leave: leave([301]), toDriverId: LEAVE_DRIVER }, b.svc), /replacement driver/, "the driver on leave can't be the replacement");
});

test("LS dialog wiring: the leave is approved only through the workflow; a failed run keeps the dialog open and says the leave is pending", () => {
  const dlg = read("components/drive-vision/operations/leave-swap-dialog.tsx");
  assert.match(dlg, /runSwapAndApprove\(\{ leave, toDriverId: Number\(toDriver\), note \}, operationsService\)/);
  assert.doesNotMatch(dlg, /decideLeave|requestSwap|decideSwap/, "no direct endpoint calls in the dialog");
  assert.match(dlg, /description: "The leave request is still pending\."/);
  assert.match(dlg, /throw new Error\(res\.status\);/, "ConfirmDialog stays open on failure");
  assert.match(dlg, /confirmDisabled=\{!toDriver \|\| blocked/, "blocked (in progress) → action disabled");
  assert.match(dlg, /Try again after the trip is completed\./);
  assert.match(dlg, /not as a single transaction/);
});
