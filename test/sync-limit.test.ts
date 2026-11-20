import { expect, test } from "vitest";
import type { GitHub, RawIssue } from "../src/one.js";
import type { State } from "../src/store.js";
import { syncRepo } from "../src/sync.js";

const at = (n: number) => new Date(Date.UTC(2026, 10, 20, 0, 0, n)).toISOString();
const all: RawIssue[] = Array.from({ length: 180 }, (_, k) => ({
  number: k + 1, title: `t${k}`, body: "", state: "open", isPullRequest: false, labels: [], htmlUrl: "x", createdAt: at(k), updatedAt: at(k),
}));
const gh = {
  listLabels: async () => [],
  listIssues: async (_repo: string, q: { since?: string; direction?: string; page: number; perPage: number }) => {
    const rows = all.filter((i) => !q.since || i.updatedAt >= q.since);
    if (q.direction !== "asc") rows.reverse();
    return rows.slice((q.page - 1) * q.perPage, q.page * q.perPage);
  },
} as unknown as GitHub;

test("incremental sync resumes when --limit cuts the last page short", async () => {
  const state: State = { version: 1, repos: { "x/y": { labels: [], items: {}, syncedAt: "2026-01-01T00:00:00.000Z" } } };
  await syncRepo(gh, state, "x/y", 150);
  await syncRepo(gh, state, "x/y", 150);
  expect(Object.keys(state.repos["x/y"]!.items)).toHaveLength(180);
});
