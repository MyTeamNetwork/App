import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { getPersonAdminContext } from "@/lib/people/permissions";
import { EditMemberForm } from "@/components/members/EditMemberForm";
import type { Member } from "@/types/database";

interface EditMemberPageProps {
  params: Promise<{ orgSlug: string; memberId: string }>;
}

export default async function EditMemberPage({ params }: EditMemberPageProps) {
  const { orgSlug, memberId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dataClient = resolveDataClient(user, supabase, "view_members");

  const { data: orgData, error: orgError } = await dataClient
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .limit(1);

  if (!orgData?.[0] || orgError) {
    return notFound();
  }

  const orgId = orgData[0].id;

  const { data: memberData } = await dataClient
    .from("members")
    .select("*")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .single();

  if (!memberData) {
    return notFound();
  }

  const member = memberData as Member & {
    expected_graduation_date?: string;
    current_company?: string;
    school?: string;
    bio?: string;
    current_city?: string;
    major?: string;
    user_id?: string | null;
  };

  const memberUserId = member.user_id || null;

  const [ctx, accessResult] = await Promise.all([
    getPersonAdminContext({ orgId, viewerUserId: user?.id ?? null }),
    memberUserId
      ? dataClient
          .from("user_organization_roles")
          .select("role, status")
          .eq("organization_id", orgId)
          .eq("user_id", memberUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const canEdit = ctx.canEditPerson(memberUserId);

  if (!canEdit) {
    return notFound();
  }

  const access = accessResult.data;
  const initialAccess =
    memberUserId && access
      ? { userId: memberUserId, role: access.role ?? "", status: access.status ?? "" }
      : null;

  return (
    <EditMemberForm
      orgId={orgId}
      orgSlug={orgSlug}
      memberId={memberId}
      isAdmin={ctx.isAdmin}
      isReadOnly={ctx.isReadOnly}
      initialData={{
        first_name: member.first_name || "",
        last_name: member.last_name || "",
        email: member.email || "",
        role: member.role || "",
        status: (member.status === "pending" ? "active" : member.status) || "active",
        graduation_year: member.graduation_year?.toString() || "",
        expected_graduation_date: member.expected_graduation_date || "",
        photo_url: member.photo_url || "",
        linkedin_url: member.linkedin_url || "",
        current_company: member.current_company || "",
        school: member.school || "",
        bio: member.bio || "",
        current_city: member.current_city || "",
        major: member.major || "",
      }}
      initialAccess={initialAccess}
    />
  );
}
