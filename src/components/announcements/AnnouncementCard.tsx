import Link from "next/link";
import { Card, Badge, Button, SoftDeleteButton } from "@/components/ui";
import type { Database } from "@/types/database";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];

interface AnnouncementCardProps {
  announcement: Announcement;
  orgSlug: string;
  isAdmin: boolean;
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "Scheduled";
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46"
      />
    </svg>
  );
}

export function AnnouncementCard({
  announcement,
  orgSlug,
  isAdmin,
}: AnnouncementCardProps) {
  const isPinned = announcement.is_pinned;

  const cardClassName = isPinned
    ? "p-6 border-l-4 border-l-green-500"
    : "p-6";

  const iconClassName = isPinned
    ? "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-900/30"
    : "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-muted";

  const iconColorClassName = isPinned
    ? "h-5 w-5 text-green-600 dark:text-green-400"
    : "h-5 w-5 text-muted-foreground";

  return (
    <Card className={cardClassName}>
      <div className="flex items-start gap-4">
        {/* Megaphone icon badge */}
        <div className={iconClassName}>
          <MegaphoneIcon className={iconColorClassName} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Top row: date/time + badges + admin actions */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {formatDateTime(announcement.published_at)}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isPinned && <Badge variant="success">Pinned</Badge>}
              {isAdmin && (
                <>
                  <Link href={`/${orgSlug}/announcements/${announcement.id}/edit`}>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </Link>
                  <SoftDeleteButton
                    table="announcements"
                    id={announcement.id}
                    organizationField="organization_id"
                    organizationId={announcement.organization_id}
                    redirectTo={`/${orgSlug}/announcements`}
                    label="Delete"
                  />
                </>
              )}
            </div>
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-foreground mt-1">
            {announcement.title}
          </h3>

          {/* Body preview */}
          {announcement.body && (
            <p className="text-muted-foreground mt-2 line-clamp-3 whitespace-pre-wrap">
              {announcement.body}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
