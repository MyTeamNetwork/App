---
type: db-table
title: "organization_email_domains"
description: "Postgres table `organization_email_domains`: 13 columns. References organizations."
resource: /packages/types/src/database.ts
tags: [db, schema, organization]
timestamp: 2026-07-15T00:00:00Z
---

# organization_email_domains

Postgres table `organization_email_domains`: 13 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `created_by` | `string \| null` | yes |
| `dns_records` | `Json` | no |
| `domain` | `string` | no |
| `id` | `string` | no |
| `last_checked_at` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `resend_domain_id` | `string \| null` | yes |
| `sender_display_name` | `string \| null` | yes |
| `sender_local_part` | `string` | no |
| `status` | `string` | no |
| `updated_at` | `string` | no |
| `verified_at` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)
