---
name: verify-quick
description: Run fast tests only (no lint) for quick feedback during development
---

# Verify Quick

Run only the fast test suite for quick feedback during development. Skips lint.

## Steps

1. Run `npm run test:unit` — the fastest test subset
2. Report any failures with details
3. If all pass, confirm tests are green
