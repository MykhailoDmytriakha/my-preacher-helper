import { bibleHref } from '@/utils/bibleLink';

import type { AnalysisMode } from './AnalysisParts';
import type { StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

/*
 * THE OPEN ANALYSIS IN THE PAGE'S ADDRESS (the owner, 30.10: «при обновлении не выкидывало в текст Библии»): the reader's
 * address gains `analysis=<note id>` and `mode=edit|view` while an analysis is open, so a reload opens it again, in the
 * same mode. Written with the History API in place, as the reader keeps its own address (`(pages)/(private)/bible/page.tsx`):
 * no new history entry, Next's own fields in `history.state` kept.
 */
const ID = 'analysis';
const MODE = 'mode';

export type AnalysisAddress = { id: string; mode: AnalysisMode };

/** The analysis the address names, if any. */
export function readAnalysisAddress(): AnalysisAddress | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const id = query.get(ID);
  if (!id) return null;
  return { id, mode: query.get(MODE) === 'view' ? 'view' : 'edit' };
}

/** The address names this analysis in this mode, or — `null` — no analysis. */
export function writeAnalysisAddress(value: AnalysisAddress | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(ID, value.id);
    url.searchParams.set(MODE, value.mode);
  } else {
    url.searchParams.delete(ID);
    url.searchParams.delete(MODE);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
}

/** A reader's address that opens this analysis in this mode — from a screen outside the reader, e.g. a sermon's prep. */
export function withAnalysisAddress(href: string, value: AnalysisAddress): string {
  const url = new URL(href, 'https://app.invalid');
  url.searchParams.set(ID, value.id);
  url.searchParams.set(MODE, value.mode);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * THE SCREEN A STUDY NOTE OPENS ON — one rule for every door to a note: an analysis opens in the Bible's analysis screen,
 * where its structure is read and changed (the owner, 31.10: «он должен вести на страницу разбора структуры… а не
 * заметки»), for reading first; any other note on its own page. `from` is the way back the reader offers.
 */
export function noteScreenHref(note: Pick<StudyNote, 'id' | 'type' | 'scriptureRefs'>, { locale, from }: { locale: AppLocale; from?: string }): string {
  const reference = note.type === 'analysis' ? note.scriptureRefs?.[0] : undefined;
  const reader = reference ? bibleHref(reference, { locale, from }) : null;
  return reader ? withAnalysisAddress(reader, { id: note.id, mode: 'view' }) : `/studies/${note.id}`;
}
