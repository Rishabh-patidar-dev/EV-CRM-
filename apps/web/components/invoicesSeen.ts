// Shared localStorage key for the Invoices sidebar "unread" badge
// (components/Sidebar.tsx) and the page that clears it
// (app/(dashboard)/order-management/invoices/page.tsx). Same pattern as
// orderManagementSeen.ts's ORDER_MGMT_LAST_SEEN_KEY — no schema field, no
// per-staff-user server tracking, single-shared-browser "have I opened the
// Invoices list since this invoice was issued" marker.
export const INVOICE_LAST_SEEN_KEY = "invoices:lastSeenAt";
