// Owner for a newly created API key. `null` means a public key; anything
// else is forced to the caller so a client cannot mint keys for other users.
export function resolveApiKeyOwner(
  requestedUserId: string | null | undefined,
  callerUserId: string,
): string | null {
  return requestedUserId === null ? null : callerUserId;
}
