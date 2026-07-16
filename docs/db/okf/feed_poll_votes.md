---
type: db-table
title: "feed_poll_votes"
description: "Postgres table `feed_poll_votes`: 7 columns. References feed_posts, organizations."
resource: /packages/types/src/database.ts
tags: [db, schema]
timestamp: 2026-07-15T00:00:00Z
---

# feed_poll_votes

Postgres table `feed_poll_votes`: 7 columns. References feed_posts, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string \| null` | yes |
| `id` | `string` | no |
| `option_index` | `number` | no |
| `organization_id` | `string` | no |
| `post_id` | `string` | no |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [feed_posts](./feed_posts.md)
- [organizations](./organizations.md)
