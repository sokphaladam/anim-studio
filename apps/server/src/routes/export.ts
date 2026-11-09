import { validateScene } from "@anim/engine";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { exportMp4, PRESETS, type Preset } from "../export";
import { startJob } from "../jobs";

const Body = z.object({ spec: z.unknown(), preset: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]), quality: z.enum(["draft", "balanced", "final"]).default("final"), fit: z.enum(["contain", "cover"]).default("contain") });
const FILE = /^[a-z0-9-]{1,80}\.mp4$/;

/** POST /api/export renders the spec it is sent (what the editor shows, saved or not) as a job; follow /api/jobs/:id/events. */
export function exportRoutes(app: FastifyInstance, imagesDir: string, exportsDir: string) {
  app.post("/api/export", async (req, reply) => {
    const b = Body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0].message });
    const v = validateScene(b.data.spec);
    if (!v.ok) return reply.code(400).send({ error: `The scene isn't valid: ${v.errors[0]}` });
    const spec = v.spec;
    const slug = spec.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scene";
    const name = `${slug}-${b.data.preset}-${randomBytes(3).toString("hex")}.mp4`;
    const jobId = startJob(async (emit, signal) => {
      mkdirSync(exportsDir, { recursive: true });
      emit({ type: "progress", frame: 0, total: 0 });
      let shown = 0;
      const out = await exportMp4(spec, b.data.preset, imagesDir, join(exportsDir, name), (frame, total) => {
        // about 100 updates per export, however long it is
        if (frame === total || frame - shown >= total / 100) emit({ type: "progress", frame: (shown = frame), total });
      }, signal, { quality: b.data.quality, fit: b.data.fit });
      emit({ type: "done", url: `/api/exports/${name}`, name, ...out });
    });
    return { jobId };
  });

  app.get<{ Params: { name: string } }>("/api/exports/:name", async (req, reply) => {
    const { name } = req.params;
    const file = join(exportsDir, name);
    if (!FILE.test(name) || !existsSync(file)) return reply.code(404).send({ error: "Export not found" });
    reply.header("content-type", "video/mp4");
    if ("download" in (req.query as object)) reply.header("content-disposition", `attachment; filename="${name}"`);
    return reply.send(createReadStream(file));
  });
}
