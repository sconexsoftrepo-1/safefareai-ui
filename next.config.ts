import type { NextConfig } from "next";
import { securityHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Security headers on every route (see src/config/security-headers.ts and
  // docs/evidence/final-frontend-gap-audit.md → GA-04 for the production deployment notes).
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

export default nextConfig;
