import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "settings",
  "connected-accounts",
  "page.tsx",
);

const pageSource = fs.readFileSync(pagePath, "utf8");

test("connected accounts page loads LinkedIn state from the status API", () => {
  assert.match(
    pageSource,
    /fetch\("\/api\/user\/linkedin\/status"\)/,
    "expected connected accounts page to use the shared LinkedIn status API",
  );
  assert.doesNotMatch(
    pageSource,
    /from\("user_linkedin_connections"\)/,
    "connected accounts page should not query user_linkedin_connections directly in the client",
  );
});

test("connected accounts page gates the connect CTA on oauthAvailable", () => {
  assert.match(
    pageSource,
    /setOauthAvailable\(data\.integration\?\.oauthAvailable \?\? true\)/,
    "expected connected accounts page to read integration availability from the status payload",
  );
  assert.match(
    pageSource,
    /oauthAvailable \?/,
    "expected connected accounts page to branch on oauth availability before rendering the connect CTA",
  );
});

test("connected accounts page wraps useSearchParams in Suspense", () => {
  assert.match(
    pageSource,
    /<Suspense fallback=/,
    "expected connected accounts page to provide a Suspense boundary",
  );
  assert.match(
    pageSource,
    /function ConnectedAccountsContent\(/,
    "expected connected accounts page to isolate the search param reader inside a content component",
  );
  assert.match(
    pageSource,
    /const searchParams = useSearchParams\(\);/,
    "expected connected accounts page to continue reading search params",
  );
});

test("connected accounts page refreshes LinkedIn status after sync failures", () => {
  assert.match(
    pageSource,
    /const refreshStatus = useCallback\(async \(\) =>/,
    "expected connected accounts page to centralize status loading in a shared helper",
  );
  assert.match(
    pageSource,
    /if \(!res\.ok \|\| !data\.success\) \{[\s\S]*await refreshStatus\(\);[\s\S]*setFeedback\(\{ type: "error"/,
    "expected failed LinkedIn syncs to refresh status before showing an error banner",
  );
});
