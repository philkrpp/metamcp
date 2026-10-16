import type { DatabaseEndpoint } from "@repo/zod-types";

import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";

import type { AdminToolsOptions } from "../metamcp/metamcp-server-pool";
import { resolveAdminActorFromRequest } from "./resolve-auth-user";

export async function buildAdminToolsOptions(
  endpoint: DatabaseEndpoint | undefined,
  authReq: ApiKeyAuthenticatedRequest,
): Promise<AdminToolsOptions | undefined> {
  if (!endpoint?.enable_metamcp_admin_tools) {
    return undefined;
  }

  if (!endpoint.enable_api_key_auth && !endpoint.enable_oauth) {
    return undefined;
  }

  const actor = await resolveAdminActorFromRequest(authReq);
  if (!actor) {
    return undefined;
  }

  return { enabled: true, ...actor };
}
