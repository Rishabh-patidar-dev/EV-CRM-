import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A lockfile above this repo (outside our control) makes Next.js guess the
  // wrong workspace root — pin it explicitly to silence that warning.
  outputFileTracingRoot: path.join(__dirname, "../.."),

  // NOTE: `output: "standalone"` would cut the deployed image down a lot, but
  // it changes the start command — `next start` refuses to serve a standalone
  // build, and the host has to run `node .next/standalone/server.js` instead.
  // Not worth silently breaking an existing deploy pipeline for; enable it
  // deliberately, together with the host's start command.

  // Don't advertise the framework version to anyone shopping for a CVE.
  poweredByHeader: false,

  // gzip responses from the Next server. Harmless (and skipped) when a CDN or
  // reverse proxy in front is already doing it.
  compress: true,

  reactStrictMode: true,

  eslint: {
    // Lint is a CI concern; a lint warning shouldn't be able to fail a
    // production build and block a deploy.
    ignoreDuringBuilds: true,
  },

  async headers() {
    // Defence in depth for the browser-facing app. The API sets its own
    // equivalents (see apps/api/src/middleware/security.ts) — these protect
    // the HTML this app serves.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The CRM renders no third-party content and should never be
          // embedded — this is the clickjacking guard.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
