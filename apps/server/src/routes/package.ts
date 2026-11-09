import { validateScene } from "@anim/engine";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "../db";
import { PRESETS, type Preset } from "../export";
import { startJob } from "../jobs";
import { buildPackage, checkPackage, importPackage } from "../package";

const Body = z.object({
  spec: z.unknown(),
  preset: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]),
  quality: z.enum(["draft", "balanced", "final"]).default("final"),
  fit: z.enum(["contain", "cover"]).default("contain"),
  sceneId: z.string().max(80).optional(),
});
const LIMIT = 1024 * 1024 * 1024;

/**
 * Packages for CR Content: POST /api/package builds one as a job (follow /api/jobs/:id/events; download from
 * /api/exports/<name>); POST /api/package/check checks a ZIP sent as the body; POST /api/package/import checks one and
 * opens it as a new project, bringing its images into this library.
 */
export function packageRoutes(app: FastifyInstance, store: Store, imagesDir: string, exportsDir: string, save: (png: Uint8Array) => string) {
  app.addContentTypeParser("application/zip", { parseAs: "buffer", bodyLimit: LIMIT }, (_req, body, done) => done(null, body));

  app.post("/api/package", async (req, reply) => {
    const b = Body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0].message });
    const v = validateScene(b.data.spec);
    if (!v.ok) return reply.code(400).send({ error: `The scene isn't valid: ${v.errors[0]}` });
    const jobId = startJob(async (emit, signal) => {
      let shown = 0;
      const out = await buildPackage(v.spec, b.data, imagesDir, exportsDir, (stage, done, total) => {
        if (stage !== "render" || done === total || done - shown >= total / 50) emit({ type: "progress", stage, frame: (shown = done), total });
      }, signal);
      emit({ type: "done", url: `/api/exports/${out.name}`, name: out.name, manifest: out.manifest, report: out.report });
    });
    return { jobId };
  });

  const read = (body: unknown) => (Buffer.isBuffer(body) ? checkPackage(body) : ({ ok: false, errors: ["Send the package as the request body (content-type application/zip)"] } as const));

  app.post("/api/package/check", { bodyLimit: LIMIT }, async (req, reply) => {
    const r = read(req.body);
    return r.ok ? { ok: true, manifest: r.manifest } : reply.code(422).send({ ok: false, errors: r.errors });
  });

  app.post("/api/package/import", { bodyLimit: LIMIT }, async (req, reply) => {
    const r = read(req.body);
    if (!r.ok) return reply.code(422).send({ ok: false, errors: r.errors });
    const spec = importPackage(r, imagesDir, save);
    return { ok: true, ...store.create(spec, `Imported package: ${r.manifest.title}`), manifest: r.manifest };
  });
}
