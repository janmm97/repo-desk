import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { ACTIONS, type RunOne } from "../src/one.js";
import { loadState, saveState, type Item, type State } from "../src/store.js";

const item = (number: number, extra: Partial<Item> = {}): Item => ({
  repo: "o/r", number, title: `t${number}`, body: "", isPr: false, state: "open", labels: [], author: "a",
  url: "", createdAt: "", updatedAt: "", status: "new", ...extra,
});

describe("apply does not clobber state saved while it was writing", () => {
  it("keeps items a concurrent sync added", async () => {
    const home = mkdtempSync(join(tmpdir(), "repo-desk-"));
    const state: State = {
      version: 1,
      repos: { "o/r": { labels: [{ name: "bug", description: "" }], items: { 1: item(1, { status: "suggested", suggestion: { labels: ["bug"], duplicates: [], needsInfo: false, reply: "", mode: "fallback", triagedAt: "" } }) } } },
    };
    saveState(home, state);
    const run: RunOne = vi.fn(async (args: string[]) => {
      if (args[0] === "list") return { connections: [{ platform: "github", key: "k" }] };
      if (args[3] === ACTIONS.addLabels) {
        // a `sync` in another process saves a new item while we wait on One
        const other = loadState(home);
        other.repos["o/r"]!.items[2] = item(2);
        saveState(home, other);
      }
      return { response: {} };
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["apply", "o/r#1"], { env: { REPO_DESK_HOME: home }, run })).toBe(0);
    log.mockRestore();
    const after = loadState(home).repos["o/r"]!.items;
    expect(after[1]).toMatchObject({ status: "applied", labels: ["bug"] });
    expect(after[2]).toBeDefined();
  });
});
