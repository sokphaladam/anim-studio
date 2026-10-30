import { configFromEnv, providerFor, type AIConfig, type Provider } from "@anim/ai";
import Fastify from "fastify";
import { generateRoutes } from "./routes/generate";
import { healthRoutes } from "./routes/health";

/** Builds the API. `provider` can be swapped in tests. */
export function buildApp(opts: { config?: AIConfig; provider?: Provider } = {}) {
  const config = opts.config ?? configFromEnv(process.env);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  generateRoutes(app, () => opts.provider ?? providerFor(config));
  healthRoutes(app, config);
  return app;
}
