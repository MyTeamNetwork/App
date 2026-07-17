import { Users, GraduationCap, CalendarClock, HandHeart, Heart } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext, getCurrentUser } from "@/lib/auth/roles";
import { resolveDataClient } from "@/lib/auth/dev-admin";

import { getCachedDonationStats } from "@/lib/cached-queries";
import { loadFeedSidebarData } from "@/lib/feed/load-feed-sidebar-data";
import { loadJumpBackInData } from "@/lib/feed/load-jump-back-in";
import { loadFeedPage } from "@/lib/feed/load-feed-page";

import { FeedComposer } from "@/components/feed/FeedComposer";
import { JumpBackIn } from "@/components/feed/JumpBackIn";
import { FeedList } from "@/components/feed/FeedList";
import { FeedSidebar } from "@/components/feed/FeedSidebar";
import { FeedSidebarWidgets } from "@/components/feed/FeedSidebarWidgets";
import { OrgHomeMobileOverview } from "@/components/feed/OrgHomeMobileOverview";
import { CompactStatsWidget } from "@/components/feed/CompactStatsWidget";
import type { StatItem } from "@/components/feed/CompactStatsWidget";
import type { MobileStatChip } from "@/components/feed/feed-mobile-stat-types";

export const dynamic = "force-dynamic";

interface HomePageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function OrgHomePage({ params, searchParams }: HomePageProps) {
  const { orgSlug } = await params;
  const { page: pageParam } = await searchParams;

  const orgCtx = await getOrgContext(orgSlug);
  if (!orgCtx.organization) return null;
  const org = orgCtx.organization;

  const supabase = await createClient();
  const user = await getCurrentUser();
  const queryClient = resolveDataClient(user, supabase, "view_org");
  const membersClient = resolveDataClient(user, supabase, "view_members");

  // Fetch stats + feed posts + sidebar widget data in parallel
  const [
    { count: membersCount },
    { count: alumniCount },
    { count: parentsCount },
    { count: eventsCount },
    feedPageResult,
    userName,
    feedSidebarData,
    jumpBackInData,
  ] = await Promise.all([
    queryClient.from("members").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null).is("graduated_at", null).eq("status", "active"),
    queryClient.from("alumni").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    queryClient.from("parents").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    queryClient.from("events").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null).gte("start_date", new Date().toISOString()),
    loadFeedPage({ supabase, orgId: org.id, viewerId: orgCtx.userId, page: pageParam }),
    orgCtx.userId
      ? supabase.from("users").select("name").eq("id", orgCtx.userId).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    loadFeedSidebarData({
      orgId: org.id,
      role: orgCtx.role,
      status: orgCtx.status,
      userId: orgCtx.userId,
      dataClient: membersClient,
    }),
    loadJumpBackInData({
      orgId: org.id,
      userId: orgCtx.userId,
      dataClient: queryClient,
    }),
  ]);

  const [donationStat, tDash] = await Promise.all([
    getCachedDonationStats(org.id),
    getTranslations("pages.dashboard"),
  ]);

  const { posts: augmentedPosts, pagination } = feedPageResult;
  const { page, total, totalPages } = pagination;

  // Determine if user can create posts
  const feedPostRoles: string[] =
    (org as Record<string, unknown>).feed_post_roles as string[] ||
    ["admin", "active_member", "alumni"];
  const canPost = orgCtx.role ? feedPostRoles.includes(orgCtx.role) : false;

  // Build stats for sidebar widget
  const totalDonations = (donationStat?.total_amount_cents ?? 0) / 100;

  const stats: StatItem[] = [
    { label: tDash("activeMembers"), value: membersCount || 0, href: `/${orgSlug}/members`, icon: Users },
    { label: tDash("alumni"), value: alumniCount || 0, href: `/${orgSlug}/alumni`, icon: GraduationCap },
    ...(orgCtx.hasParentsAccess && (parentsCount ?? 0) > 0 && (orgCtx.role === "admin" || orgCtx.role === "active_member" || orgCtx.role === "parent") ? [{
      label: tDash("parents"), value: parentsCount || 0, href: `/${orgSlug}/parents`, icon: Heart,
    }] : []),
    { label: tDash("upcomingEvents"), value: eventsCount || 0, href: `/${orgSlug}/calendar`, icon: CalendarClock },
    {
      label: tDash("totalDonations"),
      value: `$${totalDonations.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      href: `/${orgSlug}/donations`,
      icon: HandHeart,
    },
  ];

  const mobileStatChips: MobileStatChip[] = [
    { label: tDash("activeMembers"), value: String(membersCount || 0), href: `/${orgSlug}/members`, iconKey: "users" },
    { label: tDash("alumni"), value: String(alumniCount || 0), href: `/${orgSlug}/alumni`, iconKey: "graduation-cap" },
    ...(orgCtx.hasParentsAccess && (parentsCount ?? 0) > 0 && (orgCtx.role === "admin" || orgCtx.role === "active_member" || orgCtx.role === "parent")
      ? [{ label: tDash("parents"), value: String(parentsCount || 0), href: `/${orgSlug}/parents`, iconKey: "heart" as const }]
      : []),
    { label: tDash("upcomingEvents"), value: String(eventsCount || 0), href: `/${orgSlug}/calendar`, iconKey: "calendar-clock" },
    {
      label: tDash("totalDonations"),
      value: `$${totalDonations.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      href: `/${orgSlug}/donations`,
      iconKey: "hand-heart",
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Main feed column */}
        <div className="mx-auto w-full max-w-3xl xl:max-w-none">
          {jumpBackInData && jumpBackInData.total > 0 && (
            <JumpBackIn orgId={org.id} data={jumpBackInData} />
          )}

          {canPost && (
            <div className="mb-5">
              <FeedComposer orgId={org.id} userName={userName?.name || undefined} />
            </div>
          )}

          <OrgHomeMobileOverview statChips={mobileStatChips}>
            <FeedSidebarWidgets orgSlug={orgSlug} data={feedSidebarData} />
          </OrgHomeMobileOverview>

          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border/35" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/55">
              {tDash("recent")}
            </span>
            <div className="h-px flex-1 bg-border/35" />
          </div>
          <FeedList
            posts={augmentedPosts}
            orgSlug={orgSlug}
            currentUserId={orgCtx.userId || ""}
            isAdmin={orgCtx.isAdmin}
            canPost={canPost}
            basePath={`/${orgSlug}`}
            pagination={{ page, total, totalPages }}
          />
        </div>

        {/* Right sidebar */}
        <aside className="hidden xl:block">
          <div className="sticky top-8 space-y-4">
            <CompactStatsWidget stats={stats} />
            <FeedSidebar
              orgSlug={orgSlug}
              orgId={org.id}
              role={orgCtx.role}
              status={orgCtx.status}
              userId={orgCtx.userId}
              data={feedSidebarData}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
