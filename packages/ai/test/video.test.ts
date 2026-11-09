import { afterEach, expect, it, vi } from "vitest";
import { generateVideo, runway } from "../src";

afterEach(() => vi.unstubAllGlobals());

const req = { prompt: "hair moves", firstFrame: new Uint8Array([1, 2, 3]), durationSeconds: 5.04, aspect: "16:9", resolution: "720p", seed: 7, audio: "none" } as const;

/** A fake Runway: queued, then running, then done (or whatever `states` says); records every call. */
function fakeRunway(states: Record<string, unknown>[], credits = 50) {
  const calls: { method: string; url: string; body?: Record<string, unknown>; headers?: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    if (url.endsWith("/v1/image_to_video")) return Response.json({ id: "t1", status: "PENDING", estimatedCost: { credits } });
    if (url === "https://cdn/out.mp4") return new Response(new Uint8Array([9, 9]));
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: "t1", ...states.shift() });
  });
  return calls;
}

it("creates, polls and downloads a Seedance clip", async () => {
  const calls = fakeRunway([{ status: "RUNNING" }, { status: "SUCCEEDED", output: ["https://cdn/out.mp4"] }]);
  const r = await generateVideo(runway({ apiKey: "secret", model: "seedance2_5" }), req, { pollMs: 1, maxCostUsd: 5 });
  expect([...r.bytes]).toEqual([9, 9]);
  expect(r.task).toMatchObject({ providerTaskId: "t1", status: "succeeded", estimatedCostUsd: 0.5 });
  const create = calls[0];
  expect(create.headers).toMatchObject({ authorization: "Bearer secret", "x-runway-version": "2024-11-06" });
  expect(create.body).toEqual({ model: "seedance2_5", promptImage: "data:image/png;base64,AQID", promptText: "hair moves", ratio: "1280:720", duration: 5, seed: 7, audio: false });
});

it("sends Kling only the fields it accepts", async () => {
  const calls = fakeRunway([{ status: "SUCCEEDED", output: ["https://cdn/out.mp4"] }]);
  await generateVideo(runway({ apiKey: "k", model: "kling_4" }), req, { pollMs: 1 });
  expect(calls[0].body).toEqual({ model: "kling_4", promptImage: "data:image/png;base64,AQID", promptText: "hair moves", ratio: "auto_720p", duration: 5 });
});

it("cancels a task over the spend limit before it runs", async () => {
  const calls = fakeRunway([], 900);
  await expect(generateVideo(runway({ apiKey: "k", model: "seedance2_5" }), req, { pollMs: 1, maxCostUsd: 5 })).rejects.toThrow(/\$9\.00, over the \$5\.00 left to spend/);
  expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
});

it("reports a failed task with Runway's reason", async () => {
  fakeRunway([{ status: "FAILED", failure: "content moderation" }]);
  await expect(generateVideo(runway({ apiKey: "k", model: "seedance2_5" }), req, { pollMs: 1 })).rejects.toThrow(/failed: content moderation/);
});

it("cancels the provider task when the job is cancelled", async () => {
  const calls = fakeRunway([{ status: "RUNNING" }, { status: "RUNNING" }]);
  const ac = new AbortController();
  const done = generateVideo(runway({ apiKey: "k", model: "seedance2_5" }), req, { pollMs: 50, signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await expect(done).rejects.toThrow();
  expect(calls.at(-1)?.method).toBe("DELETE");
});

it("rides out a lost connection and a rate limit while polling", async () => {
  let n = 0;
  vi.stubGlobal("fetch", async (url: string, init: { method?: string } = {}) => {
    if (url.endsWith("/v1/image_to_video")) return Response.json({ id: "t1", status: "PENDING", estimatedCost: { credits: 50 } });
    if (url === "https://cdn/out.mp4") return new Response(new Uint8Array([7]));
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    n++;
    if (n === 1) throw new TypeError("fetch failed"); // offline for a moment
    if (n === 2) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
    return Response.json({ id: "t1", status: "SUCCEEDED", output: ["https://cdn/out.mp4"] });
  });
  const r = await generateVideo(runway({ apiKey: "k", model: "seedance2_5" }), req, { pollMs: 1 });
  expect([...r.bytes]).toEqual([7]);
});

it("asks again when creating is rate-limited (no task was made), and says so plainly when offline", async () => {
  const calls = fakeRunway([{ status: "SUCCEEDED", output: ["https://cdn/out.mp4"] }]);
  const real = globalThis.fetch;
  let limited = 2;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (url.endsWith("/v1/image_to_video") && limited-- > 0 ? new Response("busy", { status: 429 }) : real(url, init as never)));
  await generateVideo(runway({ apiKey: "k", model: "seedance2_5" }), req, { pollMs: 1 });
  expect(limited).toBe(-1);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);

  vi.stubGlobal("fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await expect(generateVideo(runway({ apiKey: "k", model: "seedance2_5" }), req, { pollMs: 1 })).rejects.toThrow(/Can't reach Runway/);
});

it("refuses models it doesn't know the request shape of", () => {
  expect(() => runway({ apiKey: "k", model: "gen4_turbo" })).toThrow(/Unsupported Runway video model "gen4_turbo"/);
});

it("prices a clip from the list price and refuses one over the limit before making a task", async () => {
  const calls = fakeRunway([]);
  const seedance = runway({ apiKey: "k", model: "seedance2_5" });
  // measured on a real 4 s 720p task (2026-11-10): 120 credits; short clips pay the 80-credit minimum
  expect(seedance.estimateUsd!({ durationSeconds: 4, resolution: "720p" })).toBeCloseTo(1.2);
  expect(seedance.estimateUsd!({ durationSeconds: 2, resolution: "720p" })).toBeCloseTo(0.8);
  expect(runway({ apiKey: "k", model: "kling_4" }).estimateUsd!({ durationSeconds: 5, resolution: "720p" })).toBeCloseTo(0.79);
  await expect(generateVideo(seedance, req, { pollMs: 1, maxCostUsd: 1 })).rejects.toThrow(/\$1\.50, over the \$1\.00 left/);
  expect(calls).toEqual([]);
});
