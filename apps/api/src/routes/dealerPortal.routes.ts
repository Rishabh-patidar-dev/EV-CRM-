import { Router } from "express";
import { requireDealerPortalAuth } from "../middleware/dealerPortalAuth.middleware.js";
import { DealerPortalController } from "../controllers/dealerPortal.controller.js";

const portal = new DealerPortalController();
const router = Router();
router.use(requireDealerPortalAuth);

router.get("/overview", portal.overview.bind(portal));

router.get("/vehicle-units", portal.listVehicleUnits.bind(portal));

router.get("/stock-transfers", portal.listStockTransfers.bind(portal));
router.post("/stock-transfers", portal.createStockTransfer.bind(portal));

router.get("/spare-parts", portal.listSpareParts.bind(portal));
router.post("/spare-parts", portal.createSparePart.bind(portal));

router.get("/service-tickets", portal.listServiceTickets.bind(portal));
router.post("/service-tickets", portal.createServiceTicket.bind(portal));

router.get("/warranty-claims", portal.listWarrantyClaims.bind(portal));
router.post("/warranty-claims", portal.createWarrantyClaim.bind(portal));
router.get("/warranty-coverage/:identifier", portal.checkWarrantyCoverage.bind(portal));

export default router;
