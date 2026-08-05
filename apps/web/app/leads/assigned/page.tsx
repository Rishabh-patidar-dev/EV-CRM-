"use client";

// Route: /leads/assigned — leads that already have an owner.
import LeadListView from "@/components/leads/LeadListView";

export default function AssignedLeadsPage() {
  return (
    <LeadListView
      mode="assigned"
      title="Assigned Leads"
      subtitle="Leads already claimed or assigned to a rep — being worked right now."
    />
  );
}
