/**
 * Read a boolean env value. Accepts 1/true/yes/y/on and 0/false/no/n/off
 * (case-insensitive, trimmed); unset or anything else yields `defaultValue`.
 */
export function parseBool(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}
