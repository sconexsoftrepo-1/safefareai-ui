"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DeviceProtocol, ObjectType, PlateColor, Vehicle, VehicleInput } from "@/features/drive-vision/types";
import { PROTOCOL_LABELS, TERMINAL_MODELS, VEHICLE_TYPES } from "@/features/drive-vision/mock-data/catalog";
import { useFleet } from "@/features/drive-vision/store/fleet-store";
import { ServiceError } from "@/features/drive-vision/services/core";
import { FormField, fieldA11y } from "../shared/form-field";

const NONE = "__none__";
const PLATE_COLORS: PlateColor[] = ["white", "yellow", "blue", "green", "black"];
const OBJECT_TYPES: { value: ObjectType; label: string }[] = [
  { value: "car", label: "Vehicle" },
  { value: "people", label: "Person" },
  { value: "pets", label: "Pet" },
  { value: "others", label: "Other asset" },
];

type FormState = {
  vehicleName: string;
  plate: string;
  plateColor: PlateColor;
  vehicleType: string;
  objectType: ObjectType;
  groupId: string;
  terminalNo: string;
  terminalType: string;
  protocol: string;
  cameraNum: string;
  sim: string;
  frameNo: string;
  driverId: string;
  insuranceDueDate: string;
  maintainDate: string;
  remark: string;
};

type Errors = Partial<Record<keyof FormState, string>>;

const toDateInput = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (v: string) => (v ? new Date(`${v}T00:00:00+05:30`).toISOString() : undefined);

function initialState(v?: Vehicle, defaultGroupId?: string): FormState {
  return {
    vehicleName: v?.vehicleName ?? "",
    plate: v?.plate ?? "",
    plateColor: v?.plateColor ?? "yellow",
    vehicleType: v?.vehicleType ?? "",
    objectType: v?.objectType ?? "car",
    groupId: v?.groupId ?? defaultGroupId ?? "",
    terminalNo: v?.terminalNo ?? "",
    terminalType: v?.terminalType ?? "",
    protocol: v ? String(v.protocol) : "",
    cameraNum: v ? String(v.cameraNum) : "",
    sim: v?.sim ?? "",
    frameNo: v?.frameNo ?? "",
    driverId: v?.driverId ?? NONE,
    insuranceDueDate: toDateInput(v?.insuranceDueDate),
    maintainDate: toDateInput(v?.maintainDate),
    remark: v?.remark ?? "",
  };
}

export function validateVehicle(f: FormState): Errors {
  const e: Errors = {};
  const model = TERMINAL_MODELS.find((m) => m.name === f.terminalType);
  if (!f.vehicleName.trim()) e.vehicleName = "Enter a vehicle name.";
  if (!f.plate.trim()) e.plate = "Enter the registration plate.";
  else if (!/^[A-Z0-9 -]{4,14}$/i.test(f.plate.trim())) e.plate = "Use 4–14 letters, digits, spaces or dashes.";
  if (!f.vehicleType) e.vehicleType = "Choose a vehicle type.";
  if (!f.groupId) e.groupId = "Choose a group.";
  if (!f.terminalNo.trim()) e.terminalNo = "Enter the device ID (terminal number).";
  else if (!/^\d{10,15}$/.test(f.terminalNo.trim())) e.terminalNo = "Device ID must be 10–15 digits.";
  if (!f.terminalType) e.terminalType = "Choose the device model.";
  if (!f.protocol) e.protocol = "Choose a protocol.";
  else if (model && !model.protocols.includes(Number(f.protocol) as DeviceProtocol)) e.protocol = "This model does not support that protocol.";
  if (f.cameraNum === "") e.cameraNum = "Enter the number of cameras.";
  else if (model && (Number(f.cameraNum) < 0 || Number(f.cameraNum) > model.maxCameras)) e.cameraNum = `This model supports 0–${model.maxCameras} cameras.`;
  if (f.sim && !/^\d{15,20}$/.test(f.sim)) e.sim = "SIM ICCID is usually 19–20 digits.";
  return e;
}

/**
 * Add / edit device form. Required fields follow vendor 1.1 /vehicle/addVehicle
 * (groupId, plate, vehicleType, terminalNo, terminalType, cameraNum, protocol, plateColor);
 * the rest are documented optional fields. Driver assignment is BFF-owned.
 */
export function VehicleForm({
  vehicle,
  defaultGroupId,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  vehicle?: Vehicle;
  defaultGroupId?: string;
  submitLabel: string;
  onSubmit: (input: VehicleInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const groups = useFleet((s) => s.groups);
  const users = useFleet((s) => s.users);
  const drivers = useFleet((s) => s.drivers);
  const [form, setForm] = useState<FormState>(() => initialState(vehicle, defaultGroupId));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const model = TERMINAL_MODELS.find((m) => m.name === form.terminalType);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "terminalType") {
        const m = TERMINAL_MODELS.find((x) => x.name === value);
        if (m && !m.protocols.includes(Number(next.protocol) as DeviceProtocol)) next.protocol = String(m.protocols[0]);
        if (m && Number(next.cameraNum) > m.maxCameras) next.cameraNum = String(m.maxCameras);
        if (m && next.cameraNum === "") next.cameraNum = String(Math.min(2, m.maxCameras));
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateVehicle(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0];
      document.getElementById(`vf-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        vehicleName: form.vehicleName.trim(),
        plate: form.plate.trim(),
        plateColor: form.plateColor,
        vehicleType: form.vehicleType,
        objectType: form.objectType,
        groupId: form.groupId,
        terminalNo: form.terminalNo.trim(),
        terminalType: form.terminalType,
        protocol: Number(form.protocol) as DeviceProtocol,
        cameraNum: Number(form.cameraNum),
        sim: form.sim.trim() || undefined,
        frameNo: form.frameNo.trim() || undefined,
        driverId: form.driverId === NONE ? undefined : form.driverId,
        insuranceDueDate: fromDateInput(form.insuranceDueDate),
        maintainDate: fromDateInput(form.maintainDate),
        remark: form.remark.trim() || undefined,
      });
    } catch (err) {
      if (err instanceof ServiceError && err.field) setErrors((x) => ({ ...x, [err.field as keyof FormState]: err.message }));
      else throw err;
    } finally {
      setSubmitting(false);
    }
  }

  const usersWithGroups = users.filter((u) => groups.some((g) => g.userId === u.userId));
  const availableDrivers = drivers.filter((d) => !d.assignedVehicleId || d.assignedVehicleId === vehicle?.vehicleId);

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">Vehicle</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="vf-vehicleName" label="Vehicle name" required error={errors.vehicleName}>
            <Input {...fieldA11y("vf-vehicleName", errors.vehicleName)} value={form.vehicleName} onChange={(e) => set("vehicleName", e.target.value)} placeholder="e.g. NL-11" />
          </FormField>
          <FormField id="vf-plate" label="Registration plate" required error={errors.plate}>
            <Input {...fieldA11y("vf-plate", errors.plate)} value={form.plate} onChange={(e) => set("plate", e.target.value.toUpperCase())} placeholder="TS 09 AB 1234" />
          </FormField>
          <FormField id="vf-vehicleType" label="Vehicle type" required error={errors.vehicleType}>
            <Select value={form.vehicleType} onValueChange={(v) => set("vehicleType", v)}>
              <SelectTrigger {...fieldA11y("vf-vehicleType", errors.vehicleType)} className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="vf-plateColor" label="Plate colour" required>
            <Select value={form.plateColor} onValueChange={(v) => set("plateColor", v as PlateColor)}>
              <SelectTrigger id="vf-plateColor" className="w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATE_COLORS.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="vf-objectType" label="Object type" hint="Vendor object types (car / people / pets / others)">
            <Select value={form.objectType} onValueChange={(v) => set("objectType", v as ObjectType)}>
              <SelectTrigger id="vf-objectType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBJECT_TYPES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="vf-groupId" label="Group" required error={errors.groupId}>
            <Select value={form.groupId} onValueChange={(v) => set("groupId", v)}>
              <SelectTrigger {...fieldA11y("vf-groupId", errors.groupId)} className="w-full">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {usersWithGroups.map((u) => (
                  <SelectGroup key={u.userId}>
                    <SelectLabel>{u.userName}</SelectLabel>
                    {groups
                      .filter((g) => g.userId === u.userId)
                      .map((g) => (
                        <SelectItem key={g.groupId} value={g.groupId}>
                          {g.groupName}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="vf-frameNo" label="Frame / VIN number">
            <Input id="vf-frameNo" value={form.frameNo} onChange={(e) => set("frameNo", e.target.value.toUpperCase())} placeholder="Optional" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">Device</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="vf-terminalNo" label="Device ID (terminal no.)" required error={errors.terminalNo}>
            <Input {...fieldA11y("vf-terminalNo", errors.terminalNo)} inputMode="numeric" value={form.terminalNo} onChange={(e) => set("terminalNo", e.target.value.replace(/\D/g, ""))} placeholder="10–15 digits" />
          </FormField>
          <FormField id="vf-terminalType" label="Device model" required error={errors.terminalType}>
            <Select value={form.terminalType} onValueChange={(v) => set("terminalType", v)}>
              <SelectTrigger {...fieldA11y("vf-terminalType", errors.terminalType)} className="w-full">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {TERMINAL_MODELS.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="vf-protocol" label="Protocol" required error={errors.protocol} hint={model ? undefined : "Choose a model first"}>
            <Select value={form.protocol} onValueChange={(v) => set("protocol", v)} disabled={!model}>
              <SelectTrigger {...fieldA11y("vf-protocol", errors.protocol)} className="w-full">
                <SelectValue placeholder="Select protocol" />
              </SelectTrigger>
              <SelectContent>
                {(model?.protocols ?? []).map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {PROTOCOL_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="vf-cameraNum" label="Cameras" required error={errors.cameraNum} hint={model ? `Up to ${model.maxCameras} on this model` : undefined}>
            <Input
              {...fieldA11y("vf-cameraNum", errors.cameraNum, model ? "x" : undefined)}
              type="number"
              min={0}
              max={model?.maxCameras ?? 8}
              value={form.cameraNum}
              onChange={(e) => set("cameraNum", e.target.value)}
            />
          </FormField>
          <FormField id="vf-sim" label="SIM ICCID" error={errors.sim}>
            <Input {...fieldA11y("vf-sim", errors.sim)} inputMode="numeric" value={form.sim} onChange={(e) => set("sim", e.target.value.replace(/\D/g, ""))} placeholder="Optional" />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">Driver & dates</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="vf-driverId" label="Assigned driver" hint="Only unassigned drivers are listed">
            <Select value={form.driverId} onValueChange={(v) => set("driverId", v)}>
              <SelectTrigger id="vf-driverId" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No driver</SelectItem>
                {availableDrivers.map((d) => (
                  <SelectItem key={d.driverId} value={d.driverId}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="hidden sm:block" />
          <FormField id="vf-insuranceDueDate" label="Insurance due date">
            <Input id="vf-insuranceDueDate" type="date" value={form.insuranceDueDate} onChange={(e) => set("insuranceDueDate", e.target.value)} />
          </FormField>
          <FormField id="vf-maintainDate" label="Next maintenance date">
            <Input id="vf-maintainDate" type="date" value={form.maintainDate} onChange={(e) => set("maintainDate", e.target.value)} />
          </FormField>
          <FormField id="vf-remark" label="Remark" className="sm:col-span-2">
            <Textarea id="vf-remark" value={form.remark} onChange={(e) => set("remark", e.target.value)} placeholder="Optional notes" rows={2} />
          </FormField>
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
