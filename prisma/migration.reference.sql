-- =============================================================================
--  REFERENCE migration for the EV onboarding pipeline.
--  Prefer generating this automatically: after pasting the models into
--  schema.prisma, run `npm run db:migrate` (Prisma writes the real migration).
--  This file is a hand-written fallback / review aid — column names match the
--  @map() names in ev-onboarding.prisma.
-- =============================================================================

CREATE TYPE "ApplicationIntent" AS ENUM ('DEALERSHIP_APPLICATION', 'RETAIL_INQUIRY');
CREATE TYPE "OnboardingStage"   AS ENUM ('APPLICATION','SCREENING_NDA','BUSINESS_PROPOSAL','DUE_DILIGENCE','LEGAL_AGREEMENT','FACILITY_BRANDING','STAFF_TRAINING','GO_LIVE','OPERATIONAL');
CREATE TYPE "ApplicationStatus" AS ENUM ('IN_PROGRESS','ON_HOLD','APPROVED','REJECTED','WITHDRAWN');
CREATE TYPE "DealerTier"        AS ENUM ('FLAGSHIP_3S','MINI_SHOWROOM','SERVICE_PARTNER');
CREATE TYPE "DocumentStatus"    AS ENUM ('PENDING','UPLOADED','VERIFIED','REJECTED');

CREATE TABLE "dealer_applications" (
  "id"                       SERIAL PRIMARY KEY,
  "public_id"                TEXT NOT NULL UNIQUE,
  "intent"                   "ApplicationIntent" NOT NULL DEFAULT 'DEALERSHIP_APPLICATION',
  "legal_name"               TEXT NOT NULL,
  "trade_name"               TEXT,
  "contact_name"             TEXT NOT NULL,
  "email"                    TEXT NOT NULL,
  "phone"                    TEXT,
  "gstin"                    TEXT,
  "pan"                      TEXT,
  "city"                     TEXT,
  "state"                    TEXT,
  "pincode"                  TEXT,
  "investment_capacity"      TEXT,
  "tier"                     "DealerTier",
  "stage"                    "OnboardingStage"   NOT NULL DEFAULT 'APPLICATION',
  "status"                   "ApplicationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "assigned_team"            TEXT DEFAULT 'NETWORK_EXPANSION',
  "assigned_to_id"           INTEGER REFERENCES "users"("id"),
  "utm_source"               TEXT,
  "utm_medium"               TEXT,
  "utm_campaign"             TEXT,
  "landing_page_campaign_id" INTEGER REFERENCES "landing_page_campaigns"("id"),
  "lead_id"                  INTEGER UNIQUE REFERENCES "leads"("id"),
  "raw_payload"              JSONB,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL
);
CREATE INDEX "dealer_applications_stage_idx"        ON "dealer_applications"("stage");
CREATE INDEX "dealer_applications_status_idx"       ON "dealer_applications"("status");
CREATE INDEX "dealer_applications_assigned_to_idx"  ON "dealer_applications"("assigned_to_id");
CREATE INDEX "dealer_applications_email_idx"        ON "dealer_applications"("email");
CREATE INDEX "dealer_applications_created_at_idx"   ON "dealer_applications"("created_at");

CREATE TABLE "dealer_application_documents" (
  "id"             SERIAL PRIMARY KEY,
  "application_id" INTEGER NOT NULL REFERENCES "dealer_applications"("id") ON DELETE CASCADE,
  "stage"          "OnboardingStage" NOT NULL,
  "doc_key"        TEXT NOT NULL,
  "label"          TEXT NOT NULL,
  "required"       BOOLEAN NOT NULL DEFAULT TRUE,
  "status"         "DocumentStatus" NOT NULL DEFAULT 'PENDING',
  "file_url"       TEXT,
  "notes"          TEXT,
  "verified_by_id" INTEGER REFERENCES "users"("id"),
  "verified_at"    TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  UNIQUE ("application_id", "stage", "doc_key")
);
CREATE INDEX "dealer_application_documents_application_idx" ON "dealer_application_documents"("application_id");
CREATE INDEX "dealer_application_documents_status_idx"      ON "dealer_application_documents"("status");

CREATE TABLE "onboarding_stage_events" (
  "id"             SERIAL PRIMARY KEY,
  "application_id" INTEGER NOT NULL REFERENCES "dealer_applications"("id") ON DELETE CASCADE,
  "from_stage"     "OnboardingStage",
  "to_stage"       "OnboardingStage" NOT NULL,
  "note"           TEXT,
  "actor_id"       INTEGER REFERENCES "users"("id"),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "onboarding_stage_events_application_idx" ON "onboarding_stage_events"("application_id");
CREATE INDEX "onboarding_stage_events_to_stage_idx"    ON "onboarding_stage_events"("to_stage");
