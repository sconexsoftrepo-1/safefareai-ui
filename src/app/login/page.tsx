import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/components/drive-vision/auth/login-screen";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  // LoginScreen reads ?next / ?reason via useSearchParams, which needs a Suspense boundary for prerendering.
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
