/**
 * Coerce an unknown thrown value into an Error instance. React Query mutation
 * onError receives `unknown`; this keeps the downstream error state typed and
 * avoids repeating the `instanceof Error ? … : new Error(String(…))` idiom in
 * every onError handler.
 */
export const normalizeError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));
