import fastifyStatic from "@fastify/static";
import { buildApp } from "@anim/server/app";

/**
 * The packaged app's server: the normal API plus the built web app on the same origin, so the web code's
 * relative /api calls and its /render/:id route work unchanged. Resolves with the URL to open.
 */
export async function start(webDir: string, port: number): Promise<string> {
  const app = buildApp();
  await app.register(fastifyStatic, { root: webDir });
  // client-side routes (/render/:id) get the app shell
  app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api/") ? reply.sendFile("index.html") : reply.code(404).send({ error: "Not found" })));
  try {
    await app.listen({ port, host: "127.0.0.1" });
  } catch {
    // port taken (another copy, or pnpm dev): any free port still works, only this session's window layout is lost
    await app.listen({ port: 0, host: "127.0.0.1" });
  }
  const a = app.server.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : port}`;
}
