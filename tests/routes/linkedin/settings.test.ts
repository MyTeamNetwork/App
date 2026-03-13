import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  optionalLinkedInProfileUrlSchema,
  isLinkedInProfileUrl,
  normalizeLinkedInProfileUrl,
} from "@/lib/alumni/linkedin-url";

import {
  linkedinSyncResponseSchema,
  linkedinConnectionStatusSchema,
} from "@/lib/schemas/linkedin";
import {
  createLinkedInOAuthState,
  parseLinkedInOAuthState,
} from "@/lib/linkedin/state";

describe("LinkedIn settings routes", () => {
  describe("URL validation (optionalLinkedInProfileUrlSchema)", () => {
    it("accepts a valid LinkedIn profile URL", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://www.linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
    });

    it("normalizes http to https", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "http://www.linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
      assert.ok(result.data?.startsWith("https://"));
    });

    it("normalizes linkedin.com to www.linkedin.com", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
      assert.ok(result.data?.includes("www.linkedin.com"));
    });

    it("rejects non-LinkedIn URLs", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://example.com/in/johndoe"
      );
      assert.ok(!result.success);
    });

    it("rejects URLs without /in/ path", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://www.linkedin.com/company/acme"
      );
      assert.ok(!result.success);
    });

    it("accepts empty string (clear URL)", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse("");
      assert.ok(result.success);
    });

    it("accepts undefined (optional)", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(undefined);
      assert.ok(result.success);
    });

    it("strips trailing slashes", () => {
      const normalized = normalizeLinkedInProfileUrl(
        "https://www.linkedin.com/in/johndoe/"
      );
      assert.ok(!normalized.endsWith("/"));
    });
  });

  describe("isLinkedInProfileUrl", () => {
    it("returns true for valid URL", () => {
      assert.ok(isLinkedInProfileUrl("https://www.linkedin.com/in/jane-doe"));
    });

    it("returns false for empty string", () => {
      assert.ok(!isLinkedInProfileUrl(""));
    });

    it("returns false for non-URL string", () => {
      assert.ok(!isLinkedInProfileUrl("not a url"));
    });
  });

  describe("linkedinSyncResponseSchema", () => {
    it("validates a successful sync response with profile", () => {
      const result = linkedinSyncResponseSchema.safeParse({
        success: true,
        profile: {
          sub: "abc123",
          givenName: "Jane",
          familyName: "Doe",
          email: "jane@example.com",
          picture: "https://photo.example.com/pic.jpg",
          emailVerified: true,
        },
      });
      assert.ok(result.success);
    });

    it("validates an error sync response", () => {
      const result = linkedinSyncResponseSchema.safeParse({
        success: false,
        error: "Token expired",
      });
      assert.ok(result.success);
    });

    it("validates response without optional profile", () => {
      const result = linkedinSyncResponseSchema.safeParse({
        success: true,
      });
      assert.ok(result.success);
    });

    it("rejects response with old schema (name/profileUrl)", () => {
      const result = linkedinSyncResponseSchema.safeParse({
        success: true,
        profile: {
          name: "Jane Doe",
          email: "jane@example.com",
          pictureUrl: null,
          profileUrl: null,
        },
      });
      // Should fail because old schema doesn't match new shape
      assert.ok(!result.success);
    });
  });

  describe("linkedinConnectionStatusSchema", () => {
    it("validates a connected status", () => {
      const result = linkedinConnectionStatusSchema.safeParse({
        connected: true,
        linkedinEmail: "jane@example.com",
        linkedinName: "Jane Doe",
        linkedinPictureUrl: "https://photo.example.com/pic.jpg",
        status: "connected",
        tokenExpired: false,
      });
      assert.ok(result.success);
    });

    it("validates minimal status (only connected field)", () => {
      const result = linkedinConnectionStatusSchema.safeParse({
        connected: false,
      });
      assert.ok(result.success);
    });
  });

  describe("connect route state format", () => {
    it("stores the payload in the cookie while keeping provider-facing state opaque", () => {
      const userId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const redirectPath = "/settings/linkedin";
      const oauthState = createLinkedInOAuthState({
        userId,
        redirectPath,
        now: 1_700_000_000_000,
      });

      assert.equal(oauthState.state, oauthState.payload.nonce);
      assert.notEqual(oauthState.cookie.value, oauthState.state);

      const decoded = parseLinkedInOAuthState(oauthState.cookie.value);
      assert.ok(decoded);
      assert.equal(decoded?.userId, userId);
      assert.equal(decoded?.redirectPath, redirectPath);
    });

    it("nonce is unique across calls", () => {
      const a = createLinkedInOAuthState({
        userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        redirectPath: "/settings/linkedin",
      });
      const b = createLinkedInOAuthState({
        userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        redirectPath: "/settings/linkedin",
      });
      assert.notEqual(a.state, b.state);
    });
  });
});
