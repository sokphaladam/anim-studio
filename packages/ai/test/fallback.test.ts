import { afterEach, expect, it, vi } from "vitest";
import { AIError, configFromEnv, providerFor, withFallback, type Provider } from "../src";

afterEach(() => vi.unstubAllGlobals());

const fake = (name: string, answer: () => Promise<string>, vision = false): Provider & { calls: number } => {
  const p = { name, model: name, vision, calls: 0, generateJSON: async () => (p.calls++, answer()) };
  return p;
};
const ARGS = { system: "s", user: "u", schema: {} };
const CLOUD = { FALLBACK_BASE_URL: "https://x", FALLBACK_API_KEY: "k", FALLBACK_MODEL: "m" };

it("is off unless AI_FALLBACK=1 and a cloud model is configured, so prompts stay local by default", () => {
  expect(configFromEnv(CLOUD).useFallback).toBe(false);
  expect(configFromEnv({ AI_FALLBACK: "1" }).useFallback).toBe(false);
  expect(configFromEnv({ ...CLOUD, AI_FALLBACK: "1" }).useFallback).toBe(true);
});

it("asks the cloud only when Ollama can't be reached", async () => {
  const cloud = fake("cloud", async () => '{"from":"cloud"}');
  const down = withFallback(fake("local", async () => { throw new AIError("Ollama is not running", "start it", true); }), cloud);
  expect(await down.generateJSON(ARGS)).toBe('{"from":"cloud"}');

  const up = withFallback(fake("local", async () => '{"from":"local"}'), cloud);
  expect(await up.generateJSON(ARGS)).toBe('{"from":"local"}');
  expect(cloud.calls).toBe(1);
});

it("doesn't hide other failures, cancels, or send an image to a model that can't see it", async () => {
  const cloud = fake("cloud", async () => "{}");
  const broken = withFallback(fake("local", async () => { throw new AIError("Ollama error 500"); }), cloud);
  await expect(broken.generateJSON(ARGS)).rejects.toThrow("Ollama error 500");
  const down = withFallback(fake("local", async () => { throw new AIError("Ollama is not running", undefined, true); }), cloud);
  const ac = new AbortController();
  ac.abort();
  await expect(down.generateJSON({ ...ARGS, signal: ac.signal })).rejects.toThrow("not running");
  await expect(down.generateJSON({ ...ARGS, image: "data:image/png;base64,x" })).rejects.toThrow("not running");
  expect(cloud.calls).toBe(0);
});

it("providerFor wires the real Ollama provider to the cloud one: Ollama down → the cloud answers", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("11434")) throw new TypeError("fetch failed");
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":true}' } }] })}\n\ndata: [DONE]\n\n`);
  });
  const p = providerFor(configFromEnv({ ...CLOUD, AI_FALLBACK: "1" }));
  expect(await p.generateJSON(ARGS)).toBe('{"ok":true}');
  await expect(providerFor(configFromEnv(CLOUD)).generateJSON(ARGS)).rejects.toThrow("Ollama is not running");
});
