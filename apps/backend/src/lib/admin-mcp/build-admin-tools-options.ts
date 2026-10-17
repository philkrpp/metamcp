import type { DatabaseEndpoint } from "@repo/zod-types";

import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";
import logger from "@/utils/logger";

import { endpointsRepository } from "../../db/repositories/endpoints.repo";
import type { AdminToolsOptions } from "../metamcp/metamcp-server-pool";
import { resolveAdminActorFromRequest } from "./resolve-auth-user";

// Admin tools need the endpoint toggle AND an authenticated caller to act as.
function endpointAllowsAdminTools(
  endpoint: DatabaseEndpoint | undefined,
): endpoint is DatabaseEndpoint {
  if (!endpoint?.enable_metamcp_admin_tools) {
    return false;
  }
  return endpoint.enable_api_key_auth || endpoint.enable_oauth;
}

export async function buildAdminToolsOptions(
  endpoint: DatabaseEndpoint | undefined,
  authReq: ApiKeyAuthenticatedRequest,
): Promise<AdminToolsOptions | undefined> {
  if (!endpointAllowsAdminTools(endpoint)) {
    return undefined;
  }

  const actor = await resolveAdminActorFromRequest(authReq);
  if (!actor) {
    return undefined;
  }

  return { enabled: true, endpointUuid: endpoint.uuid, ...actor };
}

/**
 * Re-check the endpoint toggle for a session that was bound to admin tools at
 * creation. The binding outlives later edits to the endpoint, so the proxy
 * asks this on every tools/list and admin tools/call: one single-row lookup.
 * Fails closed when the endpoint is gone or the lookup errors.
 */
export async function isEndpointAdminToolsEnabled(
  endpointUuid: string,
): Promise<boolean> {
  try {
    return endpointAllowsAdminTools(
      await endpointsRepository.findByUuid(endpointUuid),
    );
  } catch (error) {
    logger.error(
      `Admin tools: could not re-check endpoint ${endpointUuid}; denying`,
      error,
    );
    return false;
  }
}
