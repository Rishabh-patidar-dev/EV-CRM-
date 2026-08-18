// =============================================================================
// requireDealerPortalAuth — gate for the DMS operational portal.
// -----------------------------------------------------------------------------
// Reuses the same dealer_session cookie as dealerAuth.controller.ts (the
// onboarding-tracker login), but resolves one step further: applicationId ->
// DealerApplication -> linked Dealer row. Onboarding isn't enough on its own
// — a DealerApplication only gets a Dealer once staff run
// POST /dealers/from-application/:id (see dealer.controller.ts), so a dealer
// who has finished onboarding but hasn't been promoted yet gets a clear 403
// rather than silently having no data to scope queries to.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { prisma } from "@repo/db";
import { verifyDealerSession } from "../controllers/dealerAuth.controller.js";

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

  const dealer = await prisma.dealer.findUnique({
    where: { applicationId },
    select: { id: true, dealerCode: true, legalName: true, status: true },
  });

  if (!dealer) {
    return res.status(403).json({
      ok: false,
      message: "Your onboarding is still in progress — the dealer portal unlocks once your dealership is approved and set up on the network.",
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
