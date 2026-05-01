# Stripe Production Setup

This document describes the current production Stripe configuration expected by the app. The source of truth for required env names is `next.config.mjs` and `src/lib/stripe.ts`.

## Required Environment Variables

### Core Stripe Keys

| Env Variable | Notes |
|--------------|-------|
| `STRIPE_SECRET_KEY` | Live secret key in production |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Live publishable key in production |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook` |
| `STRIPE_WEBHOOK_SECRET_CONNECT` | Signing secret for `/api/stripe/webhook-connect` |

### Organization Subscription Price IDs

| Env Variable |
|--------------|
| `STRIPE_PRICE_BASE_MONTHLY` |
| `STRIPE_PRICE_BASE_YEARLY` |
| `STRIPE_PRICE_ALUMNI_0_250_MONTHLY` |
| `STRIPE_PRICE_ALUMNI_0_250_YEARLY` |
| `STRIPE_PRICE_ALUMNI_251_500_MONTHLY` |
| `STRIPE_PRICE_ALUMNI_251_500_YEARLY` |
| `STRIPE_PRICE_ALUMNI_501_1000_MONTHLY` |
| `STRIPE_PRICE_ALUMNI_501_1000_YEARLY` |
| `STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY` |
| `STRIPE_PRICE_ALUMNI_1001_2500_YEARLY` |
| `STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY` |
| `STRIPE_PRICE_ALUMNI_2500_5000_YEARLY` |

### Enterprise Subscription Price IDs

| Env Variable | Notes |
|--------------|-------|
| `STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY` | Per alumni bucket |
| `STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY` | Per alumni bucket |
| `STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY` | Additional sub-org pricing |
| `STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY` | Additional sub-org pricing |

## Validation Rules

- Price IDs must start with `price_`.
- `STRIPE_WEBHOOK_SECRET_CONNECT` and `CRON_SECRET` are hard requirements on Vercel production builds; local development only warns.
- The app checks these env vars in `next.config.mjs` before build completion.

## Current Code Paths

### Organization Checkout

- UI: `src/app/app/create-org/page.tsx`
- API: `src/app/api/stripe/create-org-checkout/route.ts`
- Price mapping: `src/lib/stripe.ts`
- Subscription webhook: `src/app/api/stripe/webhook/route.ts`

### Enterprise Checkout and Billing

- UI: `src/app/app/create-enterprise/page.tsx`
- Checkout API: `src/app/api/stripe/create-enterprise-checkout/route.ts`
- Billing overview API: `src/app/api/enterprise/[enterpriseId]/billing/route.ts`
- Billing adjustment API: `src/app/api/enterprise/[enterpriseId]/billing/adjust/route.ts`
- Billing portal API: `src/app/api/enterprise/[enterpriseId]/billing/portal/route.ts`
- Enterprise pricing logic: `src/lib/enterprise/pricing.ts`

## Webhooks

### Main Stripe Webhook

- Endpoint: `https://www.myteamnetwork.com/api/stripe/webhook`
- Handles organization subscriptions and enterprise subscription events

### Connect Webhook

- Endpoint: `https://www.myteamnetwork.com/api/stripe/webhook-connect`
- Handles Stripe Connect donation events

## Production Verification Checklist

1. Confirm all env vars above are set on the production Vercel project.
2. Redeploy after changing Stripe env vars.
3. Verify logs from org checkout show live-mode Stripe keys and valid `price_` IDs.
4. Verify enterprise checkout uses the enterprise price env vars and that billing adjustments hit `/api/enterprise/[enterpriseId]/billing/adjust`.
5. Verify both webhook endpoints receive events and return success in Stripe's event destination logs.

## Notes

- The old alumni bucket env names such as `0_200`, `201_600`, and `601_1500` are obsolete.
- Do not rely on this document for live price values; confirm the active price IDs directly in Stripe before updating production env vars.
