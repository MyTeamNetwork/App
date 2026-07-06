# Networking Features — Audit Follow-Ups

**Date:** 2026-07-06
**Scope:** User-to-user / product networking — connections, discovery/recommendations, mentorship, alumni networks, enterprise multi-org networks, chat/messaging, invites, contact exchange. (Not HTTP transport.)
**Method:** 4 parallel audit agents (backend wiring, web UI, mobile UI, prior-audit diff), cross-verified.

## Verdict

Networking stack is healthier than expected. Mentorship is the strongest domain (RPC-centralized writes, `SECURITY DEFINER` guards, cron expiry). Connections/discovery is a stateless-by-design recommender, fully ported to web + mobile. Chat is wired. Real gaps concentrate in **mobile consent parity**, **alumni read-only freeze bypasses**, and **enterprise invite hardening**.

## Cross-app wiring matrix

| Feature | Backend | Web UI | Mobile UI |
|---|---|---|---|
| Connection suggestions | ✅ wired | ✅ displayed | ✅ displayed |
| Networking consent (`open_to_networking`) | ✅ wired | ✅ toggle | ❌ missing entirely |
| Mentorship (full lifecycle) | ✅ wired | ✅ displayed | ✅ displayed (no message CTA) |
| Alumni directory + detail | ✅ wired | ✅ displayed | ✅ (tab hidden, drawer-only) |
| Chat (group + 1:1-as-group) | ✅ wired | ✅ displayed | ✅ displayed |
| Invites (org / enterprise / parent) | ✅ wired | ✅ | ✅ |
| Mutual connections / follow edges / introductions / vCard | — never built | — | — |

Note: the `connections/suggestions` API route is **not** dead — mobile consumes it (`apps/mobile/src/lib/connections-api.ts:69-96`).

## Already in-flight — do NOT duplicate

- [ ] Alumni `isReadOnly` hardcode + migration ledger repair → **PR #329** (`fix/alumni-readonly-handoff-ledger`)
- [ ] Per-instance in-memory rate limiting → durable Postgres store → **PR #332**
- [ ] Org route auth divergence / org-context resolver → **PR #333**

## SEV-1 — Operational / correctness

- [ ] **Close alumni read-only freeze bypasses.** Three admin-gated mutation routes never call `checkOrgReadOnly()` / `canMutateAlumni()`, so they mutate while an org is frozen/downgraded. Natural follow-up to PR #329.
  - `apps/web/src/app/api/organizations/[organizationId]/alumni/[alumniId]/link-user/route.ts:133` (updates `user_id`)
  - `apps/web/src/app/api/organizations/[organizationId]/alumni/[alumniId]/enrichment-retry/route.ts:98` (resets enrichment)
  - `apps/web/src/app/api/organizations/[organizationId]/alumni/re-invite/route.ts:72,258,287` (updates invite fields **and sends email while frozen**)
- [ ] **Mobile networking-consent gap.** Mobile users are in the suggestion pool but have no in-app way to opt out. Web has `NetworkingConsentToggle` + `PATCH/POST .../connections/networking-consent`; mobile has zero references to `open_to_networking` / `networking-consent`. One-way consent gap — privacy issue, worst user-facing hole.
  - Web reference: `apps/web/src/components/connections/NetworkingConsentToggle.tsx`, `apps/web/src/app/api/organizations/[organizationId]/connections/networking-consent/route.ts`
- [ ] **Enterprise admin-cap redemption race.** `create_enterprise_invite` guards with `pg_advisory_xact_lock`, but `redeem_enterprise_invite` / `complete_enterprise_invite_redemption` enforce the 12-admin cap with a plain `SELECT count` + `INSERT` under no lock. Concurrent redemptions can exceed the cap. Apply the same advisory lock on redeem.
- [ ] **Confirm AI kill switch is intended for this release.** `apps/web/src/lib/ai/assistant-availability.ts:8` → `ASSISTANT_TEMPORARILY_DISABLED = true` returns 503 before the handler (`api/ai/[orgId]/chat/route.ts:17`). Darkens AI-assisted direct/group message send and the `suggestConnections` AI tool. REST suggestions route + `/connections` page still work. (Introduced intentionally in commit `1ac7d80a`.)
- [ ] **Suggestion telemetry / anti-repeat is process-local.** `apps/web/src/lib/people-graph/telemetry.ts:20` uses module-level Maps, reset on restart, not shared across serverless instances → anti-repetition dedup is best-effort per-lambda.

## SEV-2 — Security / RPC hardening

- [ ] **Missing `SECURITY DEFINER` ACLs.** Add `REVOKE`/`GRANT service_role` to match sibling RPCs:
  - `bulk_import_linkedin_alumni` (migrations `20260627000000`, `20260628000000`) — sibling `bulk_import_alumni_rich` has ACL, this doesn't
  - `get_enterprise_member_counts` (migration `20261011100000`) — callable by anon/authenticated unlike sibling stats RPCs
- [ ] **Bulk org invite = one shared code for all recipients.** `apps/web/src/app/api/organizations/[organizationId]/invites/bulk/route.ts:80` sets `uses = emails.length` with no per-email binding — any recipient's code redeems any seat.
- [ ] **Unsigned Wallet member QR.** `apps/web/src/app/api/wallet/member/[orgSlug]/route.ts:136` embeds `teammeet://…?u=<userId>` unsigned (Phase-4 note) — craftable with an arbitrary user id.
- [ ] **Cross-namespace invite-code probing.** `packages/core/src/invites/redeemInvite.ts:48-92` tries one raw code against enterprise → parent → org redeem RPCs (3 trust domains) — error-timing / probing surface.

## SEV-3 — Consistency / UX polish (cheap)

- [ ] **`/connections` missing `loading.tsx` + Suspense.** Sibling `alumni/` and `mentorship/` have `loading.tsx`; connections has none and no internal `<Suspense>`, so a cold nav shows a blank frame during the DB-backed scoring call.
- [ ] **Connections nav item / page status-gate mismatch.** Nav item has no `orgCtx.status` gate but the page requires `status === "active"`, so a pending/suspended member clicks "Connections" and lands on a generic `notFound()` 404. Gate the nav item or give the page a friendlier empty state. (`apps/web/src/lib/navigation/nav-items.tsx:76-81`)
- [ ] **Mobile mentorship cards lack a message CTA.** `MentorshipPairCard.tsx` / `MentorDirectorySection.tsx` have no message affordance, unlike `connections.tsx` which has a first-class "Message" button. Users must hunt via Members/Alumni/Connections to message a mentor/pair.
- [ ] **Dual enterprise-quota definition.** `resolve_alumni_quota` keys off `enterprise_id IS NOT NULL`; `can_add_alumni` / `get_alumni_quota` key off `status = 'enterprise_managed'`. Bulk-import vs invite/trigger paths can diverge. Mirrored in `apps/web/src/lib/alumni/alumni-quota.ts:34`.
- [ ] **Enterprise step-2 redemption bypasses the core wrapper.** `apps/web/src/app/app/join/page.tsx:247` calls `complete_enterprise_invite_redemption` directly; wrapper `completeEnterpriseInviteRedemption` (`packages/core/src/invites/redeemInvite.ts:119`) has zero callers → slug/name back-fill is skipped.
- [ ] **Inconsistent admin-check helpers.** Org invite routes use `requireActiveOrgAdmin`; parent-invite routes use `getOrgMemberRole !== "admin"` (may not enforce active); `enterprise/by-slug/[slug]/route.ts:33` checks role-row existence, not role value.
- [ ] **`billing_admin` enterprise role is inert** for invites/nav — `is_enterprise_admin` counts it, but `create_enterprise_invite` / `sync_enterprise_nav_to_org` accept only owner/org_admin → silent failures.
- [ ] **Non-transactional multi-org sagas.** `apps/web/src/lib/enterprise/adoption.ts:383` and `transfer-member.ts:349` do `INSERT`-then-`DELETE` compensating rollbacks without a DB transaction; documented CRITICAL paths can leave a member in two orgs.

## SEV-3 — Dead code / residue sweep

- [ ] **Retired graph machinery** — `graph_sync_queue`, `get_mentorship_distances()`, enqueue/dequeue/backfill: zero TS callers; triggers dropped in `20261221000000`. FalkorDB + Postgres-native graph was retired but dead code remains.
- [ ] **Dead RPC `redeem_org_invite_by_token(p_token)`** — in generated types (`packages/types/src/database.ts:8079`) + migrations, zero call sites.
- [ ] **Demo-tuned residue in the recommender** — Penn/Wharton employer→industry dictionaries (`apps/web/src/lib/people-graph/career-signals.ts:40-91`) and `MATT_FAMILY_ALIASES` (`apps/web/src/lib/people-graph/name-matching.ts:3`) are org-specific special-casing living in shared source.
- [ ] **Untyped DB boundary** — `apps/web/src/lib/people-graph/suggestions.ts` casts `serviceSupabase as any` throughout; rows enter untyped without runtime validation (violates boundary-validation rule).
- [ ] **Member email in search snippets** — `apps/web/src/lib/search/intent-fallback.ts:119` places member email into `snippet`, gated only by RLS on the passed client. Verify RLS constrains non-admin viewers.
- [ ] **Doc drift** — `apps/web/CLAUDE.md` still references `src/lib/falkordb/suggestions.ts`; code lives at `src/lib/people-graph/suggestions.ts` and no FalkorDB exists.

## By design — NOT gaps

- No persisted connection graph / follow edges / accept-request flow — the recommender is intentionally stateless (computed from `members`/`alumni` rows).
- No DM table — 1:1 chat is a 2-member `chat_groups` row.
- No "Introductions" feature and no vCard/contact-card generation — never built.
- Alumni tab hidden on mobile (`(tabs)/_layout.tsx:166-173`, "not part of core loop") — reachable via drawer.

## Corrected during audit — do NOT action

- `handle_org_member_sync` "crash + lost parents sync" — **false alarm**; restored by `20261021100000`, retained in `20261208000000`; `'revoked'` is a valid `member_status` (added `20260206000000`).
- `alumni_insert` RLS "ordering bug" — both variants gate on `can_add_alumni`; practical effect holds. Low concern.
