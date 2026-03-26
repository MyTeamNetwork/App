import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { filterAnnouncementsForUser } from "@/lib/announcements";
import type { OrgRole } from "@/lib/auth/role-utils";
import type { Announcement, Database, MembershipStatus } from "@/types/database";
import { FeedSidebarWidgets, type FeedSidebarData } from "./FeedSidebarWidgets";

interface FeedSidebarProps {
  orgSlug: string;
  orgId: string;
  role: OrgRole | null;
  status: string | null;
  userId: string | null;
}

export async function loadFeedSidebarData(
  supabase: SupabaseClient<Database>,
  orgId: string,
  role: OrgRole | null,
  status: string | null,
  userId: string | null,
): Promise<FeedSidebarData> {
  const [
    { data: upcomingEvents, error: eventsError },
    { data: recentAnnouncements, error: announcementsError },
    { data: newMembers, error: membersError },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, start_date")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .gte("start_date", new Date().toISOString())
      .order("start_date")
      .limit(3),
    supabase
      .from("announcements")
      .select("id, title, body, published_at, audience, audience_user_ids")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(5),
    supabase
      .from("members")
      .select("id, first_name, last_name, photo_url, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (eventsError) console.error("[FeedSidebar] events query failed:", eventsError.message);
  if (announcementsError) console.error("[FeedSidebar] announcements query failed:", announcementsError.message);
  if (membersError) console.error("[FeedSidebar] members query failed:", membersError.message);

  const visibleAnnouncements = filterAnnouncementsForUser(
    recentAnnouncements as Announcement[] | null,
    { role, status: status as MembershipStatus | null, userId },
  ).slice(0, 3);

  return {
    upcomingEvents: upcomingEvents || [],
    visibleAnnouncements: visibleAnnouncements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      published_at: a.published_at,
    })),
    newMembers: newMembers || [],
  };
}

/** Renders sidebar widgets only; prefer `loadFeedSidebarData` + `FeedSidebarWidgets` on the home page to avoid duplicate queries. */
export async function FeedSidebar({ orgSlug, orgId, role, status, userId }: FeedSidebarProps) {
  const supabase = await createClient();
  const data = await loadFeedSidebarData(supabase, orgId, role, status, userId);
  return <FeedSidebarWidgets orgSlug={orgSlug} data={data} />;
}
