// =============================================================================
// security.ts — transport-level hardening applied to every request.
// -----------------------------------------------------------------------------
// Three concerns, all of which the API previously had no answer for:
//   1. Security response headers (helmet).
//   2. A strict, fail-closed CORS allowlist.
//   3. Rate limiting — a global DoS ceiling plus a much tighter limit on the
//      credential endpoints, which were completely unthrottled and therefore
//      brute-forceable at whatever rate the network allowed.
// =============================================================================
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
export const securityHeaders = helmet({
  // This process serves JSON and user-uploaded files, never HTML documents,
  // so the document-oriented CSP directives have nothing to apply to. The
  // one that does matter is below, on the /uploads path.
  contentSecurityPolicy: false,
  // Uploaded files are fetched by the Next.js frontends from a different
  // origin; the restrictive default (`same-origin`) would block them.
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Only meaningful over HTTPS, and actively unhelpful on localhost where it
  // would pin the browser to https://localhost for six months.
  hsts: env.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  referrerPolicy: { policy: "no-referrer" },
});

/**
 * Extra headers for the static /uploads mount. Dealer documents, warranty
 * evidence photos and scanned vendor bills are served from here — an
 * attacker who can get an HTML or SVG file into that bucket would otherwise
 * have script execution on the API's own origin.
 */
export function uploadSecurityHeaders(_req: Request, res: Response, next: () => void) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  next();
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
// `credentials: true` means the browser sends session cookies, so the origin
// allowlist is the only thing standing between a hostile page and an
// authenticated cross-site request. Unknown origins are refused rather than
// reflected.
const allowed = new Set(env.corsOrigins);

export const corsMiddleware = cors({
  origin(origin, callback) {
    // No Origin header at all: server-to-server calls, curl, health probes and
    // same-origin navigations. There is no browser to protect in that case,
    // and the request carries no ambient cookie authority.
    if (!origin) return callback(null, true);
    if (allowed.has(origin.replace(/\/+$/, ""))) return callback(null, true);
    logger.warn({ origin }, "Blocked cross-origin request from unlisted origin");
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-request-id", "x-user-role", "x-user-id"],
  exposedHeaders: ["x-request-id"],
  // Cache the preflight for 24h so browsers stop re-asking on every mutation.
  maxAge: 86_400,
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// NOTE ON MULTI-PROCESS DEPLOYMENTS: the default store is per-process memory,
// so with N clustered workers the effective ceiling is N x the configured
// limit, and it resets on deploy. That is fine for a DoS guard. If you later
// need exact global limits (or run multiple instances behind one LB), swap in
// the Redis store — the limiter configuration below does not otherwise change.
function baseOptions(): Partial<Options> {
  return {
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Health probes must never be throttled: the platform reads a 429 as an
    // unhealthy instance and starts cycling containers under load — turning a
    // traffic spike into an outage.
    skip: (req: Request) => req.path.startsWith("/api/v1/health"),
  };
}

export const globalRateLimit = rateLimit({
  ...baseOptions(),
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  handler: (req: Request, res: Response) => {
    logger.warn({ ip: req.ip, path: req.originalUrl }, "Global rate limit exceeded");
    res.status(429).json({ success: false, message: "Too many requests — please slow down." });
  },
});

/**
 * Login, signup and any other credential-checking endpoint. Keyed by IP *and*
 * submitted username, so one attacker cannot lock out every user from a shared
 * NAT, and cannot spread an attack on a single account across many IPs without
 * also tripping the per-IP ceiling.
 */
export const authRateLimit = rateLimit({
  ...baseOptions(),
  windowMs: env.rateLimit.authWindowMs,
  limit: env.rateLimit.authMax,
  // Successful logins shouldn't consume the budget — this is here to stop
  // guessing, not to cap how often a legitimate user may sign in.
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    // ipKeyGenerator normalises IPv6 to a /64 subnet; a bare req.ip lets an
    // attacker with any IPv6 allocation rotate addresses for free.
    const ip = ipKeyGenerator(req.ip ?? "");
    const username = typeof req.body?.username === "string" ? req.body.username.toLowerCase().trim() : "";
    return `${ip}:${username}`;
  },
  handler: (req: Request, res: Response) => {
    logger.warn({ ip: req.ip, path: req.originalUrl }, "Auth rate limit exceeded");
    res.status(429).json({
      success: false,
      message: "Too many attempts. Please wait a few minutes and try again.",
    });
  },
});

/**
 * Upload and OCR endpoints. Each of these can pin a CPU core for seconds
 * (tesseract) and allocate megabytes, so they get their own, much lower
 * ceiling than ordinary JSON traffic.
 */
export const uploadRateLimit = rateLimit({
  ...baseOptions(),
  windowMs: 60_000,
  limit: 30,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ success: false, message: "Too many uploads — please wait a moment." });
  },
});
