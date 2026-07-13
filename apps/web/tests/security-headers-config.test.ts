import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const nextConfigSource = readFileSync(path.join(repoRoot, "apps/web/next.config.mjs"), "utf8");

test("global response headers disable DNS prefetching", () => {
  assert.match(
    nextConfigSource,
    /source:\s*"\/:path\*"[\s\S]*?key:\s*"X-DNS-Prefetch-Control",\s*value:\s*"off"/,
    "model-controlled external links must not trigger DNS lookups before user interaction",
  );
});
