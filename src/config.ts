import { resolve } from "node:path";

export interface Config {
  repos: string[];
  home: string;
  lmUrl: string;
  chatModel: string;
  embedModel: string;
  dupThreshold: number;
  port: number;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const repos = (env.REPOS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  for (const r of repos) if (!REPO.test(r)) throw new Error(`REPOS: "${r}" is not owner/repo`);
  return {
    repos,
    home: resolve(cwd, env.REPO_DESK_HOME || ".repo-desk"),
    lmUrl: (env.LMSTUDIO_URL || "http://127.0.0.1:1234/v1").replace(/\/+$/, ""),
    chatModel: env.CHAT_MODEL || "qwen/qwen3.5-4b",
    embedModel: env.EMBED_MODEL || "text-embedding-nomic-embed-text-v1.5",
    dupThreshold: Number(env.DUP_THRESHOLD || 0.85),
    port: Number(env.DESK_PORT || 4317),
  };
}
