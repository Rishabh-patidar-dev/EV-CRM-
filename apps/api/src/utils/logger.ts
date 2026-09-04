// =============================================================================
// logger.ts — structured logging.
// -----------------------------------------------------------------------------
// Replaces bare console.log/console.error. Two reasons this matters in
// production and not just aesthetically:
//
//  1. console.log is a *synchronous* write to stdout when stdout is a pipe or
//     a file — which is exactly what it is under a process manager or a
//     container runtime. Under load, every log line blocks the event loop.
//     pino writes asynchronously and serializes ~5x faster.
//  2. Unstructured text can't be queried. JSON lines can be filtered by
//     requestId, status, or duration in any log aggregator.
//
// Every log line carries a requestId (see requestContext.ts), so one user's
// failing request can be traced end to end through a multi-worker process.
// =============================================================================
import { pino } from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.logLevel,
  // Pretty output is a development nicety; in production the raw JSON is
  // what the aggregator wants, and the transport worker is pure overhead.
  ...(env.isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }),
  // Belt and braces: even if a secret is accidentally attached to a log
  // context somewhere, it never reaches the log sink in cleartext.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "password",
      "passwordHash",
      "token",
      "*.password",
      "*.passwordHash",
      "*.token",
    ],
    censor: "[redacted]",
  },
  base: { service: "luxus-api" },
});

export type Logger = typeof logger;
