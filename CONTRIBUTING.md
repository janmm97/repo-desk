# Contributing to repo-desk

Thanks for helping! Small, focused changes are the easiest to review.

## Setup

You need Node.js 22+. LM Studio and the One CLI are only needed to run repo-desk for real; the tests use a fake `one` script and a fake model server, so they need no keys, no network and no GPU.

```sh
git clone <your fork>
cd repo-desk
npm install
npm test        # unit tests (fake One CLI, fake LM Studio)
npm run lint    # type check
npm run build   # compiles to dist/
```

## How we work

- **Open an issue first** for anything bigger than a bug fix, so we can agree on the approach.
- Branch from `main`, keep PRs small (ideally under ~400 changed lines).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.
- Keep the scope tight: repo-desk **suggests**, a person approves. Nothing may write to GitHub or Slack except `apply` and `digest --slack`, and only when the user runs them.
- No runtime dependencies unless there's no reasonable way around it.
- Every call to an app goes through the One CLI. Never add code that reads or stores a GitHub or Slack token.

## PR checklist

- [ ] Tests added or updated, and `npm test` passes
- [ ] `npm run lint` passes
- [ ] README updated if behaviour or options changed
- [ ] `CHANGELOG.md` entry under `## [Unreleased]`

## Reviews

A maintainer reviews every PR. CI (lint, test, build) must be green before merge. Changes to `apply`, the desk server or the One wrapper get an extra look.

## Questions

Open an issue with the `question` label.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).
