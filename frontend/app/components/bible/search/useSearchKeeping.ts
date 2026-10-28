'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { lineKey } from '@/utils/bibleSearch/words';

import { forgetSearch, rememberSearch, type SearchHistoryEntry } from '../searchHistoryStore';

import { KEEP_AFTER_MS, type SearchToKeep } from './searchKeeping';
import { useVisibleRest } from './useVisibleRest';

import type { BibleId } from '@/utils/bibles';

/**
 * The history keeping the search shown (`searchKeeping.ts`): at once by an act on its results, or after it stood
 * unchanged in sight. Each search is kept once while it stands. `typed` is the field as the person left it, and the
 * person's own acts hold by it, not by what the line came to mean (Codex review, 2026-10-27): the clock starts again on
 * any edit of the field, a space or a capital too, and on a new reading of it; a refusal — an entry taken out, the
 * history cleared — holds while the field stands, though a book arriving or the layout turned changes what it reads;
 * a search set off by a press on the results («искать как слова», a wider place, a book) waits for its own answer,
 * through the books still coming, until the field is edited or the history cleared. A new act keeps a refused one again.
 */
export function useSearchKeeping(keep: SearchToKeep | null, bible: BibleId, inSight: boolean, typed: string) {
  const keyOf = useCallback((text: string, wordsOn: boolean) => `${bible}|${wordsOn ? 1 : 0}|${lineKey(text)}`, [bible]);
  const keepKey = keep ? keyOf(keep.line, keep.asWords) : null;
  const keptKey = useRef<string | null>(null);
  const launch = useRef<{ key: string; typed: string } | null>(null);
  const [declined, setDeclined] = useState<{ typed: string; keys: ReadonlySet<string> | 'all' } | null>(null);
  useEffect(() => {
    keptKey.current = null;
  }, [keepKey]);
  useEffect(() => {
    setDeclined((now) => (now && now.typed !== typed ? null : now));
  }, [typed]);
  const isDeclined = declined !== null && declined.typed === typed && keepKey !== null && (declined.keys === 'all' || declined.keys.has(keepKey));

  const keepLine = useCallback((text: string, wordsOn: boolean) => {
    const key = keyOf(text, wordsOn);
    if (keptKey.current === key) return;
    keptKey.current = key;
    rememberSearch(text, bible, wordsOn);
  }, [bible, keyOf]);
  const keepShown = useCallback(() => { if (keep) keepLine(keep.line, keep.asWords); }, [keep, keepLine]);
  /** The history cleared: nothing the field shows now is kept back by the clock, and no press waits to keep one. */
  const declineAll = useCallback(() => {
    keptKey.current = null;
    launch.current = null;
    setDeclined({ typed, keys: 'all' });
  }, [typed]);
  const forgetEntry = useCallback((entry: SearchHistoryEntry) => {
    forgetSearch(entry);
    if (entry.bible !== bible) return;
    const key = keyOf(entry.line, Boolean(entry.asWords));
    if (keptKey.current === key) keptKey.current = null;
    if (launch.current?.key === key) launch.current = null;
    setDeclined((now) => {
      if (now && now.typed === typed) return now.keys === 'all' ? now : { typed, keys: new Set([...now.keys, key]) };
      return { typed, keys: new Set([key]) };
    });
  }, [bible, keyOf, typed]);

  /** A press set off the search `text` («as words» when `wordsOn`), leaving the field as `field`. */
  const launched = useCallback((text: string, wordsOn: boolean, field: string) => { launch.current = { key: keyOf(text, wordsOn), typed: field }; }, [keyOf]);
  useEffect(() => {
    const now = launch.current;
    if (!now) return;
    if (now.typed !== typed) {
      launch.current = null;
      return;
    }
    if (!inSight || keepKey === null) return;
    if (keepKey === now.key) keepShown();
    launch.current = null;
  }, [typed, keepKey, inSight, keepShown]);

  useVisibleRest(keep?.byRest && !isDeclined ? `${keepKey}#${typed}#${keep.meaning}` : null, inSight, KEEP_AFTER_MS, keepShown);
  return { keepLine, keepShown, forgetEntry, declineAll, launched };
}
