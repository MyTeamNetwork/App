import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildMobileAuthCallbackUrl,
  buildMobileCallbackDeepLink,
  buildMobileErrorDeepLink,
  buildMobileHandoffInsert,
  isMobileAuthMode,
  mapMobileOAuthProvider,
} from "@/lib/auth/mobile-oauth";
import type { Session } from "@supabase/supabase-js";
import { getEncryptionKeyBuffer } from "@/lib/crypto/token-encryption";

const SITE = "https://www.myteamnetwork.com";

describe("mapMobileOAuthProvider", () => {
  it("maps friendly mobile slugs to Supabase provider ids", () => {
    assert.equal(mapMobileOAuthProvider("google"), "google");
    assert.equal(mapMobileOAuthProvider("linkedin"), "linkedin_oidc");
    assert.equal(mapMobileOAuthProvider("microsoft"), "azure");
  });

  it("returns null for unsupported providers (route deep-links an error, never 404s)", () => {
    assert.equal(mapMobileOAuthProvider("facebook"), null);
    assert.equal(mapMobileOAuthProvider(""), null);
    assert.equal(mapMobileOAuthProvider("apple"), null);
  });
});

describe("buildMobileAuthCallbackUrl", () => {
  const handoffChallenge = "A1".repeat(32);

  it("targets /auth/mobile-callback (not the universal-link /auth/callback path) with mobile=1", () => {
    const url = new URL(buildMobileAuthCallbackUrl(SITE, { mode: "login" }));
    // /auth/callback is a registered universal link; if the OAuth mid-flight
    // redirect used it, iOS could steal the URL from the in-app browser and the
    // app would fail with "PKCE code verifier not found" (prod LinkedIn bug).
    assert.equal(url.pathname, "/auth/mobile-callback");
    assert.equal(url.searchParams.get("mobile"), "1");
    assert.equal(url.searchParams.get("mode"), "login");
    assert.equal(url.searchParams.get("redirect"), "/app");
  });

  it("carries signup age params through the OAuth round-trip", () => {
    const url = new URL(
      buildMobileAuthCallbackUrl(SITE, {
        mode: "signup",
        redirect: "/app/join?token=abc",
        ageBracket: "18_plus",
        isMinor: "false",
        ageToken: "tok123",
      })
    );
    assert.equal(url.searchParams.get("mode"), "signup");
    assert.equal(url.searchParams.get("age_bracket"), "18_plus");
    assert.equal(url.searchParams.get("is_minor"), "false");
    assert.equal(url.searchParams.get("age_token"), "tok123");
    assert.equal(url.searchParams.get("redirect"), "/app/join?token=abc");
  });

  it("propagates and normalizes the native handoff challenge through the OAuth callback", () => {
    const url = new URL(
      buildMobileAuthCallbackUrl(SITE, {
        mode: "login",
        handoffChallenge,
      })
    );

    assert.equal(url.searchParams.get("handoff_challenge"), handoffChallenge.toLowerCase());
  });

  it("rejects a malformed native handoff challenge instead of downgrading to an unbound flow", () => {
    assert.throws(
      () =>
        buildMobileAuthCallbackUrl(SITE, {
          mode: "login",
          handoffChallenge: "not-64-hex",
        }),
      /invalid mobile handoff challenge/i
    );
  });

  it("falls back to /app for open-redirect attempts", () => {
    const url = new URL(
      buildMobileAuthCallbackUrl(SITE, { mode: "login", redirect: "https://evil.com" })
    );
    assert.equal(url.searchParams.get("redirect"), "/app");
  });
});

describe("mobile OAuth route challenge propagation", () => {
  const startRouteSource = readFileSync(
    resolve(process.cwd(), "src/app/auth/mobile/[provider]/route.ts"),
    "utf8"
  );
  const callbackRouteSource = readFileSync(
    resolve(process.cwd(), "src/app/auth/callback/route.ts"),
    "utf8"
  );

  it("carries handoff_challenge from native initiation into the server callback", () => {
    assert.match(startRouteSource, /searchParams\.get\("handoff_challenge"\)/);
    assert.match(startRouteSource, /handoffChallenge/);
  });

  it("stores and echoes the challenge when minting a bound handoff", () => {
    assert.match(
      callbackRouteSource,
      /buildMobileHandoffInsert\([\s\S]*handoffChallenge/
    );
    assert.match(callbackRouteSource, /handoff_challenge/);
  });
});

describe("buildMobileHandoffInsert", () => {
  const encryptionKey = "a".repeat(64);
  const session = {
    access_token: "access-token",
    refresh_token: "refresh-token",
    user: { id: "user-1" },
  } as Session;

  it("stores a normalized challenge hash on bound handoff rows", () => {
    const originalKey = process.env.AUTH_HANDOFF_ENCRYPTION_KEY;
    process.env.AUTH_HANDOFF_ENCRYPTION_KEY = encryptionKey;
    try {
      const result = buildMobileHandoffInsert(session, "fixed-code", "AB".repeat(32));
      assert.equal(result.row.challenge_hash, "ab".repeat(32));
    } finally {
      process.env.AUTH_HANDOFF_ENCRYPTION_KEY = originalKey;
    }
  });

  it("keeps legacy handoff rows explicitly unbound", () => {
    const originalKey = process.env.AUTH_HANDOFF_ENCRYPTION_KEY;
    process.env.AUTH_HANDOFF_ENCRYPTION_KEY = encryptionKey;
    try {
      const result = buildMobileHandoffInsert(session, "legacy-code");
      assert.equal(result.row.challenge_hash, null);
    } finally {
      process.env.AUTH_HANDOFF_ENCRYPTION_KEY = originalKey;
    }
  });
});

describe("buildMobileCallbackDeepLink", () => {
  it("deep-links to the app scheme with the handoff code", () => {
    const link = buildMobileCallbackDeepLink({ handoff_code: "code-xyz" });
    const url = new URL(link);
    assert.equal(url.protocol, "teammeet:");
    assert.equal(url.hostname, "callback");
    assert.equal(url.searchParams.get("handoff_code"), "code-xyz");
  });

  it("omits null/undefined params", () => {
    const link = buildMobileCallbackDeepLink({ handoff_code: "c", error: null });
    assert.ok(!link.includes("error"));
  });
});

describe("buildMobileErrorDeepLink", () => {
  it("deep-links an error the app's callback parser can read", () => {
    const url = new URL(buildMobileErrorDeepLink("oauth_init_failed", "boom"));
    assert.equal(url.protocol, "teammeet:");
    assert.equal(url.hostname, "callback");
    assert.equal(url.searchParams.get("error"), "oauth_init_failed");
    assert.equal(url.searchParams.get("error_description"), "boom");
  });
});

describe("isMobileAuthMode", () => {
  it("accepts login/signup and rejects anything else", () => {
    assert.equal(isMobileAuthMode("login"), true);
    assert.equal(isMobileAuthMode("signup"), true);
    assert.equal(isMobileAuthMode("admin"), false);
    assert.equal(isMobileAuthMode(null), false);
  });
});

describe("AUTH_HANDOFF_ENCRYPTION_KEY format contract", () => {
  // next.config.mjs build-validates AUTH_HANDOFF_ENCRYPTION_KEY as 64 hex chars,
  // mirroring getEncryptionKeyBuffer's check. The config throw path runs at module
  // import (exercised by `next build`), so it is not unit-tested here; this locks
  // the 64-hex format contract the config relies on.
  const VALID_KEY = "a".repeat(64);

  it("accepts a 64 hex-character key", () => {
    const buf = getEncryptionKeyBuffer(VALID_KEY);
    assert.equal(buf.length, 32);
  });

  it("rejects a wrong-length key", () => {
    assert.throws(
      () => getEncryptionKeyBuffer("abc123"),
      /64 hex characters/,
    );
  });

  it("rejects a 64-char non-hex key", () => {
    assert.throws(
      () => getEncryptionKeyBuffer("z".repeat(64)),
      /64 hex characters/,
    );
  });
});
