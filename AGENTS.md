# AGENTS.md

Notes for coding agents working on this repo.

- **Stack:** TypeScript on Node 22+, ESM, zero runtime dependencies. Tests use vitest.
- **Check before you push:** `npm run lint && npm test && npm run build`.
- **Layout:**
  - `src/one.ts`: the only place the One CLI is spawned (no shell, argv only).
  - `src/actions.ts`: the only place GitHub writes are made (`apply`).
  - `src/desk.ts`: the loopback approval page.
  - `src/triage.ts` and `src/lm.ts`: suggestions.
- **Tests never touch the network.** Use `test/fixtures/fake-one.mjs` for One and stub `fetch` for LM Studio.
- **Never add a write path that skips `apply`.** Never send a GitHub token through repo-desk.
- **Keep it small:** PRs under about 400 changed lines, Conventional Commits.
- `npm run bench` must stay offline.
