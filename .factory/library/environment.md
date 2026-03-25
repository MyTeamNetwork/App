# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

- Falkor mission work assumes the existing local Falkor container is available on `127.0.0.1:6379` and Falkor Browser is available on `127.0.0.1:3001`.
- The repo already has working Supabase/test configuration for targeted Falkor tests and `scripts/test-falkor-local.ts`.
- `FALKOR_ENABLED=true` and Falkor host configuration are already present locally per planning dry-run results.
- `CRON_SECRET` is currently missing locally. This is an accepted limitation for the mission; do not block on authenticated HTTP cron-route checks unless a feature directly changes that route.
- The preferred local live validation command is `node --loader ./tests/ts-loader.js scripts/test-falkor-local.ts` because a local `tsx` binary is not currently available.
