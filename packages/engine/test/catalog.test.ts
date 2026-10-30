import { expect, it } from "vitest";
import { catalog } from "../src";

it("catalog lists every object with its description and defaults", () => {
  const c = catalog();
  expect(c).toMatch(/- fox \(characters\): A fox .* Params: x, y, scale=1/);
  expect(c.split("\n").length).toBeGreaterThanOrEqual(17);
});
