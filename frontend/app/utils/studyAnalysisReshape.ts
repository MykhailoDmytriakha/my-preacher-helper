import { analysisMarkdown, joinAnalyses, passageWords, reshapeAnalysis, storedAnalysis, storedState, type AnalysisState } from '@/utils/passageAnalysis';
import { bookIndex, verseAfter, verseBefore, type PickedPassage, type VerseAt } from '@/utils/passagePick';
import { analysisPassage, analysisSourceMatches } from '@/utils/studyAnalysisSource';

import type { ScriptureReference, StudyAnalysis, StudyNote } from '@/models/models';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

export type AnalysisReshapeEdit = {
  id: string;
  expected: StudyNote | null;
  fields: { title: string; content: string; analysis: StudyAnalysis; scriptureRefs: ScriptureReference[] };
};

export type AnalysisReshapeMessage =
  | { kind: 'done'; passage: PickedPassage }
  | { kind: 'joined'; passage: PickedPassage; other: PickedPassage }
  | { kind: 'own'; passage: PickedPassage };

export type AnalysisReshapePlan = { sourceId: string; edits: AnalysisReshapeEdit[]; messages: AnalysisReshapeMessage[] };

type BuildAnalysisReshapePlanInput = {
  sourceId: string;
  next: PickedPassage;
  text: BookText | null;
  bookId: string;
  bible: BibleId;
  notes: readonly StudyNote[];
  newId: () => string;
  titleFor: (passage: PickedPassage) => string;
};

const between = (from: VerseAt, to: VerseAt): PickedPassage => ({ chapter: from.chapter, fromVerse: from.verse, toChapter: to.chapter, toVerse: to.verse });
const startOf = (passage: PickedPassage): VerseAt => ({ chapter: passage.chapter, verse: passage.fromVerse });
const endOf = (passage: PickedPassage): VerseAt => ({ chapter: passage.toChapter, verse: passage.toVerse });

/**
 * Make the note edits and user-facing message tokens for changing an analysis passage's ends.
 * This function never writes, mutates inputs, or fills writer-owned note metadata.
 */
export function buildAnalysisReshapePlan({ sourceId, next, text, bookId, bible, notes, newId, titleFor }: BuildAnalysisReshapePlanInput): AnalysisReshapePlan | null {
  const source = notes.find((note) => note.id === sourceId);
  const reference = source?.scriptureRefs[0];
  const old = analysisPassage(reference, bible);
  if (!text || !source || !old || !analysisSourceMatches(source, bookId, bible, text)) return null;

  const at = (verse: VerseAt) => bookIndex(text, verse);
  if (at(endOf(next)) < at(startOf(old)) || at(startOf(next)) > at(endOf(old))) return null;
  const wordsIn = (from: VerseAt | null, to: VerseAt | null) => (from && to ? passageWords(text, between(from, to)).length : 0);
  const front = at(startOf(next)) > at(startOf(old)) ? wordsIn(startOf(old), verseBefore(text, startOf(next)))
    : -wordsIn(startOf(next), verseBefore(text, startOf(old)));
  const back = at(endOf(next)) < at(endOf(old)) ? wordsIn(verseAfter(text, endOf(next)), endOf(old))
    : -wordsIn(verseAfter(text, endOf(old)), endOf(next));
  const total = passageWords(text, old).length;
  const reshaped = reshapeAnalysis(storedState(source, total), total, front, back);
  if (!reshaped) return null;

  const edits: AnalysisReshapeEdit[] = [];
  const messages: AnalysisReshapeMessage[] = [];
  const fieldsFor = (passage: PickedPassage, state: AnalysisState): AnalysisReshapeEdit['fields'] => {
    const words = passageWords(text, passage);
    return { title: titleFor(passage), content: analysisMarkdown(words, state), analysis: storedAnalysis(state, bible, words.length), scriptureRefs: [] };
  };
  const referenceFor = (passage: PickedPassage, base?: ScriptureReference): ScriptureReference => ({
    ...(base ?? { book: bookId }), bible, id: base?.id ?? newId(), chapter: passage.chapter, fromVerse: passage.fromVerse,
    toChapter: undefined, toVerseChapter: undefined, endChapter: passage.toChapter !== passage.chapter ? passage.toChapter : undefined, toVerse: passage.toVerse,
  });
  const save = (target: StudyNote | null, passage: PickedPassage, state: AnalysisState) => {
    const fields = fieldsFor(passage, state);
    fields.scriptureRefs = [referenceFor(passage, target?.scriptureRefs[0])];
    edits.push({ id: target?.id ?? newId(), expected: target, fields });
  };

  // The source edit is first; recipient work follows in front-then-back order.
  save(source, next, reshaped.state);
  messages.push({ kind: 'done', passage: next });

  const neighbour = (touches: (passage: PickedPassage) => boolean) => notes.find((entry) => entry.id !== sourceId && entry.type === 'analysis'
    && entry.analysis?.bible === bible && entry.scriptureRefs[0]?.book === bookId && (() => {
      const passage = analysisPassage(entry.scriptureRefs[0], bible);
      return Boolean(passage && touches(passage));
    })());
  const keep = (piece: AnalysisState, taken: PickedPassage, side: 'front' | 'back') => {
    const after = verseAfter(text, endOf(taken));
    const before = verseBefore(text, startOf(taken));
    const other = side === 'back'
      ? neighbour((passage) => Boolean(after) && at(startOf(passage)) === at(after!))
      : neighbour((passage) => Boolean(before) && at(endOf(passage)) === at(before!));
    const pieceTotal = passageWords(text, taken).length;
    const otherPassage = other ? analysisPassage(other.scriptureRefs[0], bible) : null;
    if (other && otherPassage) {
      const otherTotal = passageWords(text, otherPassage).length;
      const joined = side === 'back'
        ? joinAnalyses(piece, pieceTotal, storedState(other, otherTotal), otherTotal)
        : joinAnalyses(storedState(other, otherTotal), otherTotal, piece, pieceTotal);
      const passage = side === 'back' ? between(startOf(taken), endOf(otherPassage)) : between(startOf(otherPassage), endOf(taken));
      save(other, passage, joined);
      messages.push({ kind: 'joined', passage: taken, other: passage });
      return;
    }
    save(null, taken, piece);
    messages.push({ kind: 'own', passage: taken });
  };

  const takenFront = verseBefore(text, startOf(next));
  if (reshaped.front && takenFront) keep(reshaped.front, between(startOf(old), takenFront), 'front');
  const takenBack = verseAfter(text, endOf(next));
  if (reshaped.back && takenBack) keep(reshaped.back, between(takenBack, endOf(old)), 'back');
  return { sourceId, edits, messages };
}
