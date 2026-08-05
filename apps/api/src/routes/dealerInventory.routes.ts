import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { VehicleUnitController, StockTransferController } from "../controllers/dealerInventory.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const unit = new VehicleUnitController();
const transfer = new StockTransferController();

// ---- /api/v1/vehicle-units ----
const vehicleUnits = Router();
vehicleUnits.use(requireAuth);
vehicleUnits.get("/", requireRole(ADMINS), unit.list.bind(unit));
vehicleUnits.post("/", requireRole(ADMINS), unit.create.bind(unit));
vehicleUnits.get("/analytics", requireRole(ADMINS), unit.analytics.bind(unit));
vehicleUnits.get("/:id", requireRole(ADMINS), unit.getById.bind(unit));
vehicleUnits.patch("/:id", requireRole(ADMINS), unit.update.bind(unit));

// ---- /api/v1/stock-transfers ----
const stockTransfers = Router();
stockTransfers.use(requireAuth);
stockTransfers.get("/", requireRole(ADMINS), transfer.list.bind(transfer));
stockTransfers.post("/", requireRole(ADMINS), transfer.create.bind(transfer));
stockTransfers.patch("/:id", requireRole(ADMINS), transfer.update.bind(transfer));

export default { vehicleUnits, stockTransfers };
