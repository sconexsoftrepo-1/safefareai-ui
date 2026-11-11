"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowUp, Bell, CircleAlert, KeyRound, Lock, MessageSquarePlus, RotateCcw, ShieldCheck, Truck, UsersRound, Video, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiErrorMeta } from "@/features/drive-vision/api/errors";
import { IRIS_MAX_MESSAGE, describeIrisError, irisChatService, isIrisOutage } from "@/features/drive-vision/api/iris-chat-service";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import { useMediaQuery } from "@/features/drive-vision/hooks/use-media-query";
import { useShell } from "../app-shell/shell-context";
import { EASE_OUT, transitions } from "../shared/motion";
import { formatIrisTime, initialIrisChat, irisChatReducer, type IrisMessage } from "./iris-chat-model";
import { IrisMarkdown } from "./iris-markdown";

/** Starters only: each one sends a real request, and the answer comes from the server. */
const SUGGESTED_QUESTIONS: { text: string; icon: LucideIcon }[] = [
  { text: "What is a safety score?", icon: ShieldCheck },
  { text: "How do I add a vehicle?", icon: Truck },
  { text: "How do I assign a driver?", icon: UsersRound },
  { text: "How can I view live video?", icon: Video },
  { text: "How do I manage driver permissions?", icon: KeyRound },
  { text: "How do I view alerts and events?", icon: Bell },
];

const STATUS_DOT = { checking: "bg-ink-subtle", online: "bg-success", offline: "bg-danger" };
const STATUS_LABEL = { checking: "Checking connection…", online: "Connected", offline: "Unavailable" };

function MessageTime({ at, onDark = false }: { at: number; onDark?: boolean }) {
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} className={cn("mt-1 block text-[10.5px]", onDark ? "text-right text-white/70" : "text-ink-subtle")}>
      {formatIrisTime(at)}
    </time>
  );
}

function MessageBubble({ message }: { message: IrisMessage }) {
  const mine = message.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={transitions.fast} className={cn("flex", mine ? "justify-end" : "justify-start")} data-role={message.role}>
      <div className={cn("max-w-[92%] min-w-0 rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed", mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-surface-muted text-ink")}>
        {mine ? <p className="break-words whitespace-pre-wrap">{message.text}</p> : <IrisMarkdown text={message.text} />}
        <MessageTime at={message.at} onDark={mine} />
      </div>
    </motion.div>
  );
}

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
 * Iris — application help from the Iris chat service (POST /api/chat/message on the Python API, called directly from
 * the browser: api/iris-chat-service.ts, api/python-client.ts). Answers are the server's; a failed request is shown as an error with Retry, never
 * replaced by a local answer. Docked beside the page on wide screens (non-modal; the page reflows), a modal
 * sheet with overlay on smaller screens. The launcher stays mounted so focus returns to it on close.
 */
export function DriveVisionAIAssistant() {
  const { assistantOpen: open, setAssistantOpen: setOpen, pendingQuestion, clearPendingQuestion } = useShell();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [chat, dispatch] = useReducer(irisChatReducer, initialIrisChat);
  const [draft, setDraft] = useState("");
  const inflight = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  // Map/video workspaces keep their bottom-right controls clear; Iris opens from the header there.
  const hideLauncherOnDesktop = /\/drive-vision\/(monitoring|video|trips|geofences)/.test(pathname);
  const healthQ = useApiQuery(open ? "iris:health" : null, () => irisChatService.health());
  const status = chat.reachable === true || (chat.reachable === null && healthQ.data === true) ? "online" : chat.reachable === false || healthQ.data === false || healthQ.error ? "offline" : "checking";

  useEffect(() => () => inflight.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.pending, chat.failure]);

  /** Sends one request. `inflight` is set synchronously, so a second Enter before the re-render is ignored. */
  async function deliver(question: string) {
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const reply = await irisChatService.send({ message: question, conversationUuid: chat.conversationUuid }, controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "reply", reply });
    } catch (err) {
      if (!controller.signal.aborted) dispatch({ type: "fail", failure: { question, text: describeIrisError(err), meta: apiErrorMeta(err) }, reachable: !isIrisOutage(err) });
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }

  function ask(question: string) {
    const text = question.trim().slice(0, IRIS_MAX_MESSAGE);
    if (!text || inflight.current) return;
    dispatch({ type: "send", text, at: Date.now() });
    setDraft("");
    deliver(text);
  }

  function retry() {
    if (!chat.failure || inflight.current) return;
    dispatch({ type: "retry" });
    deliver(chat.failure.question);
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

  /** New chat: the next message goes without a conversation_uuid, so the server starts a new conversation. */
  function reset() {
    inflight.current?.abort();
    inflight.current = null;
    dispatch({ type: "reset" });
  }

  const empty = chat.messages.length === 0 && !chat.pending;

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
              style={{ boxShadow: "0 1px 2px rgb(36 52 77 / 0.06), 0 12px 28px -14px rgb(217 68 42 / 0.4)" }}
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
                      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} aria-hidden /> {STATUS_LABEL[status]}
                    </DialogPrimitive.Description>
                  </div>
                  <button type="button" onClick={reset} disabled={empty} className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none active:scale-95" aria-label="New chat" title="New chat">
                    <MessageSquarePlus className="size-4" />
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
                        <p className="mt-5 text-lg font-semibold tracking-tight text-ink">
                          Hello! I&apos;m <span className="text-ai-ink">Iris</span>
                        </p>
                        <p className="mt-1.5 max-w-[290px] text-[13px] leading-relaxed text-ink-muted">Your Safe-Fare AI assistant. Ask me anything about using the application.</p>
                        <ul className="mt-6 grid w-full grid-cols-2 gap-2 text-left">
                          {SUGGESTED_QUESTIONS.map((p) => (
                            <li key={p.text}>
                              <button
                                type="button"
                                onClick={() => ask(p.text)}
                                className="flex h-full w-full items-start gap-2.5 rounded-2xl bg-surface-muted/80 p-3 text-[12px] leading-snug text-ink transition-[background-color,transform] duration-150 ease-dv hover:-translate-y-px hover:bg-powder/70 focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
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
                        {chat.messages.map((m) => (
                          <MessageBubble key={m.id} message={m} />
                        ))}
                        {chat.pending ? (
                          <div className="flex justify-start" role="status" aria-label="Iris is thinking">
                            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-muted px-3.5 py-3">
                              {[0, 1, 2].map((i) => (
                                <motion.span key={i} className="size-1.5 rounded-full bg-ink-muted" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {chat.failure ? (
                          <div className="flex justify-start" role="alert">
                            <div className="max-w-[92%] min-w-0 rounded-2xl rounded-bl-md bg-danger-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-danger">
                              <p className="flex items-start gap-1.5">
                                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {chat.failure.text}
                              </p>
                              {chat.failure.meta ? <p className="mt-1 font-mono text-[10.5px] opacity-75">{chat.failure.meta}</p> : null}
                              <button type="button" onClick={retry} className="mt-2 inline-flex items-center gap-1 rounded-full border border-danger/30 bg-surface px-2.5 py-1 text-[12px] font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none">
                                <RotateCcw className="size-3" aria-hidden /> Retry
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="px-4 pt-2 pb-3">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask(draft);
                    }}
                    className="flex items-end gap-2 rounded-[22px] border border-line bg-surface py-1 pr-1 pl-4 transition-[border-color,box-shadow] duration-150 focus-within:border-brand/50 focus-within:ring-[3px] focus-within:ring-brand/15"
                  >
                    <textarea
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // isComposing: Enter that confirms IME text doesn't send.
                        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        ask(draft);
                      }}
                      rows={1}
                      placeholder="Ask about using SafeFare…"
                      className="field-sizing-content scrollbar-thin max-h-32 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-subtle"
                      aria-label="Message Iris"
                      maxLength={IRIS_MAX_MESSAGE}
                    />
                    <button type="submit" disabled={!draft.trim() || chat.pending} className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white transition-[opacity,transform,background-color] duration-150 ease-dv hover:bg-brand-hover focus-visible:ring-[3px] focus-visible:ring-brand/35 focus-visible:outline-none active:scale-95 active:duration-75 disabled:pointer-events-none disabled:opacity-30" aria-label="Send">
                      <ArrowUp className="size-4" />
                    </button>
                  </form>
                  <p className="mt-2 flex items-center justify-center gap-1 text-[10.5px] text-ink-subtle">
                    <Lock className="size-3" aria-hidden /> Don&apos;t enter passwords or private information.
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
