"use client";

import { Toaster } from "@/components/ui/sonner";

/** App-wide toast host (sonner). Positioned bottom-left so it never covers the AI launcher. */
export function ToastProvider() {
  return <Toaster position="bottom-left" closeButton toastOptions={{ duration: 3600 }} />;
}

export { toast } from "sonner";
