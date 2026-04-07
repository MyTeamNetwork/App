import { buildMobileRecoveryRedirectTo } from "../../src/lib/auth-redirects";

describe("buildMobileRecoveryRedirectTo", () => {
  it("routes password recovery through the web auth callback instead of the custom scheme", () => {
    const redirectTo = buildMobileRecoveryRedirectTo(
      "https://www.myteamnetwork.com",
      "/auth/login"
    );

    expect(redirectTo).toBe(
      "https://www.myteamnetwork.com/auth/callback?redirect=%2Fauth%2Freset-password%3Fredirect%3D%252Fauth%252Flogin"
    );
    expect(redirectTo).not.toContain("teammeet://reset-password");
  });
});
