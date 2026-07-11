import { orgRoleLabelForRole, type OrgRoleLabel } from "@/lib/people/permissions-core";

export const MEMBER_DIRECTORY_PAGE_SIZE = 48;

type MemberDirectorySource = "member" | "parent";

interface MemberDirectoryRpcRow {
  source: MemberDirectorySource;
  profile_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  status: string | null;
  graduation_year: number | null;
  linkedin_url: string | null;
  user_id: string | null;
  current_company: string | null;
  current_city: string | null;
  org_role: string | null;
}

export interface MemberDirectoryEntry {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  role: string | null;
  status: string | null;
  graduation_year: number | null;
  linkedin_url: string | null;
  current_company: string | null;
  current_city: string | null;
  user_id: string | null;
  isParent: boolean;
  orgRoleLabel: OrgRoleLabel | null;
  profileHref: string;
}

export interface MemberDirectoryPage {
  members: MemberDirectoryEntry[];
  total: number;
  roles: string[];
  page: number;
  pageSize: number;
  totalPages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseDirectoryRow(value: unknown): MemberDirectoryRpcRow {
  if (
    !isRecord(value) ||
    (value.source !== "member" && value.source !== "parent") ||
    typeof value.profile_id !== "string" ||
    typeof value.first_name !== "string" ||
    typeof value.last_name !== "string"
  ) {
    throw new Error("get_org_member_directory returned an invalid directory row");
  }

  const graduationYear = value.graduation_year;
  if (graduationYear !== null && typeof graduationYear !== "number") {
    throw new Error("get_org_member_directory returned an invalid directory row");
  }

  return {
    source: value.source,
    profile_id: value.profile_id,
    first_name: value.first_name,
    last_name: value.last_name,
    email: nullableString(value.email),
    photo_url: nullableString(value.photo_url),
    role: nullableString(value.role),
    status: nullableString(value.status),
    graduation_year: graduationYear,
    linkedin_url: nullableString(value.linkedin_url),
    user_id: nullableString(value.user_id),
    current_company: nullableString(value.current_company),
    current_city: nullableString(value.current_city),
    org_role: nullableString(value.org_role),
  };
}

export function parseMemberDirectoryPage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 2_147_483_647 ? page : 1;
}

export function buildMemberDirectoryPage(payload: unknown, orgSlug: string): MemberDirectoryPage {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.rows) ||
    !Array.isArray(payload.roles) ||
    !payload.roles.every((role) => typeof role === "string") ||
    typeof payload.total !== "number" ||
    !Number.isSafeInteger(payload.total) ||
    payload.total < 0 ||
    typeof payload.page !== "number" ||
    !Number.isSafeInteger(payload.page) ||
    payload.page < 1 ||
    typeof payload.page_size !== "number" ||
    !Number.isSafeInteger(payload.page_size) ||
    payload.page_size < 1
  ) {
    throw new Error("get_org_member_directory returned an invalid directory payload");
  }

  const members = payload.rows.map(parseDirectoryRow).map((row) => {
    const isParent = row.source === "parent";
    return {
      id: isParent ? `parent-${row.profile_id}` : row.profile_id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      photo_url: row.photo_url,
      role: row.role,
      status: row.status,
      graduation_year: row.graduation_year,
      linkedin_url: row.linkedin_url,
      current_company: row.current_company,
      current_city: row.current_city,
      user_id: row.user_id,
      isParent,
      orgRoleLabel: orgRoleLabelForRole(row.org_role),
      profileHref: isParent
        ? `/${orgSlug}/parents/${row.profile_id}`
        : `/${orgSlug}/members/${row.profile_id}`,
    } satisfies MemberDirectoryEntry;
  });

  return {
    members,
    total: payload.total,
    roles: payload.roles,
    page: payload.page,
    pageSize: payload.page_size,
    totalPages: Math.max(1, Math.ceil(payload.total / payload.page_size)),
  };
}
