import React from "react";

// One canonical status badge — replaces the four near-duplicate local
// Badge/OrderStatusBadge functions that had drifted (different font sizes,
// some hand-typing bg-[color:var(--zira-approved)]/15 inline instead of the
// .badge-approved class). Tone is passed explicitly by the caller — each
// page still owns its own status→tone mapping (that's domain logic: what
// counts as "approved" differs per status enum), this component only
// standardizes how a tone actually renders.
export type BadgeTone = "approved" | "pending" | "rejected" | "info" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  approved: "badge-approved",
  pending: "badge-pending",
  rejected: "badge-rejected",
  info: "badge-info",
  neutral: "bg-muted text-muted-foreground",
};

// App-wide label overrides for raw enum values that read better as a
// friendlier word than a title-cased status — e.g. DocumentStatus.VERIFIED
// displays as "Approved" everywhere, without renaming the enum itself.
const STATUS_LABEL: Record<string, string> = {
  VERIFIED: "Approved",
};

function humanize(status: string): string {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function Badge({
  status,
  tone = "neutral",
  label,
  className = "",
}: {
  status?: string;
  tone?: BadgeTone;
  label?: string;
  className?: string;
}) {
  const text = label ?? (status ? humanize(status) : "");
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}>
      {text}
    </span>
  );
}
