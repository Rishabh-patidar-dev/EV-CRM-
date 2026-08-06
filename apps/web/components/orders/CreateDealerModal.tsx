"use client";

// Manual application entry for the onboarding pipeline — the manufacturer's
// Network Expansion team creating an application on behalf of a walk-in or
// phone applicant, instead of waiting for the landing page. Lands at Stage 1
// (APPLICATION) with the same document checklist a real webhook hit gets.
import { useState } from "react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";

const FIELDS: { key: string; label: string; required?: boolean; placeholder?: string }[] = [
  { key: "contactName", label: "Contact name", required: true, placeholder: "Primary contact" },
  { key: "legalName", label: "Registered business name", required: true, placeholder: "EV Motors Pvt Ltd" },
  { key: "tradeName", label: "Trade / brand name", placeholder: "Optional" },
  { key: "email", label: "Email", required: true, placeholder: "contact@company.com" },
  { key: "phone", label: "Mobile", placeholder: "9876543210" },
  { key: "gstin", label: "GSTIN", placeholder: "Optional" },
  { key: "pan", label: "PAN", placeholder: "Optional" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "Pincode" },
];

const empty = Object.fromEntries(FIELDS.map((f) => [f.key, ""])) as Record<string, string>;

export default function CreateDealerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError(null);
    const missing = FIELDS.filter((f) => f.required && !form[f.key].trim());
    if (missing.length) return setError(`${missing[0].label} is required`);

    setSubmitting(true);
    try {
      await apiClient.post("/api/v1/onboarding/applications", form);
      onCreated();
      setForm(empty);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not create the application. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { setForm(empty); onClose(); }} title="Create dealer application" width="max-w-lg">
      <div className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.key === "legalName" || f.key === "contactName" ? "col-span-2" : ""}>
              <label className="mb-1.5 block text-sm font-medium">
                {f.label} {f.required && <span style={{ color: "var(--destructive)" }}>*</span>}
              </label>
              <input
                value={form[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Lands at Stage 1 (Application &amp; E-KYC) with the standard document checklist, same as a landing-page submission.
        </p>

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create application"}
        </button>
      </div>
    </Modal>
  );
}
