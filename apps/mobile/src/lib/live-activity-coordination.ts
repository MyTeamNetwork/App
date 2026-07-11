export interface LiveActivityCoordinationState {
  hydrated: boolean;
  activities: Map<string, string>;
  startingEventIds: Set<string>;
}

interface ActiveRecord {
  eventId: string;
  activityId: string;
}

export function createLiveActivityCoordinationState(): LiveActivityCoordinationState {
  return {
    hydrated: false,
    activities: new Map(),
    startingEventIds: new Set(),
  };
}

export function hydrateLiveActivityCoordination(
  state: LiveActivityCoordinationState,
  records: ActiveRecord[]
): string[] {
  state.activities.clear();
  state.startingEventIds.clear();
  const duplicateActivityIds: string[] = [];
  for (const record of records) {
    if (state.activities.has(record.eventId)) {
      duplicateActivityIds.push(record.activityId);
      continue;
    }
    state.activities.set(record.eventId, record.activityId);
  }
  state.hydrated = true;
  return duplicateActivityIds;
}

export function reserveLiveActivityStart(
  state: LiveActivityCoordinationState,
  eventId: string
): boolean {
  if (!state.hydrated || state.activities.has(eventId) || state.startingEventIds.has(eventId)) {
    return false;
  }
  state.startingEventIds.add(eventId);
  return true;
}

export function completeLiveActivityStart(
  state: LiveActivityCoordinationState,
  eventId: string,
  activityId: string | null
): void {
  state.startingEventIds.delete(eventId);
  if (activityId) {
    state.activities.set(eventId, activityId);
  }
}

export function resetLiveActivityCoordination(state: LiveActivityCoordinationState): void {
  state.hydrated = false;
  state.activities.clear();
  state.startingEventIds.clear();
}
