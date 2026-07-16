---
type: db-table
title: "parent_invites"
description: "Postgres table `parent_invites`: 9 columns. References organizations."
resource: /packages/types/src/database.ts
tags: [db, schema]
timestamp: 2026-07-15T00:00:00Z
---

# parent_invites

Postgres table `parent_invites`: 9 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `accepted_at` | `string \| null` | yes |
| `code` | `string` | no |
| `created_at` | `string` | no |
| `email` | `string \| null` | yes |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `invited_by` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `status` | `string` | no |

## Related tables

- [organizations](./organizations.md)
