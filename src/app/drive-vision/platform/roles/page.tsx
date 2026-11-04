import type { Metadata } from "next";
import { GlobalRoles } from "@/components/drive-vision/platform/global-roles";

export const metadata: Metadata = { title: "Global Roles" };

export default function GlobalRolesPage() {
  return <GlobalRoles />;
}
