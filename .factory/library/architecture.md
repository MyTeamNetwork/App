# Architecture

Architectural decisions and implementation patterns for this mission.

**What belongs here:** Stable architecture notes, invariants, layering rules, and patterns workers should follow.

---

- `src/lib/falkordb/people.ts` is the source of truth for canonical person identity rules.
- Member/alumni rows only merge when they share the same `user_id`; otherwise they stay as `member:<id>` or `alumni:<id>` identities.
- Sync is reconciliatory: queue payloads provide old-key context, but current graph state must be derived by re-reading authoritative Supabase rows.
- Keep org scoping explicit everywhere. The same `user_id` may appear in multiple orgs, but graph identities must remain isolated per org graph unless a row actually moves orgs.
- SQL/Falkor ranking parity is a non-negotiable invariant for this mission.
- Observability changes must be out-of-band from recommendation semantics: surface health/fallback signals without changing ranking results.
