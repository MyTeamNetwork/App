import {
  getMentorshipSectionOrder,
  normalizeMentorshipStatus,
  partitionPairableOrgMembers,
  type PairableOrgMemberRow,
} from "@teammeet/core";

describe("mentorship parity rules", () => {
  test("mobile uses the same section ordering as web", () => {
    expect(getMentorshipSectionOrder({ hasPairs: true, isAdmin: false })).toBe(
      "pairs-first"
    );
    expect(getMentorshipSectionOrder({ hasPairs: true, isAdmin: true })).toBe(
      "directory-first"
    );
    expect(getMentorshipSectionOrder({ hasPairs: false, isAdmin: false })).toBe(
      "directory-first"
    );
  });

  test("mobile pairable member rules include admins as mentors and active members as mentees", () => {
    const rows: PairableOrgMemberRow[] = [
      {
        user_id: "admin-1",
        role: "admin",
        users: { name: "Admin Mentor", email: "admin@example.com" },
      },
      {
        user_id: "alumni-1",
        role: "alumni",
        users: { name: "Alumni Mentor", email: "alumni@example.com" },
      },
      {
        user_id: "member-1",
        role: "active_member",
        users: { name: "Active Mentee", email: "member@example.com" },
      },
    ];

    const result = partitionPairableOrgMembers(rows);

    expect(result.mentors.map((member) => member.user_id)).toEqual([
      "admin-1",
      "alumni-1",
    ]);
    expect(result.mentees.map((member) => member.user_id)).toEqual(["member-1"]);
  });

  test("unexpected statuses normalize to active", () => {
    expect(normalizeMentorshipStatus("paused")).toBe("paused");
    expect(normalizeMentorshipStatus("completed")).toBe("completed");
    expect(normalizeMentorshipStatus("weird")).toBe("active");
  });
});
