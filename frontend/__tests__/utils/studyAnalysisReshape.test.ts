import { buildAnalysisReshapePlan } from '@/utils/studyAnalysisReshape';
import { passageWords } from '@/utils/passageAnalysis';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

import kjvPsalms from '../../public/bible-text/kjv/v1/psalms.json';

const TEXT: BookText = { id: 'Ephesians', chapters: [['a b c', 'd e f', 'g h i'], ['j k l', 'm n o', 'p q r']] };
const passage = (chapter: number, fromVerse: number, toChapter = chapter, toVerse = fromVerse) => ({ chapter, fromVerse, toChapter, toVerse });
const note = (id: string, range: ReturnType<typeof passage>, cuts: number[] = [], book = 'Ephesians'): StudyNote => ({
  id, userId: 'owner', title: id, content: 'old content', tags: ['kept'], isDraft: false, materialIds: ['sermon'], createdAt: 'created', updatedAt: 'updated', type: 'analysis',
  scriptureRefs: [{ id: `ref-${id}`, bible: 'kjv', book, chapter: range.chapter, fromVerse: range.fromVerse, ...(range.toChapter !== range.chapter ? { endChapter: range.toChapter } : {}), toVerse: range.toVerse }],
  analysis: { bible: 'kjv', words: 3 * ((range.toChapter - range.chapter) * 3 + range.toVerse - range.fromVerse + 1), cuts, links: {}, relations: {} },
});

function plan(source: StudyNote, next: ReturnType<typeof passage>, notes: StudyNote[] = [source]) {
  let nextId = 0;
  const newId = jest.fn(() => `new-${++nextId}`);
  const result = buildAnalysisReshapePlan({ sourceId: source.id, next, text: TEXT, bookId: 'Ephesians', bible: 'kjv', notes, newId, titleFor: (p) => `Title ${p.chapter}:${p.fromVerse}-${p.toChapter}:${p.toVerse}` });
  return { result, newId };
}

describe('buildAnalysisReshapePlan', () => {
  it('makes a single source edit when removed verses contain no work', () => {
    const source = note('source', passage(1, 1, 1, 3));
    const originalRef = source.scriptureRefs;
    const { result, newId } = plan(source, passage(1, 2, 1, 3));

    expect(result).not.toBeNull();
    expect(result?.edits).toHaveLength(1);
    expect(result?.edits[0]).toMatchObject({ id: 'source', expected: source, fields: { title: 'Title 1:2-1:3', analysis: { bible: 'kjv', words: 6, cuts: [] } } });
    expect(result?.edits[0].expected?.scriptureRefs).toBe(originalRef);
    expect(result?.messages).toEqual([{ kind: 'done', passage: passage(1, 2, 1, 3) }]);
    expect(newId).not.toHaveBeenCalled();
  });

  it('keeps authored work from both ends as new notes and preserves word positions through a chapter seam', () => {
    const source = note('source', passage(1, 2, 2, 2), [1, 2, 4, 10, 11]);
    const before = JSON.stringify(source);
    const { result, newId } = plan(source, passage(1, 3, 2, 1));

    expect(result?.edits.map(({ id, expected, fields }) => ({ id, expected, passage: fields.scriptureRefs[0] && [fields.scriptureRefs[0].chapter, fields.scriptureRefs[0].fromVerse, fields.scriptureRefs[0].endChapter, fields.scriptureRefs[0].toVerse], words: fields.analysis.words, cuts: fields.analysis.cuts }))).toEqual([
      { id: 'source', expected: source, passage: [1, 3, 2, 1], words: 6, cuts: [1] },
      { id: 'new-2', expected: null, passage: [1, 2, undefined, 2], words: 3, cuts: [1, 2] },
      { id: 'new-4', expected: null, passage: [2, 2, undefined, 2], words: 3, cuts: [1, 2] },
    ]);
    expect(result?.messages).toEqual([
      { kind: 'done', passage: passage(1, 3, 2, 1) },
      { kind: 'own', passage: passage(1, 2) },
      { kind: 'own', passage: passage(2, 2) },
    ]);
    expect(newId).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('joins removed front and back work into the adjacent existing analysis in the same Bible', () => {
    const source = note('source', passage(1, 2, 2, 2), [1, 2, 4, 10, 11]);
    const front = note('front', passage(1, 1), [1]);
    const back = note('back', passage(2, 3), [1]);
    const frontRefs = front.scriptureRefs;
    const backRefs = back.scriptureRefs;
    const { result, newId } = plan(source, passage(1, 3, 2, 1), [source, front, back]);

    expect(result?.edits.map(({ id, expected, fields }) => ({ id, expected, refId: fields.scriptureRefs[0].id, range: [fields.scriptureRefs[0].chapter, fields.scriptureRefs[0].fromVerse, fields.scriptureRefs[0].endChapter, fields.scriptureRefs[0].toVerse], cuts: fields.analysis.cuts }))).toEqual([
      { id: 'source', expected: source, refId: 'ref-source', range: [1, 3, 2, 1], cuts: [1] },
      { id: 'front', expected: front, refId: 'ref-front', range: [1, 1, undefined, 2], cuts: [1, 3, 4, 5] },
      { id: 'back', expected: back, refId: 'ref-back', range: [2, 2, undefined, 3], cuts: [1, 2, 3, 4] },
    ]);
    expect(result?.edits[1].expected?.scriptureRefs).toBe(frontRefs);
    expect(result?.edits[2].expected?.scriptureRefs).toBe(backRefs);
    expect(result?.messages).toEqual([
      { kind: 'done', passage: passage(1, 3, 2, 1) },
      { kind: 'joined', passage: passage(1, 2), other: passage(1, 1, 1, 2) },
      { kind: 'joined', passage: passage(2, 2), other: passage(2, 2, 2, 3) },
    ]);
    expect(newId).not.toHaveBeenCalled();
  });

  it('rejects a different source Bible, a different book, and a nonoverlapping new passage', () => {
    const source = note('source', passage(1, 1, 1, 3));
    expect(plan({ ...source, analysis: { ...source.analysis!, bible: 'rst' } }, passage(1, 2, 1, 3)).result).toBeNull();
    expect(plan(note('wrong-book', passage(1, 1, 1, 3), [], 'Romans'), passage(1, 2, 1, 3)).result).toBeNull();
    expect(plan(source, passage(2, 1, 2, 2)).result).toBeNull();
  });

  it('stores the injected Bible identity and preserves the original note and reference objects as provenance', () => {
    const source = note('source', passage(1, 1, 1, 3));
    const originalReferenceArray = source.scriptureRefs;
    const originalReference = source.scriptureRefs[0];
    const { result } = plan(source, passage(1, 2, 1, 3));

    expect(result?.edits[0].expected).toBe(source);
    expect(result?.edits[0].expected?.scriptureRefs).toBe(originalReferenceArray);
    expect(result?.edits[0].expected?.scriptureRefs[0]).toBe(originalReference);
    expect(result?.edits[0].fields.analysis.bible).toBe('kjv');
    expect(result?.edits[0].fields.scriptureRefs[0]).not.toBe(originalReference);
    expect(result?.edits[0].fields.scriptureRefs[0].id).toBe('ref-source');
  });

  it('reads a stored reference in the analysis Bible numbering before planning edits', () => {
    const psalms = kjvPsalms as BookText;
    const total = passageWords(psalms, passage(51, 10)).length;
    const source: StudyNote = {
      id: 'psalm-source', userId: 'owner', title: 'Psalm', content: '', tags: [], isDraft: false, createdAt: '', updatedAt: '', type: 'analysis',
      scriptureRefs: [{ id: 'psalm-ref', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12, toVerse: 12 }],
      analysis: { bible: 'kjv', words: total, cuts: [], links: {}, relations: {} },
    };
    const newId = jest.fn(() => 'unexpected-id');
    const result = buildAnalysisReshapePlan({
      sourceId: source.id, next: passage(51, 10), text: psalms, bookId: 'Psalms', bible: 'kjv', notes: [source], newId, titleFor: () => 'Psalm 51:10',
    });

    expect(result?.edits[0].fields.scriptureRefs[0]).toMatchObject({ id: 'psalm-ref', bible: 'kjv', book: 'Psalms', chapter: 51, fromVerse: 10, toVerse: 10 });
    expect(result?.edits[0].fields.analysis.bible).toBe('kjv');
    expect(newId).not.toHaveBeenCalled();
  });
});
