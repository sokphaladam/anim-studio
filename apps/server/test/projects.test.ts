import type { Provider } from "@anim/ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";

const spec = { version: 1, meta: { title: "sky", duration: 6, fps: 30, width: 1280, height: 720 }, palette: { sky: "#1b2340" }, layers: [{ id: "bg", type: "paper", params: { color: "$sky" } }] };
const dir = mkdtempSync(join(tmpdir(), "anim-db-"));
const file = join(dir, "test.db");
const answers: unknown[] = [];
const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => JSON.stringify(answers.shift()) };
const config = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null };
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function start() {
  const app = buildApp({ provider, config, store: createStore(file) });
  app.log.level = "silent";
  await app.ready();
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await app.inject({ method: method as "GET", url, payload: body as object });
    return { status: r.statusCode, body: r.json() };
  };
  return { app, call };
}

it("creates, saves versions, edits with AI, undoes, and survives a restart", async () => {
  let { app, call } = await start();
  expect((await call("POST", "/api/projects", { spec: { ...spec, layers: [{ id: "x", type: "dragon" }] } })).status).toBe(400);
  const { id, version } = (await call("POST", "/api/projects", { spec, label: "New scene" })).body;
  expect(version).toBeGreaterThan(0);

  // unchanged save keeps the version; a real change adds one
  expect((await call("PUT", `/api/projects/${id}`, { spec })).body.version).toBe(version);
  const v2 = (await call("PUT", `/api/projects/${id}`, { spec: { ...spec, meta: { ...spec.meta, title: "sky 2" } }, chat: [{ role: "user", text: "hi" }] })).body.version;
  expect(v2).toBeGreaterThan(version);

  answers.push({ patch: [{ op: "replace", path: "/palette/sky", value: "#000000" }] });
  const e = await call("POST", `/api/projects/${id}/edit`, { instruction: "make the sky black" });
  expect(e.status).toBe(200);
  expect(e.body.patch).toEqual([{ op: "replace", path: "/palette/sky", value: "#000000" }]);

  await app.close();
  ({ app, call } = await start());
  const list = (await call("GET", "/api/projects")).body;
  expect(list).toMatchObject([{ id, title: "sky 2", duration: 6 }]);
  const got = (await call("GET", `/api/projects/${id}`)).body;
  expect(got).toMatchObject({ version: e.body.version, chat: [{ role: "user", text: "hi" }] });
  expect(got.spec.palette.sky).toBe("#000000");

  const u = await call("POST", `/api/projects/${id}/undo`);
  expect(u.body).toMatchObject({ version: v2, spec: { palette: { sky: "#1b2340" } } });
  await call("POST", `/api/projects/${id}/undo`);
  expect((await call("POST", `/api/projects/${id}/undo`)).status).toBe(409);
  expect((await call("GET", "/api/projects/nope")).status).toBe(404);

  expect((await app.inject({ method: "DELETE", url: `/api/projects/${id}` })).statusCode).toBe(204);
  expect((await call("GET", `/api/projects/${id}`)).status).toBe(404);
  expect((await call("GET", "/api/projects")).body).toEqual([]);
  expect((await call("DELETE", `/api/projects/${id}`)).status).toBe(404);
  await app.close();
});

it("explains when the model can't make an edit", async () => {
  const { app, call } = await start();
  const { id } = (await call("POST", "/api/projects", { spec })).body;
  answers.push({ patch: [{ op: "replace", path: "/layers/5/x", value: 1 }] }, { patch: [{ op: "replace", path: "/layers/5/x", value: 1 }] }, "not json");
  const r = await call("POST", `/api/projects/${id}/edit`, { instruction: "move the moon" });
  expect(r).toMatchObject({ status: 422, body: { error: "The model couldn't make that change" } });
  await app.close();
});
