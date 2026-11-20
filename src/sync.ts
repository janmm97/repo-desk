import type { GitHub, RawIssue } from "./one.js";
import type { Item, State } from "./store.js";

export interface SyncResult {
  repo: string;
  fetched: number;
  added: number;
  changed: number;
}

/** Pulls issues and PRs updated since the last sync (newest first, up to `limit`). Read-only. */
export async function syncRepo(gh: GitHub, state: State, repo: string, limit = 200): Promise<SyncResult> {
  const r = (state.repos[repo] ??= { labels: [], items: {} });
  const startedAt = new Date().toISOString();
  r.labels = await gh.listLabels(repo);

  const perPage = Math.min(100, limit);
  const res: SyncResult = { repo, fetched: 0, added: 0, changed: 0 };
  for (let page = 1; res.fetched < limit; page++) {
    const batch = await gh.listIssues(repo, { since: r.syncedAt, page, perPage });
    for (const raw of batch.slice(0, limit - res.fetched)) {
      const prev = r.items[raw.number];
      const next = toItem(repo, raw, prev);
      if (!prev) res.added++;
      else if (prev.updatedAt !== next.updatedAt) res.changed++;
      r.items[raw.number] = next;
      res.fetched++;
    }
    if (batch.length < perPage) break;
  }
  r.syncedAt = startedAt;
  return res;
}

function toItem(repo: string, raw: RawIssue, prev?: Item): Item {
  const item: Item = {
    repo,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    isPr: raw.isPullRequest,
    state: raw.state,
    labels: raw.labels.map((l) => l.name),
    author: raw.author?.login ?? "",
    url: raw.htmlUrl,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    status: prev?.status ?? "new",
    embedding: prev?.embedding,
    suggestion: prev?.suggestion,
  };
  // Text changed: the old embedding and suggestion no longer fit.
  if (prev && (prev.title !== item.title || prev.body !== item.body)) {
    delete item.embedding;
    if (item.status === "suggested") {
      delete item.suggestion;
      item.status = "new";
    }
  }
  return item;
}
