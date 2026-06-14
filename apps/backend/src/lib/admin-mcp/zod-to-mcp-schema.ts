import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function zodToMcpInputSchema(schema: ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "openApi3",
  });

  const { $schema: _, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}
