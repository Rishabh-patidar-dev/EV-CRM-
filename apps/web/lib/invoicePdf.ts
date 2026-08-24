// ============================================================================
// Invoice PDF generation
// ============================================================================
// Renders one Invoice row as a real, downloadable tax-invoice-style PDF —
// company letterhead, Bill To block (dealer name/phone/email/GSTIN), an item
// line with unit price and amount, and GST + grand total for anything that
// actually carries a price (order confirmation/dispatch/delivery/partial).
// Client-side only (jsPDF) — no server round-trip, works the same in the
// staff CRM and the dealer portal (DMS ships its own near-identical copy,
// since the two are separate deployments with no shared package).
// ============================================================================
import { jsPDF } from "jspdf";

export interface InvoiceDealer {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName: string | null;
  state: string;
  phone?: string | null;
  email?: string | null;
  gstNumber?: string | null;
  panNumber?: string | null;
  addressLine?: string | null;
  city?: string | null;
  district?: string | null;
  pincode?: string | null;
}

export type InvoiceType = "CONFIRMATION" | "OUT_OF_STOCK" | "PARTIAL" | "CANCELLATION" | "CUSTOM" | "DISPATCH" | "DELIVERY";

export interface InvoiceDoc {
  invoiceNumber: string;
  orderKind: "VEHICLE" | "SPARE_PART" | null;
  dealer: InvoiceDealer | null;
  type: InvoiceType;
  item: string;
  requestedQuantity: number | null;
  fulfilledQuantity: number | null;
  unitPrice?: number | string | null;
  totalAmount?: number | string | null;
  expectedRestockDate: string | null;
  message: string | null;
  issuedAt: string;
}

const TYPE_LABEL: Record<InvoiceType, string> = {
  CONFIRMATION: "Order Confirmation",
  DISPATCH: "Dispatch Note",
  DELIVERY: "Delivery Receipt",
  PARTIAL: "Partial Fulfillment Notice",
  OUT_OF_STOCK: "Out-of-Stock Notice",
  CANCELLATION: "Order Cancellation",
  CUSTOM: "General Notice",
};

// GST only applies to a document that actually invoices money for goods.
const PRICED_TYPES = new Set<InvoiceType>(["CONFIRMATION", "DISPATCH", "DELIVERY", "PARTIAL"]);
const GST_RATE = 0.18;

const INR = (n: number) =>
  `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function dealerAddress(d: InvoiceDealer): string {
  return [d.addressLine, d.city, d.district, d.state, d.pincode].filter(Boolean).join(", ");
}

export function buildInvoicePdf(inv: InvoiceDoc): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const marginX = 18;
  let y = 20;

  // ---- Letterhead ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 76, 74);
  doc.text("LUXUS GREEN MOBILITY", marginX, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text("Electric Vehicles | Manufacturer & OEM", marginX, y + 5.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(TYPE_LABEL[inv.type].toUpperCase(), pageWidth - marginX, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(inv.invoiceNumber, pageWidth - marginX, y + 5.5, { align: "right" });

  y += 12;
  doc.setDrawColor(210, 210, 210);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 9;

  // ---- Meta + Bill To ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text("INVOICE DETAILS", marginX, y);
  doc.text("BILL TO", pageWidth / 2 + 5, y);
  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);

  const metaLines = [
    `Invoice No: ${inv.invoiceNumber}`,
    `Date Issued: ${new Date(inv.issuedAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`,
    `Order Type: ${inv.orderKind === "VEHICLE" ? "Vehicle Stock" : inv.orderKind === "SPARE_PART" ? "Spare Part" : "General"}`,
  ];
  let metaY = y;
  for (const line of metaLines) { doc.text(line, marginX, metaY); metaY += 5.5; }

  const d = inv.dealer;
  let billY = y;
  const billX = pageWidth / 2 + 5;
  if (d) {
    doc.setFont("helvetica", "bold");
    doc.text(d.tradeName || d.legalName, billX, billY);
    billY += 5.5;
    doc.setFont("helvetica", "normal");
    const billLines = [
      `Dealer Code: ${d.dealerCode}`,
      dealerAddress(d) || null,
      d.phone ? `Phone: ${d.phone}` : null,
      d.email ? `Email: ${d.email}` : null,
      d.gstNumber ? `GSTIN: ${d.gstNumber}` : null,
    ].filter((l): l is string => !!l);
    for (const line of billLines) { doc.text(line, billX, billY, { maxWidth: pageWidth - marginX - billX }); billY += 5.5; }
  } else {
    doc.text("—", billX, billY);
    billY += 5.5;
  }

  y = Math.max(metaY, billY) + 6;
  doc.setDrawColor(210, 210, 210);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 10;

  // ---- Item table ----
  const priced = PRICED_TYPES.has(inv.type);
  const qty = inv.fulfilledQuantity ?? inv.requestedQuantity ?? 0;
  const unitPrice = Number(inv.unitPrice ?? 0);
  const lineTotal = priced ? unitPrice * qty : 0;

  const col = { item: marginX, qty: 108, price: 138, amount: pageWidth - marginX };
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text("ITEM", col.item, y);
  doc.text("QTY", col.qty, y);
  doc.text("UNIT PRICE", col.price, y, { align: "right" });
  doc.text("AMOUNT", col.amount, y, { align: "right" });
  y += 3;
  doc.setDrawColor(180, 180, 180);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(inv.item, col.item, y, { maxWidth: col.qty - col.item - 4 });
  doc.text(String(qty), col.qty, y);
  doc.text(priced ? INR(unitPrice) : "—", col.price, y, { align: "right" });
  doc.text(priced ? INR(lineTotal) : "—", col.amount, y, { align: "right" });
  y += 9;

  if (inv.requestedQuantity != null && inv.fulfilledQuantity != null && inv.requestedQuantity !== inv.fulfilledQuantity) {
    doc.setFontSize(8.5);
    doc.setTextColor(140, 140, 140);
    doc.text(`(${inv.fulfilledQuantity} fulfilled of ${inv.requestedQuantity} requested)`, col.item, y);
    y += 7;
  }

  doc.setDrawColor(210, 210, 210);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 10;

  // ---- Totals (only for priced documents) ----
  if (priced) {
    const cgst = lineTotal * (GST_RATE / 2);
    const sgst = lineTotal * (GST_RATE / 2);
    const grandTotal = lineTotal + cgst + sgst;

    const totalsX = pageWidth - marginX;
    const labelX = 130;
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90, 90, 90);
    doc.text("Subtotal", labelX, y); doc.text(INR(lineTotal), totalsX, y, { align: "right" }); y += 6;
    doc.text("CGST (9%)", labelX, y); doc.text(INR(cgst), totalsX, y, { align: "right" }); y += 6;
    doc.text("SGST (9%)", labelX, y); doc.text(INR(sgst), totalsX, y, { align: "right" }); y += 7;

    doc.setDrawColor(15, 76, 74);
    doc.line(labelX, y - 4, totalsX, y - 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(15, 76, 74);
    doc.text("Total Due", labelX, y + 1);
    doc.text(INR(grandTotal), totalsX, y + 1, { align: "right" });
    y += 14;
  }

  // ---- Expected date / message ----
  if (inv.expectedRestockDate) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 30);
    doc.text(
      `Expected date: ${new Date(inv.expectedRestockDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`,
      marginX, y
    );
    y += 8;
  }

  if (inv.message) {
    doc.setFillColor(244, 243, 238);
    const msgLines = doc.splitTextToSize(inv.message, pageWidth - marginX * 2 - 8);
    const boxHeight = msgLines.length * 5 + 8;
    doc.rect(marginX, y, pageWidth - marginX * 2, boxHeight, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(60, 60, 60);
    doc.text(msgLines, marginX + 4, y + 6);
    y += boxHeight + 8;
  }

  // ---- Footer ----
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text("Issued by Order Management — Luxus Green Mobility. This is a system-generated document.", marginX, 285);

  return doc;
}

export function downloadInvoicePdf(inv: InvoiceDoc) {
  const doc = buildInvoicePdf(inv);
  doc.save(`${inv.invoiceNumber}.pdf`);
}
