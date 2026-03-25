---
name: falkor-graph-worker
description: Implements Falkor people-graph correctness and observability features with test-first discipline and live local graph verification.
---

# Falkor Graph Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for features touching Falkor people-graph projection, sync reconciliation, recommendation fallback visibility, graph health surfaces, and their focused tests in this repository.

## Required Skills

None.

## Work Procedure

1. Read `mission.md`, `AGENTS.md`, `validation-contract.md`, and the assigned feature entry in `features.json`. Extract the exact assertion IDs the feature fulfills before editing anything.
2. Inspect the relevant existing code/tests (`src/lib/falkordb/people.ts`, `sync.ts`, `suggestions.ts`, route files, migrations, and Falkor test files) and identify the narrowest files needed.
3. Write failing tests first. Add or extend the smallest focused test coverage that proves the assigned assertions. If the feature changes observability, assert stable machine-readable fields rather than logs.
4. Run the new or focused failing tests and capture the red-state result in the handoff.
5. Implement the minimum production change required to satisfy the assertions. Preserve SQL/Falkor parity, org scoping, and reconciliatory sync behavior.
6. Re-run focused tests until green. Then run any adjacent targeted suites affected by the change.
7. For sync/read-path features, run the live local graph check with `node --loader ./tests/ts-loader.js scripts/test-falkor-local.ts` unless the feature is purely unit-level and the live script is genuinely unaffected. If skipped, justify it explicitly in the handoff.
8. Run repo validators relevant to touched files (at minimum `npm run lint`; add route/tests as needed). Do not leave processes running.
9. Perform one quick adjacency check: ensure the change does not alter ranking semantics unless the feature explicitly required it.
10. Produce a thorough handoff with exact commands, observations, tests added, any skipped validation, and discovered issues.

## Example Handoff

```json
{
  "salientSummary": "Added failing tests and implemented old-key reconciliation for person/org transitions plus stale-edge cleanup, then verified both focused test coverage and the live Falkor script. Ranking parity stayed unchanged.",
  "whatWasImplemented": "Extended tests/falkordb-people-graph.test.ts with unlink, relink, and org-move scenarios; updated src/lib/falkordb/sync.ts to reconcile stale person keys and mentorship edges without deleting still-valid complement identities; kept src/lib/falkordb/suggestions.ts behavior unchanged except for reused helpers.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "node --test --loader ./tests/ts-loader.js tests/falkordb-people-graph.test.ts",
        "exitCode": 0,
        "observation": "Focused Falkor graph suite passed with new transition and stale-edge cases."
      },
      {
        "command": "node --loader ./tests/ts-loader.js scripts/test-falkor-local.ts",
        "exitCode": 0,
        "observation": "Live local graph check returned mode=falkor, freshness=fresh, and expected deduped suggestions after queue drain."
      },
      {
        "command": "npm run lint",
        "exitCode": 0,
        "observation": "Lint passed for touched files."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Queried the local Falkor graph after the transition scenario to verify the old person key was absent and the current key existed once.",
        "observed": "Graph inspection matched the new test expectations and showed no duplicate nodes or duplicate MENTORS edges."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "tests/falkordb-people-graph.test.ts",
        "cases": [
          {
            "name": "reconciles old person/org keys during relink",
            "verifies": "Stale graph representations are removed while the current canonical identity remains."
          },
          {
            "name": "removes stale mentorship edge when endpoints change",
            "verifies": "Only the current MENTORS edge remains after endpoint reconciliation."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature requires a new operator surface or migration shape whose scope is broader than the assigned feature.
- Validation depends on missing infrastructure beyond the accepted `CRON_SECRET` limitation.
- You find ranking-semantics changes would be required to satisfy the feature.
- A pre-existing graph/setup issue prevents proving the assigned assertions with targeted tests or the live local graph check.
