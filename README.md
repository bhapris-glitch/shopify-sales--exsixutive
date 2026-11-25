# Zavoka AI

Static storefront and merchant dashboard for Zavoka AI. The repository is configured to deploy the frontend to Cloudflare Workers and a Supabase Edge Function from GitHub.

## Hosting configuration

- `wrangler.toml` and `src/worker.js` serve the existing root-level HTML, CSS, JavaScript, and public assets from a Cloudflare Worker. `/api/*` is forwarded to the Supabase `api` Edge Function.
- `.assetsignore` prevents backend source, Supabase function source, and deployment metadata from being published as website assets.
- `supabase/functions/api/index.ts` currently implements only `GET /api/health` and `GET /api/plans`. All other API routes return HTTP 501 until they are migrated.
- `.github/workflows/deploy-cloudflare.yml` deploys on pushes to `main`. `.github/workflows/deploy-supabase.yml` deploys the API function when Supabase files change.
- `backend/server.js` is the existing Express/Firebase implementation. It is retained as a migration reference; it is not deployed by these workflows. Its business API, data model, Shopify integration, Stripe integration, scheduled tasks, and authentication have **not** yet been ported to Supabase.

## Connect GitHub deployments

1. Push this repository to GitHub and use the `main` branch as the deployment branch.
2. In Cloudflare, create an API token with Workers Scripts edit permission. Add GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Replace `YOUR_PROJECT_REF` in `wrangler.toml` with the Supabase project reference. Set the Worker secret `SUPABASE_ANON_KEY` in the Cloudflare Worker settings to that project's publishable/anon key.
4. Add GitHub repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` to deploy the Edge Function.
5. Set a custom domain for the Worker in Cloudflare if required. Use the same domain for the Shopify and Stripe webhook URLs after those API routes have been migrated.

The workflows make GitHub the source of deployed code. Cloudflare and Supabase project creation, secrets, custom domains, DNS, Shopify credentials, and Stripe credentials must be configured in their respective dashboards. Never commit service-role keys or third-party API secrets.

## Important migration status

The current frontend calls numerous `/api/*` routes for installation, login, dashboard data, Shopify OAuth/webhooks, Stripe billing/webhooks, AI chat, and email. Those routes still exist only in `backend/server.js`, which imports Express and Firebase Admin and uses a Firestore adapter. That server cannot run as a Supabase Edge Function unchanged. The new Supabase function is only an initial deployment scaffold; do not launch customer flows or configure live Shopify/Stripe webhooks against it yet.

A complete backend migration requires porting each route to Edge Functions, migrating Firestore data and queries to a PostgreSQL schema, adding Supabase authentication/authorization and Row Level Security, and replacing the existing in-process scheduled jobs. Keep the legacy backend files until that migration and any required data export are complete.

## Repository notes

The existing `backend/.env.example` describes credentials used by the legacy Express/Firebase backend and is not a deployment environment file. The public website files remain at the repository root; the Worker asset configuration uses `.assetsignore` to exclude server-side files.

## Security and production checklist

- Keep the Supabase service-role key, Stripe secrets, Shopify secrets, OpenAI key, and email-provider key out of the browser and source control.
- The function is currently configured with `verify_jwt = false` so the public health/plans endpoints can be reached through the Worker. Add route-level authentication and authorization before implementing private endpoints.
- Validate authentication, database policies, webhook signatures, CORS behavior, and scheduled work before moving production traffic.
- Review the remaining product, privacy, billing, and legal documentation before launch.

The repository configuration cannot create Cloudflare/Supabase projects, provision secret values, migrate live data, or confirm DNS and third-party webhook delivery.

## Existing product documentation

The remaining sections below describe existing product functionality and the legacy API implementation. Treat them as implementation notes, not proof that those routes have already been migrated to Supabase.


## Production launch checklist

Before launch, verify all of the following in the deployed environment:

- The frontend is served over HTTPS at the production website URL.
- The backend is deployed on Google Cloud Run and reachable over HTTPS.
- `firebase.json` points to the deployed Cloud Run service ID and region.
- The production MongoDB database is reachable by the backend.
- Stripe is using live-mode credentials and live recurring Prices.
- The Stripe webhook is delivering events successfully.
- Shopify OAuth credentials and the callback URL match the deployed domains.
- DNS, SSL certificates, CORS, and email sender configuration are active.
- A live-mode test subscription has been completed and verified through the webhook.
- The success redirect, dashboard billing details, and PDF download have been checked.

Workspace code cannot verify deployed DNS, environment values, external service connectivity, Stripe approval, or webhook delivery. Those items must be confirmed in the hosting, Stripe, Shopify, MongoDB, and email provider dashboards.

## Stripe integration

The backend supports real Stripe Checkout subscriptions and signed webhook processing.

### Required environment variables

Set these values in the backend production environment. Do not commit secrets or a real `.env` file.

```env
FRONTEND_URL=https://zavoka.com

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_GROWTH_PRICE_ID=price_...
STRIPE_PREMIUM_PRICE_ID=price_...
```

The three Price IDs must refer to recurring monthly USD Prices that match the public pricing page:

- Starter — $25/month
- Growth — $59/month
- Premium — $149/month

### Stripe webhook

Register this endpoint in Stripe:

```text
POST https://zavoka.com/api/stripe/webhook
```

Replace the hostname if the backend is deployed elsewhere. Configure these events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The webhook:

- Verifies the raw Stripe request body and signature.
- Ignores duplicate event IDs.
- Stores the Stripe customer, subscription, invoice, plan, status, and payment date.
- Unlocks paid access only after verified Stripe state is stored.
- Handles paid, canceled, and failed-payment states.
- Sends optional merchant notifications when Resend is configured.

Use the webhook signing secret generated for the same Stripe mode as the secret key. A live secret must be used for live payments.

## Successful payment and billing flow

1. The customer selects Starter, Growth, or Premium.
2. The frontend sends the selected plan to `/api/checkout`.
3. The backend creates a Stripe subscription Checkout Session.
4. Stripe redirects the customer to:

   ```text
   /dashboard.html?checkout=success&merchantId=...
   ```

5. The dashboard waits for the verified webhook state.
6. After the subscription is confirmed, the dashboard shows:
   - `Recharge successfully completed`
   - Plan and subscription status
   - Billing email
   - Monthly amount and currency
   - Payment date
   - Stripe subscription ID
   - A browser-generated PDF billing-details download

If the customer returns before the webhook is processed, the dashboard displays a payment-pending message rather than falsely claiming that the subscription is active.

## Shopify installation

Required Shopify variables:

```env
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_SCOPES=read_products,read_orders,read_checkouts,read_content,read_script_tags,write_script_tags
SHOPIFY_API_VERSION=2025-01
SHOPIFY_REDIRECT_URI=https://zavoka.com/api/shopify/callback
```

The installation form validates a store domain, creates a 5-day Premium trial with 50 AI chats, and redirects the merchant to Shopify OAuth. The callback validates the OAuth state and Shopify HMAC before storing the access token. It also syncs the initial product catalog, registers Shopify order/checkout/uninstall webhooks, and installs the storefront widget script.

## Shopify checkout, orders, and email automation

The Shopify OAuth scopes must include `read_products`, `read_orders`, `read_checkouts`, `read_content`, `read_script_tags`, and `write_script_tags`. `read_content` is used to sync published store policies. Merchants must reconnect after changing scopes. Verify the app's access to order and checkout data in Shopify before enabling production automations.

On an authorized install, the API registers these signed webhook routes:

- `POST /api/shopify/webhooks/orders-create`
- `POST /api/shopify/webhooks/orders-update`
- `POST /api/shopify/webhooks/checkouts-create`
- `POST /api/shopify/webhooks/checkouts-update`
- `POST /api/shopify/webhooks/products-create`
- `POST /api/shopify/webhooks/products-update`
- `POST /api/shopify/webhooks/products-delete`
- `POST /api/shopify/webhooks/fulfillments-create`
- `POST /api/shopify/webhooks/fulfillments-update`
- `POST /api/shopify/webhooks/app-uninstalled`

Order webhooks maintain fulfillment and order-status links for the merchant dashboard. Checkout webhooks maintain cart records. The dashboard lets a merchant enable a single recovery email and select a delay; a recovery job is queued only when Shopify checkout data records explicit marketing consent. The job rechecks consent, app connection, automation state, and an email suppression list before sending; each message includes an unsubscribe link. Email is sent through Resend (`RESEND_API_KEY` and `FROM_EMAIL`). Failed deliveries retry hourly up to five attempts. Disable the automation in the dashboard to stop pending sends.

The backend's in-process scheduled jobs check due recovery emails every five minutes, trial notifications every 15 minutes, and refresh the Shopify catalog every six hours. Keep at least one backend instance running; multiple instances are safe for cart jobs because each task is atomically claimed in MongoDB. Shopify webhook delivery IDs, order IDs, and checkout IDs have database indexes for deduplication and efficient reads.

The storefront widget is installed as a Shopify script tag. It loads public branding through `GET /api/storefront/config`, sends shopper turns to `POST /api/storefront/chat`, and uses the synced catalog (titles, descriptions, prices, variants, availability, images, tags, product types, vendors, options, and collections) to filter and rank recommendations against shopper intent, requested colors, and price limits. Product sync paginates Shopify's product, collection, and collect endpoints. Published Shopify policies and relevant published FAQ, shipping, returns, and store-information pages are synced where permissions allow; unpublished pages are excluded. Merchants can add verified business information, shipping, returns, FAQ and approved-discount details, set preferred product IDs, and choose widget position in the dashboard. The assistant must not invent products, prices, inventory, discounts, or policies.

Product cards let shoppers view products, add available variants to the Shopify cart, or proceed to checkout. Add-to-cart and product-click events carry visitor and conversation IDs. Checkout buttons submit Shopify variant IDs to `POST /api/storefront/checkout`; the backend revalidates each available variant, then attaches visitor and conversation identifiers to Shopify cart attributes. Shopify checkout/order webhooks use those attributes (or the saved checkout record) to attribute purchases and revenue to the assistant. Product clicks, checkout starts, conversations, leads, attributed orders, recent conversations, and the synced catalog are available in the merchant dashboard. `POST /api/storefront/lead` stores a shopper email only after explicit follow-up consent. Set `FRONTEND_URL` to the public host serving the widget assets and API rewrite.

Dashboard analytics use Shopify order webhooks and checkout actions to show tracked order totals, checkout conversion, revenue, and recovered carts. Order status and tracking links are visible under **Order tracking**.

### Cancellation, uninstall, and data deletion

Merchants cancel recurring billing from **Dashboard → Billing → Cancel subscription**. Stripe confirms cancellation at the end of the current billing period; the dashboard displays that end date. The Sales Executive uninstall action is blocked until an existing paid subscription has cancellation scheduled. Merchants must then confirm app removal in Shopify Admin. Shopify's signed `app/uninstalled` webhook schedules cancellation if needed and removes the merchant's app data from MongoDB. Global platform configuration and non-identifying webhook event IDs are retained; Stripe may retain billing records under its own legal and retention requirements. Deletion only begins after Shopify confirms app removal, and webhook/Stripe failures must be resolved before deletion can complete.


## Trial and access rules

- Trial length: 5 days.
- Trial plan: Premium features.
- Trial allowance: 50 AI chats.
- A trial ends when the time limit or chat limit is reached.
- Paid access requires an active or trialing subscription and a stored Stripe subscription ID.
- Trial and billing notifications are optional and require Resend configuration.

Optional email variables:

```env
RESEND_API_KEY=re_...
FROM_EMAIL="zavoka AI <notifications@zavoka.com>"
```

## AI chat

The storefront sales agent uses `OPENAI_API_KEY` and `OPENAI_MODEL` for contextual, multi-turn natural-language sales conversations. Without an OpenAI key or if the model is unavailable, it falls back to grounded rule-based product matching, clarifying questions, objection prompts, and verified-policy answers; no products or policy details are invented.

```env
OPENAI_API_KEY=sk-proj_...
OPENAI_MODEL=gpt-4o-mini
OPENAI_PREMIUM_MODEL=gpt-5
```

The production backend should have an appropriate model configured and sufficient account access before enabling AI responses for customers.

## SEO readiness

Public SEO files and metadata are included:

- Canonical URLs on public pages.
- Meta descriptions.
- Open Graph metadata.
- Twitter summary metadata where configured.
- SoftwareApplication JSON-LD on the homepage.
- `robots.txt` with dashboard, admin, and backend exclusions.
- `sitemap.xml` containing public pages only.
- `noindex,nofollow` on merchant and admin dashboards.

After deployment, submit `https://zavoka.com/sitemap.xml` to the relevant search console and confirm that the canonical domain, HTTPS redirects, and robots rules resolve correctly.

## Link audit

The public navigation and footer link to workspace pages that exist:

- `index.html`
- `pricing.html`
- `enterprise.html`
- `about.html`
- `contact.html`
- `terms.html`
- `privacy.html`
- `cookies.html`
- `refunds.html`
- `dpa.html`
- `subprocessors.html`
- `do-not-sell.html`
- `dashboard.html`
- `admin.html`
- `index.html#install`
- `index.html#features`

Firebase Hosting is configured in `firebase.json` to rewrite `/api/**` to the Cloud Run service. Replace the sample `serviceId` and `region` with the deployed Cloud Run service name and region before publishing. The frontend currently uses the backend's merchant-session login and MongoDB data; Firebase Authentication and Firestore are not configured. Email links and external Stripe, Shopify, Gmail, and API links require their corresponding production services to be configured.

## Backend API overview

The backend provides:

- `GET /api/health`
- `GET /api/plans`
- `POST /api/install`
- `GET /api/shopify/callback`
- `GET /api/storefront/config`
- `GET /api/storefront/products`
- `POST /api/storefront/chat`
- `POST /api/storefront/event`
- `POST /api/storefront/add-to-cart-event`
- `GET /api/merchant/v1-event-metrics`
- `POST /api/storefront/lead`
- `POST /api/storefront/checkout`
- `GET /api/merchant/v1-overview`
- `POST /api/checkout`
- `POST /api/stripe/webhook`
- Shopify order, checkout, and uninstall webhooks listed above
- `GET` / `PUT /api/merchant/automation`
- `GET /api/merchant/settings`
- `PUT /api/merchant/settings`
- `GET /api/merchant/billing`
- `GET /api/merchant/cancellation`
- `POST /api/merchant/cancel-subscription`
- `POST /api/merchant/uninstall`
- `POST /api/chat/message`
- `POST /api/enterprise`
- `GET /api/admin/metrics`
- `GET /api/dashboard`

## Security notes

- Keep Stripe, MongoDB, Shopify, OpenAI, and email-provider secrets out of source control.
- Use HTTPS for the frontend, backend, Stripe webhook, and Shopify callback.
- Use the live Stripe webhook signing secret with live payments.
- Restrict admin metrics with authentication before exposing `admin.html` publicly.
- Review Shopify scopes and request only the permissions required by the application.
- Configure production CORS to the actual frontend origin; only the public, credential-free Shopify storefront routes allow wildcard origins.
- Review privacy, terms, billing, cancellation, and data-retention language before public launch.