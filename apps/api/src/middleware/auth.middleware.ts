import { Request, Response, NextFunction } from "express";
import { prisma } from "@repo/db";

// ---------------------------------------------------------------------------
// DEV-ONLY auth stub for this standalone local scaffold.
//
// The real innocrm-staging codebase already has session/JWT auth wired at
// this exact path (requireAuth / requireRole) — every controller in this
// bundle was written against that contract. This stub reproduces the same
// contract without a login flow so the bundle is reachable locally:
//   - requireAuth resolves req.user from an `x-user-role` / `x-user-id`
//     header pair, defaulting to the seeded SYSTEM_ADMIN account.
//   - requireRole(roles) 403s if req.user.role isn't in the allowed list —
//     send `x-user-role: SALES` (or any role) to see it reject.
// Replace this file with the real middleware when you integrate for real.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: number; role: string };
    }
  }
}

let cachedAdminId: number | null = null;

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const headerRole = req.get("x-user-role") ?? "SYSTEM_ADMIN";
  const headerId = req.get("x-user-id");

  if (headerId) {
    req.user = { id: parseInt(headerId, 10) || 1, role: headerRole };
    return next();
  }

  try {
    if (cachedAdminId == null) {
      const admin = await prisma.user.findFirst({ where: { role: "SYSTEM_ADMIN" } });
      cachedAdminId = admin?.id ?? 1;
    }
    req.user = { id: cachedAdminId, role: headerRole };
  } catch {
    req.user = { id: 1, role: headerRole };
  }
  next();
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden — insufficient role" });
    }
    next();
  };
}
