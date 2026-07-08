"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { editMemberSchema, type EditMemberForm as EditMemberFormData } from "@/lib/schemas/member";

const READ_ONLY_ERROR =
  "This organization is in its billing grace period. Existing members cannot be edited until billing is restored.";

interface EditMemberInitialData {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  graduation_year: string;
  expected_graduation_date: string;
  photo_url: string;
  linkedin_url: string;
  current_company: string;
  school: string;
  bio: string;
  current_city: string;
  major: string;
}

interface EditMemberFormProps {
  orgId: string;
  orgSlug: string;
  memberId: string;
  isAdmin: boolean;
  isReadOnly: boolean;
  initialData: EditMemberInitialData;
  initialAccess: { userId: string; role: string; status: string } | null;
}

export function EditMemberForm({
  orgId,
  orgSlug,
  memberId,
  isAdmin,
  isReadOnly,
  initialData,
  initialAccess,
}: EditMemberFormProps) {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<EditMemberFormData>({
    resolver: zodResolver(editMemberSchema),
    defaultValues: {
      first_name: initialData.first_name,
      last_name: initialData.last_name,
      email: initialData.email,
      role: initialData.role,
      status: initialData.status as EditMemberFormData["status"],
      graduation_year: initialData.graduation_year,
      expected_graduation_date: initialData.expected_graduation_date,
      photo_url: initialData.photo_url,
      linkedin_url: initialData.linkedin_url,
      current_company: initialData.current_company,
      school: initialData.school,
      bio: initialData.bio,
      current_city: initialData.current_city,
      major: initialData.major,
    },
  });

  const [accessData, setAccessData] = useState({
    userId: initialAccess?.userId ?? "",
    role: initialAccess?.role ?? "",
    status: initialAccess?.status ?? "",
  });
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isUpdatingAccess, setIsUpdatingAccess] = useState(false);

  const [isReinstating, setIsReinstating] = useState(false);
  const [reinstateError, setReinstateError] = useState<string | null>(null);

  const handleAccessUpdate = async () => {
    if (!accessData.userId || isReadOnly) return;

    const validStatuses = ["active", "revoked", "pending"];
    const validRoles = ["admin", "active_member", "alumni", "parent"];

    if (!validStatuses.includes(accessData.status)) {
      setAccessError("Invalid access status");
      return;
    }
    if (!validRoles.includes(accessData.role)) {
      setAccessError("Invalid role");
      return;
    }

    setIsUpdatingAccess(true);
    setAccessError(null);

    const response = await fetch(`/api/organizations/${orgId}/members/${accessData.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: accessData.role, status: accessData.status }),
    });

    const data = await response.json();

    if (!response.ok) {
      setAccessError(data.error || "Failed to update access");
    } else {
      router.refresh();
    }
    setIsUpdatingAccess(false);
  };

  const handleReinstate = async () => {
    if (isReadOnly) return;
    setIsReinstating(true);
    setReinstateError(null);

    const response = await fetch(
      `/api/organizations/${orgId}/members/${memberId}/reinstate`,
      { method: "POST" }
    );

    const data = await response.json();

    if (!response.ok) {
      setReinstateError(data.error || "Failed to reinstate member");
    } else {
      router.refresh();
      setAccessData({ ...accessData, role: "active_member", status: "active" });
    }
    setIsReinstating(false);
  };

  const onSubmit = async (data: EditMemberFormData) => {
    if (isReadOnly) return;
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("members")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email || null,
        role: data.role || null,
        graduation_year: data.graduation_year ? parseInt(data.graduation_year) : null,
        expected_graduation_date: data.expected_graduation_date || null,
        photo_url: data.photo_url || null,
        linkedin_url: data.linkedin_url || null,
        current_company: data.current_company || null,
        school: data.school || null,
        bio: data.bio || null,
        current_city: data.current_city || null,
        major: data.major || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", memberId)
      .eq("organization_id", orgId);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    router.refresh();
    router.push(`/${orgSlug}/members/${memberId}`);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Member"
        description={isReadOnly ? "Viewing member information during grace period" : "Update member information"}
        backHref={`/${orgSlug}/members/${memberId}`}
      />

      {isReadOnly && (
        <div className="mb-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          {READ_ONLY_ERROR}
        </div>
      )}

      <div className="grid gap-6">
        <Card className="max-w-2xl">
          <form
            data-testid="member-edit-form"
            onSubmit={handleSubmit(onSubmit)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
              }
            }}
            className="p-6 space-y-6"
          >
            <fieldset disabled={isReadOnly || isLoading} className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-4">Profile Information</h3>
                {error && (
                  <div data-testid="member-edit-error" className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Input
                    label="First Name"
                    data-testid="member-edit-first-name"
                    error={errors.first_name?.message}
                    {...register("first_name")}
                  />
                  <Input
                    label="Last Name"
                    data-testid="member-edit-last-name"
                    error={errors.last_name?.message}
                    {...register("last_name")}
                  />
                </div>

                <Input
                  label="Email"
                  type="email"
                  placeholder="member@example.com"
                  className="mb-4"
                  data-testid="member-edit-email"
                  error={errors.email?.message}
                  {...register("email")}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Input
                    label="Title/Position"
                    placeholder="e.g., Quarterback, Member, Staff"
                    error={errors.role?.message}
                    {...register("role")}
                  />
                  <Input
                    label="Graduation Year"
                    type="number"
                    placeholder="2025"
                    min={1900}
                    max={2100}
                    error={errors.graduation_year?.message}
                    {...register("graduation_year")}
                  />
                </div>

                <div className="mb-4">
                  <Input
                    label="Expected Graduation Date"
                    type="date"
                    error={errors.expected_graduation_date?.message}
                    {...register("expected_graduation_date", {
                      onChange: (e) => {
                        if (e.target.value) {
                          // Parse year directly from YYYY-MM-DD string to avoid timezone issues
                          // Using new Date("YYYY-MM-DD").getFullYear() can return wrong year
                          // in timezones west of UTC (e.g., 2025-01-01 becomes 2024)
                          const year = parseInt(e.target.value.split("-")[0], 10);
                          setValue("graduation_year", year.toString());
                        }
                      },
                    })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    When this member will automatically transition to alumni status
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Input
                    label="Current Company"
                    placeholder="e.g., Acme Corp"
                    error={errors.current_company?.message}
                    {...register("current_company")}
                  />
                  <Input
                    label="Current City"
                    placeholder="e.g., San Francisco, CA"
                    error={errors.current_city?.message}
                    {...register("current_city")}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Input
                    label="School"
                    placeholder="e.g., State University"
                    error={errors.school?.message}
                    {...register("school")}
                  />
                  <Input
                    label="Major / Field of Study"
                    placeholder="e.g., Computer Science"
                    error={errors.major?.message}
                    {...register("major")}
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-foreground mb-1.5">Bio</label>
                  <textarea
                    className="w-full rounded-xl border border-border bg-[var(--card)] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)] min-h-[100px] resize-y"
                    placeholder="A short bio or about section"
                    {...register("bio")}
                  />
                  {errors.bio?.message && (
                    <p className="mt-1 text-xs text-red-500">{errors.bio.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Input
                    label="Photo URL"
                    type="url"
                    placeholder="https://example.com/photo.jpg"
                    error={errors.photo_url?.message}
                    {...register("photo_url")}
                  />
                  <Input
                    label="LinkedIn profile (optional)"
                    type="url"
                    placeholder="https://www.linkedin.com/in/username"
                    error={errors.linkedin_url?.message}
                    {...register("linkedin_url")}
                  />
                </div>
              </div>
            </fieldset>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={() => router.back()} data-testid="member-edit-cancel">
                Cancel
              </Button>
              <Button type="submit" isLoading={isLoading} disabled={isReadOnly} data-testid="member-edit-submit">
                Save Profile
              </Button>
            </div>
          </form>
        </Card>

        {/* System Access Section - Admin only, and only if user record exists */}
        {isAdmin && accessData.userId && (
          <Card className="max-w-2xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-foreground">System Access</h3>
                  <p className="text-sm text-muted-foreground">Manage roles and permissions</p>
                </div>
                {accessData.status === "revoked" && (
                  <span className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium">
                    Access Revoked
                  </span>
                )}
              </div>

              {isReadOnly && (
                <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  System access changes are disabled while this organization is in its billing grace period.
                </div>
              )}

              {/* Reinstate Button - show for alumni members */}
              {accessData.role === "alumni" && (
                <div className="mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        This member is an alumni
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Reinstate them as an active member immediately
                      </p>
                    </div>
                    <Button
                      onClick={handleReinstate}
                      isLoading={isReinstating}
                      disabled={isReadOnly}
                      variant="secondary"
                      className="whitespace-nowrap"
                    >
                      Reinstate Member
                    </Button>
                  </div>
                  {reinstateError && (
                    <p className="mt-2 text-sm text-red-600">{reinstateError}</p>
                  )}
                </div>
              )}

              {accessError && (
                <div className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {accessError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <Select
                  label="System Role"
                  value={accessData.role}
                  disabled={isReadOnly}
                  onChange={(e) => setAccessData({ ...accessData, role: e.target.value })}
                  options={[
                    { value: "active_member", label: "Active Member" },
                    { value: "admin", label: "Admin" },
                    { value: "alumni", label: "Alumni" },
                    { value: "parent", label: "Parent" },
                  ]}
                />

                <Select
                  label="Access Status"
                  value={accessData.status}
                  disabled={isReadOnly}
                  onChange={(e) => setAccessData({ ...accessData, status: e.target.value })}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "pending", label: "Pending (Needs Approval)" },
                    { value: "revoked", label: "Revoked (Disabled)" },
                  ]}
                />
              </div>

              <div className="flex justify-end pt-4 border-t border-border">
                <Button
                  onClick={handleAccessUpdate}
                  isLoading={isUpdatingAccess}
                  disabled={isReadOnly}
                  variant="secondary"
                >
                  Update Access
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
