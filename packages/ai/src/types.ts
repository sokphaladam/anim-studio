export interface GenerateJSONArgs {
  system: string;
  user: string;
  /** JSON schema the output must follow (Ollama enforces it with `format`). */
  schema: object;
  /** Called with each streamed text chunk. */
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
}

/** One way to talk to a model. Returns the raw text the model produced (expected to be JSON). */
export interface Provider {
  name: string;
  model: string;
  generateJSON(args: GenerateJSONArgs): Promise<string>;
}

/** An error worth showing to the user as-is, with how to fix it. */
export class AIError extends Error {
  constructor(message: string, readonly fix?: string) {
    super(message);
  }
}
