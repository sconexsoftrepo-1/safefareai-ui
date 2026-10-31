"use client";

import { useMemo } from "react";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { operationsService } from "@/features/drive-vision/api/operations-service";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";

/** Max page size the spec allows; pickers show the first 100 drivers and say so when there are more. */
const PICKER_PAGE = 100;

/** Driver and vehicle options for operation forms (GET /drivers, GET /devices). Pass `enabled=false` to skip fetching. */
export function usePickers(enabled: boolean) {
  const driversQ = useApiQuery(enabled ? "pickers:drivers" : null, () => operationsService.listDrivers({ status: "ACTIVE", pageNumber: 1, pageSize: PICKER_PAGE }));
  const devicesQ = useApiQuery(enabled ? "pickers:devices" : null, () => fleetService.listAllDevices());
  const drivers = useMemo(
    () => (driversQ.data?.items ?? []).filter((d) => d.id !== undefined).map((d) => ({ value: String(d.id), label: d.name ?? `Driver ${d.id}` })),
    [driversQ.data]
  );
  const devices = useMemo(
    () => (devicesQ.data?.items ?? []).filter((d) => d.id !== undefined).map((d) => ({ value: String(d.id), label: d.name ?? d.terminalNo ?? `Device ${d.id}` })),
    [devicesQ.data]
  );
  return {
    drivers,
    devices,
    driversTruncated: !!driversQ.data && driversQ.data.total > driversQ.data.items.length,
    error: driversQ.error ?? devicesQ.error,
    loading: driversQ.loading || devicesQ.loading,
  };
}
