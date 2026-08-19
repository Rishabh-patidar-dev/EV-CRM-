# Architecture & User Flows — Luxus Green Mobility

## 1. System Architecture

```mermaid
graph LR
  Dealer(("Dealer")) -->|browser| DMS["DMS<br/>Next.js :3002"]
  Staff(("OEM Staff")) -->|browser| WEB["CRM Web<br/>Next.js :3000"]
  DMS -->|"REST, session cookie"| API["CRM API<br/>Express :4000"]
  WEB -->|"REST, session cookie"| API
  API --> DB[("Postgres<br/>Supabase")]
```

- DMS has no database of its own — every read/write goes through the CRM API, same DB as the CRM web app.
- One dealer action in DMS is visible in the CRM instantly (same rows), and vice versa.

## 2. Complete Website User Flow

### CRM (OEM staff side)

```mermaid
flowchart TD
  L["Login"] --> D["Dashboard / Overview"]
  D --> LM["Lead Management"]
  D --> CM["Campaign Management"]
  D --> DM["Dealer Management"]
  D --> WM["Warranty Management"]
  D --> AI["AI Insights"]

  LM --> LM1["Lead Master"]
  LM --> LM2["Assigned Leads"]
  LM --> LM3["Unassigned Leads"]

  CM --> CM1["Landing Page Campaigns"]
  CM --> CM2["Email Campaigns"]
  CM --> CM3["WhatsApp Campaigns"]
  CM --> CM4["Segments"]

  DM --> DM1["Onboarding Pipeline"]
  DM --> DM2["Dealer 360"]
  DM --> DM3["Vehicle Inventory"]
  DM --> DM4["Order Management"]
  DM4 --> DM4a["Disputed Orders"]
  DM --> DM5["Purchase Management"]
  DM --> DM6["Compliance & Renewals"]

  WM --> WM1["Claims & Coverage"]
```

### DMS (dealer side)

```mermaid
flowchart TD
  DL["Login"] --> DD["Dashboard / Overview"]
  DD --> P1["Leads"]
  DD --> P2["Segments"]
  DD --> P3["Email Campaigns"]
  DD --> P4["WhatsApp Campaigns"]
  DD --> P5["My Inventory"]
  DD --> P6["Orders"]
  DD --> P7["Warranty Claims"]
  DD --> P8["Service Tickets"]
  P6 -->|"order placed"| CRM["Lands in CRM → Order Management"]
```

## 3. Dealer Onboarding → DMS → CRM Order Flow (with department handoffs)

Each box's swimlane is the OEM department/role responsible for that step.

```mermaid
flowchart TD
  subgraph MKT["Marketing"]
    A1["Lead generated<br/>(landing page / campaign)"]
  end

  subgraph NEX["Network Expansion"]
    A2["Dealer application"] --> A3["Screening & NDA"]
    A3 --> A4["Business proposal"]
    A4 --> A5["Due diligence"]
    A5 --> A6["Legal agreement"]
    A6 --> A7["Dealer goes live<br/>(Operational)"]
  end
  A1 --> A2

  subgraph DLR["Dealer (DMS)"]
    B1["Places vehicle / spare-part order"]
  end
  A7 --> B1

  subgraph SLS["Sales / Order Desk"]
    C1["Order received<br/>status: REQUESTED"]
  end
  B1 --> C1

  subgraph WHS["Warehouse / Inventory"]
    D1{"Check Inventory"}
  end
  C1 --> D1

  subgraph FIN["Finance"]
    E1{"Credit limit &<br/>payment terms OK?"}
  end

  subgraph LOG["Warehouse / Logistics"]
    G1["Order APPROVED"] --> G2["DISPATCHED"] --> G3["DELIVERED"]
  end

  D1 -->|"stock sufficient"| E1
  E1 -->|"yes"| G1
  E1 -->|"no — held"| F2["Sales resolves credit issue with dealer"]
  F2 --> E1
  G3 --> H1["Dealer receives stock — visible in DMS"]

  D1 -->|"stock short"| F1["Disputed Orders queue<br/>(sub-module of Order Management)"]
  F1 --> F0{"Sort: best fit —<br/>rank competing orders by<br/>smallest shortfall, then quantity"}
  F0 --> F3["Sales sends out-of-stock notice<br/>+ expected restock date<br/>+ optional partial-fulfillment offer"]

  subgraph DLR2["Dealer (DMS)"]
    F6{"Dealer responds<br/>to partial offer"}
  end
  F3 --> F6
  F6 -->|"accept"| F7["Order split:<br/>offered qty → APPROVED now<br/>remainder → new REQUESTED backorder"]
  F7 --> G1
  F7 -.->|"backorder re-enters"| C1
  F6 -->|"decline"| F1

  F1 --> F4["Stock replenished"]
  F4 --> F5["Warehouse rechecks inventory"]
  F5 -->|"now sufficient"| E1
  F5 -->|"still short"| F1
```

## 4. Department Collaboration Plan (RBAC)

| Department | Role | Owns in order lifecycle | System module |
|---|---|---|---|
| Sales / Order Desk | `SALES`, `RELATIONSHIP_MANAGER` *(existing)* | Receives order, dealer communication, sends notices | Order Management, Dealer 360 |
| Warehouse / Inventory | `WAREHOUSE` *(new)* | Check Inventory, stock allocation, Disputed Orders queue | Vehicle Inventory, Order Management |
| Finance | `FINANCE` *(new)* | Dealer credit-limit / payment-terms gate before dispatch | Finance Cases, Dealer 360 |
| Warehouse / Logistics | `WAREHOUSE` or `LOGISTICS` *(new)* | Dispatch → Delivered, shipment tracking | Order Management |
| Marketing | `MARKETING` *(new)* | Lead-gen & campaigns — upstream of orders only | Campaign Management |
| Admin / System Admin | `ADMIN`, `SYSTEM_ADMIN` *(existing)* | Oversight across all departments | All modules |

**Status:** `WAREHOUSE`, `FINANCE`, `MARKETING` now exist on `UserRole` and are wired **additively** into the routes in their row (Order Management + Check Inventory + Disputed Orders + Spare Part Inventory accept `WAREHOUSE`, Finance Cases accepts `FINANCE`, Campaign Management accepts `MARKETING` — always alongside `ADMIN`/`SYSTEM_ADMIN`, never instead of).
**Known gap:** `requireAuth` is still a dev-only stub (`apps/api/src/middleware/auth.middleware.ts`) that defaults every request to `SYSTEM_ADMIN` regardless of who's logged in — so today these roles don't yet *restrict* anyone in practice. Real enforcement needs `requireAuth` to resolve the logged-in user's actual role from their session, not the stub default — that's the next step, not a UI change.

## 5. Disputed Orders — Best Fit & Partial Fulfillment

- **Sort: best fit** groups disputed orders competing for the same item (model+segment, or same spare part) and ranks them by ascending shortfall against *live* stock, tied-broken by largest quantity — the order closest to being fully fulfillable from what's on hand is flagged "Best fit."
- Staff can send a notice with an **offered quantity** (e.g. "155 of 160 now"). The dealer sees this in DMS and can **Accept** (splits the order — offered quantity ships now as `APPROVED`, the remainder becomes a fresh `REQUESTED` backorder, `STR-2026-0000xx`, so demand is never silently lost) or **Decline** (order stays in Disputed Orders).
