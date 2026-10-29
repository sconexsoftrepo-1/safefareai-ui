import type { CommandDto, CommandTargetDto } from "@/features/drive-vision/api/types";

/** Display text for an arbitrary JSON value (params, results): strings as-is, others serialised. */
export const rawValue = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v));

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
/** An ISO-like timestamp the UI can format; anything unparseable is treated as missing. */
const time = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

export interface CommandTargetView {
  key: string;
  deviceId: number | null;
  terminalNo: string | null;
  status: string | null;
  failReason: string | null;
  sentAt: string | null;
  finishedAt: string | null;
  result: unknown;
}

export interface CommandDetailView {
  type: string | null;
  section: string | null;
  status: string | null;
  createdAt: string | null;
  completedAt: string | null;
  requestedBy: number | null;
  params: string;
  targets: CommandTargetView[];
  /** Entries in `targets` that weren't objects and were skipped. */
  droppedTargets: number;
  /** `targetCount` when it's a whole number. */
  targetCount: number | null;
  /** The server's count and the targets it returned disagree (e.g. count 1, no targets). */
  targetCountMismatch: boolean;
}

/**
 * Normalises GET /commands/{id} (or a list row) for display. Every field is optional in the spec
 * and values are shown as returned; malformed values become "missing" rather than crashing the
 * panel or rendering "User null" / "Invalid Date". Nothing is filled in that the server didn't send.
 */
export function commandDetailView(dto: CommandDto | null | undefined): CommandDetailView {
  const d: Partial<Record<keyof CommandDto, unknown>> = dto && typeof dto === "object" ? dto : {};
  const rawTargets = Array.isArray(d.targets) ? d.targets : [];
  const targets = rawTargets
    .filter((t): t is CommandTargetDto => !!t && typeof t === "object" && !Array.isArray(t))
    .map((t, i): CommandTargetView => ({
      key: int(t.id) !== null ? `t${t.id}` : `i${i}`,
      deviceId: int(t.deviceId),
      terminalNo: text(t.terminalNo),
      status: text(t.status),
      failReason: text(t.failReason),
      sentAt: time(t.sentAt),
      finishedAt: time(t.finishedAt),
      result: t.result,
    }));
  const targetCount = int(d.targetCount);
  return {
    type: text(d.type),
    section: text(d.section),
    status: text(d.status),
    createdAt: time(d.createdAt),
    completedAt: time(d.completedAt),
    requestedBy: int(d.requestedBy),
    params: rawValue(d.params),
    targets,
    droppedTargets: rawTargets.length - targets.length,
    targetCount,
    targetCountMismatch: targetCount !== null && targetCount !== targets.length,
  };
}
