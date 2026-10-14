import { bibleForLocale, isBibleId, type BibleId } from '@/utils/bibles';

import type { AppLocale } from '@/utils/appLocale';

/**
 * THE BIBLE THIS DEVICE READS (owner, 2026-10-14): before the person chooses, the one in the
 * interface's language — so it follows a change of language too; once chosen, the last one chosen.
 * Browser storage can be missing or refuse, so every access is guarded and the choice simply lasts
 * for the visit.
 */
const STORAGE_KEY = 'bible:translation';

export function readTranslation(locale: AppLocale): BibleId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isBibleId(stored)) return stored;
  } catch {
    // Storage refused: the interface's language decides.
  }
  return bibleForLocale(locale);
}

export function saveTranslation(bible: BibleId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, bible);
  } catch {
    // Storage refused: the choice lasts until the page is left.
  }
}
