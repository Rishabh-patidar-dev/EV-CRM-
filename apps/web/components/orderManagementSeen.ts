// Shared localStorage key for the Order Management "new DMS order" sidebar
// indicator (components/Sidebar.tsx) and the page that clears it
// (app/(dashboard)/order-management/page.tsx). No new schema field, no
// per-staff-user server tracking — this is a single-shared-browser "have I
// looked at the list since the last DMS order came in" marker, consistent
// with there being no other viewed/seen tracking anywhere in this app.
export const ORDER_MGMT_LAST_SEEN_KEY = "orderMgmt:lastSeenAt";
