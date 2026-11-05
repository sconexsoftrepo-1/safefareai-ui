"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Building2, ChartColumn, Clock, Eye, EyeOff, Loader2, Lock, Mail, Satellite, ShieldCheck, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { API_BASE_URL, API_DEBUG, DEFAULT_TENANT_CODE } from "@/features/drive-vision/api/config";
import { describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import { bootstrapAuth, signIn, useAuth, mayResumeRoute } from "@/features/drive-vision/store/auth-store";
import { postLoginRoute } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { cn } from "@/lib/utils";
import truck from "@/assets/truck.png";
import { FormField, fieldA11y } from "../shared/form-field";
import { LOGIN_LABELS as LABELS, LOGIN_MAX_LENGTH as MAX_LENGTH, buildLoginRequest, loginFields, validateLogin, type LoginErrors as FieldErrors, type LoginField as Field, type LoginForm, type LoginMode } from "./login-model";

const FALLBACK_PATH = "/drive-vision/overview";

/** Only same-app paths are accepted as a post-login destination (no open redirects). */
function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/drive-vision") && !raw.startsWith("//") ? raw : null;
}

const MODES: { mode: LoginMode; label: string; icon: typeof Users }[] = [
  { mode: "tenant", label: "Tenant user", icon: Users },
  { mode: "platform", label: "Safe-Fare Admin", icon: ShieldCheck },
];

// The card sits on a photo, so it keeps a fixed light palette in both themes.
const INPUT_CLASS =
  "h-12 short:h-10 rounded-xl border-[#e8e6ee] bg-[#f6f5f9] pl-11 text-[15px] text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-[#f16a45]/60 focus-visible:ring-[#f16a45]/15 dark:bg-[#f6f5f9]";

function FieldIcon({ icon: Icon }: { icon: typeof Mail }) {
  return <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-slate-500" aria-hidden />;
}

/** Decorative glass bubble floating over the road scene; positioned by its centre. */
function FloatBadge({ icon: Icon, className, style }: { icon: typeof Mail; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      style={style}
      className={cn(
        "absolute grid size-[76px] -translate-1/2 place-items-center rounded-full border-2 border-white bg-white/85 text-[#f16a45] shadow-[0_0_0_6px_rgba(232,100,74,0.12),0_12px_30px_-8px_rgba(232,100,74,0.55)] backdrop-blur-md short:size-14",
        className
      )}
    >
      <Icon className="size-9 short:size-7" strokeWidth={1.7} />
    </span>
  );
}

/** Coral map pin standing on a soft coral base; its anchor is the centre of the base. */
function GlowPin({ x, y }: { x: number; y: number }) {
  return (
    <svg
      viewBox="0 0 120 140"
      className="absolute w-[110px] -translate-x-1/2 -translate-y-[87%] overflow-visible drop-shadow-[0_6px_16px_rgba(232,100,74,0.45)] short:w-[88px]"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <ellipse cx="60" cy="122" rx="56" ry="13" fill="rgba(251,228,221,0.6)" stroke="#f6cfc3" strokeWidth="1.5" />
      <ellipse cx="60" cy="122" rx="36" ry="8" fill="rgba(240,138,107,0.35)" stroke="white" strokeWidth="2" />
      <ellipse cx="60" cy="122" rx="12" ry="3" fill="white" />
      <path d="M60 118C60 118 26 82 26 52a34 34 0 1 1 68 0c0 30-34 66-34 66z" fill="#f16a45" stroke="#fbe4dd" strokeWidth="1.5" style={{ filter: "drop-shadow(0 6px 8px rgba(217,68,42,0.35))" }} />
      <circle cx="60" cy="52" r="13" fill="white" />
    </svg>
  );
}

// Positions are percentages of the graphics box, which shares its bottom edge, width basis
// and height with the truck photo, so the pin always lands just right of the truck's cab.
const PIN = { x: 42.5, y: 44 };
const NODES = [
  { icon: Satellite, x: 47, y: 16 },
  { icon: ShieldCheck, x: 51.5, y: 44 },
  { icon: ChartColumn, x: 50.5, y: 72 },
];

/** Location pin + connected telemetry bubbles between the truck and the card (wide screens only). */
function HeroGraphics() {
  const dash = { stroke: "#f16a45", strokeWidth: 2, strokeDasharray: "5 6", vectorEffect: "non-scaling-stroke" } as const;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 hidden h-[29.25vw] max-h-[75%] xl:block" aria-hidden>
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1={PIN.x} y1={PIN.y - 14} x2={NODES[0].x} y2={NODES[0].y} {...dash} opacity="0.9" />
        <line x1={PIN.x} y1={PIN.y - 14} x2={NODES[1].x} y2={NODES[1].y} {...dash} opacity="0.9" />
        <line x1={PIN.x} y1={PIN.y} x2={NODES[2].x} y2={NODES[2].y} {...dash} opacity="0.6" />
        <line x1={NODES[1].x} y1={NODES[1].y} x2={NODES[2].x} y2={NODES[2].y} {...dash} opacity="0.7" />
      </svg>
      <GlowPin x={PIN.x} y={PIN.y} />
      {NODES.map((n) => (
        <FloatBadge key={n.x} icon={n.icon} style={{ left: `${n.x}%`, top: `${n.y}%` }} />
      ))}
    </div>
  );
}

function SafeFareLogo() {
  return (
    <span className="relative grid size-16 shrink-0 place-items-center rounded-full border-[5px] border-[#f16a45] bg-white/80 text-[#f16a45] lg:size-24 short:lg:size-18" aria-hidden>
      <svg viewBox="0 0 48 48" className="size-9 lg:size-12 short:lg:size-10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 12a10 10 0 0 1 14 0M20.5 15.5a5 5 0 0 1 7 0" />
        <path d="M11 33v-6l3-7h20l3 7v6z" fill="currentColor" stroke="none" />
        <path d="M11 33v4M37 33v4" />
        <circle cx="17" cy="29" r="1.8" fill="white" stroke="none" />
        <circle cx="31" cy="29" r="1.8" fill="white" stroke="none" />
      </svg>
    </span>
  );
}

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = safeNext(params.get("next"));
  const access = useAccess();
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
    if (status !== "authenticated") return;
    router.replace(postLoginRoute(access, mayResumeRoute(access.identity) ? requested : null) ?? FALLBACK_PATH);
  }, [status, access, requested, router]);

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
    // Desktop: exactly one viewport tall (no page scroll); phones may scroll vertically, never sideways.
    <div className="relative isolate min-h-dvh overflow-x-hidden bg-slate-700 text-slate-900 lg:h-dvh lg:overflow-hidden lg:bg-[linear-gradient(180deg,#f6f5f9_0%,#f0eff5_45%,#e4e2ea_70%,#9a98a3_86%,#3a3940_100%)]">
      {/* Backdrop. Phones: the photo fills the screen. Desktop: pale lavender-grey backdrop with the photo
          bottom-left, its top and right edges faded into the sky and road. */}
      <div className="absolute inset-0 -z-20 lg:inset-auto lg:bottom-0 lg:left-0 lg:aspect-[1672/941] lg:max-h-[75%] lg:w-[52vw] lg:[mask-composite:intersect] lg:[mask-image:linear-gradient(to_right,#000_62%,transparent_99%),linear-gradient(to_bottom,transparent,#000_30%)]">
        <Image src={truck} alt="" priority placeholder="blur" fill sizes="(min-width: 1024px) 52vw, 100vw" className="object-cover object-[30%_center]" />
      </div>
      <div className="absolute inset-0 -z-10 hidden bg-[radial-gradient(ellipse_55%_50%_at_18%_22%,rgba(255,255,255,0.9),rgba(255,255,255,0.4)_55%,transparent_80%),radial-gradient(circle_at_4%_72%,rgba(240,138,107,0.35),transparent_28%)] lg:block" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-slate-900/30 lg:hidden" aria-hidden />
      <svg className="pointer-events-none absolute -top-[40%] -right-[12%] -z-10 hidden aspect-square h-[110%] lg:block" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="49" fill="none" stroke="#f08a6b" strokeOpacity="0.45" strokeWidth="0.6" />
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#f6cfc3" strokeOpacity="0.55" strokeWidth="2.4" />
      </svg>
      <HeroGraphics />
      {/* Bottom band (reference): charcoal wave on the left with a coral line along its top; a thin coral curve on the right. */}
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 w-full sm:h-32 short:h-24" viewBox="0 0 1440 160" preserveAspectRatio="none" aria-hidden>
        <path d="M0 30 C 300 20, 560 70, 820 160 L0 160Z" fill="#2b2a31" />
        <path d="M0 30 C 300 20, 560 70, 820 160" fill="none" stroke="#f16a45" strokeWidth="5" />
        <path d="M0 22 C 300 12, 580 62, 860 160" fill="none" stroke="#f08a6b" strokeOpacity="0.5" strokeWidth="2" />
        <path d="M1440 70 C 1250 135, 1040 155, 900 160" fill="none" stroke="#f16a45" strokeWidth="5" />
        <path d="M1440 92 C 1300 140, 1150 156, 1040 160 L1440 160Z" fill="#f08a6b" fillOpacity="0.35" />
      </svg>

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1400px] items-center gap-8 px-4 pt-14 pb-24 sm:px-8 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-12 lg:px-12 lg:pt-14 lg:pb-20 xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)] xl:px-16 short:lg:pt-10 short:lg:pb-14 shorter:lg:pt-8 shorter:lg:pb-10">
        {/* Hero copy */}
        <section className="relative hidden h-full min-h-0 flex-col pt-4 lg:flex short:pt-0">
          <div className="flex items-center gap-5">
            <SafeFareLogo />
            <div className="min-w-0">
              <p className="text-5xl font-bold tracking-[-0.03em] text-[#24344d] italic xl:text-6xl short:text-4xl short:xl:text-5xl">
                SafeFare <span className="text-[#f16a45]">AI</span>
              </p>
              <p className="mt-1 text-xl font-semibold text-[#24344d] italic short:text-lg">Smarter Fleet. Safer Journey.</p>
              <span className="mt-1.5 block h-1 w-64 max-w-full rounded-full bg-gradient-to-r from-[#f16a45] to-[#f16a45]/0" aria-hidden />
            </div>
          </div>
          <h2 className="mt-12 text-3xl leading-tight font-bold text-[#24344d] xl:text-4xl short:mt-8 short:text-2xl short:xl:text-3xl">
            Intelligent Fleet Management
            <br />
            for a <span className="text-[#f16a45]">Safer Tomorrow</span>
          </h2>
          <p className="mt-4 text-xl text-slate-600 short:mt-2 short:text-lg">
            Track <span className="mx-2 text-[#f16a45]">•</span> Monitor <span className="mx-2 text-[#f16a45]">•</span> Protect
          </p>
        </section>

        {/* Sign-in card */}
        <div className="mx-auto w-full max-w-[460px] xl:max-w-[500px]">
          <div className="mb-10 flex items-center justify-center gap-3 lg:hidden">
            <SafeFareLogo />
            <p className="text-3xl font-bold tracking-[-0.03em] text-white italic drop-shadow">
              SafeFare <span className="text-[#f08a6b]">AI</span>
            </p>
          </div>

          <div className="relative rounded-[28px] border border-white/80 bg-white/95 px-6 pt-14 pb-6 shadow-[0_30px_80px_-20px_rgba(36,52,77,0.35)] backdrop-blur-xl sm:px-9 short:px-7 short:pt-10 short:pb-4 shorter:pt-8">
            <span className="absolute -top-9 left-1/2 grid size-[72px] -translate-x-1/2 place-items-center rounded-full bg-gradient-to-b from-[#f08a6b] to-[#d9442a] text-white shadow-[0_0_0_10px_rgba(232,100,74,0.14),0_12px_24px_-6px_rgba(217,68,42,0.55)] short:-top-7 short:size-14" aria-hidden>
              <Users className="size-8 short:size-6" />
            </span>

            <div className="flex items-center gap-4">
              <span className="h-0.5 flex-1 bg-gradient-to-r from-transparent to-[#f16a45]/70" aria-hidden />
              <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#24344d] sm:text-4xl short:text-3xl shorter:text-2xl">Sign in</h1>
              <span className="h-0.5 flex-1 bg-gradient-to-l from-transparent to-[#f16a45]/70" aria-hidden />
            </div>
            <p className="mt-2 text-center text-[15px] text-slate-600 short:mt-1 short:text-sm">Use your SafeFare fleet account.</p>

            {expired && !formError ? (
              <div className="mt-5 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-700" role="status">
                <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
                Your session expired. Please sign in again.
              </div>
            ) : null}

            {formError ? (
              <div className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p>{formError.message}</p>
                  {formError.meta ? <p className="mt-0.5 font-mono text-[11px] break-all opacity-75">{formError.meta}</p> : null}
                </div>
              </div>
            ) : null}

            <form className="mt-6 space-y-5 short:mt-4 short:space-y-3 shorter:mt-3 shorter:space-y-2.5 [&_label]:text-[15px] [&_label]:font-semibold [&_label]:text-[#24344d] short:[&_label]:text-sm" onSubmit={onSubmit} noValidate>
              <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-2xl bg-[#f0eff5] p-1">
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
                      "flex min-h-12 short:min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-[14px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-[#f16a45]/35 focus-visible:outline-none sm:text-[15px]",
                      mode === m.mode ? "bg-[#24344d] text-white shadow-[0_8px_20px_-10px_rgba(36,52,77,0.7)]" : "text-slate-700 hover:text-slate-900"
                    )}
                  >
                    <m.icon className="size-[18px]" aria-hidden />
                    {m.label}
                  </button>
                ))}
              </div>

              {mode === "tenant" ? (
                <FormField id="login-tenant" label={LABELS.tenantCode} error={fieldErrors.tenantCode} required>
                  <div className="relative">
                    <FieldIcon icon={Building2} />
                    <Input
                      {...fieldA11y("login-tenant", fieldErrors.tenantCode)}
                      name="tenantCode"
                      autoComplete="organization"
                      placeholder="Enter tenant code"
                      value={values.tenantCode}
                      onChange={set("tenantCode")}
                      maxLength={MAX_LENGTH.tenantCode}
                      disabled={submitting}
                      className={INPUT_CLASS}
                    />
                  </div>
                </FormField>
              ) : (
                <p className="text-[13px] text-slate-600">Safe-Fare platform administrators sign in without a tenant code.</p>
              )}
              <FormField id="login-user" label={LABELS.login} error={fieldErrors.login} required>
                <div className="relative">
                  <FieldIcon icon={Mail} />
                  <Input
                    {...fieldA11y("login-user", fieldErrors.login)}
                    name="login"
                    autoComplete="username"
                    placeholder="Enter email or username"
                    value={values.login}
                    onChange={set("login")}
                    maxLength={MAX_LENGTH.login}
                    disabled={submitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </FormField>
              <FormField id="login-password" label={LABELS.password} error={fieldErrors.password} required>
                <div className="relative">
                  <FieldIcon icon={Lock} />
                  <Input
                    {...fieldA11y("login-password", fieldErrors.password)}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    value={values.password}
                    onChange={set("password")}
                    maxLength={MAX_LENGTH.password}
                    disabled={submitting}
                    className={cn(INPUT_CLASS, "pr-12")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-slate-500 hover:text-slate-900 focus-visible:ring-[3px] focus-visible:ring-[#f16a45]/35 focus-visible:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </FormField>

              <button
                type="submit"
                disabled={submitting}
                className="flex h-13 short:h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#f08a6b] to-[#d9442a] text-[17px] font-semibold text-white shadow-[0_14px_30px_-10px_rgba(217,68,42,0.6)] transition-[filter,transform] hover:brightness-105 active:translate-y-px focus-visible:ring-[3px] focus-visible:ring-[#f16a45]/40 focus-visible:outline-none disabled:opacity-60"
              >
                {submitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
                {submitting ? "Signing in…" : "Sign in"}
                {submitting ? null : <ArrowRight className="size-5" aria-hidden />}
              </button>
            </form>

            <div className="mt-5 flex items-center gap-3 text-[13px] text-slate-600 short:mt-3 short:text-xs">
              <span className="h-px flex-1 bg-slate-200" aria-hidden />
              <ShieldCheck className="size-4" aria-hidden />
              Secure Access
              <span className="h-px flex-1 bg-slate-200" aria-hidden />
            </div>
            {API_DEBUG ? (
              <p className={cn("mt-2 text-center text-[12px] text-slate-400 short:mt-1", !API_BASE_URL && "text-red-600")}>
                {API_BASE_URL ? `API: ${API_BASE_URL}` : "NEXT_PUBLIC_API_BASE_URL is not set"}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <p className="absolute bottom-4 left-4 flex items-center gap-2.5 text-sm font-medium text-white sm:bottom-6 sm:left-12 sm:text-[15px] short:bottom-4">
        <ShieldCheck className="size-7 short:size-6" strokeWidth={1.7} aria-hidden />
        Safe • Connected • Intelligent
      </p>
    </div>
  );
}
