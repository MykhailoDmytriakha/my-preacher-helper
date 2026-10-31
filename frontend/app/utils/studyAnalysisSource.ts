import { isBibleId, type BibleId } from '@/utils/bibles';
import { passagesIn } from '@/utils/scriptureReferenceNumbering';

import type { ScriptureRefShape } from '@/utils/scriptureReference';

/** Word positions belong to one Bible and canonical book, independently of verse numbering. */
export type StudyAnalysisSource = { bible: BibleId; book: string };
export type StudyAnalysisPassageIdentity = StudyAnalysisSource & {
  chapter: number;
  fromVerse: number;
  toChapter: number;
  toVerse: number;
};
type AnalysisDocument = { type?: unknown; analysis?: unknown; scriptureRefs?: unknown };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function studyAnalysisSource(value: AnalysisDocument | null | undefined): StudyAnalysisSource | null {
  if (value?.type !== 'analysis') return null;
  const bible = record(value.analysis)?.bible;
  const book = Array.isArray(value.scriptureRefs) ? record(value.scriptureRefs[0])?.book : undefined;
  return isBibleId(bible) && typeof book === 'string' && book.length > 0 ? { bible, book } : null;
}

/** A known source cannot change under existing word indices. Unrelated legacy fields stay editable. */
export function preservesStudyAnalysisSource(previous: AnalysisDocument | null | undefined, next: AnalysisDocument): boolean {
  const source = studyAnalysisSource(previous);
  if (!source) return true;
  if (next.type !== 'analysis') return false;
  const candidate = studyAnalysisSource(next);
  return candidate?.bible === source.bible && candidate.book === source.book;
}

export function analysisSourceMatches(value: AnalysisDocument | null | undefined, book: string, bible: BibleId, text: { id: string }): boolean {
  const source = studyAnalysisSource(value);
  return Boolean(source && source.bible === bible && source.book === book && text.id === book);
}

/** Only this feature formerly wrote exact verse endings as toChapter; retain those analyses on read. */
export function analysisReferenceForReading(reference: ScriptureRefShape): ScriptureRefShape {
  return reference.fromVerse !== undefined && reference.endChapter === undefined && reference.toChapter !== undefined
    ? { ...reference, endChapter: reference.toChapter } : reference;
}

/** Word indices need the complete contiguous source passage; a disconnected projection is never truncated. */
export function analysisPassage(reference: ScriptureRefShape | undefined, bible?: BibleId): { chapter: number; fromVerse: number; toChapter: number; toVerse: number } | null {
  if (!reference || reference.chapter === undefined || reference.fromVerse === undefined) return null;
  const passages = passagesIn(analysisReferenceForReading(reference), bible);
  if (passages.length !== 1 || passages[0].fromVerse === undefined || passages[0].toVerse === undefined) return null;
  return { ...passages[0], fromVerse: passages[0].fromVerse, toVerse: passages[0].toVerse };
}

/** Complete normalized passage identity; unlike positional basis, word count is not needed. */
export function studyAnalysisPassageIdentity(value: AnalysisDocument | null | undefined): StudyAnalysisPassageIdentity | null {
  const source = studyAnalysisSource(value);
  const reference = Array.isArray(value?.scriptureRefs) ? value.scriptureRefs[0] as ScriptureRefShape : undefined;
  const passage = source && analysisPassage(reference, source.bible);
  return source && passage ? { ...source, ...passage } : null;
}

/** Unknown or incomplete sources never compare equal for admission. */
export function sameStudyAnalysisPassage(a: AnalysisDocument | null | undefined, b: AnalysisDocument | null | undefined): boolean {
  const left = studyAnalysisPassageIdentity(a), right = studyAnalysisPassageIdentity(b);
  return Boolean(left && right && left.bible === right.bible && left.book === right.book
    && left.chapter === right.chapter && left.fromVerse === right.fromVerse
    && left.toChapter === right.toChapter && left.toVerse === right.toVerse);
}

/** Positions belong to the complete contiguous passage in its immutable Bible corpus. */
export function studyAnalysisPositionBasis(value: AnalysisDocument | null | undefined): (StudyAnalysisSource & {
  chapter: number; fromVerse: number; toChapter: number; toVerse: number; words: number;
}) | null {
  const source = studyAnalysisSource(value);
  const words = record(value?.analysis)?.words;
  const reference = Array.isArray(value?.scriptureRefs) ? value.scriptureRefs[0] as ScriptureRefShape : undefined;
  const passage = source && analysisPassage(reference, source.bible);
  return source && passage && typeof words === 'number' && Number.isSafeInteger(words) && words > 0
    ? { ...source, ...passage, words } : null;
}
