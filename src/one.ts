import { spawn } from "node:child_process";
import { join } from "node:path";

/** One action IDs used by repo-desk (from `one --agent actions find`). */
export const ACTIONS = {
  listIssues: "conn_mod_def::GGSOic6uEEo::A_3LU8MRTcGy0ffpu4XQvQ",
  listLabels: "conn_mod_def::GJ3ZRTC-6SU::tpsAtaj3RFG4gw_G1xnOaQ",
  addLabels: "conn_mod_def::GJ3ZNuIIVYo::1SpAz8xPSNKDRW1hqEtr-Q",
  comment: "conn_mod_def::GJ3ZOoc4oFA::UOz67P0HTeaVbBehDxsQSA",
  slackPost: "conn_mod_def::GJ7H84zBlaI::BCfuA16aTaGVIax5magsLA",
} as const;

/** A hung One call must not hang the desk or a sync forever. */
const ONE_TIMEOUT_MS = 120_000;

export type RunOne = (args: string[]) => Promise<any>;

/** How to start the One CLI without a shell, so issue text can never reach a command line parser. */
export function oneCommand(env: NodeJS.ProcessEnv = process.env): { cmd: string; pre: string[] } {
  const bin = env.ONE_BIN;
  if (bin) return /\.[cm]?js$/.test(bin) ? { cmd: process.execPath, pre: [bin] } : { cmd: bin, pre: [] };
  if (process.platform === "win32" && env.APPDATA) {
    // `one` is a .cmd shim on Windows, which can't be spawned without a shell.
    return { cmd: process.execPath, pre: [join(env.APPDATA, "npm", "node_modules", "@withone", "cli", "bin", "cli.js")] };
  }
  return { cmd: "one", pre: [] };
}

export function makeRunOne(env: NodeJS.ProcessEnv = process.env): RunOne {
  const { cmd, pre } = oneCommand(env);
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, [...pre, "--agent", ...args], { env, shell: false, windowsHide: true, timeout: ONE_TIMEOUT_MS });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => reject(new Error(`Could not start the One CLI (${e.message}). Install it with: npm i -g @withone/cli, or set ONE_BIN to the CLI entry.`)));
      child.on("close", (code, signal) => {
        if (signal) return reject(new Error(`One CLI was stopped (${signal}) after ${ONE_TIMEOUT_MS / 1000}s without finishing`));
        let json: any;
        try {
          json = JSON.parse(out || err);
        } catch {
          return reject(new Error(`One CLI exited ${code}: ${(err || out).trim().slice(0, 500)}`));
        }
        if (code !== 0 || json?.error) return reject(new Error(`One CLI: ${String(json?.error ?? `exit ${code}`).slice(0, 500)}`));
        resolve(json);
      });
    });
}

/** Picks the connection key from env, or the only connection for that platform. */
export async function resolveKey(run: RunOne, platform: "github" | "slack", fromEnv?: string): Promise<string> {
  if (fromEnv) return fromEnv;
  const list = await run(["list", "--limit", "1000"]);
  const keys: string[] = (list.connections ?? []).filter((c: any) => c.platform === platform).map((c: any) => c.key);
  if (keys.length === 1) return keys[0]!;
  const envName = platform === "github" ? "ONE_GITHUB_KEY" : "ONE_SLACK_KEY";
  if (keys.length === 0) throw new Error(`No ${platform} connection in One. Run: one add ${platform}`);
  throw new Error(`You have ${keys.length} ${platform} connections in One. Set ${envName} to the one to use.`);
}

export interface Label {
  name: string;
  description: string;
}

export interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  isPullRequest: boolean;
  labels: { name: string }[];
  author?: { login: string };
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

const split = (repo: string) => {
  const [owner, name] = repo.split("/");
  return { owner: owner!, repo: name! };
};

export class GitHub {
  constructor(private run: RunOne, private key: string) {}

  private exec(action: string, opts: { path?: object; query?: object; body?: object; write?: boolean }) {
    const args = ["actions", "execute", "github", action, this.key];
    if (opts.path) args.push("--path-vars", JSON.stringify(opts.path));
    if (opts.query) args.push("--query-params", JSON.stringify(opts.query));
    if (opts.body) args.push("-d", JSON.stringify(opts.body));
    if (opts.write) args.push("--confirm-write");
    return this.run(args).then((r) => r.response);
  }

  /** Read-only, but One exposes it as POST, so the CLI wants --confirm-write. */
  listIssues(repo: string, q: { since?: string; direction?: "asc" | "desc"; page: number; perPage: number }): Promise<RawIssue[]> {
    const body = { connectionKey: this.key, ...split(repo), state: "all", sort: "updated", direction: "desc", ...q };
    if (!body.since) delete body.since;
    return this.exec(ACTIONS.listIssues, { body, write: true });
  }

  async listLabels(repo: string): Promise<Label[]> {
    const res = await this.exec(ACTIONS.listLabels, { path: split(repo), query: { per_page: 100 } });
    return (res ?? []).map((l: any) => ({ name: String(l.name), description: String(l.description ?? "") }));
  }

  addLabels(repo: string, issueNumber: number, labels: string[]) {
    return this.exec(ACTIONS.addLabels, { path: { ...split(repo), issueNumber }, body: { labels }, write: true });
  }

  comment(repo: string, issueNumber: number, body: string) {
    return this.exec(ACTIONS.comment, { path: { ...split(repo), issueNumber }, body: { body }, write: true });
  }
}

export function slackPost(run: RunOne, key: string, channel: string, text: string) {
  return run(["actions", "execute", "slack", ACTIONS.slackPost, key, "-d", JSON.stringify({ channel, text }), "--confirm-write"]);
}
