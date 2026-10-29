"use client";

import { useMemo } from "react";
import { fleetService } from "@/features/drive-vision/api/fleet-service";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";

/**
 * Name lookups for ids on DeviceDto (groupId, modelId, objectTypeId, protocolCode) from
 * GET /groups and /reference/*. A failed lookup never blocks the page: callers fall back
 * to showing the raw id, and `errors` lists what's missing.
 */
export function useFleetReference({ protocols = false }: { protocols?: boolean } = {}) {
  const groupsQ = useApiQuery("ref:groups", () => fleetService.listGroups());
  const modelsQ = useApiQuery("ref:device-models", () => fleetService.deviceModels());
  const typesQ = useApiQuery("ref:object-types", () => fleetService.objectTypes());
  const protocolsQ = useApiQuery(protocols ? "ref:protocols" : null, () => fleetService.protocols());

  return useMemo(() => {
    const groupName = new Map((groupsQ.data?.items ?? []).map((g) => [g.id, g.name ?? `Group ${g.id}`]));
    const modelName = new Map((modelsQ.data?.items ?? []).map((m) => [m.id, m.name ?? `Model ${m.id}`]));
    const typeName = new Map((typesQ.data?.items ?? []).map((t) => [t.id, t.name ?? `Type ${t.id}`]));
    const protocolName = new Map((protocolsQ.data?.items ?? []).map((p) => [p.code, p.name ?? `Protocol ${p.code}`]));
    return {
      groups: groupsQ.data?.items ?? [],
      groupsQuery: groupsQ,
      group: (id?: number) => (id === undefined ? "—" : (groupName.get(id) ?? `Group #${id}`)),
      model: (id?: number) => (id === undefined ? "—" : (modelName.get(id) ?? `Model #${id}`)),
      objectType: (id?: number) => (id === undefined ? "—" : (typeName.get(id) ?? `Type #${id}`)),
      protocol: (code?: number) => (code === undefined ? "—" : (protocolName.get(code) ?? `Protocol ${code}`)),
      errors: [groupsQ.error && "groups", modelsQ.error && "device models", typesQ.error && "object types", protocolsQ.error && "protocols"].filter(Boolean) as string[],
    };
  }, [groupsQ, modelsQ.data, modelsQ.error, typesQ.data, typesQ.error, protocolsQ.data, protocolsQ.error]);
}
