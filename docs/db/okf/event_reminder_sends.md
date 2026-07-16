---
type: db-table
title: "event_reminder_sends"
description: "Postgres table `event_reminder_sends`: 3 columns. References events."
resource: /packages/types/src/database.ts
tags: [db, schema, event]
timestamp: 2026-07-15T00:00:00Z
---

# event_reminder_sends

Postgres table `event_reminder_sends`: 3 columns. References events.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `event_id` | `string` | no |
| `kind` | `string` | no |
| `sent_at` | `string` | no |

## Related tables

- [events](./events.md)
