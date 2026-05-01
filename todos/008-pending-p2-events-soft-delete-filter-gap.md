---
status: pending
priority: p2
issue_id: "008"
tags: [performance, soft-delete, events, indexes]
dependencies: []
---

# Events queries missing soft-delete filter prevent index retirement

## Problem Statement

`supabase/migrations/20260812000003_perf_hotpath_indexes_and_initplan.sql` originally dropped `events_org_id_idx` on the assumption that all real callers filter `deleted_at IS NULL` and would be served by the partial indexes (`events_org_deleted_idx`, `idx_events_org_start`). Audit found two callers that scan `events` without that filter, forcing the migration to retain `events_org_id_idx` and defer the cleanup. Until those callers are fixed, the partial indexes cannot fully replace the plain `(organization_id)` index.

## Findings

### MEDIUM — Two events callers omit `deleted_at IS NULL`

1. `src/app/api/stripe/create-donation/route.ts:144` — point lookup by `id + organization_id`. Hot on every donation creation; missing the soft-delete filter means a soft-deleted event could resolve and accept a donation.

2. `src/app/[orgSlug]/philanthropy/page.tsx:32` — philanthropy event listing. Returns soft-deleted rows in user-facing UI.

Both queries currently rely on `events_org_id_idx`, which is why migration 20260812000003 keeps that index instead of dropping it.

## Proposed Solutions

### Option 1 (RECOMMENDED) — Add `.is('deleted_at', null)` to both queries, then drop the index

Two-line app fix per call site. After the fix lands and bakes, schedule a follow-up migration to drop `events_org_id_idx`. The partial indexes already cover the resulting query shapes.

**Pros:** Correctness fix (donations can no longer reference deleted events). Unblocks index cleanup. No migration risk in step one.

**Cons:** Two-step deploy (app fix → bake → index drop).

**Effort:** 30 min for the app fix, separate 15 min migration after a bake period.

---

### Option 2 — Leave `events_org_id_idx` in place permanently

Accept the soft-deleted-row leak and keep the redundant index.

**Cons:** Donations against deleted events is a real correctness bug, not just a perf concern. Index bloat is the lesser issue.

## Recommended Action

Option 1. Fix the two call sites first (correctness), then drop the index in a follow-up migration once the queries have shifted to the partial indexes.

## Technical Details

**Affected files:**
- `src/app/api/stripe/create-donation/route.ts:144`
- `src/app/[orgSlug]/philanthropy/page.tsx:32`
- (follow-up) new migration to drop `events_org_id_idx`

## Acceptance Criteria

- [ ] Both event queries filter `deleted_at IS NULL`.
- [ ] Test covers: donation creation against a soft-deleted event is rejected.
- [ ] Test covers: philanthropy listing excludes soft-deleted events.
- [ ] Follow-up migration drops `events_org_id_idx` after bake period.

## Resources

- Migration comment: `supabase/migrations/20260812000003_perf_hotpath_indexes_and_initplan.sql` (lines documenting the kept index)
- Audit: 2026-04-07 migration review
