import rstEphesians from '../../../public/bible-text/rst/v1/ephesians.json';

import { applyCommand } from '../protocol';
import { prepareDomainCommand } from '../domainPolicy';
import { analysisMarkdown, relateWords, storedAnalysis, tieTo, passageWords, type AnalysisState } from '@/utils/passageAnalysis';
import { buildAnalysisReshapePlan } from '@/utils/studyAnalysisReshape';

import type { DocumentData, ResourceSnapshot } from '../types';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

const text = rstEphesians as unknown as BookText;
const resource = { collection: 'studyNotes', id: 'analysis' };
const oldPassage = { chapter: 1, fromVerse: 2, toChapter: 1, toVerse: 2 };
const newPassage = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 };
const words = passageWords(text, oldPassage), front = passageWords(text, { ...newPassage, toVerse: 1 }).length;
const originalState: AnalysisState = { cuts: [3], links: {}, relations: [] };
const note: StudyNote = { id: resource.id, userId: 'owner', title: 'Analysis', tags: [], materialIds: [], isDraft: false,
  type: 'analysis', content: analysisMarkdown(words, originalState), analysis: storedAnalysis(originalState, 'rst', words.length),
  scriptureRefs: [{ id: 'reference', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 2, toVerse: 2 }],
  createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z' };
const json = (value: unknown): DocumentData => JSON.parse(JSON.stringify(value)) as DocumentData;
const metadata = { protocol: 1 as const, generation: 'generation', revision: 1, deleted: false, operationId: 'seed' };
const commandFor = (before: DocumentData, mine: DocumentData) => prepareDomainCommand('owner', 'offline-edit',
  { resource, value: before, metadata }, mine).command;

it.each(['relation', 'tie'] as const)('does not acknowledge an old-frame %s on different words after an earlier verse is added', kind => {
  expect(words).toHaveLength(12);
  expect(front).toBe(15);
  const next = (kind === 'relation' ? relateWords(originalState, 1, 4, words.length) : tieTo(originalState, 3, 1, words.length)) as AnalysisState;
  if (!next || typeof next !== 'object') throw new Error('Invalid native-equivalent analysis fixture');
  const before = json(note), mine = { ...before, analysis: json(storedAnalysis(next, 'rst', words.length)), content: analysisMarkdown(words, next) };
  const plan = buildAnalysisReshapePlan({ sourceId: note.id, next: newPassage, text, bookId: 'Ephesians', bible: 'rst',
    notes: [note], newId: () => 'unused-reference', titleFor: () => note.title ?? 'Analysis' });
  expect(plan?.edits).toHaveLength(1);
  const changedPassage = json({ ...note, ...plan!.edits[0].fields });
  expect((changedPassage.analysis as DocumentData).words).toBe(27);
  const current: ResourceSnapshot = { resource, value: changedPassage, metadata: { ...metadata, revision: 2, operationId: 'expand' } };
  const result = applyCommand(commandFor(before, mine), current);
  if (result.kind === 'acknowledged') {
    const analysis = result.snapshot.value!.analysis as DocumentData;
    expect(analysis.words).toBe(27);
    // An accepted result must still describe the same words the person linked before the prepend.
    if (kind === 'relation') expect((analysis.relations as DocumentData)[`${front + 1}-${front + 4}`]).toEqual({ dir: 'fwd', color: 'amber' });
    if (kind === 'tie') expect((analysis.links as DocumentData)[String(front + 3)]).toBe(front + 1);
  } else {
    // A clear rejection can retain the original work for a decision; silent reinterpretation cannot.
    expect(['conflict', 'refused']).toContain(result.kind);
  }
  expect(current.value).toEqual(changedPassage);
});

it('keeps an independent title and new relation when both copies describe the same passage', () => {
  const next = relateWords(originalState, 1, 4, words.length) as AnalysisState;
  const before = json(note), mine = { ...before, analysis: json(storedAnalysis(next, 'rst', words.length)), content: analysisMarkdown(words, next) };
  const current: ResourceSnapshot = { resource, value: { ...before, title: 'New title' }, metadata: { ...metadata, revision: 2, operationId: 'title' } };
  const result = applyCommand(commandFor(before, mine), current);
  expect(result.kind).toBe('acknowledged');
  if (result.kind !== 'acknowledged') throw new Error('Independent same-frame edit was refused');
  expect(result.snapshot.value!.title).toBe('New title');
  expect((result.snapshot.value!.analysis as DocumentData).relations).toEqual({ '1-4': { dir: 'fwd', color: 'amber' } });
});
