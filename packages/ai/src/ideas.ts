// Scene ideas from a song: a title, music style and mood become three ready-to-generate scene prompts.
import { z } from "zod";
import { extractJson } from "./json";
import { prompt } from "./prompts";
import { AIError, type Provider } from "./types";

export type Song = { title: string; style?: string; mood?: string };
export const IdeasSchema = z.object({ ideas: z.array(z.object({ title: z.string().min(1), prompt: z.string().min(40) })).min(1) });
export type Idea = z.infer<typeof IdeasSchema>["ideas"][number];
const ideasJsonSchema = z.toJSONSchema(IdeasSchema, { io: "input" });

/** Three scene prompts for a song; a malformed answer is asked again twice, then fails with the reason. */
export async function songIdeas(song: Song, provider: Provider, signal?: AbortSignal): Promise<Idea[]> {
  const system = prompt("ideas", {});
  const user = [`Title: ${song.title}`, song.style && `Style: ${song.style}`, song.mood && `Mood: ${song.mood}`].filter(Boolean).join("\n");
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await provider.generateJSON({ system, user: user + feedback, schema: ideasJsonSchema, signal });
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      feedback = `\nYour last answer was not valid JSON (${(e as Error).message}). Answer with the JSON object only.`;
      continue;
    }
    const r = IdeasSchema.safeParse(raw);
    if (r.success) return r.data.ideas.slice(0, 3);
    feedback = `\nYour last answer didn't fit the format: ${r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}. Fix it.`;
  }
  throw new AIError("The AI couldn't write scene ideas for this song", "Try again, or shorten the style.");
}
