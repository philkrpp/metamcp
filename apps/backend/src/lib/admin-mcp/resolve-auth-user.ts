import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";

import { getUserRole } from "./user-role";

export interface AdminToolsActor {
  userId: string;
  isAdmin: boolean;
}

// Admin tools act as the authenticated caller: the OAuth user or the owner of
// the API key. A key without an owner gets no admin tools; it never borrows
// another user's identity (and with it possibly the admin role).
export async function resolveAdminActorFromRequest(
  authReq: ApiKeyAuthenticatedRequest,
): Promise<AdminToolsActor | undefined> {
  const userId = authReq.oauthUserId ?? authReq.apiKeyUserId;
  if (!userId) {
    return undefined;
  }

  const role = await getUserRole(userId);
  if (role === undefined) {
    return undefined;
  }

  return { userId, isAdmin: role === "admin" };
}
