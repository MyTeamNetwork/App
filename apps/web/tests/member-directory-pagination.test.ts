import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMemberDirectoryPage, parseMemberDirectoryPage } from "@/lib/members/directory";
import { buildMembersPageHref } from "@/lib/members/routing";

const RPC_PAYLOAD = {
  rows: [
    {
      source: "member",
      profile_id: "member-1",
      first_name: "Alex",
      last_name: "Zimmer",
      email: "alex@example.com",
      photo_url: null,
      role: "Goalkeeper",
      status: "active",
      graduation_year: 2027,
      linkedin_url: null,
      user_id: "user-1",
      current_company: "Example FC",
      current_city: "Portland",
      org_role: "admin",
    },
    {
      source: "parent",
      profile_id: "parent-1",
      first_name: "Jamie",
      last_name: "Young",
      email: "jamie@example.com",
      photo_url: null,
      role: "Parent of Taylor",
      status: "active",
      graduation_year: null,
      linkedin_url: null,
      user_id: "user-2",
      current_company: null,
      current_city: null,
      org_role: "parent",
    },
  ],
  total: 98,
  roles: ["Coach", "Goalkeeper"],
  page: 2,
  page_size: 48,
};

test("parses positive directory page numbers and rejects invalid input", () => {
  assert.equal(parseMemberDirectoryPage("3"), 3);
  assert.equal(parseMemberDirectoryPage("0"), 1);
  assert.equal(parseMemberDirectoryPage("-2"), 1);
  assert.equal(parseMemberDirectoryPage("1.5"), 1);
  assert.equal(parseMemberDirectoryPage("not-a-number"), 1);
  assert.equal(parseMemberDirectoryPage("2147483648"), 1);
  assert.equal(parseMemberDirectoryPage(undefined), 1);
});

test("maps a paginated member RPC payload into directory entries", () => {
  const page = buildMemberDirectoryPage(RPC_PAYLOAD, "example-org");

  assert.equal(page.members.length, 2);
  assert.equal(page.members[0]?.profileHref, "/example-org/members/member-1");
  assert.equal(page.members[0]?.orgRoleLabel, "Admin");
  assert.equal(page.members[1]?.profileHref, "/example-org/parents/parent-1");
  assert.equal(page.members[1]?.isParent, true);
  assert.equal(page.total, 98);
  assert.equal(page.totalPages, 3);
  assert.deepEqual(page.roles, ["Coach", "Goalkeeper"]);
});

test("rejects malformed paginated member RPC payloads", () => {
  assert.throws(
    () => buildMemberDirectoryPage({ ...RPC_PAYLOAD, rows: [{ source: "member" }] }, "org"),
    /invalid directory row/i
  );
  assert.throws(
    () => buildMemberDirectoryPage({ ...RPC_PAYLOAD, total: "98" }, "org"),
    /invalid directory payload/i
  );
});

test("builds pagination links that preserve filters", () => {
  assert.equal(
    buildMembersPageHref({
      orgSlug: "example-org",
      page: 3,
      status: "inactive",
      role: "Coach",
    }),
    "/example-org/members?status=inactive&role=Coach&page=3"
  );
  assert.equal(buildMembersPageHref({ orgSlug: "example-org", page: 1 }), "/example-org/members");
  assert.equal(
    buildMembersPageHref({ orgSlug: "example-org", page: 1, status: "active" }),
    "/example-org/members"
  );
});

test("directory migration enforces bounded server pagination and ACLs", () => {
  const migration = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "../../supabase/migrations/20270105000000_paginate_member_directory.sql"
    ),
    "utf8"
  );

  assert.match(migration, /LEAST\(GREATEST\(COALESCE\(p_page_size, 48\), 1\), 100\)/);
  assert.match(migration, /COUNT\(\*\) OVER \(\)/);
  assert.match(migration, /LIMIT v_page_size/);
  assert.match(migration, /OFFSET \(v_page::bigint - 1\) \* v_page_size/);
  assert.match(migration, /FROM public\.user_blocks/);
  assert.match(migration, /v_viewer_id uuid := COALESCE\(auth\.uid\(\), p_viewer_id\)/);
  assert.match(migration, /eligible_linked_members AS MATERIALIZED/);
  assert.match(migration, /FROM eligible_linked_members linked_member/);
  assert.match(migration, /'roles', COALESCE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_org_member_directory/);
});
