import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { getCurrentUser, getOrgContext } from "@/lib/auth/roles";
import { MembersFilter } from "@/components/members/MembersFilter";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import { resolveDataClient, getDevAdminEmails } from "@/lib/auth/dev-admin";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { DirectoryViewTracker } from "@/components/analytics/DirectoryViewTracker";
import { DirectoryCardLink } from "@/components/analytics/DirectoryCardLink";
import { LinkedInBadge, formatPersonHeadline } from "@/components/shared";
import {
  buildMemberDirectoryPage,
  MEMBER_DIRECTORY_PAGE_SIZE,
  parseMemberDirectoryPage,
} from "@/lib/members/directory";
import { buildMembersPageHref } from "@/lib/members/routing";

interface MembersPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; role?: string; page?: string }>;
}

export default async function MembersPage({ params, searchParams }: MembersPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;

  // Alumni live in a separate `alumni` table with its own page; redirect so
  // the role filter can't dead-end on /members with zero results.
  if (filters.role === "alumni") {
    redirect(`/${orgSlug}/alumni`);
  }

  const { organization: org, isAdmin } = await getOrgContext(orgSlug);
  if (!org) notFound();

  const supabase = await createClient();
  const user = await getCurrentUser();
  const dataClient = resolveDataClient(user, supabase, "view_members");
  const requestedPage = parseMemberDirectoryPage(filters.page);
  const { data, error } = await dataClient.rpc("get_org_member_directory", {
    p_org_id: org.id,
    p_status: filters.status || null,
    p_role: filters.role || null,
    p_page: requestedPage,
    p_page_size: MEMBER_DIRECTORY_PAGE_SIZE,
    p_excluded_emails: getDevAdminEmails(),
    p_viewer_id: user?.id ?? null,
  });
  if (error) throw error;

  const directoryPage = buildMemberDirectoryPage(data, orgSlug);
  const { members, roles, total, totalPages, page } = directoryPage;
  if (requestedPage > totalPages) {
    redirect(
      buildMembersPageHref({
        orgSlug,
        page: totalPages,
        status: filters.status,
        role: filters.role,
      })
    );
  }

  const navConfig = org.nav_config as NavConfig | null;
  const [tNav, tCommon, tPagesMembers, locale] = await Promise.all([
    getTranslations("nav.items"),
    getTranslations("common"),
    getTranslations("pages.members"),
    getLocale(),
  ]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/members", navConfig, t, locale);
  const actionLabel = resolveActionLabel("/members", navConfig, "Add", t, locale);

  return (
    <div>
      <DirectoryViewTracker organizationId={org.id} directoryType="active_members" />
      <PageHeader
        title={pageLabel}
        description={`${total} ${filters.status === "inactive" ? tPagesMembers("inactive") : tPagesMembers("active")} ${pageLabel.toLowerCase()}`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/members/new`}>
              <Button>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {actionLabel}
              </Button>
            </Link>
          )
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <MembersFilter
          orgSlug={orgSlug}
          orgId={org.id}
          currentStatus={filters.status}
          currentRole={filters.role}
          roles={roles}
        />
      </div>

      {/* Members Grid */}
      {members.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {members.map((member) => {
              const orgRoleLabel = member.orgRoleLabel;
              return (
                <Card key={member.id} interactive className="p-5">
                  <div className="flex items-center gap-4">
                    <DirectoryCardLink
                      href={member.profileHref}
                      organizationId={org.id}
                      directoryType="active_members"
                      className="flex min-w-0 flex-1 items-center gap-4"
                    >
                      <Avatar
                        src={member.photo_url}
                        name={`${member.first_name} ${member.last_name}`}
                        size="lg"
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">
                          {member.first_name} {member.last_name}
                        </h3>
                        {(() => {
                          const headline = formatPersonHeadline({
                            role: member.role,
                            current_company: member.current_company,
                          });
                          return headline ? (
                            <p className="text-sm text-muted-foreground truncate">{headline}</p>
                          ) : null;
                        })()}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge variant={member.status === "active" ? "success" : "muted"}>
                            {member.status}
                          </Badge>
                          {member.isParent && <Badge variant="primary">Parent</Badge>}
                          {orgRoleLabel && orgRoleLabel !== "Parent" && (
                            <Badge variant={orgRoleLabel === "Admin" ? "warning" : "muted"}>
                              {orgRoleLabel}
                            </Badge>
                          )}
                          {member.graduation_year && (
                            <span className="text-xs text-muted-foreground">
                              &apos;{member.graduation_year.toString().slice(-2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </DirectoryCardLink>
                    <LinkedInBadge linkedinUrl={member.linkedin_url} className="shrink-0" />
                  </div>
                </Card>
              );
            })}
          </div>
          {totalPages > 1 && (
            <nav aria-label="Member directory pagination" className="flex justify-center gap-2">
              {page > 1 && (
                <Link
                  href={buildMembersPageHref({
                    orgSlug,
                    page: page - 1,
                    status: filters.status,
                    role: filters.role,
                  })}
                >
                  <Button variant="ghost" size="sm">
                    {tCommon("previous")}
                  </Button>
                </Link>
              )}
              <span className="self-center text-sm text-muted-foreground">
                {tCommon("page", { page, totalPages })}
              </span>
              {page < totalPages && (
                <Link
                  href={buildMembersPageHref({
                    orgSlug,
                    page: page + 1,
                    status: filters.status,
                    role: filters.role,
                  })}
                >
                  <Button variant="ghost" size="sm">
                    {tCommon("next")}
                  </Button>
                </Link>
              )}
            </nav>
          )}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg
                className="h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                />
              </svg>
            }
            title={tPagesMembers("noMembersFound", { label: pageLabel.toLowerCase() })}
            description={
              filters.status === "inactive"
                ? tPagesMembers("noInactiveMembers", { label: pageLabel.toLowerCase() })
                : tPagesMembers("noActiveMembers", { label: pageLabel.toLowerCase() })
            }
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/members/new`}>
                  <Button>{resolveActionLabel("/members", navConfig, "Add First")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
