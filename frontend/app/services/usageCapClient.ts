import {
  isUsageCapReachedError,
  parseUsageCapError,
  type UsageCapReachedError,
} from '@/services/usageLimits';

export type UsageClientEvent =
  | { type: 'request-settled' }
  | { type: 'cap-reached'; error: UsageCapReachedError };

type UsageClientEventListener = (event: UsageClientEvent) => void;

const listeners = new Set<UsageClientEventListener>();
const emittedErrors = new WeakSet<object>();

export function subscribeToUsageClientEvents(listener: UsageClientEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyUsageRequestSettled(): void {
  listeners.forEach((listener) => listener({ type: 'request-settled' }));
}

export function notifyUsageCapReached(error: unknown): boolean {
  const typedError = isUsageCapReachedError(error) ? error : parseUsageCapError(error);
  if (!typedError) return false;
  if (emittedErrors.has(typedError)) return true;

  emittedErrors.add(typedError);
  listeners.forEach((listener) => listener({ type: 'cap-reached', error: typedError }));
  return true;
}

export async function throwIfUsageCapReached(response: Response): Promise<void> {
  if (response.ok) return;

  let payload: unknown = null;
  try {
    payload = await response.clone().json();
  } catch {
    return;
  }

  const error = parseUsageCapError(payload);
  if (!error) return;

  notifyUsageCapReached(error);
  throw error;
}
