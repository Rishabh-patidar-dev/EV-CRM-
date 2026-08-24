// Best-effort, free/offline heuristic extraction over raw OCR text — no LLM
// call, no API key, so it's necessarily pattern-matching rather than real
// understanding. That has a real failure mode worth being honest about: a
// typical invoice has TWO company names on it (the vendor issuing the bill,
// and the customer it's billed to) and this can't always tell them apart.
// To limit that specific risk, vendorName search is bounded to the text
// *before* the first "customer/bill to/name:" marker, since that's reliably
// where the vendor's own letterhead sits on almost every invoice layout.
// Every field is a suggestion the dealer reviews before saving, never a
// silent auto-submit.

export interface SuggestedInvoiceFields {
  vendorName?: string;
  vendorGstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string; // yyyy-mm-dd, only set if it parsed to a real date
  amount?: string;
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b|\b\d{2}[A-Z0-9]{13}\b/;
const CUSTOMER_MARKER_RE = /\b(customer\s*details?|bill(ed)?\s*to|ship\s*to|name\s*:)/i;
const COMPANY_HINT_RE = /\b(m\/s\.?|pvt\.?|private|ltd\.?|limited|llp|enterprises?|motors?|industries|traders?|company|co\.?)\b/i;

function cleanLine(line: string): string {
  return line.replace(/[|_~]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function extractVendorName(lines: string[]): string | undefined {
  const cutoffIdx = lines.findIndex((l) => CUSTOMER_MARKER_RE.test(l));
  const searchLines = (cutoffIdx > 0 ? lines.slice(0, cutoffIdx) : lines.slice(0, 6)).map(cleanLine).filter(Boolean);

  // Prefer a line that reads like a company name (M/s, Pvt Ltd, Motors, …)
  const withHint = searchLines.find((l) => COMPANY_HINT_RE.test(l) && !/^invoice\b/i.test(l));
  if (withHint) return withHint.replace(/^m\/s\.?\s*/i, "").trim().slice(0, 120);

  // Fall back to the first substantial, mostly-uppercase line that isn't the word "INVOICE"
  const upperLine = searchLines.find((l) => l.length > 4 && !/^invoice$/i.test(l) && l === l.toUpperCase() && /[A-Z]/.test(l));
  return upperLine?.slice(0, 120);
}

function extractGstin(text: string): string | undefined {
  const match = text.match(GSTIN_RE);
  return match?.[0]?.toUpperCase();
}

function extractInvoiceNumber(text: string): string | undefined {
  const match = text.match(/invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9\-\/.]{3,24})/i);
  return match?.[1]?.trim();
}

function toIsoIfPlausible(year: number, month: number, day: number): string | undefined {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Deliberately never routes through `new Date(...).toISOString()` for a
// calendar-date-only string — that converts through UTC, which silently
// shifts the date by a day whenever the server's local timezone isn't UTC
// (the exact bug already found and fixed elsewhere in this codebase this
// session). Every branch below reads/writes calendar components directly.
function tryParseDate(raw: string): string | undefined {
  // Numeric DD/MM/YYYY (the standard Indian invoice format) — parsed
  // explicitly rather than handed to `new Date()`, whose slash-date
  // handling is locale-ambiguous (often MM/DD/YYYY) and would silently
  // misread day-first dates.
  const numeric = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return toIsoIfPlausible(year, month, day);
  }

  // "Month DD, YYYY" / "DD Month YYYY" — safe to hand to the native parser
  // since there's no day/month ordering ambiguity once a month *name* is
  // involved; just read the result back via local getters, not toISOString().
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return toIsoIfPlausible(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Cheap edit distance — OCR month-name typos ("Tianuary" for "January") are
// almost always 1-2 character substitutions/insertions, well within this.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function closestMonth(word: string): string | undefined {
  const w = word.toLowerCase();
  let best: { month: string; dist: number } | null = null;
  for (const month of MONTHS) {
    const dist = levenshtein(w, month.slice(0, w.length > month.length ? month.length : w.length));
    const threshold = w.length <= 5 ? 1 : 2;
    if (dist <= threshold && (!best || dist < best.dist)) best = { month, dist };
  }
  return best?.month;
}

function extractInvoiceDate(text: string): string | undefined {
  // Numeric formats (DD/MM/YYYY etc.) and clean "Month DD, YYYY" / "DD Month YYYY" —
  // comma-before-year spacing is optional since OCR frequently drops that space.
  const dateFragment =
    /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|([A-Za-z]+\s+\d{1,2}[,]?\s*\d{4})|(\d{1,2}\s+[A-Za-z]+[,]?\s*\d{4})/;
  const labeled = text.match(new RegExp(`date\\s*[:\\-]?\\s*(${dateFragment.source})`, "i"));
  const candidate = labeled?.[1] ?? text.match(dateFragment)?.[0];
  const direct = candidate ? tryParseDate(candidate) : undefined;
  if (direct) return direct;

  // Fuzzy pass: an OCR-garbled month name ("Tianuary 15,2021") won't parse
  // directly — correct the word to its nearest real month name and retry.
  const fuzzyMatch = text.match(/\b([A-Za-z]{5,10})\s+(\d{1,2})[,]?\s*(\d{4})\b/);
  if (fuzzyMatch) {
    const corrected = closestMonth(fuzzyMatch[1]);
    if (corrected) return tryParseDate(`${corrected} ${fuzzyMatch[2]}, ${fuzzyMatch[3]}`);
  }
  return undefined;
}

function extractAmount(text: string): string | undefined {
  const numFragment = "(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";
  const patterns = [
    // "TOTAL" is frequently dropped by table-cell OCR, so "GRAND" alone is
    // still treated as the strongest signal — nothing else on an invoice is
    // reasonably labeled just "grand".
    new RegExp(`grand(?:\\s*total)?[\\s\\S]{0,20}?${numFragment}`, "i"),
    new RegExp(`net\\s*(?:payable|amount)[\\s\\S]{0,20}?${numFragment}`, "i"),
    new RegExp(`\\btotal\\b[\\s\\S]{0,20}?${numFragment}`, "i"),
    new RegExp(`amount[\\s\\S]{0,20}?${numFragment}`, "i"),
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) return match[1].replace(/,/g, "");
  }
  return undefined;
}

export function parseInvoiceFields(ocrText: string): SuggestedInvoiceFields {
  if (!ocrText?.trim()) return {};
  const lines = ocrText.split(/\r?\n/);
  return {
    vendorName: extractVendorName(lines),
    vendorGstin: extractGstin(ocrText),
    invoiceNumber: extractInvoiceNumber(ocrText),
    invoiceDate: extractInvoiceDate(ocrText),
    amount: extractAmount(ocrText),
  };
}
