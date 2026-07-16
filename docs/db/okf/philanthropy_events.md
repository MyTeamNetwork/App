---
type: db-table
title: "philanthropy_events"
description: "Postgres table `philanthropy_events`: 10 columns. References organizations."
resource: /packages/types/src/database.ts
tags: [db, schema]
timestamp: 2026-07-15T00:00:00Z
---

# philanthropy_events

Postgres table `philanthropy_events`: 10 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `date` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `description` | `string \| null` | yes |
| `id` | `string` | no |
| `location` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `signup_link` | `string \| null` | yes |
| `slots_available` | `number \| null` | yes |
| `title` | `string` | no |

## Related tables

- [organizations](./organizations.md)
