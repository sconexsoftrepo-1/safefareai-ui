
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  poweredByHeader: false,

  devIndicators: false,

  // Generate static HTML, CSS and JavaScript into /out.
  // output: "export",

  // Generate routes as directories containing index.html.
  trailingSlash: true,

  // Required for static hosting when using next/image
  // without a Next.js image optimization server.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
