// =============================================================================
// env.ts — validated configuration, resolved once at boot.
// -----------------------------------------------------------------------------
// Every process.env read in the API funnels through here so that a
// misconfigured deployment fails immediately and loudly at startup rather
// than at 3am on the first request that happens to need the missing value.
//
// The old failure mode this replaces: JWT_SECRET was read lazily inside
// auth.controller.ts, so an instance missing it would boot happily, serve
// health checks, pass the load balancer's readiness probe, and only throw
// when a real user tried to log in.
// =============================================================================
import "dotenv/config";

type NodeEnv = "development" | "test" | "production";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    // Printed as well as thrown: a bare stack trace in a host's deploy log is
    // easy to misread as a code bug, and this is a configuration problem with
    // a one-line fix.
    console.error(
      "\n" +
        "==================================================================\n" +
        ` CONFIGURATION ERROR: ${name} is not set.\n` +
        "\n" +
        " The API cannot start without it. Add it to the environment\n" +
        " variables for this service (see apps/api/.env.example for the\n" +
        " full list and what each one does), then redeploy.\n" +
        "==================================================================\n"
    );
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function bool(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = optional("NODE_ENV", "development") as NodeEnv;
const isProd = nodeEnv === "production";

// A secret short enough to brute-force is worse than an obviously absent one,
// because it looks configured. 32 chars is the floor for an HS256 signing key.
//
// This warns rather than throws: a short secret is a weak configuration, not a
// broken one, and refusing to boot over it would take a running production
// service down for a policy check. Absence is still fatal — the app genuinely
// cannot sign a session without it.
function secret(name: string): string {
  const value = required(name);
  if (isProd && value.length < 32) {
    console.warn(
      `[config] WARNING: ${name} is only ${value.length} characters. ` +
        `Use at least 32 in production — generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
    );
  }
  return value;
}

// CORS is an allowlist, never a wildcard: these are credentialed requests
// (session cookies), and `Access-Control-Allow-Origin: *` is both refused by
// browsers for credentialed requests and wrong in principle.
function originList(): string[] {
  const explicit = process.env.CORS_ORIGINS?.trim();
  if (explicit) {
    return explicit
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  }
  return [
    optional("WEB_ORIGIN", "http://localhost:3000"),
    optional("LANDING_ORIGIN", "http://localhost:3001"),
    optional("DMS_ORIGIN", "http://localhost:3002"),
  ]
    .map((o) => o.replace(/\/+$/, ""))
    .filter(Boolean);
}

export const env = {
  nodeEnv,
  isProd,
  isDev: nodeEnv === "development",
  isTest: nodeEnv === "test",

  port: int("PORT", 4000),
  // 0 => "one worker per CPU core". 1 disables clustering (the right choice
  // on a single-core container, where forking only adds overhead).
  clusterWorkers: int("CLUSTER_WORKERS", 0),
  trustProxy: optional("TRUST_PROXY", isProd ? "1" : "false"),

  databaseUrl: required("DATABASE_URL"),

  jwtSecret: secret("JWT_SECRET"),
  jwtDealerSecret: secret("JWT_DEALER_SECRET"),

  corsOrigins: originList(),

  // The hardcoded Admin/Admin@123 account in auth.controller.ts. Genuinely
  // useful for demoing against a paused database — and a straightforward
  // backdoor if it ships to production, so it is opt-in and refuses to
  // enable itself there without a deliberate override.
  enableDemoLogin: bool("ENABLE_DEMO_LOGIN", !isProd),

  // The x-user-role header escape hatch that requireAuth used to trust
  // unconditionally. Development only, and never honoured in production
  // regardless of how this is set.
  allowHeaderAuth: bool("ALLOW_HEADER_AUTH", false) && !isProd,

  ingestWebhookSecret: process.env.INGEST_WEBHOOK_SECRET?.trim() || null,

  logLevel: optional("LOG_LEVEL", isProd ? "info" : "debug"),
  // Any single query slower than this gets logged with its duration so slow
  // paths surface in production logs instead of only in user complaints.
  slowQueryMs: int("SLOW_QUERY_MS", 500),

  rateLimit: {
    // Generous by design: this is a DoS guard, not a business quota. A busy
    // dealer clicking through the portal generates bursts of legitimate
    // parallel requests, so the global ceiling has to sit well above that.
    windowMs: int("RATE_LIMIT_WINDOW_MS", 60_000),
    max: int("RATE_LIMIT_MAX", 600),
    // Credential endpoints are the ones actually worth throttling hard.
    authWindowMs: int("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
    authMax: int("AUTH_RATE_LIMIT_MAX", 10),
  },

  maxJsonBodyBytes: int("MAX_JSON_BODY_BYTES", 1_000_000), // 1 MB
  maxUploadBytes: int("MAX_UPLOAD_BYTES", 10 * 1024 * 1024), // 10 MB

  // Must exceed the load balancer's own idle timeout, or the LB will reuse a
  // socket Node has already closed and the client sees a spurious 502.
  keepAliveTimeoutMs: int("KEEP_ALIVE_TIMEOUT_MS", 65_000),
  headersTimeoutMs: int("HEADERS_TIMEOUT_MS", 70_000),
  requestTimeoutMs: int("REQUEST_TIMEOUT_MS", 30_000),
  shutdownGraceMs: int("SHUTDOWN_GRACE_MS", 15_000),
} as const;

export type Env = typeof env;
