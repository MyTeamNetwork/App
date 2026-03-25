# User Testing

Testing surface findings, required testing skills/tools, and resource cost classification.

**What belongs here:** Validation surfaces, setup notes, runtime gotchas, and concurrency guidance for validators.

---

## Validation Surface

### Primary surfaces
1. Targeted Node test suites:
   - `tests/falkordb-people-graph.test.ts`
   - `tests/routes/ai/tool-executor.test.ts`
   - `tests/ai-cron-routes.test.ts`
2. Live local graph verification:
   - `node --loader ./tests/ts-loader.js scripts/test-falkor-local.ts`
3. Optional Falkor Browser inspection on `http://127.0.0.1:3001/`

### Accepted limitations
- Real authenticated HTTP validation of `/api/cron/graph-sync-process` is out of scope unless a feature directly changes that route, because `CRON_SECRET` is not currently set locally.
- Browser automation is not the primary mission surface; automated tests and the live local graph script are the authoritative checks.

## Validation Concurrency

- **Targeted Node test commands:** max concurrent validators `3`
  - Rationale: dry run on a 10-core machine showed targeted built-in-node test runs were lightweight and left sufficient headroom.
- **Live graph script:** max concurrent validators `1`
  - Rationale: shared Falkor/Supabase queue state makes concurrent runs noisy and less trustworthy.
- **Lightweight browser/reachability checks:** max concurrent validators `5`
  - Rationale: inspection-only checks are inexpensive, but they are secondary for this mission.

## Runtime Notes

- The dry run proved the main validation path is executable: targeted Falkor tests passed and the live graph script completed in Falkor mode with fresh data.
- Use graph queries or the live script to prove duplicate-node/duplicate-edge absence when a feature changes reconciliation behavior.
- Prefer assertions on stable machine-readable fields for any new graph health or fallback observability surface.
