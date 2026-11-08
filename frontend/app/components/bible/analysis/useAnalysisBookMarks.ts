'use client';

import { useCallback, useMemo } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { countVerseWords, verseOrder } from '@/utils/bibleMarks';

import { useBookMarks, type MarksChange } from '../marks/markStore';
import { useMarksWriteGate } from '../marks/useMarksWriteGate';

import type { AnalysisMarks } from './useAnalysisMarks';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';
import type { ReactNode } from 'react';

/**
 * THE BOOK'S MARKS FOR AN ANALYSIS OPENED AWAY FROM THE READER (Studies, the owner 02.11): no reader lends its form of the
 * book here (`useReaderMarks` does over the reader), so the analysis opens that one form itself — the same store and rules
 * (`marks/markStore.ts`, `utils/bibleMarks.ts`), so a mark made here is in the verse and one made in the verse is here.
 * Whether a stroke can be kept now, and why not, is the reader's own rule (`useMarksWriteGate`); here no reader stands
 * beside the screen, so the form's status — the choice when marks changed on two devices — goes into the analysis's
 * own notices (`status`), or a refused stroke could only be told to wait for a choice nowhere to be made (Codex, 02.11).
 * The notice stands on its own: a form that cannot open (the device's storage silent) draws no tools, and says why, with
 * its Retry (Codex, 04.11).
 */
export function useAnalysisBookMarks({ bible, bookId, text }: { bible: BibleId; bookId: string; text: BookText | null }): { source: AnalysisMarks | null; status: ReactNode } {
  const { user } = useAuth();
  const owner = user?.uid ?? null;
  const { marks, save, ready, writable, sync, history } = useBookMarks(owner, bible, bookId);
  const { writableRef, sayWhy, status } = useMarksWriteGate({ writable, sync, history }, 'mb-4', text);
  const order = useMemo(() => (text ? verseOrder(text.chapters, countVerseWords) : null), [text]);
  const mark = useCallback((change: MarksChange, lost: () => void) => {
    if (!writableRef.current) {
      sayWhy();
      return false;
    }
    save(change, lost);
    return true;
  }, [save, sayWhy, writableRef]);
  const source = useMemo(() => (owner && ready && order ? { marks, order, mark } : null), [mark, marks, order, owner, ready]);
  return { source, status };
}
