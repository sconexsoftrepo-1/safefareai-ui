import type { Metadata } from "next";
import { UsersPage } from "@/components/drive-vision/users/users-page";

export const metadata: Metadata = { title: "Users & Sub-Accounts" };

export default function Page() {
  return <UsersPage />;
}
