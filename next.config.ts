import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim production image: Dockerfile runs the traced standalone server.
  // `next dev` is unaffected.
  output: "standalone",
};

export default nextConfig;
