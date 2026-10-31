import { afterEach, expect, it, vi } from "vitest";
import { openaiCompatible } from "../src";

afterEach(() => vi.unstubAllGlobals());

it("moves to the next listed model when one is busy", async () => {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const model = JSON.parse(init.body).model as string;
    asked.push(model);
    if (model === "busy") return new Response('{"error":{"message":"high demand"}}', { status: 503 });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":true}' } }] })}\n\ndata: [DONE]\n\n`);
  });
  const p = openaiCompatible({ baseUrl: "https://x", apiKey: "k", model: "busy, free" });
  expect(await p.generateJSON({ system: "s", user: "u", schema: {} })).toBe('{"ok":true}');
  expect(asked).toEqual(["busy", "free"]);
});
