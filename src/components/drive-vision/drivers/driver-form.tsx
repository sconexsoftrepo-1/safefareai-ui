"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Driver, DriverInput, DriverStatus } from "@/features/drive-vision/types";
import { useFleet } from "@/features/drive-vision/store/fleet-store";
import { ServiceError } from "@/features/drive-vision/services/core";
import { FormField, fieldA11y } from "../shared/form-field";

const NONE = "__none__";
const CLASSES = ["LMV", "LMV-TR", "HMV", "HPMV", "HGMV"];
const STATUSES: { value: DriverStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "off_duty", label: "Off duty" },
  { value: "on_leave", label: "On leave" },
];

type F = Record<"name" | "gender" | "phone" | "email" | "licenceNo" | "licenceClass" | "licenceExpiry" | "icCardNo" | "joinDate" | "status" | "assignedVehicleId" | "remark", string>;
type Errors = Partial<Record<keyof F, string>>;

const dateIn = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const dateOut = (v: string) => new Date(`${v}T00:00:00+05:30`).toISOString();

/** Driver record form. Drivers are BFF-owned (vendor has no driver endpoints). */
export function DriverForm({ driver, onSubmit, onCancel }: { driver?: Driver; onSubmit: (input: DriverInput) => Promise<void>; onCancel: () => void }) {
  const vehicles = useFleet((s) => s.vehicles);
  const [f, setF] = useState<F>({
    name: driver?.name ?? "",
    gender: driver?.gender ?? "male",
    phone: driver?.phone ?? "",
    email: driver?.email ?? "",
    licenceNo: driver?.licenceNo ?? "",
    licenceClass: driver?.licenceClass ?? "LMV-TR",
    licenceExpiry: dateIn(driver?.licenceExpiry),
    icCardNo: driver?.icCardNo ?? "",
    joinDate: dateIn(driver?.joinDate) || "2026-10-23",
    status: driver?.status ?? "active",
    assignedVehicleId: driver?.assignedVehicleId ?? NONE,
    remark: driver?.remark ?? "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof F, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(): Errors {
    const e: Errors = {};
    if (f.name.trim().length < 2) e.name = "Enter the driver's full name.";
    if (!/^\+?[\d\s-]{8,16}$/.test(f.phone.trim())) e.phone = "Enter a valid phone number.";
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Enter a valid email or leave blank.";
    if (!/^[A-Z]{2}\d{2}[\s-]?\d{4}[\s-]?\d{5,7}$/i.test(f.licenceNo.trim())) e.licenceNo = "Use the format TS0920190001234.";
    if (!f.licenceExpiry) e.licenceExpiry = "Enter the licence expiry date.";
    return e;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`df-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: f.name.trim(),
        gender: f.gender as Driver["gender"],
        phone: f.phone.trim(),
        email: f.email.trim() || undefined,
        licenceNo: f.licenceNo.trim(),
        licenceClass: f.licenceClass,
        licenceExpiry: dateOut(f.licenceExpiry),
        icCardNo: f.icCardNo.trim(),
        joinDate: dateOut(f.joinDate),
        status: f.status as DriverStatus,
        assignedVehicleId: f.assignedVehicleId === NONE ? undefined : f.assignedVehicleId,
        remark: f.remark.trim() || undefined,
      });
    } catch (err) {
      if (err instanceof ServiceError && err.field) setErrors((x) => ({ ...x, [err.field as keyof F]: err.message }));
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  const assignable = vehicles.filter((v) => !v.driverId || v.driverId === driver?.driverId);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="df-name" label="Full name" required error={errors.name} className="sm:col-span-2">
          <Input {...fieldA11y("df-name", errors.name)} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </FormField>
        <FormField id="df-phone" label="Phone" required error={errors.phone}>
          <Input {...fieldA11y("df-phone", errors.phone)} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98480 12345" />
        </FormField>
        <FormField id="df-email" label="Email" error={errors.email}>
          <Input {...fieldA11y("df-email", errors.email)} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="Optional" />
        </FormField>
        <FormField id="df-gender" label="Gender">
          <Select value={f.gender} onValueChange={(v) => set("gender", v)}>
            <SelectTrigger id="df-gender" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="df-status" label="Status">
          <Select value={f.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger id="df-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="df-licenceNo" label="Licence number" required error={errors.licenceNo}>
          <Input {...fieldA11y("df-licenceNo", errors.licenceNo)} value={f.licenceNo} onChange={(e) => set("licenceNo", e.target.value.toUpperCase())} placeholder="TS0920190001234" />
        </FormField>
        <FormField id="df-licenceClass" label="Licence class">
          <Select value={f.licenceClass} onValueChange={(v) => set("licenceClass", v)}>
            <SelectTrigger id="df-licenceClass" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLASSES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="df-licenceExpiry" label="Licence expiry" required error={errors.licenceExpiry}>
          <Input {...fieldA11y("df-licenceExpiry", errors.licenceExpiry)} type="date" value={f.licenceExpiry} onChange={(e) => set("licenceExpiry", e.target.value)} />
        </FormField>
        <FormField id="df-icCardNo" label="IC card number" hint="Identifies the driver when the card is inserted">
          <Input {...fieldA11y("df-icCardNo", undefined, "x")} value={f.icCardNo} onChange={(e) => set("icCardNo", e.target.value)} placeholder="IC-000000" />
        </FormField>
        <FormField id="df-joinDate" label="Joined">
          <Input id="df-joinDate" type="date" value={f.joinDate} onChange={(e) => set("joinDate", e.target.value)} />
        </FormField>
        <FormField id="df-vehicle" label="Assigned vehicle" hint="Vehicles without a driver are listed">
          <Select value={f.assignedVehicleId} onValueChange={(v) => set("assignedVehicleId", v)}>
            <SelectTrigger id="df-vehicle" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={NONE}>Not assigned</SelectItem>
              {assignable.map((v) => (
                <SelectItem key={v.vehicleId} value={v.vehicleId}>
                  {v.vehicleName} · {v.plate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="df-remark" label="Remark" className="sm:col-span-2">
          <Textarea id="df-remark" rows={2} value={f.remark} onChange={(e) => set("remark", e.target.value)} />
        </FormField>
      </div>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {driver ? "Save driver" : "Add driver"}
        </Button>
      </div>
    </form>
  );
}
