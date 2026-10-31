import { useEffect, useState } from "react";

export type AIStatus = { status: "pending" | "ok" | "warn" | "error"; message: string; fix?: string };

/** AI readiness from the server's GET /api/health (Ollama reachable, model pulled), rechecked every 20 s, or every 3 s while the model downloads. */
export function useAIStatus(): AIStatus {
  const [s, setS] = useState<AIStatus>({ status: "pending", message: "Checking local AI…" });
  useEffect(() => {
    let alive = true;
    let id: ReturnType<typeof setTimeout>;
    const check = () =>
      fetch("/api/health", { signal: AbortSignal.timeout(4000) })
        .then((r) => r.json() as Promise<{ ok: boolean; reachable?: boolean; pulling?: boolean; message: string; fix?: string }>)
        .then((h) => {
          if (!alive) return;
          setS({ status: h.ok ? "ok" : h.reachable ? "warn" : "error", message: h.message, fix: h.fix });
          id = setTimeout(check, h.pulling ? 3000 : 20_000);
        })
        .catch(() => {
          if (!alive) return;
          setS({ status: "error", message: "The AI server is not running — start it with pnpm dev" });
          id = setTimeout(check, 20_000);
        });
    check();
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, []);
  return s;
}
