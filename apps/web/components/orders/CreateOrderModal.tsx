"use client";

// Manual order entry for the manufacturer side — the order desk normally
// only sees orders dealers raise themselves; this is the "create on their
// behalf" path (phone order, correction, etc.). Posts straight to the same
// endpoints the dealer-side flow uses (stock-transfers / spare-parts), so
// the resulting order behaves identically either way.
import { useEffect, useState } from "react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";

interface DealerOption {
  id: number;
  legalName: string;
  tradeName: string | null;
}

const SEGMENTS = ["L5", "L3", "CUSTOMISED"];

export default function CreateOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<"VEHICLE" | "SPARE_PART">("VEHICLE");
  const [dealers, setDealers] = useState<DealerOption[]>([]);
  const [dealerId, setDealerId] = useState("");
  const [model, setModel] = useState("");
  const [segment, setSegment] = useState(SEGMENTS[0]);
  const [partName, setPartName] = useState("");
  const [partCode, setPartCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    apiClient.get("/api/v1/dealers", { params: { limit: 100 } }).then((res) => {
      setDealers(res.data.dealers ?? res.data.data ?? []);
    }).catch(() => {});
  }, [open]);

  function reset() {
    setType("VEHICLE");
    setDealerId("");
    setModel("");
    setSegment(SEGMENTS[0]);
    setPartName("");
    setPartCode("");
    setQuantity(1);
    setNotes("");
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!dealerId) return setError("Choose a dealer");
    if (type === "VEHICLE" && !model.trim()) return setError("Enter a model");
    if (type === "SPARE_PART" && !partName.trim()) return setError("Enter a part name");

    setSubmitting(true);
    try {
      if (type === "VEHICLE") {
        await apiClient.post("/api/v1/stock-transfers", { dealerId, model: model.trim(), segment, quantity, notes: notes.trim() || undefined });
      } else {
        await apiClient.post("/api/v1/spare-parts", { dealerId, partName: partName.trim(), partCode: partCode.trim() || undefined, quantity });
      }
      onCreated();
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not create the order. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Create order">
      <div className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}>
            {error}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Order type</label>
          <div className="flex rounded-[var(--radius)] border" style={{ borderColor: "var(--border)" }}>
            {(["VEHICLE", "SPARE_PART"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className="flex-1 py-2 text-sm font-medium transition-colors"
                style={type === t ? { backgroundColor: "var(--primary)", color: "var(--primary-foreground)" } : undefined}
              >
                {t === "VEHICLE" ? "Vehicle stock" : "Spare part"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Dealer</label>
          <select value={dealerId} onChange={(e) => setDealerId(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <option value="">Select a dealer…</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>
            ))}
          </select>
        </div>

        {type === "VEHICLE" ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Model</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Volt E2" className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Segment</label>
              <select value={segment} onChange={(e) => setSegment(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Part name</label>
              <input value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="e.g. Front brake pad set" className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Part code (optional)</label>
              <input value={partCode} onChange={(e) => setPartCode(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
          </>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Quantity</label>
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>

        {type === "VEHICLE" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create order"}
        </button>
      </div>
    </Modal>
  );
}
