// =============================================================================
// auth.middleware.ts — staff (CRM) authentication and role gating.
// -----------------------------------------------------------------------------
// WHAT THIS REPLACED, AND WHY IT MATTERED
//
// The previous version of this file was a development stub that resolved the
// caller's identity from an `x-user-role` header and *defaulted it to
// SYSTEM_ADMIN when absent*. Because every staff route in routes/index.ts is
// mounted behind requireAuth, that meant an unauthenticated request like
//
//     curl https://api.example.com/api/v1/dealers
//
// was served as a system administrator. Every dealer record, lead, invoice,
// and receivable in the system was readable — and every mutation endpoint
// writable — by anyone who knew the URL. The login screen in front of the CRM
// was purely cosmetic: the API behind it enforced nothing.
//
// This version verifies the `crm_session` JWT that auth.controller.ts already
// issues, so the login flow that existed all along is now actually load
// bearing. No frontend change was needed: apps/web sends the cookie already
// (axios `withCredentials: true` in lib/api/client.ts).
//
// A Bearer-token fallback mirrors dealerAuth.controller.ts#verifyDealerSession:
// cross-site cookies are increasingly blocked by default when the API and the
// frontend sit on different domains, and the CRM is deployed exactly that way.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@repo/db";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const COOKIE_NAME = "crm_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: number; role: string; username?: string | null };
    }
  }
}

interface SessionPayload {
  sub: number;
  username?: string | null;
  role?: string;
}

// ---------------------------------------------------------------------------
// Role freshness cache
// ---------------------------------------------------------------------------
// The role is carried in the JWT, and a "remember me" token lives for 30 days.
// Trusting the token's copy of the role for that long means demoting or
// deleting a staff account has no effect until they happen to log out — a real
// problem the day someone leaves the company.
//
// Re-reading the user on every request would fix that but adds a database
// round trip to every single authenticated call. This caches the authoritative
// role for a short TTL instead: revocation takes effect within ROLE_TTL_MS,
// at roughly 1/1000th of the query cost under sustained load.
// ---------------------------------------------------------------------------
const ROLE_TTL_MS = 60_000;
const ROLE_CACHE_MAX = 5_000;

type CacheEntry = { role: string | null; expiresAt: number };
const roleCache = new Map<number, CacheEntry>();

function cacheGet(userId: number): CacheEntry | undefined {
  const hit = roleCache.get(userId);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    roleCache.delete(userId);
    return undefined;
  }
  // Refresh insertion order so the eviction below is least-recently-used
  // rather than arbitrary.
  roleCache.delete(userId);
  roleCache.set(userId, hit);
  return hit;
}

function cacheSet(userId: number, role: string | null) {
  if (roleCache.size >= ROLE_CACHE_MAX) {
    const oldest = roleCache.keys().next().value;
    if (oldest !== undefined) roleCache.delete(oldest);
  }
  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_TTL_MS });
}

/** Called by auth.controller.ts after a login so the new session is never served a stale role. */
export function invalidateRoleCache(userId: number) {
  roleCache.delete(userId);
}

function readToken(req: Request): string | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const bearer = req.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7).trim() || null;
  return null;
}

/**
 * Verifies the staff session and populates req.user. 401s when there is no
 * valid session — there is no anonymous fallback.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Development-only escape hatch for curl/Postman work against a local API.
  // env.allowHeaderAuth is forced to false whenever NODE_ENV=production, so
  // this branch cannot be turned on in a deployed environment by config alone.
  if (env.allowHeaderAuth) {
    const headerRole = req.get("x-user-role");
    if (headerRole) {
      req.user = { id: parseInt(req.get("x-user-id") ?? "1", 10) || 1, role: headerRole };
      return next();
    }
  }

  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: "Not signed in" });
  }

  let payload: SessionPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as unknown as SessionPayload;
  } catch {
    return res.status(401).json({ success: false, message: "Session expired or invalid" });
  }

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId)) {
    return res.status(401).json({ success: false, message: "Session expired or invalid" });
  }

  // The demo account (id 0) exists only in auth.controller.ts, never in the
  // database, so it is authenticated purely by its signed token — and only
  // while demo login is switched on. Turning ENABLE_DEMO_LOGIN off therefore
  // also invalidates any demo session already in the wild.
  if (userId === 0) {
    if (!env.enableDemoLogin) {
      return res.status(401).json({ success: false, message: "Session expired or invalid" });
    }
    req.user = { id: 0, role: payload.role ?? "SYSTEM_ADMIN", username: payload.username ?? "Admin" };
    return next();
  }

  try {
    let role = cacheGet(userId)?.role;
    if (role === undefined) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      role = user?.role ?? null;
      cacheSet(userId, role);
    }
    if (role === null) {
      // Token is validly signed but the account behind it is gone.
      return res.status(401).json({ success: false, message: "Account no longer active" });
    }
    req.user = { id: userId, role, username: payload.username ?? null };
    return next();
  } catch (error) {
    // A database outage must not silently downgrade to "trust the token" —
    // that would reintroduce exactly the privilege-escalation hole this file
    // exists to close.
    logger.error({ err: error, userId }, "Auth role lookup failed");
    return res.status(503).json({ success: false, message: "Authentication temporarily unavailable" });
  }
}

/** 403s unless the authenticated user's role is in `roles`. */
export function requireRole(roles: string[]) {
  const allowed = new Set(roles);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Not signed in" });
    }
    if (!allowed.has(req.user.role)) {
      logger.warn(
        { userId: req.user.id, role: req.user.role, path: req.originalUrl },
        "Role check refused"
      );
      return res.status(403).json({ success: false, message: "Forbidden — insufficient role" });
    }
    next();
  };
}
