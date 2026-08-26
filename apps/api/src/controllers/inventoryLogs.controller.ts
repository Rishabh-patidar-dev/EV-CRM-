// Read-only view over InventoryLog — see inventoryLog.service.ts for what
// writes these rows and why.
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError } from "../utils/errorHandler.js";

export class InventoryLogsController {
  // GET /api/v1/inventory-logs  (?entity=&bucket=&dealerId=&page=&limit=)
  async list(req: Request, res: Response) {
    try {
      const { entity, bucket, dealerId, page = "1", limit = "50" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 50));

      const where: any = {};
      if (entity) where.entity = entity;
      if (bucket) where.bucket = bucket;
      if (dealerId) where.dealerId = parseInt(dealerId as string);

      const [logs, total] = await Promise.all([
        prisma.inventoryLog.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true, tradeName: true } } },
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.inventoryLog.count({ where }),
      ]);

      res.json({ logs, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List inventory logs");
    }
  }
}
