// =============================================================================
// requestLogger.ts — one structured log line per request, plus a request id.
// -----------------------------------------------------------------------------
// The request id is the thread that ties everything together: it goes into
// every log line for that request, into the error response body, and into the
// `x-request-id` response header. When a dealer reports "it failed at 2pm",
// that header is enough to find the exact stack trace across every worker.
//
// An inbound x-request-id is honoured so a trace started at the load balancer
// or the Next.js frontend stays continuous rather than being renamed here.
// =============================================================================
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { pinoHttp } from "pino-http";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

// Health checks fire every few seconds from the platform's probe. Logging
// them buries real traffic in noise and costs money in log ingestion.
const SILENT_PATHS = new Set(["/api/v1/health", "/api/v1/health/ready", "/api/v1/health/live", "/"]);

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage, res: ServerResponse) => {
    const inbound = req.headers["x-request-id"];
    const id = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  autoLogging: {
    ignore: (req: IncomingMessage) => SILENT_PATHS.has((req.url || "").split("?")[0] ?? ""),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res, responseTime) =>
    `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
  // The default serializers dump every header on every line. In production
  // that is both noisy and a way for a stray secret header to reach the log.
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: env.isProd ? undefined : req.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

// pino-http augments IncomingMessage with `id` itself, so it is read via
// this helper rather than re-declared (its ReqId type is wider than string).
export function requestIdOf(req: { id?: unknown }): string | undefined {
  return typeof req.id === "string" ? req.id : req.id != null ? String(req.id) : undefined;
}
