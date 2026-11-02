"use client";

import { useMemo, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { DeviceDto, DeviceModelDto } from "@/features/drive-vision/api/types";
import { FormField, fieldA11y } from "../shared/form-field";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { toast } from "../shared/toast-provider";
import { EDITABLE_FIELDS, LOCKED_FIELDS, MAX_LENGTH, baselineRequest, buildUpdate, changedFields, describeSaveError, formFromDevice, lockedViolations, validateEdit, type EditForm, type EditableField } from "./device-edit-model";

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

  const body = baseline.body ? buildUpdate(baseline.body, original, form) : null;
  const changes = baseline.body && body ? changedFields(baseline.body, body) : [];
  const violations = baseline.body && body ? lockedViolations(baseline.body, body) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !baseline.body || !body) return;
    const found = validateEdit(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    if (violations.length) {
      setFailure(`Not sent: locked field(s) would change (${violations.join(", ")}).`);
      return;
    }
    if (changes.length === 0) {
      setFailure("Nothing changed.");
      return;
    }
    setSaving(true);
    try {
      await fleetService.updateDevice(device.id!, body);
      toast.success("Device updated", { description: `${changes.length} field${changes.length === 1 ? "" : "s"} saved.` });
      onSaved();
    } catch (err) {
      const outcome = describeSaveError(err);
      setErrors(outcome.fieldErrors);
      setFailure(outcome.message);
      toast.error("The device wasn't updated", { description: outcome.message });
      if (outcome.refetch) onNeedsReload();
    } finally {
      setSaving(false);
    }
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
            {baseline.body ? (changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}: ${changes.map((c) => LABELS[c]).join(", ")}` : "No changes yet") : ""}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="device-edit-form" disabled={saving || !baseline.body || changes.length === 0}>
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
          <p className="text-xs text-ink-muted">
            Activation and service expiry are managed by the vendor and can&apos;t be changed. A cleared field is omitted from the update; whether the server then clears it isn&apos;t documented.
          </p>
        </form>
      )}
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
