import { redirect, notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { NewMemberForm } from "@/components/members/NewMemberForm";

interface NewMemberPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NewMemberPage({ params }: NewMemberPageProps) {
  const { orgSlug } = await params;

  const orgContext = await getOrgContext(orgSlug);

  if (!orgContext.organization) {
    return notFound();
  }

  // Admin only — members cannot create new member records
  if (orgContext.role !== "admin") {
    redirect(`/${orgSlug}/members`);
  }

  if (orgContext.gracePeriod.isReadOnly) {
    redirect(`/${orgSlug}/members`);
  }

  return (
    <NewMemberForm
      orgId={orgContext.organization.id}
      orgSlug={orgSlug}
    />
  );
}
