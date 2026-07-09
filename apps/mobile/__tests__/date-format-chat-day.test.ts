import {
  formatChatDaySeparator,
  getLocalDayKey,
  isDifferentLocalDay,
} from "@/lib/date-format";

function localIso(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

describe("getLocalDayKey", () => {
  it("returns YYYY-MM-DD for a Date", () => {
    expect(getLocalDayKey(new Date(2026, 5, 12, 9, 30))).toBe("2026-06-12");
  });

  it("is stable for the same local day across times", () => {
    const morning = new Date(2026, 5, 12, 1, 0);
    const evening = new Date(2026, 5, 12, 23, 59);
    expect(getLocalDayKey(morning)).toBe(getLocalDayKey(evening));
    expect(getLocalDayKey(morning)).toBe("2026-06-12");
  });

  it("accepts ISO strings", () => {
    const iso = localIso(2026, 6, 12, 15, 0);
    expect(getLocalDayKey(iso)).toBe("2026-06-12");
  });
});

describe("isDifferentLocalDay", () => {
  it("returns true when prev is null or undefined", () => {
    const next = localIso(2026, 6, 12);
    expect(isDifferentLocalDay(null, next)).toBe(true);
    expect(isDifferentLocalDay(undefined, next)).toBe(true);
  });

  it("returns false for the same local day", () => {
    const a = localIso(2026, 6, 12, 8, 0);
    const b = localIso(2026, 6, 12, 20, 0);
    expect(isDifferentLocalDay(a, b)).toBe(false);
  });

  it("returns true for different local days", () => {
    const a = localIso(2026, 6, 11, 23, 0);
    const b = localIso(2026, 6, 12, 0, 30);
    expect(isDifferentLocalDay(a, b)).toBe(true);
  });
});

describe("formatChatDaySeparator", () => {
  const now = new Date(2026, 6, 8, 15, 0, 0); // Wed Jul 8, 2026 local

  it('returns "Today" for the current local day', () => {
    expect(formatChatDaySeparator(localIso(2026, 7, 8, 9, 0), now)).toBe("Today");
  });

  it('returns "Yesterday" for the previous local day', () => {
    expect(formatChatDaySeparator(localIso(2026, 7, 7, 18, 0), now)).toBe(
      "Yesterday"
    );
  });

  it("returns weekday + short date for older dates in the same year", () => {
    expect(formatChatDaySeparator(localIso(2026, 6, 12, 10, 0), now)).toBe(
      "Fri, Jun 12"
    );
  });

  it("includes the year for dates in a different year", () => {
    expect(formatChatDaySeparator(localIso(2025, 6, 12, 10, 0), now)).toBe(
      "Thu, Jun 12, 2025"
    );
  });
});
