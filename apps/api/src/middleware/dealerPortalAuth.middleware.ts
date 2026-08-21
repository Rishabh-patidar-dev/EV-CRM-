// =============================================================================
// requireDealerPortalAuth — gate for the DMS operational portal.
// -----------------------------------------------------------------------------
// Reuses the same dealer_session cookie as dealerAuth.controller.ts (the
// onboarding-tracker login), but resolves one step further: applicationId ->
// DealerApplication -> linked Dealer row. Staff normally promote an
// application via POST /dealers/from-application/:id (dealer.controller.ts)
// once onboarding is genuinely complete — but a signed-in applicant with no
// linked Dealer yet used to hit a hard "portal not unlocked" wall here. That
// was correct for a real, staged onboarding pipeline, but wrong for a demo
// account: auto-promote instead, using the exact same field mapping
// dealer.controller.ts#createFromApplication uses, so every dealer_session
// that makes it this far always has a working portal on the other side.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { prisma } from "@repo/db";
import { verifyDealerSession } from "../controllers/dealerAuth.controller.js";
import { generateDealerCode, serializeSegments } from "../services/dealerManagement.service.js";

export interface DealerPortalContext {
  applicationId: number;
  dealerId: number;
  dealerCode: string;
  legalName: string;
  status: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      dealerPortal?: DealerPortalContext;
    }
  }
}

export async function requireDealerPortalAuth(req: Request, res: Response, next: NextFunction) {
  const applicationId = verifyDealerSession(req);
  if (!applicationId) {
    return res.status(401).json({ ok: false, message: "Not signed in" });
  }

  let dealer = await prisma.dealer.findUnique({
    where: { applicationId },
    select: { id: true, dealerCode: true, legalName: true, status: true },
  });

  if (!dealer) {
    const app = await prisma.dealerApplication.findUnique({ where: { id: applicationId } });
    if (!app) {
      return res.status(401).json({ ok: false, message: "Not signed in" });
    }
    const state = app.state || "Chhattisgarh";
    const dealerCode = await generateDealerCode(state);
    dealer = await prisma.dealer.create({
      data: {
        legalName: app.legalName ?? "Unnamed dealer",
        tradeName: app.tradeName ?? null,
        dealerCode,
        gstNumber: app.gstin ?? null,
        panNumber: app.pan ?? null,
        principalName: app.contactName ?? "—",
        phone: app.phone ?? "—",
        email: app.email ?? null,
        city: app.city ?? null,
        state,
        pincode: app.pincode ?? null,
        tier: "STANDARD",
        segments: serializeSegments(undefined),
        status: "ACTIVE",
        appointedAt: new Date(),
        goLiveAt: new Date(),
        applicationId,
      },
      select: { id: true, dealerCode: true, legalName: true, status: true },
    });
  }

  req.dealerPortal = {
    applicationId,
    dealerId: dealer.id,
    dealerCode: dealer.dealerCode,
    legalName: dealer.legalName,
    status: dealer.status,
  };
  next();
}
