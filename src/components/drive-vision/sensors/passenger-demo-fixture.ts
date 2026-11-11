/**
 * Passenger Analytics DEMO journey — SIMULATED DATA, never vehicle telemetry.
 *
 * One fixture feeds all four reconciliation tabs of the Sensors screen (Sensor vs BMS, Stops, BMS records, Sensor
 * readings) when NEXT_PUBLIC_PASSENGER_DEMO_MODE=true and the demo journey is chosen (passenger-demo.ts). It holds
 * only the journey's inputs: the bus, the starting load, each stop's BMS and sensor boardings / alightings, the five
 * sensor readings and the alcohol check. Every on-board count, difference, status and summary is derived from these
 * (passenger-demo.ts), so there is one source of truth. Nothing here is sent to an API or stored anywhere.
 */

export interface DemoBus {
  busNumber: string;
  route: string;
  routeName: string;
  capacity: number;
  /** Journey date, IST, "YYYY-MM-DD". */
  date: string;
  startingPassengers: number;
}

/** The alcohol check of the window. NO_READING keeps every value null: no reading is invented. */
export interface DemoAlcoholCheck {
  status: "NO_READING";
  time: null;
  sensor: null;
  value: null;
  message: string;
}

export interface DemoSensorReading {
  /** IST wall clock on the journey date, "HH:mm:ss". */
  time: string;
  sensor: string;
  type: "PASSENGER_COUNT";
  data: "ENTRY" | "EXIT";
  /** On-board passengers reported by the sensor at that time. */
  value: number;
  active: boolean;
}

/** One stop: the inputs of both counting systems. Counts on board are derived, never stored. */
export interface DemoStopInput {
  /** IST wall clock, "HH:mm". */
  time: string;
  stop: string;
  seq: number;
  bmsId: string;
  bmsIn: number;
  bmsOut: number;
  sensorIn: number;
  sensorOut: number;
  note: string;
}

export interface DemoJourneyInput {
  /** Stable key of this journey (query keys, test ids). */
  id: string;
  bus: DemoBus;
  alcohol: DemoAlcoholCheck;
  sensorReadings: DemoSensorReading[];
  stops: DemoStopInput[];
}

export const PASSENGER_DEMO_JOURNEY: DemoJourneyInput = {
  id: "TS09UB2180-2026-11-11",
  bus: { busNumber: "TS09UB2180", route: "218", routeName: "Hyderabad City Route", capacity: 44, date: "2026-11-11", startingPassengers: 12 },
  alcohol: { status: "NO_READING", time: null, sensor: null, value: null, message: "No active alcohol reading in this window." },
  sensorReadings: [
    { time: "08:15:10", sensor: "SEN-001", type: "PASSENGER_COUNT", data: "ENTRY", value: 15, active: true },
    { time: "08:25:32", sensor: "SEN-001", type: "PASSENGER_COUNT", data: "ENTRY", value: 18, active: true },
    { time: "08:35:45", sensor: "SEN-001", type: "PASSENGER_COUNT", data: "EXIT", value: 16, active: true },
    { time: "08:45:18", sensor: "SEN-001", type: "PASSENGER_COUNT", data: "ENTRY", value: 22, active: true },
    { time: "08:55:40", sensor: "SEN-001", type: "PASSENGER_COUNT", data: "EXIT", value: 19, active: true },
  ],
  // Sensor in / out at ESI Hospital and Erragadda are the corrected values, so the sensor progression is consistent
  // with the five readings (15, 18, 16, 22, 19).
  stops: [
    { time: "08:15", stop: "Ameerpet", seq: 1, bmsId: "BMS-001", bmsIn: 5, bmsOut: 2, sensorIn: 5, sensorOut: 2, note: "Passenger counts match." },
    { time: "08:25", stop: "SR Nagar", seq: 2, bmsId: "BMS-001", bmsIn: 8, bmsOut: 4, sensorIn: 7, sensorOut: 4, note: "One passenger discrepancy." },
    { time: "08:35", stop: "ESI Hospital", seq: 3, bmsId: "BMS-001", bmsIn: 3, bmsOut: 6, sensorIn: 4, sensorOut: 6, note: "Passenger counts match." },
    { time: "08:45", stop: "Erragadda", seq: 4, bmsId: "BMS-001", bmsIn: 10, bmsOut: 3, sensorIn: 9, sensorOut: 3, note: "One passenger discrepancy." },
    { time: "08:55", stop: "Moosapet", seq: 5, bmsId: "BMS-001", bmsIn: 4, bmsOut: 5, sensorIn: 4, sensorOut: 7, note: "Three passenger discrepancy." },
  ],
};
