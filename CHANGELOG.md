# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `sync`: read-only pull of issues, PRs and labels through the One CLI, incremental via `since`.
- `triage`: duplicate detection with local embeddings, labels restricted to the repo's own set, drafted replies, with a keyword-rules fallback when LM Studio isn't running.
- Approval flow: `queue`, `apply`, `skip`, `digest` (optionally to Slack through One) and a loopback-only, token-protected approval desk.
- Offline benchmark (`npm run bench`) on 30 synthetic issues, an agent skill (`skill/SKILL.md`) and `AGENTS.md`.
- Project scaffold: MIT licence, README, contributing guide, code of conduct, security policy, issue and PR templates, CI (lint, audit, test, build on Ubuntu and Windows).
