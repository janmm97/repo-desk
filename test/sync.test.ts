import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { ACTIONS, GitHub, makeRunOne, oneCommand, resolveKey, type RunOne } from "../src/one.js";
import { findItem, loadState, saveState, type State } from "../src/store.js";
import { syncRepo } from "../src/sync.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-one.mjs", import.meta.url));
const KEY = "live::github::default::test";

const issue = (number: number, extra: object = {}) => ({
  number,
  title: `Issue ${number}`,
  body: `body ${number}`,
  state: "open",
  isPullRequest: false,
  labels: [{ name: "bug" }],
  author: { login: "someone" },
  htmlUrl: `https://github.com/o/r/issues/${number}`,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
  ...extra,
});

let dir: string;
let env: NodeJS.ProcessEnv;
const setData = (d: object) => writeFileSync(env.FAKE_ONE_DATA!, JSON.stringify(d));
const calls = () =>
  readFileSync(env.FAKE_ONE_LOG!, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as string[]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-desk-"));
  env = {
    ONE_BIN: FAKE,
    FAKE_ONE_DATA: join(dir, "data.json"),
    FAKE_ONE_LOG: join(dir, "calls.log"),
    REPO_DESK_HOME: join(dir, "home"),
    REPOS: "o/r",
  };
  writeFileSync(env.FAKE_ONE_LOG!, "");
});

describe("config", () => {
  it("rejects a repo that is not owner/repo", () => {
    expect(() => loadConfig({ REPOS: "o/r, bad; rm -rf" })).toThrow(/not owner\/repo/);
  });
  it("splits REPOS and trims the LM Studio URL", () => {
    const c = loadConfig({ REPOS: "a/b, c/d", LMSTUDIO_URL: "http://x:1/v1/" });
    expect(c.repos).toEqual(["a/b", "c/d"]);
    expect(c.lmUrl).toBe("http://x:1/v1");
  });
});

describe("one wrapper", () => {
  it("runs a .js ONE_BIN with node, never through a shell", () => {
    expect(oneCommand({ ONE_BIN: "/x/cli.js" })).toEqual({ cmd: process.execPath, pre: ["/x/cli.js"] });
    expect(oneCommand({ ONE_BIN: "/usr/bin/one" })).toEqual({ cmd: "/usr/bin/one", pre: [] });
  });

  it("passes issue text as one argv entry, untouched", async () => {
    setData({ responses: { [ACTIONS.comment]: { id: 1 } } });
    const evil = 'hi" & del /q * & echo "$(rm -rf ~)`whoami`';
    await new GitHub(makeRunOne(env), KEY).comment("o/r", 3, evil);
    const argv = calls()[0]!;
    expect(argv).toContain("--confirm-write");
    expect(JSON.parse(argv[argv.indexOf("-d") + 1]!)).toEqual({ body: evil });
  });

  it("turns a One error into a thrown error", async () => {
    setData({ fail: "connection not found" });
    await expect(new GitHub(makeRunOne(env), KEY).listLabels("o/r")).rejects.toThrow(/connection not found/);
  });

  it("picks the only github connection, or asks for ONE_GITHUB_KEY", async () => {
    const run = makeRunOne(env);
    setData({ connections: [{ platform: "github", key: KEY }, { platform: "slack", key: "s" }] });
    expect(await resolveKey(run, "github")).toBe(KEY);
    setData({ connections: [{ platform: "github", key: "a" }, { platform: "github", key: "b" }] });
    await expect(resolveKey(run, "github")).rejects.toThrow(/ONE_GITHUB_KEY/);
    setData({ connections: [] });
    await expect(resolveKey(run, "github")).rejects.toThrow(/one add github/);
    expect(await resolveKey(run, "github", "from-env")).toBe("from-env");
  });
});

describe("sync", () => {
  const fakeGh = (pages: object[][]) => {
    const run: RunOne = vi.fn(async (args: string[]) => {
      if (args[3] === ACTIONS.listLabels) return { response: [{ name: "bug", description: "Broken" }] };
      const body = JSON.parse(args[args.indexOf("-d") + 1]!);
      return { response: pages[body.page - 1] ?? [] };
    });
    return { gh: new GitHub(run, KEY), run };
  };

  it("pages until a short page and respects --limit", async () => {
    const full = Array.from({ length: 100 }, (_, i) => issue(i + 1));
    const { gh, run } = fakeGh([full, [issue(101)]]);
    const state: State = { version: 1, repos: {} };
    expect(await syncRepo(gh, state, "o/r")).toMatchObject({ fetched: 101, added: 101 });
    expect(run).toHaveBeenCalledTimes(3); // labels + 2 pages

    const small: State = { version: 1, repos: {} };
    expect((await syncRepo(fakeGh([full]).gh, small, "o/r", 5)).fetched).toBe(5);
  });

  it("asks only for changes since the last sync and resets stale suggestions", async () => {
    const state: State = { version: 1, repos: {} };
    await syncRepo(fakeGh([[issue(1)]]).gh, state, "o/r");
    const item = state.repos["o/r"]!.items[1]!;
    item.status = "suggested";
    item.embedding = [1, 2];
    item.suggestion = { labels: ["bug"], duplicates: [], needsInfo: false, reply: "", mode: "local", triagedAt: "" };

    const lastSync = state.repos["o/r"]!.syncedAt;
    const { gh, run } = fakeGh([[issue(1, { body: "edited", updatedAt: "2026-11-03T00:00:00Z" })]]);
    expect(await syncRepo(gh, state, "o/r")).toMatchObject({ added: 0, changed: 1 });
    const args: string[] = (run as any).mock.calls[1][0];
    expect(lastSync).toBeTruthy();
    expect(JSON.parse(args[args.indexOf("-d") + 1]!).since).toBe(lastSync);
    const after = state.repos["o/r"]!.items[1]!;
    expect(after).toMatchObject({ body: "edited", status: "new" });
    expect(after.embedding).toBeUndefined();
    expect(after.suggestion).toBeUndefined();
  });

  it("keeps an applied item's status when only metadata changes", async () => {
    const state: State = { version: 1, repos: {} };
    await syncRepo(fakeGh([[issue(1)]]).gh, state, "o/r");
    state.repos["o/r"]!.items[1]!.status = "applied";
    await syncRepo(fakeGh([[issue(1, { state: "closed" })]]).gh, state, "o/r");
    expect(state.repos["o/r"]!.items[1]).toMatchObject({ status: "applied", state: "closed" });
  });
});

describe("store", () => {
  it("round-trips state and finds items by owner/repo#n", () => {
    const home = join(dir, "h");
    const state: State = { version: 1, repos: { "o/r": { labels: [], items: { 7: issue(7) as any } } } };
    saveState(home, state);
    expect(findItem(loadState(home), "o/r#7").number).toBe(7);
    expect(() => findItem(loadState(home), "o/r#8")).toThrow(/No item/);
    expect(loadState(join(dir, "empty"))).toEqual({ version: 1, repos: {} });
  });
});

describe("cli sync", () => {
  it("syncs REPOS through the One CLI and writes state", async () => {
    setData({
      connections: [{ platform: "github", key: KEY }],
      responses: {
        [ACTIONS.listLabels]: [{ name: "bug", description: "Broken" }],
        [ACTIONS.listIssues]: { pages: [[issue(1), issue(2, { isPullRequest: true })]] },
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["sync"], { env })).toBe(0);
    expect(log).toHaveBeenCalledWith("o/r: 2 fetched, 2 new, 0 updated");
    const state = loadState(env.REPO_DESK_HOME!);
    expect(state.repos["o/r"]!.labels).toEqual([{ name: "bug", description: "Broken" }]);
    expect(state.repos["o/r"]!.items[2]).toMatchObject({ isPr: true, status: "new", author: "someone" });
    log.mockRestore();
  });

  it("explains a missing REPOS instead of crashing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["sync"], { env: { ...env, REPOS: "" } })).toBe(2);
    err.mockRestore();
  });
});
