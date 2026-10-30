'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { newClientId } from '@/utils/clientId';
import { analysisMarkdown, joinAnalyses, passageWords, reshapeAnalysis, type AnalysisState } from '@/utils/passageAnalysis';

import { bookIndex, verseAfter, verseBefore, type PickedPassage } from '../verseCopy/passagePick';

import { passageOfReference, passageSpan, storedAnalysis, storedState } from './useAnalysisNote';

import type { VerseAt } from '../verseCopy/selectedVerses';
import type { ScriptureReference, StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

const between = (from: VerseAt, to: VerseAt): PickedPassage => ({ chapter: from.chapter, fromVerse: from.verse, toChapter: to.chapter, toVerse: to.verse });
const startOf = (p: PickedPassage): VerseAt => ({ chapter: p.chapter, verse: p.fromVerse });
const endOf = (p: PickedPassage): VerseAt => ({ chapter: p.toChapter, verse: p.toVerse });

/**
 * A PASSAGE'S ANALYSIS GIVEN NEW ENDS (case 2026-10-12-block-diagram; the owner, 2026-10-29: «нужно иметь возможность
 * редактировать объём … куда они пойдут? … в следующий разбор»). The verses chosen again in the reader become the
 * analysis's passage; its parts follow by `reshapeAnalysis`. Work in the verses taken off is never lost: it joins the
 * analysis that touches them, if there is one, or becomes an analysis of its own; untouched verses just go. Returns
 * what happened, in words, or null when the new verses do not touch the analysis.
 */
export function useAnalysisReshape({ text, bookId, bible, locale }: { text: BookText | null; bookId: string; bible: BibleId; locale: AppLocale }) {
  const { t } = useTranslation();
  const engine = useStudyNotesEngine(true);
  return useCallback((id: string, next: PickedPassage): string | null => {
    const note = engine.notes.find((entry) => entry.id === id);
    const old = passageOfReference(note?.scriptureRefs[0]);
    if (!text || !note || !old) return null;
    const at = (verse: VerseAt) => bookIndex(text, verse);
    if (at(endOf(next)) < at(startOf(old)) || at(startOf(next)) > at(endOf(old))) return null;
    const words = (from: VerseAt | null, to: VerseAt | null) => (from && to ? passageWords(text, between(from, to)).length : 0);
    const front = at(startOf(next)) > at(startOf(old)) ? words(startOf(old), verseBefore(text, startOf(next)))
      : -words(startOf(next), verseBefore(text, startOf(old)));
    const back = at(endOf(next)) < at(endOf(old)) ? words(verseAfter(text, endOf(next)), endOf(old))
      : -words(verseAfter(text, endOf(old)), endOf(next));
    const total = passageWords(text, old).length;
    const reshaped = reshapeAnalysis(storedState(note, total), total, front, back);
    if (!reshaped) return null;

    const abbrev = getLocalizedAbbrev(bookId, locale);
    const placeOf = (p: PickedPassage) => `${abbrev} ${passageSpan(p)}`;
    const reference = (p: PickedPassage, base?: ScriptureReference): ScriptureReference => ({
      ...(base ?? { bible, book: bookId }), id: base?.id ?? newClientId(), chapter: p.chapter, fromVerse: p.fromVerse,
      toChapter: p.toChapter !== p.chapter ? p.toChapter : undefined, toVerse: p.toVerse,
    });
    const save = (target: StudyNote | null, p: PickedPassage, state: AnalysisState) => {
      const passageWordsOf = passageWords(text, p);
      const fields = { title: t('analysis.title', { place: placeOf(p) }), content: analysisMarkdown(passageWordsOf, state), analysis: storedAnalysis(state, bible, passageWordsOf.length) };
      if (target) {
        void engine.updateNote({ id: target.id, updates: { ...fields, scriptureRefs: [reference(p, target.scriptureRefs[0])] } }).result.catch(() => undefined);
        return;
      }
      void engine.createNote({ userId: engine.uid ?? '', ...fields, scriptureRefs: [reference(p)], tags: [], type: 'analysis' }).acceptance.catch(() => undefined);
    };
    save(note, next, reshaped.state);

    const said = [t('analysis.reshape.done', { place: placeOf(next) })];
    // Work in the verses taken off: into the analysis that touches them on the far side, else an analysis of its own.
    const neighbour = (touches: (p: PickedPassage) => boolean) => engine.notes.find((entry) => entry.id !== id && entry.type === 'analysis'
      && entry.analysis?.bible === bible && entry.scriptureRefs[0]?.book === bookId && (() => { const p = passageOfReference(entry.scriptureRefs[0]); return Boolean(p && touches(p)); })());
    const keep = (piece: AnalysisState, taken: PickedPassage, side: 'front' | 'back') => {
      const after = verseAfter(text, endOf(taken)); const before = verseBefore(text, startOf(taken));
      const other = side === 'back'
        ? neighbour((p) => Boolean(after) && at(startOf(p)) === at(after!))
        : neighbour((p) => Boolean(before) && at(endOf(p)) === at(before!));
      const pieceTotal = passageWords(text, taken).length;
      const otherPassage = other ? passageOfReference(other.scriptureRefs[0]) : null;
      if (other && otherPassage) {
        const otherTotal = passageWords(text, otherPassage).length;
        const joined = side === 'back'
          ? joinAnalyses(piece, pieceTotal, storedState(other, otherTotal), otherTotal)
          : joinAnalyses(storedState(other, otherTotal), otherTotal, piece, pieceTotal);
        const p = side === 'back' ? between(startOf(taken), endOf(otherPassage)) : between(startOf(otherPassage), endOf(taken));
        save(other, p, joined);
        said.push(t('analysis.reshape.joined', { place: placeOf(taken), other: placeOf(p) }));
        return;
      }
      save(null, taken, piece);
      said.push(t('analysis.reshape.own', { place: placeOf(taken) }));
    };
    const takenFront = verseBefore(text, startOf(next));
    if (reshaped.front && takenFront) keep(reshaped.front, between(startOf(old), takenFront), 'front');
    const takenBack = verseAfter(text, endOf(next));
    if (reshaped.back && takenBack) keep(reshaped.back, between(takenBack, endOf(old)), 'back');
    return said.join(' ');
  }, [bible, bookId, engine, locale, t, text]);
}
