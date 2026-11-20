import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface DeskHandlers {
  queue(): unknown;
  apply(id: string, d: { labels?: string[]; reply?: string }): Promise<unknown>;
  skip(id: string): unknown;
}

const HTML = `<!doctype html><meta charset="utf-8"><title>repo-desk</title><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/app.css"><h1>repo-desk</h1><p id="status">Loading…</p><main id="list"></main><script src="/app.js"></script>`;

const CSS = `body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1b1f24}
article{border:1px solid #d0d7de;border-radius:8px;padding:1rem;margin:1rem 0}h2{font-size:1rem;margin:0 0 .5rem}
label{margin-right:.75rem;white-space:nowrap}textarea{width:100%;min-height:6rem;font:inherit}.meta{color:#57606a;font-size:.9em}
button{margin:.5rem .5rem 0 0;padding:.35rem .9rem;border-radius:6px;border:1px solid #d0d7de;background:#f6f8fa;cursor:pointer}
button.go{background:#1f883d;color:#fff;border-color:#1f883d}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}
article,button{border-color:#30363d}button{background:#21262d;color:#e6edf3}.meta{color:#8b949e}textarea{background:#0d1117;color:#e6edf3}}`;

// All page text comes from issues, so it is only ever set with textContent / value, never innerHTML.
const JS = `const token=new URLSearchParams(location.hash.slice(1)).get("token");history.replaceState(null,"",location.pathname);
const api=(p,b)=>fetch(p,{method:b?"POST":"GET",headers:{"x-desk-token":token,"content-type":"application/json"},body:b&&JSON.stringify(b)})
.then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j});
const el=(t,props={},...kids)=>{const e=Object.assign(document.createElement(t),props);e.append(...kids);return e};
const status=document.getElementById("status"),list=document.getElementById("list");
async function load(){const q=await api("/api/queue");status.textContent=q.length?q.length+" waiting. Nothing is written to GitHub until you press Apply.":"Nothing waiting.";list.replaceChildren(...q.map(card))}
function card(e){const s=e.suggestion,boxes=e.allowed.map(n=>{const c=el("input",{type:"checkbox",checked:s.labels.includes(n)||e.current.includes(n),disabled:e.current.includes(n)});c.dataset.name=n;return el("label",{},c," "+n)});
const reply=el("textarea",{value:s.reply}),msg=el("span",{className:"meta"});
const act=async(fn)=>{try{await fn();await load()}catch(err){msg.textContent=err.message}};
const apply=el("button",{className:"go",textContent:"Apply",onclick:()=>act(()=>api("/api/apply",{id:e.id,labels:boxes.map(b=>b.firstChild).filter(c=>c.checked&&!c.disabled).map(c=>c.dataset.name),reply:reply.value}))});
const skip=el("button",{textContent:"Skip",onclick:()=>act(()=>api("/api/skip",{id:e.id}))});
return el("article",{},el("h2",{},el("a",{href:/^https:\\/\\/github\\.com\\//.test(e.url)?e.url:"#",target:"_blank",rel:"noopener noreferrer",textContent:e.id})," "+e.title),
el("div",{className:"meta",textContent:(e.isPr?"PR":"Issue")+" by "+e.author+" · "+s.mode+(s.needsInfo?" · needs info":"")+(s.duplicates.length?" · possible duplicates: "+s.duplicates.map(d=>"#"+d.number+" ("+d.score+")").join(", "):"")}),
el("div",{},...boxes),reply,apply,skip,msg)}
load().catch(e=>status.textContent=e.message);`;

/** Local approval desk: binds to 127.0.0.1 only, and every API call needs the per-run token. */
export function startDesk(h: DeskHandlers, port: number, token = randomBytes(24).toString("hex")): Promise<{ server: Server; url: string }> {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const tokenBuf = Buffer.from(token);
  const authed = (req: IncomingMessage) => {
    const got = Buffer.from(String(req.headers["x-desk-token"] ?? ""));
    return got.length === tokenBuf.length && timingSafeEqual(got, tokenBuf);
  };
  const send = (res: ServerResponse, code: number, type: string, body: string) => {
    res.writeHead(code, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(body);
  };
  const json = (res: ServerResponse, code: number, o: unknown) => send(res, code, "application/json", JSON.stringify(o));

  const server = createServer(async (req, res) => {
    // A DNS-rebinding page would arrive with its own Host header.
    if (!hosts.has(String(req.headers.host))) return send(res, 421, "text/plain", "Wrong host");
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", HTML);
    if (req.method === "GET" && path === "/app.js") return send(res, 200, "text/javascript", JS);
    if (req.method === "GET" && path === "/app.css") return send(res, 200, "text/css", CSS);
    if (!path?.startsWith("/api/")) return send(res, 404, "text/plain", "Not found");
    if (!authed(req)) return json(res, 401, { error: "Missing or wrong desk token. Open the URL repo-desk printed." });
    try {
      if (req.method === "GET" && path === "/api/queue") return json(res, 200, await h.queue());
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      if (!String(req.headers["content-type"]).startsWith("application/json")) return json(res, 415, { error: "JSON only" });
      const body = await readJson(req);
      if (typeof body?.id !== "string") return json(res, 400, { error: "id required" });
      if (path === "/api/apply") {
        const labels = Array.isArray(body.labels) ? body.labels.filter((l: unknown) => typeof l === "string") : undefined;
        const reply = typeof body.reply === "string" ? body.reply : undefined;
        return json(res, 200, await h.apply(body.id, { labels, reply }));
      }
      if (path === "/api/skip") return json(res, 200, (await h.skip(body.id)) ?? { ok: true });
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      return json(res, 400, { error: (e as Error).message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const p = (server.address() as { port: number }).port;
      if (!port) hosts.add(`127.0.0.1:${p}`).add(`localhost:${p}`);
      resolve({ server, url: `http://127.0.0.1:${p}/#token=${token}` });
    });
  });
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64_000) {
        reject(new Error("Body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Bad JSON"));
      }
    });
  });
}
