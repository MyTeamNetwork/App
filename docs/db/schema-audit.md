# Supabase Schema Audit

**Last Updated:** March 11, 2026  
**Scope:** All migrations in `supabase/migrations/` through `20260701000007_enforce_behavioral_tracking_policy.sql`  
**Current Migration Count:** 155

This document is a current-state schema snapshot, not a historical deep dive. The generated types in `src/types/database.ts` are the best day-to-day source of truth when this doc drifts.

---

## Current Schema Surface

The live schema now covers substantially more than the original 2025 core:

- Core identity and org membership
- Members, alumni, and parents
- Events, announcements, notifications, and RSVPs
- Chat, discussions, and feed
- Forms, document submissions, and media
- Calendar sync, schedule imports, and schedule files
- Jobs, mentorship, workouts, competition, and philanthropy/donations
- Analytics, telemetry, and operational events
- Enterprise billing, roles, adoption requests, invites, and audit logs

---

## Major Table Groups

### Identity, Membership, and Access

| Table | Purpose | Notes |
|-------|---------|-------|
| `users` | App-level user profile mirrored from auth | Synced from `auth.users` |
| `organizations` | Top-level tenant entity | Includes branding, navigation config, Stripe/org settings |
| `user_organization_roles` | Org membership + role assignment | `role` now includes `parent`; `status` includes `pending`, `active`, `revoked` |
| `organization_subscriptions` | Org subscription state | Includes alumni and parent access buckets plus grace-period data |
| `enterprises` | Enterprise tenant entity | Enterprise metadata and billing contact |
| `user_enterprise_roles` | Enterprise role assignment | `owner`, `billing_admin`, `org_admin` |

### Member Directories

| Table | Purpose | Notes |
|-------|---------|-------|
| `members` | Active member profiles | Soft-delete via `deleted_at` |
| `alumni` | Alumni profiles | Extended profile/contact fields |
| `parents` | Parent/guardian profiles | Includes relationship, student name, notes, optional linked `user_id` |
| `parent_invites` | Parent invite onboarding | Code-based invite flow with status and expiry |

### Communication and Community

| Table | Purpose | Notes |
|-------|---------|-------|
| `announcements` | Audience-targeted announcements | Supports `all`, `members`, `active_members`, `alumni`, `individuals` |
| `notifications` | Notification records | Paired with notification preferences and push tokens |
| `chat_groups` | Group chat containers | Approval and moderation workflow |
| `chat_group_members` | Chat membership | Includes `added_by` and `removed_at` soft removal |
| `chat_messages` | Chat message records | Includes `message_type`, `metadata`, approval state, edit/delete fields |
| `discussion_threads` | Discussion threads | Community long-form discussion |
| `discussion_replies` | Thread replies | Reply tree/content |
| `feed_posts` | Feed posts | Community feed content |
| `feed_comments` | Feed comments | Post-level replies/comments |

### Scheduling and Calendar

| Table | Purpose | Notes |
|-------|---------|-------|
| `events` | Org events | Audience and targeting support |
| `event_rsvps` | RSVP/check-in state | Includes check-in and attendance fields |
| `academic_schedules` | User academic commitments | Personal schedule/availability input |
| `schedule_files` | Uploaded schedule files | Per-user uploads |
| `schedule_sources` / `schedule_source_events` | Imported external schedule data | Added by newer schedule-source migrations |
| `calendar_feeds` / `calendar_feed_events` | Calendar feed ingestion | Powers calendar sync/feed workflows |
| `user_calendar_connections` | Google OAuth connection state | Encrypted token storage |
| `event_calendar_entries` | Event-to-Google mappings | Sync status and error state |
| `calendar_sync_preferences` | Per-user sync preferences | Org-scoped preference table |

### Forms, Media, and Operations

| Table | Purpose | Notes |
|-------|---------|-------|
| `forms`, `form_submissions` | Dynamic forms | Submission payloads are user-generated content |
| `form_documents`, `form_document_submissions` | Document workflows | Uploaded document templates and submissions |
| `media_albums`, `media_items`, `media_uploads` | Media archive | Moderation, album membership, upload lifecycle |
| `job_postings` | Job board | Org/community employment posts |
| `mentorship_pairs`, `mentorship_logs` | Mentorship features | Pairings and logs |
| `workouts`, `workout_logs` | Workout content and participation | Performance-tracking surfaces |
| `competitions`, `competition_teams`, `competition_points` | Competition workflows | Team and point tracking |

### Payments, Donations, and Embeds

| Table | Purpose | Notes |
|-------|---------|-------|
| `payment_attempts` | Idempotency ledger | Covers multiple payment flows |
| `stripe_events` | Webhook dedupe | Prevents double-processing |
| `organization_donations` | Stripe Connect donation records | Donation event storage |
| `organization_donation_stats` | Donation rollups | Aggregate stats per org |
| `org_donation_embeds`, `org_philanthropy_embeds` | Embed/link storage | Finance and philanthropy surfaces |
| `philanthropy_events` | Philanthropy event records | Org-scoped philanthropy data |

### Analytics and Telemetry

| Table | Purpose | Notes |
|-------|---------|-------|
| `analytics_consent` | Analytics consent state | Org/user consent decisions |
| `analytics_events` | Behavioral analytics | Event name enum + allowlisted props |
| `analytics_ops_events` | Operational analytics | Internal event payloads |
| `ops_events` | Operational event log | System/ops signals |
| Error/event tracking tables | Error grouping and event storage | Added by error-tracking migrations and telemetry routes |

### Enterprise

| Table | Purpose | Notes |
|-------|---------|-------|
| `enterprise_subscriptions` | Enterprise subscription state | Hybrid alumni-bucket + sub-org pricing |
| `enterprise_adoption_requests` | Org adoption workflow | Structured request lifecycle |
| `enterprise_invites` | Enterprise admin invitations | Email/token onboarding |
| `enterprise_audit_logs` | Admin audit trail | Includes actor email, IP, user agent |
| `enterprise_alumni_counts` | Enterprise-wide count view | Capacity planning / enforcement |

---

## Enum Highlights

| Enum | Current Values |
|------|----------------|
| `user_role` | `admin`, `active_member`, `alumni`, `parent`, plus legacy compatibility values in some code paths |
| `membership_status` | `pending`, `active`, `revoked` |
| `chat_group_role` | `admin`, `moderator`, `member` |
| `chat_message_status` | `pending`, `approved`, `rejected` |
| `enterprise_role` | `owner`, `billing_admin`, `org_admin` |

The presence of `parent` in the role model is now material to routing, navigation, and content access. Older docs that omit it are stale.

---

## Important Implementation Notes

### Chat

- `chat_group_members` now supports soft removal through `removed_at`.
- Re-adding a removed member is an update path, not a plain insert path.
- `chat_messages` supports richer message types through `message_type` and JSON `metadata`.

### Navigation and Role Access

- Parent access now propagates through org navigation and feature gates.
- Generated types and migrations are aligned on `parent` as a first-class role.

### Analytics

- Behavioral analytics is now part of the schema and is not merely planned work.
- Recent July 2026 migrations hardened analytics prop validation and behavioral tracking policy enforcement.

### Enterprise Typing

- Enterprise tables are present in the generated database types.
- Some code still uses `as any` in service-role or auth-schema queries, but the old claim that enterprise tables are missing from generated types is no longer accurate.

### Notification Delivery

- Announcement and notification email delivery is no longer purely stubbed.
- `src/lib/notifications.ts` uses Resend when `RESEND_API_KEY` is configured.
- SMS delivery remains a stub integration point.

---

## Cron- and Feature-Driven Additions Since Early 2026

The schema expanded significantly after the original audit period, including:

- Enterprise security and audit-log work
- Google Calendar sync and calendar feed tables
- Analytics consent/events/ops tables
- Media archive and moderation tables
- Parent/guardian tables and parent invite flows
- Discussions, feed, and jobs
- Chat polls/forms and parent-access alignment
- Additional schedule-source and calendar-sync infrastructure

If a doc still describes the schema as covering only the early 2026 org/alumni/chat/payment surface, it is out of date.

---

## Remaining Cautions

1. Prefer `src/types/database.ts` when checking exact column names or enums.
2. Re-run this audit after major migration batches; the schema is changing frequently.
3. Treat compliance docs that say "no behavioral data" or omit parent records as stale unless they have been updated after the July 2026 analytics and parent-role migrations.
