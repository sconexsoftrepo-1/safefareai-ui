"use client";

import { useMemo, useState } from "react";
import { CalendarCheck2, CalendarOff, CheckCircle2, ClipboardCheck, Clock, Gauge, IdCard, ListChecks, Loader2, Pencil, Phone, Play, Plus, Route as RouteIcon, ShieldCheck, Square, TriangleAlert, Truck, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { driverAppService, type DriverDispatchAction } from "@/features/drive-vision/api/driver-app-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { ChecklistItem, ChecklistItemResult, DispatchDto, DriverContactRequest, LeaveDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatDate, formatKm, formatNumber, formatSeconds, formatTime } from "@/features/drive-vision/utils/format";
import { Panel, PanelHeader } from "../shared/panel";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { SlideOverPanel } from "../shared/slide-over-panel";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";
import { PHONE_PATTERN, type Errors } from "../settings/settings-model";
import { EMPTY_LEAVE_FORM, leaveRequestBody, validateLeaveForm, windowAround, type LeaveField, type LeaveForm } from "./operations-model";
import { LeaveFields } from "./workforce-page";
import { TRIP_ACTIONS, countByStatus, groupByCategory, humanize, tripActionAvailability, withheldTripReason, type TripAction } from "./my-work-model";
import { canPerform } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { PasswordPanel } from "../settings/settings-page";
import { CountBars, DriverIdentity, EventRow, FieldGrid, LeaveRow, SectionTitle, ServerStatus, ShiftRow, StatTile, TOUCH, TripSummary, elapsedSince, when } from "./my-work-ui";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

type Pending =
  | { kind: "dispatch"; dispatch: DispatchDto; action: DriverDispatchAction | "decline" | "swap" }
  | { kind: "shift-start" }
  | { kind: "shift-end" }
  | { kind: "leave-cancel"; leave: LeaveDto };

const DISPATCH_COPY: Record<DriverDispatchAction | "decline" | "swap", { label: string; description: string; tone: "danger" | "default"; reason?: boolean }> = {
  accept: { label: "Accept", description: "Tells dispatch you will take this trip.", tone: "default" },
  start: { label: "Start trip", description: "Marks the trip as started now.", tone: "default" },
  complete: { label: "Complete trip", description: "Marks the trip as completed now.", tone: "default" },
  decline: { label: "Decline", description: "Tells dispatch you can't take this trip.", tone: "danger", reason: true },
  swap: { label: "Request swap", description: "Asks dispatch to give this trip to another driver.", tone: "default", reason: true },
};

/** One screen per driver-app menu item (see MENU_ROUTES in the access policy). */
export type MyWorkSection = "work" | "shifts" | "leave" | "checklist" | "safety" | "profile";

/** Keeps forms and lists readable on very wide screens; the shell already provides the page title. */
const PAGE = "mx-auto w-full max-w-[1120px]";

/**
 * Driver self-service on the /driver/* endpoints, one route per menu item
 * (/drive-vision/my-work, /my-work/shifts, /leave, /checklist, /safety, /profile). Each screen
 * requests only its own data; GET /driver/me is always read for the identity strip and to know
 * whether actions are possible. The server identifies the driver from the session; nothing here
 * passes a driver id. Every state change is confirmed, sent once (the confirm button is busy
 * while it runs), and the affected data is re-read afterwards.
 */
export function MyWorkPage({ section = "work" }: { section?: MyWorkSection }) {
  const on = (...s: MyWorkSection[]) => s.includes(section);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [now] = useState(() => new Date());
  const week = useMemo(() => windowAround(now, 7, 0), [now]);
  const month = useMemo(() => windowAround(now, 30, 0), [now]);
  const upcoming = useMemo(() => windowAround(now, 1, 14), [now]);

  const meQ = useApiQuery(`me:driver:${version}`, () => driverAppService.me());
  // The assignment gives the vehicle used by shift start and checklist submission.
  const assignQ = useApiQuery(on("work", "shifts", "checklist") ? `me:assignment:${version}` : null, () => driverAppService.assignment());
  const shiftQ = useApiQuery(on("shifts") ? `me:shift:${version}` : null, () => driverAppService.currentShift());
  const dispatchesQ = useApiQuery(on("work") ? `me:dispatches:${version}` : null, () => driverAppService.dispatches({ ...upcoming, pageNumber: 1, pageSize: 20 }));
  const hoursQ = useApiQuery(on("shifts") ? `me:hours:${version}` : null, () => driverAppService.workingHours(week));
  const leaveQ = useApiQuery(on("leave") ? `me:leave:${version}` : null, () => driverAppService.leave({ pageNumber: 1, pageSize: 20 }));
  const scoreQ = useApiQuery(on("safety") ? `me:score` : null, () => driverAppService.safetyScore(month));
  const eventsQ = useApiQuery(on("safety") ? `me:events` : null, () => driverAppService.safetyEvents({ ...month, pageNumber: 1, pageSize: 10 }));
  // Template is shown on the checklist screen and reused by the submit form (one request).
  const templateQ = useApiQuery(on("checklist") ? "me:checklist-template" : null, () => driverAppService.checklistTemplate());

  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [odometer, setOdometer] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  const access = useAccess();
  const canSelfService = canPerform(access, "driver.selfService");
  const canChangePassword = canPerform(access, "account.password");
  const me = meQ.data;
  // GET /driver/me failed (e.g. 403 "not linked to a driver profile"): requests would fail the same way, so actions are off.
  // Without the self-service action grant (access policy) the same controls are off too.
  const noProfile = (!!meQ.error && !me) || !canSelfService;
  const noProfileTitle = !canSelfService ? "Unavailable: your account can't make changes here" : noProfile ? "Unavailable: your driver profile couldn't be loaded" : undefined;
  const overview = assignQ.data;
  const shift = shiftQ.data;
  const vehicleId = overview?.currentVehicle?.deviceId;
  const odometerInvalid = odometer.trim() !== "" && !(Number.isFinite(Number(odometer)) && Number(odometer) >= 0);

  async function run() {
    if (!pending) return;
    try {
      const odo = odometer.trim() ? { odometerKm: Number(odometer) } : {};
      if (pending.kind === "dispatch") {
        const id = pending.dispatch.id!;
        const r = reason.trim() ? { reason: reason.trim() } : {};
        const res =
          pending.action === "decline" ? await driverAppService.decline(id, r) : pending.action === "swap" ? await driverAppService.requestSwap(id, r) : await driverAppService.dispatchAction(id, pending.action);
        toast.success(`${DISPATCH_COPY[pending.action].label} sent`, { description: res.status ? `Server status: ${res.status}` : undefined });
      } else if (pending.kind === "shift-start") {
        await driverAppService.startShift({ ...(vehicleId !== undefined ? { deviceId: vehicleId } : {}), ...odo });
        toast.success("Shift started");
      } else if (pending.kind === "shift-end") {
        await driverAppService.endShift(odo);
        toast.success("Shift ended");
      } else {
        await driverAppService.cancelLeave(pending.leave.id!);
        toast.success("Leave request cancelled");
      }
      setReason("");
      setOdometer("");
      refresh();
    } catch (err) {
      toast.error("The server rejected the request", { description: describeApiError(err) });
      throw err;
    }
  }

  const copy =
    pending?.kind === "dispatch"
      ? { title: `${DISPATCH_COPY[pending.action].label}: ${pending.dispatch.title ?? `trip ${pending.dispatch.id}`}?`, ...DISPATCH_COPY[pending.action] }
      : pending?.kind === "shift-start"
        ? { title: "Start your shift?", label: "Start shift", description: vehicleId !== undefined ? `On ${overview?.currentVehicle?.deviceName ?? "your assigned vehicle"}.` : "No vehicle is assigned to you; the server decides whether a shift can start without one.", tone: "default" as const }
        : pending?.kind === "shift-end"
          ? { title: "End your shift?", label: "End shift", description: "Records the end of your current shift now.", tone: "danger" as const }
          : pending?.kind === "leave-cancel"
            ? { title: "Cancel this leave request?", label: "Cancel request", description: `${pending.leave.leaveType ?? "Leave"} · ${pending.leave.startDate ?? "?"} – ${pending.leave.endDate ?? "?"}`, tone: "danger" as const }
            : null;

  // Only actions the trip's recorded state doesn't rule out are offered (tripActionAvailability); the server decides the rest.
  const tripActions = (d: DispatchDto, primaryOnly = false) => {
    const availability = tripActionAvailability(d);
    const shown: readonly TripAction[] = primaryOnly ? TRIP_ACTIONS.filter((a) => a !== "decline" && a !== "swap") : TRIP_ACTIONS;
    const offered = shown.filter((a) => availability[a] === null);
    const withheld = withheldTripReason(availability, shown);
    return (
      <div className="flex flex-col gap-1.5">
        {offered.length ? (
          <div className="flex flex-wrap gap-1.5">
            {offered.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === "decline" || a === "swap" ? "outline" : "default"}
                className={TOUCH}
                onClick={() => d.id !== undefined && setPending({ kind: "dispatch", dispatch: d, action: a })}
                disabled={noProfile}
                title={noProfileTitle}
              >
                {DISPATCH_COPY[a].label}
              </Button>
            ))}
          </div>
        ) : null}
        {withheld ? <p className="text-xs text-ink-muted">{withheld}</p> : null}
      </div>
    );
  };

  const featured = overview?.activeTrip ?? overview?.nextTrip;
  const hours = hoursQ.data?.summary;
  const score = scoreQ.data?.score;
  const templateItems = useMemo(() => (templateQ.data?.items ?? []).filter((i): i is ChecklistItem & { key: string } => !!i.key), [templateQ.data]);
  const leaveItems = leaveQ.data?.items ?? [];
  const leaveCounts = countByStatus(leaveItems);

  return (
    <div className={PAGE}>
      {me ? (
        <DriverIdentity me={me} />
      ) : meQ.error ? (
        <Panel className="mb-4">
          <ApiErrorState error={meQ.error} onRetry={meQ.refetch} title="Your driver profile isn't available" compact />
        </Panel>
      ) : (
        <LoadingSkeleton variant="card" className="mb-4 h-16" />
      )}

      {/* ── My Work: today at a glance, the trip to act on, upcoming trips ─────────── */}
      {on("work") ? (
        <div className="space-y-4">
          {assignQ.error && !overview ? (
            <Panel>
              <ApiErrorState error={assignQ.error} onRetry={assignQ.refetch} compact title="Couldn't load today's assignment" />
            </Panel>
          ) : !overview ? (
            <LoadingSkeleton variant="card" className="h-24" />
          ) : (
            <section aria-labelledby="mw-today" className="space-y-4">
              <h2 id="mw-today" className="sr-only">
                Today
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile icon={Truck} label="Vehicle" value={overview.currentVehicle?.deviceName ?? overview.currentVehicle?.terminalNo ?? "None assigned"} hint={overview.currentVehicle?.assignedFrom ? `Since ${formatDate(overview.currentVehicle.assignedFrom)}` : undefined} tone={overview.currentVehicle ? "brand" : "neutral"} />
                <StatTile
                  icon={Clock}
                  label="Shift"
                  value={overview.currentShift?.open ? "On shift" : "Not on shift"}
                  hint={overview.currentShift?.open && overview.currentShift.startedAt ? `Since ${formatTime(overview.currentShift.startedAt)}` : undefined}
                  tone={overview.currentShift?.open ? "success" : "neutral"}
                />
                <StatTile icon={RouteIcon} label="Trips today" value={formatNumber(overview.today?.length ?? 0)} hint={overview.nextTrip?.scheduledStart ? `Next at ${formatTime(overview.nextTrip.scheduledStart)}` : undefined} />
              </div>
              <Panel aria-label={overview.activeTrip ? "Current trip" : "Next trip"} className="p-5">
                <p className="mb-2 text-[11.5px] font-semibold tracking-wide text-ink-subtle uppercase">{overview.activeTrip ? "Current trip" : "Next trip"}</p>
                {featured ? (
                  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <TripSummary trip={featured} featured />
                    {tripActions(featured, true)}
                  </div>
                ) : (
                  <EmptyState icon={RouteIcon} title="No trip assigned" description="Trips dispatched to you will appear here." className="py-6" />
                )}
              </Panel>
            </section>
          )}

          <Panel aria-labelledby="mw-trips" className="overflow-hidden">
            <PanelHeader titleId="mw-trips" title="Upcoming trips" description="Dispatched to you · next 14 days. The server decides which actions apply to each trip." />
            {dispatchesQ.error ? (
              <ApiErrorState error={dispatchesQ.error} onRetry={dispatchesQ.refetch} compact />
            ) : !dispatchesQ.data ? (
              <LoadingSkeleton variant="list" rows={3} />
            ) : dispatchesQ.data.items.length === 0 ? (
              <EmptyState icon={CalendarCheck2} title="No trips in the next 14 days" description="New dispatches will show up here." className="py-8" />
            ) : (
              <ul className="mt-2 divide-y divide-line px-5 pb-2">
                {dispatchesQ.data.items.map((d) => (
                  <li key={d.id} className="flex flex-col gap-3 py-3.5 lg:flex-row lg:items-center lg:justify-between">
                    <TripSummary trip={d} />
                    {tripActions(d)}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {/* ── My Shifts: current shift + action, working-hours summary, recent shifts ─── */}
      {on("shifts") ? (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <Panel aria-labelledby="mw-shift" className="flex flex-col p-5">
            <h2 id="mw-shift" className="mb-3 text-[16px] font-semibold text-ink">
              Current shift
            </h2>
            {shiftQ.error && shiftQ.data === undefined ? (
              <ApiErrorState error={shiftQ.error} onRetry={shiftQ.refetch} compact />
            ) : shiftQ.data === undefined ? (
              <LoadingSkeleton variant="list" rows={2} />
            ) : (
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-3">
                  <span className={cn("grid size-12 shrink-0 place-items-center rounded-full", shift ? "bg-success-soft text-success" : "bg-surface-sunken text-ink-muted")} aria-hidden>
                    <Clock className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[18px] font-semibold text-ink">{shift ? "On shift" : "Not on shift"}</p>
                    <p className="text-[12.5px] text-ink-muted">
                      {shift
                        ? `Started ${when(shift.startedAt)}${elapsedSince(shift.startedAt, now) ? ` · ${elapsedSince(shift.startedAt, now)} elapsed` : ""}`
                        : overview?.currentVehicle
                          ? `Vehicle: ${overview.currentVehicle.deviceName ?? overview.currentVehicle.terminalNo ?? "assigned"}`
                          : "No vehicle assigned"}
                    </p>
                  </div>
                </div>
                {shift?.deviceName ? <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-ink"><Truck className="size-3.5 text-ink-subtle" aria-hidden /> {shift.deviceName}</p> : null}
                <div className="mt-auto pt-5">
                  {shift ? (
                    <Button variant="outline" className={cn("w-full sm:w-auto", TOUCH)} onClick={() => setPending({ kind: "shift-end" })} disabled={noProfile} title={noProfileTitle}>
                      <Square /> End shift
                    </Button>
                  ) : (
                    <Button className={cn("w-full sm:w-auto", TOUCH)} onClick={() => setPending({ kind: "shift-start" })} disabled={noProfile} title={noProfileTitle}>
                      <Play /> Start shift
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Panel aria-labelledby="mw-hours" className="p-5">
            <h2 id="mw-hours" className="mb-3 text-[16px] font-semibold text-ink">
              Working hours <span className="font-normal text-ink-muted">· last 7 days</span>
            </h2>
            {hoursQ.error && !hoursQ.data ? (
              <ApiErrorState error={hoursQ.error} onRetry={hoursQ.refetch} compact />
            ) : !hoursQ.data ? (
              <LoadingSkeleton variant="list" rows={2} />
            ) : (
              <dl className="grid grid-cols-2 gap-3">
                {[
                  ["Total", typeof hours?.totalHours === "number" ? `${formatNumber(Math.round(hours.totalHours * 10) / 10)} h` : "—"],
                  ["Shifts", typeof hours?.shiftCount === "number" ? formatNumber(hours.shiftCount) : "—"],
                  ["Average", typeof hours?.averageSeconds === "number" ? formatSeconds(hours.averageSeconds) : "—"],
                  ["Longest", typeof hours?.longestSeconds === "number" ? formatSeconds(hours.longestSeconds) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-inner bg-surface-muted px-3 py-2.5">
                    <dt className="text-[11.5px] font-medium text-ink-muted">{k}</dt>
                    <dd className="text-[18px] font-semibold text-ink tabular">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>

          <Panel aria-labelledby="mw-recent-shifts" className="@3xl:col-span-2">
            <PanelHeader titleId="mw-recent-shifts" title="Recent shifts" description="Last 7 days, as recorded by the server" />
            {hoursQ.error && !hoursQ.data ? null : !hoursQ.data ? (
              <LoadingSkeleton variant="list" rows={3} />
            ) : (hoursQ.data.shifts ?? []).length === 0 ? (
              <EmptyState icon={Clock} title="No shifts in the last 7 days" description="Shifts you start and end appear here." className="py-8" />
            ) : (
              <ul className="mt-1 divide-y divide-line px-5 pb-2">
                {(hoursQ.data.shifts ?? []).map((s, i) => (
                  <ShiftRow key={s.id ?? i} shift={s} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {/* ── My Leave ──────────────────────────────────────────────────────────────── */}
      {on("leave") ? (
        <Panel aria-labelledby="mw-leave">
          <PanelHeader
            titleId="mw-leave"
            title="Leave requests"
            description={leaveQ.data ? `${formatNumber(leaveQ.data.total)} request${leaveQ.data.total === 1 ? "" : "s"}${leaveQ.data.total > leaveItems.length ? ` · showing the latest ${leaveItems.length}` : ""}` : undefined}
            action={
              <Button className={TOUCH} onClick={() => setLeaveOpen(true)} disabled={noProfile} title={noProfileTitle}>
                <Plus /> Request leave
              </Button>
            }
          />
          {Object.keys(leaveCounts).length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-5 pt-3" aria-label="Requests by status">
              {Object.entries(leaveCounts).map(([s, n]) => (
                <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-muted">
                  <ServerStatus value={s === "—" ? undefined : s} /> {s === "—" ? "No status" : null}
                  <span className="font-semibold text-ink tabular">{n}</span>
                </span>
              ))}
            </div>
          ) : null}
          {leaveQ.error ? (
            <ApiErrorState error={leaveQ.error} onRetry={leaveQ.refetch} compact />
          ) : !leaveQ.data ? (
            <LoadingSkeleton variant="list" rows={3} />
          ) : leaveItems.length === 0 ? (
            <EmptyState icon={CalendarOff} title="No leave requests yet" description="Requests you submit and their decisions appear here." className="py-10" />
          ) : (
            <ul className="mt-1 divide-y divide-line px-5 pb-2">
              {leaveItems.map((l) => (
                <LeaveRow
                  key={l.id}
                  leave={l}
                  action={
                    !l.decidedAt && l.id !== undefined ? (
                      <Button size="sm" variant="outline" className={TOUCH} onClick={() => setPending({ kind: "leave-cancel", leave: l })} disabled={noProfile}>
                        Cancel request
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {/* ── Shift checklist: template grouped by category, submit, history ─────────── */}
      {on("checklist") ? (
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel aria-labelledby="mw-check">
            <PanelHeader
              titleId="mw-check"
              title="Pre-trip checklist"
              description={templateItems.length ? `${templateItems.length} items · ${templateItems.filter((i) => i.critical).length} critical` : "Items come from the server's checklist template"}
              action={
                <Button className={TOUCH} onClick={() => setChecklistOpen(true)} disabled={noProfile || templateItems.length === 0} title={noProfileTitle}>
                  <ClipboardCheck /> Start checklist
                </Button>
              }
            />
            <div className="px-5 pt-3 pb-5">
              {templateQ.error ? (
                <ApiErrorState error={templateQ.error} onRetry={templateQ.refetch} compact />
              ) : !templateQ.data ? (
                <LoadingSkeleton variant="list" rows={4} />
              ) : templateItems.length === 0 ? (
                <EmptyState icon={ListChecks} title="No checklist items" description="The server returned an empty checklist template." className="py-6" />
              ) : (
                <ChecklistGroups items={templateItems} />
              )}
            </div>
          </Panel>
          <Panel aria-labelledby="mw-check-history">
            <PanelHeader titleId="mw-check-history" title="Recent submissions" description="Last 7 days" />
            <ChecklistHistory version={version} range={week} />
          </Panel>
        </div>
      ) : null}

      {/* ── My Safety: server score, breakdown, events ─────────────────────────────── */}
      {on("safety") ? (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <Panel aria-labelledby="mw-safety" className="p-5">
            <h2 id="mw-safety" className="mb-1 text-[16px] font-semibold text-ink">
              Safety score
            </h2>
            <p className="mb-4 text-[12.5px] text-ink-muted">Last 30 days · computed by the server</p>
            {scoreQ.error ? (
              <ApiErrorState error={scoreQ.error} onRetry={scoreQ.refetch} compact />
            ) : !scoreQ.data ? (
              <LoadingSkeleton variant="list" rows={3} />
            ) : !score ? (
              <EmptyState icon={ShieldCheck} title="No score for this period" description="The server returned no safety score for the last 30 days." className="py-6" />
            ) : (
              <>
                <div className="flex items-end gap-3">
                  <p className="text-[44px] leading-none font-semibold tracking-tight text-ink tabular">{typeof score.score === "number" ? formatNumber(score.score) : "—"}</p>
                  {score.grade ? (
                    <StatusBadge tone="brand" className="mb-1">
                      Grade {score.grade}
                    </StatusBadge>
                  ) : null}
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ["Events", score.alarmCount],
                    ["Severe", score.severeCount],
                    ["Penalty points", score.penaltyPoints],
                    ["Trips", score.tripCount],
                    ["Distance", typeof score.distanceKm === "number" ? formatKm(score.distanceKm) : undefined],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-inner bg-surface-muted px-3 py-2">
                      <dt className="text-[11.5px] font-medium text-ink-muted">{k}</dt>
                      <dd className="text-[15px] font-semibold text-ink tabular">{typeof v === "number" ? formatNumber(v) : (v ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Panel>
          <Panel aria-labelledby="mw-safety-types" className="p-5">
            <h2 id="mw-safety-types" className="mb-4 text-[16px] font-semibold text-ink">
              Events by type
            </h2>
            {scoreQ.error ? null : !scoreQ.data ? (
              <LoadingSkeleton variant="list" rows={3} />
            ) : (scoreQ.data.byType ?? []).filter((r) => typeof r.count === "number").length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No events by type" description="Nothing to break down for this period." className="py-6" />
            ) : (
              <CountBars rows={scoreQ.data.byType} />
            )}
          </Panel>
          <Panel aria-labelledby="mw-safety-events" className="@3xl:col-span-2">
            <PanelHeader titleId="mw-safety-events" title="Recent safety events" description={eventsQ.data ? `${formatNumber(eventsQ.data.total)} in the last 30 days${eventsQ.data.total > eventsQ.data.items.length ? ` · latest ${eventsQ.data.items.length} shown` : ""}` : "Last 30 days"} />
            {eventsQ.error ? (
              <ApiErrorState error={eventsQ.error} onRetry={eventsQ.refetch} compact />
            ) : !eventsQ.data ? (
              <LoadingSkeleton variant="list" rows={3} />
            ) : eventsQ.data.items.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No safety events" description="No events were recorded for you in the last 30 days." className="py-8" />
            ) : (
              <ul className="mt-1 divide-y divide-line px-5 pb-2">
                {eventsQ.data.items.map((e, i) => (
                  <EventRow key={e.id ?? i} event={e} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {/* ── My Profile ───────────────────────────────────────────────────────────── */}
      {on("profile") ? (
        <Panel aria-labelledby="mw-profile">
          <PanelHeader
            titleId="mw-profile"
            title="Profile"
            description="Your record as held by the server. You can edit your contact details."
            action={
              me && canSelfService ? (
                <Button variant="outline" className={TOUCH} onClick={() => setContactOpen(true)}>
                  <Pencil /> Edit contact details
                </Button>
              ) : undefined
            }
          />
          {me ? (
            <div className="grid grid-cols-1 gap-6 px-5 pt-4 pb-5 @3xl:grid-cols-2">
              <section aria-labelledby="mp-contact">
                <SectionTitle icon={Phone} id="mp-contact">
                  Contact
                </SectionTitle>
                <FieldGrid fields={[{ label: "Phone", value: me.phone }, { label: "Email", value: me.email }, { label: "Address", value: me.address }]} />
              </section>
              <section aria-labelledby="mp-emergency">
                <SectionTitle icon={UserRound} id="mp-emergency">
                  Emergency contact
                </SectionTitle>
                <FieldGrid fields={[{ label: "Name", value: me.emergencyContactName }, { label: "Phone", value: me.emergencyContactPhone }]} />
              </section>
              <section aria-labelledby="mp-licence">
                <SectionTitle icon={IdCard} id="mp-licence">
                  Licence
                </SectionTitle>
                <FieldGrid
                  fields={[
                    { label: "Number", value: me.licence?.number },
                    { label: "Class", value: me.licence?.licenceClass },
                    { label: "Issued", value: me.licence?.issuedOn ? formatDate(me.licence.issuedOn) : undefined },
                    { label: "Expires", value: me.licence?.expiresOn ? `${formatDate(me.licence.expiresOn)}${typeof me.licence.daysToExpiry === "number" ? ` (${me.licence.daysToExpiry} days)` : ""}` : undefined },
                    { label: "Status", value: me.licence?.status },
                  ]}
                />
              </section>
              <section aria-labelledby="mp-employment">
                <SectionTitle icon={Gauge} id="mp-employment">
                  Employment
                </SectionTitle>
                <FieldGrid fields={[{ label: "Status", value: me.status }, { label: "Hired on", value: me.hiredOn ? formatDate(me.hiredOn) : undefined }, { label: "IC card", value: me.icCardNo }]} />
              </section>
            </div>
          ) : meQ.error ? (
            <ApiErrorState error={meQ.error} onRetry={meQ.refetch} compact />
          ) : (
            <LoadingSkeleton variant="list" rows={4} />
          )}
        </Panel>
      ) : null}
      {on("profile") && canChangePassword ? (
        <div className="mt-4">
          <PasswordPanel />
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && (setPending(null), setReason(""), setOdometer(""))}
        tone={copy?.tone ?? "default"}
        title={copy?.title ?? ""}
        description={copy?.description}
        confirmLabel={copy?.label}
        confirmDisabled={reason.length > 500 || odometerInvalid}
        onConfirm={run}
      >
        {pending?.kind === "dispatch" && DISPATCH_COPY[pending.action].reason ? (
          <FormField id="mw-reason" label="Reason (optional)" error={reason.length > 500 ? "Use 500 characters or fewer." : undefined}>
            <Textarea id="mw-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        ) : pending?.kind === "shift-start" || pending?.kind === "shift-end" ? (
          <FormField id="mw-odo" label="Odometer (km, optional)" error={odometerInvalid ? "Enter a non-negative number." : undefined}>
            <Input id="mw-odo" inputMode="decimal" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </FormField>
        ) : null}
      </ConfirmDialog>

      <ContactPanel open={contactOpen} current={me} onClose={() => setContactOpen(false)} onSaved={() => (setContactOpen(false), refresh())} />
      <DriverLeavePanel open={leaveOpen} onClose={() => setLeaveOpen(false)} onSaved={() => (setLeaveOpen(false), refresh())} />
      <ChecklistPanel open={checklistOpen} items={templateItems} vehicleId={vehicleId} dispatchId={overview?.activeTrip?.id} onClose={() => setChecklistOpen(false)} onSaved={() => (setChecklistOpen(false), refresh())} />
    </div>
  );
}

const categoryLabel = humanize;
const groupItems = groupByCategory;

function ChecklistGroups({ items }: { items: (ChecklistItem & { key: string })[] }) {
  return (
    <div className="space-y-4">
      {groupItems(items).map(([cat, list]) => (
        <section key={cat} aria-label={categoryLabel(cat)}>
          <h3 className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-ink-subtle uppercase">
            {categoryLabel(cat)} <span className="font-normal">· {list.length}</span>
          </h3>
          <ul className="divide-y divide-line rounded-inner border border-line/70">
            {list.map((i) => (
              <li key={i.key} className="flex items-start gap-2.5 px-3 py-2.5 text-[13px]">
                <ListChecks className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden />
                <span className="min-w-0 flex-1 break-words text-ink">{i.label ?? i.key}</span>
                {i.critical ? (
                  <StatusBadge size="sm" tone="danger" icon={TriangleAlert}>
                    Critical
                  </StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ChecklistHistory({ version, range }: { version: number; range: { from: string; to: string } }) {
  const q = useApiQuery(`me:checklists:${version}`, () => driverAppService.checklists({ ...range, pageNumber: 1, pageSize: 5 }));
  if (q.error) return <ApiErrorState error={q.error} onRetry={q.refetch} compact />;
  if (!q.data) return <LoadingSkeleton variant="list" rows={2} />;
  if (q.data.items.length === 0) return <EmptyState icon={ClipboardCheck} title="No submissions yet" description="Checklists you submit in the last 7 days appear here." className="py-8" />;
  return (
    <ul className="mt-1 divide-y divide-line px-5 pb-2 text-[13px]">
      {q.data.items.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-ink tabular">{when(c.submittedAt)}</span>
            {c.deviceName ? <span className="block truncate text-xs text-ink-muted">{c.deviceName}</span> : null}
          </span>
          {c.allPassed ? (
            <StatusBadge size="sm" tone="success" icon={CheckCircle2}>
              All passed
            </StatusBadge>
          ) : (
            <StatusBadge size="sm" tone={c.criticalFailed ? "danger" : "warning"} icon={TriangleAlert}>
              {typeof c.failedCount === "number" ? `${c.failedCount} failed` : "Failed"}
              {c.criticalFailed ? " · critical" : ""}
            </StatusBadge>
          )}
        </li>
      ))}
    </ul>
  );
}

function ContactPanel({ open, current, onClose, onSaved }: { open: boolean; current: DriverContactRequest | undefined; onClose: () => void; onSaved: () => void }) {
  const base: Required<DriverContactRequest> = { phone: current?.phone ?? "", email: current?.email ?? "", address: current?.address ?? "", emergencyContactName: current?.emergencyContactName ?? "", emergencyContactPhone: current?.emergencyContactPhone ?? "" };
  const [draft, setDraft] = useState<Required<DriverContactRequest> | null>(null);
  const form = draft ?? base;
  const [errors, setErrors] = useState<Errors<keyof DriverContactRequest>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fields: { f: keyof DriverContactRequest; label: string; max: number }[] = [
    { f: "phone", label: "Phone", max: 30 },
    { f: "email", label: "Email", max: 320 },
    { f: "address", label: "Address", max: 500 },
    { f: "emergencyContactName", label: "Emergency contact", max: 150 },
    { f: "emergencyContactPhone", label: "Emergency phone", max: 30 },
  ];

  function close() {
    setDraft(null);
    setErrors({});
    setFailure(null);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found: Errors<keyof DriverContactRequest> = {};
    for (const { f, max } of fields) if (form[f].trim().length > max) found[f] = `Use ${max} characters or fewer.`;
    for (const f of ["phone", "emergencyContactPhone"] as const) if (!found[f] && form[f].trim() && !PHONE_PATTERN.test(form[f].trim())) found[f] = "5–30 characters: digits, spaces, +, (, ) and - only.";
    if (!found.email && form.email.trim() && !EMAIL_SHAPE.test(form.email.trim())) found.email = "Enter a valid email address.";
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    // Only changed fields are sent (PATCH).
    const body: DriverContactRequest = {};
    for (const { f } of fields) if (form[f].trim() !== base[f]) body[f] = form[f].trim();
    if (Object.keys(body).length === 0) return close();
    setSaving(true);
    try {
      await driverAppService.updateContact(body);
      toast.success("Contact details updated");
      setDraft(null);
      onSaved();
    } catch (err) {
      const map = isApiError(err) ? err.fieldErrorMap() : {};
      const known: Errors<keyof DriverContactRequest> = {};
      for (const { f } of fields) if (map[f]) known[f] = map[f];
      setErrors(known);
      setFailure(Object.keys(known).length ? null : describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Edit contact details"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </div>
      }
    >
      <form id="contact-form" className="space-y-3" onSubmit={submit} noValidate>
        {fields.map(({ f, label, max }) => (
          <FormField key={f} id={`mc-${f}`} label={label} error={errors[f]}>
            <Input {...fieldA11y(`mc-${f}`, errors[f])} maxLength={max} value={form[f]} onChange={(e) => setDraft({ ...form, [f]: e.target.value })} />
          </FormField>
        ))}
        {failure ? (
          <p className="text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
    </SlideOverPanel>
  );
}

function DriverLeavePanel({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<LeaveForm>(EMPTY_LEAVE_FORM);
  const [errors, setErrors] = useState<Errors<LeaveField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = () => (setForm(EMPTY_LEAVE_FORM), setErrors({}), setFailure(null), onClose());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validateLeaveForm(form, { requireDriver: false });
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const res = await driverAppService.requestLeave(leaveRequestBody(form, { includeDriver: false }));
      toast.success("Leave requested", { description: res.status ? `Server status: ${res.status}` : undefined });
      setForm(EMPTY_LEAVE_FORM);
      onSaved();
    } catch (err) {
      setFailure(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Request leave"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="my-leave-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Submit
          </Button>
        </div>
      }
    >
      <form id="my-leave-form" onSubmit={submit} noValidate>
        <LeaveFields form={form} onChange={setForm} errors={errors} forDriver drivers={[]} />
        {failure ? (
          <p className="mt-3 text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
      </form>
    </SlideOverPanel>
  );
}


function ChecklistPanel({ open, items, vehicleId, dispatchId, onClose, onSaved }: { open: boolean; items: (ChecklistItem & { key: string })[]; vehicleId?: number; dispatchId?: number; onClose: () => void; onSaved: () => void }) {
  const [results, setResults] = useState<Record<string, { passed: boolean | null; note: string }>>({});
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const answeredCount = items.filter((i) => typeof results[i.key]?.passed === "boolean").length;
  const answered = items.length > 0 && answeredCount === items.length;
  const criticalFailed = items.some((i) => i.critical && results[i.key]?.passed === false);
  const close = () => (setResults({}), setNote(""), setFailure(null), setTriedSubmit(false), onClose());
  const set = (key: string, patch: Partial<{ passed: boolean | null; note: string }>) => setResults((r) => ({ ...r, [key]: { ...(r[key] ?? { passed: null, note: "" }), ...patch } }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTriedSubmit(true);
    if (saving || !answered) return;
    setSaving(true);
    setFailure(null);
    try {
      const body: ChecklistItemResult[] = items.map((i) => ({ key: i.key, passed: results[i.key]!.passed!, ...(results[i.key]?.note.trim() ? { note: results[i.key]!.note.trim().slice(0, 300) } : {}) }));
      const res = await driverAppService.submitChecklist({ items: body, ...(vehicleId !== undefined ? { deviceId: vehicleId } : {}), ...(dispatchId !== undefined ? { dispatchId } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(res.allPassed ? "Checklist submitted — all passed" : "Checklist submitted", { description: res.criticalFailed ? "A critical item failed." : undefined });
      setResults({});
      setNote("");
      setTriedSubmit(false);
      onSaved();
    } catch (err) {
      setFailure(describeApiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Pre-trip checklist"
      description="Mark every item as passed or failed"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-muted" aria-live="polite">
            <span className="font-semibold text-ink tabular">{answeredCount}</span> of {items.length} answered
            {criticalFailed ? <span className="ml-1 text-danger">· a critical item failed</span> : null}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className={TOUCH} onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="checklist-form" className={TOUCH} disabled={saving || items.length === 0}>
              {saving ? <Loader2 className="animate-spin" /> : null} Submit
            </Button>
          </div>
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-muted">The server returned no checklist items.</p>
      ) : (
        <form id="checklist-form" className="space-y-5" onSubmit={submit} noValidate>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={answeredCount}>
            <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${(answeredCount / items.length) * 100}%` }} />
          </div>
          {groupItems(items).map(([cat, list]) => (
            <section key={cat} aria-label={categoryLabel(cat)} className="space-y-2">
              <h3 className="text-[11.5px] font-semibold tracking-wide text-ink-subtle uppercase">{categoryLabel(cat)}</h3>
              {list.map((i) => {
                const r = results[i.key] ?? { passed: null, note: "" };
                const missing = triedSubmit && r.passed === null;
                return (
                  <fieldset key={i.key} className={cn("rounded-xl border p-3", missing ? "border-danger/50 bg-danger-soft/30" : "border-line")} aria-invalid={missing || undefined}>
                    <legend className="sr-only">{i.label ?? i.key}</legend>
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 text-[13.5px] font-medium break-words text-ink" aria-hidden>
                        {i.label ?? i.key}
                        {i.critical ? <span className="ml-1.5 text-xs font-semibold text-danger">Critical</span> : null}
                      </p>
                      <div className="grid shrink-0 grid-cols-2 gap-1.5" role="group" aria-label={`${i.label ?? i.key}: result`}>
                        <button
                          type="button"
                          aria-pressed={r.passed === true}
                          onClick={() => set(i.key, { passed: true })}
                          className={cn("inline-flex h-11 min-w-24 items-center justify-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none", r.passed === true ? "border-success bg-success-soft text-success" : "border-line bg-surface text-ink hover:bg-surface-muted")}
                        >
                          <CheckCircle2 className="size-4" aria-hidden /> Pass
                        </button>
                        <button
                          type="button"
                          aria-pressed={r.passed === false}
                          onClick={() => set(i.key, { passed: false })}
                          className={cn("inline-flex h-11 min-w-24 items-center justify-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none", r.passed === false ? "border-danger bg-danger-soft text-danger" : "border-line bg-surface text-ink hover:bg-surface-muted")}
                        >
                          <XCircle className="size-4" aria-hidden /> Fail
                        </button>
                      </div>
                    </div>
                    {missing ? <p className="mt-2 text-xs text-danger">Choose Pass or Fail.</p> : null}
                    {r.passed === false ? (
                      <Input className="mt-2.5 h-11" aria-label={`What's wrong with: ${i.label ?? i.key} (optional)`} placeholder="What's wrong? (optional)" maxLength={300} value={r.note} onChange={(e) => set(i.key, { note: e.target.value })} />
                    ) : null}
                  </fieldset>
                );
              })}
            </section>
          ))}
          <FormField id="cl-note" label="Note (optional)">
            <Textarea id="cl-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {triedSubmit && !answered ? (
            <p className="text-[13px] text-danger" role="alert">
              Answer every item before submitting ({items.length - answeredCount} left).
            </p>
          ) : null}
          {failure ? (
            <p className="text-[13px] text-danger" role="alert">
              {failure}
            </p>
          ) : null}
        </form>
      )}
    </SlideOverPanel>
  );
}
