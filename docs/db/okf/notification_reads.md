---
type: db-table
title: "notification_reads"
description: "Postgres table `notification_reads`: 4 columns. References notifications."
resource: /packages/types/src/database.ts
tags: [db, schema, notification]
timestamp: 2026-07-15T00:00:00Z
---

# notification_reads

Postgres table `notification_reads`: 4 columns. References notifications.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `dismissed_at` | `string \| null` | yes |
| `notification_id` | `string` | no |
| `read_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [notifications](./notifications.md)
