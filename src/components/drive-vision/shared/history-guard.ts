/** The parts of `window` the guard uses, so Back and Forward can be tested without a browser. */
export interface HistoryWindow {
  history: { go(delta: number): void };
  /** Navigation API. Its entry index says where a traversal landed; older browsers don't have it. */
  navigation?: { currentEntry: { index: number } | null };
  addEventListener(type: "popstate", listener: (e: PopStateEvent) => void): void;
}

let hold: ((e: PopStateEvent) => void) | null = null;

/**
 * Must run before the App Router mounts (see src/instrumentation-client.ts). Browsers fire window popstate listeners
 * in registration order, capture or not, and the router's handler swaps the page synchronously, so only a listener
 * registered ahead of the router can stop it. Does nothing until holdHistory arms it.
 */
export function installHistoryGate(win: Pick<HistoryWindow, "addEventListener">) {
  win.addEventListener("popstate", (e) => hold?.(e));
}

/**
 * Holds browser Back and Forward on the current history entry until released. The App Router has no blocking API
 * and a traversal can't be cancelled from popstate, so it is undone: the event is stopped before the router sees it,
 * so the page never changes, and the same distance is travelled back. `onHeld` gets the traversal's delta, to resume
 * it if the user chooses to leave.
 *
 * Nothing is pushed, so there is no extra entry to get stuck on after a save and Forward history survives.
 * `allow` lets a confirmed traversal through. Without the Navigation API the direction can't be known and a
 * traversal is taken to be one step Back.
 */
export function holdHistory(win: HistoryWindow, onHeld: (delta: number) => void, allow: () => boolean): () => void {
  const position = () => win.navigation?.currentEntry?.index ?? null;
  const home = position();
  let returning = false;

  const onPopState = (e: PopStateEvent) => {
    if (allow()) return;
    e.stopImmediatePropagation();
    const at = position();
    if (at === null ? returning : at === home) {
      returning = false; // the undo arriving; undoing it again would loop
      return;
    }
    const distance = at === null || home === null ? 1 : home - at;
    returning = true;
    win.history.go(distance);
    onHeld(-distance);
  };

  hold = onPopState;
  return () => {
    if (hold === onPopState) hold = null;
  };
}
