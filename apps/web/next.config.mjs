import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A lockfile above this repo (outside our control) makes Next.js guess the
  // wrong workspace root — pin it explicitly to silence that warning.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
