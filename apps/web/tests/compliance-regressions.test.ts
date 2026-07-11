import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sanitizeRedirectPath } from "../src/lib/auth/redirect";

const fixMigration = readFileSync(
  new URL("../supabase/migrations/20261012130000_fix_compliance_regressions.sql", import.meta.url),
  "utf8",
);
const acceptTermsPageSource = readFileSync(
  new URL("../src/app/auth/accept-terms/page.tsx", import.meta.url),
  "utf8",
);
const acceptTermsRouteSource = readFileSync(
  new URL("../src/app/api/auth/accept-terms/route.ts", import.meta.url),
  "utf8",
);
const authCallbackRouteSource = readFileSync(
  new URL("../src/app/auth/callback/route.ts", import.meta.url),
  "utf8",
);
const acceptTermsClientSource = readFileSync(
  new URL("../src/app/auth/accept-terms/AcceptTermsClient.tsx", import.meta.url),
  "utf8",
);

describe("compliance regression coverage", () => {
  describe("privileged audit helpers", () => {
    it("revokes public-facing execute access from purge_old_data_access_logs", () => {
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) FROM public;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) FROM anon;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) FROM authenticated;/);
      assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.purge_old_data_access_logs\(\) TO service_role;/);
    });

    it("revokes public-facing execute access from backfill_ip_hashes", () => {
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) FROM public;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) FROM anon;/);
      assert.match(fixMigration, /REVOKE EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) FROM authenticated;/);
      assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.backfill_ip_hashes\(text\) TO service_role;/);
    });

    it("pins both new SECURITY DEFINER helpers to an empty search_path", () => {
      assert.match(
        fixMigration,
        /CREATE OR REPLACE FUNCTION public\.purge_old_data_access_logs\(\)[\s\S]*?SET search_path = ''/i,
      );
      assert.match(
        fixMigration,
        /CREATE OR REPLACE FUNCTION public\.backfill_ip_hashes\(salt text\)[\s\S]*?SET search_path = ''/i,
      );
    });
  });

  describe("accept-terms flow", () => {
    it("sanitizes redirect targets before reusing them", () => {
      assert.equal(sanitizeRedirectPath("https://evil.com"), "/app");
      assert.equal(sanitizeRedirectPath("//evil.com"), "/app");
      assert.equal(sanitizeRedirectPath("/app/join?token=123"), "/app/join?token=123");
    });

    it("uses sanitizeRedirectPath inside the accept-terms page", () => {
      assert.match(acceptTermsPageSource, /sanitizeRedirectPath/);
      assert.match(acceptTermsPageSource, /const safeRedirectTo = sanitizeRedirectPath/);
    });

    it("requires an explicit accepted=true payload when recording agreements", () => {
      assert.match(acceptTermsRouteSource, /validateJson/);
      assert.match(acceptTermsRouteSource, /accepted:\s*z\.literal\(true\)/);
    });
  });

  describe("mobile terms→handoff parity", () => {
    it("callback routes mobile missing-agreements users to the same accept-terms interstitial as web", () => {
      // The dead-end error deep link is gone: mobile flows through the interstitial.
      assert.doesNotMatch(authCallbackRouteSource, /terms_acceptance_required/);
      assert.match(authCallbackRouteSource, /acceptTermsUrl\.searchParams\.set\("mobile", "1"\)/);
      assert.match(
        authCallbackRouteSource,
        /acceptTermsUrl\.searchParams\.set\("handoff_challenge", handoffChallenge\)/,
      );
    });

    it("callback copies session cookies onto the accept-terms redirect for both web and mobile", () => {
      // The cookie-copy loop must live AFTER the merged mobile/web branch setup,
      // inside the single missing-agreements block that both flows share.
      const gateBlock = authCallbackRouteSource.slice(
        authCallbackRouteSource.indexOf("hasAcceptedCurrentAgreementVersions(agreements"),
      );
      const branchEnd = gateBlock.indexOf("return tosRedirect;");
      assert.ok(branchEnd > -1, "accept-terms redirect must be returned from the gate block");
      const branch = gateBlock.slice(0, branchEnd);
      assert.match(branch, /searchParams\.set\("mobile", "1"\)/);
      assert.match(branch, /tosRedirect\.cookies\.set/);
    });

    it("accept-terms route mints the mobile handoff only after agreements are recorded", () => {
      const recordIdx = acceptTermsRouteSource.indexOf("recordBothAgreements({");
      const mintIdx = acceptTermsRouteSource.indexOf("buildMobileHandoffInsert(");
      assert.ok(recordIdx > -1, "route must record agreements");
      assert.ok(mintIdx > -1, "route must mint the mobile handoff");
      assert.ok(recordIdx < mintIdx, "handoff mint must come after agreement recording");
      // Mint is gated on the mobile flag and on a failed-recording early return.
      assert.match(acceptTermsRouteSource, /if \(!success\) \{[\s\S]*?status: 500[\s\S]*?\}\s*if \(body\.mobile\)/);
    });

    it("accept-terms route validates the handoff challenge as 64 hex chars", () => {
      assert.match(acceptTermsRouteSource, /handoff_challenge:\s*z\s*\.string\(\)\s*\.regex\(\/\^\[0-9a-f\]\{64\}\$\/i\)/);
      assert.match(acceptTermsRouteSource, /normalizeMobileHandoffChallenge/);
    });

    it("accept-terms route returns the same deep-link shape the callback mints", () => {
      // teammeet://callback?handoff_code=...&handoff_challenge=... — parity with
      // the callback's own mint so the app-side parser accepts both.
      assert.match(
        acceptTermsRouteSource,
        /buildMobileCallbackDeepLink\(\{\s*handoff_code: code,\s*handoff_challenge: handoffChallenge,\s*\}\)/,
      );
      assert.match(
        authCallbackRouteSource,
        /buildMobileCallbackDeepLink\(\{\s*handoff_code: code,\s*handoff_challenge: handoffChallenge,\s*\}\)/,
      );
    });

    it("accept-terms page rejects malformed challenges instead of downgrading to an unbound handoff", () => {
      assert.match(acceptTermsPageSource, /MOBILE_HANDOFF_CHALLENGE_PATTERN = \/\^\[0-9a-f\]\{64\}\$\/i/);
      assert.match(acceptTermsPageSource, /mobile === "1" && handoffChallenge !== null/);
      // Mobile flows must not be bounced away by the already-accepted redirect —
      // the deep link back to the app only exists in the POST response.
      assert.match(acceptTermsPageSource, /!isMobile && hasAcceptedCurrentAgreementVersions/);
    });

    it("client only follows deep links into the app scheme", () => {
      assert.match(acceptTermsClientSource, /startsWith\("teammeet:\/\/"\)/);
      assert.match(acceptTermsClientSource, /handoff_challenge: mobileHandoffChallenge/);
    });
  });
});
