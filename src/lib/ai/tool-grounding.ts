import type { ToolName } from "@/lib/ai/tools/definitions";

export interface SuccessfulToolSummary {
  name: ToolName;
  data: unknown;
}

export interface ToolGroundingResult {
  grounded: boolean;
  failures: string[];
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function stripMarkdown(value: string): string {
  return value.replace(/[*_`~>#]/g, "").trim();
}

function parseStatClaim(content: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(line)) {
      continue;
    }

    const numberFirst = line.match(
      new RegExp(`\\b(\\d+)\\b[^a-zA-Z]{0,10}\\b${escaped}\\b`, "i")
    );
    if (numberFirst) {
      return Number(numberFirst[1]);
    }

    const labelFirst = line.match(
      new RegExp(`\\b${escaped}\\b[^0-9]*(\\d+)`, "i")
    );
    if (labelFirst) {
      return Number(labelFirst[1]);
    }
  }

  return null;
}

function verifyOrgStats(content: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return ["get_org_stats returned non-object data"];
  }

  const stats = data as Partial<Record<string, unknown>>;
  const activeMembers = Number(stats.active_members);
  const alumni = Number(stats.alumni);
  const parents = Number(stats.parents);
  const total = activeMembers + alumni + parents;
  const failures: string[] = [];

  const claimChecks: Array<[string, number]> = [
    ["active members", activeMembers],
    ["alumni", alumni],
    ["parents", parents],
    ["total", total],
  ];

  for (const [label, expected] of claimChecks) {
    const claimed = parseStatClaim(content, label);
    if (claimed !== null && claimed !== expected) {
      failures.push(`${label} claim ${claimed} did not match ${expected}`);
    }
  }

  return failures;
}

function extractListEntryHeads(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .map((line) => stripMarkdown(line.replace(/^([-*]|\d+\.)\s+/, "")))
    .map((line) => line.split(/\s(?:-|—|on)\s/i)[0]?.trim() ?? "")
    .filter(Boolean);
}

function extractEmails(content: string): string[] {
  return [...new Set(content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
}

function answerStatesListIsPartial(content: string): boolean {
  return /\b(partial|showing|first|latest|recent|top)\b/i.test(content);
}

function verifyListMembers(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_members returned non-array data"];
  }

  const names = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string"
          ? normalizeIdentifier((row as { name: string }).name)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );
  const emails = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { email?: unknown }).email === "string"
          ? normalizeIdentifier((row as { email: string }).email)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );

  const failures: string[] = [];
  const countClaim = content.match(/\b(\d+)\s+(?:active\s+)?members?\b/i);
  if (countClaim) {
    const claimed = Number(countClaim[1]);
    if (claimed > data.length && !answerStatesListIsPartial(content)) {
      failures.push(`member count claim ${claimed} exceeded returned rows ${data.length}`);
    }
  }

  for (const email of extractEmails(content)) {
    if (!emails.has(normalizeIdentifier(email))) {
      failures.push(`member email ${email} was not present in tool rows`);
    }
  }

  for (const candidate of extractListEntryHeads(content)) {
    const normalizedCandidate = normalizeIdentifier(candidate);
    if (
      normalizedCandidate.includes("@") ||
      normalizedCandidate.length < 3 ||
      /^your organization/.test(normalizedCandidate)
    ) {
      continue;
    }
    if (!names.has(normalizedCandidate)) {
      failures.push(`member name ${candidate} was not present in tool rows`);
    }
  }

  return failures;
}

function formatKnownEventDates(startDate: string): string[] {
  const isoDate = startDate.slice(0, 10);
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) {
    return [isoDate];
  }

  return [
    isoDate,
    parsed.toLocaleDateString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).toLowerCase(),
  ];
}

function extractQuotedTitles(content: string): string[] {
  return [...content.matchAll(/"([^"\n]+)"/g)].map((match) => stripMarkdown(match[1] ?? ""));
}

function extractMentionedDates(content: string): string[] {
  const isoMatches = content.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const longMatches = content.match(
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/gi
  ) ?? [];
  return [...new Set([...isoMatches, ...longMatches].map((value) => value.toLowerCase()))];
}

function verifyListEvents(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_events returned non-array data"];
  }

  const titles = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { title?: unknown }).title === "string"
          ? normalizeIdentifier((row as { title: string }).title)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );
  const dates = new Set(
    data.flatMap((row) =>
      row && typeof row === "object" && typeof (row as { start_date?: unknown }).start_date === "string"
        ? formatKnownEventDates((row as { start_date: string }).start_date)
        : []
    )
  );

  const failures: string[] = [];
  for (const title of extractQuotedTitles(content)) {
    if (!titles.has(normalizeIdentifier(title))) {
      failures.push(`event title ${title} was not present in tool rows`);
    }
  }

  for (const date of extractMentionedDates(content)) {
    if (!dates.has(date)) {
      failures.push(`event date ${date} was not present in tool rows`);
    }
  }

  return failures;
}

interface SuggestConnectionGroundingRow {
  name?: unknown;
  reasons?: Array<{ code?: unknown }>;
}

function extractSuggestConnectionReasonCodes(line: string): string[] {
  const matches = new Set<string>();
  const normalized = line.toLowerCase();

  if (/direct mentorship/.test(normalized)) {
    matches.add("direct_mentorship");
  }
  if (/(second[- ]degree mentorship|second degree|two[- ]hop mentorship|two hop)/.test(normalized)) {
    matches.add("second_degree_mentorship");
  }
  if (/(shared company|same company)/.test(normalized)) {
    matches.add("shared_company");
  }
  if (/(shared industry|same industry)/.test(normalized)) {
    matches.add("shared_industry");
  }
  if (/(shared major|same major|both studied)/.test(normalized)) {
    matches.add("shared_major");
  }
  if (/(shared graduation year|same graduation year|class of)/.test(normalized)) {
    matches.add("shared_graduation_year");
  }
  if (/(shared city|same city|both in)/.test(normalized)) {
    matches.add("shared_city");
  }

  return [...matches];
}

function verifySuggestConnections(content: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return ["suggest_connections returned non-object data"];
  }

  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return ["suggest_connections returned non-array results"];
  }

  const rows = results as SuggestConnectionGroundingRow[];
  const rowByName = new Map(
    rows
      .map((row) => {
        const name = typeof row.name === "string" ? normalizeIdentifier(row.name) : null;
        return name ? [name, row] : null;
      })
      .filter((entry): entry is [string, SuggestConnectionGroundingRow] => Boolean(entry))
  );

  const failures: string[] = [];

  for (const candidate of extractListEntryHeads(content)) {
    const normalizedCandidate = normalizeIdentifier(candidate);
    if (!rowByName.has(normalizedCandidate)) {
      failures.push(`suggested connection ${candidate} was not present in tool rows`);
    }
  }

  for (const rawLine of content.split("\n")) {
    const line = stripMarkdown(rawLine).trim();
    if (!line) continue;

    for (const [normalizedName, row] of rowByName) {
      if (!normalizeIdentifier(line).includes(normalizedName)) {
        continue;
      }

      const availableCodes = new Set(
        (row.reasons ?? [])
          .map((reason) => (typeof reason?.code === "string" ? reason.code : null))
          .filter((code): code is string => Boolean(code))
      );

      for (const code of extractSuggestConnectionReasonCodes(line)) {
        if (!availableCodes.has(code)) {
          failures.push(`suggested connection ${line} claimed unsupported reason ${code}`);
        }
      }
    }
  }

  return failures;
}

export function verifyToolBackedResponse(input: {
  content: string;
  toolResults: SuccessfulToolSummary[];
}): ToolGroundingResult {
  const failures: string[] = [];

  for (const result of input.toolResults) {
    switch (result.name) {
      case "get_org_stats":
        failures.push(...verifyOrgStats(input.content, result.data));
        break;
      case "list_members":
        failures.push(...verifyListMembers(input.content, result.data));
        break;
      case "list_events":
        failures.push(...verifyListEvents(input.content, result.data));
        break;
      case "suggest_connections":
        failures.push(...verifySuggestConnections(input.content, result.data));
        break;
    }
  }

  return {
    grounded: failures.length === 0,
    failures,
  };
}
