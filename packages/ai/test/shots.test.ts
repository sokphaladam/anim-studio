import { expect, it } from "vitest";
import { cinematicShots, LayeredPlanSchema, loopShot, planProblems } from "../src";

const plan = (shots: unknown[] = []) =>
  LayeredPlanSchema.parse({ title: "t", beats: [{ at: 0, label: "rest", note: "She sleeps" }, { at: 3, label: "wake" }], environment: "balcony at night", characters: [{ id: "girl", look: "girl", pose: "sleeping", box: [0.3, 0.3, 0.6, 0.9] }], shots });

it("rejects shots outside the scene, too short or too long, and duplicate ids", () => {
  const p = plan([{ id: "a", start: 0, end: 2, motion: "hair moves" }, { id: "a", start: 4, end: 16, motion: "camera pushes in" }]);
  const problems = planProblems(p, 12);
  expect(problems).toHaveLength(3);
  expect(problems.join("\n")).toMatch(/used twice[\s\S]*4-10 seconds apart[\s\S]*end by 12s/);
  expect(planProblems(plan([{ id: "wind", start: 2, end: 8, motion: "hair moves" }]), 12)).toEqual([]);
});

it("without planned shots, makes one from the start moving as the beats say", () => {
  expect(cinematicShots(plan(), 12)).toEqual([{ id: "scene", start: 0, end: 10, motion: "She sleeps. wake" }]);
  expect(cinematicShots(plan(), 6)[0].end).toBe(6);
});

it("the natural-motion loop divides the scene, keeps the camera still and names what moves", () => {
  const p = LayeredPlanSchema.parse({
    title: "t", beats: [{ at: 0, label: "calm" }], environment: "treehouse",
    characters: [{ id: "girl", look: "girl", pose: "sitting", box: [0.5, 0.3, 0.7, 0.8], idle: ["breathe", "blink"] }, { id: "cat", look: "cat", pose: "walking", box: [0.1, 0.6, 0.2, 0.7] }],
    ambient: [{ type: "falling-leaves" }],
    actions: [{ type: "walk", who: "cat", path: [[0.1, 0.7], [0.3, 0.7]], start: 2, end: 8 }],
  });
  // short clips (at least 4 s); the editor times their playback so the loop point lands on the scene's (placeLoop)
  expect([12, 6, 30, 5].map((d) => loopShot(p, d).end)).toEqual([4, 4, 4, 4]);
  const s = loopShot(p, 12);
  expect(s).toMatchObject({ id: "loop", start: 0 });
  expect(s.motion).toMatch(/the girl breathes slowly, blinks now and then\. the cat stays calm and still\. the cat walks slowly with natural steps.*leaves fall gently\. the camera stays completely still/);
});
