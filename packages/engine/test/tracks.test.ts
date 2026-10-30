import { describe, expect, it } from "vitest";
import { evalTrack, integrate } from "../src";

const tr = (ease: "linear" | "inOut" | "in" | "out" | "step") => ({ keys: [[1, 0], [3, 10]] as [number, number][], ease });

describe("evalTrack", () => {
  it("holds the first value before the first key and the last after the last", () => {
    expect(evalTrack(tr("linear"), 0)).toBe(0);
    expect(evalTrack(tr("linear"), 99)).toBe(10);
  });
  it("interpolates with each easing", () => {
    expect(evalTrack(tr("linear"), 2)).toBe(5);
    expect(evalTrack(tr("inOut"), 2)).toBe(5);
    expect(evalTrack(tr("inOut"), 1.5)).toBeCloseTo(1.25);
    expect(evalTrack(tr("in"), 2)).toBeCloseTo(2.5);
    expect(evalTrack(tr("out"), 2)).toBeCloseTo(7.5);
  });
  it("step holds the previous value until the next key", () => {
    expect(evalTrack(tr("step"), 2.99)).toBe(0);
    expect(evalTrack(tr("step"), 3)).toBe(10);
  });
  it("a single key is constant", () => {
    expect(evalTrack({ keys: [[2, 4]], ease: "inOut" }, 7)).toBe(4);
  });
  it("integrates a constant track to value × t", () => {
    expect(integrate({ keys: [[0, 2]], ease: "linear" }, 3)).toBeCloseTo(6);
  });
});
