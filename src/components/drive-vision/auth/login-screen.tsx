"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Clock, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_BASE_URL, API_DEBUG, DEFAULT_TENANT_CODE } from "@/features/drive-vision/api/config";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import { bootstrapAuth, signIn, useAuth } from "@/features/drive-vision/store/auth-store";
import { defaultLanding } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { cn } from "@/lib/utils";
import { BrandGlyph } from "../app-shell/sidebar";
import { FormField, fieldA11y } from "../shared/form-field";
import { Panel } from "../shared/panel";
import { AuthScreenFrame } from "./auth-gate";
import { LOGIN_LABELS as LABELS, LOGIN_MAX_LENGTH as MAX_LENGTH, buildLoginRequest, loginFields, validateLogin, type LoginErrors as FieldErrors, type LoginField as Field, type LoginForm, type LoginMode } from "./login-model";

const FALLBACK_PATH = "/drive-vision/overview";

/** Only same-app paths are accepted as a post-login destination (no open redirects). */
function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/drive-vision") && !raw.startsWith("//") ? raw : null;
}

const MODES: { mode: LoginMode; label: string }[] = [
  { mode: "tenant", label: "Tenant user" },
  { mode: "platform", label: "Safe-Fare Admin" },
];

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = safeNext(params.get("next"));
  const access = useAccess();
  // No (valid) next: the default for this identity — platform dashboard for the Safe-Fare Admin, else Overview.
  const next = requested ?? defaultLanding(access) ?? FALLBACK_PATH;
  const expired = params.get("reason") === "expired";
  const status = useAuth((s) => s.status);

  const [mode, setMode] = useState<LoginMode>("tenant");
  const [values, setValues] = useState<LoginForm>({ tenantCode: DEFAULT_TENANT_CODE, login: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ message: string; meta?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    void bootstrapAuth();
  }, []);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    if (fieldErrors[field]) setFieldErrors((fe) => ({ ...fe, [field]: undefined }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const errors = validateLogin(mode, values);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      // Safe-Fare Admin: tenantCode is omitted from the request (see login-model).
      await signIn(buildLoginRequest(mode, values));
      // Redirect happens in the status effect.
    } catch (err) {
      if (isApiError(err)) {
        const serverFields = err.fieldErrorMap();
        const known: FieldErrors = {};
        for (const f of loginFields(mode)) if (serverFields[f]) known[f] = serverFields[f];
        setFieldErrors(known);
        const meta = [err.status ? `HTTP ${err.status}` : null, err.errorCode, err.requestId ? `ref ${err.requestId}` : null].filter(Boolean).join(" · ");
        setFormError({ message: describeApiError(err), meta: meta || undefined });
      } else {
        setFormError({ message: describeApiError(err) });
      }
      setValues((v) => ({ ...v, password: "" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreenFrame>
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandGlyph />
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            SafeFare <span className="text-brand-deep">AI</span>
          </span>
        </div>

        <Panel className="p-6 sm:p-7">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Use your SafeFare fleet account.</p>

          {expired && !formError ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] text-warning" role="status">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
              Your session expired. Please sign in again.
            </div>
          ) : null}

          {formError ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p>{formError.message}</p>
                {formError.meta ? <p className="mt-0.5 font-mono text-[11px] break-all opacity-75">{formError.meta}</p> : null}
              </div>
            </div>
          ) : null}

          <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
            <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.mode}
                  disabled={submitting}
                  onClick={() => {
                    setMode(m.mode);
                    setFieldErrors({});
                    setFormError(null);
                  }}
                  className={cn(
                    "min-h-9 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none",
                    mode === m.mode ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {mode === "tenant" ? (
              <FormField id="login-tenant" label={LABELS.tenantCode} error={fieldErrors.tenantCode} required>
                <Input
                  {...fieldA11y("login-tenant", fieldErrors.tenantCode)}
                  name="tenantCode"
                  autoComplete="organization"
                  value={values.tenantCode}
                  onChange={set("tenantCode")}
                  maxLength={MAX_LENGTH.tenantCode}
                  disabled={submitting}
                />
              </FormField>
            ) : (
              <p className="text-[12px] text-ink-muted">Safe-Fare platform administrators sign in without a tenant code.</p>
            )}
            <FormField id="login-user" label={LABELS.login} error={fieldErrors.login} required>
              <Input
                {...fieldA11y("login-user", fieldErrors.login)}
                name="login"
                autoComplete="username"
                value={values.login}
                onChange={set("login")}
                maxLength={MAX_LENGTH.login}
                disabled={submitting}
              />
            </FormField>
            <FormField id="login-password" label={LABELS.password} error={fieldErrors.password} required>
              <div className="relative">
                <Input
                  {...fieldA11y("login-password", fieldErrors.password)}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={values.password}
                  onChange={set("password")}
                  maxLength={MAX_LENGTH.password}
                  disabled={submitting}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-subtle hover:text-ink focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </FormField>

            <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Panel>

        {API_DEBUG ? (
          <p className={cn("mt-4 text-center font-mono text-[11px] text-ink-subtle", !API_BASE_URL && "text-danger")}>
            {API_BASE_URL ? `API ${API_BASE_URL}` : "NEXT_PUBLIC_API_BASE_URL is not set"}
          </p>
        ) : null}
      </div>
    </AuthScreenFrame>
  );
}
