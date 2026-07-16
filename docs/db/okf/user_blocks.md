---
type: db-table
title: "user_blocks"
description: "Postgres table `user_blocks`: 5 columns. References users."
resource: /packages/types/src/database.ts
tags: [db, schema, user]
timestamp: 2026-07-15T00:00:00Z
---

# user_blocks

Postgres table `user_blocks`: 5 columns. References users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `blocked_id` | `string` | no |
| `blocker_id` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |

## Related tables

- [users](./users.md)
