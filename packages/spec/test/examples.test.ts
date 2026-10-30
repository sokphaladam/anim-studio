import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateScene } from "@anim/engine";

const dir = join(__dirname, "../examples");

describe("examples", () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")))
    it(`${f} validates against the schema and object params`, () => {
      const r = validateScene(JSON.parse(readFileSync(join(dir, f), "utf8")));
      expect(r.ok ? [] : r.errors).toEqual([]);
    });
});
