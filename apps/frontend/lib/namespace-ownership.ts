/**
 * Which ownership choices the namespace EDIT form may offer.
 *
 * The create form offers both "For myself" (no owner sent; the backend makes
 * the creator the owner) and "Everyone" (null, public). Editing is narrower:
 *
 *  - an existing PUBLIC namespace stays public. "For myself" there would send
 *    `undefined`, which the update path reads as "keep the current owner",
 *    so it would do nothing;
 *  - an existing OWNED namespace keeps both choices. Only its owner can open
 *    the edit dialog for it, so "For myself" truthfully means "leave it as it
 *    is", and "Everyone" publishes it.
 *
 * Decide from the namespace's STORED owner, never from the form value: after
 * an owner picks "Everyone" the form holds null, and deciding from that would
 * collapse the control before they can change their mind.
 */
export type NamespaceOwnershipChoice = "forMyself" | "everyone";

export function namespaceOwnershipChoices(
  storedOwner: string | null | undefined,
): NamespaceOwnershipChoice[] {
  return typeof storedOwner === "string" && storedOwner !== ""
    ? ["forMyself", "everyone"]
    : ["everyone"];
}
