---
type: index
title: TeamNetwork AI Agent Knowledge Bundle
description: Open Knowledge Format index for the TeamNetwork AI assistant current state, codemaps, architecture, and schema references.
tags: [ai, index, okf]
timestamp: 2026-07-12T00:00:00Z
---

# TeamNetwork AI Agent Knowledge Bundle

This directory is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) (OKF) bundle: plain markdown concept documents, each carrying YAML frontmatter (`type`, `title`, `description`, `resource`, `tags`, `timestamp`). It documents the TeamNetwork AI assistant so that humans and agentic tools (Claude Code, the in-app assistant) can navigate it consistently.

Each document's `resource` field points at the primary source file it describes, giving a concept → code index. The companion database bundle at [`docs/db/okf/`](../db/okf/index.md) is generated from the current Supabase type dump.

## Start here

- [AI Assistant Current State](/docs/agent/current-state.md) — the verified implementation snapshot, access gates, tool surfaces, data boundaries, and refresh commands.

Use the current-state snapshot for present-tense behavior, then follow its source links or the focused codemaps below. Treat sections labelled planned, deferred, or remaining work as non-shipped until code and tests confirm otherwise.

## Architecture

- [AI Assistant Architecture Overview](/docs/agent/assistant.md) — scope policy, tools, enterprise extension, pipeline.
- [Enterprise-Aware AI Context](/docs/agent/enterprise-context.md) — activation criteria, prompt visibility, capability matrix, response policy.

## Codemaps

- [Chat Pipeline](/docs/agent/chat-pipeline-codemap.md) — auth, policy, RAG, tool execution, SSE streaming, persistence, grounding.
- [AI Intent Routing and Surface Inference](/docs/agent/ai-intent-plan.md) — intent routing and per-turn surface inference.
- [Semantic Cache](/docs/agent/semantic-cache-codemap.md) — exact-match cache eligibility, TTLs, invalidation, purge cron.
- [Thread Management](/docs/agent/threads-codemap.md) — thread/message CRUD, pagination, soft-delete, RLS.
- [UI Panel](/docs/agent/ui-panel-codemap.md) — slide-out assistant panel and SSE consumer.
- [People Graph Connection Suggestions](/docs/agent/people-graph-suggestions.md) — Postgres-only engine powering `suggest_connections`.

## Taxonomies and reference

- [Intent Type Taxonomy](/docs/agent/intent-type-taxonomy.md) — the `intent_type` classification axis.
- [AI Data Flow — Privacy and Compliance](/docs/agent/ai-data-flow.md) — PII in the pipeline, storage, and external-provider surface.

## Audits

- [Enterprise AI Parity Audit](/docs/agent/enterprise-parity-audit.md) — enterprise UI mutations vs. AI tool coverage.

## Data and schema

- [Database Schema OKF Bundle](/docs/db/okf/index.md) — generated per-table columns and foreign-key graph from `packages/types/src/database.ts`.
- [AI Subsystem Schema](/docs/db/ai-schema.md) — hand-maintained narrative for AI tables, RAG, cache, spend, and pending actions.

## Type vocabulary

The bundle uses a deliberately small `type` set: `architecture`, `codemap`, `taxonomy`, `reference`, `data-flow`, `audit`, `index` (this file), and `log` (the history file below).

## Refresh contract

The repository type dump is the source for the database OKF bundle; `apps/web/src/types/database.ts` is only a compatibility re-export. After schema changes, refresh with `bun run gen:types`, `bun run gen:db-okf -- --timestamp <ISO-8601>`, and `bun run validate:okf`. The validator checks both this AI bundle and the generated database bundle, including frontmatter, resource paths, and index links.

## History

- [OKF Bundle History](/docs/agent/log.md) — reserved change log: when documents were added, restructured, and when resource paths drifted or were repaired.

## Visualizing this bundle

Because this bundle is plain markdown with YAML frontmatter, it can be rendered by Google's Open Knowledge Format static HTML visualizer. Point the visualizer in [GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) at this directory (`docs/agent/`) to browse the documents and their `resource` links interactively. Load `docs/db/okf/` as a second bundle when schema-level navigation is needed. No build step or server is required — the visualizer reads the frontmatter directly.
