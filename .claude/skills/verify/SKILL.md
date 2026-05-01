---
name: verify
description: Run full lint and test suite to verify changes are clean
---

# Verify

Run the full lint and test suite to verify the current state of the codebase is clean.

## Steps

1. Run `npm run lint` — report any lint errors with file/line references
2. Run `npm run test` — report any test failures with details
3. If both pass, confirm all checks are green
4. If either fails, report the failures clearly and suggest fixes
