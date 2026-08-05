"use client";

// Route: /campaign-management/whatsapp
import CampaignListView from "@/components/campaigns/CampaignListView";

export default function WhatsAppCampaignsPage() {
  return (
    <CampaignListView
      channel="WHATSAPP"
      title="WhatsApp Campaigns"
      subtitle="Compose and track outbound WhatsApp messages to a lead segment. Sending isn't wired to a live provider in this scaffold — no WhatsApp Business API is connected."
    />
  );
}
