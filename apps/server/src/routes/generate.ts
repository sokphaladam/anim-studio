import { generateScene, type Provider } from "@anim/ai";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cancelJob, getJob, startJob, type JobEvent } from "../jobs";

const Body = z.object({ prompt: z.string().trim().min(3, "Describe the animation in a few words").max(2000), duration: z.number().min(5).max(30), aspect: z.enum(["16:9", "9:16", "1:1"]) });

export function generateRoutes(app: FastifyInstance, provider: () => Provider) {
  app.post("/api/generate", async (req, reply) => {
    const r = Body.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const p = provider();
    const jobId = startJob(async (emit, signal) => {
      await generateScene(r.data, p, (e) => emit(e as JobEvent), signal);
    });
    return { jobId };
  });

  // Server-Sent Events: replays everything so far, then streams until the job ends
  app.get<{ Params: { id: string } }>("/api/jobs/:id/events", (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "Unknown or expired job" });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: JobEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    job.events.forEach(send);
    if (job.finished) {
      send({ type: "end" });
      return res.end();
    }
    const listener = (e: JobEvent) => {
      send(e);
      if (e.type === "end") res.end();
    };
    job.listeners.add(listener);
    req.raw.on("close", () => job.listeners.delete(listener));
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req) => ({ cancelled: cancelJob(req.params.id) }));
}
