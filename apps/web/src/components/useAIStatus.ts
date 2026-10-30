import { useEffect, useState } from "react";

export type AIStatus = { status: "pending" | "ok" | "warn" | "error"; message: string; fix?: string };

/** AI readiness from the server's GET /api/health (Ollama reachable, model pulled), rechecked every 20 s. */
export function useAIStatus(): AIStatus {
  const [s, setS] = useState<AIStatus>({ status: "pending", message: "Checking local AI…" });
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/health", { signal: AbortSignal.timeout(4000) })
        .then((r) => r.json() as Promise<{ ok: boolean; reachable?: boolean; message: string; fix?: string }>)
        .then((h) => alive && setS({ status: h.ok ? "ok" : h.reachable ? "warn" : "error", message: h.message, fix: h.fix }))
        .catch(() => alive && setS({ status: "error", message: "The AI server is not running — start it with pnpm dev" }));
    check();
    const id = setInterval(check, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return s;
}
