// Ported from innocrm-staging's apps/api/src/services/leadScoring.service.ts
// verbatim scoring formula: completeness (7 fields tracked, ~14.3pts each)
// weighted 0.7 + quality (starts at 100, -10 per malformed email/phone)
// weighted 0.3. Only the imports changed (local validators, no nameHelpers
// dependency — the caller passes a pre-joined `name`).
import { isValidEmail, isValidPhone } from "../utils/validators.js";

export interface LeadScoreInput {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface LeadScoreResult {
  totalScore: number;
  completenessScore: number;
  qualityScore: number;
  missingFields: string[];
  invalidFields: string[];
}

export class LeadScoringService {
  calculateLeadScore(lead: LeadScoreInput): LeadScoreResult {
    const fields = {
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      companyName: lead.companyName || "",
      city: lead.city || "",
      state: lead.state || "",
      pincode: lead.pincode || "",
    };

    let completenessScore = 0;
    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    // Completeness: ~14.3 points per present field (7 fields => ~100 max).
    for (const [field, value] of Object.entries(fields)) {
      if (value && value.trim() !== "") {
        completenessScore += 14.3;
      } else {
        missingFields.push(field);
      }
    }

    // Quality: starts at 100, -10 per malformed email/phone.
    let qualityScore = 100;
    if (fields.email && !isValidEmail(fields.email)) {
      qualityScore -= 10;
      invalidFields.push("email");
    }
    if (fields.phone && !isValidPhone(fields.phone)) {
      qualityScore -= 10;
      invalidFields.push("phone");
    }
    qualityScore = Math.max(0, qualityScore);

    const totalScore = Math.round(completenessScore * 0.7 + qualityScore * 0.3);

    return { totalScore, completenessScore: Math.round(completenessScore), qualityScore, missingFields, invalidFields };
  }
}
