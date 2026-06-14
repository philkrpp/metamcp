import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function zodToMcpInputSchema(schema: ZodTypeAny): Record<string, unknown> {
  // zod-to-json-schema's return-type inference recurses too deeply on some zod
  // 3.25 schemas (TS2589); the runtime result is unaffected, so call through a
  // narrowed function signature to stop the deep instantiation.
  const toJsonSchema = zodToJsonSchema as unknown as (
    s: ZodTypeAny,
    opts?: Record<string, unknown>,
  ) => Record<string, unknown>;
  const jsonSchema = toJsonSchema(schema, {
    $refStrategy: "none",
    target: "openApi3",
  });

  const { $schema: _, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}
