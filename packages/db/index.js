// =============================================================================
// @repo/db — the single Prisma client instance shared by the whole API.
// -----------------------------------------------------------------------------
// DELIBERATELY PLAIN JAVASCRIPT, NOT TYPESCRIPT.
//
// This package sat behind a `tsc` build for a while, and that turned a
// hundred-line module into a hard dependency of every start path: if the build
// step didn't run (or couldn't — a host that skips devDependencies leaves no
// compiler installed), `@repo/db` resolved to a dist/ that wasn't there, and
// the API could not boot by ANY route, compiled or otherwise.
//
// Shipping it as JavaScript with a hand-written index.d.ts alongside removes
// that failure mode completely: there is nothing to build, so there is nothing
// to fail. Types are unchanged for consumers — see index.d.ts.
//
// Beyond instantiating the client, this file does three things that matter
// once the app is under real load:
//   1. Bounds the connection pool explicitly.
//   2. Surfaces slow queries in the logs.
//   3. Provides a disconnect hook so shutdown doesn't sever live transactions.
//
// WHY THE POOL SIZE HAD TO BECOME EXPLICIT
// Prisma defaults `connection_limit` to (physical CPUs x 2 + 1) *per client
// instance*. That default is computed from the machine Prisma is running on and
// knows nothing about how many instances share the database. Once the API runs
// clustered — one worker per core, each with its own client — an 8-core
// container silently asks for 8 x 17 = 136 connections. Supabase's pooler caps
// well below that, so the surplus workers get "too many clients" errors under
// exactly the load the clustering was added to survive.
// =============================================================================
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

const isProd = process.env.NODE_ENV === "production";
const slowQueryMs = Number.parseInt(process.env.SLOW_QUERY_MS ?? "500", 10) || 500;

/**
 * Applies pool sizing to the connection string unless it is already spelled out
 * there. Editing the URL is how Prisma is configured for this — there is no
 * programmatic pool option.
 *
 * The default of 5 per worker is deliberately modest: with the pooler in
 * transaction mode a connection is only held for the duration of a single
 * query, so a small pool sustains a very high request rate, and staying small
 * is what lets many workers coexist against one database.
 */
function buildDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", process.env.DB_CONNECTION_LIMIT ?? "5");
    }
    if (!url.searchParams.has("pool_timeout")) {
      // Seconds to wait for a free connection before failing with P2024.
      // Failing fast beats queueing forever behind a stuck query: a request
      // that has already waited 10s is one the user gave up on.
      url.searchParams.set("pool_timeout", process.env.DB_POOL_TIMEOUT ?? "10");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "10");
    }
    return url.toString();
  } catch {
    // A malformed URL is the connection layer's problem to report, not ours.
    return raw;
  }
}

function createClient() {
  const datasourceUrl = buildDatabaseUrl();

  const client = new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });

  // Slow-query visibility. Without this, "the app feels slow" is unactionable;
  // with it, the offending query and its duration are already in the logs by
  // the time anyone asks.
  client.$on("query", (event) => {
    if (event.duration >= slowQueryMs) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "slow query",
          durationMs: event.duration,
          // The query text is parameterised; params are omitted deliberately
          // because they routinely contain personal data and credentials.
          query: String(event.query).slice(0, 500),
        })
      );
    }
  });

  client.$on("error", (event) => {
    console.error(
      JSON.stringify({ level: "error", msg: "prisma error", target: event.target, detail: event.message })
    );
  });

  client.$on("warn", (event) => {
    console.warn(
      JSON.stringify({ level: "warn", msg: "prisma warning", target: event.target, detail: event.message })
    );
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

// Reusing one client across hot reloads stops `tsx watch` from leaking a new
// connection pool on every file save. In production the process is the
// lifetime, so no global is kept.
if (!isProd) globalForPrisma.prisma = prisma;

/** Verifies the database is actually reachable — used by the readiness probe. */
export async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Closes the pool during graceful shutdown. */
export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export * from "@prisma/client";
