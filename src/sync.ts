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
  // First sync: newest first, capped at `limit`. Later syncs: oldest change first, so hitting the cap can never skip
  // items; the next run carries on from the last change we saw.
  const incremental = !!r.syncedAt;
  const direction = incremental ? "asc" : "desc";
  let lastSeen = r.syncedAt;
  let more = false;
  for (let page = 1; res.fetched < limit; page++) {
    const batch = await gh.listIssues(repo, { since: r.syncedAt, direction, page, perPage });
    const take = batch.slice(0, limit - res.fetched);
    if (take.length < batch.length) more = true; // the cap cut this page short
    for (const raw of take) {
      const prev = r.items[raw.number];
      const next = toItem(repo, raw, prev);
      if (!prev) res.added++;
      else if (prev.updatedAt !== next.updatedAt) res.changed++;
      r.items[raw.number] = next;
      res.fetched++;
      if (!lastSeen || raw.updatedAt > lastSeen) lastSeen = raw.updatedAt;
    }
    if (batch.length < perPage) break;
    if (res.fetched >= limit) more = true;
  }
  // `since` is inclusive, so resuming at the last updatedAt re-reads at most the boundary items.
  r.syncedAt = incremental && more ? lastSeen : startedAt;
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
