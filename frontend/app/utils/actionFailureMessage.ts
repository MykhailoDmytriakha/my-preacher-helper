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
/** A value in a sentence: words as they are, or a key said in the current language (a field's name). */
export type FailureValue = string | { key: string };
/** One sentence — by key, or words as they are — or several said one after another (`parts`). */
export type FailureWords =
  | { said: string }
  | { key: string; values?: Record<string, FailureValue> }
  | { parts: FailureWords[] };

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

/**
 * An error the screen says to the person itself: a key and its values, said in the current language
 * when shown, so a language switch re-says it (BUG-20261003-said-refusal-keeps-old-language).
 */
export function saidError(key: string, values?: Record<string, FailureValue>): Error {
  return Object.assign(new Error(key), { code: 'said', say: { key, ...(values ? { values } : {}) } });
}

/** "Fill in <field>", kept as keys: the words a form shows, and the refusal it throws. */
export const fillRequiredField = (fieldKey: string): FailureWords => ({ key: 'common.fillRequiredField', values: { field: { key: fieldKey } } });
export const fillRequiredFieldError = (fieldKey: string): Error => saidError('common.fillRequiredField', { field: { key: fieldKey } });

/** A change refused because the screen shows a copy for reading; the reason is said when shown. */
export function readOnlyError(key: string): Error {
  return Object.assign(new Error(key), { code: 'read-only', say: { key } });
}

const sayOf = (error: unknown): FailureWords | null => {
  const say = (error as { say?: unknown } | null)?.say as { key?: unknown; values?: Record<string, FailureValue> } | undefined;
  return say && typeof say.key === 'string' && say.key ? { key: say.key, ...(say.values ? { values: say.values } : {}) } : null;
};

export function failureWords(error: unknown, fallbackKey: string): FailureWords {
  const code = error instanceof Error ? String((error as { code?: unknown }).code ?? '') : '';
  const said = SAID.has(code) ? sayOf(error) : null;
  if (said) return said;
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

type Translate = (key: string, values?: Record<string, string>) => string;

/** Each sentence of the words, in order, however the parts are nested. */
const sentencesOf = (words: FailureWords, t: Translate): string[] =>
  'parts' in words ? words.parts.flatMap(part => sentencesOf(part, t)) : [sayFailure(words, t)];

export function sayFailure(words: FailureWords, t: Translate): string {
  if ('said' in words) return words.said;
  // Two causes that read the same in this language are said once.
  if ('parts' in words) return [...new Set(sentencesOf(words, t))].join(' ');
  if (!words.values) return t(words.key);
  const values = Object.fromEntries(Object.entries(words.values).map(([name, value]) => [name, typeof value === 'string' ? value : t(value.key)]));
  return t(words.key, values);
}

/** For a message shown once, such as a toast: the words of `failureWords`, translated now. */
export function actionFailureMessage(error: unknown, t: Translate, fallbackKey: string): string {
  return sayFailure(failureWords(error, fallbackKey), t);
}

/** For a refused action shown once, such as a toast: the words of `refusalWords`, translated now. */
export function refusalMessage(error: unknown, t: Translate, fallbackKey: string): string {
  return sayFailure(refusalWords(error, fallbackKey), t);
}
