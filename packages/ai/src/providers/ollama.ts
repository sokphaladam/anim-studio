import { AIError, type Provider } from "../types";
import { ollamaSchema } from "../schema-compat";
import { lines } from "./stream";

export function ollama(opts: { url: string; model: string }): Provider {
  const url = opts.url.replace(/\/$/, "");
  return {
    name: "ollama",
    model: opts.model,
    async generateJSON({ system, user, schema, onToken, signal }) {
      let res: Response;
      try {
        res = await fetch(`${url}/api/chat`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: opts.model,
            stream: true,
            format: ollamaSchema(schema),
            options: { temperature: 0.4, num_ctx: 8192 },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new AIError("Ollama is not running — start it and refresh", `Start Ollama (the app, or \`ollama serve\`) at ${url}.`, true);
      }
      if (res.status === 404) throw new AIError("Model not found", `Run \`ollama pull ${opts.model}\`.`, true);
      if (!res.ok) throw new AIError(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      let out = "";
      for await (const line of lines(res)) {
        const msg = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (msg.error) throw new AIError(`Ollama error: ${msg.error}`);
        const chunk = msg.message?.content ?? "";
        if (chunk) {
          out += chunk;
          onToken?.(chunk);
        }
      }
      return out;
    },
    async unload() {
      await fetch(`${url}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: opts.model, keep_alive: 0 }) }).catch(() => {});
    },
  };
}

/** Whether Ollama answers and has the model pulled. */
export async function ollamaHealth(opts: { url: string; model: string }) {
  try {
    const res = await fetch(`${opts.url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const data = (await res.json()) as { models?: { name: string }[] };
    const pulled = !!data.models?.some((m) => m.name === opts.model || m.name === `${opts.model}:latest`);
    return { reachable: true, modelPulled: pulled };
  } catch {
    return { reachable: false, modelPulled: false };
  }
}

export type PullState = { status: "pulling"; percent: number } | { status: "done" } | { status: "error"; error: string };

/** Downloads a model through Ollama's /api/pull, reporting progress. Resolves when the pull ends (state is "done" or "error"). */
export async function ollamaPull(opts: { url: string; model: string }, onState: (s: PullState) => void) {
  try {
    const res = await fetch(`${opts.url.replace(/\/$/, "")}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: opts.model, stream: true }) });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    onState({ status: "pulling", percent: 0 });
    for await (const line of lines(res)) {
      const msg = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
      if (msg.error) throw new Error(msg.error);
      if (msg.total && msg.completed !== undefined) onState({ status: "pulling", percent: Math.floor((msg.completed / msg.total) * 100) });
    }
    onState({ status: "done" });
  } catch (e) {
    onState({ status: "error", error: (e as Error).message });
  }
}
