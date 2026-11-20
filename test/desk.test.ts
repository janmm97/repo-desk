import { request } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, digest, queue, skip } from "../src/actions.js";
import { startDesk } from "../src/desk.js";
import { ACTIONS, GitHub, type RunOne } from "../src/one.js";
import type { State } from "../src/store.js";

const state = (): State => ({
  version: 1,
  repos: {
    "o/r": {
      labels: [
        { name: "bug", description: "" },
        { name: "question", description: "" },
      ],
      items: {
        1: {
          repo: "o/r", number: 1, title: "Crash", body: "", isPr: false, state: "open", labels: ["question"], author: "a",
          url: "https://github.com/o/r/issues/1", createdAt: "2026-11-01", updatedAt: "", status: "suggested",
          suggestion: { labels: ["bug", "question"], duplicates: [{ number: 2, title: "Crash too", score: 0.9 }], needsInfo: true, reply: "Thanks! @x", mode: "local", triagedAt: "" },
        },
        2: {
          repo: "o/r", number: 2, title: "Crash too", body: "", isPr: false, state: "open", labels: [], author: "b",
          url: "", createdAt: "2026-11-02", updatedAt: "", status: "new",
        },
      },
    },
  },
});

const fakeGh = () => {
  const run = vi.fn<RunOne>(async () => ({ response: {} }));
  return { gh: new GitHub(run, "k"), run };
};
const sent = (run: ReturnType<typeof fakeGh>["run"]) =>
  run.mock.calls.map(([a]) => ({ action: a[3], path: JSON.parse(a[a.indexOf("--path-vars") + 1]!), body: JSON.parse(a[a.indexOf("-d") + 1]!) }));

describe("review actions", () => {
  it("queues only suggested items", () => {
    expect(queue(state()).map((e) => e.id)).toEqual(["o/r#1"]);
    expect(digest(state())).toMatch(/1 waiting[\s\S]*o\/r#1.*dup\? #2.*needs info/);
  });

  it("digest escapes Slack control sequences in titles", () => {
    const s = state();
    s.repos["o/r"]!.items[1]!.title = "<!channel> <https://evil.example|re-auth> & more";
    const d = digest(s);
    expect(d).toContain("&lt;!channel&gt; &lt;https://evil.example|re-auth&gt; &amp; more");
    expect(d).not.toContain("<!channel>");
  });

  it("apply writes only new, existing labels and a cleaned reply", async () => {
    const s = state();
    const { gh, run } = fakeGh();
    const res = await apply(gh, s, "o/r#1", { labels: ["bug", "question", "admin"], reply: "hi @team" });
    expect(res).toEqual({ labels: ["bug"], replied: true });
    expect(sent(run)).toEqual([
      { action: ACTIONS.addLabels, path: { owner: "o", repo: "r", issueNumber: 1 }, body: { labels: ["bug"] } },
      { action: ACTIONS.comment, path: { owner: "o", repo: "r", issueNumber: 1 }, body: { body: "hi @​team" } },
    ]);
    expect(s.repos["o/r"]!.items[1]).toMatchObject({ status: "applied", labels: ["question", "bug"] });
    await expect(apply(gh, s, "o/r#1")).rejects.toThrow(/no pending suggestion/);
  });

  it("an empty reply posts no comment; skip writes nothing", async () => {
    const s = state();
    const { gh, run } = fakeGh();
    await apply(gh, s, "o/r#1", { reply: "" });
    expect(sent(run).map((c) => c.action)).toEqual([ACTIONS.addLabels]);
    const t = state();
    skip(t, "o/r#1");
    expect(t.repos["o/r"]!.items[1]!.status).toBe("skipped");
    expect(() => skip(t, "o/r#2")).toThrow();
  });
});

describe("desk server", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  const call = (port: number, path: string, o: { method?: string; host?: string; token?: string; body?: object; type?: string } = {}) =>
    new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path, method: o.method ?? "GET", headers: { host: o.host ?? `127.0.0.1:${port}`, "x-desk-token": o.token ?? "", "content-type": o.type ?? "application/json" } },
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d)).on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.end(o.body ? JSON.stringify(o.body) : undefined);
    });

  async function start() {
    const applied: unknown[] = [];
    const desk = await startDesk(
      { queue: () => [{ id: "o/r#1" }], apply: async (id, d) => (applied.push({ id, ...d }), { ok: true }), skip: () => undefined },
      0,
      "secret-token",
    );
    server = desk.server;
    const port = Number(new URL(desk.url).port);
    return { port, applied, url: desk.url };
  }

  it("listens on loopback and serves the page with a strict CSP", async () => {
    const { port, url } = await start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=secret-token$/);
    const page = await call(port, "/");
    expect(page.status).toBe(200);
    expect(String(page.headers["content-security-policy"])).toMatch(/script-src 'self'/);
    expect((await call(port, "/app.js")).body).not.toMatch(/innerHTML/);
  });

  it("refuses API calls without the token or from another Host", async () => {
    const { port, applied } = await start();
    expect((await call(port, "/api/queue")).status).toBe(401);
    expect((await call(port, "/api/queue", { token: "secret-tokeX" })).status).toBe(401);
    expect((await call(port, "/api/queue", { token: "secret-token", host: "evil.example:80" })).status).toBe(421);
    expect((await call(port, "/api/apply", { method: "POST", token: "secret-token", type: "text/plain", body: { id: "o/r#1" } })).status).toBe(415);
    expect(applied).toEqual([]);
  });

  it("passes approved decisions through with only string labels", async () => {
    const { port, applied } = await start();
    expect(JSON.parse((await call(port, "/api/queue", { token: "secret-token" })).body)).toEqual([{ id: "o/r#1" }]);
    const res = await call(port, "/api/apply", { method: "POST", token: "secret-token", body: { id: "o/r#1", labels: ["bug", 5, { x: 1 }], reply: "ok" } });
    expect(res.status).toBe(200);
    expect(applied).toEqual([{ id: "o/r#1", labels: ["bug"], reply: "ok" }]);
    expect((await call(port, "/api/apply", { method: "POST", token: "secret-token", body: {} })).status).toBe(400);
  });
});
