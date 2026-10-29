import type { CommandRecord } from "../types";
import type { CommandDefinition } from "../mock-data/catalog";
import { fleetStore } from "../store/fleet-store";
import { demoClock, simulateLatency } from "./core";

/**
 * SIMULATED device commands.
 *
 * Nothing here talks to a device, the vendor platform or the BFF. Records are created
 * locally as PENDING and resolved by a timer, mirroring the documented asynchronous
 * flow (vendor 8.x returns a commandNo; the result is polled via 8.2 / 8.4).
 * In production the BFF must audit-log every command and confirm high-risk ones.
 */
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function simulatedResponse(def: CommandDefinition, terminalType: string, sim?: string) {
  switch (def.key) {
    case "properties":
      return `model=${terminalType}; ICCID=${sim ?? "n/a"}; GNSS=GPS+BDS; fw=V2.4.7 (simulated)`;
    case "photo":
      return "Photo captured on device (simulated — no image transferred)";
    case "wake":
      return "Device awake (simulated)";
    default:
      return "Parameters acknowledged by device (simulated)";
  }
}

export const commandService = {
  async sendCommand(def: CommandDefinition, vehicleIds: string[], params: Record<string, string>, issuedBy: string) {
    await simulateLatency(300);
    const { vehicles } = fleetStore.getState();
    const issuedAt = demoClock().toISOString();
    const records: CommandRecord[] = vehicleIds.flatMap((id) => {
      const v = vehicles.find((x) => x.vehicleId === id);
      if (!v) return [];
      const offline = v.telemetry.vehicleState === "offline";
      const rejected = offline && !def.acceptsOffline;
      return [
        {
          commandNo: `SIM-${Math.floor(100000 + Math.random() * 900000)}`,
          commandKey: def.key,
          commandLabel: def.label,
          vehicleId: v.vehicleId,
          terminalNo: v.terminalNo,
          plate: v.plate,
          params,
          issuedBy,
          issuedAt,
          result: rejected ? "FAIL" : "PENDING",
          completedAt: rejected ? issuedAt : undefined,
          failResult: rejected ? "Device offline — only calibration commands are accepted while offline" : undefined,
        } satisfies CommandRecord,
      ];
    });

    fleetStore.setState((s) => ({ commands: [...records, ...s.commands] }));

    for (const record of records.filter((r) => r.result === "PENDING")) {
      const vehicle = vehicles.find((v) => v.vehicleId === record.vehicleId);
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        const ok = Math.random() > 0.1;
        fleetStore.setState((s) => ({
          commands: s.commands.map((c) =>
            c.commandNo === record.commandNo
              ? {
                  ...c,
                  result: ok ? "SUCCESS" : "FAIL",
                  completedAt: demoClock().toISOString(),
                  resultResponse: ok ? simulatedResponse(def, vehicle?.terminalType ?? "", vehicle?.sim) : undefined,
                  failResult: ok ? undefined : "No response within timeout (simulated)",
                }
              : c
          ),
        }));
      }, 1200 + Math.random() * 1600);
      pendingTimers.add(timer);
    }
    return records;
  },
};
