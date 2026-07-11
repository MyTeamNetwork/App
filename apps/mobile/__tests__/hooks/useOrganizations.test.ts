/**
 * useOrganizations — extractOrganizations() pure-function tests.
 *
 * Guards the derivation that powers the mobile "your organizations" screen:
 * user_organization_roles rows -> Organization[]. An empty result is what the
 * app renders as "you are in no orgs", so this locks in the mapping/filtering
 * behaviour against regressions. (The DATA condition that actually stranded
 * real users is covered separately by apps/web/scripts/check-orphaned-memberships.js.)
 *
 * Only the pure helper is tested — the hook itself needs a React Native env.
 */

// Mock the hook's module-load dependencies so we can import the pure helper.
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
  createPostgresChangesChannel: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn(),
  })),
}));
jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/hooks/useRequestTracker", () => ({ useRequestTracker: jest.fn() }));
jest.mock("@/lib/analytics/sentry", () => ({ captureException: jest.fn() }));

const { extractOrganizations } = require("../../src/hooks/useOrganizations");

// Minimal Organization-shaped fixtures (only id/slug matter for these tests).
const orgA = { id: "org-a", slug: "team-a", name: "Team A" };
const orgB = { id: "org-b", slug: "team-b", name: "Team B" };

describe("extractOrganizations", () => {
  it("maps role rows to their joined organizations", () => {
    const rows = [{ organization: orgA }, { organization: orgB }];
    expect(extractOrganizations(rows)).toEqual([orgA, orgB]);
  });

  it("returns an empty list for no rows (the 'no orgs' state)", () => {
    expect(extractOrganizations([])).toEqual([]);
  });

  it("treats null/undefined query data as an empty list", () => {
    expect(extractOrganizations(null)).toEqual([]);
    expect(extractOrganizations(undefined)).toEqual([]);
  });

  it("drops rows whose joined organization is null (deleted/inaccessible)", () => {
    const rows = [
      { organization: orgA },
      { organization: null },
      { organization: orgB },
    ];
    expect(extractOrganizations(rows)).toEqual([orgA, orgB]);
  });

  it("returns empty when every row's organization is null", () => {
    const rows = [{ organization: null }, { organization: null }];
    expect(extractOrganizations(rows)).toEqual([]);
  });

  it("preserves order and does not de-duplicate distinct orgs", () => {
    const rows = [{ organization: orgB }, { organization: orgA }];
    expect(extractOrganizations(rows)).toEqual([orgB, orgA]);
  });
});
