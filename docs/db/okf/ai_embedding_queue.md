---
type: db-table
title: "ai_embedding_queue"
description: "Postgres table `ai_embedding_queue`: 9 columns. References organizations."
resource: /packages/types/src/database.ts
tags: [db, schema, ai]
timestamp: 2026-07-15T00:00:00Z
---

# ai_embedding_queue

Postgres table `ai_embedding_queue`: 9 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `action` | `string` | no |
| `attempts` | `number` | no |
| `created_at` | `string` | no |
| `error` | `string \| null` | yes |
| `id` | `string` | no |
| `org_id` | `string` | no |
| `processed_at` | `string \| null` | yes |
| `source_id` | `string` | no |
| `source_table` | `string` | no |

## Related tables

- [organizations](./organizations.md)
