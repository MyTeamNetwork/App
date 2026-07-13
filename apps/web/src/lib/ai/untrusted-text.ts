// Sanitizer for low-privilege user content (bios, discussion replies,
// announcements) retrieved via RAG and concatenated into admin-facing
// prompts. Neutralizes structural indirect-prompt-injection vectors
// (forged closing sentinels, markdown image exfil, forged heading markers)
// without phrase-filtering instruction-like language — that's out of scope.

export const UNTRUSTED_CHUNK_OPEN = "<<<UNTRUSTED_RAG_CHUNK>>>";
export const UNTRUSTED_CHUNK_CLOSE = "<<<END_UNTRUSTED_RAG_CHUNK>>>";

const ZERO_WIDTH_CHARS_RE = /[​‌‍﻿]/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;
const LEADING_HEADING_RE = /^#{1,6}\s*/gm;
const REMOVED_MARKER = "‹removed›";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SENTINEL_RE = new RegExp(
  `${escapeRegExp(UNTRUSTED_CHUNK_OPEN)}|${escapeRegExp(UNTRUSTED_CHUNK_CLOSE)}`,
  "gi"
);

function stripZeroWidthChars(text: string): string {
  return text.replace(ZERO_WIDTH_CHARS_RE, "");
}

function neutralizeSentinels(text: string): string {
  return text.replace(SENTINEL_RE, REMOVED_MARKER);
}

function neutralizeMarkdownImages(text: string): string {
  return text.replace(MARKDOWN_IMAGE_RE, "[image: $1]");
}

function neutralizeHeadingMarkers(text: string): string {
  return text.replace(LEADING_HEADING_RE, "");
}

export function neutralizeUntrustedText(text: string): string {
  const withoutZeroWidth = stripZeroWidthChars(text);
  const withoutSentinels = neutralizeSentinels(withoutZeroWidth);
  const withoutImages = neutralizeMarkdownImages(withoutSentinels);
  return neutralizeHeadingMarkers(withoutImages);
}
