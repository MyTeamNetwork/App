/**
 * Sentry wrapper tests
 * Covers performance-monitoring wiring: navigation registration safe before
 * init, and init options carrying the tracing/profiling/app-hang config.
 */

// Capture the object returned by reactNavigationIntegration so we can assert it
// receives the nav container ref. Declared before jest.mock (which is hoisted)
// The `mock` prefix is required for jest to allow referencing it inside the
// hoisted jest.mock factory.
const mockNavIntegration = {
  registerNavigationContainer: jest.fn(),
};

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  wrap: jest.fn((c: unknown) => c),
  reactNavigationIntegration: jest.fn(() => mockNavIntegration),
}));

jest.mock("expo-application", () => ({
  nativeApplicationVersion: "1.0.1",
  nativeBuildVersion: "42",
  applicationId: "com.myteamnetwork.teammeet",
}));

describe("Sentry wrapper", () => {
  let sentry: typeof import("../src/lib/analytics/sentry");
  let sdk: typeof import("@sentry/react-native");

  beforeEach(() => {
    jest.resetModules();
    sdk = require("@sentry/react-native");
    // jest.config resetMocks wipes mock implementations between tests, so
    // re-arm the integration factory before the module reads it at import time.
    (sdk.reactNavigationIntegration as jest.Mock).mockReturnValue(
      mockNavIntegration,
    );
    // requireActual: the config auto-mocks first-party modules under reset, so
    // pull the real wrapper while the @sentry/react-native mock stays in place.
    sentry = jest.requireActual("../src/lib/analytics/sentry");
  });

  it("registers the navigation container before init without throwing", () => {
    // Opt-out path: Sentry.init never ran, but the integration exists at module
    // scope, so registration must be safe and forwarded.
    expect(sentry.isInitialized()).toBe(false);
    const ref = { current: {} };

    expect(() => sentry.registerNavigationContainer(ref)).not.toThrow();
    expect(mockNavIntegration.registerNavigationContainer).toHaveBeenCalledWith(ref);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("initializes with tracing, profiling, and app-hang options", () => {
    sentry.init("https://test@sentry.io/123");

    expect(sdk.init).toHaveBeenCalledTimes(1);
    const options = (sdk.init as jest.Mock).mock.calls[0][0];
    expect(options.tracesSampleRate).toBe(1.0); // __DEV__ is true in jest globals
    expect(options.profilesSampleRate).toBe(0.1);
    expect(options.enableAppHangTracking).toBe(true);
    expect(options.integrations).toContain(mockNavIntegration);
    expect(typeof options.beforeSendTransaction).toBe("function");
  });

  it("passes the navigation integration created with time-to-initial-display", () => {
    expect(sdk.reactNavigationIntegration).toHaveBeenCalledWith({
      enableTimeToInitialDisplay: true,
    });
  });

  it("scrubs PII from transactions via beforeSendTransaction", () => {
    sentry.init("https://test@sentry.io/123");
    const options = (sdk.init as jest.Mock).mock.calls[0][0];

    const scrubbed = options.beforeSendTransaction({
      user: { id: "u1", email: "a@b.com", username: "alice", ip_address: "1.2.3.4" },
      extra: { email: "a@b.com", orgId: "org-1" },
      tags: { name: "Alice", route: "home" },
    });

    expect(scrubbed.user).toEqual({ id: "u1" });
    expect(scrubbed.extra).toEqual({ orgId: "org-1" });
    expect(scrubbed.tags).toEqual({ route: "home" });
  });
});
