# repo-desk

A GitHub maintainer's desk that runs on [One](https://www.withone.ai) and a model on your own GPU. It finds duplicate issues, suggests labels from your repo's own label set and drafts a reply. **Nothing is written to GitHub until you approve it.**

- **No GitHub token in this tool.** Every GitHub call goes through the One CLI, which holds your connection.
- **Your issues stay on your machine.** Triage runs on a local [LM Studio](https://lmstudio.ai) model. With no model running, repo-desk falls back to simple keyword rules.
- **Made for agents too.** Every command works headless, and `queue --json` gives an agent the same queue you see. See [skill/SKILL.md](skill/SKILL.md).

## Requirements

| | |
|---|---|
| Node.js | 22 or newer |
| One | A free account at [withone.ai](https://www.withone.ai) and the One CLI |
| LM Studio | Optional but recommended. 0.3+ with its local server on |
| GPU | Optional. The default models fit in 4 GB of VRAM (measured on an RTX 3050 Laptop) |

## Quick start

```sh
# 1. One: sign up at withone.ai, then install the CLI, log in and connect GitHub
npm install -g @withone/cli
one init
one add github            # opens the browser to connect your GitHub account

# 2. repo-desk
git clone https://github.com/janmm97/repo-desk && cd repo-desk
npm ci && npm run build
cp .env.example .env      # set REPOS=you/your-repo

# 3. Local model (optional): download the chat model and start the server
#    (LM Studio ships with the nomic-embed-text-v1.5 embedding model)
lms get qwen/qwen3.5-4b
lms server start

# 4. Go
npm run desk              # sync + triage + open the approval desk
```

The desk prints a link like `http://127.0.0.1:4317/#token=…`. Open it, then for each item click **Apply** (with any edits), or **Skip**.

## Commands

```
repo-desk sync [--limit N]            Pull issues and PRs from REPOS through One (read-only)
repo-desk triage [--limit N] [--no-model]
                                      Suggest labels, duplicates and a reply for new open items
repo-desk queue [--json]              List suggestions waiting for a decision
repo-desk apply <id> [--labels a,b] [--reply TEXT | --no-reply]
                                      Add the labels and post the reply through One
repo-desk skip <id>                   Dismiss a suggestion; nothing is written
repo-desk digest [--slack CHANNEL]    Queue summary, optionally posted to Slack through One
repo-desk desk                        Open the approval desk on 127.0.0.1
repo-desk run                         sync + triage + desk
```

`<id>` looks like `owner/repo#12`. Configuration comes from env vars or `.env`; every option is listed in [.env.example](.env.example).

## How it works

1. **sync** calls One's *List Repository Issues* and *List Labels* actions. Only items changed since the last sync are fetched. State lives in `.repo-desk/state.json` (gitignored).
2. **triage** embeds each open item with the embedding model and flags earlier items above `DUP_THRESHOLD` (cosine, top 3) as possible duplicates. The chat model then picks labels. Its JSON schema only allows labels your repo already has, so it can't invent one. It also drafts a short reply.
3. **apply** is the only write. It calls *Add Labels* and *Create Issue Comment* through One, for one item, after you approve it.

## Security model

- **Untrusted input.** Issue text is treated as untrusted. It's passed to the model inside a marked block with an instruction to ignore what's in it. Output labels are filtered against your label set twice. Drafted replies have HTML comments stripped and `@mentions` defused before posting. The benchmark includes a prompt-injection issue (it's not followed).
- **The desk.** It binds to `127.0.0.1` only and needs a random per-run token on every API call. It checks the `Host` header (against DNS rebinding) and only accepts JSON POSTs (against form CSRF). It serves a strict CSP and renders issue text without `innerHTML`.
- **Credentials.** repo-desk never sees your GitHub credentials; One does. Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Benchmark

`npm run bench` scores triage on [30 hand-written issues](bench/issues.json) for an imaginary CLI. It includes 10 duplicate pairs and one prompt-injection attempt. The benchmark runs fully offline: no GitHub, no One.

| Mode | Label precision | Label recall | Exact label set | Duplicate pairs found | False duplicate flags | Injection followed | Median s / issue |
|---|---|---|---|---|---|---|---|
| Keyword rules (`--no-model`) | 94% | 55% | 53% | 0 / 10 | 0 / 10 | no | < 0.01 |

The issues are synthetic and few, so treat the numbers as a smoke test, not a leaderboard. Measured on Windows 11 with an RTX 3050 Laptop GPU (4 GB).

## Limits (v0.1)

- **The keyword fallback is weak.** It misses most duplicates. It also mislabels bot PRs (a Dependabot bump gets `documentation`). Run a local model for real use.
- **One reply per item.** No threads or follow-ups, and repo-desk never closes, assigns or locks anything.
- **Small repos first.** `sync` fetches at most `--limit` items (default 200) per run.
- **English prompts.** Other languages may work but aren't tested.
- **Windows.** repo-desk looks for the One CLI under `%APPDATA%
pm`. If you installed Node with nvm-windows, Volta or pnpm, set `ONE_BIN` to the CLI entry (`…@withoneibini.js`).
- **Local model path is unmeasured end to end.** The numbers above are keyword mode. Run `npm run bench` with LM Studio up to get your own.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT, see [LICENSE](LICENSE).
