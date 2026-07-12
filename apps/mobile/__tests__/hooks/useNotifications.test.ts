jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
  createPostgresChangesChannel: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn(),
  })),
}));
jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/hooks/useRequestTracker", () => ({ useRequestTracker: jest.fn() }));
jest.mock("@/lib/analytics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/notifications", () => ({ setBadgeCount: jest.fn() }));

const { filterDismissedNotifications } = require("../../src/hooks/useNotifications");

describe("filterDismissedNotifications", () => {
  it("removes only the current user's dismissed notifications", () => {
    const notifications = [
      { id: "notification-1", title: "First" },
      { id: "notification-2", title: "Second" },
      { id: "notification-3", title: "Third" },
    ];

    expect(
      filterDismissedNotifications(
        notifications,
        new Set(["notification-2"]),
      ),
    ).toEqual([
      { id: "notification-1", title: "First" },
      { id: "notification-3", title: "Third" },
    ]);
  });

  it("preserves order when no notifications are dismissed", () => {
    const notifications = [{ id: "notification-1" }, { id: "notification-2" }];

    expect(filterDismissedNotifications(notifications, new Set())).toEqual(notifications);
  });
});
