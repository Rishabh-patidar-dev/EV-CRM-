// ============================================================================
// SUBMODULE — Purchase & Vendor Management (manufacturer's own inbound stock)
// ----------------------------------------------------------------------------
// The OEM's own procurement: a Vendor master (Approved Vendor List, quality
// rating, blacklist), purchase orders raised against a vendor, goods receipt
// notes (GRN) that record partial/full delivery + a quality gate, and
// PO-level payment tracking. "Sold" figures are read directly from
// VehicleUnit.status = SOLD — the real sales record Vehicle Inventory
// already keeps — imported vs. sold is a genuine cross-reference.
//
// GRN -> inventory link: a PASS/PARTIAL_ACCEPT GRN creates real VehicleUnit
// rows (IN_STOCK) for the accepted quantity, which is the actual stock
// update the spec calls for (no separate invented "raw material stock"
// ledger — these purchase orders are for finished vehicles).
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";

async function generatePoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.vehiclePurchaseOrder.count();
  return `PO-${year}-${String(count + 1).padStart(6, "0")}`;
}

async function generateGrnNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.goodsReceiptNote.count();
  return `GRN-${year}-${String(count + 1).padStart(6, "0")}`;
}

// Quality rating moves by GRN outcome, clamped to the 1-5 star band the
// spec asks for ("Approved vendor list with quality rating (1-5 stars
// updated after each GRN)"). PASS nudges a vendor that had a past ding back
// up; PARTIAL_ACCEPT and REJECT step it down proportionally to severity.
const RATING_DELTA: Record<string, number> = { PASS: 1, PARTIAL_ACCEPT: -1, REJECT: -2 };
function nextRating(current: number, result: string): number {
  const delta = RATING_DELTA[result] ?? 0;
  return Math.max(1, Math.min(5, current + delta));
}

export class PurchaseManagementController {
  // ---------------------------------------------------------------------
  // Purchase orders
  // ---------------------------------------------------------------------

  // GET /api/v1/purchase-management/orders  (?status=&model=&page=&limit=)
  async list(req: Request, res: Response) {
    try {
      const { status, model, page = "1", limit = "50" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 50));

      const where: any = {};
      if (status) where.status = status;
      if (model) where.model = model;

      const [orders, total] = await Promise.all([
        prisma.vehiclePurchaseOrder.findMany({
          where,
          include: { vendor: { select: { id: true, name: true, qualityRating: true, status: true } }, goodsReceipts: true },
          orderBy: { orderedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.vehiclePurchaseOrder.count({ where }),
      ]);

      const withReceived = orders.map((o) => ({
        ...o,
        quantityReceived: o.goodsReceipts.reduce((sum, g) => sum + g.quantityReceived, 0),
      }));

      res.json({ orders: withReceived, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List purchase orders");
    }
  }

  // POST /api/v1/purchase-management/orders — body: { vendorId, model, segment, quantity, unitCost, expectedAt?, notes? }
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.vendorId || !b.model || !b.segment || !b.quantity || b.unitCost == null) {
        return handleValidationError(res, "vendorId, model, segment, quantity and unitCost are required", "body", "Create purchase order");
      }

      const vendor = await prisma.vendor.findUnique({ where: { id: parseInt(b.vendorId) } });
      if (!vendor) return handleValidationError(res, "Vendor not found", "vendorId", "Create purchase order");
      if (vendor.status === "BLACKLISTED") {
        return handleValidationError(res, `${vendor.name} is blacklisted and cannot receive new purchase orders`, "vendorId", "Create purchase order");
      }

      const poNumber = await generatePoNumber();
      const order = await prisma.vehiclePurchaseOrder.create({
        data: {
          poNumber,
          vendorId: vendor.id,
          supplierName: vendor.name,
          model: b.model,
          segment: b.segment,
          quantity: parseInt(b.quantity),
          unitCost: Number(b.unitCost),
          expectedAt: b.expectedAt ? new Date(b.expectedAt) : null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(order);
    } catch (error) {
      handleError(error, res, "Create purchase order");
    }
  }

  // PATCH /api/v1/purchase-management/orders/:id — body: { status }
  // Only for simple no-side-effect transitions (IN_TRANSIT, CANCELLED).
  // RECEIVED/PARTIALLY_RECEIVED are derived from GRNs — see receiveGoods().
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Order ID is required", "id", "Update purchase order");
      const status = req.body?.status;
      if (!status || !["IN_TRANSIT", "CANCELLED"].includes(status)) {
        return handleValidationError(res, "status must be IN_TRANSIT or CANCELLED (use /receive to record delivery)", "status", "Update purchase order");
      }

      const order = await prisma.vehiclePurchaseOrder.update({ where: { id }, data: { status } });
      res.json(order);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Purchase order", "Update purchase order");
      handleError(error, res, "Update purchase order");
    }
  }

  // POST /api/v1/purchase-management/orders/:id/receive
  // body: { quantityReceived, qualityResult: PASS|PARTIAL_ACCEPT|REJECT, rejectionReason?, notes? }
  // Records a GRN (partial deliveries supported — multiple GRNs per PO),
  // derives PO.status from cumulative received qty vs PO.quantity, creates
  // VehicleUnit rows for the accepted quantity, and updates the vendor's
  // quality rating.
  async receiveGoods(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const b = req.body ?? {};
      const quantityReceived = parseInt(b.quantityReceived);
      const qualityResult = b.qualityResult ?? "PASS";
      if (!id || !quantityReceived || quantityReceived < 1) {
        return handleValidationError(res, "quantityReceived (>=1) is required", "quantityReceived", "Receive goods");
      }
      if (!["PASS", "PARTIAL_ACCEPT", "REJECT"].includes(qualityResult)) {
        return handleValidationError(res, "qualityResult must be PASS, PARTIAL_ACCEPT or REJECT", "qualityResult", "Receive goods");
      }

      const order = await prisma.vehiclePurchaseOrder.findUnique({
        where: { id },
        include: { vendor: true, goodsReceipts: true },
      });
      if (!order) return handleNotFoundError(res, "Purchase order", "Receive goods");
      if (order.status === "CANCELLED") {
        return handleValidationError(res, "Cannot receive against a cancelled purchase order", "status", "Receive goods");
      }

      const alreadyReceived = order.goodsReceipts.reduce((sum, g) => sum + g.quantityReceived, 0);
      const grnNumber = await generateGrnNumber();

      const result = await prisma.$transaction(async (tx) => {
        const grn = await tx.goodsReceiptNote.create({
          data: {
            grnNumber,
            purchaseOrderId: order.id,
            quantityReceived,
            qualityResult,
            rejectionReason: qualityResult === "REJECT" ? (b.rejectionReason ?? null) : null,
            notes: b.notes ?? null,
          },
        });

        // Accepted units (PASS/PARTIAL_ACCEPT) land in OEM stock as real
        // VehicleUnit rows — this GRN is the only place new stock enters.
        if (qualityResult !== "REJECT") {
          await tx.vehicleUnit.createMany({
            data: Array.from({ length: quantityReceived }, (_, i) => ({
              vin: `${grnNumber}-${i + 1}`,
              model: order.model,
              segment: order.segment,
              status: "IN_STOCK" as const,
              manufacturedAt: new Date(),
            })),
          });
        }

        const totalReceived = alreadyReceived + quantityReceived;
        const newStatus = totalReceived >= order.quantity ? "RECEIVED" : "PARTIALLY_RECEIVED";
        const updatedOrder = await tx.vehiclePurchaseOrder.update({
          where: { id: order.id },
          data: { status: newStatus, receivedAt: newStatus === "RECEIVED" ? new Date() : order.receivedAt },
        });

        let updatedVendor = order.vendor;
        if (order.vendorId) {
          updatedVendor = await tx.vendor.update({
            where: { id: order.vendorId },
            data: { qualityRating: nextRating(order.vendor?.qualityRating ?? 5, qualityResult) },
          });
        }

        return { grn, order: updatedOrder, vendor: updatedVendor };
      });

      res.status(201).json(result);
    } catch (error) {
      handleError(error, res, "Receive goods");
    }
  }

  // POST /api/v1/purchase-management/orders/:id/payment — body: { amount }
  async recordPayment(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const amount = Number(req.body?.amount);
      if (!id || !amount || amount <= 0) {
        return handleValidationError(res, "amount (>0) is required", "amount", "Record payment");
      }

      const order = await prisma.vehiclePurchaseOrder.findUnique({ where: { id } });
      if (!order) return handleNotFoundError(res, "Purchase order", "Record payment");

      const total = order.quantity * Number(order.unitCost);
      const amountPaid = Math.min(total, Number(order.amountPaid) + amount);
      const paymentStatus = amountPaid <= 0 ? "UNPAID" : amountPaid >= total ? "PAID" : "PARTIAL";

      const updated = await prisma.vehiclePurchaseOrder.update({
        where: { id },
        data: { amountPaid, paymentStatus },
      });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Record payment");
    }
  }

  // ---------------------------------------------------------------------
  // Vendors (Approved Vendor List)
  // ---------------------------------------------------------------------

  // GET /api/v1/purchase-management/vendors  (?status=&category=)
  async listVendors(req: Request, res: Response) {
    try {
      const { status, category } = req.query;
      const where: any = {};
      if (status) where.status = status;
      if (category) where.category = category;

      const vendors = await prisma.vendor.findMany({
        where,
        include: { _count: { select: { purchaseOrders: true } } },
        orderBy: { name: "asc" },
      });
      res.json({ vendors });
    } catch (error) {
      handleError(error, res, "List vendors");
    }
  }

  // POST /api/v1/purchase-management/vendors
  async createVendor(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.name) return handleValidationError(res, "name is required", "name", "Create vendor");

      const vendor = await prisma.vendor.create({
        data: {
          name: b.name,
          gstNumber: b.gstNumber || null,
          panNumber: b.panNumber || null,
          isMsme: Boolean(b.isMsme),
          contactName: b.contactName || null,
          phone: b.phone || null,
          email: b.email || null,
          address: b.address || null,
          category: b.category || "MISC",
        },
      });
      res.status(201).json(vendor);
    } catch (error) {
      handleError(error, res, "Create vendor");
    }
  }

  // PATCH /api/v1/purchase-management/vendors/:id
  // body: { status: ACTIVE|BLACKLISTED, blacklistReason? } — blocked vendors
  // can't receive new POs (enforced in create()); existing open POs are
  // untouched.
  async updateVendor(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const b = req.body ?? {};
      if (!id) return handleValidationError(res, "Vendor ID is required", "id", "Update vendor");
      if (b.status && !["ACTIVE", "BLACKLISTED"].includes(b.status)) {
        return handleValidationError(res, "status must be ACTIVE or BLACKLISTED", "status", "Update vendor");
      }
      if (b.status === "BLACKLISTED" && !b.blacklistReason) {
        return handleValidationError(res, "blacklistReason is required to blacklist a vendor", "blacklistReason", "Update vendor");
      }

      const vendor = await prisma.vendor.update({
        where: { id },
        data: {
          ...(b.status ? { status: b.status } : {}),
          blacklistReason: b.status === "BLACKLISTED" ? b.blacklistReason : b.status === "ACTIVE" ? null : undefined,
        },
      });
      res.json(vendor);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Vendor", "Update vendor");
      handleError(error, res, "Update vendor");
    }
  }

  // ---------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------

  // GET /api/v1/purchase-management/analytics — imported vs. sold, by model,
  // purchase-order status mix, spend, and vendor/payment health.
  async analytics(_req: Request, res: Response) {
    try {
      const [orders, soldUnits, vendors] = await Promise.all([
        prisma.vehiclePurchaseOrder.findMany({
          select: { model: true, quantity: true, unitCost: true, status: true, amountPaid: true, paymentStatus: true },
        }),
        prisma.vehicleUnit.findMany({
          where: { status: "SOLD" },
          select: { model: true },
        }),
        prisma.vendor.findMany({ select: { status: true, qualityRating: true } }),
      ]);

      const importedByModel: Record<string, number> = {};
      const soldByModel: Record<string, number> = {};
      const poStatusBreakdown: Record<string, number> = {};
      let totalOrderedQty = 0;
      let totalReceivedQty = 0;
      let totalSpend = 0;
      let totalPayable = 0;
      let totalPaid = 0;

      for (const o of orders) {
        poStatusBreakdown[o.status] = (poStatusBreakdown[o.status] ?? 0) + 1;
        if (o.status !== "CANCELLED") totalOrderedQty += o.quantity;
        if (o.status === "RECEIVED" || o.status === "PARTIALLY_RECEIVED") {
          totalReceivedQty += o.quantity;
          totalSpend += o.quantity * Number(o.unitCost);
          importedByModel[o.model] = (importedByModel[o.model] ?? 0) + o.quantity;
        }
        if (o.status !== "CANCELLED") {
          totalPayable += o.quantity * Number(o.unitCost);
          totalPaid += Number(o.amountPaid);
        }
      }
      for (const u of soldUnits) {
        soldByModel[u.model] = (soldByModel[u.model] ?? 0) + 1;
      }

      const toSeries = (rec: Record<string, number>) =>
        Object.entries(rec).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

      res.json({
        totalOrderedQty,
        totalReceivedQty,
        totalSold: soldUnits.length,
        netStockMovement: totalReceivedQty - soldUnits.length,
        totalSpend,
        outstandingPayable: Math.max(0, totalPayable - totalPaid),
        activeVendors: vendors.filter((v) => v.status === "ACTIVE").length,
        blacklistedVendors: vendors.filter((v) => v.status === "BLACKLISTED").length,
        avgVendorRating: vendors.length ? Math.round((vendors.reduce((s, v) => s + v.qualityRating, 0) / vendors.length) * 10) / 10 : null,
        importedByModel: toSeries(importedByModel),
        soldByModel: toSeries(soldByModel),
        poStatusBreakdown: toSeries(poStatusBreakdown),
      });
    } catch (error) {
      handleError(error, res, "Purchase management analytics");
    }
  }
}
