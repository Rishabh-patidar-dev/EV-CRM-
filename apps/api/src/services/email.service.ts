// Single email entry point, mirroring fileStorage.service.ts's dual-mode
// design: if RESEND_API_KEY is configured, actually sends via Resend's free
// tier; if not, logs to console and no-ops. Never throws — a missing key or
// a failed send must never block the action that triggered it (a document
// or application rejection must still succeed even if the email doesn't
// go out), so every caller can fire-and-forget this.
//
// Known Resend free-tier limitation worth knowing about: without a verified
// sending domain, Resend only delivers to the email address the account
// itself was signed up with, regardless of the `to` address passed here —
// not something fixable in code.
import { Resend } from "resend";
import { prisma } from "@repo/db";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: SendMailInput): Promise<void> {
  if (!resend) {
    console.log(`✉️  [email skipped — no RESEND_API_KEY] to=${to} subject="${subject}"`);
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) console.error("✉️  Resend send failed:", error);
  } catch (error) {
    console.error("✉️  Resend send threw:", error);
  }
}

function wrapEmail(heading: string, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin-bottom: 16px;">${heading}</h2>
      ${bodyHtml}
      <p style="margin-top: 24px; font-size: 12px; color: #888;">EV Dealer Network — Onboarding</p>
    </div>
  `;
}

export function sendDocumentRejectedEmail(to: string, dealerName: string, docLabel: string, reason: string) {
  return sendMail({
    to,
    subject: `Action needed: "${docLabel}" was not accepted`,
    html: wrapEmail(
      "A document needs to be re-uploaded",
      `<p>Hi ${dealerName},</p>
       <p>Your uploaded document <strong>${docLabel}</strong> was reviewed and could not be accepted:</p>
       <blockquote style="border-left: 3px solid #ddd; margin: 12px 0; padding: 4px 12px; color: #444;">${reason}</blockquote>
       <p>Please sign in to your dashboard and upload a corrected version.</p>`
    ),
  });
}

export function sendApplicationStatusEmail(to: string, dealerName: string, status: "ON_HOLD" | "REJECTED", reason: string) {
  const heading = status === "REJECTED" ? "Update on your dealership application" : "Your application is on hold";
  return sendMail({
    to,
    subject: heading,
    html: wrapEmail(
      heading,
      `<p>Hi ${dealerName},</p>
       <p>${status === "REJECTED" ? "Your dealership application status has changed to Rejected." : "Your dealership application has been placed on hold."}</p>
       <blockquote style="border-left: 3px solid #ddd; margin: 12px 0; padding: 4px 12px; color: #444;">${reason}</blockquote>
       <p>If you have questions, please reach out to our Network Expansion team.</p>`
    ),
  });
}

// ---------------------------------------------------------------------------
// Invoice emails — every CONFIRMATION/DISPATCH/DELIVERY/PARTIAL/OUT_OF_STOCK/
// CANCELLATION/CUSTOM invoice Order Management issues also goes out by email
// the moment it's created (see invoice.service.ts#issueInvoice's callers).
// Kept here rather than in invoice.service.ts so all outbound-email
// formatting lives in one file; invoice.service.ts just calls this with the
// invoice row (already includes `dealer`).
// ---------------------------------------------------------------------------
type InvoiceEmailType = "CONFIRMATION" | "OUT_OF_STOCK" | "PARTIAL" | "CANCELLATION" | "CUSTOM" | "DISPATCH" | "DELIVERY";

interface InvoiceForEmail {
  invoiceNumber: string;
  type: InvoiceEmailType;
  orderKind: "VEHICLE" | "SPARE_PART" | null;
  dealerId: number;
  item: string;
  requestedQuantity: number | null;
  fulfilledQuantity: number | null;
  unitPrice: unknown;
  expectedRestockDate: Date | null;
  message: string | null;
  issuedAt: Date;
  dealer: {
    legalName: string; tradeName: string | null; email: string | null;
    gstNumber?: string | null; addressLine?: string | null; city?: string | null; state?: string | null;
  } | null;
}

const INVOICE_TYPE_LABEL: Record<InvoiceEmailType, string> = {
  CONFIRMATION: "Order Confirmation",
  DISPATCH: "Dispatch Note",
  DELIVERY: "Delivery Receipt",
  PARTIAL: "Partial Fulfillment Notice",
  OUT_OF_STOCK: "Out-of-Stock Notice",
  CANCELLATION: "Order Cancellation",
  CUSTOM: "General Notice",
};

const INVOICE_TYPE_INTRO: Record<InvoiceEmailType, string> = {
  CONFIRMATION: "Your order has been confirmed by the manufacturer.",
  DISPATCH: "Your order has left our warehouse and is on its way to you.",
  DELIVERY: "Your order has been marked delivered.",
  PARTIAL: "We're able to fulfil part of your order right now — see the details below.",
  OUT_OF_STOCK: "Your order is currently out of stock at the manufacturer.",
  CANCELLATION: "An order or invoice has been cancelled.",
  CUSTOM: "You have a new notice from Luxus Green Mobility.",
};

const INVOICE_PRICED_TYPES = new Set<InvoiceEmailType>(["CONFIRMATION", "DISPATCH", "DELIVERY", "PARTIAL"]);
const GST_RATE = 0.18;
const inr = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Splits "Model Name (Segment)" back into its two parts — the exact inverse
// of the string issueInvoice builds for a VEHICLE item (see
// dealerInventory.controller.ts#update / orderManagement.controller.ts).
function splitVehicleItem(item: string): { model: string; segment: string | null } {
  const match = item.match(/^(.*)\s\(([^)]+)\)\s*$/);
  return match ? { model: match[1].trim(), segment: match[2] } : { model: item, segment: null };
}

// This is the actual document a dealer receives for a delivery — and also
// the one they're most likely to hand straight to Inventory's "Scan bill"
// OCR to add the same stock they just got a receipt for, instead of typing
// it in twice. So the layout below isn't just cosmetic: the item table is a
// real Sr/Description/Qty/Rate/Amount row (matching what
// sparePartsBillParsing.service.ts's line-item heuristic expects — an item
// name followed by 2+ numbers on one line), the table header uses words
// ("Description", "Sr No") that parser's skip-list already filters out so
// the header itself is never misread as a bogus item, and every summary
// line (subtotal/GST/total/meta) is deliberately kept to a single number so
// it falls under that parser's 2-number-minimum threshold and is ignored.
// For a VEHICLE delivery specifically, the units actually reassigned to the
// dealer in this transaction are listed with their VINs so
// vehicleBillParsing.service.ts's 17-character VIN scan has something real
// to find, each VIN sat next to the same model name text used to guess the
// catalog match.
export async function sendInvoiceEmail(invoice: InvoiceForEmail) {
  const dealer = invoice.dealer;
  if (!dealer?.email) return;

  const label = INVOICE_TYPE_LABEL[invoice.type] ?? invoice.type;
  const priced = INVOICE_PRICED_TYPES.has(invoice.type);
  const qty = invoice.fulfilledQuantity ?? invoice.requestedQuantity ?? 0;
  const unitPrice = Number(invoice.unitPrice ?? 0);
  const subtotal = priced ? unitPrice * qty : 0;
  const gst = subtotal * GST_RATE;
  const total = subtotal + gst;
  const isDoc = ["CONFIRMATION", "DISPATCH", "DELIVERY", "PARTIAL"].includes(invoice.type);

  // Best-effort only — this file's contract is "never throws" (see header
  // comment), so a DB hiccup here must fall back to no VIN block rather than
  // ever blocking the email send.
  let vehicleUnits: { vin: string }[] = [];
  if (invoice.orderKind === "VEHICLE" && invoice.type === "DELIVERY" && qty > 0) {
    try {
      const { model } = splitVehicleItem(invoice.item);
      vehicleUnits = await prisma.vehicleUnit.findMany({
        where: { dealerId: invoice.dealerId, model },
        orderBy: { allocatedAt: "desc" },
        take: qty,
        select: { vin: true },
      });
    } catch (error) {
      console.error("✉️  Could not look up delivered VINs for invoice email:", error);
    }
  }

  const itemTable = priced ? `
    <table style="width:100%; border-collapse:collapse; margin-top:16px; font-size:13px;">
      <thead>
        <tr style="background:#0f4c3a; color:#fff;">
          <th style="padding:8px 6px; text-align:left; font-weight:600;">Sr No</th>
          <th style="padding:8px 6px; text-align:left; font-weight:600;">Description</th>
          <th style="padding:8px 6px; text-align:right; font-weight:600;">Qty</th>
          <th style="padding:8px 6px; text-align:right; font-weight:600;">Rate</th>
          <th style="padding:8px 6px; text-align:right; font-weight:600;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid #e5e2d9;">
          <td style="padding:8px 6px;">1</td>
          <td style="padding:8px 6px;">${invoice.item}</td>
          <td style="padding:8px 6px; text-align:right;">${qty}</td>
          <td style="padding:8px 6px; text-align:right;">${inr(unitPrice)}</td>
          <td style="padding:8px 6px; text-align:right;">${inr(subtotal)}</td>
        </tr>
      </tbody>
    </table>
    <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:13px;">
      <tr><td style="padding:4px 6px; color:#666;">Subtotal</td><td style="padding:4px 6px; text-align:right;">${inr(subtotal)}</td></tr>
      <tr><td style="padding:4px 6px; color:#666;">GST</td><td style="padding:4px 6px; text-align:right;">${inr(gst)}</td></tr>
      <tr style="border-top:2px solid #0f4c3a;"><td style="padding:8px 6px; font-weight:700;">Total Payable</td><td style="padding:8px 6px; text-align:right; font-weight:700;">${inr(total)}</td></tr>
    </table>
    <p style="margin-top:6px; font-size:11px; color:#999;">GST charged at the standard 18 percent slab.</p>
  ` : `
    <div style="margin-top:16px; padding:12px 14px; background:#f4f3ee; border-radius:8px; font-size:13px; line-height:1.5;">
      <strong>${invoice.item}</strong>${invoice.requestedQuantity ? ` — Qty ${invoice.requestedQuantity}` : ""}
    </div>
  `;

  const vehicleBlock = vehicleUnits.length > 0 ? `
    <div style="margin-top:18px;">
      <p style="margin:0 0 6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#666;">Vehicle Unit(s) Delivered</p>
      <table style="width:100%; border-collapse:collapse; font-size:12px; font-family: 'Courier New', monospace;">
        ${vehicleUnits.map((u, i) => `<tr><td style="padding:3px 6px; color:#666;">${i + 1}.</td><td style="padding:3px 6px;">VIN ${u.vin} — ${invoice.item}</td></tr>`).join("")}
      </table>
    </div>
  ` : "";

  const restock = invoice.expectedRestockDate
    ? new Date(invoice.expectedRestockDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
    : null;
  const issuedDate = new Date(invoice.issuedAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });

  return sendMail({
    to: dealer.email,
    subject: `${label} — ${invoice.invoiceNumber}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a; border: 1px solid #e5e2d9; border-radius: 12px; overflow: hidden;">
        <div style="background:#0f4c3a; padding: 20px 24px; color:#fff;">
          <h2 style="margin: 0 0 2px; font-size: 19px;">Luxus Green Mobility</h2>
          <p style="margin: 0; font-size: 11px; opacity: 0.75; letter-spacing: 0.04em; text-transform: uppercase;">Electric Vehicles &middot; Manufacturer &amp; OEM</p>
        </div>

        <div style="padding: 24px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 18px;">
            <div>
              <p style="margin:0; font-size:16px; font-weight:700;">${isDoc ? label : "Notice"}</p>
              <p style="margin:2px 0 0; font-size:12px; color:#888;">${INVOICE_TYPE_INTRO[invoice.type]}</p>
            </div>
            <div style="text-align:right; font-size:12px; color:#666;">
              <p style="margin:0;">No. ${invoice.invoiceNumber}</p>
              <p style="margin:2px 0 0;">${issuedDate}</p>
            </div>
          </div>

          <div style="padding:12px 14px; background:#faf9f5; border-radius:8px; font-size:13px; margin-bottom: 4px;">
            <p style="margin:0 0 2px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#666;">Billed To</p>
            <p style="margin:0; font-weight:600;">${dealer.tradeName || dealer.legalName}</p>
            ${dealer.addressLine ? `<p style="margin:2px 0 0; color:#666;">${dealer.addressLine}${dealer.city ? `, ${dealer.city}` : ""}${dealer.state ? `, ${dealer.state}` : ""}</p>` : ""}
            ${dealer.gstNumber ? `<p style="margin:2px 0 0; color:#666;">GSTIN: ${dealer.gstNumber}</p>` : ""}
          </div>

          ${itemTable}
          ${vehicleBlock}

          ${restock ? `<p style="margin-top:14px; font-weight:600; font-size: 13px;">Expected date: ${restock}</p>` : ""}
          ${invoice.message ? `<div style="margin-top:16px; padding:12px 14px; background:#f4f3ee; border-radius:8px; font-size:13px; line-height:1.5;">${invoice.message}</div>` : ""}

          <div style="margin-top:28px; padding-top:14px; border-top:1px solid #e5e2d9; display:flex; justify-content:space-between; align-items:flex-end;">
            <p style="margin:0; font-size:11px; color:#999;">Sign in to your dealer portal for the full invoice card.</p>
            <p style="margin:0; font-size:11px; color:#999; font-style:italic;">Authorized Signatory</p>
          </div>
        </div>

        <div style="background:#faf9f5; padding: 10px 24px; font-size: 10px; color: #999;">Issued by Order Management — Luxus Green Mobility.</div>
      </div>
    `,
  });
}

// ---------------------------------------------------------------------------
// Warranty claim status emails — closes the same loop Order Management's
// invoice emails already give: a dealer submits a claim from DMS, and every
// staff-driven decision after that (approve/reject/repair/reimburse/close)
// reaches them without having to keep re-opening the Warranty page to check.
// The initial auto-adjudication result is already shown synchronously in the
// DMS submit flow, so this only fires for the staff-driven transitions that
// happen after that.
// ---------------------------------------------------------------------------
type WarrantyStatus = "SUBMITTED" | "UNDER_REVIEW" | "INFO_REQUESTED" | "APPROVED" | "IN_REPAIR" | "REIMBURSED" | "RECOVERY" | "REJECTED" | "CLOSED";

interface WarrantyClaimForEmail {
  claimNumber: string;
  customerName: string;
  status: WarrantyStatus;
  approvedAmount: unknown;
  rejectionReason: string | null;
  dealer: { legalName: string; tradeName: string | null; email: string | null } | null;
}

const WARRANTY_STATUS_LABEL: Partial<Record<WarrantyStatus, string>> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  IN_REPAIR: "In Repair",
  REIMBURSED: "Reimbursed",
  CLOSED: "Closed",
};

// Only the staff-driven transitions get an email — SUBMITTED/UNDER_REVIEW
// are intake states the dealer already sees the result of at submit time.
const WARRANTY_EMAIL_STATUSES = new Set<WarrantyStatus>(["APPROVED", "REJECTED", "IN_REPAIR", "REIMBURSED", "CLOSED"]);

export function sendWarrantyClaimStatusEmail(claim: WarrantyClaimForEmail) {
  if (!WARRANTY_EMAIL_STATUSES.has(claim.status)) return Promise.resolve();
  const dealer = claim.dealer;
  if (!dealer?.email) return Promise.resolve();

  const label = WARRANTY_STATUS_LABEL[claim.status] ?? claim.status;
  const detail =
    claim.status === "APPROVED" && claim.approvedAmount != null
      ? `<p style="margin-top:10px; font-weight:600; font-size:14px;">Approved amount: Rs. ${Number(claim.approvedAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>`
      : claim.status === "REJECTED" && claim.rejectionReason
      ? `<div style="margin-top:12px; padding:12px 14px; background:#fdf2f2; border-radius:8px; font-size:13px; line-height:1.5; color:#7a2e2e;">${claim.rejectionReason}</div>`
      : "";

  return sendMail({
    to: dealer.email,
    subject: `Warranty claim ${claim.claimNumber} — ${label}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin: 0 0 2px;">Luxus Green Mobility</h2>
        <p style="color:#999; margin: 0 0 20px; font-size: 12px;">Electric Vehicles &middot; Manufacturer &amp; OEM</p>
        <p style="color:#888; margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Warranty Claim &middot; ${claim.claimNumber}</p>
        <p>Hi ${dealer.tradeName || dealer.legalName},</p>
        <p>The warranty claim for <strong>${claim.customerName}</strong> has been updated to <strong>${label}</strong>.</p>
        ${detail}
        <p style="margin-top:24px; font-size:13px; color:#444;">Sign in to your dealer portal to see the full claim timeline.</p>
        <p style="margin-top:24px; font-size: 12px; color: #888;">Issued by Warranty Management — Luxus Green Mobility.</p>
      </div>
    `,
  });
}

// ---------------------------------------------------------------------------
// Finance case status emails — same closed-loop contract as warranty and
// invoices: a dealer requests buyer financing from DMS, and every staff-
// driven pipeline move (docs requested, submitted to the financier,
// approved, disbursed, rejected) reaches them without re-opening Finance
// Management to check.
// ---------------------------------------------------------------------------
type FinanceCaseStatus = "NEW" | "DOCS_PENDING" | "SUBMITTED" | "APPROVED" | "DISBURSED" | "REJECTED";

interface FinanceCaseForEmail {
  buyerName: string;
  status: FinanceCaseStatus;
  financierName: string | null;
  loanAmount: unknown;
  dealer: { legalName: string; tradeName: string | null; email: string | null } | null;
}

const FINANCE_STATUS_LABEL: Record<FinanceCaseStatus, string> = {
  NEW: "New",
  DOCS_PENDING: "Documents Needed",
  SUBMITTED: "Submitted to Financier",
  APPROVED: "Approved",
  DISBURSED: "Disbursed",
  REJECTED: "Rejected",
};

const FINANCE_STATUS_NOTE: Partial<Record<FinanceCaseStatus, string>> = {
  DOCS_PENDING: "The buyer's KYC/income documents are needed before this can move forward — upload them from the Finance page in your dealer portal.",
  APPROVED: "The loan has been approved by the financier.",
  DISBURSED: "Funds have been disbursed — this sale can proceed to delivery.",
  REJECTED: "The financier was unable to approve this application.",
};

export function sendFinanceCaseStatusEmail(financeCase: FinanceCaseForEmail) {
  const dealer = financeCase.dealer;
  if (!dealer?.email) return Promise.resolve();

  const label = FINANCE_STATUS_LABEL[financeCase.status] ?? financeCase.status;
  const note = FINANCE_STATUS_NOTE[financeCase.status];
  const loanAmount = financeCase.loanAmount != null ? Number(financeCase.loanAmount) : null;

  return sendMail({
    to: dealer.email,
    subject: `Finance case for ${financeCase.buyerName} — ${label}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin: 0 0 2px;">Luxus Green Mobility</h2>
        <p style="color:#999; margin: 0 0 20px; font-size: 12px;">Electric Vehicles &middot; Manufacturer &amp; OEM</p>
        <p style="color:#888; margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Finance Case</p>
        <p>Hi ${dealer.tradeName || dealer.legalName},</p>
        <p>The finance case for <strong>${financeCase.buyerName}</strong> has been updated to <strong>${label}</strong>.</p>
        ${note ? `<div style="margin-top:12px; padding:12px 14px; background:#f4f3ee; border-radius:8px; font-size:13px; line-height:1.5;">${note}</div>` : ""}
        ${financeCase.financierName ? `<p style="margin-top:12px; font-size:13px;">Financier: <strong>${financeCase.financierName}</strong></p>` : ""}
        ${loanAmount ? `<p style="margin-top:4px; font-size:13px;">Loan amount: <strong>Rs. ${loanAmount.toLocaleString("en-IN")}</strong></p>` : ""}
        <p style="margin-top:24px; font-size:13px; color:#444;">Sign in to your dealer portal for the full case.</p>
        <p style="margin-top:24px; font-size: 12px; color: #888;">Issued by Finance Management — Luxus Green Mobility.</p>
      </div>
    `,
  });
}

// ---------------------------------------------------------------------------
// Spare part return status emails — same closed-loop contract as warranty
// and finance: a dealer flags a defective part from DMS, and every staff
// decision (approved/rejected/resolved) reaches them without re-checking.
// ---------------------------------------------------------------------------
type SparePartReturnStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "RESOLVED";
type SparePartReturnResolution = "REPLACED" | "CREDITED";

interface SparePartReturnForEmail {
  partName: string;
  quantity: number;
  status: SparePartReturnStatus;
  resolution: SparePartReturnResolution | null;
  staffNotes: string | null;
  dealer: { legalName: string; tradeName: string | null; email: string | null } | null;
}

const RETURN_STATUS_LABEL: Partial<Record<SparePartReturnStatus, string>> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RESOLVED: "Resolved",
};

const RETURN_RESOLUTION_NOTE: Partial<Record<SparePartReturnResolution, string>> = {
  REPLACED: "A replacement unit has been credited to your inventory, and the OEM's stock has been adjusted for it.",
  CREDITED: "This has been settled as a credit rather than a physical replacement.",
};

// Only staff-driven transitions get an email — REQUESTED is the dealer's own
// submission, they already know they made it.
const RETURN_EMAIL_STATUSES = new Set<SparePartReturnStatus>(["APPROVED", "REJECTED", "RESOLVED"]);

export function sendSparePartReturnStatusEmail(sparePartReturn: SparePartReturnForEmail) {
  if (!RETURN_EMAIL_STATUSES.has(sparePartReturn.status)) return Promise.resolve();
  const dealer = sparePartReturn.dealer;
  if (!dealer?.email) return Promise.resolve();

  const label = RETURN_STATUS_LABEL[sparePartReturn.status] ?? sparePartReturn.status;
  const resolutionNote = sparePartReturn.resolution ? RETURN_RESOLUTION_NOTE[sparePartReturn.resolution] : null;

  return sendMail({
    to: dealer.email,
    subject: `Spare part return — ${sparePartReturn.partName} — ${label}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin: 0 0 2px;">Luxus Green Mobility</h2>
        <p style="color:#999; margin: 0 0 20px; font-size: 12px;">Electric Vehicles &middot; Manufacturer &amp; OEM</p>
        <p style="color:#888; margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">Spare Part Return</p>
        <p>Hi ${dealer.tradeName || dealer.legalName},</p>
        <p>Your quality-return request for <strong>${sparePartReturn.quantity} &times; ${sparePartReturn.partName}</strong> has been updated to <strong>${label}</strong>${sparePartReturn.resolution ? ` (${sparePartReturn.resolution.toLowerCase()})` : ""}.</p>
        ${resolutionNote ? `<div style="margin-top:12px; padding:12px 14px; background:#f4f3ee; border-radius:8px; font-size:13px; line-height:1.5;">${resolutionNote}</div>` : ""}
        ${sparePartReturn.staffNotes ? `<div style="margin-top:12px; padding:12px 14px; background:#faf9f5; border-radius:8px; font-size:13px; line-height:1.5;">${sparePartReturn.staffNotes}</div>` : ""}
        <p style="margin-top:24px; font-size:13px; color:#444;">Sign in to your dealer portal for the full return.</p>
        <p style="margin-top:24px; font-size: 12px; color: #888;">Issued by Inventory Management — Luxus Green Mobility.</p>
      </div>
    `,
  });
}
