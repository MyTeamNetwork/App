// Bun-only entrypoint for `bun test ./src/curated-suite.test.ts` (excluded from `tsc` in tsconfig.json).
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test(
  "curated suite (node --test + tests/ts-loader.js)",
  () => {
    const result = spawnSync("bun", ["run", "test"], {
      cwd: appRoot,
      stdio: "inherit",
      env: process.env,
    });
    expect(result.status).toBe(0);
  },
  { timeout: 120_000 },
);
