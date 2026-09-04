// =============================================================================
// server.ts — binds the port, tunes socket timeouts, shuts down cleanly.
// -----------------------------------------------------------------------------
// GRACEFUL SHUTDOWN IS NOT OPTIONAL HERE.
// Every deploy sends SIGTERM. Without a handler, Node exits immediately: live
// requests are severed mid-flight, and any database transaction in progress is
// abandoned for the pooler to time out. With hundreds of concurrent users that
// is a fistful of user-visible errors on every single deploy. The handler
// below stops accepting new connections, lets in-flight work finish, then
// closes the pool.
// =============================================================================
import type { Server } from "http";
import { disconnectDatabase } from "@repo/db";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

export function startServer(): Server {
  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv, pid: process.pid },
      `Luxus Green Mobility API listening on port ${env.port}`
    );
  });

  // ---------------------------------------------------------------------------
  // Socket timeouts
  // ---------------------------------------------------------------------------
  // keepAliveTimeout MUST exceed the upstream load balancer's idle timeout.
  // If Node closes an idle keep-alive socket first, the LB can still have that
  // socket selected for the next request and dispatch onto a closing
  // connection — the classic intermittent 502 that only appears under load and
  // is nearly impossible to reproduce locally.
  server.keepAliveTimeout = env.keepAliveTimeoutMs;
  // Must be greater than keepAliveTimeout, or Node races itself.
  server.headersTimeout = env.headersTimeoutMs;
  // A hard ceiling on any single request, so one pathological client (or a
  // stuck OCR job) cannot hold a connection open indefinitely.
  server.requestTimeout = env.requestTimeoutMs;

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, pid: process.pid }, "Shutdown signal received — draining");

    // If draining stalls (a hung upstream, a very slow query), exit anyway
    // rather than letting the platform SIGKILL us at an arbitrary moment.
    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, env.shutdownGraceMs);
    forceExit.unref();

    server.close(async (err) => {
      if (err) logger.error({ err }, "Error while closing HTTP server");
      try {
        await disconnectDatabase();
        logger.info("Database pool closed — exiting cleanly");
      } catch (dbErr) {
        logger.error({ err: dbErr }, "Error closing database pool");
      }
      clearTimeout(forceExit);
      process.exit(err ? 1 : 0);
    });

    // Idle keep-alive sockets hold the server open past server.close(); on
    // Node 18.2+ this closes them explicitly so draining actually finishes.
    server.closeIdleConnections?.();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A promise rejected with no catch handler would, on modern Node, terminate
  // the process by default. Log it with full context first — an unexplained
  // restart in production is far more expensive than the crash itself.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });

  // After an uncaught exception the process state is unknowable; the only
  // safe move is to stop taking traffic and let the platform restart us.
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — shutting down");
    void shutdown("uncaughtException");
  });

  return server;
}
