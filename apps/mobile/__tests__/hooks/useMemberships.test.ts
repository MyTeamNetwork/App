/**
 * useMemberships Hook Helper Functions Tests
 * Tests membership helper functions (pure functions only)
 */

// Only test the pure helper functions, not the hook itself
// The hook requires React Native environment
describe("Membership Helper Functions", () => {
  let getRoleLabel: typeof import("../../src/hooks/useMemberships").getRoleLabel;
  let getStatusLabel: typeof import("../../src/hooks/useMemberships").getStatusLabel;

  beforeAll(() => {
    // Mock the Supabase module so we can import the helpers
    jest.mock("@/lib/supabase", () => ({
      supabase: {
        from: jest.fn(),
        rpc: jest.fn(),
        auth: { getUser: jest.fn() },
        channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
        removeChannel: jest.fn(),
      },
    }));

    // Mock React since we're only testing pure functions
    jest.mock("react", () => ({
      useEffect: jest.fn(),
      useState: jest.fn(),
      useRef: jest.fn(),
      useCallback: jest.fn(),
    }));

    // Now import the module
    const mod = require("../../src/hooks/useMemberships");
    getRoleLabel = mod.getRoleLabel;
    getStatusLabel = mod.getStatusLabel;
  });

  afterAll(() => {
    jest.unmock("@/lib/supabase");
    jest.unmock("react");
  });

  describe("getRoleLabel", () => {
    it("should return 'Admin' for admin role", () => {
      expect(getRoleLabel("admin")).toBe("Admin");
    });

    it("should return 'Alumni' for alumni role", () => {
      expect(getRoleLabel("alumni")).toBe("Alumni");
    });

    it("should return 'Active Member' for active_member role", () => {
      expect(getRoleLabel("active_member")).toBe("Active Member");
    });

    it("should return 'Member' for member role", () => {
      expect(getRoleLabel("member")).toBe("Member");
    });

    it("should return the role unchanged for unknown roles", () => {
      expect(getRoleLabel("unknown_role")).toBe("unknown_role");
      expect(getRoleLabel("custom")).toBe("custom");
      expect(getRoleLabel("viewer")).toBe("viewer");
    });

    it("should handle empty string", () => {
      expect(getRoleLabel("")).toBe("");
    });
  });

  describe("getStatusLabel", () => {
    it("should return 'Active' for active status", () => {
      expect(getStatusLabel("active")).toBe("Active");
    });

    it("should return 'Revoked' for revoked status", () => {
      expect(getStatusLabel("revoked")).toBe("Revoked");
    });

    it("should return 'Pending' for pending status", () => {
      expect(getStatusLabel("pending")).toBe("Pending");
    });

    it("should return the status unchanged for unknown statuses", () => {
      expect(getStatusLabel("unknown")).toBe("unknown");
      expect(getStatusLabel("suspended")).toBe("suspended");
    });

    it("should handle empty string", () => {
      expect(getStatusLabel("")).toBe("");
    });
  });
});

describe("mergePendingIdentities", () => {
  let mergePendingIdentities: typeof import("../../src/hooks/useMemberships").mergePendingIdentities;
  type Membership = import("../../src/hooks/useMemberships").Membership;
  type PendingApprovalIdentity = import("../../src/hooks/useMemberships").PendingApprovalIdentity;

  beforeAll(() => {
    jest.mock("@/lib/supabase", () => ({
      supabase: {
        from: jest.fn(),
        rpc: jest.fn(),
        channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
        removeChannel: jest.fn(),
      },
    }));
    jest.mock("react", () => ({
      useEffect: jest.fn(),
      useState: jest.fn(),
      useRef: jest.fn(),
      useCallback: jest.fn(),
    }));

    const mod = require("../../src/hooks/useMemberships");
    mergePendingIdentities = mod.mergePendingIdentities;
  });

  afterAll(() => {
    jest.unmock("@/lib/supabase");
    jest.unmock("react");
  });

  const pendingRow = (overrides: Partial<Membership> = {}): Membership => ({
    id: "row-1",
    user_id: "user-1",
    role: "alumni",
    status: "pending",
    created_at: "2026-06-05T12:46:29Z",
    user: null,
    ...overrides,
  });

  const identity = (
    overrides: Partial<PendingApprovalIdentity> = {}
  ): PendingApprovalIdentity => ({
    user_id: "user-1",
    role: "alumni",
    status: "pending",
    created_at: "2026-06-05T12:46:29Z",
    name: "Diego Semporini",
    email: "diego@example.com",
    ...overrides,
  });

  it("fills name/email on a pending row whose users join was hidden by RLS", () => {
    const result = mergePendingIdentities([pendingRow()], [identity()]);
    expect(result).toHaveLength(1);
    expect(result[0].user).toEqual({
      id: "user-1",
      email: "diego@example.com",
      name: "Diego Semporini",
      avatar_url: null,
    });
  });

  it("keeps existing user fields when the join did resolve", () => {
    const existing = pendingRow({
      user: { id: "user-1", email: "joined@example.com", name: "Joined Name", avatar_url: "http://a" },
    });
    const result = mergePendingIdentities([existing], [identity()]);
    expect(result[0].user).toEqual({
      id: "user-1",
      email: "joined@example.com",
      name: "Joined Name",
      avatar_url: "http://a",
    });
  });

  it("never touches non-pending rows", () => {
    const active = pendingRow({ id: "row-2", user_id: "user-2", status: "active" });
    const result = mergePendingIdentities([active], [identity({ user_id: "user-2" })]);
    expect(result[0]).toBe(active);
  });

  it("appends a synthetic pending row when the base query cannot see it", () => {
    const result = mergePendingIdentities([], [identity()]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "pending:user-1",
      user_id: "user-1",
      role: "alumni",
      status: "pending",
      created_at: "2026-06-05T12:46:29Z",
      user: { id: "user-1", email: "diego@example.com", name: "Diego Semporini", avatar_url: null },
    });
  });

  it("returns memberships unchanged when there are no approvals", () => {
    const rows = [pendingRow()];
    expect(mergePendingIdentities(rows, [])).toBe(rows);
  });

  it("leaves a pending row intact when the RPC has no identity for it", () => {
    const row = pendingRow({ user_id: "user-9" });
    const result = mergePendingIdentities([row], [identity()]);
    expect(result[0]).toEqual(row);
    expect(result).toHaveLength(2); // identity for user-1 appended as synthetic row
  });
});

describe("Membership Status Lifecycle", () => {
  let getRoleLabel: typeof import("../../src/hooks/useMemberships").getRoleLabel;
  let getStatusLabel: typeof import("../../src/hooks/useMemberships").getStatusLabel;

  beforeAll(() => {
    jest.mock("@/lib/supabase", () => ({
      supabase: { from: jest.fn(), channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })), removeChannel: jest.fn() },
    }));
    jest.mock("react", () => ({
      useEffect: jest.fn(),
      useState: jest.fn(),
      useRef: jest.fn(),
      useCallback: jest.fn(),
    }));

    const mod = require("../../src/hooks/useMemberships");
    getRoleLabel = mod.getRoleLabel;
    getStatusLabel = mod.getStatusLabel;
  });

  it("should have valid status transitions", () => {
    // Document expected status values
    const validStatuses = ["active", "revoked", "pending"];
    validStatuses.forEach((status) => {
      const label = getStatusLabel(status);
      expect(label).not.toBe(status); // Should be transformed
      expect(label.length).toBeGreaterThan(0);
    });
  });

  it("should have valid role values", () => {
    const validRoles = ["admin", "active_member", "alumni", "member"];
    validRoles.forEach((role) => {
      const label = getRoleLabel(role);
      expect(label).not.toBe(role); // Should be transformed (except member)
      expect(label.length).toBeGreaterThan(0);
    });
  });
});
