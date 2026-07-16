---
type: db-table
title: "mobile_auth_handoffs"
description: "Postgres table `mobile_auth_handoffs`: 9 columns. No outbound foreign keys."
resource: /packages/types/src/database.ts
tags: [db, schema]
timestamp: 2026-07-15T00:00:00Z
---

# mobile_auth_handoffs

Postgres table `mobile_auth_handoffs`: 9 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `challenge_hash` | `string \| null` | yes |
| `code_hash` | `string` | no |
| `consumed_at` | `string \| null` | yes |
| `created_at` | `string` | no |
| `encrypted_access_token` | `string` | no |
| `encrypted_refresh_token` | `string` | no |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

_No outbound foreign keys._
