import { DEMO_NOW } from "../mock-data/catalog";

/**
 * Shared helpers for the mock service layer. No network requests are made anywhere
 * in SafeFare AI — every service resolves against the in-memory store after a short
 * simulated latency so loading states can be exercised.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function simulateLatency(ms = 320) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
/** Client-side id generator for locally created records (counter-based; never used during SSR). */
export function localId(prefix: string) {
  idCounter += 1;
  return `${prefix}-local-${Date.now().toString(36)}${idCounter}`;
}

const sessionStart = typeof performance !== "undefined" ? performance.now() : 0;

/**
 * Demo clock for records created during the session: the fixed snapshot time plus
 * real elapsed time since the page loaded. Call only from event handlers / effects.
 */
export function demoClock(): Date {
  const elapsed = typeof performance !== "undefined" ? performance.now() - sessionStart : 0;
  return new Date(DEMO_NOW.getTime() + elapsed);
}
