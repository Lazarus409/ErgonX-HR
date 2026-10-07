type ClassValue = string | number | bigint | boolean | null | undefined;

/** Joins conditional class names. Falsy entries are dropped. */
export function cx(...parts: ClassValue[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}
