import type { GitHub } from "./one.js";
import { allItems, findItem, itemId, type Item, type State } from "./store.js";
import { cleanReply } from "./triage.js";

export interface QueueEntry {
  id: string;
  url: string;
  title: string;
  isPr: boolean;
  author: string;
  current: string[];
  allowed: string[];
  suggestion: NonNullable<Item["suggestion"]>;
}

/** Items with a suggestion waiting for a human decision, oldest first. */
export function queue(state: State): QueueEntry[] {
  return allItems(state)
    .filter((i) => i.status === "suggested" && i.suggestion)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((i) => ({
      id: itemId(i),
      url: i.url,
      title: i.title,
      isPr: i.isPr,
      author: i.author,
      current: i.labels,
      allowed: state.repos[i.repo]!.labels.map((l) => l.name),
      suggestion: i.suggestion!,
    }));
}

export interface Decision {
  labels?: string[];
  reply?: string;
}

/**
 * Writes the approved labels and reply to GitHub through One. Only ever called on a person's explicit
 * approval (CLI `apply` or the desk's Apply button). Labels must exist in the repo; the reply is cleaned again.
 */
export async function apply(gh: GitHub, state: State, id: string, d: Decision = {}): Promise<{ labels: string[]; replied: boolean }> {
  const item = findItem(state, id);
  if (item.status !== "suggested" || !item.suggestion) throw new Error(`${id} has no pending suggestion (status: ${item.status})`);
  const allowed = new Set(state.repos[item.repo]!.labels.map((l) => l.name));
  const labels = (d.labels ?? item.suggestion.labels).filter((l) => allowed.has(l) && !item.labels.includes(l));
  const reply = cleanReply(d.reply ?? item.suggestion.reply);

  if (labels.length) await gh.addLabels(item.repo, item.number, labels);
  if (reply) await gh.comment(item.repo, item.number, reply);
  item.labels = [...item.labels, ...labels];
  item.status = "applied";
  return { labels, replied: !!reply };
}

export function skip(state: State, id: string): void {
  const item = findItem(state, id);
  if (item.status !== "suggested") throw new Error(`${id} has no pending suggestion (status: ${item.status})`);
  item.status = "skipped";
}

/** A short Markdown summary of what's waiting, for the terminal or Slack. */
export function digest(state: State): string {
  const q = queue(state);
  if (!q.length) return "repo-desk: nothing waiting for review.";
  const lines = [`repo-desk: ${q.length} waiting for review`];
  for (const e of q.slice(0, 20)) {
    const s = e.suggestion;
    const bits = [s.labels.length ? `labels: ${s.labels.join(", ")}` : "", s.duplicates.length ? `dup? ${s.duplicates.map((x) => `#${x.number}`).join(" ")}` : "", s.needsInfo ? "needs info" : ""];
    lines.push(`• <${e.url}|${e.id}> ${e.title.slice(0, 80)}${bits.some(Boolean) ? ` (${bits.filter(Boolean).join("; ")})` : ""}`);
  }
  if (q.length > 20) lines.push(`…and ${q.length - 20} more`);
  return lines.join("\n");
}
