"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowUp, Bell, CalendarClock, ChevronRight, Lock, RotateCcw, ShieldAlert, Sparkles, Truck, WifiOff, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fleetStore, useFleet } from "@/features/drive-vision/store/fleet-store";
import { usePreferences } from "@/features/drive-vision/hooks/use-preferences";
import { useMediaQuery } from "@/features/drive-vision/hooks/use-media-query";
import { answerQuestion, SUGGESTED_PROMPTS, type AssistantAnswer } from "./assistant-engine";
import { useShell } from "../app-shell/shell-context";
import { EASE_OUT, transitions } from "../shared/motion";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  answer?: AssistantAnswer;
}

const PROMPT_ICONS: LucideIcon[] = [Sparkles, WifiOff, ShieldAlert, CalendarClock, Truck, Bell];

/** Soft lavender → coral orb with two smiling eyes (brand-integrated, no perpetual animation). */
function AssistantOrb({ size = 30, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 32% 26%, #fff6f2 0%, var(--dv-ai-from) 40%, var(--dv-ai-to) 100%)",
        boxShadow: glow ? "0 0 0 10px rgb(231 227 241 / 0.7), 0 18px 40px -12px rgb(217 68 42 / 0.45), inset 0 -6px 14px rgb(120 60 120 / 0.22)" : "inset 0 -3px 8px rgb(120 60 120 / 0.22)",
      }}
      aria-hidden
    >
      <svg viewBox="0 0 40 20" width={size * 0.46} height={size * 0.23} fill="none" stroke="white" strokeWidth="3.4" strokeLinecap="round">
        <path d="M5 13 Q10 5 15 13" />
        <path d="M25 13 Q30 5 35 13" />
      </svg>
    </span>
  );
}

/**
 * Iris — local, rule-based assistant. Docked beside the page on wide screens
 * (non-modal; the page reflows), a modal sheet with overlay on smaller screens.
 * The launcher stays mounted so focus returns to it on close.
 */
export function DriveVisionAIAssistant() {
  const { assistantOpen: open, setAssistantOpen: setOpen, pendingQuestion, clearPendingQuestion } = useShell();
  const prefs = usePreferences();
  const wide = useMediaQuery("(min-width: 1280px)");
  const firstName = prefs.displayName.split(" ").slice(-1)[0] || "there";
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  // Map/video workspaces keep their bottom-right controls clear; Iris opens from the header there.
  const hideLauncherOnDesktop = /\/drive-vision\/(monitoring|video|trips|geofences)/.test(pathname);
  const selectedVehicleId = useFleet((s) => s.selectedVehicleId);
  const selectedVehicle = useFleet((s) => s.vehicles.find((v) => v.vehicleId === s.selectedVehicleId));
  const prompts = SUGGESTED_PROMPTS.map((p, i) => ({ text: p, icon: PROMPT_ICONS[i] ?? Sparkles })).filter((p) => selectedVehicleId || !p.text.includes("selected"));

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  function ask(question: string) {
    const text = question.trim();
    if (!text || thinking) return;
    setMessages((m) => [...m, { id: nextId.current++, role: "user", text }]);
    setDraft("");
    setThinking(true);
    timer.current = setTimeout(() => {
      const answer = answerQuestion(text, fleetStore.getState());
      setMessages((m) => [...m, { id: nextId.current++, role: "assistant", text: answer.text, answer }]);
      setThinking(false);
    }, 450 + Math.min(400, text.length * 6));
  }

  // Contextual "Ask Iris about it" questions are sent once the panel has opened.
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });
  useEffect(() => {
    if (!open || !pendingQuestion) return;
    const q = pendingQuestion;
    const t = setTimeout(() => {
      clearPendingQuestion();
      askRef.current(q);
    }, 280);
    return () => clearTimeout(t);
  }, [open, pendingQuestion, clearPendingQuestion]);

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    setThinking(false);
    setMessages([]);
  }

  const empty = messages.length === 0 && !thinking;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={!wide}>
      {/* Launcher: small, one gentle entrance, no perpetual animation. Hidden (not unmounted) while open. */}
      <DialogPrimitive.Trigger asChild>
        <motion.button
          type="button"
          ref={launcherRef}
          className={cn("group fixed right-4 bottom-4 z-40 flex items-center rounded-full focus-visible:outline-none sm:right-6 sm:bottom-6", open && "pointer-events-none", hideLauncherOnDesktop && "lg:hidden")}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: open ? 0 : 1, y: open ? 6 : 0 }}
          transition={{ duration: open ? 0.14 : 0.3, ease: EASE_OUT, delay: open ? 0 : 0.35 }}
          aria-label="Open Iris, the SafeFare AI assistant"
          tabIndex={open ? -1 : 0}
        >
          <span className="pointer-events-none mr-2 hidden translate-x-1 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-white opacity-0 shadow-card transition-[opacity,transform] duration-[180ms] ease-dv group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 sm:block">
            Ask Iris
          </span>
          <span className="relative grid size-12 place-items-center transition-transform duration-[180ms] ease-dv group-hover:-translate-y-0.5 group-active:translate-y-0 group-active:scale-95 group-active:duration-75">
            {/* Static halo — brightens on hover/focus instead of pulsing. */}
            <span
              className="pointer-events-none absolute -inset-2 rounded-full opacity-50 blur-md transition-opacity duration-200 ease-dv group-hover:opacity-90 group-focus-visible:opacity-90"
              style={{ background: "radial-gradient(circle, var(--dv-ai-from) 0%, rgb(233 137 117 / 0.55) 45%, transparent 72%)" }}
              aria-hidden
            />
            <span
              className="relative grid size-12 place-items-center rounded-full border border-line/70 bg-surface transition-shadow duration-200 ease-dv group-focus-visible:ring-[3px] group-focus-visible:ring-brand/35"
              style={{ boxShadow: "0 1px 2px rgb(31 30 38 / 0.06), 0 12px 28px -14px rgb(217 68 42 / 0.4)" }}
            >
              <AssistantOrb />
            </span>
          </span>
        </motion.button>
      </DialogPrimitive.Trigger>

      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            {!wide ? (
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-50 bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.base} />
              </DialogPrimitive.Overlay>
            ) : null}
            <DialogPrimitive.Content
              asChild
              forceMount
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                // Remember whichever control opened Iris (launcher, header button or an "Ask Iris" button).
                const active = document.activeElement;
                returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
                inputRef.current?.focus();
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                const target = returnFocus.current?.isConnected && returnFocus.current.offsetParent !== null ? returnFocus.current : launcherRef.current;
                target?.focus();
              }}
              // Docked: interacting with the page must not close the panel.
              onInteractOutside={(e) => {
                if (wide) e.preventDefault();
              }}
            >
              <motion.aside
                className={cn(
                  "fixed flex flex-col overflow-hidden rounded-[26px] border border-line/60 bg-surface shadow-pop outline-none",
                  wide ? "top-3 right-3 bottom-3 z-40 w-[384px]" : "inset-x-2 top-2 bottom-2 z-50 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:w-[400px]"
                )}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 28 }}
                transition={transitions.panel}
              >
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <AssistantOrb size={34} />
                  <div className="min-w-0 flex-1">
                    <DialogPrimitive.Title className="text-sm font-semibold text-ink">Iris AI</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                      <span className="size-1.5 rounded-full bg-success" aria-hidden /> Rule-based · 100% local
                    </DialogPrimitive.Description>
                  </div>
                  <button type="button" onClick={reset} disabled={empty} className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none active:scale-95" aria-label="Clear conversation">
                    <RotateCcw className="size-4" />
                  </button>
                  <DialogPrimitive.Close asChild>
                    <button type="button" className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none active:scale-95" aria-label="Close assistant">
                      <X className="size-4" />
                    </button>
                  </DialogPrimitive.Close>
                </div>

                <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4" aria-live="polite">
                  <AnimatePresence mode="wait" initial={false}>
                    {empty ? (
                      <motion.div key="hero" className="flex flex-col items-center pt-8 text-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={transitions.base}>
                        <AssistantOrb size={68} glow />
                        <p className="mt-6 text-lg font-semibold tracking-tight text-ink">
                          Hi {firstName}, I&apos;m <span className="text-ai-ink">Iris</span>
                        </p>
                        <p className="mt-1.5 max-w-[290px] text-[13px] leading-relaxed text-ink-muted">Ask about the fleet. I answer from the sample data in this browser — no internet, no API key.</p>
                        <ul className="mt-6 grid w-full grid-cols-2 gap-2 text-left">
                          {prompts.map((p) => (
                            <li key={p.text}>
                              <button
                                type="button"
                                onClick={() => ask(p.text)}
                                className="flex h-full w-full items-start gap-2.5 rounded-2xl bg-surface-muted/80 p-3 text-[12px] leading-snug text-ink transition-[background-color,transform] duration-150 ease-dv hover:-translate-y-px hover:bg-lavender/70 focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
                              >
                                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-brand-deep">
                                  <p.icon className="size-3.5" aria-hidden />
                                </span>
                                {p.text}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    ) : (
                      <motion.div key="thread" className="space-y-3 pt-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transitions.fast}>
                        {messages.map((m) => (
                          <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={transitions.fast} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                            <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed", m.role === "user" ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-surface-muted text-ink")}>
                              <p>{m.text}</p>
                              {m.answer?.items && m.answer.items.length > 0 ? (
                                <ul className="mt-2 space-y-1">
                                  {m.answer.items.map((item, i) => {
                                    const row = (
                                      <span className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-1.5">
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-[12.5px] font-medium">{item.label}</span>
                                          {item.sub ? <span className="block truncate text-[11.5px] text-ink-muted">{item.sub}</span> : null}
                                        </span>
                                        {item.href ? <ChevronRight className="size-3.5 shrink-0 text-ink-subtle" aria-hidden /> : null}
                                      </span>
                                    );
                                    return (
                                      <li key={i}>
                                        {item.href ? (
                                          <Link href={item.href} onClick={() => !wide && setOpen(false)} className="block rounded-xl transition-shadow duration-150 hover:ring-1 hover:ring-line">
                                            {row}
                                          </Link>
                                        ) : (
                                          row
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}
                              {m.answer?.link ? (
                                <Link href={m.answer.link.href} onClick={() => !wide && setOpen(false)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-ai-ink hover:underline">
                                  {m.answer.link.label} <ChevronRight className="size-3.5" />
                                </Link>
                              ) : null}
                            </div>
                          </motion.div>
                        ))}
                        {thinking ? (
                          <div className="flex justify-start" aria-label="Iris is thinking">
                            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-3">
                              {[0, 1, 2].map((i) => (
                                <motion.span key={i} className="size-1.5 rounded-full bg-ink-muted" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="px-4 pt-2 pb-3">
                  {!empty ? (
                    <div className="scrollbar-thin -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
                      {prompts.map((p) => (
                        <button
                          key={p.text}
                          type="button"
                          onClick={() => ask(p.text)}
                          disabled={thinking}
                          className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] whitespace-nowrap text-ink transition-colors duration-150 hover:border-line-strong hover:bg-lavender/60 focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
                        >
                          {p.text}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selectedVehicle ? (
                    <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                      <Sparkles className="size-3 text-ai-ink" aria-hidden /> Context: {selectedVehicle.vehicleName} · {selectedVehicle.plate}
                    </p>
                  ) : null}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask(draft);
                    }}
                    className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1 pl-4 transition-[border-color,box-shadow] duration-150 focus-within:border-brand/50 focus-within:ring-[3px] focus-within:ring-brand/15"
                  >
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Ask about vehicles, alerts, trips…"
                      className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-subtle"
                      aria-label="Message Iris"
                      maxLength={240}
                    />
                    <button type="submit" disabled={!draft.trim() || thinking} className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white transition-[opacity,transform,background-color] duration-150 ease-dv hover:bg-ink/85 focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none active:scale-95 active:duration-75 disabled:pointer-events-none disabled:opacity-30" aria-label="Send">
                      <ArrowUp className="size-4" />
                    </button>
                  </form>
                  <p className="mt-2 flex items-center justify-center gap-1 text-[10.5px] text-ink-subtle">
                    <Lock className="size-3" aria-hidden /> Answers are worked out in this browser from demo data. No API calls.
                  </p>
                </div>
              </motion.aside>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
