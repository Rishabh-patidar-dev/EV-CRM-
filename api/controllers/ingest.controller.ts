// =============================================================================
//  ingest.controller.ts  —  Module 1: Landing Page Integration (Ingestion Engine)
//  POST /api/v1/ingest/landing-page
//
//  Dual-intent parser:
//    intent === "dealership_application"  -> DealerApplication (onboarding pipeline)
//                                            assigned to Network Expansion team
//    intent === "retail_inquiry"          -> Lead + Enquiry (Leads module)
//
//  This is the EV adaptation of InnoCRM's webhooks.controller.ts. The retail
//  branch reuses the exact dedup + Lead/Enquiry/FormSubmission pattern already
//  proven in that file; the dealership branch is new. Both branches capture
//  UTM attribution and stay resilient (a downstream failure never rejects the
//  webhook with a 5xx to the landing page).
//
//  Place in: apps/api/src/controllers/ingest.controller.ts
// =============================================================================

import { Request, Response } from "express";
import crypto from "crypto";
import { prisma, LeadStatus, LeadSource } from "@repo/db";
import { handleError } from "../utils/errorHandler.js";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
  isValidPincode,
} from "../utils/validators.js";
import {
  resolveIntent,
  extractUtm,
  extractApplicant,
  normalizePhone,
  ONBOARDING_DOC_CATALOG,
} from "../services/applicationRouting.service.js";

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

function maskEmail(email?: string | null) {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function sanitizeForStorage(obj: any, maxLen = 2000) {
  try {
    const clone: any = {};
    for (const k of Object.keys(obj || {})) {
      const v = obj[k];
      if (v == null) clone[k] = v;
      else if (typeof v === "string") clone[k] = v.length > maxLen ? `${v.slice(0, maxLen)}... [truncated]` : v;
      else if (typeof v === "object") {
        const s = JSON.stringify(v);
        clone[k] = s.length > maxLen ? `${s.slice(0, maxLen)}... [truncated]` : JSON.parse(s);
      } else clone[k] = v;
    }
    return clone;
  } catch {
    return { _error: "sanitization_failed" };
  }
}

export class IngestController {
  /** POST /api/v1/ingest/landing-page */
  async ingestLandingPage(req: Request, res: Response) {
    try {
      // ---- Optional HMAC signature verification (same scheme as Landingi) ----
      const secret = process.env.INGEST_WEBHOOK_SECRET || process.env.LANDINGI_WEBHOOK_SECRET;
      if (secret) {
        const sig =
          req.get("x-signature") ||
          req.get("x-landingi-signature") ||
          req.get("x-hub-signature-256");
        if (!sig) return res.status(401).json({ success: false, message: "Missing webhook signature" });
        const payload = req.rawBody ?? JSON.stringify(req.body);
        const computed = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
        const a = Buffer.from(computed);
        const b = Buffer.from(sig);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.status(401).json({ success: false, message: "Invalid webhook signature" });
        }
      }

      const body = req.body ?? {};
      const intent = resolveIntent(body);
      const utm = extractUtm(body);
      const campaignUniqueId: string | null =
        body.landing_page_campaign_id ?? body.campaign_id ?? body.campaignId ?? null;

      console.log("🎯 Ingest webhook", {
        intent,
        utmSource: utm.utmSource,
        email: maskEmail(body?.email ?? body?.form_submission?.email),
      });

      let campaign = null as null | { id: number };
      if (campaignUniqueId) {
        campaign = await prisma.landingPageCampaign.findUnique({
          where: { uniqueId: campaignUniqueId },
          select: { id: true },
        });
      }

      if (intent === "dealership_application") {
        const result = await this.routeDealershipApplication(body, utm, campaign?.id ?? null);
        return res.status(result.ok ? 200 : 422).json(result);
      } else {
        const result = await this.routeRetailInquiry(body, utm, campaign?.id ?? null);
        return res.status(result.ok ? 200 : 422).json(result);
      }
    } catch (error) {
      handleError(error, res, "Ingest landing page webhook");
    }
  }

  // ---------------------------------------------------------------------------
  //  Dealership application  ->  onboarding pipeline
  // ---------------------------------------------------------------------------
  private async routeDealershipApplication(
    body: any,
    utm: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null },
    landingPageCampaignId: number | null
  ) {
    const applicant = extractApplicant(body);
    if (!applicant) {
      return { ok: false, intent: "dealership_application", message: "Missing required fields (legalName/contact, email)" };
    }
    if (!isValidEmail(applicant.email)) {
      return { ok: false, intent: "dealership_application", message: "Invalid email" };
    }
    if (applicant.phone && !isValidPhone(applicant.phone)) {
      return { ok: false, intent: "dealership_application", message: "Invalid phone" };
    }
    if (applicant.pincode && !isValidPincode(applicant.pincode)) {
      return { ok: false, intent: "dealership_application", message: "Invalid pincode" };
    }

    // Dedup: an open application for the same email/gstin is reused, not duplicated.
    const existing = await prisma.dealerApplication.findFirst({
      where: {
        status: { in: ["IN_PROGRESS", "ON_HOLD"] },
        OR: [
          { email: applicant.email },
          ...(applicant.gstin ? [{ gstin: applicant.gstin }] : []),
        ],
      },
      select: { id: true, publicId: true, stage: true },
    });
    if (existing) {
      console.log("📇 Existing open application reused:", existing.publicId);
      return {
        ok: true,
        intent: "dealership_application",
        duplicate: true,
        applicationId: existing.id,
        publicId: existing.publicId,
        stage: existing.stage,
        message: "An application with these details is already in progress.",
      };
    }

    const created = await prisma.$transaction(async (tx) => {
      // (Optional) create a Lead so the application is visible in the CRM lead lists.
      const [firstName, ...rest] = applicant.contactName.split(" ");
      const lead = await tx.lead.create({
        data: {
          firstName: firstName || applicant.contactName,
          lastName: rest.join(" ") || null,
          email: applicant.email,
          phone: applicant.phone,
          companyName: applicant.legalName,
          city: applicant.city,
          state: applicant.state,
          pincode: applicant.pincode,
          source: LeadSource.LANDING_PAGE,
          status: LeadStatus.OPEN,
          score: 0,
        },
      });

      const app = await tx.dealerApplication.create({
        data: {
          intent: "DEALERSHIP_APPLICATION",
          legalName: applicant.legalName,
          tradeName: applicant.tradeName,
          contactName: applicant.contactName,
          email: applicant.email,
          phone: applicant.phone,
          gstin: applicant.gstin,
          pan: applicant.pan,
          city: applicant.city,
          state: applicant.state,
          pincode: applicant.pincode,
          investmentCapacity: applicant.investmentCapacity,
          stage: "APPLICATION",
          status: "IN_PROGRESS",
          assignedTeam: "NETWORK_EXPANSION",
          utmSource: utm.utmSource,
          utmMedium: utm.utmMedium,
          utmCampaign: utm.utmCampaign,
          landingPageCampaignId,
          leadId: lead.id,
          rawPayload: sanitizeForStorage(body),
        },
      });

      // Seed the Stage-1 document checklist.
      const specs = ONBOARDING_DOC_CATALOG["APPLICATION"];
      if (specs.length) {
        await tx.dealerApplicationDocument.createMany({
          data: specs.map((s) => ({
            applicationId: app.id,
            stage: "APPLICATION" as const,
            docKey: s.docKey,
            label: s.label,
            required: s.required ?? true,
          })),
        });
      }

      await tx.onboardingStageEvent.create({
        data: { applicationId: app.id, fromStage: null, toStage: "APPLICATION", note: "Application received via landing page" },
      });

      return app;
    });

    // TODO: enqueue notification to the Network Expansion team (Redis/email/SMS).
    return {
      ok: true,
      intent: "dealership_application",
      applicationId: created.id,
      publicId: created.publicId,
      stage: created.stage,
      message: "Application received. Our Network Expansion team will be in touch.",
    };
  }

  // ---------------------------------------------------------------------------
  //  Retail inquiry  ->  Leads module   (mirrors InnoCRM's proven path)
  // ---------------------------------------------------------------------------
  private async routeRetailInquiry(
    body: any,
    utm: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null },
    landingPageCampaignId: number | null
  ) {
    const f = { ...(body?.form_submission ?? {}), ...(body?.custom_fields ?? {}), ...body };
    const firstName = (f.firstName || f.first_name || (f.name ? String(f.name).split(" ")[0] : "") || "").trim();
    const lastName = (f.lastName || f.last_name || "").trim() || null;
    const email = (f.email || "").trim();
    const phone = normalizePhone(f.phone || f.phone_number || f.telephone);

    if (!firstName || !isValidName(firstName) || !email || !isValidEmail(email)) {
      return { ok: false, intent: "retail_inquiry", message: "Missing/invalid firstName or email" };
    }
    if (phone && !isValidPhone(phone)) {
      return { ok: false, intent: "retail_inquiry", message: "Invalid phone" };
    }

    // Dedup by email then phone (soft-delete aware), then attach a fresh enquiry.
    let existingLead = await prisma.lead.findFirst({ where: { email, deletedAt: null } });
    if (!existingLead && phone) existingLead = await prisma.lead.findFirst({ where: { phone, deletedAt: null } });

    const customFields = { ...f, utm };

    if (existingLead) {
      await prisma.enquiry.create({
        data: { leadId: existingLead.id, landingPageCampaignId, customFields, status: "UNRESOLVED" },
      });
      return { ok: true, intent: "retail_inquiry", leadId: existingLead.id, deduped: true };
    }

    const lead = await prisma.$transaction(async (tx) => {
      const newLead = await tx.lead.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          companyName: f.company || f.company_name || null,
          city: f.city || null,
          state: f.state || null,
          pincode: f.pincode || f.pin_code || null,
          source: LeadSource.LANDING_PAGE,
          status: LeadStatus.OPEN,
          score: 0,
        },
      });
      await tx.enquiry.create({
        data: { leadId: newLead.id, landingPageCampaignId, customFields, status: "UNRESOLVED" },
      });
      await tx.formSubmission.create({
        data: { leadId: newLead.id, formData: { source: "Ingest webhook", utm, webhookData: sanitizeForStorage(body) } },
      });
      return newLead;
    });

    // TODO: enqueue geo/RSM lead-routing + SLA timer (Redis).
    return { ok: true, intent: "retail_inquiry", leadId: lead.id };
  }

  /** GET /api/v1/ingest/landing-page/test */
  async test(_req: Request, res: Response) {
    return res.json({ success: true, message: "Ingest endpoint alive", timestamp: new Date().toISOString() });
  }
}
