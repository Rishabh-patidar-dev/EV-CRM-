import { Router } from "express";
import authRoutes from "./auth.routes.js";
import ingestRoutes from "./ingest.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import dealerRoutes from "./dealer.routes.js";
import dealerInventoryRoutes from "./dealerInventory.routes.js";
import dealerComplianceRoutes from "./dealerCompliance.routes.js";
import orderManagementRoutes from "./orderManagement.routes.js";
import purchaseManagementRoutes from "./purchaseManagement.routes.js";
import campaignManagementRoutes from "./campaignManagement.routes.js";
import warrantyRoutes from "./warranty.routes.js";
import leadsRoutes from "./leads.routes.js";
import landingPageCampaignRoutes from "./landingPageCampaign.routes.js";
import usersRoutes from "./users.routes.js";

const router = Router();

// CRM staff login (session cookie)
router.use("/auth", authRoutes);

// Public dual-intent ingestion webhook (landing page portal)
router.use("/ingest", ingestRoutes);

// Lead module + landing page campaigns (ported from innocrm-staging)
router.use("/leads", leadsRoutes);
router.use("/landing-page-campaigns", landingPageCampaignRoutes);
router.use("/users", usersRoutes);

// Protected onboarding pipeline (Network Expansion / Admin)
router.use("/onboarding", onboardingRoutes);

// Protected dealer management (Module 2)
router.use("/dealers", dealerRoutes.dealers);
router.use("/dealer-routing", dealerRoutes.routing);
router.use("/finance-cases", dealerRoutes.finance);
router.use("/service-tickets", dealerRoutes.service);
router.use("/spare-parts", dealerRoutes.spares);

// New submodules
router.use("/vehicle-units", dealerInventoryRoutes.vehicleUnits);
router.use("/stock-transfers", dealerInventoryRoutes.stockTransfers);
router.use("/dealer-compliance", dealerComplianceRoutes);
router.use("/order-management", orderManagementRoutes);
router.use("/purchase-management", purchaseManagementRoutes);
router.use("/campaign-management", campaignManagementRoutes);

// Warranty Management (centrepiece module — see warranty.controller.ts)
router.use("/warranty-plans", warrantyRoutes.plans);
router.use("/component-units", warrantyRoutes.componentUnits);
router.use("/warranty-claims", warrantyRoutes.claims);
router.use("/supplier-recoveries", warrantyRoutes.recoveries);

export default router;
