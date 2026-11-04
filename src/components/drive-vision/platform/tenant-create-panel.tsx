"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { platformService } from "@/features/drive-vision/api/platform-service";
import type { CreatedTenantDto, StatusSetDto, TenantDto } from "@/features/drive-vision/api/types";
import { FormField, fieldA11y } from "../shared/form-field";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { toast } from "../shared/toast-provider";
import {
  DEFAULT_PERMISSION_SOURCE_TENANT_ID,
  buildCreateRequest,
  createStatusOptions,
  createdMessage,
  createdSummary,
  describeCreateError,
  emptyCreateForm,
  reviewRows,
  timezoneOptions,
  validateCreate,
  type CreateFailure,
  type CreateTenantField,
  type CreateTenantForm,
} from "./tenant-create-model";

const selectClass = "h-10 w-full rounded-xl border border-line/70 bg-surface px-2 text-[13px] text-ink disabled:opacity-60";

/**
 * Create Tenant (POST /api/v1/platform/tenants; the contract comes from the backend team and is not in V10).
 * Opened only when the resolver allows `tenants.create`. Flow: form → review → send. Nothing is reported as
 * created until the server answers, and it never changes the selected tenant.
 */
export function TenantCreatePanel({
  open,
  tenants,
  catalogue,
  onClose,
  onCreated,
  onUncertain,
}: {
  open: boolean;
  tenants: readonly TenantDto[];
  catalogue: StatusSetDto | null;
  onClose: () => void;
  onCreated: (t: CreatedTenantDto) => void;
  /** The outcome is unknown (timeout / 5xx): the caller reloads the list. */
  onUncertain: () => void;
}) {
  const [form, setForm] = useState<CreateTenantForm>(emptyCreateForm);
  const [step, setStep] = useState<"form" | "review">("form");
  const [errors, setErrors] = useState<CreateFailure["fieldErrors"]>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const statuses = useMemo(() => createStatusOptions(tenants, catalogue), [tenants, catalogue]);
  const zones = useMemo(() => timezoneOptions(), []);
  const body = buildCreateRequest(form);
  const source = tenants.find((t) => t.id === DEFAULT_PERMISSION_SOURCE_TENANT_ID);

  const set = (f: CreateTenantField, v: string) => {
    setForm((p) => ({ ...p, [f]: v }));
    if (errors[f]) setErrors((p) => ({ ...p, [f]: undefined }));
  };

  function review(e: React.FormEvent) {
    e.preventDefault();
    const found = validateCreate(form, statuses);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length === 0) setStep("review");
  }

  async function submit() {
    if (inFlight.current) return; // duplicate clicks / Enter presses
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const created = await platformService.createTenant(body);
      const summary = createdSummary(created);
      toast.success("Tenant created", { description: createdMessage(summary) });
      onCreated(created);
    } catch (err) {
      const outcome = describeCreateError(err);
      setErrors(outcome.fieldErrors);
      setFailure(outcome.message);
      toast.error("The tenant wasn't created", { description: outcome.message });
      // Field errors point at the form; otherwise stay on the review step so the user can retry or go back.
      if (Object.keys(outcome.fieldErrors).length) setStep("form");
      if (outcome.uncertain) onUncertain();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <SlideOverPanel
      open={open}
      onOpenChange={(o) => !o && !saving && onClose()}
      title={step === "form" ? "Create tenant" : "Review new tenant"}
      description="Creates a platform tenant on the SafeFare server. Your current tenant selection doesn't change."
      width="md"
      footer={
        step === "form" ? (
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="tenant-create-form" data-testid="tenant-create-review">
              Review
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("form")} disabled={saving}>
              <ArrowLeft /> Back
            </Button>
            <Button onClick={submit} disabled={saving} data-testid="tenant-create-submit">
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {saving ? "Creating…" : "Create tenant"}
            </Button>
          </div>
        )
      }
    >
      {failure ? (
        <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert" data-testid="tenant-create-error">
          {failure}
        </p>
      ) : null}
      {step === "form" ? (
        <form id="tenant-create-form" className="space-y-4" onSubmit={review} noValidate data-testid="tenant-create-form">
          <FormField id="tc-name" label="Tenant name" required error={errors.name}>
            <Input {...fieldA11y("tc-name", errors.name)} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Acme Transport" autoComplete="off" />
          </FormField>
          <FormField id="tc-code" label="Tenant code" error={errors.code} hint="Optional. Leave empty and the server generates the code.">
            <Input {...fieldA11y("tc-code", errors.code, "hint")} value={form.code} onChange={(e) => set("code", e.target.value)} autoComplete="off" className="font-mono" />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="tc-timezone" label="Time zone" required error={errors.timezone} hint="Type to search, e.g. Kolkata.">
              <Input {...fieldA11y("tc-timezone", errors.timezone, "hint")} list="tc-timezones" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} autoComplete="off" />
            </FormField>
            <datalist id="tc-timezones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <FormField id="tc-status" label="Status" required error={errors.status}>
              <select {...fieldA11y("tc-status", errors.status)} className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField id="tc-s3" label="S3 prefix" error={errors.s3Prefix} hint="Optional storage prefix. Sent empty if left blank.">
            <Input {...fieldA11y("tc-s3", errors.s3Prefix, "hint")} value={form.s3Prefix} onChange={(e) => set("s3Prefix", e.target.value)} autoComplete="off" className="font-mono" />
          </FormField>
          <section className="rounded-xl bg-surface-muted px-3 py-2.5" data-testid="tenant-create-source" aria-labelledby="tc-source-title">
            <h3 id="tc-source-title" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Copy className="size-3.5" aria-hidden /> Copy role permissions from: tenant {DEFAULT_PERMISSION_SOURCE_TENANT_ID}
              {source?.name ? ` (${source.name})` : ""}
            </h3>
            <p className="mt-1 text-xs text-ink-muted">
              The new tenant gets the role permissions of this source tenant. This is the backend default and can&apos;t be changed here. It doesn&apos;t create users or a tenant administrator.
            </p>
            {errors.copyRolePermissionsFromTenantId ? <p className="mt-1 text-xs text-danger">{errors.copyRolePermissionsFromTenantId}</p> : null}
          </section>
        </form>
      ) : (
        <div data-testid="tenant-create-review-step">
          <p className="mb-2 text-[13px] text-ink-muted">Check the details. Creating a tenant can&apos;t be undone from this app.</p>
          <dl>
            {reviewRows(body, source).map((r) => (
              <DetailRow key={r.label} label={r.label}>
                {r.value}
              </DetailRow>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">No users or tenant administrator are created. Your current tenant selection stays the same.</p>
        </div>
      )}
    </SlideOverPanel>
  );
}
