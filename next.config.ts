import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a small self-contained Node.js server for the production image.
  output: "standalone",
};

export default nextConfig;
