import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

// `credentials: true` + specific origins (not "*") so the browser will both
// send and accept session cookies on cross-port XHR — the CRM web app
// (:3000, crm_session) and the landing page's dealer portal (:3001,
// dealer_session) both call this API cross-origin even though everything's
// on localhost.
const ALLOWED_ORIGINS = [
  process.env.WEB_ORIGIN || "http://localhost:3000",
  process.env.LANDING_ORIGIN || "http://localhost:3001",
].filter(Boolean);
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(cookieParser());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString();
    },
  })
);

// Warranty claim evidence — see routes/warranty.routes.ts for the multer
// config that writes here.
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/", (_req, res) => {
  res.json({ success: true, message: "VoltOs API", docs: "/api/v1/health" });
});
app.get("/api/v1/health", (_req, res) => {
  res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/v1", routes);

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`VoltOs API listening on http://localhost:${PORT}`);
});
