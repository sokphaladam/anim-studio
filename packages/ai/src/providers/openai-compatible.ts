import { AIError, type Provider } from "../types";
import { lines } from "./stream";

/** Any OpenAI-style /chat/completions endpoint (Gemini, Groq, OpenRouter…), used as a cloud fallback. */
export function openaiCompatible(opts: { baseUrl: string; apiKey: string; model: string }): Provider {
  const base = opts.baseUrl.replace(/\/$/, "");
  // FALLBACK_MODEL may list several models, comma-separated; the first is preferred
  const models = opts.model.split(",").map((m) => m.trim()).filter(Boolean);
  return {
    name: "openai-compatible",
    model: models[0],
    vision: true,
    async generateJSON({ system, user, onToken, signal, image }) {
      let res!: Response;
      // busy (429/503) is usually brief and per model: try the next listed model, then wait and go round again
      for (let attempt = 0; attempt < Math.max(4, models.length * 2); attempt++) {
        if (attempt >= models.length) await new Promise((r) => setTimeout(r, 2000 * 2 ** Math.min(3, attempt - models.length)));
        try {
          res = await post(models[attempt % models.length]);
        } catch (e) {
          if (signal?.aborted) throw e;
          throw new AIError(`Can't reach ${base}`, "Check FALLBACK_BASE_URL and your connection.");
        }
        if (res.status !== 429 && res.status !== 503) break;
      }
      if (res.status === 429 || res.status === 503) {
        const why = (await res.text()).match(/"message":\s*"([^"]{0,240})/)?.[1] ?? "";
        throw new AIError(`The cloud AI is ${res.status === 429 ? "over its limit" : "busy"} (${res.status})${why ? `: ${why}` : ""}`, "Wait a minute and try again, or pick another FALLBACK_MODEL.");
      }
      function post(model: string) {
        return fetch(`${base}/chat/completions`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model,
            stream: true,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user },
            ],
          }),
        });
      }
      if (res.status === 401 || res.status === 403) throw new AIError("The cloud API rejected the key", "Check FALLBACK_API_KEY in .env.");
      if (!res.ok) throw new AIError(`Cloud API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      let out = "";
      for await (const line of lines(res)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        const chunk = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? "";
        if (chunk) {
          out += chunk;
          onToken?.(chunk);
        }
      }
      return out;
    },
  };
}
