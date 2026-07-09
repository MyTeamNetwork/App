import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression guard: every confirmed-vulnerable destructive admin route
 * must route its caller through a status-aware admin check so a revoked admin
 * cannot retain access. Two forms satisfy this: the original
 * `requireActiveOrgAdmin` helper, or the `lib/organizations` context resolver
 * (`resolveAdminContext` / `resolveOrgContext(..., "admin", ...)`), which
 * composes the same `getActiveAdminMembership` status check. If a route gets
 * refactored back to a role-only pattern that ignores membership status this
 * test fails.
 */

const A1_ROUTES = [
  "src/app/api/organizations/[organizationId]/route.ts",
  "src/app/api/organizations/[organizationId]/cancel-subscription/route.ts",
  "src/app/api/organizations/[organizationId]/resume-subscription/route.ts",
  "src/app/api/stripe/billing-portal/route.ts",
  "src/app/api/organizations/[organizationId]/members/[memberId]/reinstate/route.ts",
  "src/app/api/organizations/[organizationId]/adoption-requests/[requestId]/route.ts",
  "src/app/api/organizations/[organizationId]/adoption-requests/[requestId]/accept/route.ts",
  "src/app/api/organizations/[organizationId]/adoption-requests/[requestId]/reject/route.ts",
  "src/app/api/organizations/[organizationId]/start-checkout/route.ts",
  "src/app/api/organizations/[organizationId]/reconcile-subscription/route.ts",
];

const ROOT = resolve(__dirname, "../..");

for (const relPath of A1_ROUTES) {
  test(`${relPath} uses requireActiveOrgAdmin`, () => {
    const source = readFileSync(resolve(ROOT, relPath), "utf8");
    // Accept either the direct helper or the context resolver that composes it —
    // both enforce the active-membership status check the guard protects.
    assert.match(
      source,
      /requireActiveOrgAdmin|resolveAdminContext|resolveOrgContext/,
      `${relPath} must enforce the status-aware admin check (requireActiveOrgAdmin or resolveAdminContext)`
    );
    assert.doesNotMatch(
      source,
      /role\?\.role !== "admin"\s*\)\s*\{?\s*\n?\s*return respond\(\s*\{\s*error: "Forbidden"\s*\}/,
      `${relPath} still uses raw role-only check that ignores status`
    );
  });
}
