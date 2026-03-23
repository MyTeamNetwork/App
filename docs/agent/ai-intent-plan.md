# AI Intent Routing & Surface Inference — Code Map

## Overview

Each incoming chat message flows through a lightweight intent router that classifies the message content and resolves an effective surface for context loading, caching, and tool selection. The system deliberately separates **thread surface** (stable, set at creation, used for UI grouping) from **message context_surface** (per-turn, content-inferred, determines what data the LLM sees). A casual gate short-circuits RAG and suppresses pass-1 tool attachment for greetings, thanks, and farewells, and the cache layer independently skips RAG for cache-eligible first-turn `general` prompts.

## File Map

### Source

| File | Purpose | Key Exports |
|---|---|---|
| `src/lib/ai/intent-router.ts` | Message classification and surface inference | `resolveSurfaceRouting()`, `AiIntent`, `SurfaceRoutingDecision` |
| `src/components/ai-assistant/route-surface.ts` | Client-side pathname-to-surface mapping | `routeToSurface()` |
| `src/lib/ai/context-builder.ts` | Surface-gated DB queries, token budget, prompt assembly | `buildPromptContext()`, `SURFACE_DATA_SOURCES` |
| `src/lib/ai/semantic-cache-utils.ts` | Surface-aware cache eligibility and TTLs | `checkCacheEligibility()`, `CACHE_TTL_HOURS` |
| `src/lib/schemas/ai-assistant.ts` | Canonical surface enum and request validation | `AiSurface`, `aiSurfaceEnum`, `sendMessageSchema` |
| `src/app/api/ai/[orgId]/chat/handler.ts` | Pipeline orchestrator — wires routing into the chat flow | `createChatPostHandler()` |

### Schema

| File | Purpose |
|---|---|
| `supabase/migrations/20260323000000_ai_message_context_surface.sql` | Adds `context_surface` column to `ai_messages`, updates `init_ai_chat` RPC to 9-param signature |
| `supabase/migrations/20260710100000_ai_audit_log_context_columns.sql` | Adds `context_surface`, `context_token_estimate` to `ai_audit_log` |

### Tests

| File | Coverage |
|---|---|
| `tests/ai-intent-router.test.ts` | Casual gate (greetings, thanks), keyword rerouting, greeting+question hybrid |
| `tests/routes/ai/chat-handler.test.ts` | Full pipeline: rerouting preserves thread surface, ambiguous fallback, casual skips RAG, non-casual runs RAG |
| `tests/ai-panel-route-surface.test.ts` | Route-to-surface mapping: all prefixes, nested routes, partial-match rejection, edge cases (26 tests) |

## Data Flow

```
Browser URL (/my-org/members)
  └─ routeToSurface(pathname)         → surface = "members"  (client-side)
       │
       ▼
POST /api/ai/{orgId}/chat { message, surface: "members", ... }
  └─ sendMessageSchema.parse()        validates body
       │
       ▼
resolveSurfaceRouting(message, surface)
  ├─ normalizeMessage()               NFC, lowercase, strip zero-width chars
  ├─ isCasualMessage()                → skipRetrieval: true/false
  ├─ countMatches() × 3 surfaces     keyword scoring
  └─ returns SurfaceRoutingDecision
       ├─ effectiveSurface            may differ from requested surface
       ├─ intent                      e.g. "members_query", "events_query"
       ├─ confidence                  "high" (single winner) / "low" (no matches)
       ├─ rerouted                    true if effectiveSurface !== requested
       └─ skipRetrieval               true for casual messages
            │
            ▼
init_ai_chat RPC
  p_surface = "members"              → thread.surface (immutable)
  p_context_surface = effectiveSurface → message.context_surface (per-turn)
  p_intent = resolvedIntent           → message.intent
            │
            ▼
  ┌─ checkCacheEligibility(effectiveSurface)
  │    only "general" is eligible in v1
  │
  ├─ if !skipRetrieval and prompt is not cache-eligible: retrieveRelevantChunks()
  │    → ragChunks (additive, non-blocking)
  │
  ├─ buildPromptContext({ surface: effectiveSurface, ragChunks, now, timeZone })
  │    → SURFACE_DATA_SOURCES[effectiveSurface] gates DB queries
  │    → token budget trims sections by priority
  │    → trusted system prompt includes current local date/time
  │
  ├─ resolve pass-1 tools from effectiveSurface
  │    → casual exact-match turns attach no tools
  │    → non-casual turns attach only the relevant read tools
  │
  └─ Stream LLM → logAiRequest({ intent, contextSurface, ragChunkCount })
```

## Intent Router Algorithm

`resolveSurfaceRouting(message, requestedSurface)` performs four steps:

### Step 1 — Normalize
```
NFC → lowercase → strip zero-width chars (U+200B–U+200D, U+FEFF) → collapse whitespace
```

### Step 2 — Casual Gate
Match against `CASUAL_MESSAGE_PATTERNS`:
- Greetings: `hey`, `hi`, `hello`, `howdy`, `yo`, `sup`, `what's up`
- Acknowledgements: `ok`, `okay`, `got it`, `understood`, `makes sense`, `i see`, `cool`
- Farewells: `bye`, `goodbye`, `see you`, `later`, `cya`, `peace`
- Thanks: `thanks`, `thank you`, `thx`, `ty`, `appreciate it`

These are exact-match checks against the full normalized message. If the entire message is a casual phrase, `skipRetrieval: true` and pass-1 tool attachment is suppressed. A hybrid like `"hey, what events are coming up?"` fails the exact match and proceeds to keyword scoring normally.

### Step 3 — Keyword Scoring
Count word-boundary regex matches (`(?<!\w)keyword(?!\w)`) per surface:

| Surface | Keywords |
|---|---|
| `members` | member, members, alumni, parent, parents, roster, directory, mentorship |
| `analytics` | analytics, metric, metrics, donation, donations, fundraising, revenue, expense, expenses, budget, budgets, financial, finance |
| `events` | event, events, calendar, schedule, schedules, meeting, meetings, ceremony, game, games, rsvp |

### Step 4 — Decision

| Condition | Result |
|---|---|
| Zero matches | `effectiveSurface = requestedSurface`, `confidence: "low"` |
| Single highest scorer | `effectiveSurface = winner`, `confidence: "high"`, `rerouted` if winner differs |
| Tie (equal top scores) | `intent: "ambiguous_query"`, falls back to `requestedSurface` |

## Key Design Decisions

1. **Thread surface is immutable; message context_surface is per-turn.** Thread grouping stays stable for UI (thread list filtering, navigation). Each message independently records its effective surface, enabling per-turn analytics.

2. **Casual gate is additive, not short-circuiting.** `skipRetrieval: true` suppresses RAG and pass-1 tool attachment only. Context loading, LLM invocation, and surface routing all still run. A greeting on `/members` still gets members context.

3. **Rerouting automatically bypasses cache.** Only `"general"` is cache-eligible in v1. Rerouting to any other surface makes the message cache-ineligible — no coordination needed between router and cache.

4. **RAG is always non-blocking, and sometimes intentionally skipped.** Retrieval errors are caught and logged; the request continues without chunks. The casual gate avoids the embedding API call for exact casual turns, and the cache layer also avoids retrieval for cache-eligible first-turn `general` prompts so cached responses do not depend on mutable retrieved chunks.

5. **`init_ai_chat` is service-role only.** Users cannot inject arbitrary `context_surface` or `intent` values. The RPC is restricted to `service_role` via explicit `REVOKE`/`GRANT`.

6. **Keyword lists are static and hardcoded.** Adding a new surface requires updating `aiSurfaceEnum` in the schema, `SURFACE_KEYWORDS` in intent-router.ts, `SURFACE_PREFIXES` in route-surface.ts, and `SURFACE_DATA_SOURCES` in context-builder.ts.

7. **Normalization is duplicated.** `normalizeMessage()` in intent-router.ts and `normalizePrompt()` in semantic-cache-utils.ts implement the same logic independently. If one changes, the other must follow.

## Related Docs

- **[intent-type-taxonomy.md](intent-type-taxonomy.md)** — Second classification axis: intent *type* (`knowledge_query`, `action_request`, `navigation`, `casual`) — what the user wants, orthogonal to the surface routing documented here
- **[chat-pipeline-codemap.md](chat-pipeline-codemap.md)** — Full pipeline orchestration, token budget, section priorities
- **[semantic-cache-codemap.md](semantic-cache-codemap.md)** — Cache eligibility rules, freshness policy, and no-RAG-on-cacheable-path contract
