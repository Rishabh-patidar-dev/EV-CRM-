# Cross-App Connections & Dependency Graph

Three separate Next.js frontends — **Ev Landing** (public), **DMS** (dealer portal), and **CRM Web** (`apps/web`, staff) — plus the **CRM API** (`apps/api`, Express) they all talk to. Each frontend lives in its own git repo and deploys independently; none of them share source code and none of them have a database of their own. The API is the only thing that ever touches Postgres, Supabase Storage, or Resend — every frontend reaches those exclusively through it.

## 1. All three sites at a glance

```mermaid
graph LR
  Applicant(("Applicant / Visitor")) -->|browser| LANDING["Ev Landing<br/>Next.js"]
  Dealer(("Operational Dealer")) -->|browser| DMS["DMS<br/>Next.js"]
  Staff(("OEM Staff")) -->|browser| WEB["CRM Web<br/>Next.js apps/web"]

  LANDING -->|"POST /api/v1/ingest/landing-page<br/>(no login)"| API
  LANDING -->|"dealer_session cookie<br/>/api/v1/dealer-auth/*"| API
  LANDING -->|"file upload + OCR"| STORAGE[("Supabase Storage")]

  DMS -->|"dealer_session cookie (promoted)<br/>/api/v1/dealer-portal/*"| API

  WEB -->|"crm_session cookie<br/>/api/v1/* (30+ routes)"| API

  API["CRM API<br/>Express apps/api"] --> DB[("Postgres<br/>Supabase")]
  API -->|"fileStorage.service.ts"| STORAGE
  API -->|"email.service.ts"| RESEND["Resend<br/>(email)"]
  API -->|"ocr.service.ts"| API
```

Every arrow into `API` is a plain REST call over HTTPS with a cookie attached — there is no shared code, no shared session store, and no direct database access from any frontend. `packages/db` (the Prisma schema + client) is only ever imported by `apps/api` via the npm workspace package `@repo/db` — it's a **source-code** dependency internal to the `EV-CRM-` monorepo, not something the other two repos can reach at all.

## 2. Ev Landing — individual connection diagram

```mermaid
flowchart LR
  Visitor(("Visitor")) --> Wizard["/apply wizard<br/>(no login required)"]
  Applicant(("Signed-in applicant")) --> Portal["/login /signup /dashboard"]

  Wizard -->|"file upload + OCR"| STORAGE[("Supabase Storage")]
  Wizard -->|"on submit: POST /api/v1/ingest/landing-page"| API["apps/api"]

  Portal -->|"dealer_session cookie<br/>/api/v1/dealer-auth/*"| API

  API --> DB[("Postgres")]
```

- **`/apply`** — no login. Documents upload straight to Supabase Storage from this app's own `/api/apply/upload` route (`src/lib/storage/supabaseStorage.ts`), which also runs a plain-text OCR pass (`src/lib/ocr.ts`, tesseract.js) and returns the extracted text alongside the file URL. On final submit, the whole form (plus every uploaded document's URL/OCR text) is POSTed once to the CRM API's public ingest webhook, which creates the `DealerApplication` + `DealerApplicationDocument` rows.
- **`/login`, `/signup`, `/dashboard`** — the self-service onboarding tracker. The browser talks to the CRM API's `/api/v1/dealer-auth/*` endpoints directly (not through this app's own server) using a `dealer_session` cookie signed with `JWT_DEALER_SECRET`. This is the *same* cookie/session mechanism DMS uses (see below) — an applicant who later becomes an operational dealer keeps the same session.
- Never touches Postgres directly, and only touches Supabase Storage for the upload step — everything else is the CRM API.

## 3. DMS — individual connection diagram

```mermaid
flowchart LR
  Dealer(("Operational Dealer")) --> DMS["DMS<br/>(Overview, Orders, Inventory,<br/>Warranty, Service, Purchase Invoices…)"]
  DMS -->|"dealer_session cookie<br/>/api/v1/dealer-portal/*"| MW["requireDealerPortalAuth"]
  MW -->|"resolves applicationId → Dealer<br/>(auto-promotes if not yet linked)"| API["apps/api"]
  API --> DB[("Postgres")]
  API -->|"purchase-invoice OCR preview"| API
```

- DMS has **no pages that talk to anything except the CRM API** — every list, form, and upload (`crmFetch` in `src/lib/crm/dealerAuth.ts`) goes to `/api/v1/dealer-portal/*`.
- Reuses the exact same `dealer_session` cookie Ev Landing's dealer-auth flow issues. The `requireDealerPortalAuth` middleware resolves that cookie's `applicationId` to an operational `Dealer` row, auto-creating one on first hit if the application hasn't been formally promoted yet — so one login works across both the onboarding tracker (Ev Landing) and the operational portal (DMS) with zero extra setup.
- Purchase-invoice OCR (photograph an invoice, get suggested fields) is proxied entirely through `apps/api` — DMS never talks to Supabase Storage or tesseract.js itself.

## 4. CRM Web (`apps/web`, staff) — individual connection diagram

```mermaid
flowchart LR
  Staff(("OEM Staff")) --> WEB["CRM Web<br/>(Leads, Campaigns, Dealer Mgmt,<br/>Order Mgmt, Warranty, Onboarding…)"]
  WEB -->|"crm_session cookie<br/>(cross-domain: API on Render,<br/>this app on Vercel)"| API["apps/api"]
  WEB -->|"has_session marker cookie<br/>(same-domain, checked by middleware.ts)"| WEB
  API --> DB[("Postgres")]
```

- Every page under `app/(dashboard)/**` calls `apps/api` via `apiClient` (axios) — no exceptions, no direct DB access.
- Auth is two cookies because the API and this app are on **different domains** in production (API on Render, this app on Vercel): the real `crm_session` (JWT, `JWT_SECRET`) is set by the API and verified server-side on every request; a lightweight `has_session` marker cookie is set on *this app's own domain* by the login form after a successful login, purely so `middleware.ts` can gate routes client-side without being able to read the cross-domain `crm_session` itself.

## 5. The backend hub (`apps/api`) — what it depends on

```mermaid
flowchart TB
  API["apps/api (Express)"] --> DB_PKG["packages/db<br/>(@repo/db workspace package)"]
  DB_PKG --> PG[("Postgres — Supabase")]
  API --> FS["fileStorage.service.ts"]
  FS --> SB[("Supabase Storage")]
  API --> OCR["ocr.service.ts<br/>(tesseract.js, in-process)"]
  API --> EMAIL["email.service.ts"]
  EMAIL --> RESEND["Resend"]
```

- **`packages/db`** is the only source-code dependency shared across the monorepo — a Prisma schema + generated client imported as `@repo/db`. It's internal to the `EV-CRM-` repo; DMS and Ev Landing (separate repos) cannot import it and never see a Postgres connection string.
- **`fileStorage.service.ts`** branches at runtime: real Supabase Storage when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set, local disk otherwise (dev-only fallback).
- **`ocr.service.ts`** runs fully in-process (tesseract.js) — no external OCR API, no network call.
- **`email.service.ts`** calls Resend only when `RESEND_API_KEY` is set; otherwise it logs and no-ops so nothing ever blocks on a missing key.

## 6. Session/auth mechanisms at a glance

| Cookie | Set by | Verified by | Used by |
|---|---|---|---|
| `crm_session` | `apps/api` (`auth.controller.ts`) | `apps/api`, `JWT_SECRET` | CRM Web (staff) |
| `has_session` | CRM Web's own login form | `apps/web/middleware.ts` (same-domain marker only) | CRM Web (client-side route gating) |
| `dealer_session` | `apps/api` (`dealerAuth.controller.ts`) | `apps/api`, `JWT_DEALER_SECRET` | Ev Landing (`/login`, `/dashboard`) **and** DMS (promoted via `requireDealerPortalAuth`) |
| *(none)* | — | optional HMAC (`INGEST_WEBHOOK_SECRET`) | Ev Landing's `/apply` → ingest webhook (public, no session) |

## 7. Repos and where each one deploys

| Repo | App(s) | Deployed host |
|---|---|---|
| `EV-CRM-` | `apps/api` | `https://ev-crm.onrender.com` |
| `EV-CRM-` | `apps/web` | `https://ev-crm-web.vercel.app` |
| `DMS` | DMS portal | *(check Render/Vercel dashboard — not confirmed here)* |
| `Ev-Landing` | Ev Landing | `https://ev-landing-yjgs.onrender.com` |

All three repos push to GitHub under the same account; each connected hosting service (Render/Vercel) redeploys automatically on push to the tracked branch.
