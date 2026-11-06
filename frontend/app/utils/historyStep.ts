/*
 * A SCREEN OVER THE PAGE AS ONE STEP IN THE BROWSER'S HISTORY (the owner, 03.11: «нажал кнопку назад … открылась Библия,
 * а не разбор… должно запоминать, откуда я пришел, и возвращать на предыдущую»). A screen opened over the page the person
 * stands on adds an entry, so Back — the browser's button, a swipe — closes it and leaves the page as it was; closed by its
 * own way back, it takes that entry again, so Back afterwards goes where it went before the screen opened.
 *
 * The entry is marked in `history.state` with the step's id, beside Next's own fields: they are copied, so the App Router
 * keeps the address in place without a navigation, and on Back restores the page it has under them.
 */
const STEP = 'screenStep';

/** The step being taken back, until the browser has moved off it: a second close must not go back twice. */
let taking: string | null = null;

/** A screen closing because the browser itself moved — Back, Forward, a jump from its list of history. */
let browserMoving = false;

const newStepId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The step the current entry is, if a screen pushed it. */
export function historyStepHere(): string | null {
  if (typeof window === 'undefined') return null;
  const step = ((window.history.state ?? {}) as Record<string, unknown>)[STEP];
  return typeof step === 'string' ? step : null;
}

/**
 * The state for a quiet change of the address (`replaceState`) that keeps a screen's step: the step alone, without Next's
 * own fields — passed back, they make the App Router skip reading the new address (.howto/take-an-address-way-in.md), and
 * passing nothing would wipe the step of a screen standing on this entry (Codex, 04.11).
 */
export function stepStateOnly(): Record<string, string> | null {
  const step = historyStepHere();
  return step ? { [STEP]: step } : null;
}

/** A new entry at `url` (path, query and hash) for a screen opened over the page; its id. `remember` — what the screen
 *  needs to open again on that entry when its address cannot say it (a new analysis with no note yet). */
export function pushHistoryStep(url: string, remember?: Record<string, unknown>): string {
  const step = newStepId();
  window.history.pushState({ ...((window.history.state ?? {}) as Record<string, unknown>), ...remember, [STEP]: step }, '', url);
  return step;
}

/**
 * A screen closed because the browser itself moved (Back, Forward, a jump from its list of history): the entry it stands on
 * now is the one the person chose, so nothing the closing does — taking a step, forgetting the screen in the address —
 * touches history. Codex, 04.11: an entry two back named the same analysis with a step of its own; the closing screen took
 * it for its own and went back once more, past where the person had jumped.
 */
export function closeOnBrowserMove(close: () => void): void {
  browserMoving = true;
  try {
    close();
  } finally {
    browserMoving = false;
  }
}

/** Whether a screen is closing because the browser moved (`closeOnBrowserMove`): history is not the closing's to change. */
export function browserMoved(): boolean {
  return browserMoving;
}

/** The screen's step taken back, when the current entry is it — true then; false when the entry is another. */
export function takeHistoryStep(step: string | null): boolean {
  if (!step || historyStepHere() !== step) return false;
  if (taking !== step) {
    taking = step;
    window.addEventListener('popstate', () => { taking = null; }, { once: true });
    window.history.back();
  }
  return true;
}
