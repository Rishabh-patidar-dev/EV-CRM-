# EV Vikas — module guide

One page per submodule, answering the same three questions for each:

1. **How does this module work?** — the data it's built on and the actions you can take in it.
2. **What do the BI graphs explain?** (only where the module has charts — several are plain lists/tables by design, and that's called out explicitly rather than skipped).
3. **What problem does this submodule solve?** — why it exists, in terms of the CRM's actual job: running an EV dealer network end to end (lead → dealer → stock → warranty).

Every chart in this app is hand-rolled SVG (no charting library) reading live from the same Postgres tables the rest of the module uses — there is no separate analytics pipeline or stale snapshot to keep in sync.

---

## Dashboard (`/`)

**How does this module work?**
It's a read-only landing page — no forms, no actions. On load it fires five parallel requests (dealer stats, onboarding board, compliance summary, lead stats, warranty pipeline) and renders whatever comes back; if one call fails the others still render (`Promise.allSettled`), so one flaky module never blanks the whole page. Below the charts, a card per submodule links straight into it.

**What do the BI graphs explain?**
- *Leads by status* (donut) — how much of the pipeline is Open/Working vs. already Qualified/Converted vs. dead (Unqualified/Nurturing). A donut because status is identity, not magnitude — you're asking "what mix," not "how much."
- *Dealer network by status* (donut) — how many dealers are Active vs. still Onboarding vs. On Hold/Suspended/Terminated.
- *Warranty claims by status* (donut) — where the claim pipeline's weight sits: still being adjudicated, approved and in repair, or closed out.
- *Dealers by state* (bar) — which states actually have network presence, ranked. A bar because this is magnitude across a category with no natural "whole" to slice into a donut.
- *Onboarding pipeline by stage* (bar) — where applicants are bottlenecked across the 8-stage pipeline.

**What problem does this submodule solve?**
It's the "how's the network doing right now" screen — one page that answers "where's the lead pipeline," "how healthy is the dealer network," "is anything expiring," and "what's the warranty caseload," without opening five separate modules. It exists because nobody should have to click into Leads, then Dealer Management, then Compliance, then Warranty just to get a pulse check.

---

## Lead Management — Lead Master, Assigned, Unassigned & Campaigns (`/leads`, `/leads/assigned`, `/leads/unassigned`, `/landing-page-campaigns`)

**How does this module work?**
Every retail enquiry — from the public landing-page webhook or entered by hand — becomes a `Lead` with an auto-computed score (completeness × 0.7 + quality × 0.3, recomputed on every edit). Leads move through `OPEN → WORKING → QUALIFIED → CONVERTED`, with `UNQUALIFIED`/`NURTURING` side branches. The sidebar group has four entries over the same data: **Lead Master** (every lead, unfiltered — also the only place to create a lead or import a CSV), **Assigned Leads** (`?assigned=true` — leads a rep already owns), **Unassigned Leads** (`?unassigned=true` — the shared claim queue), and **Campaigns** (the landing-page/webhook contract, covered below). All three list views share one component and one detail page; clicking any lead opens its own full page — score breakdown, status buttons, owner reassignment, a remarks/activity log, and — because in this CRM a lead can *be* a potential dealer, not just a buyer — a one-click "convert to dealer application" action that seeds a `DealerApplication` and links back to the originating lead.

Campaigns (`/landing-page-campaigns`): each campaign is just a `uniqueId` plus metadata (name, status, optional GTM container). The external landing page sends that ID back as `landing_page_campaign_id` on every submission to `POST /api/v1/ingest/landing-page` — that's the entire integration contract. Clicking a campaign opens its detail page with the copyable webhook ID, the GTM container ID (if set), the `window.dataLayer` push contract, and its attributed enquiries/dealer applications.

**What do the BI graphs explain?**
None on the lead list pages or Campaigns — the KPI row (total, unassigned, average score, qualified count) is the numeric readout on the lead views; Campaigns' enquiry/application counts are exact tallies (`_count` from the database), not aggregated figures. The cross-lead "leads by status" donut lives on the Dashboard, not duplicated here.

**What problem does this submodule solve?**
It's the single intake point for every retail enquiry, regardless of source (landing page, CSV import, manual entry), so nothing gets worked from a spreadsheet or someone's inbox instead of the CRM. Splitting Lead Master / Assigned / Unassigned into their own views (instead of one list with a checkbox) matches how a lead team actually works: "show me my queue" and "show me what's unclaimed" are different daily questions, not the same screen with a filter toggled. The score exists so reps triage by likelihood-to-convert instead of first-in-first-out. The dealer-conversion path exists because a decent fraction of "buyer" enquiries turn out to be fleet operators asking about becoming a dealer — this CRM treats that as a first-class path, not a manual re-entry. Campaigns exists because whoever builds the external landing page needs to know *one thing* — which unique ID to send back — and this is where that ID lives and gets confirmed as actually producing leads.

---

## Dealer Onboarding (`/dealer-onboarding`)

**How does this module work?**
A `DealerApplication` moves forward-only through a 5-stage pipeline (Application → Screening & NDA → Business Proposal → Due Diligence → Legal Agreement), then OPERATIONAL once appointed as a live dealer. Stage 5, Legal Agreement, is where the Letter of Intent (LOI) is issued to the applicant, alongside the dealer agreement and security deposit — everything after that (facility fit-out, staff training, go-live checks) happens outside this tracked pipeline. Each stage has its own required-document checklist, seeded automatically when the application enters that stage; a stage can only be cleared once every required document is `VERIFIED` (the advance endpoint returns a 409 with the blocking documents otherwise). Every transition is written to an append-only stage-event log. The board shows stage columns with live counts; clicking an application opens its own full-width page with every stage's document checklist (not just the current one) next to the transition timeline, so you can see the whole history in one place.

**What do the BI graphs explain?**
No charts on this page itself — the stage-count strip across the top of the board is the numeric readout (how many applications sit in each of the 5 stages right now). The equivalent bar chart ("onboarding pipeline by stage") lives on the Overview dashboard.

**What problem does this submodule solve?**
Appointing a dealer is a real compliance/legal process (NDA, financial due diligence, a signed dealer agreement, statutory NOCs, HV-safety training) — this module is the audit trail proving each of those steps actually happened, with a specific document, verified by a specific person, at a specific stage, instead of "trust me, we checked."

---

## Dealer 360 / Dealer Management (`/dealer-management`)

**How does this module work?**
The operational record for every *appointed* dealer (as opposed to Onboarding, which is for applicants). The list is filterable by state/tier/status; each dealer opens its own full-width detail page: this-month attainment (units sold vs. target, lead-conversion %), assigned territory, and — the OEM↔dealer communication layer — every vehicle-stock order and spare-part order this dealer has raised, each with a one-click "advance to next status" action, plus the vehicle units currently allocated to them and their recent service tickets.

**What do the BI graphs explain?**
No charts on the detail page — deliberately. A dealer only has one data point per metric per month (this month's attainment), so a trend chart would either be empty or fabricated; the attainment figures are shown as plain numbers with a "% of target" readout instead. Cross-dealer aggregates (which zones order the most, etc.) live in Order Management and Vehicle Inventory, not duplicated here.

**What problem does this submodule solve?**
"How healthy is this dealer, right now" used to mean checking four separate places (targets, territory, open orders, service load). This is the one screen — and specifically, it's where the manufacturer actually *acts* on a dealer's order (approve it, mark it dispatched) instead of just viewing it, which is what "communication between dealer and OEM" concretely means in this CRM.

---

## Vehicle Inventory (`/dealer-inventory`)

**How does this module work?**
Every physical vehicle is a `VehicleUnit` tracked by VIN from OEM warehouse stock through allocation to a dealer, demo-fleet duty, or sale. Dealers raise `StockTransferRequest`s against their own credit to pull more stock; the OEM side moves each request through Requested → Approved → Dispatched → Deliver — and Deliver is the step that actually reassigns the specific VINs to that dealer. The page has the unit table, the transfer-request queue, and forms to register a new unit or raise a request.

**What do the BI graphs explain?**
- *Live stock by model* (donut) — which vehicle models currently make up the network's active stock (allocated + in-stock + demo, excluding sold units) — "what do we actually have on the ground."
- *Dealer stock orders by zone* (bar) — total quantity ordered per state, ranked — "which zones are pulling the most stock."
- *Most-ordered model, by zone* (ranked list) — for each zone, the single vehicle model it orders the most of, with the quantity. This is the direct answer to "what's each region's demand skewed toward" — a state showing "Rajasthan → Vikas Lifter → 2" means Rajasthan's stock requests have been dominated by that one model.

**What problem does this submodule solve?**
Two things at once: it's the VIN-level source of truth for "what can this dealer actually sell today" (not a guess from a spreadsheet), and it's the demand signal for the OEM — which models are moving, and where — derived from real stock-transfer requests, not a forecast.

---

## Order Management (`/order-management`)

**How does this module work?**
The manufacturer-wide counterpart to the order list on a single Dealer 360 page: every `StockTransferRequest` (vehicle stock) and `SparePartRequest` (spare parts) across *every* dealer, merged into one combined, filterable list (by zone, order type, status), each with the same one-click status-advance action. No new order type or tracking was added — this is purely an aggregation view over the two order tables that already exist, computed straight from their `createdAt`/`status`/`dealerId` fields.

**What do the BI graphs explain?**
- *Weekly order volume* (bar) — combined order count for each of the last 8 weeks — is demand rising, flat, or falling.
- *Orders by type* (donut) — the split between vehicle-stock orders and spare-part orders, network-wide.
- *Orders by zone* (bar) — total order volume (vehicle + spare parts combined, by quantity) per state, ranked — which regions are generating the most order traffic overall.
- *Orders by status* (donut) — how much of the network's order volume is still open (Requested/Approved/Dispatched) vs. resolved (Delivered/Rejected/Cancelled).
- *Top dealers by order volume* (bar) — which specific dealers, not just which zones, drive the most order traffic — demand can be concentrated in one or two accounts within an otherwise quiet zone, and the zone chart alone can't show that.
- *Fulfillment rate by zone* (target-bar) — of every order that reached a final state (Delivered/Rejected/Cancelled), what share actually got Delivered — a zone with orders but poor fulfillment is a different problem than a quiet zone.
- *Oldest open orders* (ranked list) — the specific orders that have sat in Requested/Approved/Dispatched the longest, flagged past 7 days — the queue an order desk actually works from, not just an aggregate.
- *Most-ordered vehicle model, by zone* and *most-ordered spare part, by zone* (ranked lists) — the same "what does each region want most" question Vehicle Inventory answers for vehicles, extended to spare parts too.

**What problem does this submodule solve?**
Before this module, seeing "which zone orders the most of what" meant opening every dealer's page one at a time, and there was no way to see whether the network's order backlog was aging or whether fulfillment was actually keeping up with demand. This is the manufacturer's order desk: one screen for network-wide demand, order aging, dealer concentration, and delivery performance, with the ability to action any order directly.

*Deliberately not included:* order value/revenue — neither `StockTransferRequest` nor `SparePartRequest` tracks a unit price, so a "value ordered" figure would be fabricated. Adding pricing to those models is the natural next step if that number is wanted.

---

## Purchase Management (`/purchase-management`)

**How does this module work?**
Distinct from Order Management (dealer → OEM orders): this is the manufacturer's *own* procurement — a `VehiclePurchaseOrder` per batch bought from a manufacturing plant or import source, with a supplier name, model, quantity, unit cost, and a status (`ORDERED → IN_TRANSIT → RECEIVED`, or `CANCELLED`). Marking a PO Received sets its received date and is what counts it as "imported." The "sold" side of the module isn't a separate record — it's read directly from `VehicleUnit.status = SOLD`, the real sales data Vehicle Inventory already keeps, so imported-vs-sold is a genuine cross-reference between two real tables, not two halves of one invented number.

**What do the BI graphs explain?**
- *Imported by model* (donut) — units received into stock, by model, from Received purchase orders only (not Ordered/In Transit — those haven't landed yet).
- *Sold by model* (donut) — units marked Sold in Vehicle Inventory, by model — placed right next to "Imported by model" so the two are easy to compare model-for-model.
- *Purchase order status* (donut) — where every PO currently sits (Ordered/In Transit/Received/Cancelled) — the procurement pipeline itself.
- The KPI row's *net stock movement* (received − sold) and *spend on received stock* (Σ quantity × unit cost, Received orders only) are the two headline numbers a procurement view needs.

**What problem does this submodule solve?**
Vehicle Inventory tracks what's on the ground and Order Management tracks what dealers are asking for, but neither answers "are we buying enough to keep up with what's selling" — that's a manufacturer-side procurement question, not a dealer-facing one. This module is where the OEM places and tracks its own purchase orders and can see, at a glance, whether inbound supply is running ahead of or behind actual sales.

*Deliberately not included:* Received purchase orders don't automatically create matching `VehicleUnit` rows yet — a PO tracks the batch, not individual VINs. Wiring "mark Received" to bulk-create serialized units is the natural next step, not built here, so the two stay honestly separate rather than half-linked.

---

## AI Insights (`/ai-insights`)

**How does this module work?**
It doesn't, yet — the sidebar entry has a red dot marking it "under development" on purpose, and the page itself is a placeholder with no data or actions. Listed here only so the module inventory in this doc stays complete.

---

## Compliance & Renewals (`/dealer-compliance`)

**How does this module work?**
Every dealer's statutory paperwork — dealer agreement, trade license, GST certificate, insurance policy, fire/pollution NOCs — as a `DealerComplianceRecord` with an issue date and an expiry date. Status (`VALID` / `EXPIRING_SOON` / `EXPIRED` / `MISSING`) isn't stored — it's recomputed from the expiry date on every load, so it's never stale. Each record has a one-click renewal reminder.

**What do the BI graphs explain?**
No charts — this is a status-list module. The summary counts (how many valid/expiring/expired/missing) feed the Dashboard's "compliance alerts" warning banner rather than a chart of their own, because a bar or donut of four largely-fixed categories wouldn't say more than the count itself.

**What problem does this submodule solve?**
A dealer operating on an expired trade license or lapsed insurance is a real legal liability for the manufacturer, not just an inconvenience. This module turns "did anyone check" into a computed, always-current answer instead of a periodic manual audit.

---

## Warranty Management (`/warranty`)

**How does this module work?**
The centrepiece module, built to `DMS-and-Warranty-Research.pdf`'s Phase-1 spec. Four pieces: `WarrantyPlan` (policy per model+component — term months/km, SoH floor, approved chargers), `ComponentUnit` (the serial registry — which exact battery/motor/controller is fitted to which chassis), a claim state machine (`SUBMITTED → UNDER_REVIEW/INFO_REQUESTED → APPROVED → IN_REPAIR → REIMBURSED → RECOVERY → CLOSED`, or `REJECTED`), and `SupplierRecovery` for when a reimbursed claim turns out to be a supplier's manufacturing defect. A rules engine (`warrantyAdjudication.service.ts`) checks every new claim against time term, distance term, SoH floor, approved-charger use, service-record completeness and duplicate-claim status, then auto-routes it to Approved / Under Review / Rejected with a plain-English reason trail — not a black box. The Coverage Check tab answers "is this VIN/serial still under warranty" instantly.

**What do the BI graphs explain?**
No charts on this page — the claim-status pipeline strip across the top (a count per state: Submitted, Under Review, Approved, In Repair, Reimbursed, Recovery, Rejected, Closed) is the numeric readout for where the caseload sits. The equivalent donut ("warranty claims by status") lives on the Dashboard.

**What problem does this submodule solve?**
Two things this CRM was explicitly built around: (1) instant, serial-level coverage answers instead of a dealer guessing whether a part is still covered, and (2) an adjudication decision that's *evidenced*, not argued — every approval or rejection carries the specific rule that produced it, and a defect that traces back to a supplier's batch opens a real recovery case instead of the cost just sitting with the manufacturer.

---

## What doesn't have a BI dashboard, and why

Not every module has charts, and that's a deliberate choice, not a gap: a chart only earns its place when there's real cross-record volume to summarize. Campaigns, Compliance, and a single dealer's Warranty/Dealer-360 detail page are all either lookup/contract screens or single-record views where a chart would either be empty, trivial, or fabricated from too little data. Where the BI does exist (Dashboard, Vehicle Inventory, Order Management, Purchase Management), it's built directly from the same tables the rest of the module reads and writes — there's no separate reporting layer to fall out of sync.
