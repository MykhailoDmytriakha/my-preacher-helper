import { toast } from 'sonner';

import { isStaleWriteError, isWriteRefusedError } from '@/services/conflictSafeUpdate.client';

import type { Mutation, QueryClient } from '@tanstack/react-query';

export function recoveryText(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join('\n');
}

export function writeFailureTranslationKey(error: unknown, fallbackKey: string): string {
  return isWriteRefusedError(error) || isStaleWriteError(error)
    ? 'writeRecovery.refused'
    : fallbackKey;
}

export async function copyRecoveryText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  await navigator.clipboard.writeText(text);
}

export function showRecoverableWriteFailure({
  error,
  title,
  description,
  retryLabel,
  retry,
  copyLabel,
  id,
}: {
  error: unknown;
  title: string;
  description: string;
  retryLabel: string;
  retry: () => void;
  copyLabel: string;
  id: string;
}) {
  // A stale revision was refused too; retrying with its unchanged baseline only
  // recreates the conflict and traps the person in the same recovery loop.
  const refused = isWriteRefusedError(error) || isStaleWriteError(error);
  // "Copy my text" on a refusal that carries NO text is an empty promise: the button
  // copies nothing. Writes without typed content (a switch, a reorder) hit this, so
  // the action is dropped rather than shown as a dead control.
  const hasRecoverableText = description.trim().length > 0;
  const action = refused
    ? hasRecoverableText
      ? { label: copyLabel, onClick: () => void copyRecoveryText(description) }
      : undefined
    : { label: retryLabel, onClick: retry };

  toast.error(title, {
    id,
    description,
    duration: Infinity,
    ...(action ? { action } : {}),
  });
}

/**
 * Every failure any reporter has already spoken for, ACROSS the app rather than per
 * hook. Two screens can listen to the same kind of write — a list and a detail page,
 * say — and a per-hook set cannot see the other's messages, so one refusal arrived
 * twice in two wordings.
 */
let REPORTED_FAILURES = new WeakSet<object>();

/**
 * Forget what has been said. Sign-out dismisses the messages themselves, but the record
 * of "already reported" lived on in this module — and the query client survives a
 * sign-out too. So a person who signed back in before the mutation was collected never
 * saw their own unresolved refusal again: the reporter believed it had been handled.
 */
export function forgetReportedFailures(): void {
  REPORTED_FAILURES = new WeakSet<object>();
}

export function subscribeToTerminalMutationFailures({
  queryClient,
  reported,
  report,
}: {
  queryClient: QueryClient;
  reported: WeakSet<object>;
  report: (mutation: Mutation) => boolean;
}) {
  const mutationCache = queryClient.getMutationCache();
  const inspect = (mutation: Mutation) => {
    if (reported.has(mutation) || REPORTED_FAILURES.has(mutation)) return;
    // A paused mutation is accepted work waiting for a connection, not a failure.
    if (mutation.state.status !== 'error' || mutation.state.isPaused) return;
    if (!report(mutation)) return;
    reported.add(mutation);
    REPORTED_FAILURES.add(mutation);
  };

  // Error mutations are persisted. Scan first so a refusal remains recoverable
  // after reload, then subscribe for failures that arrive in this session.
  mutationCache.getAll().forEach(inspect);
  return mutationCache.subscribe((event) => {
    if (event.mutation) inspect(event.mutation);
  });
}

