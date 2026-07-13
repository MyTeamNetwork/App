import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function readSource(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

describe("organization client bundle boundaries", () => {
  it("does not load the AI panel implementation until the panel is open", () => {
    const deferredPanel = readSource("src/components/ai-assistant/DeferredAIPanel.tsx");

    assert.match(deferredPanel, /lazy\([\s\S]*import\("\.\/AIPanel"\)/);
    assert.match(deferredPanel, /<Suspense fallback=\{null\}>/);
    assert.match(deferredPanel, /if \(!isOpen[\s\S]*return null/);
    assert.match(deferredPanel, /<AIPanelContent orgId=\{orgId\}/);
  });

  it("routes both organization shells through the deferred AI panel", () => {
    for (const sourcePath of [
      "src/components/layout/OrgClientShell.tsx",
      "src/components/enterprise/EnterpriseClientShell.tsx",
    ]) {
      const source = readSource(sourcePath);

      assert.match(source, /DeferredAIPanel/);
      assert.doesNotMatch(source, /import\("@\/components\/ai-assistant\/AIPanel"\)/);
    }
  });

  it("imports the provider directly so the AI barrel cannot pull the panel into layouts", () => {
    for (const sourcePath of [
      "src/app/[orgSlug]/layout.tsx",
      "src/app/enterprise/[enterpriseSlug]/layout.tsx",
    ]) {
      const source = readSource(sourcePath);

      assert.match(source, /components\/ai-assistant\/AIPanelContext/);
      assert.doesNotMatch(source, /from "@\/components\/ai-assistant"/);
    }
  });
});

describe("high-traffic organization page projections", () => {
  const pageSources = [
    "src/app/[orgSlug]/calendar/page.tsx",
    "src/app/[orgSlug]/notifications/page.tsx",
    "src/app/[orgSlug]/forms/page.tsx",
    "src/app/[orgSlug]/expenses/page.tsx",
    "src/app/[orgSlug]/donations/page.tsx",
    "src/app/[orgSlug]/philanthropy/page.tsx",
  ];

  for (const sourcePath of pageSources) {
    it(`${sourcePath} uses explicit Supabase projections`, () => {
      const source = readSource(sourcePath);

      assert.doesNotMatch(
        source,
        /\.select\(\s*["']\*/,
        `${sourcePath} must not fetch wildcard table rows`
      );
    });
  }
});
