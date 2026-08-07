# VoltOs — Dealer & Warranty Management CRM (integration bundle)

This bundle does two things you asked for, against your actual `innocrm-staging`
(a.k.a. **Synkro CRM**) codebase:

1. **Applies the Zira colour palette** to the whole CRM via a single drop-in
   `globals.css`, because the app is fully theme-tokenised.
2. **Extracts the InnoCRM landing-page module and adapts it for EV** — turning
   the landing page into a **dual-purpose portal**: a *dealership-application*
   intake that feeds the onboarding pipeline **and** a *retail-inquiry* source
   that feeds the Leads module. It also adds the onboarding-pipeline
   monitoring screen (your Module 3), grounded in your onboarding documents.

Everything here matches the repo's existing conventions (Express 5 + Prisma +
`@repo/db`, ESM `.js` imports, Next.js App Router + Tailwind v4 tokens).

---

## Part 0 — Run it locally, right now

The folders below (`theme/`, `prisma/`, `api/`, `web/`) are still the
**Postgres-flavoured drop-in bundle** described in this README — copy them
into your real `innocrm-staging` codebase when you're ready. But this repo
*also* now contains a **standalone, runnable copy** of the same bundle under
`apps/` + `packages/db`, wired up end-to-end against a real **Supabase
Postgres** database (was local SQLite in an earlier round — see `.env`), so
you can click through every module today without touching the real CRM.

```bash
npm install
npm run setup      # prisma generate + db push + seed sample data
npm run dev         # API on :4000, web app on :3000
```

**Env files:** the connection string lives in `.env` at the repo root, but is
duplicated into `apps/api/.env`, `packages/db/.env` and `apps/web/.env.local`
— npm workspaces run each script from that package's own directory, so
Prisma/Node only reads the copy sitting next to the process, not the root
one. Change all four together. `DATABASE_URL` (pooled, `:6543`, needs
`?pgbouncer=true` or multi-query requests throw a "prepared statement
already exists" error) is used at runtime; `DIRECT_URL` (`:5432`) is used
only by `prisma db push`/migrate.

Then open **http://localhost:3000**. Seed data includes 5 dealers across 5
states, onboarding applications at different pipeline stages, routed leads,
finance cases, service tickets, vehicle inventory, stock-transfer and
spare-part orders, compliance records and warranty claims — enough to see
every screen populated immediately.

```
apps/api/       Express 5 API — adapted copies of the controllers/services/
                 routes below, plus the dealer-management submodules
apps/web/       Next.js app — the delivered pages plus the submodule pages
packages/db/    Merged Prisma schema (runs against Supabase Postgres) + seed script
```

**What's different from the Postgres bundle, and why:** this schema was
originally adapted for local SQLite dev (no native scalar-list or
`mode: "insensitive"` support), so `apps/api` still swaps `Dealer.segments`
for a comma-joined string and drops that query option — left as-is now that
it's on real Postgres too, since it works fine as a plain column and wasn't
worth churning without a reason to. There's also a dev-only
`requireAuth`/`requireRole` stub in
`apps/api/src/middleware/auth.middleware.ts` standing in for the real
session/JWT auth `innocrm-staging` already has — send an `x-user-role` header
to exercise role checks. Every adaptation is called out in a comment at the
top of the file it touches. None of it changes the Postgres-flavoured source
files in `/prisma`, `/api`, `/web` — those still install into the real CRM
exactly as documented below.

To reset to fresh sample data at any point: `npm run db:seed`.

**Known residual risk:** `npm audit` reports 3 high-severity advisories in
Next.js's bundled `postcss`/`sharp` (image-optimisation and CSS tooling used
at build/dev time, not part of the app's own code). They only ship on Next
16, a breaking major bump — left alone here since this is a local dev
scaffold; re-run `npm audit` before using this as a real deployment base.

### The Dealer Management submodules

Beyond the 5 operational parts in §6 below, two more practical pieces were
added to Dealer Management:

- **Vehicle Inventory & Stock Allocation** (`/dealer-inventory`) — VIN-level
  stock from the OEM warehouse through allocation, demo fleet and sale, plus
  a dealer stock-transfer request queue (Request → Approve → Dispatch →
  Deliver, which reassigns the specific VINs to the dealer) and a BI
  dashboard (stock mix by model, dealer demand by zone, most-ordered model
  per zone) — see Part 0d below.
- **Compliance & Document Renewals** (`/dealer-compliance`) — dealer
  agreement, trade license, GST certificate, insurance and statutory NOCs,
  each with an expiry date. Status (Valid / Expiring soon / Expired /
  Missing) is recomputed from the expiry date on every load, with a
  one-click renewal reminder per record.

Both list pages accept `?dealerId=` and are linked directly from a dealer's
detail panel in Dealer Management. Warranty claims live in their own
centrepiece module — see Part 0c below.

### The Lead Module + Landing Page Campaigns are now the real thing (this round)

Earlier rounds of this bundle sketched a minimal Lead/Enquiry model just
big enough for the dual-intent webhook to write to. This round replaces
that sketch with a **direct port of innocrm-staging's own Lead module and
Landing Page Campaign module** — same field names, same status vocabulary,
same lead-scoring formula, same webhook dedup logic. Concretely, ported
from `apps/api/src/{controllers,services}/{leads,webhooks,landingPageCampaign,leadScoring}.*`
in the real `innocrm-staging` checkout:

- **Lead scoring** (`apps/api/src/services/leadScoring.service.ts`) —
  completeness (7 tracked fields, ~14.3pts each) × 0.7 + quality (starts at
  100, −10 per malformed email/phone) × 0.3. Runs on every webhook-created
  and manually-created lead; recomputed on every edit.
- **Lead statuses**: `OPEN → WORKING → QUALIFIED → CONVERTED`, with
  `UNQUALIFIED` / `NURTURING` branches — the real innocrm-staging enum, not
  an invented one.
- **`/leads`** — list + filters (status, source, unassigned), a detail
  panel with the score breakdown, an owner-assignment dropdown, and a
  remarks/activity trail (`LeadRemark`, "every move is logged as a
  remark").
- **`/landing-page-campaigns`** — CRUD for campaigns, each with a
  `uniqueId` that's the actual webhook contract: the external landing page
  sends it back as `landing_page_campaign_id` on every submission so
  enquiries and dealer applications are attributed to the campaign that
  produced them.

**Deliberately left out** of the port (the brief was to keep this simple):
CSV bulk-import, bulk convert/assign/claim queues, Contact conversion,
keyword/segment tagging, WhatsApp/Brevo campaign delivery, analytics
events — real innocrm-staging features that don't apply to a dealer-network
CRM. `leads.controller.ts` in the source repo is 2,454 lines; this port is
~300.

**Schema-shape adaptations for SQLite:** `Lead.missingFields`/`invalidFields`
are `String[]` in the real Postgres schema, stored as `Json` here (SQLite
has no native scalar-list type — see the standing note in Part 0). Every
other field name, including the `LeadStatus`/`LeadSource`/
`LandingPageCampaignStatus` enum values, is unchanged from the source.

### Theme: plain, white, one accent

The earlier "Zira" reskin (dark ink sidebar, camel accent) is gone. The
running app now uses a light theme built on **innocrm-staging's own real
brand teal** (`#0e7d70`, drawn from `packages/ui/src/styles/globals.css` in
the source repo, not invented) on a white background, with a light,
collapsible sidebar instead of a dark rail. Same token names as before
(`--background`, `--primary`, `--sidebar-*`, `.badge-approved/pending/rejected`)
so no page needed touching — see `apps/web/app/globals.css` for the full
palette and dark-mode variants.

---

## Part 0c — VoltOs: rebrand + Warranty Management centrepiece + BI dashboard

This round did four things, grounded in `DMS-and-Warranty-Research.pdf`
(Dealer & Warranty Management — the two modules that document names the
project's centrepiece) and your direct asks:

### 1. Rebrand: VoltOs

Every "Luxus Green" reference in the running app — page titles, the sidebar
brand, dealer-code prefix (`LGM-` → `EVV-`), seed data, `<title>` metadata —
is now **VoltOs**. The Postgres-flavoured bundle files at the repo root
(`/theme`, `/prisma`, `/api`, `/web`) are untouched, per the standing note in
Part 0 that those install into your real CRM as-is.

### 2. Warranty Management — the missing centrepiece, built to Phase 1 of the PDF's own roadmap

A full new module, not a stub: `WarrantyPlan` (policy data per model +
component — term, km, SoH floor, approved chargers), `ComponentUnit` (the
serial registry — which exact battery/motor is in which chassis, tied to
supplier + batch), an upgraded `WarrantyClaim` with the PDF's state machine
(`SUBMITTED → UNDER_REVIEW/INFO_REQUESTED → APPROVED → IN_REPAIR →
REIMBURSED → RECOVERY → CLOSED`, or `REJECTED`), a `WarrantyClaimEvent` audit
trail, and `SupplierRecovery` for the closed loop. The **adjudication rules
engine** (`apps/api/src/services/warrantyAdjudication.service.ts`)
implements the PDF's Appendix B literally — time term, distance term, SoH
floor, approved-charger check, service-record completeness, duplicate-claim
check — and auto-routes a claim to `APPROVED`, `UNDER_REVIEW`, or `REJECTED`
with a plain-English reason trail, exactly the "evidenced decision, not an
argument" the brief asked for. New page: **`/warranty`** (coverage
check, claims + adjudication, plans, supplier recovery).

Deliberately deferred, per that document's own Phase 2/3 (not this round):
a standalone `PartReturn`/RMA model (two fields on the claim stand in for
it), Recall/Campaign, Extended-warranty/AMC contracts, and telematics/BMS
log ingestion.

### 3. Dealer Management — kept lean, on purpose

An earlier round of this bundle added Workshop & Audit Log, Staff Directory,
Credit Ledger and a separate Visits log. On review those didn't earn their
place against this CRM's actual problem statement — dealer-network
operations and warranty, not full workshop-floor or HR/finance
record-keeping — so **all four were removed**: schema, controllers, routes,
pages, nav entries and seed data. `Dealer.creditLimit` is still on the
dealer record for context; there's no ledger deriving a balance from it.

What's left in Dealer Management is Onboarding, Dealer 360, Vehicle
Inventory and Compliance, plus the Warranty centrepiece — each one screen,
each backed by data the CRM actually tracks.

### 4. Lead module: fuller port + "dealer is the lead"

- **CSV bulk import** (`apps/api/src/controllers/leadsImport.controller.ts`)
  — ported from `leadsImport.controller.ts` in the real source (CSV-only
  here; XLSX/exceljs and Contact/Account auto-conversion dropped as
  out-of-domain), plus **self-serve claim** and **bulk-assign**, both real
  ported behaviours, not new inventions.
- **Convert to dealer application** — a Lead can represent a *potential
  dealer*, not just a retail buyer. One click on a lead's detail panel
  creates a `DealerApplication` seeded with the Stage-1 document checklist
  and links back to the originating lead, so the same intake feeds both the
  retail pipeline and dealer onboarding.
- **GTM integration** — `LandingPageCampaign.gtmContainerId`, returned from
  the public `GET /api/v1/landing-page-campaigns/unique/:uniqueId` lookup so
  the external landing page never hardcodes a container ID; the expected
  `window.dataLayer` conversion-event contract is documented on the
  campaign's detail panel in `/landing-page-campaigns`.

### 5. Dashboard: real BI figures

`/` now renders donut and bar charts (leads by status, dealers by status,
warranty claims by status, dealers by state, onboarding by stage) — hand-rolled
SVG components (`apps/web/components/charts/`), no charting library, built
against the `dataviz` skill's validated categorical palette
(`--viz-1..8` in `globals.css`) with a legend and hover tooltip on every chart.

---

## Part 0d — scope cut + Inventory BI + a more dynamic Dealer 360 + sidebar

This round removed the four submodules called out in Part 0c §3 (Credit
Ledger, Visits, Staff Directory, Workshop & Audit) and put the effort back
into the three modules the CRM's problem statement is actually about:

**Vehicle Inventory (`/dealer-inventory`) — a BI dashboard, not just a
table.** A new `GET /api/v1/vehicle-units/analytics` endpoint aggregates
`VehicleUnit` and `StockTransferRequest` (no new tracking added) into: live
stock by model (donut), dealer stock orders by zone/state (bar), and the
single most-ordered model per zone — the "zone order graph, vehicle-wise"
view onto real order data.

**Dealer 360 (`/dealer-management`) — OEM ↔ dealer order communication,
inline.** The dealer detail panel now lists a dealer's vehicle stock orders
and spare-part orders directly (both already existed as `StockTransferRequest`
/ `SparePartRequest`), each with a one-click "advance to next status" action
(Requested → Approved → Dispatched → Delivered) — so receiving and actioning
a dealer's order to the manufacturer happens on this one screen instead of a
link-out.

**Sidebar** — the nav rail moved off a plain white background onto a deep
teal chrome (`--sidebar` in `globals.css`, same hue family as `--primary`,
much darker), so it reads as distinct navigation chrome rather than blending
into the white content area. Collapsible group-with-dropdown behaviour is
unchanged; entries for the four removed modules are gone.

---

## Part 0e — real database, full-page detail views, a real logo

**Supabase Postgres, not local SQLite.** `packages/db/prisma/schema.prisma`'s
datasource is now `postgresql` (pooled `DATABASE_URL` + direct `DIRECT_URL`,
Supabase's recommended split for `prisma db push` against pgbouncer) instead
of a local `dev.db` file. See the env-files note in Part 0 above — the
connection string is duplicated across 4 `.env` files by necessity (npm
workspaces), so a credential rotation means editing all four.

**Every list+detail screen now opens a full page, not a side panel.**
Dealer Onboarding, Dealer 360, Leads, Warranty Claims and Landing Page
Campaigns used to show a selected row's detail in a ~400px `<aside>` next to
the list — cramped on anything wider than a laptop screen. Clicking a row
now navigates to its own route (`/dealer-onboarding/[id]`,
`/dealer-management/[id]`, `/leads/[id]`, `/warranty/claims/[id]`,
`/landing-page-campaigns/[id]`) that lays the same information out across
the full page width — e.g. the Dealer 360 detail page shows vehicle stock
orders, spare-part orders, allocated vehicle units and service tickets all
expanded at once, instead of a 5-deep stack in a narrow column.

**A real logo**, not a stock icon in a colored square: `apps/web/components/Logo.tsx`
is a small hand-drawn SVG mark (a "V" whose right arm carries a lightning-bolt
kink — EV + Vikas in one shape), used in the sidebar badge and as the
browser-tab favicon (`apps/web/app/icon.svg`).

---

## Part 0f — Order Manager, richer seed data, a module guide

**Order Manager** (`/order-manager`) — the manufacturer-wide counterpart to
the per-dealer order view on Dealer 360. It merges `StockTransferRequest`
(vehicle stock) and `SparePartRequest` (spare parts) across every dealer
into one filterable list and BI dashboard: orders by type, by zone, by
status, and — the specific ask — the single most-ordered vehicle model and
most-ordered spare part per zone. No new order type or tracking; purely an
aggregation over the two tables Vehicle Inventory and Dealer 360 already
use. Backend: `apps/api/src/controllers/orderManager.controller.ts` +
`routes/orderManager.routes.ts`, mounted at `/api/v1/order-manager`.

**Seed data** (`packages/db/prisma/seed.ts`) now covers 9 dealers across 9
states (was 5/5), a 4-stage-deep onboarding pipeline (was 2), 22 combined
vehicle-stock + spare-part orders across 8 zones (was 7/4) including every
status (Requested/Approved/Dispatched/Delivered/Rejected/Cancelled — several
of these weren't represented before), and warranty claims covering every
non-transient claim status (added `INFO_REQUESTED` and `CLOSED`, which
weren't seeded before). Re-run `npm run db:seed` to pick it up.

**`docs/MODULE_GUIDE.md`** — a Q&A reference, one section per submodule,
answering: how it works, what its BI charts explain (or an explicit note
that it deliberately has none), and what problem it solves. Written for
whoever's testing or demoing the CRM and wants the "why" behind a screen
without reading the source.

---

## Part 0g — design refresh, Lead Management restructure, Purchase Management

**Design system.** The page background is now a shade off-white
(`--background`) with cards staying pure white (`--card`) plus a soft shadow
(`--shadow-card`, applied via the `.card-elevated` class) — the same
"structured SaaS" trick of cards reading as raised surfaces instead of one
flat plane. New shared primitives: `components/ui/StatCard.tsx` (icon-badge
KPI tile with an optional trend line), `components/charts/ChartCard.tsx`
(chart header with title/subtitle/trend-pill), `components/charts/TargetBarChart.tsx`
(attainment-vs-target bar, colored green/amber/red). Applied to the Dashboard
and both order/purchase modules; not retroactively applied to every existing
page in this round — ask if you want the same treatment elsewhere. A
light/dark **theme toggle** now lives in the sidebar footer
(`components/ThemeToggle.tsx`), backed by a blocking init script in
`layout.tsx` so there's no flash on load; light is the default the app is
designed around, dark is supported but secondary.

**Lead Management restructure.** The sidebar's "Leads & Landing Page" group
is now "Lead Management" with four entries over the same `Lead` data: **Lead
Master** (`/leads`, unfiltered — also where CSV import and lead creation
live), **Assigned Leads** (`/leads/assigned`), **Unassigned Leads**
(`/leads/unassigned`), and **Campaigns** (`/landing-page-campaigns`, renamed
from "Landing Page Campaigns"). The three list views share one component
(`components/leads/LeadListView.tsx`) with a `mode` prop — the backend
already supported `?assigned=true`/`?unassigned=true`, so this was a
frontend-only split, not a new query capability.

**AI Insights** (`/ai-insights`) — an empty placeholder page, marked with a
red dot in the sidebar ("under development"). No functionality by design.

**Order Manager → Order Management**, renamed and substantially expanded.
Beyond the original zone/type/status/top-item view, it now surfaces order
aging (avg days open + an oldest-open-orders list, flagged past 7 days), top
dealers by order volume, an 8-week order-volume trend, and fulfillment rate
overall and by zone (Delivered ÷ resolved orders). Route moved from
`/order-manager` to `/order-management`; API mount moved from
`/api/v1/order-manager` to `/api/v1/order-management` to match (controller
renamed `OrderManagementController`, file `orderManagement.controller.ts`) —
a clean rename rather than a redirect, since the module was built this same
session and had no external links to preserve.

**Purchase Management** (`/purchase-management`) — new, and distinct from
Order Management (dealer → OEM). This is the manufacturer's *own*
procurement: a new `VehiclePurchaseOrder` model (supplier, model, quantity,
unit cost, status `ORDERED → IN_TRANSIT → RECEIVED`/`CANCELLED`) tracking
batches bought from a plant or import source. "Sold" figures are read
directly from `VehicleUnit.status = SOLD` — the real sales data Vehicle
Inventory already keeps — so "imported vs. sold" is a genuine
cross-reference between two real tables. Deliberately not wired: marking a
PO Received doesn't yet bulk-create matching `VehicleUnit` rows (a PO tracks
the batch, not individual VINs) — a natural next step, not built here so the
two stay honestly separate rather than half-linked.

---

## What's in the box

```
theme/globals.css                         → replace packages/ui/src/styles/globals.css
prisma/ev-onboarding.prisma               → paste models+enums into schema.prisma
prisma/migration.reference.sql            → reference SQL (Prisma will generate the real one)
api/services/applicationRouting.service.ts→ intent routing, UTM, per-stage doc catalog
api/controllers/ingest.controller.ts      → POST /api/v1/ingest/landing-page (dual-intent)
api/controllers/onboarding.controller.ts  → pipeline list/detail/advance/verify
api/routes/ingest.routes.ts               → public webhook route
api/routes/onboarding.routes.ts           → protected onboarding routes
api/routes-index.additions.md             → how to mount routes + sidebar nav + env
web/app/dealer-onboarding/page.tsx         → onboarding pipeline monitoring UI (Module 3)
```

---

## Part 1 — The Zira reskin

**Why one file is enough:** the CRM reads every colour from CSS variables in
`packages/ui/src/styles/globals.css` (`--primary`, `--sidebar`, `--border`,
the `bg-brand-*` utilities, etc.). Change those tokens and the entire app
re-skins — no component edits. The replacement file also **keeps the old
`--brand-*` names aliased** to the nearest Zira colour, so components that use
`bg-brand-teal` keep working unchanged.

### Install
```bash
cp theme/globals.css packages/ui/src/styles/globals.css
npm run dev
```

### Palette mapping (sampled from your board)

| Zira token | Hex | Used for |
|---|---|---|
| `--zira-ink` | `#10222C` | sidebar / nav / structure |
| `--zira-slate` | `#3D4D55` | secondary structure, headings |
| `--zira-stone` | `#A79E9C` | muted text / icons |
| `--zira-sand` | `#D3C3B9` | subtle surfaces, hover tints |
| `--zira-camel` | `#B58863` | **accent** — active nav, links, focus ring, charts |
| `--zira-noir` | `#161618` | deep text |

**One deliberate accessibility call:** pure camel `#B58863` fails WCAG contrast
for small white text (~3:1), so primary **buttons** use a deepened camel
`#9A6A3D` (≈ AA on white) while pure camel is reserved for accents/active states
where contrast matters less. If you'd rather have the brighter camel on buttons
and accept the lower contrast, set `--primary: var(--zira-camel);` in
`:root`. Muted semantic badges are included: sage `Approved`, ochre `Pending`,
terracotta `Rejected` — deliberately desaturated to match the "smooth colours"
brief. Radius is tightened (`0.55rem`) and there are no continuous animations,
in line with the "simple, fast, practical" direction.

---

## Part 2 — The landing-page module (dual-intent portal)

### The concept (learned from InnoCRM)

In InnoCRM the flow is: **landing page → webhook → Lead + Enquiry +
FormSubmission**, all tied to a `LandingPageCampaign`. The relevant source
files (your "copy list") are:

- `apps/api/src/controllers/webhooks.controller.ts` — the ingestion webhook
- `apps/api/src/controllers/landingPageCampaign.controller.ts` — campaign CRUD/stats
- `apps/api/src/routes/webhooks.routes.ts`, `landingPageCampaign.routes.ts`
- Prisma models: `LandingPageCampaign`, `Enquiry`, `FormSubmission`, `Lead`
  (+ enums `LeadSource.LANDING_PAGE`, `EnquiryStatus`)
- `apps/web/app/landing-page-trackers/page.tsx` — the campaign tracker UI

Your intern's portal only needs to **POST a JSON payload** to one endpoint. The
EV twist is that the same portal serves two audiences, so the payload carries an
`intent` field and we branch on it.

### The new endpoint: `POST /api/v1/ingest/landing-page`

```jsonc
// dealership application → onboarding pipeline
{
  "intent": "dealership_application",
  "legalName": "Volt Motors Pvt Ltd",
  "contactName": "Asha Rao",
  "email": "asha@voltmotors.in",
  "phone": "9876543210",
  "gstin": "27ABCDE1234F1Z5",
  "city": "Pune", "state": "Maharashtra", "pincode": "411001",
  "investmentCapacity": "50L-1Cr",
  "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "dealer-expansion-q3"
}
```
→ creates a `DealerApplication` at stage **APPLICATION**, assigned to
**NETWORK_EXPANSION**, seeds the Stage-1 document checklist, records a stage
event, and (for CRM visibility) a linked `Lead`. Responds with a `publicId` the
portal can show the applicant.

```jsonc
// retail inquiry → Leads module (unchanged InnoCRM behaviour + UTM)
{ "intent": "retail_inquiry", "firstName": "Rahul", "email": "rahul@x.com", "phone": "9998887776" }
```
→ dedupes by email/phone and creates/updates `Lead` + `Enquiry` + `FormSubmission`.

`intent` is tolerant: missing/unknown → `retail_inquiry`; `dealer`/`franchise`/
`partner` → `dealership_application`. UTM is read from top-level, `utm{}`,
`custom_fields{}`, or `form_submission{}`. Optional HMAC verification via
`INGEST_WEBHOOK_SECRET` + `x-signature` header (same scheme as the Landingi one).

### Install
```bash
# 1. schema
#    paste prisma/ev-onboarding.prisma into packages/db/prisma/schema.prisma
#    add the back-relations noted at the top of that file to User (+ Lead)
npm run db:generate && npm run db:migrate

# 2. backend
cp api/services/applicationRouting.service.ts   apps/api/src/services/
cp api/controllers/ingest.controller.ts         apps/api/src/controllers/
cp api/controllers/onboarding.controller.ts     apps/api/src/controllers/
cp api/routes/ingest.routes.ts                  apps/api/src/routes/
cp api/routes/onboarding.routes.ts              apps/api/src/routes/
#    then wire routes/index.ts + sidebar per api/routes-index.additions.md

# 3. frontend
cp web/app/dealer-onboarding/page.tsx           apps/web/app/dealer-onboarding/page.tsx
```

---

## Part 3 — Onboarding pipeline (Module 3), grounded in your docs

The 5-stage state machine and the **per-stage document checklists** come
directly from *List of Documents required at each stage of Onboarding*,
trimmed to match your **5-stage digital flow** (Portal/E-KYC → Financial
Vetting → Virtual Site → Digital LOI/E-Sign → LMS/Handover):

1. **APPLICATION** — ID/PAN/GST + promoter profile
2. **SCREENING_NDA** — NDA, EoI, CIBIL
3. **BUSINESS_PROPOSAL** — DPR, 3-yr projections, funding proof
4. **DUE_DILIGENCE** — audited financials + property/site (Fire NOC, geo-tagged media)
5. **LEGAL_AGREEMENT** — the Letter of Intent (LOI) is issued to the
   applicant here, alongside the e-signed dealer agreement and security
   deposit
   → **OPERATIONAL** (appointed as a live dealer)

Facility fit-out/branding sign-off, staff training and go-live checks happen
after the LOI, outside this tracked pipeline — not modelled as onboarding
stages here (an earlier round of this bundle had 8 stages including those
three; cut back to 5 per direct instruction, since stage 5 issuing the LOI is
the pipeline's actual endpoint from this CRM's point of view).

**State-machine guarantees:** stages advance forward-only; a stage can only be
cleared once **every required document is `VERIFIED`** (the `advance` endpoint
returns `409` with the blocking docs otherwise); every transition is written to
`onboarding_stage_events` for the timeline. Documents are seeded automatically
when a stage is entered.

The monitoring UI shows the pipeline as stage columns with live counts, a
filterable application list, and a detail panel with the document checklist,
verify/reject actions, an **Advance** button, and the stage timeline.

### Where the verification APIs plug in (from your API resources doc)

The document catalog uses stable `docKey`s so you can attach real verification:

| Stage / doc | API (from your resources doc) |
|---|---|
| `PAN_INDIVIDUAL` / `PAN_CORPORATE` | Sandbox.co.in or Eko PAN verification |
| `GSTIN_CERTIFICATE` | Perfios or WhiteBooks GST verification |
| `SITE_MEDIA` (geo-tag) | Exif.js (client) + Leaflet/OSM map |
| `DEALER_AGREEMENT`, `SIGNED_NDA`, `LOI_SIGNED` | Leegality / Surepass Aadhaar e-Sign |
| Bank/penny-drop checks | Sandbox.co.in KYB |

Suggested integration point: a `verification.service.ts` that, on document
upload, calls the relevant API and sets `DocumentStatus` to `VERIFIED`/`REJECTED`
automatically instead of manual review.

---

## Honest scope — what this bundle does and doesn't cover

**Included and working (against this codebase, and runnable standalone via
Part 0 above):** the theme, the dual-intent ingestion webhook, the
onboarding data model + document catalog + state machine, the onboarding
APIs, the Module 2 dealer-management core (dealer master, territory, lead
routing, targets vs. actuals, finance facilitation, service tickets, spare
parts), vehicle inventory & stock allocation with a BI dashboard (stock by
model, dealer demand by zone, top model per zone), compliance & renewals,
the **Lead module ported from innocrm-staging** (real scoring formula, real
status enum, real webhook dedup logic, CSV import, claim, bulk-assign) with
a lead → dealer-application conversion path, GTM config on Landing Page
Campaigns, and the **Warranty Management module** (plans, serial registry,
coverage check, auto-adjudication, supplier recovery). Dealer 360 surfaces
a dealer's vehicle-stock and spare-part orders inline with one-click status
actions, so OEM ↔ dealer order communication happens on one screen. All of
it with monitoring UIs and BI charts on the dashboard. Verified end-to-end
against a local SQLite copy: every route was exercised with real requests
and both apps pass `tsc --noEmit`, not just syntax-checked.

**Deliberately removed, not missing:** Workshop & Audit Log, Staff
Directory, Credit Ledger and a separate Visits log were built in an earlier
round, then cut — they didn't map to this CRM's stated problem ("a very
specific problem statement, it solves just that"). Nothing about them is
half-built; the schema, backend, frontend and seed data were all removed
together, verified by `tsc --noEmit` and a full route/page smoke test.

**Mapped but not built here** (needs real product/inventory decisions and is
larger than a single module extension, or is explicitly Phase 2/3 in
`DMS-and-Warranty-Research.pdf`'s own roadmap):

- **Purchase orders against `Order`/`Invoice`**: the Vehicle Inventory
  submodule's `StockTransferRequest` covers the dealer-facing "request more
  stock" half; a full PO engine tied to your real `Order`/`Invoice` models
  (plus a credit ledger, if you want one) is the natural next step, so
  dealer performance actuals can be filled automatically from real orders
  instead of the manual/nightly-job path in §6.3.
- **Warranty Phase 2/3**: a standalone `PartReturn`/RMA model, Recall/Field
  Campaigns, Extended-warranty/AMC contracts, telematics/BMS log ingestion,
  fraud/anomaly detection.
- **Verification-service automation**: the KYC/GST/e-sign API connection
  points named in §5 are labelled in the code but not wired to a live
  provider — documents are still marked verified manually.

If you want, point me at the `Order` flow you actually use, or which
Warranty Phase 2/3 piece matters most, and I'll build it next in the same
style.

### Verify after install
```bash
npm run db:generate && npm run check-types   # types
curl http://localhost:4000/api/v1/ingest/landing-page/test   # webhook alive
```

Or, to verify the standalone runnable copy under `apps/` (see Part 0):
```bash
npm run setup && npm run dev
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/dealers/stats
```
