import React from "react";
import { RootNavigationGate } from "@/components/RootNavigationGate";
import { requiresAuthenticatedSession } from "@/lib/intent-auth-gate";

describe("RootNavigationGate", () => {
  it("keeps navigation mounted while launch state is loading", () => {
    const navigation = React.createElement("navigation");
    const loading = React.createElement("loading-overlay");

    const frame = RootNavigationGate({
      navigation,
      loading,
      isLoading: true,
    });

    expect(frame.props.children).toEqual([navigation, loading]);
  });

  it("removes only the loading overlay when launch is ready", () => {
    const navigation = React.createElement("navigation");

    const frame = RootNavigationGate({
      navigation,
      loading: React.createElement("loading-overlay"),
      isLoading: false,
    });

    expect(frame.props.children).toEqual([navigation, null]);
  });
});

describe("requiresAuthenticatedSession", () => {
  it("defers protected cold-start destinations until auth restoration", () => {
    expect(
      requiresAuthenticatedSession({
        kind: "event",
        orgSlug: "acme",
        eventId: "event-1",
      })
    ).toBe(true);
    expect(
      requiresAuthenticatedSession({
        kind: "shortcut",
        action: "open-chat",
        orgSlug: "acme",
      })
    ).toBe(true);
  });

  it("allows auth callbacks to establish the session during hydration", () => {
    expect(
      requiresAuthenticatedSession({
        kind: "auth-handoff",
        code: "code-1",
        challenge: "a".repeat(64),
      })
    ).toBe(false);
    expect(
      requiresAuthenticatedSession({
        kind: "auth-error",
        errorCode: "access_denied",
        rawMessage: "access_denied",
      })
    ).toBe(false);
  });
});
