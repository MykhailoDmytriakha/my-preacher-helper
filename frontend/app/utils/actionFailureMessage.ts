import { ranOutOfTime } from '@/utils/aiTimeFailure';

/**
 * WHAT A FAILURE SAYS ON SCREEN (.howto/show-an-error-once.md,
 * BUG-20261003-engine-error-sentence-on-screen).
 *
 * The data engine's errors are sentences for developers, and they come in two kinds:
 *  - a READ that failed (opening a document, loading a list, finding drafts) carries nothing the
 *    person can act on — "The document is not available in the local cache" beside the screen's own
 *    "could not load" — so `failureWords` says the caller's line and logs the original once per
 *    error object;
 *  - a refused ACTION (save, a version choice, a form, recovering a draft) may carry an instruction — "Read the current
 *    document before resolving a generation mismatch", "The selected preach date is no longer
 *    available" — so `refusalWords` keeps an unknown refusal's own sentence, as before, until its
 *    code is translated (BUG-20261003-engine-refusals-speak-english).
 * Both keep a refusal already written for the person in the language it was written in (a read-only
 * refusal, `code: 'read-only'`, and a screen's own refusal made with `saidError`), and say a cause
 * the person can act on by its code (`KNOWN`), looked up when shown — silent device storage among
 * them, whose message may be English.
 *
 * Hooks keep the `FailureWords` and translate a key when they render, so a language switch re-says
 * a failure said by key; a toast, shown once, uses `actionFailureMessage` or `refusalMessage`.
 */
export type FailureWords = { said: string } | { key: string };

const SAID = new Set(['read-only', 'said']);
// A Map, not an object: a code such as 'constructor' must not find the prototype.
const KNOWN = new Map<string, string>([
  ['storage-silent', 'dataSync.readOnly.storage'],
  ['use-new-copy', 'dataSync.failure.deleted'],
  ['series-list-incomplete', 'dataSync.failure.seriesListIncomplete'],
  ['series-changes-pending', 'dataSync.failure.seriesChangesPending'],
  // Refusals that tell the person what to do first (BUG-20261003-engine-refusals-speak-english).
  ['preach-date-gone', 'dataSync.failure.preachDateGone'],
  ['fresh-read-required', 'dataSync.failure.freshReadRequired'],
  ['resolve-version-first', 'dataSync.failure.resolveVersionFirst'],
  ['unsent-form-first', 'dataSync.failure.unsentFormFirst'],
  ['not-on-device-yet', 'dataSync.failure.notOnDeviceYet'],
  ['pending-delivery-first', 'dataSync.failure.pendingDeliveryFirst'],
  ['other-changes-first', 'dataSync.failure.otherChangesFirst'],
  ['draft-gone', 'dataSync.failure.draftGone'],
  ['draft-done', 'dataSync.failure.draftDone'],
  ['part-gone', 'dataSync.failure.partGone'],
]);
// One failure reaches several catches (a draft search and its document, the engine's background
// report and the list that asked); the console hears it once.
const logged = new WeakSet<object>();

/** Send a failure to the console once per error object, whoever catches it first. */
export function logFailureOnce(error: unknown, ...context: unknown[]): void {
  if (typeof error === 'object' && error !== null) {
    if (logged.has(error)) return;
    logged.add(error);
  }
  console.error(...context, error);
}

/** An error whose message is a sentence for the person, already translated; it is shown as it is. */
export function saidError(message: string): Error {
  return Object.assign(new Error(message), { code: 'said' });
}

export function failureWords(error: unknown, fallbackKey: string): FailureWords {
  const code = error instanceof Error ? String((error as { code?: unknown }).code ?? '') : '';
  if (error instanceof Error && SAID.has(code) && error.message) return { said: error.message };
  // An AI call cut by the 60 s ceiling or the client's clock (`ranOutOfTime`): "HTTP 504" is not words.
  if (ranOutOfTime(error)) return { key: 'errors.aiOutOfTime' };
  const known = KNOWN.get(code);
  if (known) return { key: known };
  logFailureOnce(error);
  return { key: fallbackKey };
}

/** For a refused action: an unknown refusal keeps the engine's own sentence, which may be an instruction. */
export function refusalWords(error: unknown, fallbackKey: string): FailureWords {
  const code = error instanceof Error ? String((error as { code?: unknown }).code ?? '') : '';
  if (error instanceof Error && error.message && !SAID.has(code) && !KNOWN.has(code) && !ranOutOfTime(error)) return { said: error.message };
  return failureWords(error, fallbackKey);
}

export function sayFailure(words: FailureWords, t: (key: string) => string): string {
  return 'said' in words ? words.said : t(words.key);
}

/** For a message shown once, such as a toast: the words of `failureWords`, translated now. */
export function actionFailureMessage(error: unknown, t: (key: string) => string, fallbackKey: string): string {
  return sayFailure(failureWords(error, fallbackKey), t);
}

/** For a refused action shown once, such as a toast: the words of `refusalWords`, translated now. */
export function refusalMessage(error: unknown, t: (key: string) => string, fallbackKey: string): string {
  return sayFailure(refusalWords(error, fallbackKey), t);
}
