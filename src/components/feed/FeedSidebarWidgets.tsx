import { UpcomingEventsWidget } from "./UpcomingEventsWidget";
import { RecentAnnouncementsWidget } from "./RecentAnnouncementsWidget";
import { MemberHighlightsWidget } from "./MemberHighlightsWidget";

export interface FeedSidebarData {
  upcomingEvents: { id: string; title: string; start_date: string }[];
  visibleAnnouncements: { id: string; title: string; body: string | null; published_at: string | null }[];
  newMembers: {
    id: string;
    first_name: string;
    last_name: string;
    photo_url: string | null;
    created_at: string | null;
  }[];
}

interface FeedSidebarWidgetsProps {
  orgSlug: string;
  data: FeedSidebarData;
}

export function FeedSidebarWidgets({ orgSlug, data }: FeedSidebarWidgetsProps) {
  return (
    <div className="space-y-4">
      <UpcomingEventsWidget events={data.upcomingEvents} orgSlug={orgSlug} />
      <RecentAnnouncementsWidget announcements={data.visibleAnnouncements} orgSlug={orgSlug} />
      <MemberHighlightsWidget members={data.newMembers} orgSlug={orgSlug} />
    </div>
  );
}
