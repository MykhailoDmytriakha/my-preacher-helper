import { toast } from 'sonner';

import { isStaleWriteError, isWriteRefusedError } from '@/services/conflictSafeUpdate.client';

import type { ScriptureReference } from '@/models/models';
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
 * A LATE REFUSAL IS ALWAYS SAID, AND THE TEXT ALWAYS COMES BACK.
 *
 * A write outlives the screen that started it, so a refusal can land after the editor
 * has closed — and then nothing on screen is waiting to report it. Two failure modes
 * were measured here, and this function exists to make both impossible:
 *
 *   - SILENCE: recovery lived in the closed editor's own state, so the edit vanished
 *     from the document and the person was told nothing at all.
 *   - DOUBLE-TELLING: the closed editor toasted AND its owner reported, so the same
 *     refusal arrived twice, in two different wordings.
 *
 * So the message is shown exactly once, here, and the editor is additionally reopened
 * with the rejected text when the person is still on that screen. The return value
 * says whether the text came back into an editor or only into the message.
 */
export function reportLateRefusal({
  isEditorMounted,
  reopenEditor,
  toast: toastArgs,
}: {
  isEditorMounted: boolean;
  reopenEditor: () => void;
  toast: Parameters<typeof showRecoverableWriteFailure>[0];
}): 'editor' | 'toast' {
  showRecoverableWriteFailure(toastArgs);
  if (isEditorMounted) {
    reopenEditor();
    return 'editor';
  }
  return 'toast';
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

/**
 * Scripture references as the person reads them. Shared so the note hook and the note
 * editor cannot drift into two different renderings of the same draft.
 *
 * Every part below the book is optional in the model — a reference can be a whole book,
 * a chapter, a chapter range or a verse range — so each piece is appended only when it
 * exists. Formatting the optional parts blindly produced "Matthew undefined:undefined",
 * which is worse than the reference the person actually picked.
 */
export function formatScriptureRefs(refs: ScriptureReference[] | undefined): string | undefined {
  if (!refs?.length) return undefined;
  const formatted = refs
    .map((ref) => {
      if (ref.chapter === undefined) return ref.book;
      const chapters = ref.toChapter ? `${ref.chapter}-${ref.toChapter}` : `${ref.chapter}`;
      if (ref.fromVerse === undefined) return `${ref.book} ${chapters}`;
      const verses = ref.toVerse ? `${ref.fromVerse}-${ref.toVerse}` : `${ref.fromVerse}`;
      return `${ref.book} ${chapters}:${verses}`;
    })
    .filter(Boolean);
  return formatted.length ? formatted.join('; ') : undefined;
}
