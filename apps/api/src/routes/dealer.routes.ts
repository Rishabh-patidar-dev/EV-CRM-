// ============================================================================
// Dealer Management — routes  (protected: ADMIN / SYSTEM_ADMIN)
// Mounted in routes/index.ts.
// ============================================================================
import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { DealerController } from "../controllers/dealer.controller.js";
import { DealerLeadRoutingController } from "../controllers/dealerLeadRouting.controller.js";
import { FinanceController, AfterSalesController, SparePartInventoryController, SparePartReturnController } from "../controllers/dealerAfterSales.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
// Department roles, additive to ADMINS — see docs/ARCHITECTURE_AND_FLOWS.md §4.
const FINANCE_STAFF = [...ADMINS, UserRole.FINANCE];
const WAREHOUSE_STAFF = [...ADMINS, UserRole.WAREHOUSE];

const dealer = new DealerController();
const routing = new DealerLeadRoutingController();
const finance = new FinanceController();
const afterSales = new AfterSalesController();
const sparePartInventory = new SparePartInventoryController();
const sparePartReturns = new SparePartReturnController();

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
financeRouter.get("/", requireRole(FINANCE_STAFF), finance.list.bind(finance));
financeRouter.post("/", requireRole(FINANCE_STAFF), finance.create.bind(finance));
financeRouter.get("/new-count", requireRole(FINANCE_STAFF), finance.newCount.bind(finance));
financeRouter.get("/:id/attachments", requireRole(FINANCE_STAFF), finance.listAttachments.bind(finance));
financeRouter.patch("/:id", requireRole(FINANCE_STAFF), finance.update.bind(finance));

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

// ---- /api/v1/spare-part-inventory ---- manufacturer stock-on-hand catalog,
// read by Order Management's Check Inventory comparison for spare parts.
const sparePartInventoryRouter = Router();
sparePartInventoryRouter.use(requireAuth);
sparePartInventoryRouter.get("/", requireRole(WAREHOUSE_STAFF), sparePartInventory.list.bind(sparePartInventory));
sparePartInventoryRouter.post("/", requireRole(WAREHOUSE_STAFF), sparePartInventory.create.bind(sparePartInventory));
sparePartInventoryRouter.patch("/:id", requireRole(WAREHOUSE_STAFF), sparePartInventory.update.bind(sparePartInventory));

// ---- /api/v1/spare-part-returns ---- quality-return queue, Warehouse's
// call to make same as the rest of spare-part inventory truth.
const sparePartReturnsRouter = Router();
sparePartReturnsRouter.use(requireAuth);
sparePartReturnsRouter.get("/", requireRole(WAREHOUSE_STAFF), sparePartReturns.list.bind(sparePartReturns));
sparePartReturnsRouter.get("/new-count", requireRole(WAREHOUSE_STAFF), sparePartReturns.newCount.bind(sparePartReturns));
sparePartReturnsRouter.get("/:id/attachments", requireRole(WAREHOUSE_STAFF), sparePartReturns.listAttachments.bind(sparePartReturns));
sparePartReturnsRouter.post("/:id/status", requireRole(WAREHOUSE_STAFF), sparePartReturns.setStatus.bind(sparePartReturns));

export default {
  dealers,
  routing: routingRouter,
  finance: financeRouter,
  service: serviceRouter,
  spares: sparesRouter,
  sparePartInventory: sparePartInventoryRouter,
  sparePartReturns: sparePartReturnsRouter,
};
