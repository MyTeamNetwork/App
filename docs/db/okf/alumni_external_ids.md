---
type: db-table
title: "alumni_external_ids"
description: "Postgres table `alumni_external_ids`: 7 columns. References alumni, enterprise_alumni_directory, org_integrations."
resource: /packages/types/src/database.ts
tags: [db, schema, alumni]
timestamp: 2026-07-15T00:00:00Z
---

# alumni_external_ids

Postgres table `alumni_external_ids`: 7 columns. References alumni, enterprise_alumni_directory, org_integrations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `alumni_id` | `string` | no |
| `created_at` | `string` | no |
| `external_data` | `Json \| null` | yes |
| `external_id` | `string` | no |
| `id` | `string` | no |
| `integration_id` | `string` | no |
| `last_synced_at` | `string \| null` | yes |

## Related tables

- [alumni](./alumni.md)
- enterprise_alumni_directory (view or external relation)
- [org_integrations](./org_integrations.md)
