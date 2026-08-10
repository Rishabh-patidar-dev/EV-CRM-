// Staff login for the CRM (apps/web). Session is a JWT in an httpOnly
// cookie — the web app's middleware only checks the cookie is present
// (cheap, edge-safe redirect to /login); this controller is the one place
// that actually verifies it.
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@repo/db";
import { handleError } from "../utils/errorHandler.js";

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "crm_session";

// Hardcoded demo fallback — for showing the CRM in a demo even if the
// database is paused/unreachable (e.g. a paused Supabase free-tier
// project). Checked before any DB call in both login() and me(), so the
// login screen and the signed-in shell stay usable without the DB. Data
// panels that query the DB directly still won't populate — this only
// keeps the login wall and session check from blocking on it.
const DEMO_FALLBACK = {
  id: 0,
  username: "Admin",
  password: "Admin@123",
  firstName: "Admin",
  lastName: "User",
  role: "SYSTEM_ADMIN",
};
// "Keep me signed in" trades a short session for a long one — it's a real
// switch, not a decorative checkbox: unchecked, the cookie dies with the
// browser session; checked, it survives 30 days.
const SHORT_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const LONG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

function signSession(user: { id: number; username: string | null; role: string }, ttlMs: number) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: Math.floor(ttlMs / 1000),
  });
}

function setSessionCookie(res: Response, token: string, remember: boolean) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    // "none" is required for cross-site cookies (Vercel frontend +
    // Render backend are different domains). Browsers require secure:true
    // whenever sameSite is "none", so both must flip together.
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    // Omitting maxAge makes it a session cookie (cleared when the browser
    // closes) — that's the "don't remember me" path.
    ...(remember ? { maxAge: LONG_TTL_MS } : {}),
    path: "/",
  });
}

export class AuthController {
  /** POST /api/v1/auth/login */
  async login(req: Request, res: Response) {
    try {
      const { username, password, remember } = req.body ?? {};
      if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password are required" });
      }

      if (String(username).trim() === DEMO_FALLBACK.username && password === DEMO_FALLBACK.password) {
        const ttlMs = remember ? LONG_TTL_MS : SHORT_TTL_MS;
        const token = signSession({ id: DEMO_FALLBACK.id, username: DEMO_FALLBACK.username, role: DEMO_FALLBACK.role }, ttlMs);
        setSessionCookie(res, token, Boolean(remember));
        return res.json({
          success: true,
          user: {
            id: DEMO_FALLBACK.id,
            username: DEMO_FALLBACK.username,
            firstName: DEMO_FALLBACK.firstName,
            lastName: DEMO_FALLBACK.lastName,
            role: DEMO_FALLBACK.role,
          },
        });
      }

      const user = await prisma.user.findUnique({ where: { username: String(username).trim() } });
      if (!user || !user.passwordHash) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }

      const ttlMs = remember ? LONG_TTL_MS : SHORT_TTL_MS;
      const token = signSession({ id: user.id, username: user.username, role: user.role }, ttlMs);
      setSessionCookie(res, token, Boolean(remember));

      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (error) {
      handleError(error, res, "Login");
    }
  }

  /** GET /api/v1/auth/me */
  async me(req: Request, res: Response) {
    try {
      const token = req.cookies?.[COOKIE_NAME];
      if (!token || !JWT_SECRET) {
        return res.status(401).json({ success: false, message: "Not signed in" });
      }

      let payload: { sub: number };
      try {
        payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number };
      } catch {
        return res.status(401).json({ success: false, message: "Session expired" });
      }

      if (payload.sub === DEMO_FALLBACK.id) {
        return res.json({
          success: true,
          user: {
            id: DEMO_FALLBACK.id,
            username: DEMO_FALLBACK.username,
            firstName: DEMO_FALLBACK.firstName,
            lastName: DEMO_FALLBACK.lastName,
            role: DEMO_FALLBACK.role,
            email: null,
          },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, username: true, firstName: true, lastName: true, role: true, email: true },
      });
      if (!user) return res.status(401).json({ success: false, message: "Not signed in" });

      return res.json({ success: true, user });
    } catch (error) {
      handleError(error, res, "Get session");
    }
  }

  /** POST /api/v1/auth/logout */
  async logout(_req: Request, res: Response) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.json({ success: true });
  }
}
