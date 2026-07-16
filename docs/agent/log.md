---
type: log
title: OKF Bundle History
description: Reserved change history for the TeamNetwork AI agent OKF bundle — when documents were added, restructured, and when resource paths drifted or were repaired.
tags: [ai, okf, history, changelog]
timestamp: 2026-07-12T00:00:00Z
---

# OKF Bundle History

A reserved history file for the `docs/agent/` Open Knowledge Format bundle. Entries are grouped by ISO date, newest first. This log exists so that drift in the bundle (renamed source files, restructured docs) leaves a paper trail next to the validator that catches it.

## 2026-07-12

- **Current-state and schema refresh.** Added `current-state.md` as the present-tense agent entrypoint, linked the generated database OKF bundle from `index.md`, and clarified the implementation-versus-production boundary.
- **Generated-schema source repair.** The database OKF generator now parses `packages/types/src/database.ts` and targets the `public.Tables` section explicitly. `apps/web/src/types/database.ts` is a compatibility shim, not the generated source. The generator check now detects missing/stale table docs and unexpected resource paths.
- **Bundle coverage.** Regenerated `docs/db/okf/` from the current type dump and expanded `validate:okf` to validate both the AI and database OKF bundles.
- **AI/schema drift corrections.** Updated stale Next.js/command references, corrected the `knowledge_documents` and `organization_email_domains` status, documented the Google Gemini-compatible embedding boundary, and distinguished the `ai_audit_log.expires_at` default from an active purge job.

## 2026-06-17

- **Bundle created.** Structured `docs/agent/` as an OKF bundle: added YAML frontmatter (`type`, `title`, `description`, `resource`, `tags`, `timestamp`) to the 12 concept documents and to `index.md`. Each document's `resource` field points at the primary source file it describes, giving a concept → code index. `type` is the only required field; the bundle uses a small `type` vocabulary (`architecture`, `codemap`, `taxonomy`, `reference`, `data-flow`, `audit`, `index`, `log`).

- **Resource-path rot from the `lib/falkordb` → `lib/people-graph` rename.** The `refactor(graph): rename lib/falkordb -> lib/people-graph` change moved `suggestions.ts` out of `apps/web/src/lib/falkordb/`. Two documents — `falkor-people-graph.md` and `falkor-connection-suggestions.md` — carried `resource:` paths under the old `lib/falkordb/` directory, which silently broke when the directory was removed. Both `resource` fields were repaired to `apps/web/src/lib/people-graph/suggestions.ts`. This class of silent drift is the motivation for the frontmatter validator: `scripts/validate-okf-frontmatter.mjs` now asserts every `resource:` path resolves on disk, and gates merges via the `validate-okf` CI job in the `all-checks` aggregate.
