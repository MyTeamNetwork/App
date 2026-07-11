// AI-assisted CSV column mapping for event import.
//
// A CSV of events has arbitrary, human-authored headers ("Game Date",
// "Opponent", "Where"). Rather than feed every row to the LLM, we send only the
// header row plus a few sample rows and ask the model to infer how each column
// maps onto our event fields. The returned mapping is then applied
// deterministically to ALL rows by the caller — scalable for large files and
// predictable in output.

import type OpenAI from "openai";
import { z } from "zod";
import { createLlmClient, getLlmModel } from "@/lib/ai/client";
import { chargeAiSpend, checkAiSpend } from "@/lib/ai/spend";
import { Profiles, runLlmCompletion, type LlmProfile } from "@/lib/ai/llm";

/** Target event fields the CSV columns are mapped onto. */
export const CSV_EVENT_FIELDS = [
  "title",
  "start_date",
  "start_time",
  "end_date",
  "end_time",
  "location",
  "event_type",
  "description",
] as const;

export type CsvEventField = (typeof CSV_EVENT_FIELDS)[number];

/** field -> source CSV header (exact text), or null when no column maps. */
export type CsvEventColumnMapping = Record<CsvEventField, string | null>;

export interface CsvEventMappingContext {
  orgName?: string;
  orgId?: string;
  spendBypass?: boolean;
}

type CsvEventMappingDeps = {
  createClient: () => OpenAI;
  getTextModel: () => string;
};

const defaultDeps: CsvEventMappingDeps = {
  createClient: createLlmClient,
  getTextModel: getLlmModel,
};
let testDeps: CsvEventMappingDeps | null = null;

export function setCsvEventMappingDepsForTests(
  overrides: Partial<CsvEventMappingDeps> | null
): void {
  testDeps = overrides ? { ...defaultDeps, ...overrides } : null;
}

function getDeps(): CsvEventMappingDeps {
  return testDeps ?? defaultDeps;
}

const MAX_SAMPLE_ROWS = 5;
const MAX_CELL_PREVIEW_CHARS = 80;

const rawMappingSchema = z
  .object(
    Object.fromEntries(
      CSV_EVENT_FIELDS.map((field) => [field, z.string().nullable().optional()])
    ) as Record<CsvEventField, z.ZodOptional<z.ZodNullable<z.ZodString>>>
  )
  .passthrough();

function emptyMapping(): CsvEventColumnMapping {
  return Object.fromEntries(
    CSV_EVENT_FIELDS.map((field) => [field, null])
  ) as CsvEventColumnMapping;
}

/**
 * Resolve a model-returned column name back to the exact header text, matching
 * case-insensitively and trimming. Returns null when the model named a column
 * that isn't actually in the header row.
 */
function resolveHeader(headers: string[], candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const needle = candidate.trim().toLowerCase();
  if (needle.length === 0) return null;
  return headers.find((header) => header.trim().toLowerCase() === needle) ?? null;
}

function buildMessages(
  headers: string[],
  sampleRows: string[][]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const sample = sampleRows.slice(0, MAX_SAMPLE_ROWS).map((row) =>
    headers.map((header, i) => {
      const value = (row[i] ?? "").trim().slice(0, MAX_CELL_PREVIEW_CHARS);
      return `${header}: ${value}`;
    })
  );

  const system = [
    "You map columns of a CSV of calendar events onto a fixed set of event fields.",
    `Return only a single JSON object whose keys are exactly: ${CSV_EVENT_FIELDS.join(", ")}.`,
    "Each value must be the EXACT header text of the CSV column that supplies that field, or null when no column fits.",
    "Use a column for at most one field. Prefer the most specific match.",
    "title: the event name or, for games, the opponent/matchup. start_date: the event date. start_time: the start time.",
    "end_date / end_time: only when the CSV clearly has separate end columns. location: venue or place. description: notes/extra detail.",
    "event_type: only if a column states a type (game, practice, meeting, social, workout, fundraiser, philanthropy, class, general).",
    "Do not invent headers. Only use headers from the provided list.",
  ].join("\n");

  const user = [
    "CSV headers:",
    JSON.stringify(headers),
    "",
    "Sample rows (header: value):",
    sample.map((row, i) => `Row ${i + 1}\n${row.join("\n")}`).join("\n\n"),
    "",
    "Return the JSON mapping now.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function normalizeJsonText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}

function readCompletionText(completion: OpenAI.Chat.ChatCompletion): string {
  const content = completion.choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function supportsPromptOnlyJsonFallback(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
  return /response_format|json_object|unsupported/i.test(message);
}

async function requestMapping(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  context: CsvEventMappingContext
): Promise<string> {
  const deps = getDeps();
  const client = deps.createClient();
  const baseProfile: LlmProfile = { ...Profiles.scheduleExtract(), model: deps.getTextModel() };
  const jsonProfile: LlmProfile = { ...baseProfile, responseFormat: { type: "json_object" } };

  if (context.orgId) await checkAiSpend(context.orgId, { bypass: context.spendBypass });

  const charge = async (
    usage: OpenAI.Completions.CompletionUsage | null | undefined,
    actualModel: string
  ) => {
    if (!context.orgId || !usage) return;
    await chargeAiSpend({
      orgId: context.orgId,
      model: actualModel,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      bypass: context.spendBypass,
    });
  };

  try {
    const { completion, actualModel } = await runLlmCompletion(jsonProfile, {
      messages,
      overrides: { temperature: 0 },
      client,
    });
    await charge(completion.usage, actualModel);
    return readCompletionText(completion);
  } catch (error) {
    if (!supportsPromptOnlyJsonFallback(error)) throw error;
    const { completion, actualModel } = await runLlmCompletion(baseProfile, {
      messages,
      overrides: { temperature: 0 },
      client,
    });
    await charge(completion.usage, actualModel);
    return readCompletionText(completion);
  }
}

/**
 * Ask the LLM to map CSV headers onto event fields using a small sample, then
 * resolve each mapped value back to the exact header text. Throws on an
 * unparseable model response so the caller can surface a graceful error.
 */
export async function inferCsvEventColumnMapping(params: {
  headers: string[];
  sampleRows: string[][];
  context: CsvEventMappingContext;
}): Promise<CsvEventColumnMapping> {
  const { headers, sampleRows, context } = params;

  if (headers.length === 0) {
    return emptyMapping();
  }

  const raw = await requestMapping(buildMessages(headers, sampleRows), context);
  const parsed = rawMappingSchema.parse(JSON.parse(normalizeJsonText(raw)));

  const mapping = emptyMapping();
  const usedHeaders = new Set<string>();
  for (const field of CSV_EVENT_FIELDS) {
    const header = resolveHeader(headers, parsed[field]);
    // A column maps to at most one field; first field wins to avoid collisions.
    if (header && !usedHeaders.has(header)) {
      mapping[field] = header;
      usedHeaders.add(header);
    }
  }

  return mapping;
}
