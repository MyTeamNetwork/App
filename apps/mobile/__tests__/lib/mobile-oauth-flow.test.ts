import * as WebBrowser from "expo-web-browser";
import { runMobileOAuth } from "@/lib/mobile-oauth-flow";
import { createMobileOAuthChallenge } from "@/lib/mobile-oauth-challenge";
import { consumeBoundMobileAuthHandoff } from "@/lib/mobile-auth";
import { getWebAppUrl } from "@/lib/web-api";

jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-auth-session", () => ({
  makeRedirectUri: jest.fn(() => "teammeet://callback"),
}));
jest.mock("@/lib/web-api", () => ({
  getWebAppUrl: jest.fn(() => "https://www.myteamnetwork.com"),
}));
jest.mock("@/lib/mobile-oauth-challenge", () => ({
  createMobileOAuthChallenge: jest.fn(),
  clearMobileOAuthVerifier: jest.fn(),
}));
jest.mock("@/lib/mobile-auth", () => ({
  consumeBoundMobileAuthHandoff: jest.fn(),
}));
jest.mock("@/lib/analytics", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  track: jest.fn(),
}));

describe("runMobileOAuth device-bound handoff", () => {
  beforeEach(() => {
    jest.mocked(getWebAppUrl).mockReturnValue("https://www.myteamnetwork.com");
  });

  it("starts and consumes the same device challenge", async () => {
    const challenge = "a".repeat(64);
    jest.mocked(createMobileOAuthChallenge).mockResolvedValue(challenge);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: "success",
      url: `teammeet://callback?handoff_code=code-1&handoff_challenge=${challenge}`,
    } as never);
    jest.mocked(consumeBoundMobileAuthHandoff).mockResolvedValue(undefined);

    await expect(runMobileOAuth("google", "login", { mode: "login" })).resolves.toEqual({
      ok: true,
    });

    const authUrl = new URL(jest.mocked(WebBrowser.openAuthSessionAsync).mock.calls[0][0]);
    expect(authUrl.searchParams.get("handoff_challenge")).toBe(challenge);
    expect(consumeBoundMobileAuthHandoff).toHaveBeenCalledWith("code-1", challenge);
  });
});
