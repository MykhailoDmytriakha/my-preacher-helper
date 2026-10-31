import { mergeDocumentFields } from '../protocol';
import type { DocumentData } from '../types';

const note: DocumentData = { type: 'analysis', title: 'Original', content: 'Original words',
  analysis: { bible: 'rst', words: 0, cuts: [3], links: {}, relations: {} },
  scriptureRefs: [{ id: 'reference', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 2, toVerse: 2 }] };
const frame = (value: DocumentData) => ({ analysis: value.analysis, content: value.content, scriptureRefs: value.scriptureRefs });

it.each(['zero-count', 'missing-count', 'unreadable-range'])('does not equate unknown %s position bases across different passages', kind => {
  const base = JSON.parse(JSON.stringify(note)) as DocumentData;
  if (kind === 'missing-count') delete (base.analysis as DocumentData).words;
  if (kind === 'unreadable-range') base.scriptureRefs = [{ ...(base.scriptureRefs as DocumentData[])[0], fromVerse: 0 }];
  const mine = { ...base, analysis: { ...(base.analysis as DocumentData), relations: { '1-4': { dir: 'fwd', color: 'amber' } } } };
  const theirs = { ...base, title: 'Remote title', scriptureRefs: [{ ...(base.scriptureRefs as DocumentData[])[0], fromVerse: kind === 'unreadable-range' ? 0 : 1, toVerse: 3 }] };
  const merged = mergeDocumentFields(base, mine, theirs);
  expect(frame(merged.value.value as DocumentData)).toEqual(frame(mine));
  expect((merged.value.value as DocumentData).title).toBe('Remote title');
  expect(merged.conflicts.map(conflict => conflict.path)).toEqual([['analysis'], ['content'], ['scriptureRefs']]);
});

it('still merges title-only changes when legacy positional metadata is unknown', () => {
  const mine = { ...note, title: 'My title' }, theirs = { ...note, tags: ['remote'] };
  const merged = mergeDocumentFields(note, mine, theirs);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value.value).toEqual({ ...theirs, title: 'My title' });
});
