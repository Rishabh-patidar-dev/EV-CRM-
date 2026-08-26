// Best-effort, free/offline heuristic extraction of PER-LINE-ITEM rows (part
// name + quantity + unit price) from a spare-parts purchase bill's OCR text —
// same "pattern-matching, not real understanding" contract as
// invoiceParsing.service.ts's flat-field extractor, just applied per table
// row instead of once for the whole document. Every row is a suggestion the
// dealer reviews/edits/deletes before confirming — never auto-submitted.

export interface SuggestedLineItem {
  partName: string;
  quantity: number;
  unitPrice: string;
}

const SKIP_LINE_RE =
  /\b(invoice|gstin|gst\s*no|bill(ed)?\s*to|ship\s*to|customer|sub\s*total|subtotal|grand\s*total|total\s*amount|\btotal\b|\btax\b|cgst|sgst|igst|amount\s*in\s*words|terms|signature|thank\s*you|place\s*of\s*supply|declaration|bank\s*details|hsn\s*code|description|particulars|sr\.?\s*no\.?|s\.?\s*no\.?)\b/i;

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b/i;
const NUM_RE = /\d[\d,]*(?:\.\d{1,2})?/g;
const UNIT_WORD_RE = /\b(qty|quantity|pcs|nos|units?|rate|price|amount|rs\.?|inr|₹|x)\b/gi;

function cleanLine(line: string): string {
  return line.replace(/[|_~]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

export function parseSparePartLineItems(ocrText: string): SuggestedLineItem[] {
  if (!ocrText?.trim()) return [];
  const lines = ocrText.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const items: SuggestedLineItem[] = [];

  for (const line of lines) {
    if (SKIP_LINE_RE.test(line) || GSTIN_RE.test(line)) continue;

    const nums = line.match(NUM_RE);
    if (!nums || nums.length < 2) continue;
    // A long digit run (phone number, GSTIN fragment, date-as-one-token)
    // would badly skew the read as a price — bail on lines carrying one.
    if (/\d{10,}/.test(line.replace(/[.,]/g, ""))) continue;

    const values = nums.map(toNumber);
    let quantity: number;
    let unitPrice: number;
    if (values.length >= 3) {
      // Sr/Qty/Rate/Amount-style row — take the middle two as qty & rate,
      // ignoring a leading serial number and a trailing computed amount.
      quantity = values[values.length - 3];
      unitPrice = values[values.length - 2];
    } else {
      [quantity, unitPrice] = values;
    }

    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue;
    quantity = Math.round(quantity);
    if (quantity < 1 || quantity > 10000) continue;
    if (unitPrice < 0 || unitPrice > 10_000_000) continue;

    // Item name = the line with every numeric token and stray unit-word
    // stripped off the tail.
    let name = line;
    for (const n of nums) name = name.replace(n, " ");
    name = name.replace(UNIT_WORD_RE, " ").replace(/[^\w\s.\-]/g, " ").replace(/\s{2,}/g, " ").trim();
    name = name.replace(/^\W+|\W+$/g, "");

    if (name.length < 3 || /^\d+$/.test(name)) continue;

    items.push({ partName: name.slice(0, 120), quantity, unitPrice: String(unitPrice) });
    if (items.length >= 30) break;
  }

  return items;
}
