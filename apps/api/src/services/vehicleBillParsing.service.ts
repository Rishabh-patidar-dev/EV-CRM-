// Best-effort, free/offline heuristic extraction of per-vehicle rows (VIN +
// model guess) from a vehicle purchase bill's OCR text — same
// "pattern-matching, not real understanding" contract as
// invoiceParsing.service.ts / sparePartsBillParsing.service.ts. A VIN is the
// one token on a vehicle bill that's actually machine-detectable with
// confidence (17-char alphanumeric, standard charset excluding I/O/Q); the
// model is a soft guess from nearby text matched against the real catalog,
// left blank for the dealer to pick themselves when nothing matches. Every
// row is a suggestion reviewed/edited before confirming — never auto-added.
import { VEHICLE_CATALOG } from "./dealerManagement.service.js";

export interface SuggestedVehicleLine {
  vin: string;
  model: string;
  segment: string;
}

// VIN charset excludes I, O, Q (easily confused with 1/0) on every real VIN.
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

export function parseVehicleBillLineItems(ocrText: string): SuggestedVehicleLine[] {
  if (!ocrText?.trim()) return [];
  const lines = ocrText.split(/\r?\n/);
  const items: SuggestedVehicleLine[] = [];
  const seen = new Set<string>();

  outer: for (let i = 0; i < lines.length; i++) {
    const vins = lines[i].match(VIN_RE);
    if (!vins) continue;
    for (const vinRaw of vins) {
      const vin = vinRaw.toUpperCase();
      if (seen.has(vin)) continue;
      seen.add(vin);

      // A bill layout often puts the model name on its own line next to the
      // VIN rather than sharing one line with it — widen the search to the
      // line immediately before/after.
      const context = [lines[i - 1], lines[i], lines[i + 1]].filter(Boolean).join(" ").toLowerCase();
      const match = VEHICLE_CATALOG.find((c) => context.includes(c.model.toLowerCase()));

      items.push({ vin, model: match?.model ?? "", segment: match?.segment ?? "" });
      if (items.length >= 30) break outer;
    }
  }

  return items;
}
