"use client";

// Route: /campaign-management/email
import CampaignListView from "@/components/campaigns/CampaignListView";

export default function EmailCampaignsPage() {
  return (
    <CampaignListView
      channel="EMAIL"
      title="Email Campaigns"
      subtitle="Compose and track outbound email to a lead segment. Sending isn't wired to a live provider in this scaffold — no SMTP is connected."
    />
  );
}
