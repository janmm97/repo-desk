#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { apply, digest, queue, skip, type Decision } from "./actions.js";
import { startDesk } from "./desk.js";
import { GitHub, makeRunOne, resolveKey, slackPost, type RunOne } from "./one.js";
import { findItem, loadState, saveState } from "./store.js";
import { syncRepo } from "./sync.js";
import { LocalModel } from "./lm.js";
import { triageRepo } from "./triage.js";

const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export const HELP = `repo-desk ${VERSION}: GitHub triage on One + a local model. You approve every write.

Usage: repo-desk <command> [options]

Commands:
  sync [--limit N] Pull issues and PRs from REPOS through One (read-only)
  triage [--limit N] [--no-model]
                   Suggest labels, duplicates and a reply for new open items
                   (local LM Studio model; keyword rules when it isn't running)
  queue [--json]   List suggestions waiting for your decision
  apply <id> [--labels a,b] [--reply TEXT | --no-reply]
                   Approve: add the labels and post the reply through One
  skip <id>        Dismiss a suggestion; nothing is written
  digest [--slack CHANNEL]
                   Summary of the queue (to Slack through One if asked)
  desk             Open the approval desk on http://127.0.0.1:DESK_PORT
  run              sync + triage + desk
  help             Show this help
  version          Print the version

<id> looks like owner/repo#12.

Config comes from env or .env (see .env.example).
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function sync(argv: string[], deps: Deps): Promise<number> {
  const cfg = loadConfig(deps.env);
  if (!cfg.repos.length) {
    console.error("Set REPOS to a comma-separated list of owner/repo (see .env.example).");
    return 2;
  }
  const limit = Number(flag(argv, "--limit") ?? 200);
  const key = await resolveKey(deps.run, "github", deps.env.ONE_GITHUB_KEY);
  const gh = new GitHub(deps.run, key);
  const state = loadState(cfg.home);
  for (const repo of cfg.repos) {
    const r = await syncRepo(gh, state, repo, limit);
    saveState(cfg.home, state);
    console.log(`${repo}: ${r.fetched} fetched, ${r.added} new, ${r.changed} updated`);
  }
  return 0;
}

async function triage(argv: string[], deps: Deps): Promise<number> {
  const cfg = loadConfig(deps.env);
  const state = loadState(cfg.home);
  const repos = Object.keys(state.repos).filter((r) => !cfg.repos.length || cfg.repos.includes(r));
  if (!repos.length) {
    console.error("Nothing synced yet. Run `repo-desk sync` first.");
    return 2;
  }
  let lm: LocalModel | undefined = new LocalModel(cfg);
  if (argv.includes("--no-model") || !(await lm.available())) {
    if (!argv.includes("--no-model")) console.error(`LM Studio not reachable at ${cfg.lmUrl} with ${cfg.chatModel}: using keyword rules.`);
    lm = undefined;
  }
  const limit = flag(argv, "--limit") ? Number(flag(argv, "--limit")) : undefined;
  for (const repo of repos) {
    const n = await triageRepo(state.repos[repo]!, {
      lm,
      threshold: cfg.dupThreshold,
      limit,
      onItem: (i, ms) => {
        saveState(cfg.home, state);
        const s = i.suggestion!;
        console.log(`${repo}#${i.number} [${s.labels.join(", ") || "-"}]${s.duplicates.length ? ` dup? ${s.duplicates.map((d) => `#${d.number}`).join(" ")}` : ""}${s.needsInfo ? " needs-info" : ""} (${(ms / 1000).toFixed(1)}s)`);
      },
    });
    saveState(cfg.home, state);
    console.log(`${repo}: ${n} suggested (${lm ? "local model" : "keyword rules"})`);
  }
  return 0;
}

async function github(deps: Deps): Promise<GitHub> {
  return new GitHub(deps.run, await resolveKey(deps.run, "github", deps.env.ONE_GITHUB_KEY));
}

const inFlight = new Set<string>();

/** The one place GitHub writes happen; reused by the CLI and the desk. */
async function applyAndSave(deps: Deps, id: string, d: Decision) {
  if (inFlight.has(id)) throw new Error(`${id} is already being applied`);
  inFlight.add(id);
  try {
    const cfg = loadConfig(deps.env);
    const gh = await github(deps);
    const state = loadState(cfg.home);
    const res = await apply(gh, state, id, d);
    // The writes took seconds; a sync or triage may have saved meanwhile. Re-read, so we don't overwrite it.
    const fresh = loadState(cfg.home);
    const done = findItem(state, id);
    Object.assign(findItem(fresh, id), { status: done.status, labels: done.labels });
    saveState(cfg.home, fresh);
    return res;
  } finally {
    inFlight.delete(id);
  }
}

async function review(cmd: string, argv: string[], deps: Deps): Promise<number> {
  const cfg = loadConfig(deps.env);
  const state = loadState(cfg.home);
  const [id] = argv;
  if (cmd === "queue") {
    const q = queue(state);
    if (argv.includes("--json")) console.log(JSON.stringify(q, null, 2));
    else console.log(digest(state));
    return 0;
  }
  if (cmd === "digest") {
    const text = digest(state);
    const channel = flag(argv, "--slack");
    if (!channel) console.log(text);
    else {
      await slackPost(deps.run, await resolveKey(deps.run, "slack", deps.env.ONE_SLACK_KEY), channel, text);
      console.log(`Posted the digest to ${channel}.`);
    }
    return 0;
  }
  if (!id) {
    console.error(`Usage: repo-desk ${cmd} <owner/repo#number>`);
    return 2;
  }
  if (cmd === "skip") {
    skip(state, id);
    saveState(cfg.home, state);
    console.log(`Skipped ${id}.`);
    return 0;
  }
  const labels = flag(argv, "--labels")?.split(",").map((l) => l.trim()).filter(Boolean);
  const reply = argv.includes("--no-reply") ? "" : flag(argv, "--reply");
  const res = await applyAndSave(deps, id, { labels, reply });
  console.log(`Applied ${id}: ${res.labels.length ? `labels ${res.labels.join(", ")}` : "no new labels"}${res.replied ? ", reply posted" : ""}.`);
  return 0;
}

async function desk(deps: Deps): Promise<number> {
  const cfg = loadConfig(deps.env);
  const { url } = await startDesk(
    {
      queue: () => queue(loadState(cfg.home)),
      apply: (id, d) => applyAndSave(deps, id, d),
      skip: (id) => {
        const state = loadState(cfg.home);
        skip(state, id);
        saveState(cfg.home, state);
      },
    },
    cfg.port,
  );
  console.log(`Desk running. Open (keep this link private, it carries the session token):\n${url}\nCtrl+C to stop.`);
  return new Promise(() => {}); // runs until Ctrl+C
}

export interface Deps {
  env: NodeJS.ProcessEnv;
  run: RunOne;
}

export async function main(argv: string[], deps?: Partial<Deps>): Promise<number> {
  const env = deps?.env ?? process.env;
  const d: Deps = { env, run: deps?.run ?? makeRunOne(env) };
  const [cmd = "help"] = argv;
  try {
    if (cmd === "sync") return await sync(argv.slice(1), d);
    if (cmd === "triage") return await triage(argv.slice(1), d);
    if (["queue", "apply", "skip", "digest"].includes(cmd)) return await review(cmd, argv.slice(1), d);
    if (cmd === "desk") return await desk(d);
    if (cmd === "run") {
      const code = (await sync([], d)) || (await triage([], d));
      return code || (await desk(d));
    }
  } catch (e) {
    console.error(`repo-desk: ${(e as Error).message}`);
    return 1;
  }
  if (cmd === "version" || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return 0;
  }
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  return 2;
}

function isEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: env vars only
  }
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
