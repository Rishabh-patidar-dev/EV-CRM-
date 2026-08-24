// ============================================================================
// Global search (CRM staff side)
// ============================================================================
// The staff CRM's top bar search — every record type a staff member can
// reach anywhere in the app, across every dealer (unlike the DMS dealer-
// portal search, which is scoped to one dealer's own records). Most types
// have a real detail page (dealer, application, lead, warranty claim,
// campaign, and now an order goes straight to its Check Inventory page,
// which is side-effect-free and safe to open regardless of status); a few
// (invoices, vehicle inventory, purchase orders/invoices) have no per-record
// detail page yet, so those results land on their list page with a `?q=`
// deep link instead, same pattern as DMS.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError } from "../utils/errorHandler.js";

const DEALER_SELECT = { id: true, dealerCode: true, legalName: true, tradeName: true, state: true } as const;

export class SearchController {
  // GET /api/v1/search?q=
  async search(req: Request, res: Response) {
    try {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 2) return res.json({ groups: [] });

      const contains = { contains: q, mode: "insensitive" as const };
      const LIMIT = 6;

      const [
        dealers, applications, leads, invoices, stockTransfers, spareParts,
        vehicleUnits, warrantyClaims, dealerPurchaseInvoices, purchaseOrders, campaigns,
      ] = await Promise.all([
        prisma.dealer.findMany({
          where: { OR: [{ legalName: contains }, { tradeName: contains }, { dealerCode: contains }, { principalName: contains }, { phone: contains }, { email: contains }, { gstNumber: contains }] },
          select: { id: true, legalName: true, tradeName: true, dealerCode: true, state: true, status: true },
          take: LIMIT,
        }),
        prisma.dealerApplication.findMany({
          where: { OR: [{ legalName: contains }, { tradeName: contains }, { contactName: contains }, { email: contains }, { phone: contains }] },
          select: { id: true, legalName: true, tradeName: true, contactName: true, status: true },
          take: LIMIT,
        }),
        prisma.lead.findMany({
          where: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }, { companyName: contains }] },
          select: { id: true, firstName: true, lastName: true, email: true, status: true },
          take: LIMIT,
        }),
        prisma.invoice.findMany({
          where: { OR: [{ invoiceNumber: contains }, { item: contains }] },
          select: { id: true, invoiceNumber: true, item: true, type: true, dealer: { select: DEALER_SELECT } },
          take: LIMIT,
        }),
        prisma.stockTransferRequest.findMany({
          where: { OR: [{ requestNumber: contains }, { model: contains }] },
          select: { id: true, requestNumber: true, model: true, quantity: true, status: true, dealer: { select: DEALER_SELECT } },
          take: LIMIT,
        }),
        prisma.sparePartRequest.findMany({
          where: { OR: [{ requestNumber: contains }, { partName: contains }, { partCode: contains }] },
          select: { id: true, requestNumber: true, partName: true, quantity: true, status: true, dealer: { select: DEALER_SELECT } },
          take: LIMIT,
        }),
        prisma.vehicleUnit.findMany({
          where: { OR: [{ vin: contains }, { model: contains }] },
          select: { id: true, vin: true, model: true, status: true, dealer: { select: DEALER_SELECT } },
          take: LIMIT,
        }),
        prisma.warrantyClaim.findMany({
          where: { OR: [{ claimNumber: contains }, { customerName: contains }, { chassisNumber: contains }] },
          select: { id: true, claimNumber: true, customerName: true, status: true, dealer: { select: DEALER_SELECT } },
          take: LIMIT,
        }),
        prisma.dealerPurchaseInvoice.findMany({
          where: { OR: [{ invoiceNumber: contains }, { vendorName: contains }] },
          select: { id: true, invoiceNumber: true, vendorName: true, amount: true, dealer: { select: DEALER_SELECT } },
          take: LIMIT,
        }),
        prisma.vehiclePurchaseOrder.findMany({
          where: { OR: [{ poNumber: contains }, { supplierName: contains }, { model: contains }] },
          select: { id: true, poNumber: true, supplierName: true, model: true, status: true },
          take: LIMIT,
        }),
        prisma.landingPageCampaign.findMany({
          where: { OR: [{ name: contains }, { description: contains }] },
          select: { id: true, name: true, status: true },
          take: LIMIT,
        }),
      ]);

      const dealerLabel = (d: { tradeName: string | null; legalName: string } | null) => (d ? d.tradeName || d.legalName : null);

      const groups = [
        {
          type: "dealer", label: "Dealers",
          results: dealers.map((d) => ({ id: d.id, title: d.tradeName || d.legalName, subtitle: `${d.dealerCode} · ${d.state} · ${d.status.replace(/_/g, " ")}`, href: `/dealer-management/${d.id}` })),
        },
        {
          type: "application", label: "Onboarding applications",
          results: applications.map((a) => ({ id: a.id, title: a.tradeName || a.legalName, subtitle: `${a.contactName} · ${a.status.replace(/_/g, " ")}`, href: `/dealer-onboarding/${a.id}` })),
        },
        {
          type: "lead", label: "Leads",
          results: leads.map((l) => ({ id: l.id, title: [l.firstName, l.lastName].filter(Boolean).join(" "), subtitle: `${l.email} · ${(l.status ?? "OPEN").replace(/_/g, " ")}`, href: `/leads/${l.id}` })),
        },
        {
          type: "invoice", label: "Invoices",
          results: invoices.map((i) => ({ id: i.id, title: i.invoiceNumber, subtitle: `${i.item}${i.dealer ? ` · ${dealerLabel(i.dealer)}` : ""}`, href: `/order-management/invoices?q=${encodeURIComponent(i.invoiceNumber)}` })),
        },
        {
          type: "vehicle_order", label: "Vehicle stock orders",
          results: stockTransfers.map((t) => ({ id: t.id, title: t.requestNumber, subtitle: `${t.model} × ${t.quantity} · ${dealerLabel(t.dealer)} · ${t.status.replace(/_/g, " ")}`, href: `/order-management/check/VEHICLE/${t.id}` })),
        },
        {
          type: "spare_part_order", label: "Spare part orders",
          results: spareParts.map((s) => ({ id: s.id, title: s.requestNumber, subtitle: `${s.partName} × ${s.quantity} · ${dealerLabel(s.dealer)} · ${s.status.replace(/_/g, " ")}`, href: `/order-management/check/SPARE_PART/${s.id}` })),
        },
        {
          type: "vehicle_unit", label: "Vehicle inventory",
          results: vehicleUnits.map((v) => ({ id: v.id, title: v.vin, subtitle: `${v.model} · ${v.status.replace(/_/g, " ")}${v.dealer ? ` · ${dealerLabel(v.dealer)}` : ""}`, href: `/dealer-inventory?q=${encodeURIComponent(v.vin)}` })),
        },
        {
          type: "warranty_claim", label: "Warranty claims",
          results: warrantyClaims.map((c) => ({ id: c.id, title: c.claimNumber, subtitle: `${c.customerName} · ${dealerLabel(c.dealer)} · ${c.status.replace(/_/g, " ")}`, href: `/warranty/claims/${c.id}` })),
        },
        {
          type: "dealer_purchase_invoice", label: "Dealer purchase invoices",
          results: dealerPurchaseInvoices.map((p) => ({ id: p.id, title: p.invoiceNumber, subtitle: `${p.vendorName} · ₹${Number(p.amount).toLocaleString("en-IN")}${p.dealer ? ` · ${dealerLabel(p.dealer)}` : ""}`, href: `/purchase-management/dealer-invoices?q=${encodeURIComponent(p.invoiceNumber)}` })),
        },
        {
          type: "purchase_order", label: "Vehicle purchase orders",
          results: purchaseOrders.map((p) => ({ id: p.id, title: p.poNumber, subtitle: `${p.model} · ${p.supplierName} · ${p.status.replace(/_/g, " ")}`, href: `/purchase-management?q=${encodeURIComponent(p.poNumber)}` })),
        },
        {
          type: "campaign", label: "Landing page campaigns",
          results: campaigns.map((c) => ({ id: c.id, title: c.name, subtitle: c.status.replace(/_/g, " "), href: `/landing-page-campaigns/${c.id}` })),
        },
      ].filter((g) => g.results.length > 0);

      res.json({ groups, query: q });
    } catch (error) {
      handleError(error, res, "Global search");
    }
  }
}
