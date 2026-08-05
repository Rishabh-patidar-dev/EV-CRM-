// Ported/simplified from innocrm-staging's leads.routes.ts. ADMIN/SYSTEM_ADMIN
// manage the pipeline; SALES can read (their own leads), add remarks, and
// claim unassigned leads from the shared queue.
import { Router } from "express";
import multer from "multer";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { LeadController } from "../controllers/leads.controller.js";
import { LeadsImportController } from "../controllers/leadsImport.controller.js";

const MANAGERS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const lead = new LeadController();
const leadsImport = new LeadsImportController();
const upload = multer();

const router = Router();
router.use(requireAuth);

router.get("/stats", requireRole(MANAGERS), lead.stats.bind(lead));
router.get("/import/template-csv", leadsImport.downloadTemplate.bind(leadsImport));
router.post("/import", requireRole(MANAGERS), upload.single("file"), leadsImport.importLeads.bind(leadsImport));

router.get("/", lead.list.bind(lead));
router.post("/", requireRole(MANAGERS), lead.create.bind(lead));
router.post("/assign-bulk", requireRole(MANAGERS), lead.assignBulk.bind(lead));
router.get("/:id", lead.getById.bind(lead));
router.patch("/:id", requireRole(MANAGERS), lead.update.bind(lead));
router.delete("/:id", requireRole(MANAGERS), lead.remove.bind(lead));
router.put("/:id/assign", requireRole(MANAGERS), lead.assign.bind(lead));
router.put("/:id/claim", lead.claim.bind(lead));
router.post("/:id/convert-to-dealer", requireRole(MANAGERS), lead.convertToDealer.bind(lead));
router.post("/:id/remarks", lead.addRemark.bind(lead));

export default router;
