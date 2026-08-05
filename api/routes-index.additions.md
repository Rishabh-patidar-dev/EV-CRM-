# Wiring the new routes

## 1. `apps/api/src/routes/index.ts`

Add the imports near the other route imports:

```ts
import ingestRoutes from "./ingest.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
```

Mount them inside `setupRoutes(app)`. The ingest webhook is **public** (like the
existing `/api/webhook` mount); onboarding is **protected** (auth is inside the
router):

```ts
// Public dual-intent ingestion webhook (landing page portal)
app.use("/api/v1/ingest", ingestRoutes);

// Protected onboarding pipeline (Network Expansion / Admin)
app.use("/api/v1/onboarding", onboardingRoutes);
```

> Keep the existing `/api/webhook/landingi` route as-is if Landingi is still
> live — the new `/api/v1/ingest/landing-page` is the EV-specific superset that
> adds dual-intent routing + UTM. You can point the intern's portal at the new
> endpoint and retire the old one later.

## 2. Sidebar nav — `apps/web/components/appSidebar.tsx`

Add a "Dealer Network" group (follow the existing `label`/`href` item pattern):

```tsx
{/* Dealer Network */}
<SidebarGroup label="Dealer Network">
  <SidebarItem label="Onboarding Pipeline" href="/dealer-onboarding" />
  <SidebarItem label="Dealers (DMS)" href="/dealers" />          {/* Module 2 */}
  <SidebarItem label="Purchase Orders" href="/purchase-orders" />{/* Module 5 */}
</SidebarGroup>
```

(Use whatever the actual item/group components are named in your file — the grep
showed `label=` / `href=` props, so match those.)

## 3. Environment

Optional HMAC verification for the ingest webhook — add to `.env`:

```
INGEST_WEBHOOK_SECRET=your-shared-secret-with-the-landing-page
```

If unset, the webhook accepts unsigned posts (fine for local/dev). The landing
page should send the raw body signed as `sha256=<hmac>` in `x-signature`.
