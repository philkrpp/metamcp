import { z } from "zod";

export const McpRequestAuditLogStatusSchema = z.enum(["SUCCESS", "ERROR"]);

export const ListMcpRequestAuditLogsRequestSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
  endpointName: z.string().optional(),
  apiKeyUuid: z.string().uuid().optional(),
  status: McpRequestAuditLogStatusSchema.optional(),
});

export const McpRequestAuditLogEntrySchema = z.object({
  uuid: z.string().uuid(),
  created_at: z.date(),
  endpoint_name: z.string(),
  namespace_uuid: z.string().uuid().nullable(),
  namespace_name: z.string().nullable(),
  session_id: z.string(),
  auth_method: z.string(),
  api_key_uuid: z.string().uuid().nullable(),
  api_key_name: z.string().nullable(),
  api_key_user_id: z.string().nullable(),
  oauth_user_id: z.string().nullable(),
  mcp_server_uuid: z.string().uuid().nullable(),
  mcp_server_name: z.string().nullable(),
  tool_name: z.string(),
  status: McpRequestAuditLogStatusSchema,
  duration_ms: z.number().int(),
  error_message: z.string().nullable(),
});

export const ListMcpRequestAuditLogsResponseSchema = z.object({
  logs: z.array(McpRequestAuditLogEntrySchema),
});

export type McpRequestAuditLogStatus = z.infer<
  typeof McpRequestAuditLogStatusSchema
>;
export type ListMcpRequestAuditLogsRequest = z.infer<
  typeof ListMcpRequestAuditLogsRequestSchema
>;
export type McpRequestAuditLogEntry = z.infer<
  typeof McpRequestAuditLogEntrySchema
>;
export type ListMcpRequestAuditLogsResponse = z.infer<
  typeof ListMcpRequestAuditLogsResponseSchema
>;
