// ============================================================================
// Lead Module — CSV bulk import, ported from innocrm-staging's
// apps/api/src/controllers/leadsImport.controller.ts (614 lines, XLSX+CSV,
// with Contact/Account conversion on import). This port keeps the real
// validation rules, dedup-by-email/phone logic, and per-row skip/error
// reporting, but is CSV-only (no ExcelJS dependency for a feature most
// people use as "export from a spreadsheet, upload the CSV") and drops the
// Contact/Account auto-conversion on `status=Converted` rows — this CRM
// doesn't have a Contact module; a converted lead just gets that status.
// ============================================================================
import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { prisma } from "@repo/db";
import { handleError, handleValidationError } from "../utils/errorHandler.js";
import { isValidEmail, isValidPhone, isValidName, isValidPincode } from "../utils/validators.js";

const TEMPLATE_HEADERS = ["First Name", "Last Name", "Email", "Phone", "Company Name", "City", "State", "Pincode", "Status"];
const ALLOWED_STATUSES = ["OPEN", "WORKING", "QUALIFIED", "UNQUALIFIED", "NURTURING", "CONVERTED"];

export class LeadsImportController {
  /** GET /api/v1/leads/import/template-csv */
  downloadTemplate(_req: Request, res: Response) {
    const csv = TEMPLATE_HEADERS.map((h) => `"${h}"`).join(",") + "\r\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads-template.csv"');
    res.send(csv);
  }

  /** POST /api/v1/leads/import — multipart, field name "file" (CSV) */
  async importLeads(req: Request, res: Response) {
    try {
      const file = (req as any).file;
      if (!file) return handleValidationError(res, "No file uploaded", "file", "Import leads");

      let records: string[][];
      try {
        records = parse(file.buffer, { columns: false, skip_empty_lines: true, trim: true, bom: true });
      } catch (e) {
        return handleValidationError(res, "Could not parse CSV file", "file", "Import leads");
      }
      if (records.length < 2) {
        return handleValidationError(res, "CSV has no data rows", "file", "Import leads");
      }

      const headerMap: Record<string, number> = {};
      records[0]!.forEach((h, i) => (headerMap[h.trim().toLowerCase()] = i));
      const cell = (row: string[], key: string) => {
        const idx = headerMap[key];
        return idx == null ? "" : (row[idx] ?? "").trim();
      };

      let insertedCount = 0;
      let skippedCount = 0;
      const skippedRows: Array<{ row: number; firstName: string; email: string; phone: string; reason: string }> = [];

      for (let r = 1; r < records.length; r++) {
        const row = records[r]!;
        const firstName = cell(row, "first name");
        const lastName = cell(row, "last name") || null;
        const email = cell(row, "email");
        const phone = cell(row, "phone") || null;
        const companyName = cell(row, "company name") || null;
        const city = cell(row, "city") || null;
        const state = cell(row, "state") || null;
        const pincode = cell(row, "pincode") || null;
        const status = cell(row, "status").toUpperCase();

        const skip = (reason: string) => {
          skippedCount++;
          skippedRows.push({ row: r + 1, firstName, email, phone: phone ?? "", reason });
        };

        if (!firstName || !isValidName(firstName)) { skip("Missing or invalid first name"); continue; }
        if (!email && !phone) { skip("Missing email and phone (one is required)"); continue; }
        if (email && !isValidEmail(email)) { skip("Invalid email"); continue; }
        if (phone && !isValidPhone(phone)) { skip("Invalid phone (must be a 10-digit Indian mobile number)"); continue; }
        if (pincode && !isValidPincode(pincode)) { skip("Invalid pincode"); continue; }
        if (status && !ALLOWED_STATUSES.includes(status)) { skip(`Invalid status: ${status}`); continue; }

        if (email) {
          const dup = await prisma.lead.findFirst({ where: { email, deletedAt: null } });
          if (dup) { skip(`Duplicate email: ${email}`); continue; }
        }
        if (phone) {
          const dup = await prisma.lead.findFirst({ where: { phone, deletedAt: null } });
          if (dup) { skip(`Duplicate phone: ${phone}`); continue; }
        }

        const fields = { name: [firstName, lastName].filter(Boolean).join(" "), email, phone: phone ?? "", companyName: companyName ?? "", city: city ?? "", state: state ?? "", pincode: pincode ?? "" };
        let completenessScore = 0;
        const missingFields: string[] = [];
        for (const [k, v] of Object.entries(fields)) (v && v.trim() !== "" ? (completenessScore += 14.3) : missingFields.push(k));
        const score = Math.round(completenessScore * 0.7 + 100 * 0.3);

        await prisma.lead.create({
          data: {
            firstName,
            lastName,
            email: email || `${Date.now()}_${Math.random().toString(36).slice(2)}@placeholder.local`,
            phone,
            companyName,
            city,
            state,
            pincode,
            source: "IMPORT",
            status: (status as any) || "OPEN",
            score,
            completenessScore: Math.round(completenessScore),
            qualityScore: 100,
            missingFields,
            invalidFields: [],
          },
        });
        insertedCount++;
      }

      res.json({ insertedCount, skippedCount, skippedRows });
    } catch (error) {
      handleError(error, res, "Import leads");
    }
  }
}
