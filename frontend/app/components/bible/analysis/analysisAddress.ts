import { bibleHref } from '@/utils/bibleLink';
import { bibleForLocale, isBibleId } from '@/utils/bibles';
import { replaceHistoryAddress } from '@/utils/historyEntry';
import { browserMoved, historyStepHere, pushHistoryStep, stepStateOnly, takeHistoryStep } from '@/utils/historyStep';
import { analysisReferenceForReading } from '@/utils/studyAnalysisSource';
import { addressWithout } from '@/utils/urlUtils';

import type { AnalysisMode } from './AnalysisParts';
import type { PickedPassage } from '../verseCopy/passagePick';
import type { StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

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

/** The current address naming this analysis in this mode, or — `null` — none. */
function addressNaming(value: AnalysisAddress | null): string {
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(ID, value.id);
    url.searchParams.set(MODE, value.mode);
  } else {
    url.searchParams.delete(ID);
    url.searchParams.delete(MODE);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The address names this analysis in this mode, or — `null` — no analysis; in place, no new entry. */
export function writeAnalysisAddress(value: AnalysisAddress | null): void {
  if (typeof window === 'undefined') return;
  const next = addressNaming(value);
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) replaceHistoryAddress(next);
}

/** Follow the analysis's own words through the reader's canonical arrival, without a server navigation. */
export function writeAnalysisSourceAddress(value: AnalysisAddress, reference: ScriptureRefShape, bible: BibleId, locale: AppLocale): void {
  if (typeof window === 'undefined') return;
  const from = new URLSearchParams(window.location.search).get('from') ?? undefined;
  const href = bibleHref(analysisReferenceForReading(reference), { locale, from, readingBible: bible });
  if (!href) return;
  const url = new URL(href, window.location.origin);
  url.searchParams.set(ID, value.id);
  url.searchParams.set(MODE, value.mode);
  const next = `${url.pathname}${url.search}`;
  if (next !== `${window.location.pathname}${window.location.search}`) replaceHistoryAddress(next);
}

/** Open the analysis over its current page as one browser-history step. */
export function openAnalysisStep(value: AnalysisAddress | null, passage?: PickedPassage): string {
  return pushHistoryStep(addressNaming(value), value || !passage ? undefined : { [NEW_PASSAGE]: passage });
}

const NEW_PASSAGE = 'analysisPassage';

/** A new analysis passage retained on its history step before a note exists. */
export function readNewAnalysisStep(): PickedPassage | null {
  if (typeof window === 'undefined') return null;
  const kept = ((window.history.state ?? {}) as Record<string, unknown>)[NEW_PASSAGE] as PickedPassage | undefined;
  return kept && typeof kept.chapter === 'number' && typeof kept.fromVerse === 'number' ? kept : null;
}

/** Close the named analysis's step, unless the browser already moved to another entry. */
export function leaveAnalysisAddress(id: string | null, step: string | null = id && readAnalysisAddress()?.id === id ? historyStepHere() : null): void {
  if (typeof window === 'undefined' || browserMoved()) return;
  if (takeHistoryStep(step)) return;
  const standing = historyStepHere();
  if (standing && standing !== step) return;
  if (id && readAnalysisAddress()?.id === id) writeAnalysisAddress(null);
}

/** A reader's address that opens this analysis in this mode — from a screen outside the reader, e.g. a sermon's prep. */
export function withAnalysisAddress(href: string, value: AnalysisAddress): string {
  const url = new URL(href, 'https://app.invalid');
  url.searchParams.set(ID, value.id);
  url.searchParams.set(MODE, value.mode);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The passage's reader address, opening in the Bible that owns the analysis words. */
export function analysisPassageHref(note: Pick<StudyNote, 'analysis' | 'scriptureRefs'>, { locale, from }: { locale: AppLocale; from?: string }): string | null {
  const reference = note.scriptureRefs?.[0];
  if (!reference) return null;
  const sourceBible = note.analysis?.bible ?? reference.bible;
  const readingBible = isBibleId(sourceBible) ? sourceBible : bibleForLocale(locale);
  return bibleHref(analysisReferenceForReading(reference), { locale, from, readingBible });
}

/** The analysis the Studies list should bring into sight and briefly highlight. */
const LIST_AT = 'at';

/** The analyses list's arrival, or its top when a new analysis has not yet been saved. */
export function analysesListHref(id: string | null): string {
  const query = new URLSearchParams({ tab: 'analyses' });
  if (id) query.set(LIST_AT, id);
  return `/studies?${query.toString()}`;
}

/** Read the list arrival after the router has published its address. */
export function readListArrival(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(LIST_AT) || null;
}

/** Remove the one-shot list arrival while retaining only the current history step for an open window. */
export function forgetListArrival(): void {
  if (typeof window === 'undefined') return;
  const path = addressWithout(window.location.href, LIST_AT);
  if (path) window.history.replaceState(stepStateOnly(), '', path);
}

/**
 * THE SCREEN A STUDY NOTE OPENS ON — one rule for every door to a note: an analysis opens in the Bible's analysis screen,
 * where its structure is read and changed (the owner, 31.10: «он должен вести на страницу разбора структуры… а не
 * заметки»), for reading first; any other note on its own page. `from` is the way back the reader offers.
 */
export function noteScreenHref(note: Pick<StudyNote, 'id' | 'type' | 'analysis' | 'scriptureRefs'>, { locale, from }: { locale: AppLocale; from?: string }): string {
  const reader = note.type === 'analysis' ? analysisPassageHref(note, { locale, from }) : null;
  return reader ? withAnalysisAddress(reader, { id: note.id, mode: 'view' }) : `/studies/${note.id}`;
}
