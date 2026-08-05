// =============================================================================
//  applicationRouting.service.ts
//  Domain logic for the dual-intent landing-page ingestion. Unchanged from
//  the delivered bundle at /api/services/applicationRouting.service.ts —
//  copied here verbatim, no SQLite-specific adaptation needed.
// =============================================================================

import type { OnboardingStage } from "@repo/db";

// ---- Types -----------------------------------------------------------------

export type Intent = "dealership_application" | "retail_inquiry";

export interface UtmAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface NormalisedApplicant {
  legalName: string;
  tradeName: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  gstin: string | null;
  pan: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  investmentCapacity: string | null;
}

// ---- Normalisation helpers -------------------------------------------------

/** Normalise an Indian phone to 10 local digits, else null. */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone || typeof phone !== "string") return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits.length === 10 ? digits : null;
}

/** Pull the first present value across a set of possible keys. */
function pick(src: Record<string, any>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = src?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** Resolve `intent` from a variety of payload shapes; defaults to retail. */
export function resolveIntent(payload: any): Intent {
  const raw = (
    payload?.intent ??
    payload?.form_submission?.intent ??
    payload?.custom_fields?.intent ??
    ""
  )
    .toString()
    .toLowerCase();

  if (["dealership_application", "dealership", "dealer", "franchise", "partner"].includes(raw)) {
    return "dealership_application";
  }
  return "retail_inquiry";
}

/** Extract UTM attribution from the payload (top-level, form, custom, or `utm`). */
export function extractUtm(payload: any): UtmAttribution {
  const src = {
    ...(payload?.utm ?? {}),
    ...(payload?.custom_fields ?? {}),
    ...(payload?.form_submission ?? {}),
    ...payload,
  };
  return {
    utmSource: pick(src, "utm_source", "utmSource", "source"),
    utmMedium: pick(src, "utm_medium", "utmMedium", "medium"),
    utmCampaign: pick(src, "utm_campaign", "utmCampaign", "campaign"),
  };
}

/**
 * Build a normalised applicant record from a dealership-application payload.
 * Returns null if the minimum viable fields are missing.
 */
export function extractApplicant(payload: any): NormalisedApplicant | null {
  const f = { ...(payload?.form_submission ?? {}), ...(payload?.custom_fields ?? {}), ...payload };

  const contactName =
    pick(f, "contactName", "contact_name", "name", "full_name") ||
    [pick(f, "firstName", "first_name"), pick(f, "lastName", "last_name")].filter(Boolean).join(" ") ||
    null;

  const legalName =
    pick(f, "legalName", "legal_name", "company", "company_name", "business_name", "organization") ??
    contactName; // fall back to contact name if no entity given yet

  const email = pick(f, "email");

  // Minimum viable: an entity/contact name + a way to reach them
  if (!legalName || !email) return null;

  return {
    legalName,
    tradeName: pick(f, "tradeName", "trade_name"),
    contactName: contactName ?? legalName,
    email,
    phone: normalizePhone(pick(f, "phone", "phone_number", "telephone", "mobile")),
    gstin: pick(f, "gstin", "gst", "gst_number"),
    pan: pick(f, "pan", "pan_number"),
    city: pick(f, "city"),
    state: pick(f, "state"),
    pincode: pick(f, "pincode", "pin_code", "zipcode", "zip_code"),
    investmentCapacity: pick(f, "investmentCapacity", "investment", "investment_capacity", "budget"),
  };
}

// ---- Onboarding document catalog ------------------------------------------
// Derived from "List of Documents required at each stage of Onboarding".
// When an application enters a stage, seedStageDocuments() creates one
// DealerApplicationDocument row per entry (status PENDING) so the monitoring
// UI can render a live checklist and track verification per stage.

export interface DocSpec {
  docKey: string;
  label: string;
  required?: boolean;
}

export const ONBOARDING_DOC_CATALOG: Record<OnboardingStage, DocSpec[]> = {
  APPLICATION: [
    { docKey: "IDENTITY_PROOF", label: "Identity proof (Aadhaar / Passport / Voter ID) of all stakeholders" },
    { docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards of all stakeholders" },
    { docKey: "PAN_CORPORATE", label: "Corporate PAN card (if existing entity)", required: false },
    { docKey: "ENTITY_PROOF", label: "Incorporation certificate / Partnership deed / Shops & Est. reg.", required: false },
    { docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate (Form REG-06)" },
    { docKey: "PROMOTER_PROFILE", label: "Professional profile / resume of primary investor" },
  ],
  SCREENING_NDA: [
    { docKey: "SIGNED_NDA", label: "Signed Non-Disclosure Agreement (e-stamped)" },
    { docKey: "EOI_FORM", label: "Expression of Interest (EoI) form" },
    { docKey: "CIBIL_REPORTS", label: "CIBIL score reports of all primary partners/directors" },
  ],
  BUSINESS_PROPOSAL: [
    { docKey: "DPR", label: "Detailed Project Report (micro-market & strategy)" },
    { docKey: "FIN_PROJECTIONS_3Y", label: "3-year financial projections (P&L, working capital)" },
    { docKey: "FUNDING_PROOF", label: "Funding source declaration / sanction letters / 6-month statements" },
  ],
  DUE_DILIGENCE: [
    { docKey: "AUDITED_FINANCIALS_3Y", label: "Audited balance sheets & P&L (last 3 FY), CA-signed" },
    { docKey: "ITR_3Y", label: "Income Tax Returns (Form V) for last 3 assessment years" },
    { docKey: "BANK_STATEMENTS_12M", label: "Bank statements for last 12 months (all current accounts)" },
    { docKey: "NETWORTH_CERT", label: "CA-certified Net Worth certificate" },
    { docKey: "BANK_NOC", label: "Bank NOC / No-Dues certificate" },
    { docKey: "PROPERTY_OWNERSHIP", label: "Proof of land/property ownership OR registered lease (3–5 yr lock-in)" },
    { docKey: "LAND_USE_NA", label: "Land Use Conversion (Non-Agricultural) certificate" },
    { docKey: "BUILDING_BLUEPRINTS", label: "Approved building blueprints / floor plans" },
    { docKey: "PROPERTY_TAX", label: "Latest paid property tax receipt" },
    { docKey: "FIRE_NOC", label: "Fire Department NOC (critical for EV battery safety)" },
    { docKey: "SITE_MEDIA", label: "Geo-tagged photos + 360° video walkthrough" },
  ],
  // Stage 5 — the defining milestone here is the Letter of Intent being
  // issued to the applicant; the dealer agreement and deposit close it out.
  LEGAL_AGREEMENT: [
    { docKey: "LOI_SIGNED", label: "Letter of Intent (LOI) issued to applicant" },
    { docKey: "DEALER_AGREEMENT", label: "Franchise/Dealership agreement (Aadhaar e-sign, e-stamped)" },
    { docKey: "BOARD_RESOLUTION", label: "Board resolution (for Pvt Ltd)", required: false },
    { docKey: "SECURITY_DEPOSIT_PROOF", label: "Security deposit proof (RTGS/NEFT ref or Bank Guarantee)" },
  ],
  OPERATIONAL: [],
};

/** Ordered stage list — used to validate forward-only transitions. Facility
 *  sign-off, staff training and go-live checks happen after the LOI, outside
 *  this tracked pipeline — advancing past LEGAL_AGREEMENT goes straight to
 *  OPERATIONAL. */
export const STAGE_ORDER: OnboardingStage[] = [
  "APPLICATION",
  "SCREENING_NDA",
  "BUSINESS_PROPOSAL",
  "DUE_DILIGENCE",
  "LEGAL_AGREEMENT",
  "OPERATIONAL",
] as unknown as OnboardingStage[];

export function stageIndex(stage: OnboardingStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** The next stage in the pipeline, or null if already terminal. */
export function nextStage(stage: OnboardingStage): OnboardingStage | null {
  const i = stageIndex(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1]! : null;
}
