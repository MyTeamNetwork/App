-- Member/alumni/parent profile avatar bucket.
--
-- Mobile code at apps/mobile/src/hooks/useAvatarUpload.ts uploads the user's
-- chosen profile photo to an `avatars` bucket at path `<user_id>/avatar.<ext>`
-- and writes the resulting public URL back to
-- members/alumni/parents.photo_url (and auth user metadata) on Save. The
-- bucket was never created, so every upload failed with "Bucket not found"
-- and the profile photo could not be changed from the Edit Profile screen.
--
-- This migration:
--   1. Creates the `avatars` storage bucket (public read).
--   2. Adds storage.objects RLS so an authenticated user can write/replace
--      ONLY files under their own `<user_id>/` folder.
--
-- Path convention: `<auth.uid()>/avatar.<ext>`, so the first path segment is
-- the owning user's id, which is what we authorize against.

-- 1. Bucket. Public read: avatars are rendered in directories/drawers by
-- unauthenticated-cacheable public URLs, matching linkedin-photos and
-- chat-group-avatars. 5 MiB cap and an image allowlist mirror the other
-- image buckets (the client already downscales to quality 0.8).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic'];

-- 2. RLS on storage.objects. First path segment is the owning user's id.

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );
