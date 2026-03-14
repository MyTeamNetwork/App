import type { OrgRole } from "@/lib/auth/role-utils";

interface FeedSidebarProps {
  orgSlug: string;
  orgId: string;
  role: OrgRole | null;
  status: string | null;
  userId: string | null;
  isDevAdmin: boolean;
}

export async function FeedSidebar({ orgSlug }: FeedSidebarProps) {
  return (
    <div className="space-y-4">
      {/* Widgets added in Task 2 */}
      <p className="text-sm text-muted-foreground">Feed sidebar</p>
    </div>
  );
}
