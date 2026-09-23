import { HISTORY_LIMIT } from "./constants";

export function prependBounded<T>(items: readonly T[], item: T, limit = HISTORY_LIMIT): T[] {
  const safeLimit = Math.max(0, limit);
  return [item, ...items].slice(0, safeLimit);
}
