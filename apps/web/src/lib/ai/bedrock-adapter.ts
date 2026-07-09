// OpenAI-shaped adapter over Amazon Bedrock's Converse / ConverseStream API.
//
// Amazon Nova models are NOT available on Bedrock's OpenAI-compatible Chat
// Completions endpoint (only OpenAI GPT-OSS and Anthropic Claude are). They are
// reached through the Converse family. To avoid rewriting every call site, this
// module exposes an object shaped exactly like the slice of the OpenAI SDK the
// codebase uses — `client.chat.completions.create(body, { signal })` — and
// translates requests/responses to and from Converse under the hood.
//
// The two consumers are `runLlmCompletion` (non-streaming) and `runLlmStream`
// (streaming) in `./llm.ts`. Both keep speaking OpenAI shapes; only this
// boundary knows about Bedrock. Errors are normalized so `classifyError` in
// llm.ts (which reads `.status` / `.name` / `.code`) keeps working unchanged.

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ContentBlock,
  ConverseCommandInput,
  ConverseStreamOutput,
  ImageFormat,
  Message as BedrockMessage,
  StopReason,
  SystemContentBlock,
  Tool as BedrockTool,
  ToolChoice,
  ToolConfiguration,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type OpenAI from "openai";
import { stripModelReasoning } from "@/lib/ai/reasoning";

// Max bytes we will inline into a Converse image block (Bedrock caps image
// payloads; the upstream tool already rejects >2MB, this is a defensive bound).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const JSON_MODE_INSTRUCTION =
  "Respond with a single valid JSON object and nothing else. Do not wrap it in markdown code fences.";

type CreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

interface CreateRequestOptions {
  signal?: AbortSignal;
}

/**
 * Returns an object exposing `chat.completions.create`, backed by Bedrock. The
 * return is cast to `OpenAI` at the call site in `client.ts` because it
 * implements only the surface the LLM wrapper touches.
 */
export function createBedrockChatClient(): {
  chat: {
    completions: {
      create: (
        body: CreateBody,
        options?: CreateRequestOptions,
      ) => Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>;
    };
  };
} {
  const region = process.env.AWS_REGION || "us-east-1";
  const client = new BedrockRuntimeClient({ region });

  return {
    chat: {
      completions: {
        create: async (body, options) => {
          const converseInput = await buildConverseInput(body);
          if (body.stream) {
            return streamConverse(client, converseInput, options?.signal, body.model);
          }
          return completeConverse(client, converseInput, options?.signal, body.model);
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Non-streaming
// ---------------------------------------------------------------------------

async function completeConverse(
  client: BedrockRuntimeClient,
  input: ConverseCommandInput,
  signal: AbortSignal | undefined,
  model: string,
): Promise<ChatCompletion> {
  let response;
  try {
    response = await client.send(new ConverseCommand(input), { abortSignal: signal });
  } catch (err) {
    throw normalizeAwsError(err);
  }
  return converseOutputToCompletion(response, model);
}

function converseOutputToCompletion(
  response: {
    output?: { message?: { content?: ContentBlock[] } };
    stopReason?: StopReason;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  },
  model: string,
): ChatCompletion {
  const blocks = response.output?.message?.content ?? [];
  const textParts: string[] = [];
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

  for (const block of blocks) {
    if (block.text) textParts.push(block.text);
    if (block.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId ?? "",
        type: "function",
        function: {
          name: block.toolUse.name ?? "",
          arguments: JSON.stringify(block.toolUse.input ?? {}),
        },
      });
    }
  }

  // Strip any <thinking> reasoning Nova emits alongside its answer/tool call.
  // If the text was reasoning-only, fall back to null (tool call) or "".
  const visibleText = stripModelReasoning(textParts.join(""));
  const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
    role: "assistant",
    content: visibleText.length > 0 ? visibleText : toolCalls.length > 0 ? null : "",
    refusal: null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  return {
    id: "bedrock-converse",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(response.stopReason),
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: response.usage?.inputTokens ?? 0,
      completion_tokens: response.usage?.outputTokens ?? 0,
      total_tokens: response.usage?.totalTokens ?? 0,
    },
  } as ChatCompletion;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

async function streamConverse(
  client: BedrockRuntimeClient,
  input: ConverseCommandInput,
  signal: AbortSignal | undefined,
  model: string,
): Promise<AsyncIterable<ChatCompletionChunk>> {
  let response;
  try {
    response = await client.send(new ConverseStreamCommand(input), { abortSignal: signal });
  } catch (err) {
    throw normalizeAwsError(err);
  }
  const stream = response.stream;
  return toOpenAiChunks(stream, model);
}

async function* toOpenAiChunks(
  stream: AsyncIterable<ConverseStreamOutput> | undefined,
  model: string,
): AsyncGenerator<ChatCompletionChunk> {
  if (!stream) return;
  try {
    for await (const event of stream) {
      throwIfStreamException(event);

      if (event.contentBlockStart?.start?.toolUse) {
        const start = event.contentBlockStart.start.toolUse;
        yield chunk(model, {
          tool_calls: [
            {
              index: event.contentBlockStart.contentBlockIndex ?? 0,
              id: start.toolUseId,
              type: "function",
              function: { name: start.name, arguments: "" },
            },
          ],
        });
        continue;
      }

      if (event.contentBlockDelta?.delta) {
        const delta = event.contentBlockDelta.delta;
        const index = event.contentBlockDelta.contentBlockIndex ?? 0;
        if (typeof delta.text === "string") {
          yield chunk(model, { content: delta.text });
        } else if (delta.toolUse) {
          yield chunk(model, {
            tool_calls: [
              {
                index,
                function: { arguments: delta.toolUse.input ?? "" },
              },
            ],
          });
        }
        continue;
      }

      if (event.messageStop) {
        yield finishChunk(model, mapStopReason(event.messageStop.stopReason));
        continue;
      }

      if (event.metadata?.usage) {
        yield usageChunk(model, {
          prompt_tokens: event.metadata.usage.inputTokens ?? 0,
          completion_tokens: event.metadata.usage.outputTokens ?? 0,
          total_tokens: event.metadata.usage.totalTokens ?? 0,
        });
      }
    }
  } catch (err) {
    throw normalizeAwsError(err);
  }
}

function chunk(
  model: string,
  delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
): ChatCompletionChunk {
  return {
    id: "bedrock-converse",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: null }],
  };
}

function finishChunk(model: string, finishReason: FinishReason): ChatCompletionChunk {
  return {
    id: "bedrock-converse",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
}

function usageChunk(
  model: string,
  usage: OpenAI.Completions.CompletionUsage,
): ChatCompletionChunk {
  return {
    id: "bedrock-converse",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [],
    usage,
  };
}

// ---------------------------------------------------------------------------
// Request translation: OpenAI ChatCompletion body -> Converse input
// ---------------------------------------------------------------------------

async function buildConverseInput(body: CreateBody): Promise<ConverseCommandInput> {
  const system: SystemContentBlock[] = [];
  const messages: BedrockMessage[] = [];
  const toolConfig = buildToolConfig(body);

  // Converse rejects toolUse/toolResult content blocks unless toolConfig is
  // defined. The pass-2 compose leg replays tool history WITHOUT registering
  // tools (it must never trigger new calls — see run-pass2.ts), so when no
  // tools are defined, translate that history to plain text turns instead of
  // native blocks. Without this, every pass-2 compose over tool results fails
  // with "The toolConfig field must be defined when using toolUse and
  // toolResult content blocks" and the user gets an empty answer.
  const nativeToolBlocks = toolConfig !== undefined;
  const toolCallNames = new Map<string, string>();
  if (!nativeToolBlocks) {
    for (const msg of body.messages) {
      if (msg.role !== "assistant") continue;
      for (const call of msg.tool_calls ?? []) {
        if (call.type === "function") toolCallNames.set(call.id, call.function.name);
      }
    }
  }

  for (const msg of body.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const text = openAiContentToText(msg.content);
      if (text) system.push({ text });
      continue;
    }
    if (msg.role === "user") {
      messages.push({ role: "user", content: await userContentToBlocks(msg.content) });
      continue;
    }
    if (msg.role === "assistant") {
      const content = nativeToolBlocks
        ? assistantContentToBlocks(msg)
        : assistantTextOnlyBlocks(msg);
      if (content.length > 0) messages.push({ role: "assistant", content });
      continue;
    }
    if (msg.role === "tool") {
      messages.push({
        role: "user",
        content: [
          nativeToolBlocks
            ? toolResultBlock(msg.tool_call_id, msg.content)
            : toolResultTextBlock(toolCallNames.get(msg.tool_call_id), msg.content),
        ],
      });
      continue;
    }
    // function role (legacy) and anything else: skip.
  }

  if (isJsonMode(body)) {
    system.push({ text: JSON_MODE_INSTRUCTION });
  }

  const input: ConverseCommandInput = {
    modelId: body.model,
    messages: mergeConsecutive(messages),
  };
  if (system.length > 0) input.system = system;

  const inferenceConfig: NonNullable<ConverseCommandInput["inferenceConfig"]> = {};
  if (typeof body.temperature === "number") inferenceConfig.temperature = body.temperature;
  if (typeof body.max_tokens === "number") inferenceConfig.maxTokens = body.max_tokens;
  if (Object.keys(inferenceConfig).length > 0) input.inferenceConfig = inferenceConfig;

  if (toolConfig) input.toolConfig = toolConfig;

  return input;
}

function isJsonMode(body: CreateBody): boolean {
  const rf = body.response_format;
  return !!rf && "type" in rf && rf.type === "json_object";
}

function openAiContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }
  return "";
}

async function userContentToBlocks(
  content: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"],
): Promise<ContentBlock[]> {
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content }] : [{ text: " " }];
  }
  const blocks: ContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text.length > 0) blocks.push({ text: part.text });
    } else if (part.type === "image_url") {
      blocks.push(await imageUrlToBlock(part.image_url.url));
    }
  }
  return blocks.length > 0 ? blocks : [{ text: " " }];
}

function assistantContentToBlocks(
  msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const text = openAiContentToText(msg.content);
  // Converse rejects empty text blocks; drop the placeholder "" that the
  // composer sends alongside tool_calls.
  if (text.trim().length > 0) blocks.push({ text });
  for (const call of msg.tool_calls ?? []) {
    if (call.type !== "function") continue;
    blocks.push({
      toolUse: {
        toolUseId: call.id,
        name: call.function.name,
        // DocumentType is a smithy type not re-exported by the runtime package;
        // these are opaque JSON payloads, so cast through the field type.
        input: safeJsonParse(call.function.arguments) as never,
      },
    });
  }
  return blocks;
}

/** Assistant turn without native toolUse blocks — text only (toolUse is
 *  illegal without toolConfig; the call is implied by the result turn). */
function assistantTextOnlyBlocks(
  msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam,
): ContentBlock[] {
  const text = openAiContentToText(msg.content);
  return text.trim().length > 0 ? [{ text }] : [];
}

/** Tool result as a plain user-text turn for requests with no toolConfig. */
function toolResultTextBlock(toolName: string | undefined, content: unknown): ContentBlock {
  const text = typeof content === "string" ? content : openAiContentToText(content);
  const label = toolName ? `Result from the ${toolName} tool` : "Tool result";
  return { text: `${label}:\n${text.length > 0 ? text : "(empty)"}` };
}

function toolResultBlock(toolUseId: string, content: unknown): ContentBlock {
  const text = typeof content === "string" ? content : openAiContentToText(content);
  const parsed = safeJsonParse(text);
  const resultContent: ToolResultContentBlock[] =
    parsed && typeof parsed === "object"
      ? [{ json: parsed as never }]
      : [{ text: text.length > 0 ? text : " " }];
  return { toolResult: { toolUseId, content: resultContent } };
}

function buildToolConfig(body: CreateBody): ToolConfiguration | undefined {
  if (!body.tools || body.tools.length === 0) return undefined;
  const tools: BedrockTool[] = [];
  for (const tool of body.tools) {
    if (tool.type !== "function") continue;
    tools.push({
      toolSpec: {
        name: tool.function.name,
        ...(tool.function.description ? { description: tool.function.description } : {}),
        inputSchema: { json: (tool.function.parameters ?? { type: "object" }) as never },
      },
    });
  }
  if (tools.length === 0) return undefined;

  const config: ToolConfiguration = { tools };
  const choice = mapToolChoice(body.tool_choice);
  if (choice) config.toolChoice = choice;
  return config;
}

function mapToolChoice(
  choice: CreateBody["tool_choice"],
): ToolChoice | undefined {
  if (!choice || choice === "none") return undefined;
  if (choice === "auto") return { auto: {} };
  if (choice === "required") return { any: {} };
  if (typeof choice === "object" && choice.type === "function") {
    return { tool: { name: choice.function.name } };
  }
  return undefined;
}

/**
 * Converse requires messages to alternate user/assistant. Tool results are
 * emitted as their own `user` turn, so merge any adjacent same-role messages
 * by concatenating their content blocks.
 */
function mergeConsecutive(messages: BedrockMessage[]): BedrockMessage[] {
  const merged: BedrockMessage[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content = [...(last.content ?? []), ...(msg.content ?? [])];
    } else {
      merged.push({ role: msg.role, content: [...(msg.content ?? [])] });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function imageUrlToBlock(url: string): Promise<ContentBlock> {
  let bytes: Uint8Array;
  let format: ImageFormat;

  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error("Unsupported inline image data URL");
    const mime = match[1] ?? "image/jpeg";
    const isBase64 = !!match[2];
    const data = match[3] ?? "";
    bytes = isBase64
      ? new Uint8Array(Buffer.from(data, "base64"))
      : new Uint8Array(Buffer.from(decodeURIComponent(data), "utf-8"));
    format = mimeToImageFormat(mime, url);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image for extraction (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Image too large for extraction");
    }
    bytes = buf;
    format = mimeToImageFormat(res.headers.get("content-type"), url);
  }

  return { image: { format, source: { bytes } } };
}

function mimeToImageFormat(mime: string | null, url: string): ImageFormat {
  const lower = (mime ?? "").toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("gif")) return "gif";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpeg";
  // Fall back to the URL extension, then jpeg.
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "png";
  if (path.endsWith(".gif")) return "gif";
  if (path.endsWith(".webp")) return "webp";
  return "jpeg";
}

// ---------------------------------------------------------------------------
// finish_reason / stopReason mapping
// ---------------------------------------------------------------------------

type FinishReason = "stop" | "length" | "tool_calls" | "content_filter";

function mapStopReason(reason: StopReason | undefined): FinishReason {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "content_filtered":
    case "guardrail_intervened":
      return "content_filter";
    case "end_turn":
    case "stop_sequence":
    default:
      return "stop";
  }
}

// ---------------------------------------------------------------------------
// Error normalization: make AWS SDK errors legible to llm.ts classifyError
// ---------------------------------------------------------------------------

interface NormalizableError {
  name?: string;
  code?: string;
  status?: number;
  $metadata?: { httpStatusCode?: number };
}

function normalizeAwsError(err: unknown): unknown {
  if (!err || typeof err !== "object") return err;
  const e = err as NormalizableError;

  // Abort surfaces as name "AbortError" already handled by classifyError.
  if (e.name === "AbortError" || e.code === "ABORT_ERR") return err;

  const httpStatus = e.$metadata?.httpStatusCode;
  switch (e.name) {
    case "ThrottlingException":
    case "TooManyRequestsException":
      e.status = 429;
      break;
    case "ModelTimeoutException":
      e.code = "ETIMEDOUT";
      break;
    case "InternalServerException":
    case "ServiceUnavailableException":
    case "ModelStreamErrorException":
    case "ModelErrorException":
      e.status = typeof httpStatus === "number" ? httpStatus : 503;
      break;
    default:
      if (typeof httpStatus === "number") e.status = httpStatus;
  }
  return err;
}

function throwIfStreamException(event: ConverseStreamOutput): void {
  const exceptions: Array<[keyof ConverseStreamOutput, number]> = [
    ["throttlingException", 429],
    ["internalServerException", 500],
    ["serviceUnavailableException", 503],
    ["modelStreamErrorException", 500],
    ["validationException", 400],
  ];
  for (const [key, status] of exceptions) {
    const member = (event as unknown as Record<string, unknown>)[key as string];
    if (member && typeof member === "object") {
      const message =
        "message" in member && typeof (member as { message?: unknown }).message === "string"
          ? (member as { message: string }).message
          : `Bedrock stream ${String(key)}`;
      const error = new Error(message) as Error & NormalizableError;
      error.name = key.charAt(0).toUpperCase() + key.slice(1);
      error.status = status;
      throw error;
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Test-only exports (do not import from product code).
export const __test = {
  buildConverseInput,
  converseOutputToCompletion,
  toOpenAiChunks,
  mapStopReason,
  normalizeAwsError,
  imageUrlToBlock,
};
