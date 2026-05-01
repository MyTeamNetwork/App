# Dev-Admin Feature Documentation

## Overview

Dev-admin access gives allowlisted developer accounts broad read/debug access across organizations and enterprises without requiring explicit membership in each one.

The implementation is driven by `src/lib/auth/dev-admin.ts`, middleware checks in `src/middleware.ts`, and org/enterprise route integration in the app layer.

## Configuration

- Dev-admin emails are loaded from the `DEV_ADMIN_EMAILS` environment variable.
- The allowlist is no longer hardcoded in the repo.
- Example:

```bash
DEV_ADMIN_EMAILS="admin1@example.com,admin2@example.com"
```

## Current Capabilities

Dev-admins can currently:

1. View org-scoped pages without org membership.
2. View enterprise-scoped pages without enterprise membership.
3. Open the Dev Panel and enterprise modal UI used for diagnostics.
4. Access subscription details and Stripe-related debug data when service-role access is available.
5. Use the dev-admin organization and enterprise APIs.
6. Perform a limited set of privileged actions such as subscription reconciliation, billing-portal access, org deletion, and error-group management.

Current allowed actions are defined by `DevAdminAction` and `canDevAdminPerform()` in `src/lib/auth/dev-admin.ts`.

## Visibility and Audit Behavior

- Dev-admins are intentionally hidden from regular member lists.
- The sidebar and mobile nav show a visible dev-admin indicator.
- Middleware and API actions are audit logged with dev-admin-specific context.

## Implementation Notes

### Middleware

- Org and enterprise membership checks are bypassed for allowlisted dev-admin emails.
- Middleware writes audit entries for org and enterprise views when a dev-admin path is taken.

### Org Layout

- `src/app/[orgSlug]/layout.tsx` treats dev-admins as elevated viewers.
- Service client initialization is already defensive: missing service-role config logs a warning instead of crashing the page.

### API Surfaces

Notable dev-admin-aware routes include:

- `src/app/api/dev-admin/organizations/route.ts`
- `src/app/api/dev-admin/enterprises/route.ts`
- `src/app/api/organizations/[organizationId]/reconcile-subscription/route.ts`
- `src/app/api/organizations/[organizationId]/route.ts`
- `src/app/api/stripe/billing-portal/route.ts`
- `src/app/api/organizations/[organizationId]/subscription/route.ts`

## Operational Caveats

1. Dev-admin access only works for existing organizations and enterprises; it does not invent missing slugs.
2. Some views are richer when `SUPABASE_SERVICE_ROLE_KEY` is configured because the UI can fetch extra diagnostic data.
3. Dev-admins are not unrestricted superusers; action-level permissions are explicitly allowlisted in code.

## Troubleshooting

- If dev-admin access is not recognized, verify the email is present in `DEV_ADMIN_EMAILS`.
- If diagnostic panels are missing Stripe/subscription details, verify `SUPABASE_SERVICE_ROLE_KEY` is available.
- If a slug returns 404, verify the org or enterprise actually exists in the current environment.
