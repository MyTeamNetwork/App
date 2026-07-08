import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../src/lib/ai/bedrock-adapter.ts";
import type OpenAI from "openai";

const {
  buildConverseInput,
  converseOutputToCompletion,
  toOpenAiChunks,
  mapStopReason,
  normalizeAwsError,
  imageUrlToBlock,
} = __test;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

test("buildConverseInput extracts system, maps inference config and json mode", async () => {
  const body = {
    model: "us.amazon.nova-micro-v1:0",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ],
    temperature: 0.2,
    max_tokens: 100,
    response_format: { type: "json_object" },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParams;

  const input = await buildConverseInput(body);

  assert.equal(input.modelId, "us.amazon.nova-micro-v1:0");
  // system block + json-mode instruction appended.
  assert.equal(input.system?.length, 2);
  assert.equal(input.system?.[0]?.text, "You are helpful.");
  assert.match(input.system?.[1]?.text ?? "", /valid JSON object/i);
  assert.deepEqual(input.inferenceConfig, { temperature: 0.2, maxTokens: 100 });
  assert.deepEqual(input.messages, [{ role: "user", content: [{ text: "hi" }] }]);
});

test("buildConverseInput maps tools, tool_choice, tool_calls and tool results", async () => {
  const body = {
    model: "m",
    messages: [
      { role: "user", content: "do it" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "t1", type: "function", function: { name: "foo", arguments: '{"a":1}' } },
        ],
      },
      { role: "tool", tool_call_id: "t1", content: '{"ok":true}' },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "foo",
          description: "does foo",
          parameters: { type: "object", properties: { a: { type: "number" } } },
        },
      },
    ],
    tool_choice: "auto",
  } as OpenAI.Chat.Completions.ChatCompletionCreateParams;

  const input = await buildConverseInput(body);

  assert.equal(input.toolConfig?.tools?.[0]?.toolSpec?.name, "foo");
  assert.equal(input.toolConfig?.tools?.[0]?.toolSpec?.description, "does foo");
  assert.ok(input.toolConfig?.tools?.[0]?.toolSpec?.inputSchema);
  assert.deepEqual(input.toolConfig?.toolChoice, { auto: {} });

  // user, assistant(toolUse only — empty text dropped), user(toolResult)
  assert.equal(input.messages?.length, 3);
  assert.deepEqual(input.messages?.[1], {
    role: "assistant",
    content: [{ toolUse: { toolUseId: "t1", name: "foo", input: { a: 1 } } }],
  });
  assert.deepEqual(input.messages?.[2], {
    role: "user",
    content: [{ toolResult: { toolUseId: "t1", content: [{ json: { ok: true } }] } }],
  });
});

test("buildConverseInput maps required/named tool_choice", async () => {
  const required = await buildConverseInput({
    model: "m",
    messages: [{ role: "user", content: "x" }],
    tools: [{ type: "function", function: { name: "foo", parameters: {} } }],
    tool_choice: "required",
  } as OpenAI.Chat.Completions.ChatCompletionCreateParams);
  assert.deepEqual(required.toolConfig?.toolChoice, { any: {} });

  const named = await buildConverseInput({
    model: "m",
    messages: [{ role: "user", content: "x" }],
    tools: [{ type: "function", function: { name: "foo", parameters: {} } }],
    tool_choice: { type: "function", function: { name: "foo" } },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParams);
  assert.deepEqual(named.toolConfig?.toolChoice, { tool: { name: "foo" } });
});

test("buildConverseInput merges consecutive same-role messages", async () => {
  const input = await buildConverseInput({
    model: "m",
    messages: [
      { role: "user", content: "a" },
      { role: "tool", tool_call_id: "t1", content: "r1" },
      { role: "tool", tool_call_id: "t2", content: "r2" },
    ],
  } as OpenAI.Chat.Completions.ChatCompletionCreateParams);

  // user "a" and the two tool results (both mapped to user turns) merge into
  // a single user message with three content blocks.
  assert.equal(input.messages?.length, 1);
  assert.equal(input.messages?.[0]?.role, "user");
  assert.equal(input.messages?.[0]?.content?.length, 3);
});

test("converseOutputToCompletion maps text, tool use, usage and finish reason", () => {
  const completion = converseOutputToCompletion(
    {
      output: {
        message: {
          content: [
            { text: "hello " },
            { text: "world" },
            { toolUse: { toolUseId: "t1", name: "foo", input: { a: 1 } } },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    },
    "nova",
  );

  const choice = completion.choices[0];
  assert.equal(choice.message.content, "hello world");
  assert.equal(choice.finish_reason, "tool_calls");
  assert.equal(choice.message.tool_calls?.[0]?.id, "t1");
  assert.equal(choice.message.tool_calls?.[0]?.function.name, "foo");
  assert.equal(choice.message.tool_calls?.[0]?.function.arguments, '{"a":1}');
  assert.equal(completion.usage?.prompt_tokens, 10);
  assert.equal(completion.usage?.completion_tokens, 4);
});

test("toOpenAiChunks translates converse stream events to OpenAI chunks", async () => {
  async function* events() {
    yield { messageStart: { role: "assistant" } } as Any;
    yield { contentBlockDelta: { delta: { text: "Hello" }, contentBlockIndex: 0 } } as Any;
    yield { contentBlockStart: { start: { toolUse: { toolUseId: "t1", name: "foo" } }, contentBlockIndex: 1 } } as Any;
    yield { contentBlockDelta: { delta: { toolUse: { input: '{"a":' } }, contentBlockIndex: 1 } } as Any;
    yield { contentBlockDelta: { delta: { toolUse: { input: "1}" } }, contentBlockIndex: 1 } } as Any;
    yield { messageStop: { stopReason: "tool_use" } } as Any;
    yield { metadata: { usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } } } as Any;
  }

  const chunks = await collect(toOpenAiChunks(events(), "nova"));

  const text = chunks.find((c) => c.choices[0]?.delta?.content);
  assert.equal(text?.choices[0]?.delta?.content, "Hello");

  const toolStart = chunks.find((c) => c.choices[0]?.delta?.tool_calls?.[0]?.id);
  assert.equal(toolStart?.choices[0]?.delta?.tool_calls?.[0]?.index, 1);
  assert.equal(toolStart?.choices[0]?.delta?.tool_calls?.[0]?.function?.name, "foo");

  const argFragments = chunks
    .flatMap((c) => c.choices[0]?.delta?.tool_calls ?? [])
    .map((tc) => tc.function?.arguments)
    .filter((a): a is string => typeof a === "string")
    .join("");
  assert.equal(argFragments, '{"a":1}');

  const finish = chunks.find((c) => c.choices[0]?.finish_reason);
  assert.equal(finish?.choices[0]?.finish_reason, "tool_calls");

  const usage = chunks.find((c) => c.usage);
  assert.equal(usage?.usage?.prompt_tokens, 7);
  assert.equal(usage?.usage?.completion_tokens, 3);
  assert.deepEqual(usage?.choices, []);
});

test("toOpenAiChunks throws normalized error on a mid-stream exception member", async () => {
  async function* events() {
    yield { contentBlockDelta: { delta: { text: "partial" }, contentBlockIndex: 0 } } as Any;
    yield { throttlingException: { message: "slow down" } } as Any;
  }
  await assert.rejects(
    () => collect(toOpenAiChunks(events(), "nova")),
    (err: Any) => err.status === 429,
  );
});

test("mapStopReason covers the load-bearing OpenAI finish_reason strings", () => {
  assert.equal(mapStopReason("tool_use"), "tool_calls");
  assert.equal(mapStopReason("max_tokens"), "length");
  assert.equal(mapStopReason("end_turn"), "stop");
  assert.equal(mapStopReason("stop_sequence"), "stop");
  assert.equal(mapStopReason("content_filtered"), "content_filter");
  assert.equal(mapStopReason("guardrail_intervened"), "content_filter");
  assert.equal(mapStopReason(undefined), "stop");
});

test("normalizeAwsError maps AWS exceptions to fields classifyError reads", () => {
  const throttle = normalizeAwsError({ name: "ThrottlingException", $metadata: { httpStatusCode: 429 } }) as Any;
  assert.equal(throttle.status, 429);

  const timeout = normalizeAwsError({ name: "ModelTimeoutException" }) as Any;
  assert.equal(timeout.code, "ETIMEDOUT");

  const validation = normalizeAwsError({ name: "ValidationException", $metadata: { httpStatusCode: 400 } }) as Any;
  assert.equal(validation.status, 400);

  const server = normalizeAwsError({ name: "InternalServerException" }) as Any;
  assert.equal(server.status, 503);

  // Abort is left alone (classifyError already handles name === "AbortError").
  const abort = normalizeAwsError({ name: "AbortError" }) as Any;
  assert.equal(abort.status, undefined);
});

test("imageUrlToBlock decodes base64 data URLs", async () => {
  const b64 = Buffer.from("PNGDATA").toString("base64");
  const block = (await imageUrlToBlock(`data:image/png;base64,${b64}`)) as Any;
  assert.equal(block.image.format, "png");
  assert.equal(Buffer.from(block.image.source.bytes).toString(), "PNGDATA");
});

test("imageUrlToBlock fetches remote images and derives format from content-type", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode("JPEGDATA").buffer,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "image/jpeg" : null) },
  })) as Any;
  try {
    const block = (await imageUrlToBlock("https://example.com/schedule")) as Any;
    assert.equal(block.image.format, "jpeg");
    assert.equal(Buffer.from(block.image.source.bytes).toString(), "JPEGDATA");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
