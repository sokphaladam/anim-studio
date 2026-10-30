import { AIError, type Provider } from "../types";
import { lines } from "./stream";

/** Any OpenAI-style /chat/completions endpoint (Gemini, Groq, OpenRouter…), used as a cloud fallback. */
export function openaiCompatible(opts: { baseUrl: string; apiKey: string; model: string }): Provider {
  const base = opts.baseUrl.replace(/\/$/, "");
  return {
    name: "openai-compatible",
    model: opts.model,
    async generateJSON({ system, user, onToken, signal }) {
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model: opts.model,
            stream: true,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new AIError(`Can't reach ${base}`, "Check FALLBACK_BASE_URL and your connection.");
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
