import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Label } from "./one.js";

export interface Duplicate {
  number: number;
  title: string;
  score: number;
}

export interface Suggestion {
  labels: string[];
  duplicates: Duplicate[];
  needsInfo: boolean;
  reply: string;
  mode: "local" | "fallback";
  triagedAt: string;
}

export type Status = "new" | "suggested" | "applied" | "skipped";

export interface Item {
  repo: string;
  number: number;
  title: string;
  body: string;
  isPr: boolean;
  state: string;
  labels: string[];
  author: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  embedding?: number[];
  suggestion?: Suggestion;
}

export interface RepoState {
  labels: Label[];
  syncedAt?: string;
  items: Record<string, Item>;
}

export interface State {
  version: 1;
  repos: Record<string, RepoState>;
}

const file = (home: string) => join(home, "state.json");

export function loadState(home: string): State {
  if (!existsSync(file(home))) return { version: 1, repos: {} };
  return JSON.parse(readFileSync(file(home), "utf8"));
}

export function saveState(home: string, state: State): void {
  mkdirSync(home, { recursive: true });
  const tmp = `${file(home)}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file(home));
}

export const itemId = (i: Pick<Item, "repo" | "number">) => `${i.repo}#${i.number}`;

export function findItem(state: State, id: string): Item {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(id);
  const item = m && state.repos[m[1]!]?.items[m[2]!];
  if (!item) throw new Error(`No item "${id}". Use the id from \`repo-desk queue\`, e.g. owner/repo#12`);
  return item;
}

export const allItems = (state: State) => Object.values(state.repos).flatMap((r) => Object.values(r.items));
