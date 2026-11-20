import type { Config } from "./config.js";

/** Minimal client for LM Studio's OpenAI-compatible server. Everything stays on this machine. */
export class LocalModel {
  constructor(private cfg: Pick<Config, "lmUrl" | "chatModel" | "embedModel">) {}

  private async post(path: string, body: object, timeoutMs: number): Promise<any> {
    const res = await fetch(`${this.cfg.lmUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LM Studio ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  /** True when the server answers and lists the chat model. */
  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.lmUrl}/models`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return false;
      const { data } = (await res.json()) as { data?: { id: string }[] };
      return (data ?? []).some((m) => m.id === this.cfg.chatModel);
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.post("/embeddings", { model: this.cfg.embedModel, input: texts }, 120_000);
    return res.data.map((d: { embedding: number[] }) => d.embedding);
  }

  /** Chat completion constrained to a JSON schema; returns the parsed object. */
  async json<T>(system: string, user: string, schema: object): Promise<T> {
    const res = await this.post(
      "/chat/completions",
      {
        model: this.cfg.chatModel,
        temperature: 0.1,
        max_tokens: 800,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "triage", strict: true, schema } },
      },
      180_000,
    );
    const text: string = res.choices?.[0]?.message?.content ?? "";
    return JSON.parse(text.replace(/<think>[\s\S]*?<\/think>/g, "").trim());
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
