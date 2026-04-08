import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const routePath = join(testDir, "..", "..", "..", "src", "app", "api", "calendar", "sync", "route.ts");

describe("/api/calendar/sync regressions", () => {
  it("does not hard-block Outlook-only manual sync with a Google-only error", () => {
    const source = readFileSync(routePath, "utf8");

    assert.ok(
      !source.includes("Please connect your Google Calendar first."),
      "Manual sync should not reject Outlook-only users with a Google-only error",
    );
  });

  it("filters Google backfill entries by provider", () => {
    const source = readFileSync(routePath, "utf8");
    const backfillBlockMatch = source.match(
      /from\("event_calendar_entries"\)\s*\.select\("event_id"\)([\s\S]*?)const existingEventIds/,
    );

    assert.ok(backfillBlockMatch, "Expected to find the Google backfill query block");
    assert.ok(
      backfillBlockMatch[1].includes('.eq("provider", "google")'),
      "Google backfill query must filter event_calendar_entries by provider",
    );
  });
});
