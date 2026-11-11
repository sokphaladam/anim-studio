import { AIError, directMotion, editScene, songIdeas, type Provider } from "@anim/ai";
import { createCanvas } from "@napi-rs/canvas";
import { validateScene } from "@anim/engine";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Store } from "../db";

const Save = z.object({ spec: z.unknown(), label: z.string().trim().min(1).max(200).default("Saved"), chat: z.array(z.unknown()).max(1000).optional() });
const Edit = z.object({ instruction: z.string().trim().min(2, "Say what to change").max(2000) });
const Direct = z.object({ spec: z.unknown(), intent: z.string().trim().min(3, "Say what should happen").max(2000) });
const Ideas = z.object({ title: z.string().trim().min(1, "Give the song a title").max(200), style: z.string().trim().max(1000).optional(), mood: z.string().trim().max(200).optional() });
type Id = { Params: { id: string } };

const bad = (reply: FastifyReply, error: string, errors?: string[]) => reply.code(400).send({ error, errors });
const missing = (reply: FastifyReply) => reply.code(404).send({ error: "Project not found" });

export function projectRoutes(app: FastifyInstance, store: Store, provider: () => Provider) {
  // shortcut: the list carries every project's full latest spec for thumbnails; add a stored thumbnail if lists get slow
  app.get("/api/projects", async () => store.list());

  app.post("/api/projects", async (req, reply) => {
    const b = Save.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0].message);
    const v = validateScene(b.data.spec);
    if (!v.ok) return bad(reply, "Invalid scene", v.errors);
    return store.create(v.spec, b.data.label, b.data.chat);
  });

  app.get<Id>("/api/projects/:id", async (req, reply) => store.get(req.params.id) ?? missing(reply));

  app.put<Id>("/api/projects/:id", async (req, reply) => {
    const b = Save.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0].message);
    const v = validateScene(b.data.spec);
    if (!v.ok) return bad(reply, "Invalid scene", v.errors);
    const version = store.save(req.params.id, v.spec, b.data.label, b.data.chat);
    return version === null ? missing(reply) : { version };
  });

  app.delete<Id>("/api/projects/:id", async (req, reply) => (store.remove(req.params.id) ? reply.code(204).send() : missing(reply)));

  app.post<Id>("/api/projects/:id/undo", async (req, reply) => {
    if (!store.get(req.params.id)) return missing(reply);
    return store.undo(req.params.id) ?? reply.code(409).send({ error: "Nothing to undo" });
  });

  /**
   * Motion Director: plans motion clips for `intent` on the scene sent and answers with the plan and the new scene. Nothing
   * is saved: the editor shows the plan for review and applies it as one undoable step.
   */
  app.post("/api/direct", async (req, reply) => {
    const b = Direct.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0].message);
    const v = validateScene(b.data.spec);
    if (!v.ok) return bad(reply, "Invalid scene", v.errors);
    const ac = new AbortController();
    reply.raw.on("close", () => !reply.raw.writableFinished && ac.abort());
    try {
      return await directMotion(v.spec, b.data.intent, provider(), { signal: ac.signal, make: (w, h) => createCanvas(w, h) });
    } catch (e) {
      if (e instanceof AIError) return reply.code(422).send({ error: e.message, fix: e.fix });
      throw e;
    }
  });

  /** Scene ideas for a song (title, style, mood): three prompts the start page can generate from. Nothing is saved. */
  app.post("/api/ideas", async (req, reply) => {
    const b = Ideas.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0].message);
    const ac = new AbortController();
    reply.raw.on("close", () => !reply.raw.writableFinished && ac.abort());
    try {
      return { ideas: await songIdeas(b.data, provider(), ac.signal) };
    } catch (e) {
      if (e instanceof AIError) return reply.code(422).send({ error: e.message, fix: e.fix });
      throw e;
    }
  });

  /** Edits the latest saved version (the editor saves first). */
  app.post<Id>("/api/projects/:id/edit", async (req, reply) => {
    const b = Edit.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues[0].message);
    const id = req.params.id;
    const cur = store.get(id);
    if (!cur) return missing(reply);
    // stop the model if the browser gives up on the request
    const ac = new AbortController();
    reply.raw.on("close", () => !reply.raw.writableFinished && ac.abort());
    try {
      const r = await editScene(cur.spec, b.data.instruction, provider(), ac.signal);
      if (!r.ok) return reply.code(422).send({ error: r.message, errors: r.errors });
      const version = r.patch.length ? store.save(id, r.spec, `AI: ${b.data.instruction.slice(0, 80)}`)! : cur.version;
      return { patch: r.patch, spec: r.spec, version, fullSpec: r.fullSpec };
    } catch (e) {
      if (e instanceof AIError) return reply.code(503).send({ error: e.message, fix: e.fix });
      throw e;
    }
  });
}
