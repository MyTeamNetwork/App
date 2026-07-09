/**
 * `lib/organizations` — one typed org-context resolution path.
 *
 * Foundation module (U10). Composes the proven auth + read-only preamble
 * helpers into a single resolver with typed denials, ready for the org route
 * migrations (U11–U14). No route wiring lives here yet.
 */

export {
  resolveOrgContext,
  resolveAdminContext,
  resolveMemberContext,
  type OrgContext,
  type OrgContextResult,
  type OrgDenialReason,
  type OrgAccessLevel,
  type ResolveOrgContextOptions,
  type ResolveOrgContextDeps,
  type MembershipLookup,
} from "./context";

export {
  denialResponse,
  readOnlyDenialResponse,
  readOnlyGuard,
  unauthorizedResponse,
} from "./errors";

export { orgIdParam, parseOrgId } from "./schemas";

export {
  updateOrgSettings,
  getOrgAuditMetadata,
  deleteOrganization,
  getOrgIdBySlug,
  type OrgSettingsUpdate,
  type OrgSettingsView,
  type UpdateOrgSettingsResult,
  type OrgAuditMetadata,
  type OrgBySlugResult,
} from "./settings";
