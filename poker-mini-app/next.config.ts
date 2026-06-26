import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // This lives in a monorepo alongside other JS/TS projects (poker-snap,
  // LeakSnipe, etc.), each with their own lockfile. Turbopack's automatic
  // workspace-root inference can walk up past this directory and pick one
  // of those as the root instead, then fail to find `src/app` at all.
  // Pin it explicitly so the build is never ambiguous.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
