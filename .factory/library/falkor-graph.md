# Falkor Graph

Mission-specific notes for Falkor people-graph work.

**What belongs here:** Graph-specific invariants, operational expectations, and testing shortcuts for workers on this mission.

---

- Highest-risk mission area: identity resolution mistakes that create stale or duplicate `Person` nodes or `MENTORS` edges.
- Mandatory behaviors to preserve:
  - one canonical `user:<id>` identity when member + alumni share a `user_id`
  - no cross-org identity leakage
  - stale old keys and old mentorship endpoints must be reconciled away during transitions
  - replay/backfill/out-of-order processing must converge to the same final graph
- For observability milestone work, the chosen graph health surface must be org-scoped and machine-verifiable in tests.
- If Falkor is unavailable or throws during reads, fallback behavior must remain correct and visibly attributable by org and reason.
