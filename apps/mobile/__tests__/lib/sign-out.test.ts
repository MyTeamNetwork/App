const mockGetSession = jest.fn();
const mockAuthSignOut = jest.fn();
const mockStopAutoRefresh = jest.fn();
const mockStartAutoRefresh = jest.fn();
const mockSignOutCleanup = jest.fn();
const mockResetAnalytics = jest.fn();
const mockCaptureException = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: mockGetSession,
      signOut: mockAuthSignOut,
      stopAutoRefresh: mockStopAutoRefresh,
      startAutoRefresh: mockStartAutoRefresh,
    },
  })),
}));

jest.mock("@/lib/auth-storage", () => ({
  getSupabaseStorage: jest.fn(() => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: mockRemoveItem,
  })),
}));

jest.mock("@/lib/analytics", () => ({
  captureException: mockCaptureException,
  reset: mockResetAnalytics,
}));

jest.mock("@/lib/lifecycle", () => ({
  signOutCleanup: mockSignOutCleanup,
}));

jest.unmock("@/lib/supabase");

describe("mobile signOut", () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  beforeEach(() => {
    mockGetSession.mockReset();
    mockAuthSignOut.mockReset();
    mockStopAutoRefresh.mockReset();
    mockStartAutoRefresh.mockReset();
    mockSignOutCleanup.mockReset();
    mockRemoveItem.mockReset();
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockAuthSignOut.mockResolvedValue({ error: null });
    mockStopAutoRefresh.mockResolvedValue(undefined);
    mockStartAutoRefresh.mockResolvedValue(undefined);
    mockSignOutCleanup.mockResolvedValue(undefined);
    mockRemoveItem.mockResolvedValue(undefined);
  });

  it("runs authenticated cleanup before globally revoking the session", async () => {
    const { signOut } = require("@/lib/sign-out");

    await signOut();

    expect(mockSignOutCleanup).toHaveBeenCalledWith({ userId: "user-1" });
    expect(mockSignOutCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      mockAuthSignOut.mock.invocationCallOrder[0]
    );
    expect(mockAuthSignOut).toHaveBeenCalledWith();
    expect(mockResetAnalytics).toHaveBeenCalledTimes(1);
  });

  it("still runs device cleanup when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { signOut } = require("@/lib/sign-out");

    await signOut();

    expect(mockSignOutCleanup).toHaveBeenCalledWith({ userId: null });
    expect(mockAuthSignOut).toHaveBeenCalledWith();
  });

  it("continues cleanup and revocation when session lookup fails", async () => {
    const sessionError = new Error("SecureStore read failed");
    mockGetSession.mockRejectedValue(sessionError);
    const { signOut } = require("@/lib/sign-out");

    await signOut();

    expect(mockSignOutCleanup).toHaveBeenCalledWith({ userId: null });
    expect(mockAuthSignOut).toHaveBeenCalledWith();
    expect(mockCaptureException).toHaveBeenCalledWith(sessionError, {
      context: "signOut.getSession",
    });
  });

  it("continues revocation when best-effort lifecycle cleanup fails", async () => {
    const cleanupError = new Error("Cleanup failed");
    mockSignOutCleanup.mockRejectedValue(cleanupError);
    const { signOut } = require("@/lib/sign-out");

    await signOut();

    expect(mockAuthSignOut).toHaveBeenCalledWith();
    expect(mockCaptureException).toHaveBeenCalledWith(cleanupError, {
      context: "signOut.cleanup",
    });
  });

  it("purges persisted tokens before local sign-out when global revocation fails", async () => {
    const revocationError = Object.assign(new Error("Network request failed"), {
      name: "AuthRetryableFetchError",
    });
    mockAuthSignOut
      .mockResolvedValueOnce({ error: revocationError })
      .mockResolvedValueOnce({ error: null });
    const { signOut } = require("@/lib/sign-out");

    await signOut();

    expect(mockAuthSignOut).toHaveBeenNthCalledWith(1);
    expect(mockRemoveItem.mock.calls.map(([key]) => key)).toEqual([
      "sb-example-auth-token",
      "sb-example-auth-token-code-verifier",
      "sb-example-auth-token-user",
    ]);
    const localSignOutOrder = mockAuthSignOut.mock.invocationCallOrder[1];
    for (const removalOrder of mockRemoveItem.mock.invocationCallOrder) {
      expect(removalOrder).toBeLessThan(localSignOutOrder);
    }
    expect(mockAuthSignOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), {
      context: "signOut.global",
    });
  });

  it("uses the same purge fallback when global revocation throws", async () => {
    const revocationError = new Error("Network request failed");
    mockAuthSignOut.mockRejectedValueOnce(revocationError).mockResolvedValueOnce({ error: null });
    const { signOut } = require("@/lib/sign-out");

    await signOut();

    expect(mockRemoveItem).toHaveBeenCalledTimes(3);
    expect(mockAuthSignOut).toHaveBeenNthCalledWith(2, { scope: "local" });
    expect(mockCaptureException).toHaveBeenCalledWith(revocationError, {
      context: "signOut.global",
    });
  });

  it("propagates persisted-token purge failures", async () => {
    const revocationError = new Error("Network request failed");
    const storageError = new Error("SecureStore unavailable");
    mockAuthSignOut.mockResolvedValueOnce({ error: revocationError });
    mockRemoveItem.mockRejectedValueOnce(storageError);
    const { signOut } = require("@/lib/sign-out");

    await expect(signOut()).rejects.toBe(storageError);

    expect(mockAuthSignOut).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(storageError, {
      context: "signOut.localStorage",
    });
    expect(mockStartAutoRefresh).toHaveBeenCalledTimes(1);
  });
});
