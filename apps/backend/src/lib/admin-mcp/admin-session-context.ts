export interface AdminToolsSessionContext {
  enabled: boolean;
  userId: string;
  isAdmin: boolean;
  // The endpoint whose `enable_metamcp_admin_tools` toggle granted the
  // binding; re-checked per request so turning it off reaches live sessions.
  endpointUuid: string;
}

const adminContextByInternalSessionId = new Map<
  string,
  AdminToolsSessionContext
>();

export function setAdminToolsContext(
  internalSessionId: string,
  context: AdminToolsSessionContext,
): void {
  adminContextByInternalSessionId.set(internalSessionId, context);
}

export function getAdminToolsContext(
  internalSessionId: string,
): AdminToolsSessionContext | undefined {
  return adminContextByInternalSessionId.get(internalSessionId);
}

export function clearAdminToolsContext(internalSessionId: string): void {
  adminContextByInternalSessionId.delete(internalSessionId);
}
