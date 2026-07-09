import { baseSchemas } from "@/lib/security/validation";

/**
 * Shared Zod schemas for the org-scoped API surface.
 *
 * Intentionally thin for now — the org-context resolver only needs to validate
 * the `organizationId` route param. This module is the single home for org
 * request-shape validation as later phases (U11–U14) migrate route bodies here.
 */

/** UUID validator for the `organizationId` path param. Reuses the shared base. */
export const orgIdParam = baseSchemas.uuid;

/**
 * Parse an untrusted `organizationId` route param into a validated UUID string.
 * Returns a discriminated result so callers can branch without throwing on the
 * expected "bad param" path (a 400, not a server error).
 */
export function parseOrgId(
  raw: unknown
): { ok: true; orgId: string } | { ok: false } {
  const parsed = orgIdParam.safeParse(raw);
  return parsed.success ? { ok: true, orgId: parsed.data } : { ok: false };
}
