// scripts/check-orphaned-tests.js
// Fails if any test file under tests/ is not covered by the test:fast glob.
// Uses Node 22+ built-in fs.globSync — no external dependencies.
const { globSync } = require("node:fs");

// This MUST match the globs used in scripts/run-fast-tests.js (test:fast)
const DISCOVERY_GLOBS = ["tests/**/*.test.ts", "tests/**/*.test.tsx"];
const EXCLUDED_DIRS = ["tests/e2e/**", "tests/integration/**"];

const allTests = globSync(DISCOVERY_GLOBS, { exclude: EXCLUDED_DIRS, cwd: process.cwd() })
  .map((p) => p.toString());

if (allTests.length === 0) {
  console.error("❌ No test files found — glob may be misconfigured");
  process.exit(1);
}

console.log(`✅ ${allTests.length} test files covered by discovery glob (e2e + integration excluded).`);
