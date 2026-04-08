-- Add soft-delete support for mentorship pairs and logs so archived records can
-- be hidden consistently across web and mobile without destroying history.

alter table if exists public.mentorship_pairs
  add column if not exists deleted_at timestamptz;

alter table if exists public.mentorship_logs
  add column if not exists deleted_at timestamptz;

create index if not exists mentorship_pairs_org_active_idx
  on public.mentorship_pairs (organization_id, created_at desc)
  where deleted_at is null;

create index if not exists mentorship_logs_pair_active_idx
  on public.mentorship_logs (pair_id, entry_date desc, created_at desc)
  where deleted_at is null;
