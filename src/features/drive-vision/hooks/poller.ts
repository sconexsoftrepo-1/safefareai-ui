/** Backend contract (docs/contracts/polling-apis.txt): live lists are re-read every 5 seconds. */
export const POLL_INTERVAL_MS = 5_000;

/** What the loop needs from the browser, so its timing can be tested without one. */
export interface PollEnvironment {
  isHidden(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

export const browserPollEnvironment: PollEnvironment = {
  isHidden: () => document.visibilityState === "hidden",
  onVisibilityChange: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export interface PollerOptions<T> {
  /** One request. Must honour the signal. */
  run: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onError: (error: unknown) => void;
  /** True for a failure retrying can't fix: the loop stops until `pollNow` or a new poller. */
  shouldHalt?: (error: unknown) => boolean;
  intervalMs?: number;
  env?: PollEnvironment;
}

export interface Poller {
  start(): void;
  /** Ends the loop for good: clears the timer and listener, and aborts a request in flight. */
  stop(): void;
  /** Polls straight away, or right after the request in flight, then carries on at the normal pace. */
  pollNow(): void;
}

/**
 * One self-rescheduling polling loop. The next timer is set only when a request has finished, so requests can
 * never overlap however slow the server is. While the tab is hidden no timer runs; becoming visible polls at once.
 */
export function createPoller<T>({ run, onData, onError, shouldHalt = () => false, intervalMs = POLL_INTERVAL_MS, env = browserPollEnvironment }: PollerOptions<T>): Poller {
  let running = false;
  let halted = false;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  let pollAgain = false;
  let stopListening: (() => void) | null = null;

  const clearPending = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    clearPending();
    if (running && !halted && !env.isHidden()) timer = env.setTimer(poll, intervalMs);
  };

  function poll() {
    timer = null;
    if (!running || halted || env.isHidden()) return;
    if (inFlight) {
      pollAgain = true;
      return;
    }
    const request = new AbortController();
    inFlight = request;
    const settle = (deliver: () => void) => {
      if (inFlight !== request) return; // stopped meanwhile: the result belongs to nobody
      inFlight = null;
      deliver();
      if (pollAgain) {
        pollAgain = false;
        poll();
      } else schedule();
    };
    new Promise<T>((resolve) => resolve(run(request.signal))).then(
      (data) => settle(() => onData(data)),
      (error) =>
        settle(() => {
          if (shouldHalt(error)) halted = true;
          onError(error);
        })
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      halted = false;
      stopListening = env.onVisibilityChange(() => {
        if (env.isHidden()) clearPending();
        else if (!inFlight) {
          clearPending();
          poll();
        }
      });
      poll();
    },
    stop() {
      running = false;
      pollAgain = false;
      clearPending();
      stopListening?.();
      stopListening = null;
      inFlight?.abort();
      inFlight = null;
    },
    pollNow() {
      if (!running) return;
      halted = false;
      clearPending();
      poll();
    },
  };
}
