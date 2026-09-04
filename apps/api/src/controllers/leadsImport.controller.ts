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
import { prisma, Prisma } from "@repo/db";
import { handleError, handleValidationError } from "../utils/errorHandler.js";
import { isValidEmail, isValidPhone, isValidName, isValidPincode } from "../utils/validators.js";

const TEMPLATE_HEADERS = ["First Name", "Last Name", "Email", "Phone", "Company Name", "City", "State", "Pincode", "Status"];
const ALLOWED_STATUSES = ["OPEN", "WORKING", "QUALIFIED", "UNQUALIFIED", "NURTURING", "CONVERTED"];
/** Hard ceiling on one upload, so a single request can't run for minutes. */
const MAX_IMPORT_ROWS = 20_000;
/** Rows per INSERT statement — keeps the parameter count inside driver limits. */
const INSERT_CHUNK_SIZE = 1_000;

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

      // A CSV big enough to time out the request is a CSV that should have
      // been split. Refusing it up front is kinder than a half-finished import.
      const dataRowCount = records.length - 1;
      if (dataRowCount > MAX_IMPORT_ROWS) {
        return handleValidationError(
          res,
          `This file has ${dataRowCount} rows. Please split it into files of at most ${MAX_IMPORT_ROWS}.`,
          "file",
          "Import leads"
        );
      }

      let insertedCount = 0;
      let skippedCount = 0;
      const skippedRows: Array<{ row: number; firstName: string; email: string; phone: string; reason: string }> = [];

      // ---------------------------------------------------------------------
      // Duplicate detection used to run two findFirst queries PER ROW, then a
      // create per row — three sequential round trips per line. On a 5,000-row
      // file over a hosted database that is 15,000 round trips in a single
      // request: minutes of wall time, one pooled connection held for all of
      // it, and a near-certain gateway timeout with nothing to show for it.
      //
      // Instead: collect the candidate keys, ask the database once for the
      // ones that already exist, then decide every row in memory.
      // ---------------------------------------------------------------------
      const candidateEmails = new Set<string>();
      const candidatePhones = new Set<string>();
      for (let r = 1; r < records.length; r++) {
        const row = records[r]!;
        const email = cell(row, "email");
        const phone = cell(row, "phone");
        if (email) candidateEmails.add(email.toLowerCase());
        if (phone) candidatePhones.add(phone);
      }

      const [existingByEmail, existingByPhone] = await Promise.all([
        candidateEmails.size
          ? prisma.lead.findMany({
              where: { email: { in: [...candidateEmails] }, deletedAt: null },
              select: { email: true },
            })
          : Promise.resolve([]),
        candidatePhones.size
          ? prisma.lead.findMany({
              where: { phone: { in: [...candidatePhones] }, deletedAt: null },
              select: { phone: true },
            })
          : Promise.resolve([]),
      ]);

      // Seeded from the database, then added to as rows are accepted — so a
      // file that repeats the same address twice rejects the second copy.
      // The old per-row version only caught that by accident, because the
      // first copy had already been written by the time the second was checked.
      const takenEmails = new Set(existingByEmail.map((l) => l.email?.toLowerCase()).filter(Boolean) as string[]);
      const takenPhones = new Set(existingByPhone.map((l) => l.phone).filter(Boolean) as string[]);

      const toCreate: Prisma.LeadCreateManyInput[] = [];

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

        if (email && takenEmails.has(email.toLowerCase())) { skip(`Duplicate email: ${email}`); continue; }
        if (phone && takenPhones.has(phone)) { skip(`Duplicate phone: ${phone}`); continue; }

        const fields = { name: [firstName, lastName].filter(Boolean).join(" "), email, phone: phone ?? "", companyName: companyName ?? "", city: city ?? "", state: state ?? "", pincode: pincode ?? "" };
        let completenessScore = 0;
        const missingFields: string[] = [];
        for (const [k, v] of Object.entries(fields)) (v && v.trim() !== "" ? (completenessScore += 14.3) : missingFields.push(k));
        const score = Math.round(completenessScore * 0.7 + 100 * 0.3);

        const resolvedEmail = email || `${Date.now()}_${Math.random().toString(36).slice(2)}@placeholder.local`;
        toCreate.push({
          firstName,
          lastName,
          email: resolvedEmail,
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
        });

        // Claim the keys now so a later row in the same file can't reuse them.
        takenEmails.add(resolvedEmail.toLowerCase());
        if (phone) takenPhones.add(phone);
        insertedCount++;
      }

      // One multi-row INSERT per chunk instead of one per lead. Chunked
      // because a single statement with tens of thousands of parameters can
      // exceed the driver's limit.
      for (let i = 0; i < toCreate.length; i += INSERT_CHUNK_SIZE) {
        await prisma.lead.createMany({
          data: toCreate.slice(i, i + INSERT_CHUNK_SIZE),
          // A row that loses a race against a concurrent import is skipped
          // rather than failing the whole batch.
          skipDuplicates: true,
        });
      }

      res.json({ insertedCount, skippedCount, skippedRows });
    } catch (error) {
      handleError(error, res, "Import leads");
    }
  }
}
