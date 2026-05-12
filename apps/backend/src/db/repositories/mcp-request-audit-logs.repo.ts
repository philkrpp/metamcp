import logger from "@/utils/logger";

import { db } from "../index";
import { mcpRequestAuditLogsTable } from "../schema";

export interface McpRequestAuditLogCreateInput {
  endpointName: string;
  namespaceUuid: string;
  sessionId: string;
  authMethod: "api_key" | "oauth" | "none";
  apiKeyUuid?: string;
  apiKeyUserId?: string;
  oauthUserId?: string;
  toolName: string;
  status: "SUCCESS" | "ERROR";
  durationMs: number;
  errorMessage?: string;
}

export class McpRequestAuditLogsRepository {
  async create(input: McpRequestAuditLogCreateInput): Promise<void> {
    try {
      await db.insert(mcpRequestAuditLogsTable).values({
        endpoint_name: input.endpointName,
        namespace_uuid: input.namespaceUuid,
        session_id: input.sessionId,
        auth_method: input.authMethod,
        api_key_uuid: input.apiKeyUuid,
        api_key_user_id: input.apiKeyUserId,
        oauth_user_id: input.oauthUserId,
        tool_name: input.toolName,
        status: input.status,
        duration_ms: input.durationMs,
        error_message: input.errorMessage,
      });
    } catch (error) {
      logger.error("Failed to persist MCP request audit log:", error);
    }
  }
}

export const mcpRequestAuditLogsRepository =
  new McpRequestAuditLogsRepository();
