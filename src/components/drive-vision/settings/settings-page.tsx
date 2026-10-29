"use client";

import { useState } from "react";
import { BellRing, KeyRound, Loader2, MonitorSmartphone, SlidersHorizontal, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountService } from "@/features/drive-vision/api/account-service";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { PreferencesDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { DASHBOARD_MODULE_LABELS, updatePreferences, usePreferences, type DashboardModule } from "@/features/drive-vision/hooks/use-preferences";
import { applyCurrentUser, useAuth } from "@/features/drive-vision/store/auth-store";
import { formatDateTime } from "@/features/drive-vision/utils/format";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState } from "../shared/api-states";
import { DetailRow } from "../shared/slide-over-panel";
import { FormField, fieldA11y } from "../shared/form-field";
import { toast } from "../shared/toast-provider";
import {
  EXPIRY_MODES,
  VIDEO_LAYOUTS,
  missingRequiredPreferences,
  parseIntInput,
  passwordRequest,
  preferencesBody,
  profileForm,
  profilePatch,
  validatePasswordChange,
  validatePreferences,
  validateProfile,
  type Errors,
  type PasswordForm,
  type PreferenceField,
  type ProfileField,
  type ProfileForm,
} from "./settings-model";

function ToggleRow({ id, label, description, checked, onChange, disabled }: { id: string; label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {description ? <span className="block text-xs text-ink-muted">{description}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

const Title = ({ icon: Icon, children }: { icon: typeof UserRound; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2">
    <Icon className="size-4" aria-hidden />
    {children}
  </span>
);

/** Server field errors (VALIDATION_FAILED) keyed by our field names, plus a general message otherwise. */
function serverErrors<K extends string>(err: unknown, fields: readonly K[]): { fields: Errors<K>; message: string | null } {
  if (isApiError(err) && err.fieldErrors.length > 0) {
    const map = err.fieldErrorMap();
    const known: Errors<K> = {};
    for (const f of fields) if (map[f]) known[f] = map[f];
    if (Object.keys(known).length > 0) return { fields: known, message: null };
  }
  return { fields: {}, message: describeApiError(err) };
}

// ── Profile (GET /me via auth store, PATCH /me) ──────────────────────────────

function ProfilePanel() {
  const user = useAuth((s) => s.user);
  const original = profileForm(user);
  const [draft, setDraft] = useState<ProfileForm | null>(null);
  const [errors, setErrors] = useState<Errors<ProfileField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const form = draft ?? original;
  const patch = profilePatch(original, form);
  const dirty = Object.keys(patch).length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateProfile(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0 || !dirty) return;
    setSaving(true);
    try {
      const updated = await accountService.updateMe(patch);
      applyCurrentUser(updated);
      setDraft(null);
      toast.success("Profile saved");
    } catch (err) {
      const s = serverErrors(err, ["displayName", "email", "phone", "locale", "timezone"] as const);
      setErrors(s.fields);
      setFailure(s.message);
    } finally {
      setSaving(false);
    }
  }

  const field = (f: ProfileField, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => (
    <FormField id={`p-${f}`} label={label} error={errors[f]} hint={hint} required={f === "displayName"}>
      <Input {...fieldA11y(`p-${f}`, errors[f], hint)} value={form[f]} onChange={(e) => setDraft({ ...form, [f]: e.target.value })} {...props} />
    </FormField>
  );

  return (
    <Panel>
      <PanelHeader title={<Title icon={UserRound}>Profile</Title>} description="Your account details on the SafeFare server" />
      <form className="space-y-3 px-5 pt-3 pb-5" onSubmit={onSubmit} noValidate>
        {field("displayName", "Display name", { maxLength: 150, autoComplete: "name" })}
        {field("email", "Email", { type: "email", maxLength: 320, autoComplete: "email" })}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("phone", "Phone", { type: "tel", maxLength: 30, autoComplete: "tel" })}
          {field("locale", "Locale", { maxLength: 5 }, "e.g. en or en_IN")}
        </div>
        {field("timezone", "Time zone", { maxLength: 50 }, "As stored on the server, e.g. Asia/Kolkata")}
        {failure ? (
          <p className="text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {draft ? (
            <Button type="button" variant="ghost" onClick={() => (setDraft(null), setErrors({}), setFailure(null))} disabled={saving}>
              Discard
            </Button>
          ) : null}
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save profile
          </Button>
        </div>
        <dl className="divide-y divide-line border-t border-line pt-1">
          <DetailRow label="Tenant">{user?.tenantName ?? user?.tenantCode ?? "—"}</DetailRow>
          <DetailRow label="Role">{user?.role?.code ?? "—"}</DetailRow>
          <DetailRow label="Last sign-in">{user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</DetailRow>
        </dl>
      </form>
    </Panel>
  );
}

// ── Password (POST /me/password) ────────────────────────────────────────────

const EMPTY_PASSWORD: PasswordForm = { currentPassword: "", newPassword: "", confirmPassword: "" };

function PasswordPanel() {
  const [form, setForm] = useState<PasswordForm>(EMPTY_PASSWORD);
  const [errors, setErrors] = useState<Errors<keyof PasswordForm>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validatePasswordChange(form);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await accountService.changePassword(passwordRequest(form));
      setForm(EMPTY_PASSWORD);
      toast.success("Password changed");
    } catch (err) {
      const s = serverErrors(err, ["currentPassword", "newPassword"] as const);
      setErrors(s.fields);
      setFailure(s.message);
    } finally {
      setSaving(false);
    }
  }

  const field = (f: keyof PasswordForm, label: string, autoComplete: string) => (
    <FormField id={`pw-${f}`} label={label} error={errors[f]} required>
      <Input {...fieldA11y(`pw-${f}`, errors[f])} type="password" autoComplete={autoComplete} maxLength={72} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
    </FormField>
  );

  return (
    <Panel>
      <PanelHeader title={<Title icon={KeyRound}>Change password</Title>} description="Takes effect on the server; other sessions may need to sign in again" />
      <form className="space-y-3 px-5 pt-3 pb-5" onSubmit={onSubmit} noValidate>
        {field("currentPassword", "Current password", "current-password")}
        {field("newPassword", "New password", "new-password")}
        {field("confirmPassword", "Confirm new password", "new-password")}
        {failure ? (
          <p className="text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.currentPassword || !form.newPassword}>
            {saving ? <Loader2 className="animate-spin" /> : null} Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// ── Server preferences (GET/PUT /me/preferences) ────────────────────────────

const LAYOUT_LABEL: Record<string, string> = { GRID_1: "1 camera", GRID_4: "4 cameras", GRID_9: "9 cameras", GRID_16: "16 cameras" };
const MODE_LABEL: Record<string, string> = { NONE: "Off", BADGE: "Badge", POPUP_AND_BADGE: "Pop-up and badge" };

function PreferencesPanel() {
  const q = useApiQuery("settings:preferences", () => accountService.preferences());
  const [edits, setEdits] = useState<PreferencesDto>({});
  const [errors, setErrors] = useState<Errors<PreferenceField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PreferencesDto | null>(null);

  const loaded = saved ?? q.data;
  const header = <PanelHeader title={<Title icon={SlidersHorizontal}>Workspace preferences</Title>} description="Saved to your account on the SafeFare server" />;
  if (q.error && !loaded) {
    return (
      <Panel>
        {header}
        <ApiErrorState error={q.error} onRetry={q.refetch} compact />
      </Panel>
    );
  }
  if (!loaded) {
    return (
      <Panel>
        {header}
        <LoadingSkeleton variant="list" rows={4} className="px-5 pb-5" />
      </Panel>
    );
  }

  const view: PreferencesDto = { ...loaded, ...edits };
  const missing = missingRequiredPreferences(loaded);
  const dirty = Object.keys(edits).length > 0;
  const set = (patch: PreferencesDto) => setEdits({ ...edits, ...patch });

  async function onSave() {
    const found = validatePreferences(view);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0 || missing.length > 0) return;
    setSaving(true);
    try {
      const result = await accountService.savePreferences(preferencesBody(loaded!, edits));
      setSaved(result);
      setEdits({});
      toast.success("Preferences saved");
    } catch (err) {
      const s = serverErrors(err, ["videoLayout", "videoAutoStopMin", "alarmPopupCloseSec", "alarmPopupMax", "expiryReminderDays", "expiryReminderMode"] as const);
      setErrors(s.fields);
      setFailure(s.message);
    } finally {
      setSaving(false);
    }
  }

  const numberField = (f: "videoAutoStopMin" | "alarmPopupCloseSec" | "alarmPopupMax" | "expiryReminderDays", label: string, hint: string) => (
    <FormField id={`pref-${f}`} label={label} error={errors[f]} hint={hint}>
      <Input {...fieldA11y(`pref-${f}`, errors[f], hint)} type="number" inputMode="numeric" value={view[f] ?? ""} onChange={(e) => set({ [f]: parseIntInput(e.target.value) })} />
    </FormField>
  );

  return (
    <Panel>
      {header}
      <div className="space-y-3 px-5 pt-3 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="pref-videoLayout" label="Video layout" error={errors.videoLayout}>
            <Select value={view.videoLayout ?? ""} onValueChange={(v) => set({ videoLayout: v as PreferencesDto["videoLayout"] })}>
              <SelectTrigger id="pref-videoLayout" className="w-full" aria-invalid={errors.videoLayout ? true : undefined}>
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_LAYOUTS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LAYOUT_LABEL[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {numberField("videoAutoStopMin", "Video auto-stop (minutes)", "1–120")}
          <FormField id="pref-expiryReminderMode" label="Expiry reminders" error={errors.expiryReminderMode}>
            <Select value={view.expiryReminderMode ?? ""} onValueChange={(v) => set({ expiryReminderMode: v as PreferencesDto["expiryReminderMode"] })}>
              <SelectTrigger id="pref-expiryReminderMode" className="w-full" aria-invalid={errors.expiryReminderMode ? true : undefined}>
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {numberField("expiryReminderDays", "Reminder window (days)", "Used by the Fleet Overview reminders card")}
          {numberField("alarmPopupCloseSec", "Alarm pop-up closes after (s)", "0–600")}
          {numberField("alarmPopupMax", "Max alarm pop-ups", "1–50")}
        </div>
        <div className="divide-y divide-line">
          <ToggleRow id="pref-cluster" label="Cluster map markers" checked={view.mapClusterEnabled ?? false} onChange={(v) => set({ mapClusterEnabled: v })} />
          <ToggleRow id="pref-night" label="Night mode" description={view.nightModeFrom || view.nightModeTo ? `Server schedule: ${view.nightModeFrom ?? "?"} – ${view.nightModeTo ?? "?"}` : undefined} checked={view.nightModeEnabled ?? false} onChange={(v) => set({ nightModeEnabled: v })} />
        </div>
        <p className="flex items-start gap-1.5 text-xs text-ink-muted">
          <BellRing className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Saved on the server; only the reminder window is used by this app so far. Theme ({view.theme ?? "—"}), home modules, device info fields and track alarm types ({view.trackAlarmTypeIds?.length ?? 0}) are kept as stored — their allowed values aren&apos;t documented.
            {view.updatedAt ? ` Last saved ${formatDateTime(view.updatedAt)}.` : ""}
          </span>
        </p>
        {missing.length > 0 ? (
          <p className="text-[13px] text-danger" role="alert">
            Can&apos;t save: the server&apos;s preferences are missing required fields ({missing.join(", ")}), and they can&apos;t be filled in without documented values.
          </p>
        ) : null}
        {failure ? (
          <p className="text-[13px] text-danger" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => (setEdits({}), setErrors({}), setFailure(null))} disabled={saving}>
              Discard
            </Button>
          ) : null}
          <Button onClick={() => void onSave()} disabled={!dirty || saving || missing.length > 0}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save preferences
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ── This browser only ───────────────────────────────────────────────────────

function BrowserPanel() {
  const prefs = usePreferences();
  return (
    <Panel className="lg:col-span-2">
      <PanelHeader title={<Title icon={MonitorSmartphone}>This browser</Title>} description="Display options with no server setting — stored on this device only" />
      <div className="grid gap-x-8 px-5 pb-2 md:grid-cols-2">
        <div className="divide-y divide-line">
          <ToggleRow id="d-motion" label="Reduce motion" description="Turns off transitions (the OS setting is also respected)" checked={prefs.reduceMotion} onChange={(v) => updatePreferences({ reduceMotion: v })} />
          <ToggleRow id="d-assistant" label="Show AI assistant" description="Iris launcher (sample data; admins only)" checked={prefs.assistantEnabled} onChange={(v) => updatePreferences({ assistantEnabled: v })} />
        </div>
        <div className="divide-y divide-line">
          {(Object.keys(DASHBOARD_MODULE_LABELS) as DashboardModule[]).map((m) => (
            <ToggleRow key={m} id={`m-${m}`} label={`Overview: ${DASHBOARD_MODULE_LABELS[m]}`} checked={prefs.dashboardModules[m]} onChange={(v) => updatePreferences({ dashboardModules: { ...prefs.dashboardModules, [m]: v } })} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

/** Settings on live BFF data: profile (PATCH /me), password (POST /me/password), preferences (GET/PUT /me/preferences). */
export function SettingsPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Settings" description="Profile, password and preferences for your SafeFare account" />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfilePanel />
        <div className="space-y-4">
          <PasswordPanel />
        </div>
        <div className="lg:col-span-2">
          <PreferencesPanel />
        </div>
        <BrowserPanel />
      </div>
    </div>
  );
}
