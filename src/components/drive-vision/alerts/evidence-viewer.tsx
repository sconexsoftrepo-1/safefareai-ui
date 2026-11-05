"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Download, FileVideo, ImageIcon, Loader2, Maximize, Minimize, RefreshCw, Scan, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../shared/status-badge";
import { useReturnFocus } from "../shared/use-return-focus";
import { diagnoseMedia, downloadEvidence, mediaFailure, statusHint, videoErrorProblem, videoPlayable, type DownloadResult, type EvidenceItem, type MediaFailure } from "./evidence-model";

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

/**
 * In-app popup for one piece of alert evidence. It sits on top of the drawer that opened it, so closing it returns to
 * the same alert, with its scroll position and filters as they were. Radix blocks the page behind it and takes Escape.
 */
export function EvidenceViewer({ item, context, onClose }: { item: EvidenceItem | null; context?: string; onClose: () => void }) {
  const restoreFocus = useReturnFocus(item !== null);
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={restoreFocus}
        // In fullscreen, Escape leaves fullscreen first; only the next one closes the popup.
        onEscapeKeyDown={(e) => document.fullscreenElement && e.preventDefault()}
        className="flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(92dvh,860px)] sm:w-[min(94vw,1120px)] sm:max-w-none sm:rounded-card sm:border"
        data-testid="evidence-viewer"
      >
        {item ? <Viewer key={item.key} item={item} context={context} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Viewer({ item, context, onClose }: { item: EvidenceItem; context?: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fullscreen = useFullscreen(stage, video);
  const [zoom, setZoom] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const Icon = item.kind === "image" ? ImageIcon : FileVideo;
  const stepZoom = (delta: number) => setZoom((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, ZOOM_STEPS.indexOf(z) + delta))]);

  function changeSpeed(value: number) {
    setSpeed(value);
    if (video.current) video.current.playbackRate = value;
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-powder text-info" aria-hidden>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-base font-semibold text-ink">{item.title}</DialogTitle>
          <DialogDescription className="truncate text-xs text-ink-muted">{context ?? "Alert evidence"}</DialogDescription>
        </div>
        {/* The backend's own status: it stays as sent, even when the file loads. */}
        {item.status ? (
          <span className="shrink-0" data-testid="evidence-status">
            <StatusBadge tone="neutral" size="sm">
              {item.status}
            </StatusBadge>
          </span>
        ) : null}
        <Button variant="outline" size="icon-sm" onClick={onClose} aria-label="Close evidence">
          <X />
        </Button>
      </div>

      <div ref={stage} className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="evidence-stage">
        {item.kind === "image" ? <ImageStage item={item} zoom={zoom} onFailed={setFailed} /> : <VideoStage item={item} videoRef={video} onFailed={setFailed} />}

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 sm:px-5" role="toolbar" aria-label="Evidence controls">
          {item.kind === "image" ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => stepZoom(-1)} disabled={failed || zoom === ZOOM_STEPS[0]} aria-label="Zoom out">
                <ZoomOut />
              </Button>
              <span className="w-11 text-center text-xs text-ink-muted tabular" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <Button variant="outline" size="icon-sm" onClick={() => stepZoom(1)} disabled={failed || zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Zoom in">
                <ZoomIn />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => setZoom(1)} disabled={failed || zoom === 1} aria-label="Fit to screen">
                <Scan />
              </Button>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              Speed
              {/* Native on purpose: a portalled menu wouldn't appear in fullscreen. */}
              <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} disabled={failed} className="h-8 rounded-control border border-line bg-surface px-2 text-[13px] text-ink tabular outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="flex-1" />
          <DownloadControl item={item} />
          <Button variant="outline" size="sm" onClick={fullscreen.toggle} disabled={!fullscreen.supported} title={fullscreen.supported ? undefined : "This browser doesn't support fullscreen"} data-testid="evidence-fullscreen">
            {fullscreen.active ? <Minimize /> : <Maximize />} {fullscreen.active ? "Exit fullscreen" : "Fullscreen"}
          </Button>
        </div>
      </div>
    </>
  );
}

function ImageStage({ item, zoom, onFailed }: { item: EvidenceItem; zoom: number; onFailed: (failed: boolean) => void }) {
  const [state, setState] = useState<"loading" | "loaded" | MediaFailure>("loading");
  const [attempt, setAttempt] = useState(0);

  async function failed() {
    onFailed(true);
    setState(await diagnoseMedia(item.url!, "image", fetch, navigator.onLine));
  }
  const retry = () => (onFailed(false), setState("loading"), setAttempt((a) => a + 1));

  return (
    <div className={cn("relative min-h-0 flex-1 overflow-auto bg-surface-muted", zoom === 1 && "grid place-items-center")} data-testid="evidence-media">
      {typeof state === "object" ? (
        <MediaError failure={state} hint={statusHint(item.status)} onRetry={retry} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- vendor media: next/image would proxy it and change the signed URL
        <img
          key={attempt}
          src={item.url!}
          alt={item.title}
          referrerPolicy="no-referrer"
          onLoad={() => setState("loaded")}
          onError={() => void failed()}
          style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }}
          className={cn(zoom === 1 && "max-h-full max-w-full object-contain", state === "loading" && "opacity-0")}
          data-testid="evidence-image"
        />
      )}
      {state === "loading" ? <StageStatus label="Loading image…" /> : null}
    </div>
  );
}

type VideoState = "connecting" | "ready" | "playing" | "paused" | "buffering" | "ended";
const VIDEO_LABEL: Record<VideoState, string> = { connecting: "Connecting…", ready: "Ready to play", playing: "Playing", paused: "Paused", buffering: "Buffering…", ended: "Finished" };

function VideoStage({ item, videoRef, onFailed }: { item: EvidenceItem; videoRef: React.RefObject<HTMLVideoElement | null>; onFailed: (failed: boolean) => void }) {
  const [state, setState] = useState<VideoState>("connecting");
  const [failure, setFailure] = useState<MediaFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback((f: MediaFailure) => (onFailed(true), setFailure(f)), [onFailed]);

  useEffect(() => {
    const el = videoRef.current;
    // React Strict Mode runs this cleanup once on mount, so the source may need putting back.
    if (el && !el.getAttribute("src")) el.src = item.url!;
    if (el && !videoPlayable(item.contentType, (t) => el.canPlayType(t))) fail(mediaFailure("video", "unsupported", item.contentType));
    // Closing stops playback and lets the browser drop the connection and buffer.
    return () => {
      if (!el) return;
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [item.contentType, item.url, videoRef, attempt, fail]);

  async function failed(code: number | undefined) {
    const problem = videoErrorProblem(code);
    if (problem === null) return;
    fail(problem === "diagnose" ? await diagnoseMedia(item.url!, "video", fetch, navigator.onLine) : mediaFailure("video", problem, item.contentType));
  }
  const retry = () => (onFailed(false), setFailure(null), setState("connecting"), setAttempt((a) => a + 1));

  return (
    <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-media-stage" data-testid="evidence-media">
      {failure ? (
        <MediaError failure={failure} hint={statusHint(item.status)} onRetry={retry} dark />
      ) : (
        <>
          <video
            key={attempt}
            ref={videoRef}
            src={item.url!}
            controls
            playsInline
            preload="metadata"
            className="max-h-full max-w-full"
            onLoadStart={() => setState("connecting")}
            onLoadedMetadata={() => setState("ready")}
            onPlaying={() => setState("playing")}
            onPause={(e) => setState(e.currentTarget.ended ? "ended" : "paused")}
            onWaiting={() => setState("buffering")}
            onEnded={() => setState("ended")}
            onError={(e) => void failed(e.currentTarget.error?.code)}
            data-testid="evidence-video"
            data-state={state}
          />
          {state === "connecting" || state === "buffering" ? <StageStatus label={VIDEO_LABEL[state]} dark /> : null}
          <span className="sr-only" role="status">
            {VIDEO_LABEL[state]}
          </span>
        </>
      )}
    </div>
  );
}

function StageStatus({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <span className={cn("pointer-events-none absolute inset-0 grid place-items-center text-[13px]", dark ? "text-white" : "text-ink-muted")} role="status">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
      </span>
    </span>
  );
}

function MediaError({ failure, hint, onRetry, dark = false }: { failure: MediaFailure; hint: string | null; onRetry: () => void; dark?: boolean }) {
  return (
    <div className="mx-auto max-w-sm p-6 text-center" role="alert" data-testid="evidence-error" data-problem={failure.problem}>
      <span className={cn("mx-auto mb-3 grid size-12 place-items-center rounded-inner", dark ? "bg-white/10 text-white" : "bg-danger-soft text-danger")} aria-hidden>
        <CircleAlert className="size-5" />
      </span>
      <p className={cn("text-sm font-semibold", dark ? "text-white" : "text-ink")}>{failure.title}</p>
      <p className={cn("mt-1 text-[13px]", dark ? "text-white/80" : "text-ink-muted")}>{failure.detail}</p>
      {hint ? <p className={cn("mt-1 text-[13px]", dark ? "text-white/80" : "text-ink-muted")}>{hint}</p> : null}
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw /> Try again
      </Button>
    </div>
  );
}

function DownloadControl({ item }: { item: EvidenceItem }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DownloadResult | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const picker = (window as unknown as { showSaveFilePicker?: Parameters<typeof downloadEvidence>[1]["showSaveFilePicker"] }).showSaveFilePicker;
    setResult(
      await downloadEvidence(item, {
        fetch: (url, init) => fetch(url, init),
        origin: location.origin,
        saveLink: (href, fileName) => {
          const a = document.createElement("a");
          a.href = href;
          a.download = fileName;
          a.rel = "noopener";
          a.click();
        },
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        showSaveFilePicker: picker ? (options) => picker.call(window, options) : undefined,
      })
    );
    setBusy(false);
  }

  const message = result?.status === "failed" ? result.message : result?.status === "saved" ? `Saved ${result.fileName}` : result?.status === "started" ? `Download started: ${result.fileName}` : null;

  return (
    <>
      {/* In the popup, not a toast: a toast wouldn't show in fullscreen. */}
      {message ? (
        <p className={cn("order-last min-w-0 basis-full text-xs", result?.status === "failed" ? "text-danger" : "text-success")} role="status" data-testid="evidence-download-result" data-status={result?.status}>
          {message}
        </p>
      ) : null}
      <Button size="sm" onClick={() => void run()} disabled={busy} data-testid="evidence-download">
        {busy ? <Loader2 className="animate-spin" /> : <Download />} {busy ? "Downloading…" : "Download"}
      </Button>
    </>
  );
}

/** The Fullscreen API on the stage, with the iPhone's video-only fallback. Leaves fullscreen when the popup goes. */
function useFullscreen(stage: React.RefObject<HTMLDivElement | null>, video: React.RefObject<HTMLVideoElement | null>) {
  const [active, setActive] = useState(false);
  const [supported] = useState(() => typeof document !== "undefined" && document.fullscreenEnabled === true);
  const iosVideo = () => (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen;

  useEffect(() => {
    const el = stage.current;
    const sync = () => setActive(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    };
  }, [stage]);

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (supported) await stage.current?.requestFullscreen();
      else iosVideo()?.call(video.current);
    } catch {
      // The browser refused. The button stays as it was, because `active` only follows fullscreenchange.
    }
  }

  return { active, supported: supported || typeof iosVideo() === "function", toggle };
}
