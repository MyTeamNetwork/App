import test from "node:test";
import assert from "node:assert/strict";
import { composeResponse } from "../../../src/lib/ai/response-composer.ts";
import type { ToolCallRequestedEvent } from "../../../src/lib/ai/response-composer.ts";

function createMockClient(chunks: any[]) {
  return {
    chat: {
      completions: {
        create: async () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
        }),
      },
    },
  } as any;
}

test("composeResponse yields ToolCallRequestedEvent when LLM returns tool_calls", async () => {
  const client = createMockClient([
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "list_members", arguments: '{"lim' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'it": 5}' } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);

  const events: any[] = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [{ role: "user", content: "list members" }],
    tools: [{ type: "function", function: { name: "list_members", parameters: {} } }] as any,
  })) {
    events.push(event);
  }

  const toolEvent = events.find((e) => e.type === "tool_call_requested") as ToolCallRequestedEvent;
  assert.ok(toolEvent, "should have a tool_call_requested event");
  assert.equal(toolEvent.name, "list_members");
  assert.equal(toolEvent.argsJson, '{"limit": 5}');
});

test("composeResponse yields normal chunks when no tools param", async () => {
  const client = createMockClient([
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " world" }, finish_reason: "stop" }] },
  ]);

  const events: any[] = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [{ role: "user", content: "hi" }],
  })) {
    events.push(event);
  }

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "chunk");
  assert.equal(events[1].type, "chunk");
});

test("composeResponse passes tools and tool_choice to API call", async () => {
  let capturedParams: any;
  const client = {
    chat: {
      completions: {
        create: async (params: any) => {
          capturedParams = params;
          return { [Symbol.asyncIterator]: async function* () {} };
        },
      },
    },
  } as any;

  const tools = [{ type: "function" as const, function: { name: "test", parameters: {} } }];
  for await (const _ of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
    tools: tools as any,
  })) { /* drain */ }

  assert.deepEqual(capturedParams.tools, tools);
  assert.equal(capturedParams.tool_choice, "auto");
});

test("composeResponse does NOT pass tools/tool_choice when tools is undefined", async () => {
  let capturedParams: any;
  const client = {
    chat: {
      completions: {
        create: async (params: any) => {
          capturedParams = params;
          return { [Symbol.asyncIterator]: async function* () {} };
        },
      },
    },
  } as any;

  for await (const _ of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
  })) { /* drain */ }

  assert.equal(capturedParams.tools, undefined);
  assert.equal(capturedParams.tool_choice, undefined);
});

test("composeResponse can yield both text chunks and tool call", async () => {
  const client = createMockClient([
    { choices: [{ delta: { content: "Let me check" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "get_org_stats", arguments: "{}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);

  const events: any[] = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
    tools: [] as any,
  })) {
    events.push(event);
  }

  const chunkEvents = events.filter((e) => e.type === "chunk");
  const toolEvents = events.filter((e) => e.type === "tool_call_requested");
  assert.equal(chunkEvents.length, 1);
  assert.equal(chunkEvents[0].content, "Let me check");
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].name, "get_org_stats");
});
