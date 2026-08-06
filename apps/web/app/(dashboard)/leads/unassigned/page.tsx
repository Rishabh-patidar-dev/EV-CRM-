"use client";

// Route: /leads/unassigned — the shared claim queue (no owner yet).
import LeadListView from "@/components/leads/LeadListView";

export default function UnassignedLeadsPage() {
  return (
    <LeadListView
      mode="unassigned"
      title="Unassigned Leads"
      subtitle="Nobody's claimed these yet — first come, first served from this queue."
    />
  );
}
