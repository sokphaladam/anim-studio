import { z } from "zod";
import { SceneSpecSchema } from "./schema";

/** JSON schema for SceneSpecSchema, passed to Ollama's `format` so output is forced into the right shape. */
export const sceneSpecJsonSchema = z.toJSONSchema(SceneSpecSchema, { io: "input", unrepresentable: "any" });
