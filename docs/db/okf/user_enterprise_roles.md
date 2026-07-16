---
type: db-table
title: "user_enterprise_roles"
description: "Postgres table `user_enterprise_roles`: 5 columns. References enterprise_alumni_counts, enterprises."
resource: /packages/types/src/database.ts
tags: [db, schema, user]
timestamp: 2026-07-15T00:00:00Z
---

# user_enterprise_roles

Postgres table `user_enterprise_roles`: 5 columns. References enterprise_alumni_counts, enterprises.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `enterprise_id` | `string` | no |
| `id` | `string` | no |
| `role` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- enterprise_alumni_counts (view or external relation)
- [enterprises](./enterprises.md)
