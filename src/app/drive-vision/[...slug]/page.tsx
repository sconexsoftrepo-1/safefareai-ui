import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Any /drive-vision/* path without its own page. Without this, unmatched paths skip the
 * drive-vision layout and get Next's bare 404; here they render ./not-found.tsx inside the shell.
 */
export default function UnknownDriveVisionPage() {
  notFound();
}
