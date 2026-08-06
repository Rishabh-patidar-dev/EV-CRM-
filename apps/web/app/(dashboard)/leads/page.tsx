"use client";

// Route: /leads — "Lead Master": every lead, unfiltered by ownership.
import LeadListView from "@/components/leads/LeadListView";

export default function LeadMasterPage() {
  return (
    <LeadListView
      mode="all"
      title="Lead Master"
      subtitle="Every retail enquiry — from the landing page and manual entry — scored, assigned, and worked to a sale."
    />
  );
}
