"use client";

import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "../shared/page-header";
import { Panel } from "../shared/panel";
import { EmptyState } from "../shared/feedback";
import { WRITES_PENDING } from "./vehicles-page";

/**
 * POST /api/v1/devices exists, but device writes are on hold until their charging
 * semantics (DeviceRequest.confirmChargeableChange) are confirmed. The sample-data form
 * (VehicleForm) is kept for when writes are approved; it is not shown so nothing is
 * "saved" locally as if it reached the server.
 */
export function NewVehicle() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/drive-vision/vehicles" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> All vehicles
      </Link>
      <PageHeader showTitle title="Add vehicle" description="Register a vehicle and its tracking device." />
      <Panel className="p-5 sm:p-6">
        <EmptyState
          icon={ShieldAlert}
          title="Adding devices isn't enabled yet"
          description={`${WRITES_PENDING} Registering a device may involve vendor charges, so it needs a product-owner decision first.`}
          action={
            <Button asChild variant="outline">
              <Link href="/drive-vision/vehicles">
                <ArrowLeft /> Back to vehicles
              </Link>
            </Button>
          }
        />
      </Panel>
    </div>
  );
}
