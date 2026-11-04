import { bibleHref } from '@/utils/bibleLink';
import { browserMoved, historyStepHere, pushHistoryStep, stepStateOnly, takeHistoryStep } from '@/utils/historyStep';
import { addressWithout } from '@/utils/urlUtils';

import type { AnalysisMode } from './AnalysisParts';
import type { StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';

/*
 * THE OPEN ANALYSIS IN THE PAGE'S ADDRESS (the owner, 30.10: «при обновлении не выкидывало в текст Библии»): the reader's
 * address gains `analysis=<note id>` and `mode=edit|view` while an analysis is open, so a reload opens it again, in the
 * same mode. Written with the History API, as the reader keeps its own address (`(pages)/(private)/bible/page.tsx`), Next's
 * own fields in `history.state` kept. Opened over the page, the screen is one step in history (`utils/historyStep.ts`, the
 * owner 03.11): Back closes it; arrived at by an address — a link, a reload — it adds none, and Back leaves for where the
 * person came from. A change of mode, or a new analysis given its note, is written in place.
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
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
}

/**
 * The screen opened over the page: a step in history naming this analysis — or, a new one with no note yet, the page's
 * own address until it has one. Its id, for `leaveAnalysisAddress`.
 */
export function openAnalysisStep(value: AnalysisAddress | null): string {
  return pushHistoryStep(addressNaming(value));
}

/**
 * The analysis `id` closed while the page stays: its screen's step taken back, so the entry before it — the list, the
 * reader's text — is where Back led before; with no step of its own (arrived at by an address) the address forgets it in
 * place. Only while the address still names it: an entry the person has moved on to — another page, another analysis — is
 * not theirs to change. `step` — the screen's own; left out, the step of the entry naming it, if that entry is one (where
 * the screen never came on: a book that could not be read, an analysis this device does not hold). Closed because the
 * browser moved, it leaves history alone: the entry is the one the person chose (`closeOnBrowserMove`).
 */
export function leaveAnalysisAddress(id: string | null, step: string | null = id && readAnalysisAddress()?.id === id ? historyStepHere() : null): void {
  if (typeof window === 'undefined' || browserMoved()) return;
  if (takeHistoryStep(step)) return;
  // An entry another screen stands on — a step not this one's — is that screen's, even naming the same analysis (a late
  // cleanup rewrote it to the list's address, seen on the build machine, 04.11).
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

/*
 * AN ANALYSIS'S TWO HOMES (the owner, 03.11: «перекрёстки»): its passage in the Bible, and the list of all analyses in
 * Studies. Its screen's way back leads where the person came from; its door leads to the other home — from Studies to the
 * passage, from the Bible to the list (`AnalysisDoor`).
 */

/** The reader opened at an analysis's passage, lit, in the Bible it was made in; `from` — the way back. Null with no passage. */
export function analysisPassageHref(note: Pick<StudyNote, 'scriptureRefs'>, { locale, from }: { locale: AppLocale; from?: string }): string | null {
  const reference = note.scriptureRefs?.[0];
  return reference ? bibleHref(reference, { locale, from }) : null;
}

/** The analysis the list of analyses is opened at: its card brought into sight and lit for a moment. */
const LIST_AT = 'at';

/** Studies' list of analyses opened at this one — at its top for an analysis not kept yet. */
export function analysesListHref(id: string | null): string {
  const query = new URLSearchParams({ tab: 'analyses' });
  if (id) query.set(LIST_AT, id);
  return `/studies?${query.toString()}`;
}

/** The analysis the list was opened at, if the address names one. */
export function readListArrival(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(LIST_AT) || null;
}

/**
 * The way in taken: the address lets go of the analysis the list was opened at, in place and without a navigation, so a
 * reload does not bring the card back into sight. Next's own state is not passed back, so the App Router reads the new
 * address (.howto/take-an-address-way-in.md); the step of a window open over the list is kept (`stepStateOnly`).
 */
export function forgetListArrival(): void {
  const path = addressWithout(window.location.href, LIST_AT);
  if (path) window.history.replaceState(stepStateOnly(), '', path);
}

/**
 * THE SCREEN A STUDY NOTE OPENS ON from outside Studies (a sermon's sources and prep): an analysis opens in the Bible's
 * analysis screen, where its structure is read and changed beside its passage (the owner, 31.10: «он должен вести на
 * страницу разбора структуры… а не заметки»), for reading first; any other note on its own page. Inside Studies the same
 * screen opens over the list (`studies/StudyAnalysisWindow.tsx`, the owner 02.11). `from` is the way back the reader offers.
 */
export function noteScreenHref(note: Pick<StudyNote, 'id' | 'type' | 'scriptureRefs'>, { locale, from }: { locale: AppLocale; from?: string }): string {
  const reader = note.type === 'analysis' ? analysisPassageHref(note, { locale, from }) : null;
  return reader ? withAnalysisAddress(reader, { id: note.id, mode: 'view' }) : `/studies/${note.id}`;
}
