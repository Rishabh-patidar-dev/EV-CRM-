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

router.get("/invoices", portal.listInvoices.bind(portal));

// Dealer's response to an out-of-stock partial-fulfillment offer.
router.post("/stock-transfers/:id/notice-response", portal.respondToStockTransferNotice.bind(portal));
router.post("/spare-parts/:id/notice-response", portal.respondToSparePartNotice.bind(portal));

router.get("/service-tickets", portal.listServiceTickets.bind(portal));
router.post("/service-tickets", portal.createServiceTicket.bind(portal));

router.get("/warranty-claims", portal.listWarrantyClaims.bind(portal));
router.post("/warranty-claims", portal.createWarrantyClaim.bind(portal));
router.get("/warranty-coverage/:identifier", portal.checkWarrantyCoverage.bind(portal));

router.get("/leads", portal.listLeads.bind(portal));
router.post("/leads", portal.createLead.bind(portal));
router.get("/leads/:id", portal.getLead.bind(portal));
router.patch("/leads/:id", portal.updateLeadAssignment.bind(portal));
router.post("/leads/:id/remarks", portal.addLeadRemark.bind(portal));

router.get("/segments", portal.listSegments.bind(portal));
router.post("/segments", portal.createSegment.bind(portal));
router.delete("/segments/:id", portal.deleteSegment.bind(portal));

router.get("/campaigns", portal.listCampaigns.bind(portal));
router.post("/campaigns", portal.createCampaign.bind(portal));
router.patch("/campaigns/:id", portal.updateCampaign.bind(portal));

export default router;
