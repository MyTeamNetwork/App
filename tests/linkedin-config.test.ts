import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LINKEDIN_INTEGRATION_DISABLED_CODE } from "@/lib/linkedin/config";
import {
  getLinkedInIntegrationStatus,
  isLinkedInLoginEnabled,
} from "@/lib/linkedin/config.server";

const VALID_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const configPath = path.resolve(import.meta.dirname, "..", "src", "lib", "linkedin", "config.ts");
const configSource = fs.readFileSync(configPath, "utf8");

function withLinkedInEnv(
  env: {
    clientId?: string;
    clientSecret?: string;
    encryptionKey?: string;
  },
  run: () => void,
) {
  const previous = {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    encryptionKey: process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY,
  };

  if (env.clientId === undefined) {
    delete process.env.LINKEDIN_CLIENT_ID;
  } else {
    process.env.LINKEDIN_CLIENT_ID = env.clientId;
  }

  if (env.clientSecret === undefined) {
    delete process.env.LINKEDIN_CLIENT_SECRET;
  } else {
    process.env.LINKEDIN_CLIENT_SECRET = env.clientSecret;
  }

  if (env.encryptionKey === undefined) {
    delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = env.encryptionKey;
  }

  try {
    run();
  } finally {
    if (previous.clientId === undefined) {
      delete process.env.LINKEDIN_CLIENT_ID;
    } else {
      process.env.LINKEDIN_CLIENT_ID = previous.clientId;
    }

    if (previous.clientSecret === undefined) {
      delete process.env.LINKEDIN_CLIENT_SECRET;
    } else {
      process.env.LINKEDIN_CLIENT_SECRET = previous.clientSecret;
    }

    if (previous.encryptionKey === undefined) {
      delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = previous.encryptionKey;
    }
  }
}

test("linkedin integration is available when all env vars are valid", () => {
  withLinkedInEnv(
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      encryptionKey: VALID_KEY,
    },
    () => {
      assert.deepEqual(getLinkedInIntegrationStatus(), {
        oauthAvailable: true,
        reason: null,
      });
    },
  );
});

test("linkedin integration is disabled when required env vars are missing", () => {
  withLinkedInEnv(
    {
      clientId: "client-id",
      clientSecret: undefined,
      encryptionKey: VALID_KEY,
    },
    () => {
      assert.deepEqual(getLinkedInIntegrationStatus(), {
        oauthAvailable: false,
        reason: "not_configured",
      });
    },
  );
});

test("linkedin integration is disabled when the encryption key is malformed", () => {
  withLinkedInEnv(
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      encryptionKey: "z".repeat(64),
    },
    () => {
      assert.deepEqual(getLinkedInIntegrationStatus(), {
        oauthAvailable: false,
        reason: "not_configured",
      });
    },
  );
});

test("isLinkedInLoginEnabled returns true only when LINKEDIN_LOGIN_ENABLED=true", () => {
  const prev = process.env.LINKEDIN_LOGIN_ENABLED;
  try {
    delete process.env.LINKEDIN_LOGIN_ENABLED;
    assert.equal(isLinkedInLoginEnabled(), false, "absent env var → false");

    process.env.LINKEDIN_LOGIN_ENABLED = "";
    assert.equal(isLinkedInLoginEnabled(), false, "empty string → false");

    process.env.LINKEDIN_LOGIN_ENABLED = "false";
    assert.equal(isLinkedInLoginEnabled(), false, '"false" → false');

    process.env.LINKEDIN_LOGIN_ENABLED = "TRUE";
    assert.equal(isLinkedInLoginEnabled(), false, "case-sensitive → false");

    process.env.LINKEDIN_LOGIN_ENABLED = "true";
    assert.equal(isLinkedInLoginEnabled(), true, '"true" → true');
  } finally {
    if (prev === undefined) {
      delete process.env.LINKEDIN_LOGIN_ENABLED;
    } else {
      process.env.LINKEDIN_LOGIN_ENABLED = prev;
    }
  }
});

test("isLinkedInLoginEnabled is independent of connected accounts env vars", () => {
  const prev = process.env.LINKEDIN_LOGIN_ENABLED;
  try {
    // Connected accounts vars are set (via withLinkedInEnv context or .env)
    // but LINKEDIN_LOGIN_ENABLED is absent — login should be disabled
    delete process.env.LINKEDIN_LOGIN_ENABLED;
    withLinkedInEnv(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        encryptionKey: VALID_KEY,
      },
      () => {
        assert.equal(
          getLinkedInIntegrationStatus().oauthAvailable,
          true,
          "connected accounts available",
        );
        assert.equal(
          isLinkedInLoginEnabled(),
          false,
          "login disabled despite connected accounts being configured",
        );
      },
    );
  } finally {
    if (prev === undefined) {
      delete process.env.LINKEDIN_LOGIN_ENABLED;
    } else {
      process.env.LINKEDIN_LOGIN_ENABLED = prev;
    }
  }
});

test("browser-safe linkedin config does not import token encryption helpers", () => {
  assert.ok(LINKEDIN_INTEGRATION_DISABLED_CODE.length > 0);
  assert.doesNotMatch(configSource, /token-encryption/);
});
