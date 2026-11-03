import { describe, expect, it } from "vitest";
import { hashes, loadExample } from "./helpers";

describe("determinism", () => {
  for (const name of ["autumn-window", "bouncing-ball", "night-study", "snowy-owl", "reading-room"])
    it(`${name}: same spec + same t gives identical pixels, regardless of render order`, () => {
      const spec = loadExample(name);
      const d = spec.meta.duration;
      const times = [0.05, 0.21, 0.43, 0.69, 0.92].map((k) => k * d);
      const forward = hashes(spec, times);
      expect(hashes(spec, [...times].reverse()).reverse()).toEqual(forward);
      expect(new Set(forward).size).toBe(times.length);
    });
});
