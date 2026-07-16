---
type: db-table
title: "ai_indexing_exclusions"
description: "Postgres table `ai_indexing_exclusions`: 6 columns. References organizations."
resource: /packages/types/src/database.ts
tags: [db, schema, ai]
timestamp: 2026-07-15T00:00:00Z
---

# ai_indexing_exclusions

Postgres table `ai_indexing_exclusions`: 6 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `excluded_by` | `string \| null` | yes |
| `id` | `string` | no |
| `org_id` | `string` | no |
| `source_id` | `string` | no |
| `source_table` | `string` | no |

## Related tables

- [organizations](./organizations.md)
