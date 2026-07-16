---
type: db-table
title: "api_rate_limit_buckets"
description: "Postgres table `api_rate_limit_buckets`: 5 columns. No outbound foreign keys."
resource: /packages/types/src/database.ts
tags: [db, schema]
timestamp: 2026-07-15T00:00:00Z
---

# api_rate_limit_buckets

Postgres table `api_rate_limit_buckets`: 5 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `bucket_key` | `string` | no |
| `count` | `number` | no |
| `created_at` | `string` | no |
| `id` | `number` | no |
| `window_start` | `string` | no |

## Related tables

_No outbound foreign keys._
