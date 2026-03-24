import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getStripeOrigin } from "../src/lib/stripe-origin";

const REQ_URL = "https://teammeet-abc.vercel.app/api/stripe/create-org-checkout";

describe("getStripeOrigin — validates and normalizes NEXT_PUBLIC_SITE_URL", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = savedEnv;
    }
  });

  it("reproduces the bug: trailing newline in env var is trimmed", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com\n";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("trims trailing whitespace", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://www.myteamnetwork.com  ";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("strips trailing path/slash from env var via URL.origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com/";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("adds https:// when protocol is missing", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "www.myteamnetwork.com";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("falls back to reqUrl origin when env var is empty string", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://teammeet-abc.vercel.app");
  });

  it("falls back to reqUrl origin when env var is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://teammeet-abc.vercel.app");
  });

  it("passes through a valid URL unchanged", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.myteamnetwork.com";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://www.myteamnetwork.com");
  });

  it("falls back to reqUrl for completely invalid env var", () => {
    process.env.NEXT_PUBLIC_SITE_URL = ":::not a url:::";
    const origin = getStripeOrigin(REQ_URL);
    assert.equal(origin, "https://teammeet-abc.vercel.app");
  });
});
