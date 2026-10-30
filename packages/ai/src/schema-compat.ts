/**
 * Ollama's JSON-schema → grammar converter rejects tuple arrays (`prefixItems` / array-valued `items`).
 * Rewrites them as plain arrays of the union of their item schemas with a fixed length; Zod still checks the exact shape after.
 */
export function ollamaSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(ollamaSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = ollamaSchema(v);
  const tuple = (out.prefixItems ?? (Array.isArray(out.items) ? out.items : null)) as unknown[] | null;
  if (tuple) {
    delete out.prefixItems;
    const uniq = [...new Map(tuple.map((t) => [JSON.stringify(t), t])).values()];
    out.items = uniq.length === 1 ? uniq[0] : { anyOf: uniq };
    out.minItems = tuple.length;
    out.maxItems = tuple.length;
  }
  return out;
}
