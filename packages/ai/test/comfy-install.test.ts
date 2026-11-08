import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { comfyHealth, comfyInstall } from "../src";

const touch = (f: string) => (mkdirSync(join(f, ".."), { recursive: true }), writeFileSync(f, ""));

describe("comfyInstall", () => {
  it("uses the Windows portable build when it is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfy-"));
    touch(join(dir, "ComfyUI_windows_portable", "ComfyUI", "main.py"));
    const c = comfyInstall(dir);
    expect(c.comfy).toBe(join(dir, "ComfyUI_windows_portable", "ComfyUI"));
    expect(c.python).toBe(join(dir, "ComfyUI_windows_portable", "python_embeded", "python.exe"));
  });

  it("otherwise uses the git checkout and its .venv, and finds its models", async () => {
    const dir = mkdtempSync(join(tmpdir(), "comfy-"));
    const models = join(dir, "ComfyUI", "models");
    for (const f of ["checkpoints/animagine-xl-4.0-opt.safetensors", "checkpoints/sam3.1_multiplex_fp16.safetensors", "background_removal/birefnet.safetensors"]) touch(join(models, f));
    const c = comfyInstall(dir);
    expect(c.comfy).toBe(join(dir, "ComfyUI"));
    expect(c.args).toEqual([join(dir, "ComfyUI", "main.py")]);
    if (process.platform !== "win32") expect(c.python).toBe(join(dir, "ComfyUI", ".venv", "bin", "python"));
    expect(await comfyHealth({ url: "http://127.0.0.1:1", dir })).toEqual({ installed: true, video: false, layered: true, running: false });
  });
});
