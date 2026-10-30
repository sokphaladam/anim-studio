// Runs the real generation pipeline from the terminal. Usage: pnpm generate "a cat on a rainy balcony" [duration] [aspect]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { configFromEnv, generateScene, providerFor, type Aspect } from "@anim/ai";

import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const [prompt = "a fox sleeping by an autumn window at dusk, leaves blowing", dur = "12", aspect = "16:9"] = process.argv.slice(2);
const cfg = configFromEnv(process.env);
const provider = providerFor(cfg);
console.log(`model: ${provider.name} ${provider.model}`);
const t0 = Date.now();
const spec = await generateScene({ prompt, duration: Number(dur), aspect: aspect as Aspect }, provider, (e) => {
  const s = ((Date.now() - t0) / 1000).toFixed(0).padStart(4) + "s ";
  if (e.type === "token") return;
  if (e.type === "storyboard") console.log(s + "storyboard:", JSON.stringify(e.storyboard));
  else if (e.type === "repairing") console.log(s + `repair ${e.attempt}:\n  ` + e.errors.slice(0, 12).join("\n  "));
  else if (e.type === "done") console.log(s + `done after ${e.repairs} repairs: ${e.spec.layers.map((l) => l.type).join(", ")}`);
  else console.log(s + JSON.stringify(e));
});
if (spec) {
  mkdirSync(root + "data", { recursive: true });
  writeFileSync(root + "data/last-generated.json", JSON.stringify(spec, null, 2));
  console.log("saved data/last-generated.json");
}
