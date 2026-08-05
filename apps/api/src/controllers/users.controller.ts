// Minimal user directory — just enough to populate "assign to" pickers
// (lead owner, dealer relationship manager) in the UI.
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError } from "../utils/errorHandler.js";

export class UserController {
  async list(_req: Request, res: Response) {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
        orderBy: { firstName: "asc" },
      });
      res.json({ users });
    } catch (error) {
      handleError(error, res, "List users");
    }
  }
}
