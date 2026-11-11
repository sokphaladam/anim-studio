import { describe, expect, it } from "vitest";
import { progressFrom, VIDEO_TURBO_LORA, videoWorkflow } from "../src/painters/comfyui";

const args = { image: new Uint8Array(), positive: "p", negative: "n", width: 1280, height: 704, frames: 121, fps: 24, seed: 1 };

describe("video workflow", () => {
  it("runs the template's 20 steps at cfg 5 without the turbo LoRA", () => {
    const g = videoWorkflow(args, "start.png") as Record<string, { inputs: Record<string, unknown> }>;
    expect(g.lora).toBeUndefined();
    expect(g.shift.inputs.model).toEqual(["unet", 0]);
    expect(g.sample.inputs).toMatchObject({ steps: 20, cfg: 5, sampler_name: "uni_pc" });
  });

  it("with the turbo LoRA, samples through it in 4 steps at cfg 1", () => {
    const g = videoWorkflow(args, "start.png", true) as Record<string, { inputs: Record<string, unknown> }>;
    expect(g.lora.inputs).toMatchObject({ model: ["unet", 0], lora_name: VIDEO_TURBO_LORA });
    expect(g.shift.inputs.model).toEqual(["lora", 0]);
    expect(g.sample.inputs).toMatchObject({ steps: 4, cfg: 1 });
    // tiled: a whole-clip decode overflows a 12 GB card and crawls
    expect(g.decode).toMatchObject({ class_type: "VAEDecodeTiled", inputs: { tile_size: 512, temporal_size: 64 } });
  });

  it("reads ComfyUI's WebSocket messages into stages and steps, for our job only", () => {
    const g = videoWorkflow(args, "start.png", true) as Record<string, { class_type: string }>;
    const start = { label: "Waiting for the GPU" };
    expect(progressFrom({ type: "executing", data: { prompt_id: "j", node: "unet" } }, g, "j", start)).toEqual({ label: "Loading the model" });
    expect(progressFrom({ type: "executing", data: { prompt_id: "j", node: "lora" } }, g, "j", { label: "Loading the model" })).toBeNull();
    expect(progressFrom({ type: "executing", data: { prompt_id: "j", node: "sample" } }, g, "j", start)).toEqual({ label: "Loading onto the GPU" });
    expect(progressFrom({ type: "progress", data: { prompt_id: "j", value: 2, max: 4 } }, g, "j", { label: "Loading onto the GPU" })).toEqual({ label: "Generating", step: 2, steps: 4 });
    expect(progressFrom({ type: "progress", data: { prompt_id: "other", value: 2, max: 4 } }, g, "j", start)).toBeNull();
    expect(progressFrom({ type: "executing", data: { prompt_id: "j", node: "shift" } }, g, "j", start)).toBeNull();
  });
});
