import {
  buildMobileEmailSignupCallbackUrl,
  buildMobileGoogleAuthUrl,
  buildMobileOAuthUrl,
  buildMobileRecoveryRedirectTo,
  getMobileAuthCallbackErrorMessage,
  parseMobileAuthCallbackUrl,
} from "../../src/lib/auth-redirects";

describe("buildMobileRecoveryRedirectTo", () => {
  it("routes password recovery through the cross-browser token-hash confirm endpoint", () => {
    const redirectTo = buildMobileRecoveryRedirectTo(
      "https://www.myteamnetwork.com",
      "/auth/login"
    );

    expect(redirectTo).toBe(
      "https://www.myteamnetwork.com/auth/confirm?next=%2Fauth%2Freset-password%3Fredirect%3D%252Fauth%252Flogin"
    );
    expect(redirectTo).not.toContain("/auth/callback");
    expect(redirectTo).not.toContain("teammeet://reset-password");
  });
});

describe("mobile Google auth redirects", () => {
  it("starts Google login through the web-owned mobile route", () => {
    const url = buildMobileGoogleAuthUrl("https://www.myteamnetwork.com", {
      mode: "login",
      handoffChallenge: "e".repeat(64),
    });

    expect(new URL(url).searchParams.get("handoff_challenge")).toBe("e".repeat(64));
    expect(url).not.toContain("supabase.co");
  });

  it("passes signup age data to the web mobile start route", () => {
    const url = buildMobileGoogleAuthUrl("https://www.myteamnetwork.com/", {
      mode: "signup",
      handoffChallenge: "f".repeat(64),
      ageBracket: "13_17",
      isMinor: true,
      ageToken: "age-token",
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/auth/mobile/google");
    expect(parsed.searchParams.get("mode")).toBe("signup");
    expect(parsed.searchParams.get("age_bracket")).toBe("13_17");
    expect(parsed.searchParams.get("is_minor")).toBe("true");
    expect(parsed.searchParams.get("age_token")).toBe("age-token");
  });

  it("routes email signup confirmations through the web mobile callback with a device challenge", () => {
    expect(
      buildMobileEmailSignupCallbackUrl("https://www.myteamnetwork.com", {
        handoffChallenge: "a".repeat(64),
      })
    ).toBe(
      `https://www.myteamnetwork.com/auth/callback?mobile=1&mode=signup&redirect=%2Fapp&handoff_challenge=${"a".repeat(64)}`
    );
  });

  it("rejects a malformed email-signup challenge instead of downgrading to an unbound handoff", () => {
    expect(() =>
      buildMobileEmailSignupCallbackUrl("https://www.myteamnetwork.com", {
        handoffChallenge: "not-a-sha256-challenge",
      })
    ).toThrow(/invalid mobile handoff challenge/i);
  });

  it("email-signup handoffs round-trip through the parser (regression: challenge-less links were ignored)", () => {
    // The web callback echoes the challenge from the emailRedirectTo URL onto
    // the teammeet://callback deep link. The parser must accept exactly what
    // the signup builder emits — this is the end-to-end pair that previously
    // drifted apart (builder omitted the challenge, hardened parser required it).
    const challenge = new URL(
      buildMobileEmailSignupCallbackUrl("https://www.myteamnetwork.com", {
        handoffChallenge: "D".repeat(64),
      })
    ).searchParams.get("handoff_challenge");

    expect(challenge).toBe("d".repeat(64));
    expect(
      parseMobileAuthCallbackUrl(
        `teammeet://callback?handoff_code=abc123&handoff_challenge=${challenge}`
      )
    ).toEqual({ type: "handoff", code: "abc123", challenge: "d".repeat(64) });
  });

  it("parses one-time handoff callbacks", () => {
    expect(parseMobileAuthCallbackUrl(`teammeet://callback?handoff_code=abc123&handoff_challenge=${"a".repeat(64)}`)).toEqual({
      type: "handoff",
      code: "abc123",
      challenge: "a".repeat(64),
    });
  });

  it("rejects handoff codes that are not bound to this device flow", () => {
    expect(parseMobileAuthCallbackUrl("teammeet://callback?handoff_code=abc123")).toEqual({
      type: "ignored",
    });
  });

  it("keeps raw native-scheme tokens ignored", () => {
    expect(
      parseMobileAuthCallbackUrl("teammeet://callback#access_token=raw&refresh_token=raw")
    ).toEqual({ type: "ignored" });
  });

  it("parses error deep links with descriptions", () => {
    expect(
      parseMobileAuthCallbackUrl(
        "teammeet://callback?error=oauth_start_failed&error_description=Could+not+start+sign+in"
      )
    ).toEqual({
      type: "error",
      error: "oauth_start_failed",
      message: "Could not start sign in",
    });
  });

  it("falls back to error code when description is missing", () => {
    expect(parseMobileAuthCallbackUrl("teammeet://callback?error=access_denied")).toEqual({
      type: "error",
      error: "access_denied",
      message: "access_denied",
    });
  });

  describe("getMobileAuthCallbackErrorMessage — code → app-owned copy", () => {
    // The codes below are the exact set the web callback can emit to
    // teammeet://callback (apps/web `buildMobileErrorDeepLink` call sites +
    // provider passthrough). Each maps to a fixed, hardcoded string; the raw
    // error_description is NEVER surfaced.
    const cases: Array<[string, RegExp]> = [
      ["access_denied", /try again and allow access/i],
      ["unsupported_provider", /not supported in the app/i],
      ["oauth_init_failed", /could not start sign-in/i],
      ["auth_callback_failed", /could not be completed/i],
      ["handoff_failed", /could not complete sign-in/i],
      ["terms_acceptance_required", /finish creating your account on the web/i],
      ["parental_consent_required", /parental consent is required/i],
      ["age_validation_failed", /finish age verification on the web/i],
    ];

    it.each(cases)("maps %s to specific app-owned copy", (code, pattern) => {
      expect(getMobileAuthCallbackErrorMessage(code)).toMatch(pattern);
    });

    it("does not claim access_denied is an in-app cancel (provider may deny by policy)", () => {
      expect(getMobileAuthCallbackErrorMessage("access_denied")).not.toMatch(
        /cancell?ed/i
      );
    });

    it("swallows an unknown / attacker-supplied code into generic copy", () => {
      // A code not in the enum (e.g. spoofed) must never surface as-is.
      expect(
        getMobileAuthCallbackErrorMessage("reverify at evil.com")
      ).toBe("Sign-in didn't complete. Please try again.");
    });
  });
});

describe("buildMobileOAuthUrl", () => {
  it("rejects a malformed challenge instead of downgrading to an unbound flow", () => {
    expect(() =>
      buildMobileOAuthUrl("google", "https://www.myteamnetwork.com", {
        mode: "login",
        handoffChallenge: "not-a-sha256-challenge",
      })
    ).toThrow(/invalid mobile handoff challenge/i);
  });

  it("starts LinkedIn login through the web-owned mobile route", () => {
    const url = buildMobileOAuthUrl("linkedin", "https://www.myteamnetwork.com", {
      mode: "login",
      handoffChallenge: "a".repeat(64),
    });

    expect(new URL(url).searchParams.get("handoff_challenge")).toBe("a".repeat(64));
  });

  it("starts Microsoft login through the web-owned mobile route", () => {
    const url = buildMobileOAuthUrl("microsoft", "https://www.myteamnetwork.com", {
      mode: "login",
      handoffChallenge: "b".repeat(64),
    });

    expect(new URL(url).searchParams.get("handoff_challenge")).toBe("b".repeat(64));
  });

  it("forwards age signup params for any provider", () => {
    const url = buildMobileOAuthUrl("linkedin", "https://www.myteamnetwork.com/", {
      mode: "signup",
      handoffChallenge: "c".repeat(64),
      ageBracket: "13_17",
      isMinor: true,
      ageToken: "age-token",
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/auth/mobile/linkedin");
    expect(parsed.searchParams.get("mode")).toBe("signup");
    expect(parsed.searchParams.get("age_bracket")).toBe("13_17");
    expect(parsed.searchParams.get("is_minor")).toBe("true");
    expect(parsed.searchParams.get("age_token")).toBe("age-token");
  });

  it("buildMobileGoogleAuthUrl is preserved as a backward-compat wrapper", () => {
    const params = { mode: "login" as const, handoffChallenge: "d".repeat(64) };
    expect(buildMobileGoogleAuthUrl("https://www.myteamnetwork.com", params)).toBe(
      buildMobileOAuthUrl("google", "https://www.myteamnetwork.com", params)
    );
  });
});
