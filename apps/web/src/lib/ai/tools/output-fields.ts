/**
 * Output-key allowlists per tool — the single source of truth shared by each
 * tool's Zod `fields` enum and its lean default. These are the keys each tool
 * EMITS (including derived keys like `name`/`title`), not raw DB columns.
 *
 * CLIENT-SAFE: this module is pure data with zero runtime imports, so it can be
 * pulled into a client bundle. It was split out of `shared.ts` precisely so that
 * `tools/definitions.ts` (the tool SCHEMAS, reachable from the client via
 * `capabilities.ts` → `AIPanel.tsx`) can import these field lists WITHOUT
 * dragging in `shared.ts`'s server-only chain (`aiLog` → `errors/sanitize` →
 * `node:async_hooks`), which breaks the webpack/client build. Keep this file
 * import-free.
 */

export const MEMBER_OUTPUT_FIELDS = [
  "id",
  "user_id",
  "status",
  "role",
  "created_at",
  "name",
  "email",
  "current_company",
  "industry",
  "headline",
  "summary",
  "skills",
  "certifications",
  "languages",
] as const;

export type MemberOutputField = (typeof MEMBER_OUTPUT_FIELDS)[number];

/**
 * Lean default for list_members. Drops the heavy LinkedIn fields (summary,
 * headline, skills, certifications, languages, industry) — those are opt-in via
 * `fields`. The keys below are the minimum the DETERMINISTIC consumers require
 * and therefore cannot be trimmed by default:
 *  - id, name, role, email — identity + grounding (verifyListMembers).
 *  - created_at — "added {date}" in formatMembersResponse / formatLookupPersonRow.
 *  - current_company — matched by the global-lookup rowMatchesLookup() ("who
 *    works at Google?"), a server path the model does not control.
 * Do not remove these to save tokens without first updating those consumers.
 */
export const MEMBER_LEAN_DEFAULT_FIELDS: readonly MemberOutputField[] = [
  "id",
  "name",
  "role",
  "email",
  "created_at",
  "current_company",
];

export const EVENT_OUTPUT_FIELDS = [
  "id",
  "title",
  "start_date",
  "end_date",
  "location",
  "description_preview",
] as const;

export type EventOutputField = (typeof EVENT_OUTPUT_FIELDS)[number];

export const MEMBER_PREFERENCE_OUTPUT_FIELDS = [
  "user_id",
  "name",
  "email",
  "as_mentor",
  "as_mentee",
] as const;

export type MemberPreferenceOutputField =
  (typeof MEMBER_PREFERENCE_OUTPUT_FIELDS)[number];
