import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// This package is ESM ("type": "module" in package.json), so the CommonJS
// `__dirname` global is not defined here — referencing it crashes config
// loading on Vercel. Recreate it the ESM-safe way from import.meta.url.
const projectRoot = dirname(fileURLToPath(import.meta.url));

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
    root: projectRoot,
  },
};

export default nextConfig;
