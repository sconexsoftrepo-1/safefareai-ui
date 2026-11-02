import type { Metadata } from "next";
import { PermissionCatalog } from "@/components/drive-vision/platform/permission-catalog";

export const metadata: Metadata = { title: "Permission Catalogue" };

export default function PermissionCatalogPage() {
  return <PermissionCatalog />;
}
