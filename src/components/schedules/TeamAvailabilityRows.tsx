"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { buildAvailabilityWeek } from "@/components/schedules/availability-week";
import { computeEventBlocks, type EventBlock } from "@/components/schedules/availability-blocks";
import { computeSummaryStats, formatDateKey } from "@/components/schedules/availability-stats";
import type { AcademicSchedule, User } from "@/types/database";

type TeamMember = {
  userId: string;
  name: string;
  schedules: AcademicSchedule[];
};

type TeamAvailabilityRowsProps = {
  schedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
  orgId: string;
  timeZone?: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  sourceType?: string;
  isOrg?: boolean;
};

const GRID_START_MINUTE = 6 * 60; // 6am
const GRID_END_MINUTE = 22 * 60;  // 10pm
const GRID_DURATION = GRID_END_MINUTE - GRID_START_MINUTE; // 960 min

function minutesToTimeLabel(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "am" : "pm";
  const hour = h % 12 || 12;
  return min > 0 ? `${hour}:${String(min).padStart(2, "0")}${ampm}` : `${hour}${ampm}`;
}

function blockToPercent(minute: number): number {
  const clamped = Math.max(GRID_START_MINUTE, Math.min(GRID_END_MINUTE, minute));
  return ((clamped - GRID_START_MINUTE) / GRID_DURATION) * 100;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function computeBestWindow(
  members: TeamMember[],
  blocksByMemberAndDay: Map<string, EventBlock[]>,
  dateKey: string,
  totalMembers: number
): { label: string; freeCount: number } | null {
  if (totalMembers === 0) return null;

  const threshold = Math.ceil(totalMembers * 0.8);
  const SLOT_MINUTES = 30;
  const slots: { start: number; freeCount: number }[] = [];

  for (let m = GRID_START_MINUTE; m < GRID_END_MINUTE; m += SLOT_MINUTES) {
    let busyCount = 0;
    members.forEach((member) => {
      const blocks = blocksByMemberAndDay.get(`${member.userId}-${dateKey}`) ?? [];
      const busy = blocks.some((b) => b.startMinute < m + SLOT_MINUTES && b.endMinute > m);
      if (busy) busyCount++;
    });
    slots.push({ start: m, freeCount: totalMembers - busyCount });
  }

  // Find longest contiguous run where freeCount >= threshold
  let bestStart = -1;
  let bestEnd = -1;
  let bestFree = 0;
  let runStart = -1;
  let runFree = 0;

  for (let i = 0; i < slots.length; i++) {
    if (slots[i].freeCount >= threshold) {
      if (runStart === -1) {
        runStart = slots[i].start;
        runFree = slots[i].freeCount;
      } else {
        runFree = Math.min(runFree, slots[i].freeCount);
      }
      const runEnd = slots[i].start + SLOT_MINUTES;
      const duration = runEnd - runStart;
      if (duration > bestEnd - bestStart || (duration === bestEnd - bestStart && runFree > bestFree)) {
        bestStart = runStart;
        bestEnd = runEnd;
        bestFree = runFree;
      }
    } else {
      runStart = -1;
    }
  }

  if (bestStart === -1 || bestEnd - bestStart < 30) return null;

  return {
    label: `${minutesToTimeLabel(bestStart)} – ${minutesToTimeLabel(bestEnd)}`,
    freeCount: bestFree,
  };
}

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function TeamAvailabilityRows({ schedules, orgId, timeZone }: TeamAvailabilityRowsProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const week = useMemo(() => buildAvailabilityWeek(new Date(), weekOffset, timeZone), [weekOffset, timeZone]);

  // Default selected day to today (or week start if today not in view)
  useEffect(() => {
    const todayInWeek = week.weekDays.find((d) => formatDateKey(d) === week.todayKey);
    setSelectedDateKey(todayInWeek ? week.todayKey : formatDateKey(week.weekDays[0]));
  }, [week.todayKey, week.weekDays]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: orgId,
        start: week.rangeStart.toISOString(),
        end: week.rangeEnd.toISOString(),
        mode: "team",
      });
      const res = await fetch(`/api/calendar/events?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data.events ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [orgId, week.rangeStart, week.rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Group schedules by user
  const members: TeamMember[] = useMemo(() => {
    const map = new Map<string, TeamMember>();
    schedules.forEach((s) => {
      if (!map.has(s.user_id)) {
        map.set(s.user_id, {
          userId: s.user_id,
          name: s.users?.name ?? s.users?.email ?? "Member",
          schedules: [],
        });
      }
      map.get(s.user_id)!.schedules.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [schedules]);

  const totalMembers = members.length;

  // Compute event blocks per member per day key "userId-dateKey"
  const blocksByMemberAndDay = useMemo(() => {
    const result = new Map<string, EventBlock[]>();
    members.forEach((member) => {
      const blocksMap = computeEventBlocks(
        member.schedules,
        calendarEvents as never,
        week.weekDays,
        timeZone
      );
      blocksMap.forEach((blocks, dateKey) => {
        result.set(`${member.userId}-${dateKey}`, blocks);
      });
    });
    return result;
  }, [members, calendarEvents, week.weekDays, timeZone]);

  // Build conflict grid for stats (team mode)
  const conflictGrid = useMemo(() => {
    const grid = new Map<string, { userId: string; memberName: string; title: string; isOrg?: boolean }[]>();
    blocksByMemberAndDay.forEach((blocks, key) => {
      const [userId, dateKey] = key.split(/-(\d{4}-\d{2}-\d{2})$/).filter(Boolean);
      if (!dateKey) return;
      blocks.forEach((block) => {
        const startHour = Math.floor(block.startMinute / 60);
        const endHour = Math.ceil(block.endMinute / 60);
        for (let h = startHour; h < endHour; h++) {
          const gridKey = `${dateKey}-${h}`;
          const existing = grid.get(gridKey) ?? [];
          existing.push({ userId, memberName: block.memberName ?? "Member", title: block.title, isOrg: block.isOrg });
          grid.set(gridKey, existing);
        }
      });
    });
    return grid;
  }, [blocksByMemberAndDay]);

  const stats = useMemo(
    () => computeSummaryStats(conflictGrid, week.weekDays, "team", totalMembers),
    [conflictGrid, week.weekDays, totalMembers]
  );
  const teamStats = stats as { avgAvailability: number; bestTime: string; teamSize: number };

  const bestWindow = useMemo(() => {
    if (!selectedDateKey) return null;
    return computeBestWindow(members, blocksByMemberAndDay, selectedDateKey, totalMembers);
  }, [members, blocksByMemberAndDay, selectedDateKey, totalMembers]);

  const timeLabels = useMemo(() => {
    const labels: string[] = [];
    for (let m = GRID_START_MINUTE; m <= GRID_END_MINUTE; m += 120) {
      labels.push(minutesToTimeLabel(m));
    }
    return labels;
  }, []);

  if (totalMembers === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">No team schedules yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {totalMembers > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-lg font-bold text-foreground tabular-nums">{teamStats.avgAvailability}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Avg availability</p>
          </div>
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-sm font-bold text-foreground leading-tight mt-0.5">{teamStats.bestTime}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Best time</p>
          </div>
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-lg font-bold text-foreground tabular-nums">{totalMembers}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Members</p>
          </div>
        </div>
      )}

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          aria-label="Previous week"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeftIcon />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground tabular-nums">{week.weekLabel}</span>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs font-medium px-2.5 py-1 rounded-md bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              This Week
            </button>
          )}
        </div>

        <button
          onClick={() => setWeekOffset((o) => o + 1)}
          aria-label="Next week"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Day selector tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {week.weekDays.map((day) => {
          const key = formatDateKey(day);
          const isSelected = key === selectedDateKey;
          const isToday = key === week.todayKey;
          const dayShort = day.toLocaleDateString("en-US", { weekday: "short" });
          const dayNum = day.getDate();

          return (
            <button
              key={key}
              onClick={() => setSelectedDateKey(key)}
              className={`
                flex-1 min-w-[44px] flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${isSelected
                  ? "bg-org-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }
              `}
            >
              <span className="uppercase tracking-wide text-[10px]">{dayShort}</span>
              <span className={`text-sm font-bold leading-none tabular-nums ${isToday && !isSelected ? "text-org-primary" : ""}`}>
                {dayNum}
              </span>
            </button>
          );
        })}
      </div>

      {/* Best window callout */}
      {bestWindow && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/15">
          <div className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            <span className="font-semibold">Best window: {bestWindow.label}</span>
            <span className="text-emerald-600/70 dark:text-emerald-500/70"> — {bestWindow.freeCount} of {totalMembers} free</span>
          </p>
        </div>
      )}

      {/* Member rows */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="h-8 w-8 rounded-full bg-muted flex-shrink-0" />
              <div className="h-8 flex-1 rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Time axis labels */}
          <div className="flex ml-[calc(2rem+0.75rem+0.75rem)]">
            {timeLabels.map((label, i) => (
              <div
                key={i}
                className="flex-1 text-[10px] text-muted-foreground/50 tabular-nums"
                style={{ textAlign: i === 0 ? "left" : i === timeLabels.length - 1 ? "right" : "center" }}
              >
                {label}
              </div>
            ))}
          </div>

          {members.map((member) => {
            const memberBlocks = selectedDateKey
              ? (blocksByMemberAndDay.get(`${member.userId}-${selectedDateKey}`) ?? [])
              : [];

            return (
              <div key={member.userId} className="flex items-center gap-3">
                {/* Avatar */}
                <div className="h-8 w-8 rounded-full bg-org-primary/15 text-org-primary flex items-center justify-center text-xs font-semibold flex-shrink-0 select-none">
                  {getInitials(member.name)}
                </div>

                {/* Timeline */}
                <div className="flex-1 relative h-8 rounded-lg bg-muted/30 overflow-hidden">
                  {/* Busy blocks */}
                  {memberBlocks.map((block) => {
                    const leftPct = blockToPercent(block.startMinute);
                    const widthPct = blockToPercent(block.endMinute) - leftPct;
                    const color = block.isOrg ? "bg-org-primary/70" : "bg-org-secondary/70";
                    const timeLabel = `${minutesToTimeLabel(block.startMinute)} – ${minutesToTimeLabel(block.endMinute)}`;

                    return (
                      <div
                        key={block.id}
                        title={`${block.title} · ${timeLabel}`}
                        className={`absolute top-0 h-full ${color} hover:opacity-100 opacity-80 transition-opacity`}
                        style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                      />
                    );
                  })}

                  {/* Current time indicator (today only) */}
                  {selectedDateKey === week.todayKey && (() => {
                    const now = new Date();
                    const currentMinute = now.getHours() * 60 + now.getMinutes();
                    if (currentMinute < GRID_START_MINUTE || currentMinute > GRID_END_MINUTE) return null;
                    const leftPct = blockToPercent(currentMinute);
                    return (
                      <div
                        className="absolute top-0 h-full w-0.5 bg-red-500 z-10"
                        style={{ left: `${leftPct}%` }}
                      />
                    );
                  })()}
                </div>

                {/* Name label (hidden on xs, shown on sm+) */}
                <span className="hidden sm:block text-xs text-muted-foreground w-24 truncate flex-shrink-0" title={member.name}>
                  {member.name}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-1">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-org-primary/70" />
          <span className="text-xs text-muted-foreground">Org Events</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-org-secondary/70" />
          <span className="text-xs text-muted-foreground">Academic</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-muted/60 border border-border/40" />
          <span className="text-xs text-muted-foreground">Free</span>
        </div>
      </div>
    </div>
  );
}
