import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is used for the Docker image (set in the Dockerfile build stage).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
  // Allows a side-by-side dev server (NEXT_DIST_DIR=.next-dev) without clobbering a production build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@modelcontextprotocol/sdk", "mqtt"],
};

export default nextConfig;
