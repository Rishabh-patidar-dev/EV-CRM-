// Place in: apps/api/src/routes/ingest.routes.ts
// Mount PUBLIC (no auth) in routes/index.ts:  app.use("/api/v1/ingest", ingestRoutes);
import { Router } from "express";
import { IngestController } from "../controllers/ingest.controller.js";

const router = Router();
const ingest = new IngestController();

// POST /api/v1/ingest/landing-page  — dual-intent ingestion webhook
router.post("/landing-page", ingest.ingestLandingPage.bind(ingest));

// GET  /api/v1/ingest/landing-page/test
router.get("/landing-page/test", ingest.test.bind(ingest));

export default router;
