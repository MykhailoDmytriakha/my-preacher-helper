import rstEphesians from '../../../public/bible-text/rst/v1/ephesians.json';

import { analysisMarkdown, analysisState, passageWords, storedAnalysis, tieTo, type AnalysisState } from '@/utils/passageAnalysis';
import type { BookText } from '@/utils/bibleText';
import type { DocumentData } from '../types';
import { analysisCreationScope, planStudyAnalysisCreation } from '../analysisCreation';

const text = rstEphesians as unknown as BookText;
const passage = { chapter: 1, fromVerse: 2, toChapter: 1, toVerse: 2 };
const words = passageWords(text, passage);
const initialState: AnalysisState = { cuts: [3], links: {}, relations: [] };
const note = (id: string, state: AnalysisState, options: {
  passage?: typeof passage; bible?: string; book?: string; title?: string; tags?: string[];
  extra?: DocumentData;
} = {}): DocumentData => {
  const extent = options.passage ?? passage;
  const bible = options.bible ?? 'rst';
  const book = options.book ?? 'Ephesians';
  const passageWordsForNote = passageWords(text, extent);
  return {
    id, userId: 'owner', type: 'analysis', title: options.title ?? 'Analysis',
    tags: options.tags ?? ['source-tag'], isDraft: false, createdAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z', content: analysisMarkdown(passageWordsForNote, state),
    analysis: storedAnalysis(state, bible as 'rst' | 'ubio' | 'kjv', passageWordsForNote.length) as unknown as DocumentData['analysis'],
    scriptureRefs: [{ id: `${id}-reference`, bible, book, chapter: extent.chapter, fromVerse: extent.fromVerse,
      toVerse: extent.toVerse }],
    ...(options.extra ?? {}),
  };
};
const makePlan = (initial: DocumentData, local: DocumentData, target: DocumentData, sourceText = text) =>
  planStudyAnalysisCreation(initial, local, target, sourceText);
const stateOf = (value: DocumentData) => value.analysis as DocumentData;

describe('study analysis creation transfer planning', () => {
  it('uses a stable feature-generated scope marker', () => {
    expect(analysisCreationScope('generated-id')).toBe('analysis-creation:generated-id');
  });

  it('merges a later local cut with the existing target cut over empty initial mark intent', () => {
    const initial = note('source', initialState);
    const local = note('source', { cuts: [3, 5], links: {}, relations: [] });
    const target = note('target', initialState, { title: 'Keep target title', tags: ['target-tag'] });
    const before = JSON.stringify([initial, local, target]);

    const result = makePlan(initial, local, target);

    expect(words).toHaveLength(12);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.reason);
    expect(stateOf(result.value).cuts).toEqual([3, 5]);
    expect(result.value.content).toBe(local.content);
    expect(result.value.title).toBe('Keep target title');
    expect(result.value.tags).toEqual(['target-tag']);
    expect(JSON.stringify([initial, local, target])).toBe(before);
  });

  it('merges disjoint cuts, links, and relations without merging numeric arrays positionally', () => {
    const localState: AnalysisState = { cuts: [3, 5], links: { 5: 0 },
      relations: [{ a: 1, b: 4, dir: 'fwd', color: 'amber' }] };
    const targetState: AnalysisState = { cuts: [3, 7], links: { 7: 1 },
      relations: [{ a: 8, b: 10, dir: 'back', color: 'teal' }] };
    const initial = note('source', initialState);
    const local = note('source', localState);
    const target = note('target', targetState);

    const result = makePlan(initial, local, target);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.reason);
    expect(stateOf(result.value)).toEqual(storedAnalysis({ cuts: [3, 5, 7], links: { 5: 0, 7: 1 },
      relations: [...localState.relations, ...targetState.relations] }, 'rst', words.length));
  });

  it('preserves both disjoint arrows drawn on separate offline creations', () => {
    const initial = note('source', initialState);
    const local = tieTo({ cuts: [3, 5], links: {}, relations: [] }, 5, 0, words.length);
    const target = tieTo({ cuts: [3, 7], links: {}, relations: [] }, 7, 1, words.length);
    if (local === 'own' || target === 'own') throw new Error('Invalid fixture draw');

    const result = makePlan(initial, note('source', local), note('target', target));

    expect(result).toMatchObject({ kind: 'ready', value: {
      analysis: { cuts: [3, 5, 7], links: { 5: 0, 7: 1 }, drawn: [5, 7] },
    } });
  });

  it('keeps an explicit arrow when the other copy uses the same tie without an arrow', () => {
    const initial = note('source', initialState);
    const plain: AnalysisState = { cuts: [3], links: { 3: 0 }, relations: [] };
    const drawn = tieTo(plain, 3, 0, words.length);
    if (drawn === 'own') throw new Error('Invalid fixture draw');
    const target = note('target', plain);
    stateOf(target).drawn = [];

    const result = makePlan(initial, note('source', drawn), target);

    expect(result).toMatchObject({ kind: 'ready', value: { analysis: { links: { 3: 0 }, drawn: [3] } } });
  });

  it('keeps different drawn endpoints on the same line for review', () => {
    const initial = note('source', initialState);
    const local = tieTo(initialState, 3, 0, words.length);
    const target = tieTo(initialState, 3, 1, words.length);
    if (local === 'own' || target === 'own') throw new Error('Invalid fixture draw');

    expect(makePlan(initial, note('source', local), note('target', target))).toEqual({
      kind: 'review',
      reason: 'The local and existing marks disagree at the same position.',
    });
  });

  it('does not treat the first generated mark as a permanent merge baseline', () => {
    const initial = note('source', { cuts: [3], links: {}, relations: [] });
    const local = note('source', { cuts: [5], links: {}, relations: [] });
    const target = note('target', { cuts: [7], links: {}, relations: [] });

    const result = makePlan(initial, local, target);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.reason);
    expect(stateOf(result.value).cuts).toEqual([5, 7]);
  });

  it('accepts identical marks on both copies and treats missing relations as empty', () => {
    const same: AnalysisState = { cuts: [3, 5], links: { 5: 0 }, relations: [] };
    const initial = note('source', initialState);
    const local = note('source', same);
    const target = note('target', same);
    delete stateOf(target).relations;

    const result = makePlan(initial, local, target);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.reason);
    expect(stateOf(result.value)).toEqual(storedAnalysis(same, 'rst', words.length));
  });

  it('requires all three inputs to name the same Bible and passage', () => {
    const initial = note('source', initialState);
    const local = note('source', initialState);
    const otherBible = note('target', initialState, { bible: 'kjv' });
    const otherPassage = note('target', initialState, { passage: { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 } });

    expect(makePlan(initial, local, otherBible).kind).toBe('review');
    expect(makePlan(initial, local, otherPassage).kind).toBe('review');
  });

  it('checks the actual BookText identity and passage word count against the stored basis', () => {
    const initial = note('source', initialState);
    const local = note('source', initialState);
    const target = note('target', initialState);
    const wrongText = { ...text, id: 'Philippians' } as BookText;
    const wrongCount = { ...target, analysis: { ...stateOf(target), words: words.length + 1 } };

    expect(makePlan(initial, local, target, wrongText).kind).toBe('review');
    expect(makePlan(initial, local, wrongCount).kind).toBe('review');
  });

  it('reviews a conflicting link at the same cut anchor or a conflicting relation at the same pair', () => {
    const initial = note('source', initialState);
    const localLink = note('source', { cuts: [3, 5], links: { 5: 0 }, relations: [] });
    const targetLink = note('target', { cuts: [3, 5], links: { 5: 1 }, relations: [] });
    const localRelation = note('source', { ...initialState,
      relations: [{ a: 1, b: 4, dir: 'fwd', color: 'amber' }] });
    const targetRelation = note('target', { ...initialState,
      relations: [{ a: 1, b: 4, dir: 'back', color: 'teal' }] });

    expect(makePlan(initial, localLink, targetLink).kind).toBe('review');
    expect(makePlan(initial, localRelation, targetRelation).kind).toBe('review');
  });

  it('reviews a graph that becomes cyclic only after disjoint local and target links are combined', () => {
    const initial = note('source', initialState);
    const local = note('source', { cuts: [3, 5, 7], links: { 5: 7 }, relations: [] });
    const target = note('target', { cuts: [3, 5, 7], links: { 7: 5 }, relations: [] });

    expect(makePlan(initial, local, target).kind).toBe('review');
  });

  it.each([
    ['unknown analysis field', (analysis: DocumentData) => ({ ...analysis, legacy: true })],
    ['dropped cut', (analysis: DocumentData) => ({ ...analysis, cuts: [...analysis.cuts as number[], 99] })],
    ['dropped link', (analysis: DocumentData) => ({ ...analysis, links: { ...analysis.links as DocumentData, 99: 0 } })],
    ['dropped relation', (analysis: DocumentData) => ({ ...analysis, relations: { ...analysis.relations as DocumentData, '9-2': { dir: 'fwd', color: 'amber' } } })],
    ['non-array drawn field', (analysis: DocumentData) => ({ ...analysis, drawn: '5' })],
    ['non-integer drawn position', (analysis: DocumentData) => ({ ...analysis, drawn: [5.5] })],
    ['drawn position without a link', (analysis: DocumentData) => ({ ...analysis, drawn: [5] })],
    ['repeated drawn position', (analysis: DocumentData) => ({ ...analysis, links: { 5: 0 }, drawn: [5, 5] })],
  ])('reviews raw stored analysis containing a %s rather than normalizing it away', (_label, mutate) => {
    const initial = note('source', initialState);
    const local = note('source', { cuts: [3, 5], links: {}, relations: [] });
    const target = note('target', initialState);
    const invalidLocal = { ...local, analysis: mutate(stateOf(local)) };

    expect(makePlan(initial, invalidLocal, target).kind).toBe('review');
  });

  it('reviews manual markdown and later authored local metadata changes', () => {
    const initial = note('source', initialState);
    const generatedLocal = note('source', { cuts: [3, 5], links: {}, relations: [] });
    const target = note('target', initialState);
    const manualContent = { ...generatedLocal, content: 'A manually edited outline' };
    const changedTitle = { ...generatedLocal, title: 'Later authored title' };
    const changedTags = { ...generatedLocal, tags: ['later-authored-tag'] };

    expect(makePlan(initial, manualContent, target).kind).toBe('review');
    expect(makePlan(initial, changedTitle, target).kind).toBe('review');
    expect(makePlan(initial, changedTags, target).kind).toBe('review');
  });
});


it.each([
  { name: 'fractional cut', cuts: [2.5], links: {} },
  { name: 'string cut', cuts: ['3'], links: {} },
  { name: 'fractional tied word', cuts: [3], links: { '3': 1.5 } },
])('holds a $name for review rather than reinterpreting word positions', ({ cuts, links }) => {
  const raw = { bible: 'rst', words: words.length, cuts, links, relations: {} };
  const interpreted = analysisState(raw as unknown as Parameters<typeof analysisState>[0], words.length);
  const initial = { ...note('source', initialState), analysis: raw as unknown as DocumentData, content: analysisMarkdown(words, interpreted) };
  expect(makePlan(initial, initial, note('target', initialState)).kind).toBe('review');
});
