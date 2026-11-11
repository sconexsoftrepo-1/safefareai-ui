"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Lock, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { DeviceDto, DeviceModelDto } from "@/features/drive-vision/api/types";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { canViewWidget } from "@/features/drive-vision/access/access-policy";
import { ConfirmDialog } from "../shared/confirm-dialog";
import { FormField, fieldA11y } from "../shared/form-field";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { toast } from "../shared/toast-provider";
import { EDITABLE_FIELDS, LOCKED_FIELDS, MAX_LENGTH, baselineRequest, buildUpdate, changedFields, formFromDevice, lockedViolations, validateEdit, type EditForm, type EditableField } from "./device-edit-model";
import { KEEP, applyMapping, currentVehicleId, describeMappingError, needsReassignConfirm, type MappingChange, type VehicleOption } from "./device-vehicle-model";
import { ReassignConfirmDialog, VehicleAssignField, useVehicleChoices } from "./vehicle-assign-field";

const LABELS: Record<EditableField, string> = {
  name: "Device name",
  plateColor: "Plate colour",
  simNumber: "SIM number",
  frameNo: "Frame / VIN",
  remark: "Remark",
  insuranceDueAt: "Insurance due",
  maintenanceDueAt: "Next maintenance",
  driverName: "Driver name",
  driverCard: "Driver card",
  driverPhone: "Driver phone",
  drivingLicense: "Driving licence",
  driverRemark: "Driver remark",
};
const TEXTAREAS = new Set<EditableField>(["remark", "driverRemark"]);
const DATES = new Set<EditableField>(["insuranceDueAt", "maintenanceDueAt"]);

/**
 * Edit a device's descriptive fields (PUT /api/v1/devices/{id}). Opened only when the resolver allows
 * `devices.update` (device.update, and a selected tenant for the Safe-Fare Admin). Locked fields are shown
 * read-only and resent unchanged; nothing is reported as saved until the server answers.
 *
 * Vehicle (device-vehicle-model.ts): every save is ONE full DeviceRequest PUT to this device.
 * - Another available vehicle: staged, sent with "Save changes" ({vehicleId, unlinkVehicle: false}).
 * - A vehicle another device holds: "Vehicle Already Assigned" confirmation; Confirm sends the PUT at once, Cancel
 *   sends nothing. The other device is never unlinked by the app; a refusal (e.g. 409) is shown as the server gave it.
 * - Unlink: confirmation, then the PUT with {vehicleId: 0, unlinkVehicle: true}.
 * - No vehicle change: neither field is sent (the contract keeps the current vehicle).
 */
export function DeviceEditPanel({
  device,
  models,
  lockedLabels,
  open,
  onClose,
  onSaved,
  onNeedsReload,
}: {
  device: DeviceDto;
  models: readonly DeviceModelDto[] | undefined;
  /** Display values for locked fields (resolved names). */
  lockedLabels: Record<keyof typeof LOCKED_FIELDS, string>;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onNeedsReload: () => void;
}) {
  const baseline = useMemo(() => baselineRequest(device, models), [device, models]);
  const original = useMemo(() => formFromDevice(device), [device]);
  const [form, setForm] = useState<EditForm>(original);
  const [errors, setErrors] = useState<Partial<Record<EditableField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Blocks a second PUT before React re-renders with saving = true (double click, Enter + click).
  const inFlight = useRef(false);

  const canPickVehicle = canViewWidget(useAccess(), "devices.vehicleChoices");
  const vehicles = useVehicleChoices(canPickVehicle);
  const currentId = currentVehicleId(device, vehicles.options);
  const current = vehicles.options.find((o) => o.vehicleId === currentId);
  // Unknown = the device response has no vehicleId field and the vehicle list (to look it up) isn't loaded.
  const currentKnown = typeof device.vehicleId === "number" || device.vehicleId === null || vehicles.query.data !== undefined;
  const [mapping, setMapping] = useState<MappingChange>(KEEP);
  const [pendingReassign, setPendingReassign] = useState<VehicleOption | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const formBody = baseline.body ? buildUpdate(baseline.body, original, form) : null;
  const changes = baseline.body && formBody ? changedFields(baseline.body, formBody) : [];
  const vehicleChanged = mapping.kind !== "keep";
  const changeCount = changes.length + (vehicleChanged ? 1 : 0);
  const changeLabels = [...changes.map((c) => LABELS[c]), ...(vehicleChanged ? ["Vehicle"] : [])];
  const pickerValue = mapping.kind === "assign" ? String(mapping.vehicleId) : currentId !== null ? String(currentId) : "";
  const currentLabel = current?.vehicleNumber ?? (currentId !== null ? `Vehicle #${currentId}` : null);

  function pickVehicle(o: VehicleOption | null) {
    if (!o || o.vehicleId === currentId) return setMapping(KEEP);
    if (needsReassignConfirm(o, device.id)) return setPendingReassign(o);
    setMapping({ kind: "assign", vehicleId: o.vehicleId, vehicleNumber: o.vehicleNumber, reassign: false });
  }

  /** One full-DeviceRequest PUT with the form's edits and `change` applied. Reports its own failure; never throws. */
  async function save(change: MappingChange) {
    const fields = baseline.body ? buildUpdate(baseline.body, original, form) : null;
    const body = fields ? applyMapping(fields, change) : null;
    if (saving || !baseline.body || !body) return;
    if (inFlight.current) return;
    const found = validateEdit(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) {
      if (change.kind !== "keep") setFailure("Fix the highlighted fields first: the vehicle change is sent together with them.");
      return;
    }
    const violations = lockedViolations(baseline.body, body);
    if (violations.length) {
      setFailure(`Not sent: locked field(s) would change (${violations.join(", ")}).`);
      return;
    }
    const fieldChanges = changedFields(baseline.body, body);
    if (fieldChanges.length === 0 && change.kind === "keep") {
      setFailure("Nothing changed.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      await fleetService.updateDevice(device.id!, body);
      toast.success(change.kind === "unlink" ? "Vehicle unlinked" : change.kind === "assign" ? `Vehicle ${change.vehicleNumber} assigned` : "Device updated", {
        description: [change.kind === "unlink" ? `${device.name ?? "The device"} has no vehicle now.` : null, fieldChanges.length ? `${fieldChanges.length} field${fieldChanges.length === 1 ? "" : "s"} saved.` : null].filter(Boolean).join(" ") || undefined,
      });
      onSaved();
    } catch (err) {
      const outcome = describeMappingError(err, change);
      setErrors(outcome.fieldErrors);
      setFailure(outcome.message);
      toast.error(change.kind === "unlink" ? "The vehicle wasn't unlinked" : change.kind === "assign" ? "The vehicle wasn't assigned" : "The device wasn't updated", { description: outcome.message });
      // A refused mapping change: show the real (unchanged) assignment again. The other edits stay in the form.
      if (outcome.conflict || change.kind === "unlink" || (change.kind === "assign" && change.reassign)) setMapping(KEEP);
      if (outcome.refetch) onNeedsReload();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void save(mapping);
  }

  return (
    <SlideOverPanel
      open={open}
      onOpenChange={(o) => !o && !saving && onClose()}
      title={`Edit ${device.name ?? `device ${device.id}`}`}
      description="Saves to the SafeFare server, which may update the device at the vendor."
      width="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-ink-muted" data-testid="device-edit-changes">
            {baseline.body ? (changeCount ? `${changeCount} change${changeCount === 1 ? "" : "s"}: ${changeLabels.join(", ")}` : "No changes yet") : ""}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="device-edit-form" disabled={saving || !baseline.body || changeCount === 0}>
              {saving ? <Loader2 className="animate-spin" /> : null} Save changes
            </Button>
          </span>
        </div>
      }
    >
      {!baseline.body ? (
        <div className="space-y-2 rounded-xl bg-warning-soft px-3 py-3 text-[13px] text-warning" role="alert" data-testid="device-edit-blocked">
          <p className="font-medium">This device can&apos;t be edited safely right now.</p>
          <ul className="list-disc pl-5">
            {baseline.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-xs">A full update must resend every required field exactly as stored, including the model (which may be chargeable).</p>
        </div>
      ) : (
        <form id="device-edit-form" className="space-y-4" onSubmit={submit} noValidate data-testid="device-edit-form">
          {failure ? (
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert" data-testid="device-edit-error">
              {failure}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.slice(0, 7).map((f) => (
              <Field key={f} f={f} form={form} setForm={setForm} errors={errors} setErrors={setErrors} disabled={saving} />
            ))}
          </div>
          <section aria-labelledby="device-vehicle-title" className="space-y-2 rounded-xl border border-line/70 px-3 py-3" data-testid="device-edit-vehicle">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="device-vehicle-title" className="text-[13px] font-semibold text-ink">
                Vehicle
              </h3>
              {currentId !== null ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmUnlink(true)} disabled={saving} data-testid="device-unlink-button">
                  <Unlink /> Unlink vehicle
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-ink-muted" data-testid="device-current-vehicle">
              {!currentKnown ? "The current vehicle isn't reported by the server." : currentLabel ? `Currently assigned: ${currentLabel}` : "No vehicle assigned."}
            </p>
            <VehicleAssignField
              id="de-vehicleId"
              label={currentId !== null ? "Assigned Vehicle" : "Assign Vehicle"}
              permitted={canPickVehicle}
              choices={vehicles}
              value={pickerValue}
              onPick={pickVehicle}
              editingDeviceId={device.id}
              disabled={saving}
              hint={mapping.kind === "assign" ? `${mapping.vehicleNumber} will be assigned to this device when you save.` : undefined}
            />
            {mapping.kind === "assign" ? (
              <Button type="button" variant="ghost" size="xs" onClick={() => setMapping(KEEP)} disabled={saving}>
                Keep {currentLabel ?? "no vehicle"}
              </Button>
            ) : null}
          </section>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-[13px] font-semibold text-ink">Driver (stored on the device)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {EDITABLE_FIELDS.slice(7).map((f) => (
                <Field key={f} f={f} form={form} setForm={setForm} errors={errors} setErrors={setErrors} disabled={saving} />
              ))}
            </div>
          </fieldset>
          <section aria-labelledby="locked-title" className="rounded-xl bg-surface-muted px-3 py-2" data-testid="device-edit-locked">
            <h3 id="locked-title" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Lock className="size-3.5" aria-hidden /> Not editable here (resent unchanged)
            </h3>
            <dl>
              {(Object.keys(LOCKED_FIELDS) as (keyof typeof LOCKED_FIELDS)[]).map((k) => (
                <DetailRow key={k} label={lockedLabelName[k]}>
                  <span title={LOCKED_FIELDS[k]}>{lockedLabels[k]}</span>
                  <span className="block text-[11px] text-ink-subtle">{LOCKED_FIELDS[k]}</span>
                </DetailRow>
              ))}
            </dl>
          </section>
        </form>
      )}
      <ReassignConfirmDialog
        option={pendingReassign}
        target="editing"
        onCancel={() => setPendingReassign(null)}
        onConfirm={() => (pendingReassign ? save({ kind: "assign", vehicleId: pendingReassign.vehicleId, vehicleNumber: pendingReassign.vehicleNumber, reassign: true }) : undefined)}
      />
      <ConfirmDialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title="Unlink vehicle?"
        confirmLabel="Unlink vehicle"
        description={`${currentLabel ?? "The vehicle"} will be removed from ${device.name ?? `device ${device.id}`}. The device stays registered, with no vehicle, until you assign one.`}
        onConfirm={() => save({ kind: "unlink" })}
      >
        {changes.length ? <p className="text-xs text-ink-muted">Your other changes in this form ({changes.map((c) => LABELS[c]).join(", ")}) are saved with it.</p> : null}
      </ConfirmDialog>
    </SlideOverPanel>
  );
}

const lockedLabelName: Record<keyof typeof LOCKED_FIELDS, string> = {
  modelName: "Model",
  protocol: "Protocol",
  cameraCount: "Cameras",
  terminalNo: "Device ID (terminal)",
  groupId: "Group",
  objectTypeId: "Object type",
  driverGender: "Driver gender",
};

function Field({
  f,
  form,
  setForm,
  errors,
  setErrors,
  disabled,
}: {
  f: EditableField;
  form: EditForm;
  setForm: (u: (p: EditForm) => EditForm) => void;
  errors: Partial<Record<EditableField, string>>;
  setErrors: (u: (p: Partial<Record<EditableField, string>>) => Partial<Record<EditableField, string>>) => void;
  disabled: boolean;
}) {
  const id = `de-${f}`;
  const onChange = (v: string) => {
    setForm((p) => ({ ...p, [f]: v }));
    if (errors[f]) setErrors((p) => ({ ...p, [f]: undefined }));
  };
  return (
    <FormField id={id} label={LABELS[f]} error={errors[f]} required={f === "name"} className={TEXTAREAS.has(f) ? "sm:col-span-2" : undefined}>
      {TEXTAREAS.has(f) ? (
        <Textarea {...fieldA11y(id, errors[f])} rows={2} maxLength={MAX_LENGTH[f]} value={form[f]} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      ) : (
        <Input {...fieldA11y(id, errors[f])} type={DATES.has(f) ? "date" : f === "driverPhone" ? "tel" : "text"} maxLength={MAX_LENGTH[f]} value={form[f]} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      )}
    </FormField>
  );
}
