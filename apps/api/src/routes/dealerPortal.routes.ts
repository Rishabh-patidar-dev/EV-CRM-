import { Router } from "express";
import { requireDealerPortalAuth } from "../middleware/dealerPortalAuth.middleware.js";
import { DealerPortalController } from "../controllers/dealerPortal.controller.js";

const portal = new DealerPortalController();
const router = Router();
router.use(requireDealerPortalAuth);

router.get("/overview", portal.overview.bind(portal));
router.get("/vehicle-catalog", portal.vehicleCatalog.bind(portal));

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

// HRMS
router.get("/hr/employees", portal.listEmployees.bind(portal));
router.post("/hr/employees", portal.createEmployee.bind(portal));
router.patch("/hr/employees/:id", portal.updateEmployee.bind(portal));

router.get("/hr/attendance", portal.listAttendance.bind(portal));
router.post("/hr/attendance", portal.markAttendance.bind(portal));

router.post("/hr/leave-requests", portal.createLeaveRequest.bind(portal));
router.patch("/hr/leave-requests/:id", portal.decideLeaveRequest.bind(portal));

router.get("/hr/payroll", portal.listPayroll.bind(portal));
router.post("/hr/payroll/generate", portal.generatePayroll.bind(portal));
router.patch("/hr/payroll/:id", portal.markPayslipPaid.bind(portal));

// Sales & Booking
router.get("/bookings", portal.listBookings.bind(portal));
router.get("/bookings/available-units", portal.listAvailableUnitsForBooking.bind(portal));
router.post("/bookings", portal.createBooking.bind(portal));
router.patch("/bookings/:id", portal.updateBooking.bind(portal));

export default router;
