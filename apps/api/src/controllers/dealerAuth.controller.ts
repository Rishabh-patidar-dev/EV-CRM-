// =============================================================================
//  dealerAuth.controller.ts — self-service dealer portal (landing page)
//
//  Signup/login for the applicant who owns a DealerApplication row, so they
//  can sign in and upload documents stage-by-stage. Deliberately NOT the
//  same session mechanism as CRM staff (auth.controller.ts) — different
//  trust domain, different cookie, own JWT_DEALER_SECRET. Every document
//  uploaded here lands directly on the same DealerApplicationDocument rows
//  CRM staff see in /dealer-onboarding — there's no separate database on
//  the landing side, this IS the ingestion point.
// =============================================================================
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { ONBOARDING_DOC_CATALOG } from "../services/applicationRouting.service.js";
import { uploadFile } from "../services/fileStorage.service.js";
import { extractText } from "../services/ocr.service.js";

const JWT_SECRET = process.env.JWT_DEALER_SECRET;
const COOKIE_NAME = "dealer_session";

function sign(applicationId: number, username: string) {
  if (!JWT_SECRET) throw new Error("JWT_DEALER_SECRET is not configured");
  return jwt.sign({ sub: applicationId, username }, JWT_SECRET, { expiresIn: "30d" });
}

function setCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

/**
 * Verifies the dealer session, returns the applicationId or null. Checks the
 * dealer_session cookie first, falling back to an `Authorization: Bearer`
 * header carrying the same JWT. The bearer path exists because Ev Landing
 * and DMS are each on their own separate deployed domain from this API —
 * the cookie is inherently a cross-site (third-party) cookie in that setup,
 * which modern browsers increasingly block by default regardless of
 * SameSite=None;Secure being set correctly. A frontend that hit that
 * blocking would see login/signup succeed (the response body and Set-Cookie
 * both arrive fine) but then silently fail to stay signed in on the very
 * next request, because the browser never actually stored/sent the cookie.
 * Storing the token client-side (localStorage) and sending it as a header
 * sidesteps cookie policy entirely — headers aren't subject to any of it.
 */
export function verifyDealerSession(req: Request): number | null {
  const bearer = req.get("authorization");
  const token = req.cookies?.[COOKIE_NAME] || (bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined);
  if (!token || !JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number };
    return payload.sub;
  } catch {
    return null;
  }
}

export class DealerAuthController {
  /**
   * POST /api/v1/dealer-auth/signup
   * Body: { username, password, fullName, email, phone? }
   * If an open application already exists for this email (e.g. from the
   * no-login /apply flow), signup just attaches credentials to it —
   * one dealer, one application, however they first showed up. Otherwise
   * creates a fresh APPLICATION-stage row with the Stage-1 doc checklist,
   * exactly like the ingest webhook does.
   */
  async signup(req: Request, res: Response) {
    try {
      const { username, password, fullName, email, phone } = req.body ?? {};
      if (!username || !password || !fullName || !email) {
        return handleValidationError(res, "username, password, fullName and email are required", "body", "Dealer signup");
      }
      if (String(password).length < 8) {
        return handleValidationError(res, "Password must be at least 8 characters", "password", "Dealer signup");
      }

      const usernameTaken = await prisma.dealerApplication.findUnique({ where: { username } });
      if (usernameTaken) {
        return handleValidationError(res, "That username is taken", "username", "Dealer signup");
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const existing = await prisma.dealerApplication.findFirst({
        where: { email, status: { in: ["IN_PROGRESS", "ON_HOLD"] } },
      });

      let application;
      if (existing) {
        if (existing.username) {
          return handleValidationError(res, "An application for this email already has an account — sign in instead", "email", "Dealer signup");
        }
        application = await prisma.dealerApplication.update({
          where: { id: existing.id },
          data: { username, passwordHash },
        });
      } else {
        application = await prisma.$transaction(async (tx) => {
          const created = await tx.dealerApplication.create({
            data: {
              intent: "DEALERSHIP_APPLICATION",
              legalName: fullName,
              contactName: fullName,
              email,
              phone: phone || null,
              stage: "APPLICATION",
              status: "IN_PROGRESS",
              assignedTeam: "NETWORK_EXPANSION",
              username,
              passwordHash,
            },
          });
          const specs = ONBOARDING_DOC_CATALOG["APPLICATION"];
          await tx.dealerApplicationDocument.createMany({
            data: specs.map((s) => ({
              applicationId: created.id,
              stage: "APPLICATION" as const,
              docKey: s.docKey,
              label: s.label,
              required: s.required ?? true,
            })),
          });
          await tx.onboardingStageEvent.create({
            data: { applicationId: created.id, fromStage: null, toStage: "APPLICATION", note: "Account created via dealer portal signup" },
          });
          return created;
        });
      }

      const token = sign(application.id, application.username!);
      setCookie(res, token);
      // Cookie AND token in the body — the frontend stores the token itself
      // and sends it as a Bearer header on every subsequent call, since the
      // cookie alone can silently fail cross-site (see verifyDealerSession).
      res.status(201).json({ ok: true, applicationId: application.id, publicId: application.publicId, token });
    } catch (error) {
      handleError(error, res, "Dealer signup");
    }
  }

  /** POST /api/v1/dealer-auth/login — Body: { username, password } */
  async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        return handleValidationError(res, "Username and password are required", "body", "Dealer login");
      }

      const application = await prisma.dealerApplication.findUnique({ where: { username } });
      if (!application || !application.passwordHash) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }
      const valid = await bcrypt.compare(password, application.passwordHash);
      if (!valid) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }

      const token = sign(application.id, application.username!);
      setCookie(res, token);
      res.json({ ok: true, applicationId: application.id, publicId: application.publicId, token });
    } catch (error) {
      handleError(error, res, "Dealer login");
    }
  }

  /** POST /api/v1/dealer-auth/logout */
  async logout(_req: Request, res: Response) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  }

  /** GET /api/v1/dealer-auth/me */
  async me(req: Request, res: Response) {
    const applicationId = verifyDealerSession(req);
    if (!applicationId) return res.status(401).json({ ok: false, message: "Not signed in" });
    const application = await prisma.dealerApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, publicId: true, username: true, contactName: true, legalName: true, email: true, stage: true, status: true },
    });
    if (!application) return res.status(401).json({ ok: false, message: "Not signed in" });
    res.json({ ok: true, application });
  }

  /** GET /api/v1/dealer-auth/application — the signed-in dealer's own full record. */
  async getApplication(req: Request, res: Response) {
    const applicationId = verifyDealerSession(req);
    if (!applicationId) return res.status(401).json({ ok: false, message: "Not signed in" });
    try {
      const application = await prisma.dealerApplication.findUnique({
        where: { id: applicationId },
        include: {
          documents: { orderBy: [{ stage: "asc" }, { docKey: "asc" }] },
          stageHistory: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!application) return handleNotFoundError(res, "Application", "Get dealer application");
      const { passwordHash: _omit, ...safe } = application;
      res.json({ ok: true, application: safe });
    } catch (error) {
      handleError(error, res, "Get dealer application");
    }
  }

  /**
   * POST /api/v1/dealer-auth/documents (multipart, fields: docKey, file)
   * Uploads against the dealer's OWN application, current stage only —
   * this is the exact write CRM staff see appear in /dealer-onboarding.
   */
  async uploadDocument(req: Request, res: Response) {
    const applicationId = verifyDealerSession(req);
    if (!applicationId) return res.status(401).json({ ok: false, message: "Not signed in" });
    try {
      const file = req.file as Express.Multer.File | undefined;
      const docKey = req.body?.docKey;
      if (!file || !docKey) {
        return handleValidationError(res, "docKey and file are required", "body", "Upload dealer document");
      }

      const application = await prisma.dealerApplication.findUnique({ where: { id: applicationId }, select: { stage: true } });
      if (!application) return handleNotFoundError(res, "Application", "Upload dealer document");

      const doc = await prisma.dealerApplicationDocument.findUnique({
        where: { applicationId_stage_docKey: { applicationId, stage: application.stage, docKey } },
      });
      if (!doc) {
        return handleValidationError(res, "That document isn't part of the current stage's checklist", "docKey", "Upload dealer document");
      }

      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `dealer-applications/${applicationId}/${application.stage}/${docKey}/${Date.now()}_${sanitizedName}`;
      const { url } = await uploadFile(file.buffer, key, file.mimetype);

      let ocrExtractedText: string | null = null;
      let ocrStatus: "DONE" | "FAILED" | "SKIPPED" = "SKIPPED";
      if (file.mimetype?.startsWith("image/")) {
        try {
          ocrExtractedText = await extractText(file.buffer);
          ocrStatus = "DONE";
        } catch {
          ocrStatus = "FAILED";
        }
      }

      const updated = await prisma.dealerApplicationDocument.update({
        where: { id: doc.id },
        data: { status: "UPLOADED", fileUrl: url, notes: null, ocrExtractedText, ocrStatus },
      });

      res.status(201).json({ ok: true, document: updated });
    } catch (error) {
      handleError(error, res, "Upload dealer document");
    }
  }
}
