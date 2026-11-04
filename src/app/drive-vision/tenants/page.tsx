import type { Metadata } from "next";
import { TenantManagement } from "@/components/drive-vision/platform/tenant-management";

export const metadata: Metadata = { title: "Tenants" };

export default function TenantsPage() {
  return <TenantManagement />;
}
