# repo-desk

A GitHub maintainer's desk that runs on [One](https://www.withone.ai) and a model on your own GPU: it finds duplicate issues, suggests labels and drafts replies. You approve every write.

> **Status: in development (v0.1).** The commands below land in the next PRs. This README is completed with the full quick start before the first release.

## What it will do
- **Sync** issues and PRs from the repos you list, read-only, through the One CLI (no GitHub token in this repo).
- **Triage** each one on your machine with LM Studio: duplicates from embeddings, labels from your repo's own label set, and a drafted reply.
- **Desk**: a local page where you Apply, Edit or Skip each suggestion. Agents can do the same with `--json`.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security
See [SECURITY.md](SECURITY.md). Don't open public issues for vulnerabilities.

## License
MIT, see [LICENSE](LICENSE).
