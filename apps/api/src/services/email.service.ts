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
  item: string;
  requestedQuantity: number | null;
  fulfilledQuantity: number | null;
  unitPrice: unknown;
  expectedRestockDate: Date | null;
  message: string | null;
  issuedAt: Date;
  dealer: { legalName: string; tradeName: string | null; email: string | null } | null;
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

export function sendInvoiceEmail(invoice: InvoiceForEmail) {
  const dealer = invoice.dealer;
  if (!dealer?.email) return Promise.resolve();

  const label = INVOICE_TYPE_LABEL[invoice.type] ?? invoice.type;
  const priced = INVOICE_PRICED_TYPES.has(invoice.type);
  const qty = invoice.fulfilledQuantity ?? invoice.requestedQuantity ?? 0;
  const unitPrice = Number(invoice.unitPrice ?? 0);
  const subtotal = priced ? unitPrice * qty : 0;
  const gst = subtotal * GST_RATE;
  const total = subtotal + gst;

  const rows = [
    `<tr><td style="padding:6px 0;color:#666">Item</td><td style="padding:6px 0;text-align:right">${invoice.item}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666">Quantity</td><td style="padding:6px 0;text-align:right">${qty}${invoice.requestedQuantity != null && invoice.requestedQuantity !== qty ? ` / ${invoice.requestedQuantity} requested` : ""}</td></tr>`,
    priced ? `<tr><td style="padding:6px 0;color:#666">Unit price</td><td style="padding:6px 0;text-align:right">${inr(unitPrice)}</td></tr>` : "",
    priced ? `<tr><td style="padding:6px 0;color:#666">GST (18%)</td><td style="padding:6px 0;text-align:right">${inr(gst)}</td></tr>` : "",
    priced ? `<tr><td style="padding:10px 0;border-top:1px solid #eee;font-weight:600">Total due</td><td style="padding:10px 0;border-top:1px solid #eee;text-align:right;font-weight:600">${inr(total)}</td></tr>` : "",
  ].filter(Boolean).join("");

  const restock = invoice.expectedRestockDate
    ? new Date(invoice.expectedRestockDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return sendMail({
    to: dealer.email,
    subject: `${label} — ${invoice.invoiceNumber}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin: 0 0 2px;">Luxus Green Mobility</h2>
        <p style="color:#999; margin: 0 0 20px; font-size: 12px;">Electric Vehicles &middot; Manufacturer &amp; OEM</p>
        <p style="color:#888; margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">${label} &middot; ${invoice.invoiceNumber}</p>
        <p>Hi ${dealer.tradeName || dealer.legalName},</p>
        <p>${INVOICE_TYPE_INTRO[invoice.type]}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:14px;">${rows}</table>
        ${restock ? `<p style="margin-top:12px; font-weight:600; font-size: 14px;">Expected date: ${restock}</p>` : ""}
        ${invoice.message ? `<div style="margin-top:16px; padding:12px 14px; background:#f4f3ee; border-radius:8px; font-size:13px; line-height:1.5;">${invoice.message}</div>` : ""}
        <p style="margin-top:24px; font-size:13px; color:#444;">Sign in to your dealer portal to view the full invoice card and download it as a PDF.</p>
        <p style="margin-top:24px; font-size: 12px; color: #888;">Issued by Order Management — Luxus Green Mobility.</p>
      </div>
    `,
  });
}
