import { mcpRequestAuditLogsRepository } from "@/db/repositories/mcp-request-audit-logs.repo";

import { CallToolHandler, CallToolMiddleware } from "./functional-middleware";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function createAuditCallToolMiddleware(): CallToolMiddleware {
  return (handler: CallToolHandler): CallToolHandler => {
    return async (request, context) => {
      const startTime = performance.now();

      try {
        const response = await handler(request, context);
        const durationMs = Math.round(performance.now() - startTime);

        void mcpRequestAuditLogsRepository.create({
          endpointName: context.endpointName,
          namespaceUuid: context.namespaceUuid,
          sessionId: context.sessionId,
          authMethod: context.auth?.method || "none",
          apiKeyUuid: context.auth?.apiKeyUuid,
          apiKeyUserId: context.auth?.apiKeyUserId,
          oauthUserId: context.auth?.oauthUserId,
          toolName: request.params.name,
          status: response.isError ? "ERROR" : "SUCCESS",
          durationMs,
          errorMessage:
            response.isError && response.content?.[0]?.type === "text"
              ? response.content[0].text
              : undefined,
        });

        return response;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startTime);

        void mcpRequestAuditLogsRepository.create({
          endpointName: context.endpointName,
          namespaceUuid: context.namespaceUuid,
          sessionId: context.sessionId,
          authMethod: context.auth?.method || "none",
          apiKeyUuid: context.auth?.apiKeyUuid,
          apiKeyUserId: context.auth?.apiKeyUserId,
          oauthUserId: context.auth?.oauthUserId,
          toolName: request.params.name,
          status: "ERROR",
          durationMs,
          errorMessage: getErrorMessage(error),
        });

        throw error;
      }
    };
  };
}
