/**
 * The owner the MCP server EDIT form sends when "Private" is chosen.
 *
 * The update path reads a missing `user_id` as "keep the current owner", so
 * sending `undefined` for "Private" silently left a PUBLIC server public. The
 * form must name the owner explicitly:
 *
 *  - an OWNED server keeps its stored owner (only that owner or an admin can
 *    edit it, so "Private" means "leave it as it is");
 *  - a PUBLIC server is claimed by the signed-in user.
 *
 * Returns `undefined` when there is no owner to name (public server and the
 * session lookup failed); the form then disables "Private" instead of
 * offering a choice that would do nothing.
 */
export function privateServerOwner(
  storedOwner: string | null | undefined,
  currentUserId: string | null | undefined,
): string | undefined {
  if (typeof storedOwner === "string" && storedOwner !== "") return storedOwner;
  if (typeof currentUserId === "string" && currentUserId !== "") {
    return currentUserId;
  }
  return undefined;
}
