// Minimal validation helpers used by the ingest webhook. Mirrors the shape
// of the equivalent module already present in innocrm-staging.

export function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Expects an already-normalised 10-digit Indian mobile number. */
export function isValidPhone(phone?: string | null): boolean {
  if (!phone) return false;
  return /^[6-9]\d{9}$/.test(phone.trim());
}

export function isValidName(name?: string | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

export function isValidPincode(pincode?: string | null): boolean {
  if (!pincode) return false;
  return /^\d{6}$/.test(pincode.trim());
}
