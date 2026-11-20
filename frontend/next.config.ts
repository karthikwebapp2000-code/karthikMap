import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // satellite.js ships an optional WASM build that mentions Node-only modules; the browser never runs that branch.
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:(module|fs|path|url|worker_threads)$/, path.resolve("lib/empty-module.js")),
    );
    return config;
  },
  async headers() {
    return [
      {
        source: "/maplibre-gl-worker.mjs",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
