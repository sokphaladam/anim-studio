import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../prompts/", import.meta.url));

/** Loads prompts/<name>.md and fills {{placeholders}}. Read at call time so prompt edits need no restart. */
export function prompt(name: "storyboard" | "spec" | "repair", vars: Record<string, string>): string {
  const text = readFileSync(`${dir}${name}.md`, "utf8");
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`Prompt ${name}.md uses {{${k}}} but no value was given`);
    return vars[k];
  });
}
