"use client";

// ============================================================================
// Warranty claim detail (full page)
// ============================================================================
// Route: /warranty/claims/[id]
// Was a 440px side panel on the Claims tab; moved to its own full-width page
// so the adjudication trail, action buttons and the status timeline can sit
// side by side instead of stacked in a narrow column.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, AlertTriangle, ChevronRight, Battery, PackageSearch, Loader2 } from "lucide-react";
import apiClient from "@/lib/api/client";
import { AttachmentUpload } from "@/components/ui/AttachmentUpload";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

function claimStatusTone(status: string): BadgeTone {
  if (status === "APPROVED" || status === "REIMBURSED") return "approved";
  if (status === "REJECTED") return "rejected";
  if (status === "SUBMITTED" || status === "CLOSED") return "neutral";
  return "pending"; // UNDER_REVIEW, INFO_REQUESTED, IN_REPAIR, RECOVERY
}

const NEXT_STATUS: Record<string, string[]> = {
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  INFO_REQUESTED: ["UNDER_REVIEW"],
  APPROVED: ["IN_REPAIR"],
  IN_REPAIR: ["REIMBURSED"],
  REIMBURSED: ["CLOSED"],
  RECOVERY: ["CLOSED"],
};

export default function ClaimDetailPage() {
  const params = useParams();
  const claimId = Number(params.id);

  const [claim, setClaim] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvedAmount, setApprovedAmount] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [recoverySupplier, setRecoverySupplier] = useState("");
  const [recoveryAmount, setRecoveryAmount] = useState("");

  const load = useCallback(async () => {
    const { data } = await apiClient.get(`/api/v1/warranty-claims/${claimId}`);
    setClaim(data);
  }, [claimId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const setStatus = async (status: string, extra: Record<string, any> = {}) => {
    await apiClient.post(`/api/v1/warranty-claims/${claimId}/status`, { status, ...extra });
    await load();
  };

  const openRecovery = async () => {
    if (!recoverySupplier || !recoveryAmount) return;
    await apiClient.post(`/api/v1/warranty-claims/${claimId}/supplier-recovery`, {
      supplierName: recoverySupplier,
      componentType: claim.componentUnit?.componentType ?? "BATTERY",
      amount: Number(recoveryAmount),
    });
    await setStatus("RECOVERY");
  };

  if (loading || !claim) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading claim…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <Link href="/warranty" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to warranty claims
      </Link>

      {/* Header */}
      <Card className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="font-mono text-xl font-semibold tracking-tight">{claim.claimNumber}</h1>
            <Badge status={claim.status} tone={claimStatusTone(claim.status)} />
          </div>
          <p className="mt-2 text-sm">{claim.customerName}{claim.customerPhone ? ` · ${claim.customerPhone}` : ""}</p>
          <p className="text-sm text-muted-foreground">{claim.issueDescription}</p>
          {claim.componentUnit && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Battery className="h-3.5 w-3.5" /> <span className="font-mono">{claim.componentUnit.serialNumber}</span> ({claim.componentUnit.componentType})
            </div>
          )}
        </div>

        <div className="flex gap-3 text-sm">
          <div className="rounded-[var(--radius)] border border-border px-4 py-2.5 text-center">
            <div className="text-lg font-semibold">₹{Number(claim.claimAmount ?? 0).toLocaleString("en-IN")}</div>
            <div className="text-xs text-muted-foreground">Claimed</div>
          </div>
          <div className="rounded-[var(--radius)] border border-border px-4 py-2.5 text-center">
            <div className="text-lg font-semibold">₹{Number(claim.approvedAmount ?? 0).toLocaleString("en-IN")}</div>
            <div className="text-xs text-muted-foreground">Approved</div>
          </div>
        </div>
      </Card>

      {/* Body: adjudication + actions (wide) + timeline (narrow). items-start
          keeps each column sized to its own content instead of stretching
          the narrow timeline to match a taller main column. */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {claim.adjudicationNotes && (
            <Card>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" /> Adjudication
              </div>
              <p className="text-sm leading-relaxed">{claim.adjudicationNotes}</p>
              {claim.voidReason && <p className="mt-2 text-sm font-medium text-[color:var(--zira-rejected)]">Void: {claim.voidReason}</p>}
            </Card>
          )}

          <Card>
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</div>
            {claim.status === "UNDER_REVIEW" && (
              <div className="max-w-md space-y-2">
                <input placeholder="Approved amount" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setStatus("APPROVED", { approvedAmount: approvedAmount ? Number(approvedAmount) : claim.claimAmount })}>Approve</Button>
                  <Button variant="secondary" className="flex-1" onClick={() => setStatus("REJECTED", { rejectionReason: rejectionReason || "Manual review rejection" })}>Reject</Button>
                </div>
                <input placeholder="Rejection reason (if rejecting)" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
              </div>
            )}
            {claim.status !== "UNDER_REVIEW" && (NEXT_STATUS[claim.status]?.length ?? 0) > 0 && (
              <div className="flex max-w-md flex-wrap gap-2">
                {NEXT_STATUS[claim.status]?.map((s) => (
                  <Button key={s} onClick={() => setStatus(s)}>
                    Mark {s.replace("_", " ").toLowerCase()} <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                ))}
              </div>
            )}
            {claim.status !== "UNDER_REVIEW" && !(NEXT_STATUS[claim.status]?.length) && (
              <p className="text-sm text-muted-foreground">No further action pending on this claim.</p>
            )}
          </Card>

          {claim.status === "REIMBURSED" && !claim.supplierRecovery && (
            <div className="max-w-md rounded-[var(--radius)] border border-dashed border-border bg-card p-5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Open supplier recovery?</div>
              <input placeholder="Supplier name" value={recoverySupplier} onChange={(e) => setRecoverySupplier(e.target.value)} className="mb-2 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
              <input placeholder="Recovery amount" value={recoveryAmount} onChange={(e) => setRecoveryAmount(e.target.value)} className="mb-2 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
              <Button variant="secondary" className="w-full" onClick={openRecovery}>Open recovery case</Button>
            </div>
          )}

          <AttachmentUpload basePath={`/api/v1/warranty-claims/${claimId}`} />
        </div>

        <aside className="card-elevated sticky top-6 p-5">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</div>
          <ol className="space-y-3">
            {(claim.events ?? []).map((e: any) => (
              <li key={e.id} className="text-sm">
                <div className="font-medium">{e.fromStatus ? `${e.fromStatus} → ` : ""}{e.toStatus}</div>
                {e.note && <div className="text-muted-foreground">{e.note}</div>}
                <div className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</div>
              </li>
            ))}
            {(claim.events ?? []).length === 0 && <li className="text-xs text-muted-foreground">No events logged yet.</li>}
          </ol>
        </aside>
      </div>
    </div>
  );
}
