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
