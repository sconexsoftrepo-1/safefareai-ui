"use client";

import { useMemo } from "react";
import { CircleCheck, CircleDot, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { describeApiError } from "@/features/drive-vision/api/errors";
import { vehicleRegistryService } from "@/features/drive-vision/api/vehicle-registry-service";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField } from "../shared/form-field";
import { assignmentState, holderLabel, vehicleDetailLine, vehicleListNotice, type VehicleOption, toVehicleOptions } from "./device-vehicle-model";

/** The "no vehicle" choice of the Add device picker (Radix items can't use ""). */
export const NO_VEHICLE = "none";

/**
 * Vehicles for the Assign Vehicle picker: GET /api/v1/vehicles (assigned AND unassigned — an assigned vehicle can be
 * picked to start a reassignment), every page of 100. Tenant-scoped by the shared client and the query key, like
 * every fleet read. `enabled` = the user has vehicle.read (widget devices.vehicleChoices).
 */
export function useVehicleChoices(enabled: boolean) {
  const query = useApiQuery(enabled ? "device-form:vehicles" : null, () => vehicleRegistryService.listAllVehicles());
  const options = useMemo(() => toVehicleOptions(query.data?.items), [query.data]);
  return { query, options };
}

const STATE_META = {
  available: { label: "Available", className: "bg-success-soft text-success", icon: CircleCheck },
  current: { label: "This device", className: "bg-info-soft text-info", icon: CircleDot },
  "assigned-elsewhere": { label: "Assigned", className: "bg-warning-soft text-warning", icon: CircleDot },
} as const;

/** Available (green) / Assigned (amber) / This device — always icon + text, never colour alone. */
export function AssignmentBadge({ option, editingDeviceId }: { option: VehicleOption; editingDeviceId?: number | null }) {
  const meta = STATE_META[assignmentState(option, editingDeviceId)];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.className)} data-testid="vehicle-assignment-badge" data-state={assignmentState(option, editingDeviceId)}>
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * The Assign Vehicle select (Add and Edit device). Each vehicle shows its number and status, type · make model,
 * and — when another device holds it — "Currently assigned to: <device>". Picking does not save anything: the form
 * decides (Add: part of the POST; Edit: an assigned vehicle first asks for confirmation).
 */
export function VehicleAssignField({
  id,
  label,
  permitted,
  choices,
  value,
  onPick,
  editingDeviceId,
  allowNone = false,
  disabled = false,
  error,
  hint,
}: {
  id: string;
  label: string;
  /** vehicle.read (widget devices.vehicleChoices). Without it the picker isn't offered. */
  permitted: boolean;
  choices: ReturnType<typeof useVehicleChoices>;
  /** The selected vehicle id as a string; "" = none. */
  value: string;
  onPick: (option: VehicleOption | null) => void;
  editingDeviceId?: number | null;
  allowNone?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
}) {
  const { query, options } = choices;
  const selected = options.find((o) => String(o.vehicleId) === value);
  const notice = query.data ? vehicleListNotice(options, { truncated: query.data.truncated, total: query.data.total, editingDeviceId }) : null;

  let control: React.ReactNode;
  if (!permitted) {
    control = (
      <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-muted" data-testid="vehicle-assign-forbidden">
        {value ? `Vehicle #${value}. ` : ""}Choosing a vehicle needs the vehicle.read permission.
      </p>
    );
  } else if (query.error && !query.data) {
    control = (
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert" data-testid="vehicle-assign-error">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Couldn&apos;t load vehicles: {describeApiError(query.error)}</span>
        <Button type="button" size="sm" variant="outline" onClick={query.refetch} disabled={query.refreshing}>
          <RefreshCw className={query.refreshing ? "animate-spin" : undefined} /> Retry
        </Button>
      </div>
    );
  } else {
    control = (
      <Select value={value === "" ? (allowNone && query.data ? NO_VEHICLE : "") : value} onValueChange={(v) => onPick(v === NO_VEHICLE ? null : (options.find((o) => String(o.vehicleId) === v) ?? null))} disabled={disabled || !query.data}>
        <SelectTrigger id={id} className="h-auto min-h-10 w-full" aria-invalid={error ? true : undefined} data-testid="vehicle-assign-trigger">
          <SelectValue placeholder={query.data ? (options.length ? "Choose a vehicle" : "No vehicles") : "Loading vehicles…"}>
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold tabular">{selected.vehicleNumber}</span>
                <AssignmentBadge option={selected} editingDeviceId={editingDeviceId} />
              </span>
            ) : value === "" && allowNone && query.data ? (
              "No vehicle"
            ) : value ? (
              `Vehicle #${value}`
            ) : undefined}
          </SelectValue>
          {!query.data && query.loading ? <Loader2 className="ml-auto animate-spin" aria-hidden /> : null}
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          {allowNone ? <SelectItem value={NO_VEHICLE}>No vehicle</SelectItem> : null}
          {options.map((o) => {
            const state = assignmentState(o, editingDeviceId);
            const detail = vehicleDetailLine(o);
            return (
              <SelectItem key={o.vehicleId} value={String(o.vehicleId)} className="items-start py-2">
                <span className="flex min-w-0 flex-col gap-0.5" data-testid="vehicle-option" data-vehicle-id={o.vehicleId}>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink tabular">{o.vehicleNumber}</span>
                    <AssignmentBadge option={o} editingDeviceId={editingDeviceId} />
                  </span>
                  {detail ? <span className="text-xs text-ink-muted">{detail}</span> : null}
                  {state === "assigned-elsewhere" ? <span className="text-xs text-warning">Currently assigned to: {holderLabel(o)}</span> : null}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  return (
    <FormField id={id} label={label} error={error} hint={hint} className="sm:col-span-2">
      {control}
      {permitted && notice ? (
        <p className="text-xs text-ink-muted" data-testid="vehicle-assign-notice">
          {notice}
        </p>
      ) : null}
      {permitted && query.error && query.data ? <p className="text-xs text-warning">Showing the last loaded vehicles: {describeApiError(query.error)}</p> : null}
    </FormField>
  );
}

/**
 * "Vehicle Already Assigned": shown before an assigned vehicle is taken over. Nothing is sent on Cancel. `onConfirm`
 * runs the save (Edit) or keeps the choice (Add); it should report its own failure rather than throw.
 */
export function ReassignConfirmDialog({ option, target, onCancel, onConfirm }: { option: VehicleOption | null; target: "editing" | "adding"; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  return (
    <ConfirmDialog
      open={option !== null}
      onOpenChange={(open) => !open && onCancel()}
      title="Vehicle Already Assigned"
      tone="default"
      confirmLabel="Confirm Reassignment"
      description={option ? `Vehicle ${option.vehicleNumber} is currently assigned to another device.` : undefined}
      onConfirm={onConfirm}
    >
      {option ? (
        <div className="space-y-3 text-[13px]" data-testid="reassign-confirm">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl bg-surface-muted px-3 py-2">
            <dt className="text-ink-muted">Current device</dt>
            <dd className="truncate font-medium text-ink" data-testid="reassign-device-name">
              {option.deviceName ?? (option.deviceId !== null ? `Device #${option.deviceId}` : "Not reported")}
            </dd>
            <dt className="text-ink-muted">Terminal number</dt>
            <dd className="truncate font-mono text-ink" data-testid="reassign-terminal">
              {option.terminalNo ?? "Not reported"}
            </dd>
          </dl>
          <p className="text-ink">Reassigning this vehicle will move it from its current device to the device you are {target}.</p>
          <p className="text-xs text-ink-muted">The server decides whether the move is allowed. If it refuses, the current assignment stays as it is and its reason is shown.</p>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
