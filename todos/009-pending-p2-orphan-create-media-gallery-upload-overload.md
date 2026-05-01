---
status: pending
priority: p2
issue_id: "009"
tags: [migrations, database, cleanup, overloads]
dependencies: []
---

# Drop orphaned 12-arg `create_media_gallery_upload` overload

## Problem Statement

Production has two overloads of `public.create_media_gallery_upload` coexisting:

1. **13-arg version** (current): includes `p_preview_storage_path text` in position 4. This is the version application code targets after the media-preview feature shipped.
2. **12-arg version** (orphaned): the original signature, no `p_preview_storage_path`. Migration `20260809000000_media_preview_storage_paths.sql` introduced the 13-arg version but did not drop the old one.

Both overloads carry identical ACLs (`EXECUTE` granted to `anon`, `authenticated`, `service_role`), so any caller invoking the bare function name with 12 args silently hits the old overload — no preview support, no error. Verified against project `rytsziwekhtjdqzzpdso` on 2026-04-07.

This is a footgun: a stale client, a forgotten internal call site, or any tooling that builds the argument list dynamically can land on the old version with no signal.

## Findings

### MEDIUM — Orphaned overload silently bypasses preview support

`pg_proc` shows two rows for `create_media_gallery_upload`. PostgreSQL routes each call by argument count + types; calls that match the 12-arg shape get the old function body, calls that match the 13-arg shape get the new one. There is no warning or error when the wrong overload is selected.

### Related — Migration `20260809000000` was edited locally to "fix" parameter ordering

The local edit reordered the `text` arg in the `ALTER FUNCTION`/`GRANT` blocks to match the 13-arg overload. That edit was reverted 2026-04-07 because editing applied migrations is the wrong fix; the right fix is a new forward migration.

## Proposed Solutions

### Option 1 (RECOMMENDED) — Forward migration that drops the 12-arg overload

Add `supabase/migrations/<new>_drop_orphan_create_media_gallery_upload.sql`:

```sql
DROP FUNCTION IF EXISTS public.create_media_gallery_upload(
  uuid, uuid, text, text, text, bigint, text, text, text, text[], timestamptz, text
);
```

Before applying, grep the entire codebase (and any external clients/edge functions/scheduled jobs) for callers that might still pass 12 args. If any are found, update them to pass `p_preview_storage_path` (NULL is fine if the upload has no preview).

**Pros:** Eliminates the silent-bypass class of bug entirely. Single forward migration, fully reviewable.

**Cons:** Requires a caller audit before deploy. Drop is irreversible without restoring from backup if a missed caller breaks.

**Effort:** 1h audit + 30m migration + review.

---

### Option 2 — Leave both overloads in place, document the trap

Add a comment to the live 13-arg function and to the related code paths warning that the 12-arg overload exists. Don't drop it.

**Pros:** Zero deploy risk.

**Cons:** Doesn't fix the underlying bug. Documentation rots.

## Recommended Action

Option 1, after a caller audit. The audit must cover:

- `src/app/api/media/**` (all upload routes)
- `src/lib/media/**`
- Any Supabase edge functions in `supabase/functions/`
- Any scheduled jobs invoking media RPCs
- Any mobile-app code in `apps/` or external clients

## Technical Details

**Affected:**
- `public.create_media_gallery_upload` (12-arg overload, prod)

## Acceptance Criteria

- [ ] Codebase audit confirms zero callers passing 12 args.
- [ ] Forward migration drops the 12-arg overload.
- [ ] Post-deploy `pg_proc` shows exactly one `create_media_gallery_upload` row.

## Resources

- Discovered: 2026-04-07 during todo 007 migration audit
- Related: reverted local edit to `supabase/migrations/20260809000000_media_preview_storage_paths.sql`
