export interface GenerateJSONArgs {
  system: string;
  user: string;
  /** JSON schema the output must follow (Ollama enforces it with `format`). */
  schema: object;
  /** Called with each streamed text chunk. */
  onToken?: (chunk: string) => void;
  /** An image (data: URL) to look at; only providers with `vision` use it. */
  image?: string;
  signal?: AbortSignal;
}

/** One way to talk to a model. Returns the raw text the model produced (expected to be JSON). */
export interface Provider {
  name: string;
  model: string;
  generateJSON(args: GenerateJSONArgs): Promise<string>;
  /** Whether generateJSON can look at `image`. */
  vision?: boolean;
  /** Frees GPU memory (local models), so the image painter fits. */
  unload?(): Promise<void>;
}

/** An error worth showing to the user as-is, with how to fix it. */
export class AIError extends Error {
  /** `unavailable`: the provider couldn't be reached at all (not running, model missing), so another one may be tried. */
  constructor(message: string, readonly fix?: string, readonly unavailable = false) {
    super(message);
  }
}
