// ============================================================================
// Dealer Management — routes  (protected: ADMIN / SYSTEM_ADMIN)
// Mounted in routes/index.ts.
// ============================================================================
import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { DealerController } from "../controllers/dealer.controller.js";
import { DealerLeadRoutingController } from "../controllers/dealerLeadRouting.controller.js";
import { FinanceController, AfterSalesController } from "../controllers/dealerAfterSales.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];

const dealer = new DealerController();
const routing = new DealerLeadRoutingController();
const finance = new FinanceController();
const afterSales = new AfterSalesController();

// ---- /api/v1/dealers ----
const dealers = Router();
dealers.use(requireAuth);
dealers.get("/stats", requireRole(ADMINS), dealer.stats.bind(dealer));
dealers.get("/", requireRole(ADMINS), dealer.list.bind(dealer));
dealers.post("/", requireRole(ADMINS), dealer.create.bind(dealer));
dealers.post("/from-application/:applicationId", requireRole(ADMINS), dealer.createFromApplication.bind(dealer));
dealers.get("/:id", requireRole(ADMINS), dealer.getById.bind(dealer));
dealers.patch("/:id", requireRole(ADMINS), dealer.update.bind(dealer));
dealers.put("/:id/territories", requireRole(ADMINS), dealer.setTerritories.bind(dealer));
dealers.put("/:id/targets", requireRole(ADMINS), dealer.setTarget.bind(dealer));
dealers.put("/:id/performance", requireRole(ADMINS), dealer.setPerformance.bind(dealer));

// ---- /api/v1/dealer-routing ----
const routingRouter = Router();
routingRouter.use(requireAuth);
routingRouter.get("/", requireRole(ADMINS), routing.list.bind(routing));
routingRouter.post("/route/:leadId", requireRole(ADMINS), routing.route.bind(routing));
routingRouter.patch("/:id", requireRole(ADMINS), routing.update.bind(routing));

// ---- /api/v1/finance-cases ----
const financeRouter = Router();
financeRouter.use(requireAuth);
financeRouter.get("/", requireRole(ADMINS), finance.list.bind(finance));
financeRouter.post("/", requireRole(ADMINS), finance.create.bind(finance));
financeRouter.patch("/:id", requireRole(ADMINS), finance.update.bind(finance));

// ---- /api/v1/service-tickets ----
const serviceRouter = Router();
serviceRouter.use(requireAuth);
serviceRouter.get("/", requireRole(ADMINS), afterSales.listTickets.bind(afterSales));
serviceRouter.post("/", requireRole(ADMINS), afterSales.createTicket.bind(afterSales));
serviceRouter.patch("/:id", requireRole(ADMINS), afterSales.updateTicket.bind(afterSales));

// ---- /api/v1/spare-parts ----
const sparesRouter = Router();
sparesRouter.use(requireAuth);
sparesRouter.get("/", requireRole(ADMINS), afterSales.listSpareParts.bind(afterSales));
sparesRouter.post("/", requireRole(ADMINS), afterSales.createSparePart.bind(afterSales));
sparesRouter.patch("/:id", requireRole(ADMINS), afterSales.updateSparePart.bind(afterSales));

export default {
  dealers,
  routing: routingRouter,
  finance: financeRouter,
  service: serviceRouter,
  spares: sparesRouter,
};
