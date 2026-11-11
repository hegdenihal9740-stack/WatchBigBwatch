# Big B Watch Boutique

https://github.com/hegdenihal9740-stack/bigbwatches run

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://big-b-watch-boutique.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/29078dc8-ad52-4af3-872b-b1f1c50a70c2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

To preview a production build on your local network, run `npm run build` and then `npm run preview`. The Wrangler preview loads server environment variables from the root `.env`; restart the preview after changing them.

## Backend setup

The store backend uses Supabase for customer accounts, profiles, orders, inventory, products, reviews, review-image storage, and signed-in customer cart/wishlist sync. Server-side seller and order operations run through TanStack Start server functions and require `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and a server-only `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Copy `.env.example` to `.env` for local development; `.env` files are git-ignored. Never use a secret/service-role key in a `VITE_` variable or expose it to browser code.

Before deploying backend changes, apply the SQL migrations in `drizzle/migrations` to the intended Supabase database with `npm run db:migrate`. The command reads `LOVABLE_DB_MIGRATION_URL`; use a database URL for the correct project and never expose it in client-side variables. In Lovable, apply migrations through the connected project's database migration workflow or SQL editor if a migration URL is unavailable. Migration `0001_server_validated_orders` validates COD prices and stock, moves seller writes behind authenticated server functions, restricts direct table writes, adds per-customer cart and wishlist storage, and validates review ownership and delivered purchases. Migration `20261026120602_product_image_gallery` adds product image galleries and configures the public product-images bucket.

Migration `20261027104500_product_catalog_role_permissions` separates public active-product reads from authenticated admin reads, preventing anonymous catalog requests from invoking the restricted `has_role` function. Apply this migration to the same Supabase project configured in the app.

Migration `20261027121800_manage_all_watch_prices` seeds the four original watches into the managed catalog, enables their seller price/MRP and hide/restore controls, and makes COD order validation use the active database catalog prices. Apply it after the other migrations.

Checkout supports cash on delivery and UPI through Razorpay Checkout. UPI Collect (manual UPI ID entry) is hidden; Razorpay selects the supported UPI flow for the device, typically app intent on mobile and a QR code on desktop. QR availability on mobile may require Razorpay account enablement. The options that appear also depend on Razorpay account settings. An order is confirmed only after server-side payment verification.

Migration `20261029064858_razorpay_payment_orders` adds a private Razorpay payment-attempt table, a webhook event-deduplication table, and a transaction-safe payment finalizer. Apply it to the same Supabase project as the application before enabling Razorpay checkout. The migration keeps attempts inaccessible to browser roles and creates ordinary orders, reserves inventory, and clears a synced cart only after the server verifies a captured payment. If stock becomes unavailable after a customer pays, the attempt is marked for store review rather than reported as an ordinary confirmed order.

For development, enable Test Mode in the Razorpay Dashboard and set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in the server `.env` or hosting secrets. Obtain the Test Mode Key ID and Key Secret from Razorpay Dashboard → Account & Settings → API Keys. Never use a `VITE_` prefix or expose the Key Secret or webhook secret in browser code. In Razorpay Dashboard → Account & Settings → Webhooks, add `https://<your-public-app-origin>/api/webhooks/razorpay`, choose a webhook secret, and subscribe to `payment.captured`, `payment.failed`, and `payment.authorized`. Put that webhook secret in `RAZORPAY_WEBHOOK_SECRET`. Razorpay cannot deliver webhooks to localhost directly; test callbacks on a public staging deployment. Checkout also has a signed-in Check Payment Status action that fetches the payment from Razorpay's API if a webhook is delayed.

After sandbox testing, production requires an approved Razorpay merchant account, Live Mode API keys, a registered production webhook using the live webhook secret, and production server secrets. Replace the Test Mode values only after approval and before accepting live payments. UPI must be enabled for the account.

Configure `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) only as a server-side secret in the local `.env` or hosting environment. COD checkout uses the signed-in customer's authenticated Supabase connection and does not require this key; seller management and product image uploads use the server key. Do not paste secrets into chat, commit them, or add a `VITE_` prefix.

Order email notifications use Resend. Set `RESEND_API_KEY` and a Resend-verified `RESEND_FROM_EMAIL` as server-side secrets. Customer confirmations go to the customer's signed-in account email; new COD and Razorpay-confirmed orders also send an alert to the store contact in `src/lib/store-info.ts`. Seller status changes (including cancellations) send email updates. SMS notifications are not used. If email delivery fails, the order remains placed/updated and the UI explicitly reports the email notification issue.

Google sign-in uses Supabase Auth directly. In Supabase, enable Google under Authentication → Providers and enter the Google OAuth client ID and secret. In Google Cloud Console, add Supabase's callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) as an authorized redirect URI. Set Supabase's Site URL to the production app origin and add every app origin used for testing to Authentication → URL Configuration → Redirect URLs. The local dev server uses port `8090`; add `http://localhost:8090/**` and `http://127.0.0.1:8090/**`. To use a phone, connect it to the same Wi-Fi and add `http://<this-computer-LAN-IP>:8090/**` (for example, `http://192.168.1.14:8090/**`). Also add the production origin `https://big-b-watch-boutique.lovable.app/**` (replace this with the actual published app origin if it differs). Redirect URLs must cover both the `/auth` sign-in/confirmation callback and `/reset-password` recovery callback. Supabase must allow the exact origin passed as `redirectTo`; if it is not allow-listed, Supabase can fall back to the configured Site URL, which may be a different origin and cannot access the browser's saved return path. In Google Cloud's OAuth client, keep Supabase's callback URL as the authorized redirect URI; add local app origins as authorized JavaScript origins only if Google requires them for the configured web client. If the LAN IP changes, update the corresponding Supabase Redirect URL.

For password-reset emails, ensure the exact production URL `https://<your-app-origin>/reset-password` is also present under Supabase Authentication → URL Configuration → Redirect URLs. The app requests this destination and can recover a PKCE callback that lands at the site root in the same browser, but Supabase must allow the reset URL for the reset form to open reliably across devices and browsers.

Run `npm test` and `npm run build` before deploying. These commands validate the local application; they do not apply migrations or confirm production Supabase configuration.
