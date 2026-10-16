import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    "/*": ["./theclaimant_starting_reference.txt"],
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
