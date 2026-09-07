// =============================================================================
// errorHandler.ts — the single place an error becomes an HTTP response.
// -----------------------------------------------------------------------------
// The exported signatures are unchanged, so all ~20 controllers keep working
// untouched. What changed is what reaches the client.
//
// Previously every failure returned 500 with the raw exception message
// interpolated into the body:
//
//     { "message": "Get dealers failed: Invalid `prisma.dealer.findMany()`
//                   invocation: Unknown argument `foo`. Available: id, legalName,
//                   gstNumber, panNumber, ... " }
//
// That hands an attacker the database schema, the ORM and its version, and
// often file paths — and it turned genuinely-expected conditions (a duplicate
// GST number, a stale record) into opaque 500s that monitoring can't
// distinguish from real outages.
//
// Now: the full error is logged server-side against the request id, well-known
// database failures map to accurate status codes, and production clients get a
// safe message plus that request id to quote in a support ticket.
// =============================================================================
import type { Request, Response } from "express";
import { Prisma } from "@repo/db";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/** Thrown deliberately by application code when the client is at fault. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly field?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

function requestIdOf(res: Response): string | undefined {
  const header = res.getHeader("x-request-id");
  if (typeof header === "string") return header;
  const id = (res.req as (Request & { id?: unknown }) | undefined)?.id;
  return typeof id === "string" ? id : id != null ? String(id) : undefined;
}

interface Mapped {
  status: number;
  message: string;
  field?: string;
  /** False for expected client errors — they are noise at error level. */
  isServerFault: boolean;
}

function mapError(error: unknown, context: string): Mapped {
  if (error instanceof AppError) {
    return { status: error.status, message: error.message, field: error.field, isServerFault: false };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(", ")
      : typeof error.meta?.target === "string"
        ? error.meta.target
        : undefined;

    switch (error.code) {
      case "P2002":
        return {
          status: 409,
          message: target
            ? `A record with that ${target} already exists.`
            : "That record already exists.",
          field: target,
          isServerFault: false,
        };
      case "P2025":
        return { status: 404, message: "The requested record no longer exists.", isServerFault: false };
      case "P2003":
        return {
          status: 400,
          message: "That change references a record that doesn't exist.",
          isServerFault: false,
        };
      case "P2000":
        return { status: 400, message: "One of the submitted values is too long.", field: target, isServerFault: false };
      case "P2024":
        // Connection pool exhausted — a genuine capacity signal. 503 tells the
        // load balancer to retry elsewhere instead of counting it as a bug.
        return { status: 503, message: "The service is busy. Please retry shortly.", isServerFault: true };
      case "P1001": // can't reach the database server
      case "P1002": // database server timed out
      case "P1008": // operation timed out
      case "P1017": // server closed the connection
        // The database is unreachable or slow, which is an infrastructure
        // condition rather than a defect in this request. 503 is the honest
        // status: it tells the caller (and the load balancer, and uptime
        // monitoring) that retrying is the right move, whereas a 500 says the
        // request itself was broken and retrying is pointless.
        return {
          status: 503,
          message: "The service is temporarily unable to reach its database. Please retry shortly.",
          isServerFault: true,
        };
      default:
        return { status: 500, message: "A database error occurred.", isServerFault: true };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // Almost always a bad query parameter reaching Prisma — client's fault,
    // and the raw text describes the whole schema, so it must not go out.
    return { status: 400, message: "The request contained invalid parameters.", isServerFault: false };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return { status: 503, message: "The service is temporarily unavailable.", isServerFault: true };
  }

  return { status: 500, message: `${context} failed.`, isServerFault: true };
}

export function handleError(error: unknown, res: Response, context: string) {
  const mapped = mapError(error, context);
  const requestId = requestIdOf(res);

  const log = { err: error, context, requestId, status: mapped.status };
  if (mapped.isServerFault) logger.error(log, `${context} failed`);
  else logger.warn(log, `${context} rejected`);

  if (res.headersSent) return;

  res.status(mapped.status).json({
    success: false,
    message: mapped.message,
    ...(mapped.field ? { field: mapped.field } : {}),
    ...(requestId ? { requestId } : {}),
    // Outside production the raw detail is what makes local debugging
    // tolerable; it is never included in a production response.
    ...(env.isProd ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  });
}

export function handleValidationError(res: Response, message: string, field: string, context: string) {
  logger.debug({ context, field, requestId: requestIdOf(res) }, message);
  if (res.headersSent) return;
  res.status(400).json({ success: false, message, field, context });
}

export function handleNotFoundError(res: Response, entity: string, context: string) {
  if (res.headersSent) return;
  res.status(404).json({ success: false, message: `${entity} not found`, context });
}

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection that hangs the
 * client's socket until it times out.
 */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: (err?: unknown) => void) => Promise<unknown>
) {
  return (req: T, res: Response, next: (err?: unknown) => void) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
