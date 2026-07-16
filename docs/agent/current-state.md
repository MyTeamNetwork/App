---
type: reference
title: AI Assistant Current State
description: Verified implementation snapshot for the TeamNetwork AI assistant, including access gates, capability surfaces, data boundaries, and documentation refresh rules.
resource: apps/web/src/app/api/ai/[orgId]/chat/handler.ts
tags: [ai, current-state, operations, okf]
timestamp: 2026-07-12T00:00:00Z
---

# AI Assistant — Current State

**Verified:** July 12, 2026 against the checked-out repository source, generated database types, migrations, and tests.

This is implementation truth for the repository snapshot. It does not prove that every migration is applied in production or that production environment variables enable every capability. For live deployment truth, verify the Supabase migration ledger, deployed environment, and runtime telemetry separately.

## How agents should use this bundle

1. Start here for present-tense behavior and access boundaries.
2. Follow the linked codemap for request-path details.
3. Use [`docs/db/okf/`](../db/okf/index.md) for generated table columns and foreign-key relationships.
4. Use migrations and source code when an exact policy, RPC grant, or deployment state matters.

Words such as **planned**, **deferred**, **placeholder**, and **remaining work** mean non-shipped or incomplete. Do not turn those sections into current capabilities without confirming the implementation.

## Runtime and access

- The product is one org-scoped assistant exposed through `AIPanel` and `/api/ai/[orgId]/chat`; enterprise behavior extends this pipeline rather than creating a second assistant.
- `getAiOrgContext()` resolves the caller's current organization and matching enterprise role. Enterprise context is attached only for an enterprise-linked organization with a matching `user_enterprise_roles` row.
- Non-admin access is guarded by `AI_MEMBER_ACCESS_KILL`, which defaults to blocking non-admin callers. Setting it to `0`, `false`, or `off` enables the role-specific non-admin read allowlists in `apps/web/src/lib/ai/access-policy.ts`.
- Admin tool access is derived from `AI_TOOL_MAP`; non-admin access is allowlisted and excludes enterprise tools. Tool checks also run inside the executor as defense in depth.
- Out-of-scope and unsafe turns short-circuit before normal tools, RAG, cache, or model generation as appropriate. The assistant remains TeamNetwork-only and must not answer general knowledge, coding, homework, travel, medical/legal/financial advice, or role-play requests.

## Provider and request path

- The provider is AWS Bedrock through `apps/web/src/lib/ai/bedrock-adapter.ts`.
- Default routing/first-pass model: `us.amazon.nova-micro-v1:0`.
- Default pass-2 compose and schedule-image model: `us.amazon.nova-lite-v1:0`.
- `AWS_REGION` is the configuration signal. `BEDROCK_MODEL`, `LLM_MODEL_PASS2`, and `BEDROCK_IMAGE_MODEL` can override the defaults.
- The handler validates input and auth, applies rate limits and message safety, resolves thread/surface/intent policy, optionally retrieves RAG chunks, streams SSE output, persists messages, records audit telemetry, and verifies tool-backed responses.
- Eligible simple live reads can use deterministic `tool_first` paths and skip the second model pass. Exact eligibility lives in `apps/web/src/lib/ai/turn-execution-policy.ts` and the chat handler.

## Current capability surfaces

The authoritative tool inventory is `apps/web/src/lib/ai/tools/definitions.ts`. The current families are:

- Organization reads: members, alumni, parents, events, announcements, discussions, jobs, chat groups, philanthropy events, member preferences, free-member availability, org stats, engagement metrics, donation analytics, donations, connection suggestions, mentor/mentee suggestions, content search, and navigation targets.
- Enterprise reads: enterprise alumni, managed organizations, enterprise statistics, quota/capacity, and enterprise audit/adoption events.
- Schedule/event import: CSV event import, schedule website scraping, and PDF/image schedule extraction. Uploaded schedule files are private transient attachments and are cleaned up after extraction or explicit deletion.
- Confirmation-gated writes: announcements, jobs, discussions/replies, direct/group chat messages, events, member role/status changes, mentorship pairings, and enterprise invite creation/revocation. Update and delete variants exist where listed in the tool definitions.

Every write prepares a server-owned pending action. The user must explicitly confirm or cancel it through the pending-action routes; the action expires after 15 minutes and supports at most three revisions. The executor and confirm handler enforce authorization, stale-record checks, terminal/transient failure classification, and sanitized client errors.

## RAG and cache state

- RAG uses `ai_embedding_queue` → `ai_document_chunks` → `search_ai_documents()`.
- The eight indexed source tables are `announcements`, `discussion_threads`, `discussion_replies`, `events`, `job_postings`, `mentor_profiles`, `form_submissions`, and `knowledge_documents`.
- `knowledge_documents` is live in the repository schema/types and is admin-managed. Its `audience` metadata is enforced during retrieval; it is not a missing or future-only type.
- Admin retrieval is unrestricted by audience. Non-admin audience filters are role-specific in `apps/web/src/lib/ai/rag-retriever.ts`, but the default kill switch still blocks non-admin assistant access.
- The cache is exact SHA-256 matching, not vector similarity. Only standalone first-turn `general` prompts are cache-eligible in v1; eligible cache reads use shared static context and skip RAG. Entries use a 12-hour active TTL and an hourly bounded purge route.

## Data, privacy, and retention

- Threads/messages are scoped to user + organization + surface and are protected by RLS. Audit and cache tables are service-role-only where documented in the schema bundle.
- Prompts and tool results can contain organization data and personal information. Bedrock is the external model boundary; the data-flow document records the stored and provider-visible fields.
- `ai_audit_log.expires_at` is set to 90 days, but the current repository has no AI-audit-specific purge route. Do not describe the field as proof that deletion is currently enforced.
- Semantic-cache expiry is actively purged by `/api/cron/ai-cache-purge`; embedding queue cleanup is handled by `/api/cron/ai-embed-process` for processed/dead-letter rows.
- Negative feedback can be exported into local eval candidates with `bun run --cwd apps/web evals:ai:feedback`; promoted fixtures run without live model calls.

## Agent-facing documentation contract

- AI concept docs live under `docs/agent/` and must have valid OKF frontmatter with a resolving `resource:` path.
- Database table docs live under `docs/db/okf/`, are generated from `packages/types/src/database.ts`, and currently contain 134 table docs plus the index.
- `apps/web/src/types/database.ts` is only a compatibility re-export; it is not the generated schema source.
- After schema changes, regenerate types and the database bundle, then validate both bundles:

```bash
bun run gen:types
bun run gen:db-okf -- --timestamp <ISO-8601>
bun run validate:okf
```

Use `bun run gen:db-okf -- --check` to fail when the generated file set, resource paths, or FK links drift from the current type dump.

## Verification commands

From the repository root, the relevant agent gates are:

```bash
bun run typecheck
bun run lint
bun run --cwd apps/web test:unit
bun run --cwd apps/web test:ai
bun run validate:okf
```

These checks validate repository behavior and documentation structure; they do not replace production Supabase or Bedrock verification.
