"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingSkeleton } from "../shared/feedback";

/** /vehicles/new: the "Add vehicle" form lives on the Devices & Assets page; open it there. */
export function NewVehicle() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/drive-vision/vehicles?add=1");
  }, [router]);
  return <LoadingSkeleton variant="list" rows={4} />;
}
