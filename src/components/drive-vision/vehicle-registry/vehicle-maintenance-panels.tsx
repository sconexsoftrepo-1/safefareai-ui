"use client";

import { useState } from "react";
import { AlarmClock, BellRing, CalendarClock, CalendarPlus, CircleDot, Gauge, Info, Loader2, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/features/drive-vision/api/errors";
import {
  REASON_MAX,
  SOURCE_LABELS,
  formatPlainDate,
  fromTyreAlert,
  isPlainDate,
  readServerTimestamp,
  scheduleStatusTone,
  sortNotifications,
  tyreStatusTone,
  humaniseKind,
  vehicleAlertNotifications,
  type MaintenanceNotification,
  type MaintenanceTone,
  type TyreMaintenanceRecord,
  type VehicleMaintenanceSchedule,
} from "@/features/drive-vision/api/maintenance";
import { maintenanceService } from "@/features/drive-vision/api/maintenance-service";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { formatLocalDateTime, formatNumber } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { ApiErrorState } from "../shared/api-states";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { FormField, fieldA11y } from "../shared/form-field";
import { DetailRow } from "../shared/slide-over-panel";
import { StatusBadge } from "../shared/status-badge";
import { toast } from "../shared/toast-provider";

/**
 * The maintenance tabs of the Vehicles drawer (Safe-Fare Admin and Fleet Owner only; see maintenance-access.ts).
 * Every value comes from the Python services through the same-origin proxy; nothing is computed or filled in here.
 * Each tab loads its data when it is opened, for the selected vehicle only, keyed by the vehicle NUMBER (the
 * Python identifier), never the Safe-Fare vehicle or device id.
 */

export type DrawerTab = "overview" | "vehicle" | "tyre" | "alerts";
export const DRAWER_TABS: { value: DrawerTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "vehicle", label: "Vehicle Maintenance" },
  { value: "tyre", label: "Tyre Maintenance" },
  { value: "alerts", label: "Maintenance Alerts" },
];
export const readDrawerTab = (v: string | null): DrawerTab => (v === "vehicle" || v === "tyre" || v === "alerts" ? v : "overview");

/** 404 from the service itself (not the "route missing" 404): the record doesn't exist. */
const isMissing = (err: unknown) => isApiError(err) && err.status === 404 && err.errorCode === "not_found";

const TONE_BAR: Record<MaintenanceTone, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-ink-subtle" };

export function DrawerTabs({ value, onChange }: { value: DrawerTab; onChange: (t: DrawerTab) => void }) {
  return (
    <div role="tablist" aria-label="Vehicle details" className="scrollbar-thin -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1 pb-2" data-testid="vehicle-drawer-tabs">
      {DRAWER_TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap", value === t.value ? "bg-ink text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink")}
          data-tab={t.value}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A server timestamp: zoned → user's zone; unzoned → its digits as sent, marked as such. */
export function ServerTime({ value }: { value: string | null | undefined }) {
  const t = readServerTimestamp(value);
  if (!t) return <span className="text-ink-subtle">—</span>;
  if (t.zoned) return <time dateTime={t.iso}>{formatLocalDateTime(t.iso!)}</time>;
  return (
    <time dateTime={value ?? undefined} title="Time as sent by the maintenance service (no time zone given)">
      {t.text}
    </time>
  );
}

function PlainDate({ value }: { value: string | null | undefined }) {
  return value ? <time dateTime={value}>{formatPlainDate(value)}</time> : <span className="text-ink-subtle">—</span>;
}

/** Shown instead of a tab's data when there is no tenant to read (Safe-Fare Admin in platform-wide mode). */
export function TenantNotice() {
  return (
    <EmptyState
      icon={Info}
      title="Select a tenant"
      description="Maintenance data belongs to one organisation. Choose a tenant in the header to see this vehicle's maintenance."
      className="py-8"
    />
  );
}

// ── Vehicle Maintenance ─────────────────────────────────────────────────────

export function VehicleMaintenanceTab({ tenantId, vehicleNumber, canCreate }: { tenantId: number; vehicleNumber: string; canCreate: boolean }) {
  const q = useApiQuery(`maintenance:schedule:${tenantId}:${vehicleNumber}`, () => maintenanceService.getSchedule(tenantId, vehicleNumber));
  const [creating, setCreating] = useState(false);
  const missing = isMissing(q.error);
  const schedule = q.data?.data;

  if (q.error && !missing && !schedule) return <ApiErrorState error={q.error} onRetry={q.refetch} compact title="Couldn't load the maintenance schedule" />;
  if (!schedule && !missing) return <LoadingSkeleton variant="list" rows={6} />;

  return (
    <div className="space-y-4" data-testid="vehicle-maintenance-tab">
      {missing ? (
        <EmptyState
          icon={CalendarClock}
          title="No maintenance schedule"
          description={`Vehicle ${vehicleNumber} has no maintenance schedule yet.${canCreate ? " Create one from its last maintenance date; the service works out the next date." : ""}`}
          className="py-6"
          action={
            canCreate && !creating ? (
              <Button size="sm" onClick={() => setCreating(true)} data-testid="create-schedule-open">
                <CalendarPlus /> Create schedule
              </Button>
            ) : undefined
          }
        />
      ) : schedule ? (
        <ScheduleDetails schedule={schedule} />
      ) : null}

      {schedule && canCreate && !creating ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setCreating(true)} data-testid="create-schedule-open">
            <CalendarPlus /> Create maintenance schedule
          </Button>
        </div>
      ) : null}

      {creating ? (
        <CreateScheduleForm
          tenantId={tenantId}
          vehicleNumber={vehicleNumber}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            q.refetch();
          }}
        />
      ) : null}

      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        Postponing and marking maintenance done are driver actions in the maintenance service, so they aren&apos;t offered here.
      </p>
    </div>
  );
}

function ScheduleDetails({ schedule: s }: { schedule: VehicleMaintenanceSchedule }) {
  const tone = scheduleStatusTone(s.status);
  return (
    <>
      <dl className="divide-y divide-line" data-testid="schedule-details">
        <DetailRow label="Status">
          {s.status ? (
            <StatusBadge size="sm" tone={tone} icon={Wrench}>
              <span data-testid="schedule-status">{humaniseKind(s.status)}</span>
            </StatusBadge>
          ) : (
            "—"
          )}
        </DetailRow>
        <DetailRow label="Vehicle number">
          <span className="font-mono">{s.vehicle_number}</span>
        </DetailRow>
        <DetailRow label="Assigned driver">{s.driver_name ?? <span className="text-ink-subtle">Not assigned</span>}</DetailRow>
        <DetailRow label="Previous maintenance">
          <PlainDate value={s.previous_vehicle_maintenance_date} />
        </DetailRow>
        <DetailRow label="Maintenance interval">{s.maintenance_time_window !== null ? `${formatNumber(s.maintenance_time_window)} days` : "—"}</DetailRow>
        <DetailRow label="Expected maintenance">
          <PlainDate value={s.expected_vehicle_maintenance_date} />
        </DetailRow>
        <DetailRow label="Due date">
          <PlainDate value={s.due_date} />
        </DetailRow>
        <DetailRow label="Days remaining">
          {s.days_until_due !== null ? (
            <span className={cn("font-medium tabular", s.days_until_due < 0 ? "text-danger" : s.days_until_due <= 3 ? "text-warning" : undefined)} data-testid="days-until-due">
              {s.days_until_due < 0 ? `${formatNumber(-s.days_until_due)} days overdue` : s.days_until_due === 0 ? "Due today" : `${formatNumber(s.days_until_due)} days`}
            </span>
          ) : (
            "—"
          )}
        </DetailRow>
        {s.reason ? <DetailRow label="Reason">{s.reason}</DetailRow> : null}
        <DetailRow label="Updated">
          <ServerTime value={s.updated_at} />
        </DetailRow>
      </dl>

      {s.postponed_date || s.postponed_reason ? (
        <section className="rounded-xl border border-line p-3 text-[13px]" aria-label="Postponement" data-testid="schedule-postponed">
          <h4 className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlarmClock className="size-4 text-warning" aria-hidden /> Postponed
          </h4>
          <p>
            To <PlainDate value={s.postponed_date} />
            {s.postponed_reason ? <span className="text-ink-muted"> · {s.postponed_reason}</span> : null}
          </p>
          {s.postponed_at || s.postponed_by !== null ? (
            <p className="mt-0.5 text-xs text-ink-muted">
              {s.postponed_at ? (
                <>
                  On <ServerTime value={s.postponed_at} />
                </>
              ) : null}
              {s.postponed_by !== null ? ` · by ${s.postponed_by}` : null}
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-ink-muted">The expected maintenance date is kept.</p>
        </section>
      ) : null}

      {s.done_date ? (
        <section className="rounded-xl border border-line p-3 text-[13px]" aria-label="Completion" data-testid="schedule-done">
          <h4 className="mb-1 font-semibold">Completed</h4>
          <p>
            Done on <PlainDate value={s.done_date} />
          </p>
        </section>
      ) : null}

      <section aria-labelledby="reminders-h">
        <h4 id="reminders-h" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
          <BellRing className="size-4 text-brand" aria-hidden /> Reminder schedule
        </h4>
        {s.reminder_schedule.length === 0 ? (
          <p className="text-[13px] text-ink-muted">The service returned no reminders for this schedule.</p>
        ) : (
          <ol className="space-y-1.5" data-testid="reminder-schedule">
            {s.reminder_schedule.map((r) => (
              <li key={r.type} className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2 text-[13px]" data-reminder={r.type}>
                <span className="min-w-0">
                  <span className="block font-medium">{r.label ?? humaniseKind(r.type)}</span>
                  {r.days_before !== null ? <span className="text-xs text-ink-muted">{r.days_before === 0 ? "On the due date" : `${r.days_before} day${r.days_before === 1 ? "" : "s"} before`}</span> : null}
                </span>
                <span className="shrink-0 tabular">
                  <PlainDate value={r.date} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function CreateScheduleForm({ tenantId, vehicleNumber, onCancel, onCreated }: { tenantId: number; vehicleNumber: string; onCancel: () => void; onCreated: () => void }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ date?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found: typeof errors = {};
    if (!isPlainDate(date)) found.date = "Enter the date of the last maintenance.";
    if (reason.length > REASON_MAX) found.reason = `Keep the reason under ${REASON_MAX} characters.`;
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      // Only the documented fields: the service calculates the expected date and the interval.
      await maintenanceService.createSchedule(tenantId, { vehicle_number: vehicleNumber, previous_vehicle_maintenance_date: date, reason: reason.trim() || undefined });
      toast.success(`Maintenance schedule created for ${vehicleNumber}`);
      onCreated();
    } catch (err) {
      const fields = isApiError(err) ? err.fieldErrorMap() : {};
      setErrors({ date: fields.previous_vehicle_maintenance_date, reason: fields.reason });
      setFailure(isApiError(err) ? err.message : "The schedule couldn't be created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3 rounded-xl border border-line p-3" onSubmit={submit} noValidate data-testid="create-schedule-form">
      <h4 className="text-[13px] font-semibold">Create maintenance schedule</h4>
      <FormField id="ms-previous" label="Previous maintenance date" error={errors.date} required>
        <Input {...fieldA11y("ms-previous", errors.date)} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </FormField>
      <FormField id="ms-reason" label="Reason (optional)" error={errors.reason}>
        <Textarea {...fieldA11y("ms-reason", errors.reason)} rows={2} maxLength={REASON_MAX} placeholder="Routine vehicle maintenance" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <p className="text-xs text-ink-muted">The service sets the interval (30 days by default) and works out the expected date.</p>
      {failure ? (
        <p className="text-[13px] text-danger" role="alert" data-testid="create-schedule-error">
          {failure}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving} data-testid="create-schedule-submit">
          {saving ? <Loader2 className="animate-spin" /> : null} Create schedule
        </Button>
      </div>
    </form>
  );
}

// ── Tyre Maintenance ────────────────────────────────────────────────────────

/** A datetime-local value (the user's own clock) as an ISO instant with Z, or null. */
export function localInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function TyreMaintenanceTab({ tenantId, vehicleNumber, canWrite }: { tenantId: number; vehicleNumber: string; canWrite: boolean }) {
  const tyreQ = useApiQuery(`maintenance:tyre:${tenantId}:${vehicleNumber}`, () => maintenanceService.getTyre(tenantId, vehicleNumber));
  const alertsQ = useApiQuery(`maintenance:tyre-alerts:${tenantId}:${vehicleNumber}`, () => maintenanceService.tyreAlerts(tenantId, { vehicle_number: vehicleNumber, limit: 5 }));
  const [dialog, setDialog] = useState<"register" | "complete" | null>(null);
  const [when, setWhen] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const missing = isMissing(tyreQ.error);
  const record = tyreQ.data;

  function refreshAll() {
    tyreQ.refetch();
    alertsQ.refetch();
  }

  function open(kind: "register" | "complete") {
    setWhen("");
    setDialogError(null);
    setDialog(kind);
  }

  async function confirm() {
    const iso = when ? localInputToIso(when) : null;
    if (dialog === "register" && !iso) {
      setDialogError("Enter when the current tyres were installed.");
      throw new Error("invalid");
    }
    if (dialog === "complete" && when && !iso) {
      setDialogError("Enter a valid replacement date and time, or leave it empty.");
      throw new Error("invalid");
    }
    try {
      if (dialog === "register") await maintenanceService.registerTyres(tenantId, vehicleNumber, iso!);
      else await maintenanceService.completeTyreReplacement(tenantId, vehicleNumber, iso ?? undefined);
      toast.success(dialog === "register" ? `Tyres registered for ${vehicleNumber}` : `Tyre replacement recorded for ${vehicleNumber}`);
      refreshAll();
    } catch (err) {
      const message = isApiError(err) ? err.message : "The request failed.";
      setDialogError(message);
      toast.error(dialog === "register" ? "Tyres weren't registered" : "Replacement wasn't recorded", { description: message });
      throw err;
    }
  }

  return (
    <div className="space-y-4" data-testid="tyre-maintenance-tab">
      {tyreQ.error && !missing && !record ? (
        <ApiErrorState error={tyreQ.error} onRetry={tyreQ.refetch} compact title="Couldn't load tyre maintenance" />
      ) : missing ? (
        <EmptyState icon={CircleDot} title="No tyre record" description={`Tyre maintenance isn't tracked for ${vehicleNumber} yet.${canWrite ? " Register the tyres it has now to start tracking." : ""}`} className="py-6" />
      ) : !record ? (
        <LoadingSkeleton variant="list" rows={5} />
      ) : (
        <TyreDetails record={record} />
      )}

      {canWrite && (record || missing) ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => open("register")} data-testid="tyre-register-open">
            <CircleDot /> Register existing tyres
          </Button>
          <Button size="sm" onClick={() => open("complete")} disabled={!record} title={!record ? "Register the tyres first" : undefined} data-testid="tyre-complete-open">
            <Wrench /> Complete tyre replacement
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="tyre-alerts-h">
        <h4 id="tyre-alerts-h" className="mb-2 flex items-center justify-between gap-2 text-[13px] font-semibold">
          <span className="flex items-center gap-1.5">
            <BellRing className="size-4 text-brand" aria-hidden /> Latest tyre alerts
          </span>
          <button type="button" onClick={alertsQ.refetch} className="rounded-lg p-1 text-ink-muted hover:bg-surface-muted" aria-label="Refresh tyre alerts">
            <RefreshCw className={cn("size-3.5", alertsQ.refreshing && "animate-spin")} />
          </button>
        </h4>
        {alertsQ.error && !alertsQ.data ? (
          <ApiErrorState error={alertsQ.error} onRetry={alertsQ.refetch} compact title="Couldn't load tyre alerts" />
        ) : !alertsQ.data ? (
          <LoadingSkeleton variant="list" rows={2} />
        ) : alertsQ.data.items.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No tyre alerts for this vehicle.</p>
        ) : (
          <AlertList items={sortNotifications(alertsQ.data.items.map(fromTyreAlert))} showSource={false} />
        )}
      </section>

      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        tone="default"
        title={dialog === "register" ? `Register existing tyres on ${vehicleNumber}?` : `Complete tyre replacement on ${vehicleNumber}?`}
        description={
          dialog === "register"
            ? "Starts tyre-life tracking from when the current tyres were installed."
            : "Records new tyres. Tyre usage starts again from the replacement time; leave it empty to use the service's current time (UTC)."
        }
        confirmLabel={dialog === "register" ? "Register tyres" : "Complete replacement"}
        onConfirm={confirm}
      >
        <FormField id="tyre-when" label={dialog === "register" ? "Installation date and time" : "Replacement date and time (optional)"} error={dialogError ?? undefined} required={dialog === "register"}>
          <Input {...fieldA11y("tyre-when", dialogError ?? undefined)} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </FormField>
        <p className="mt-1 text-xs text-ink-muted">In your local time; sent to the service as UTC.</p>
      </ConfirmDialog>
    </div>
  );
}

function TyreDetails({ record: r }: { record: TyreMaintenanceRecord }) {
  const tone = tyreStatusTone(r.maintenance_status);
  const pct = r.usage_percentage;
  return (
    <div className="space-y-3" data-testid="tyre-details">
      <div className="rounded-xl border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Gauge className="size-4 text-brand" aria-hidden /> Tyre usage
          </span>
          {r.maintenance_status ? (
            <StatusBadge size="sm" tone={tone} icon={CircleDot}>
              <span data-testid="tyre-status">{r.maintenance_status}</span>
            </StatusBadge>
          ) : null}
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-label="Tyre life used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct !== null ? Math.min(100, Math.max(0, pct)) : undefined}
          aria-valuetext={pct !== null ? `${formatNumber(pct)}% used` : "Unknown"}
          data-testid="tyre-progress"
        >
          {pct !== null ? <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /> : null}
        </div>
        <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-ink-muted">
          <span data-testid="tyre-usage">{pct !== null ? `${formatNumber(pct)}% used` : "Usage unknown"}</span>
          <span data-testid="tyre-remaining">{r.remaining_km !== null ? `${formatNumber(r.remaining_km)} km remaining` : "Remaining unknown"}</span>
        </p>
      </div>
      <dl className="divide-y divide-line">
        <DetailRow label="Tyre life limit">{r.tyre_life_limit_km !== null ? `${formatNumber(r.tyre_life_limit_km)} km` : "—"}</DetailRow>
        <DetailRow label="Current distance">{r.current_distance_km !== null ? `${formatNumber(r.current_distance_km)} km` : "—"}</DetailRow>
        <DetailRow label="Remaining">{r.remaining_km !== null ? `${formatNumber(r.remaining_km)} km` : "—"}</DetailRow>
        <DetailRow label="Odometer at tyre change">{r.tyre_change_odometer_km !== null ? `${formatNumber(r.tyre_change_odometer_km)} km` : "—"}</DetailRow>
        <DetailRow label="Last tyre change">
          <ServerTime value={r.last_tyre_change_date} />
        </DetailRow>
        {r.last_limit_reminder_at ? (
          <DetailRow label="Last limit reminder">
            <ServerTime value={r.last_limit_reminder_at} />
          </DetailRow>
        ) : null}
      </dl>
    </div>
  );
}

// ── Maintenance Alerts ──────────────────────────────────────────────────────

export function MaintenanceAlertsTab({ tenantId, vehicleNumber }: { tenantId: number; vehicleNumber: string }) {
  const vehicleQ = useApiQuery(`maintenance:vehicle-alerts:${tenantId}:${vehicleNumber}`, () => maintenanceService.vehicleAlerts(tenantId, vehicleNumber));
  const tyreQ = useApiQuery(`maintenance:tyre-alerts-all:${tenantId}:${vehicleNumber}`, () => maintenanceService.tyreAlerts(tenantId, { vehicle_number: vehicleNumber, limit: 50 }));
  const vehicleMissing = isMissing(vehicleQ.error);
  const loading = (!vehicleQ.data && !vehicleQ.error) || (!tyreQ.data && !tyreQ.error);
  const items = sortNotifications([...(vehicleQ.data ? vehicleAlertNotifications(vehicleQ.data, vehicleNumber) : []), ...(tyreQ.data?.items ?? []).map(fromTyreAlert)]);

  return (
    <div className="space-y-3" data-testid="maintenance-alerts-tab">
      {vehicleQ.error && !vehicleMissing ? <ApiErrorState error={vehicleQ.error} onRetry={vehicleQ.refetch} compact title="Couldn't load vehicle maintenance alerts" /> : null}
      {tyreQ.error ? <ApiErrorState error={tyreQ.error} onRetry={tyreQ.refetch} compact title="Couldn't load tyre maintenance alerts" /> : null}
      {loading ? (
        <LoadingSkeleton variant="list" rows={3} />
      ) : items.length === 0 && !(vehicleQ.error && !vehicleMissing) && !tyreQ.error ? (
        <EmptyState icon={BellRing} title="No maintenance alerts" description={`No vehicle or tyre maintenance alerts for ${vehicleNumber}.`} className="py-6" />
      ) : items.length ? (
        <AlertList items={items} showSource />
      ) : null}
      <p className="text-xs text-ink-muted">Vehicle maintenance shows the latest three alerts the service keeps for a vehicle.</p>
    </div>
  );
}

export function SourceLabel({ source }: { source: MaintenanceNotification["source"] }) {
  return (
    <span className={cn("rounded-full px-1.5 py-px text-[10.5px] font-semibold", source === "TYRE_MAINTENANCE" ? "bg-powder text-ink" : "bg-brand-soft text-brand-deep")} data-source={source}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

export const TONE_DOT: Record<MaintenanceTone, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-ink-subtle" };

const KIND_BADGE: Record<MaintenanceTone, string> = { success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", neutral: "bg-surface-muted text-ink-muted" };

/** A vehicle alert's `kind` ("Overdue" in red); any other kind is shown humanised in the alert's tone. */
export function AlertKindBadge({ n }: { n: MaintenanceNotification }) {
  if (!n.kindLabel) return null;
  return (
    <span className={cn("rounded-full px-1.5 py-px text-[10.5px] font-semibold", KIND_BADGE[n.tone])} data-kind={n.kind ?? undefined} data-testid="maintenance-alert-kind">
      {n.kindLabel}
    </span>
  );
}

/** Due date, alert date and driver of a vehicle alert. Plain dates are formatted from their own digits. */
export function AlertDates({ n }: { n: MaintenanceNotification }) {
  return (
    <>
      {n.dueDate ? <span data-testid="maintenance-alert-due">Due {formatPlainDate(n.dueDate)}</span> : null}
      {n.alertDate ? <span data-testid="maintenance-alert-date">Alert {formatPlainDate(n.alertDate)}</span> : null}
      {n.driverName ? <span data-testid="maintenance-alert-driver">Driver {n.driverName}</span> : null}
    </>
  );
}

export function AlertList({ items, showSource }: { items: MaintenanceNotification[]; showSource: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line" data-testid="maintenance-alert-list">
      {items.map((n) => (
        <li key={n.id} className="flex items-start gap-2.5 px-3 py-2.5" data-alert-id={n.id}>
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[n.tone])} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
              {n.title}
              <AlertKindBadge n={n} />
              {showSource ? <SourceLabel source={n.source} /> : null}
              {n.isReminder ? <span className="rounded-full bg-surface-muted px-1.5 py-px text-[10.5px] text-ink-muted">Reminder</span> : null}
            </p>
            {n.message ? <p className="mt-0.5 text-xs text-ink-muted">{n.message}</p> : null}
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-subtle">
              <ServerTime value={n.createdAt} />
              {n.severityLabel ? <span>{n.severityLabel}</span> : null}
              <AlertDates n={n} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
