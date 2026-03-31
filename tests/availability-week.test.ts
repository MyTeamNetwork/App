import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAvailabilityWeek, getCurrentTimeMarker } from "@/components/schedules/availability-week";
import { computeEventBlocks } from "@/components/schedules/availability-blocks";
import { formatDateKey } from "@/components/schedules/availability-stats";

describe("availability week context", () => {
  it("uses org-local week boundaries when the org is already in the next calendar day", () => {
    const context = buildAvailabilityWeek(
      new Date("2026-01-11T07:30:00.000Z"),
      0,
      "America/New_York",
    );

    assert.deepStrictEqual(
      context.weekDays.map((day) => formatDateKey(day)),
      [
        "2026-01-11",
        "2026-01-12",
        "2026-01-13",
        "2026-01-14",
        "2026-01-15",
        "2026-01-16",
        "2026-01-17",
      ],
    );
    assert.equal(formatDateKey(context.weekStart), "2026-01-11");
    assert.equal(context.todayKey, "2026-01-11");
    assert.equal(context.weekLabel, "Jan 11 - 17, 2026");
    assert.equal(context.rangeStart.toISOString(), "2026-01-11T05:00:00.000Z");
    assert.equal(context.rangeEnd.toISOString(), "2026-01-18T04:59:59.999Z");
  });

  it("keeps org-local Sunday events in the same org-local week", () => {
    const context = buildAvailabilityWeek(
      new Date("2026-01-11T07:30:00.000Z"),
      0,
      "America/New_York",
    );

    const result = computeEventBlocks(
      [],
      [
        {
          id: "org-sunday",
          user_id: "u1",
          title: "Sunday practice",
          start_at: "2026-01-11T14:00:00.000Z",
          end_at: "2026-01-11T16:00:00.000Z",
          all_day: false,
          users: null,
          origin: "schedule" as const,
        },
      ],
      context.weekDays,
      "America/New_York",
    );

    assert.ok(result.has("2026-01-11"));
    assert.equal(result.get("2026-01-11")?.[0].title, "Sunday practice");
  });

  it("tracks the current time using the org timezone", () => {
    const marker = getCurrentTimeMarker(
      new Date("2026-01-11T07:30:00.000Z"),
      "America/New_York",
    );

    assert.deepStrictEqual(marker, { dateKey: "2026-01-11", minute: 150 });
  });
});
