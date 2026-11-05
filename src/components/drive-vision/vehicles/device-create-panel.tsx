"use client";

import { useMemo, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import type { DeviceDto, DeviceModelDto, GroupDto, ObjectTypeDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { FormField, fieldA11y } from "../shared/form-field";
import { SlideOverPanel } from "../shared/slide-over-panel";
import { toast } from "../shared/toast-provider";
import { EDITABLE_FIELDS, MAX_LENGTH, type EditableField } from "./device-edit-model";
import { EMPTY_CREATE_FORM, buildCreate, describeCreateError, protocolChoices, validateCreate, type CreateField, type CreateForm } from "./device-create-model";

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
 * Register a device (POST /api/v1/devices). Opened only when the resolver allows `devices.create` (device.create,
 * and a selected tenant for the Safe-Fare Admin). Nothing is reported as created until the server answers.
 */
export function DeviceCreatePanel({ groups, models, onClose, onCreated, onUncertain }: { groups: readonly GroupDto[]; models: readonly DeviceModelDto[] | undefined; onClose: () => void; onCreated: (d: DeviceDto) => void; onUncertain: () => void }) {
  const protocolsQ = useApiQuery("ref:protocols", () => fleetService.protocols());
  const typesQ = useApiQuery("ref:object-types", () => fleetService.objectTypes());
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [errors, setErrors] = useState<Partial<Record<CreateField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when the server asks to confirm a chargeable registration; the user must tick the box to resend.
  const [chargeNotice, setChargeNotice] = useState<string | null>(null);
  const [chargeAccepted, setChargeAccepted] = useState(false);

  const model = models?.find((m) => String(m.id) === form.modelId);
  const protocols = useMemo(() => protocolChoices(model, protocolsQ.data?.items ?? []), [model, protocolsQ.data]);
  const objectTypes: ObjectTypeDto[] = (typesQ.data?.items ?? []).filter((t) => typeof t.id === "number");

  const set = (patch: Partial<CreateForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    // Any change after a charge notice needs a fresh confirmation from the server.
    setChargeNotice(null);
    setChargeAccepted(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !models) return;
    const found = validateCreate(form, models);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    if (chargeNotice && !chargeAccepted) {
      setFailure("Tick the box to accept the charge, or cancel.");
      return;
    }
    setSaving(true);
    try {
      const created = await fleetService.createDevice(buildCreate(form, models, chargeNotice !== null && chargeAccepted));
      toast.success(`${created.name ?? form.name.trim()} registered`, { description: created.terminalNo ?? form.terminalNo.trim() });
      onCreated(created);
    } catch (err) {
      const outcome = describeCreateError(err);
      if (outcome.kind === "confirm") {
        setChargeNotice(outcome.message);
        setChargeAccepted(false);
      } else {
        setErrors(outcome.fieldErrors);
        setFailure(outcome.message);
        toast.error("The device wasn't registered", { description: outcome.message });
        if (outcome.uncertain) onUncertain();
      }
    } finally {
      setSaving(false);
    }
  }

  const select = (f: "groupId" | "modelId" | "protocol" | "objectTypeId", label: string, options: { value: string; label: string }[], placeholder: string, extra?: Partial<CreateForm>) => (
    <FormField id={`dc-${f}`} label={label} error={errors[f]} required>
      <Select value={form[f]} onValueChange={(v) => set({ [f]: v, ...extra })} disabled={saving || options.length === 0}>
        <SelectTrigger id={`dc-${f}`} className="w-full" aria-invalid={errors[f] ? true : undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );

  const text = (f: EditableField) => (
    <FormField key={f} id={`dc-${f}`} label={LABELS[f]} error={errors[f]} required={f === "name"} className={TEXTAREAS.has(f) ? "sm:col-span-2" : undefined}>
      {TEXTAREAS.has(f) ? (
        <Textarea {...fieldA11y(`dc-${f}`, errors[f])} rows={2} maxLength={MAX_LENGTH[f]} value={form[f]} onChange={(e) => set({ [f]: e.target.value })} disabled={saving} />
      ) : (
        <Input {...fieldA11y(`dc-${f}`, errors[f])} type={DATES.has(f) ? "date" : f === "driverPhone" ? "tel" : "text"} maxLength={MAX_LENGTH[f]} value={form[f]} onChange={(e) => set({ [f]: e.target.value })} disabled={saving} />
      )}
    </FormField>
  );

  return (
    <SlideOverPanel
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Add vehicle"
      description="Registers the device on the SafeFare server, which also registers it with the GPS vendor."
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="device-create-form" disabled={saving || !models || (chargeNotice !== null && !chargeAccepted)}>
            {saving ? <Loader2 className="animate-spin" /> : null} {chargeNotice ? "Accept charge and register" : "Register vehicle"}
          </Button>
        </div>
      }
    >
      <form id="device-create-form" className="space-y-4" onSubmit={submit} noValidate data-testid="device-create-form">
        {failure ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
        {!models ? <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning">The device-model catalogue couldn&apos;t be loaded, so a device can&apos;t be registered right now.</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {text("name")}
          <FormField id="dc-terminalNo" label="Device ID (terminal no.)" error={errors.terminalNo} required>
            <Input {...fieldA11y("dc-terminalNo", errors.terminalNo)} className="font-mono" maxLength={20} placeholder="71080050829" value={form.terminalNo} onChange={(e) => set({ terminalNo: e.target.value.replace(/\s/g, "") })} disabled={saving} />
          </FormField>
          {select(
            "groupId",
            "Group",
            groups.filter((g) => typeof g.id === "number").map((g) => ({ value: String(g.id), label: g.name ?? `Group ${g.id}` })),
            "Choose a group"
          )}
          {select(
            "modelId",
            "Device model",
            (models ?? []).filter((m) => typeof m.id === "number" && m.name?.trim()).map((m) => ({ value: String(m.id), label: m.name! })),
            "Choose a model",
            { protocol: "" }
          )}
          {select(
            "protocol",
            "Protocol",
            protocols.map((p) => ({ value: String(p.code), label: p.name ?? `Protocol ${p.code}` })),
            protocolsQ.data || model?.protocols?.length ? "Choose a protocol" : "Loading protocols…"
          )}
          {select(
            "objectTypeId",
            "Object type",
            objectTypes.map((t) => ({ value: String(t.id), label: t.name ?? `Type ${t.id}` })),
            typesQ.data ? "Choose a type" : "Loading types…"
          )}
          <FormField id="dc-cameraCount" label="Cameras" error={errors.cameraCount} required>
            <Input {...fieldA11y("dc-cameraCount", errors.cameraCount)} type="number" min={0} max={16} inputMode="numeric" value={form.cameraCount} onChange={(e) => set({ cameraCount: e.target.value })} disabled={saving} />
          </FormField>
          {EDITABLE_FIELDS.slice(1, 7).map(text)}
        </div>
        <fieldset className="space-y-3">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Driver (optional, stored on the device)</legend>
          <div className="grid gap-3 sm:grid-cols-2">{EDITABLE_FIELDS.slice(7).map(text)}</div>
        </fieldset>

        {chargeNotice ? (
          <div className="space-y-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-3 text-[13px] text-warning" role="alert" data-testid="device-create-charge">
            <p className="flex items-start gap-1.5 font-medium">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> The server needs confirmation before registering this device:
            </p>
            <p className="text-ink">{chargeNotice}</p>
            <label className="flex items-start gap-2 text-ink">
              <Checkbox checked={chargeAccepted} onCheckedChange={(v) => setChargeAccepted(v === true)} aria-label="Accept the charge" />
              <span>I accept this and want to register the device.</span>
            </label>
          </div>
        ) : null}
      </form>
    </SlideOverPanel>
  );
}
