---
type: db-table
title: "mentorship_logs"
description: "Postgres table `mentorship_logs`: 10 columns. References mentorship_pairs, organizations."
resource: /packages/types/src/database.ts
tags: [db, schema, mentorship]
timestamp: 2026-07-15T00:00:00Z
---

# mentorship_logs

Postgres table `mentorship_logs`: 10 columns. References mentorship_pairs, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `created_by` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `entry_date` | `string` | no |
| `id` | `string` | no |
| `notes` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `pair_id` | `string` | no |
| `progress_metric` | `number \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- [mentorship_pairs](./mentorship_pairs.md)
- [organizations](./organizations.md)
