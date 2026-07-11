export function buildMembersPageHref(params: {
  orgSlug: string;
  page: number;
  status?: string;
  role?: string;
}): string {
  const query = new URLSearchParams();
  if (params.status && params.status !== "active") query.set("status", params.status);
  if (params.role) query.set("role", params.role);
  if (params.page > 1) query.set("page", String(params.page));
  const suffix = query.toString();
  return `/${params.orgSlug}/members${suffix ? `?${suffix}` : ""}`;
}
