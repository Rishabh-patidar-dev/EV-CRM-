// =============================================================================
// app.ts — Express application assembly.
// -----------------------------------------------------------------------------
// Split out from index.ts so the app can be constructed without binding a
// port (for tests, and so the cluster primary never accidentally listens).
// Middleware order below is deliberate and load-bearing; see the comments.
// =============================================================================
import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { checkDatabase } from "@repo/db";
import routes from "./routes/index.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { requestLogger } from "./middleware/requestLogger.js";
import {
  corsMiddleware,
  globalRateLimit,
  securityHeaders,
  uploadSecurityHeaders,
} from "./middleware/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Behind Render/Vercel/an ALB, the socket's peer address is the proxy, not
  // the user. Without this, rate limiting keys every request in the world to
  // one "IP" and the first burst of traffic locks out everyone. Set to a hop
  // count rather than `true`: blanket trust lets a client forge
  // X-Forwarded-For and evade the limiter entirely.
  const hops = Number.parseInt(env.trustProxy, 10);
  app.set("trust proxy", Number.isFinite(hops) ? hops : env.trustProxy === "true");

  // Advertising the framework and version only helps someone shopping for a
  // matching CVE.
  app.disable("x-powered-by");
  // Weak ETags on JSON cost CPU to compute and are near-useless for the
  // authenticated, always-changing payloads this API returns.
  app.set("etag", false);

  // Logging first, so even a request rejected by CORS or the rate limiter is
  // recorded and carries an x-request-id.
  app.use(requestLogger);

  app.use(securityHeaders);
  app.use(corsMiddleware);

  // gzip/brotli. The list endpoints return large JSON arrays that compress
  // roughly 10:1 — the single cheapest latency win available on this API.
  app.use(
    compression({
      // Below ~1KB the compression overhead exceeds the transfer saving.
      threshold: 1024,
      filter: (req, res) => (req.headers["x-no-compression"] ? false : compression.filter(req, res)),
    })
  );

  app.use(globalRateLimit);
  app.use(cookieParser());

  // The raw body is needed *only* by the landing-page webhook, to verify its
  // HMAC signature. It used to be captured for every JSON request on the API,
  // which meant allocating a second full string copy of every payload for the
  // benefit of one endpoint.
  app.use(
    express.json({
      limit: env.maxJsonBodyBytes,
      verify: (req, _res, buf) => {
        if (req.url?.startsWith("/api/v1/ingest/")) {
          (req as express.Request & { rawBody?: string }).rawBody = buf.toString();
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: env.maxJsonBodyBytes }));

  // Warranty claim evidence and other locally-stored uploads.
  app.use(
    "/uploads",
    uploadSecurityHeaders,
    express.static(path.join(__dirname, "..", "uploads"), {
      // These filenames are content-addressed with a timestamp, so they are
      // effectively immutable — let the browser keep them.
      maxAge: "7d",
      etag: true,
      index: false,
      // Never serve a directory listing or fall through to the SPA.
      fallthrough: false,
      dotfiles: "deny",
    })
  );

  app.get("/", (_req, res) => {
    res.json({ success: true, message: "Luxus Green Mobility API", docs: "/api/v1/health" });
  });

  // ---------------------------------------------------------------------------
  // Health probes
  // ---------------------------------------------------------------------------
  // Liveness must NOT touch the database. If it did, a brief database blip
  // would make every instance report unhealthy at once, the platform would
  // restart all of them, and a recoverable database incident becomes a total
  // outage. Liveness answers "is this process still working?"; readiness
  // answers "should traffic be routed here right now?".
  app.get("/api/v1/health", (_req, res) => {
    res.json({
      success: true,
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });
  app.get("/api/v1/health/live", (_req, res) => res.json({ success: true, status: "ok" }));
  app.get("/api/v1/health/ready", async (_req, res) => {
    const dbUp = await checkDatabase();
    res.status(dbUp ? 200 : 503).json({
      success: dbUp,
      status: dbUp ? "ready" : "degraded",
      database: dbUp ? "up" : "down",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api/v1", routes);

  app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
  });

  // Terminal error handler. Anything that reaches here is unexpected — the
  // controllers handle their own known failures via utils/errorHandler.ts.
  app.use(
    (
      err: Error & { status?: number; type?: string },
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      // Body parser failures are the client's fault, not a server bug, and
      // logging them at error level makes real incidents harder to find.
      const isBadPayload = err.type === "entity.parse.failed" || err.type === "entity.too.large";
      const status = isBadPayload ? (err.type === "entity.too.large" ? 413 : 400) : (err.status ?? 500);

      const log = { err, requestId: req.id, path: req.originalUrl, method: req.method };
      if (status >= 500) logger.error(log, "Unhandled error");
      else logger.warn(log, "Request rejected");

      if (res.headersSent) return;
      res.status(status).json({
        success: false,
        message: isBadPayload
          ? err.type === "entity.too.large"
            ? "Request body too large"
            : "Malformed request body"
          : "Internal server error",
        ...(req.id ? { requestId: req.id } : {}),
      });
    }
  );

  return app;
}
