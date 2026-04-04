---
date: 2026-04-04
topic: calendar-tab-consolidation
---

# Calendar Tab Consolidation

## Problem Frame

The calendar page has 4 tabs — Month, Events, All Activity, and Availability — but "Events" and "All Activity" both show event lists, where "Events" is simply a filtered subset of "All Activity." This redundancy confuses users: it's unclear why both exist, what's different between them, and which one to use. The tab model mixes two unrelated dimensions (view type vs. content filter) in the same nav layer.

Google Calendar solves this by keeping views representation-based (month grid vs. list) rather than content-based. TeamMeet should follow the same model.

## Requirements

- R1. Reduce the top-level tab bar from 4 tabs to 2: **Calendar** and **Availability**.
- R2. The **Calendar** tab renders the existing month grid by default.
- R3. The Calendar tab header includes a top-right icon toggle (grid icon / list icon) to switch between Month and List sub-views within the same tab.
- R4. **List sub-view** renders the unified event feed (currently "All Activity") with source filter pills: All · Team Events · Schedules · Calendar Feeds · My Schedule.
- R5. List sub-view supports an Upcoming / Past toggle so users can see past events (preserving the feature previously only in the "Events" tab).
- R6. The month/list sub-view preference is persisted in the URL (e.g., `?subview=list`) so links are shareable and back/forward navigation works.
- R7. The standalone **Events** tab and **All Activity** tab are removed from the top-level nav.
- R8. The **Availability** tab remains unchanged (personal availability agenda + admin team availability rows).

## Success Criteria

- A user landing on the Calendar page can immediately understand what they're looking at without reading tooltip text.
- There is no duplicate entry point for the same content — every event type is reachable through exactly one path.
- Existing deep links to `?view=events` and `?view=all` redirect gracefully to the new Calendar tab (with appropriate sub-view).

## Scope Boundaries

- The Availability tab content (PersonalAvailabilityAgenda, TeamAvailabilityRows) is not changed.
- The month grid behavior, event chips, and color coding are not changed.
- The unified event feed behavior and source filter pills are not changed — only their placement changes.
- The settings/admin panels (TeamScheduleTab, MyCalendarTab) that live elsewhere are out of scope.

## Key Decisions

- **2 tabs over 3**: Collapsing Month + List into one Calendar tab with an in-header toggle matches Google Calendar's paradigm more closely than keeping a third "Events" tab. It removes the content-type disambiguation entirely from top-level nav.
- **Top-right icon toggle**: Matches Google Calendar's view switcher position; keeps the header uncluttered on mobile.
- **URL persistence for sub-view**: Keeps the app linkable and avoids state reset on browser back.

## Dependencies / Assumptions

- `?view=` param already drives tab selection via `CalendarViewToggle` and `parseCalendarView` in `src/lib/calendar/view-state.ts` — the sub-view param can extend this same pattern.
- Existing route helpers in `src/lib/calendar/routes.ts` (`calendarEventsPath`, `calendarAllPath`) will need to be updated or deprecated.

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Does the existing `UnifiedEventFeed` already have a Past toggle, or does that need to be added from the `CalendarEventsView` implementation?
- [Affects R6][Technical] Should `?subview=list` replace `?view=all` / `?view=events`, or should old `?view=` values be redirected client-side?

## Next Steps

→ `/ce:plan` for structured implementation planning
