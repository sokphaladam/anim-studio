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
        throw new AIError("Ollama is not running — start it and refresh", `Start Ollama (the app, or \`ollama serve\`) at ${url}.`);
      }
      if (res.status === 404) throw new AIError("Model not found", `Run \`ollama pull ${opts.model}\`.`);
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
