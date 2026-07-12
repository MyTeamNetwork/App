import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadList } from "../src/components/ai-assistant/ThreadList.tsx";
import { ConversationSidebar } from "../src/components/assistant/ConversationSidebar.tsx";

const existingThread = {
  id: "thread-1",
  title: "Existing conversation",
  surface: "general",
  updated_at: "2026-07-12T12:00:00.000Z",
};

function renderSidebar(threads: (typeof existingThread)[], loading: boolean): string {
  return renderToStaticMarkup(
    React.createElement(ConversationSidebar, {
      threads,
      loading,
      activeThreadId: existingThread.id,
      collapsed: false,
      workflowSection: null,
      onToggleCollapse: () => {},
      onSelectThread: () => {},
      onNewThread: () => {},
      onDeleteThread: async () => {},
    })
  );
}

test("keeps existing conversations visible during a background refresh", () => {
  const html = renderSidebar([existingThread], true);

  assert.match(html, /Existing conversation/);
});

test("shows the loading skeleton on the initial empty load", () => {
  const html = renderSidebar([], true);

  assert.match(html, /animate-pulse/);
  assert.doesNotMatch(html, /Existing conversation/);
});

test("keeps side-panel conversations visible during a background refresh", () => {
  const html = renderToStaticMarkup(
    React.createElement(ThreadList, {
      threads: [existingThread],
      loading: true,
      activeThreadId: existingThread.id,
      onSelectThread: () => {},
      onNewThread: () => {},
      onDeleteThread: async () => {},
    })
  );

  assert.match(html, /Existing conversation/);
});
