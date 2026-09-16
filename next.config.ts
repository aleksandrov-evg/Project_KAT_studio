import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a small self-contained Node.js server for the production image.
  output: "standalone",
  // Lets phones on the current local network load Next.js development assets.
  allowedDevOrigins: ["192.168.88.145"],
};

export default nextConfig;
