import { keepAnalysisReshapeFrame } from '../analysisReshapeFields';
import { mergeDocumentFields } from '../protocol';
import type { DocumentData } from '../types';
const original: DocumentData = { userId: 'owner', title: 'Original', content: 'whole passage', tags: [],
  analysis: { bible: 'rst', words: 8, cuts: [5] }, scriptureRefs: [{ chapter: 1, fromVerse: 1, toVerse: 2 }] };
const shortened: DocumentData = { ...original, content: 'first verse', analysis: { bible: 'rst', words: 4, cuts: [] },
  scriptureRefs: [{ chapter: 1, fromVerse: 1, toVerse: 1 }] };

it('restores the complete original frame while keeping later unrelated metadata', () => {
  const later = { ...shortened, title: 'Later title', tags: ['later'] };
  const merged = mergeDocumentFields(shortened, later, original);
  keepAnalysisReshapeFrame(shortened, later, original, merged);
  expect(merged.value.value).toEqual({ ...original, title: 'Later title', tags: ['later'] });
  expect(merged.conflicts).toEqual([]);
});

it('keeps later authored work with its own verses and presents a whole-frame conflict on discard', () => {
  const later = { ...shortened, content: 'later first-verse words', analysis: { bible: 'rst', words: 4, cuts: [2] }, tags: ['later'] };
  const merged = mergeDocumentFields(shortened, later, original);
  keepAnalysisReshapeFrame(shortened, later, original, merged);
  expect(merged.value.value).toEqual(later);
  expect(merged.conflicts.map(conflict => conflict.path)).toEqual([['analysis'], ['content'], ['scriptureRefs']]);
  expect(merged.conflicts.find(conflict => conflict.path[0] === 'scriptureRefs')?.theirs.value).toEqual(original.scriptureRefs);
});

it('keeps later typing on an unchanged accepted frame without creating a conflict', () => {
  const later = { ...shortened, content: 'later words' };
  const accepted = { ...shortened, tags: ['remote'] };
  const merged = mergeDocumentFields(shortened, later, accepted);
  keepAnalysisReshapeFrame(shortened, later, accepted, merged);
  expect(merged.value.value).toEqual({ ...later, tags: ['remote'] });
  expect(merged.conflicts).toEqual([]);
});

it('never mixes later cuts with a different frame returned by an acknowledgement replay', () => {
  const later = { ...shortened, analysis: { bible: 'rst', words: 4, cuts: [2] } };
  const merged = mergeDocumentFields(shortened, later, original);
  keepAnalysisReshapeFrame(shortened, later, original, merged);
  expect(merged.value.value).toEqual(later);
  expect(merged.conflicts).toHaveLength(3);
});
