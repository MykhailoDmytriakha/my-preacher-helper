/** @jest-environment node */
import { planDataCommand } from '@/data-engine/serverRelations';
import { validateCommand } from '@/data-engine/protocol';
import { analysisMarkdown, cutAt, EMPTY_ANALYSIS, passageWords, storedAnalysis } from '@/utils/passageAnalysis';
import { studyAnalysisPassageIdentity } from '@/utils/studyAnalysisSource';
import rstEphesians from '../../../public/bible-text/rst/v1/ephesians.json';
import kjvEphesians from '../../../public/bible-text/kjv/v1/ephesians.json';

import type { BookText } from '@/utils/bibleText';
import type { RelationReader } from '@/data-engine/serverRelations';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from '@/data-engine/types';

const owner = 'owner';
const records = new Map<string, ResourceSnapshot>();
const key = (collection: string, id: string) => `${collection}/${id}`;
const verse = (n: number, bible: 'rst' | 'kjv' = 'rst') => ({ id: `ref-${bible}-${n}`, bible, book: 'Ephesians', chapter: 1, fromVerse: n, toVerse: n });
const corpus = (bible: 'rst' | 'kjv' = 'rst') => (bible === 'rst' ? rstEphesians : kjvEphesians) as BookText;
const passageValue = (n: number, bible: 'rst' | 'kjv' = 'rst', extra: DocumentData = {}): DocumentData => {
  const words = passageWords(corpus(bible), { chapter: 1, fromVerse: n, toChapter: 1, toVerse: n });
  return { userId: owner, type: 'analysis', title: `Analysis ${n}`, content: analysisMarkdown(words, EMPTY_ANALYSIS), tags: [], isDraft: false,
    createdAt: 'created', updatedAt: 'updated', scriptureRefs: [verse(n, bible)],
    analysis: storedAnalysis(EMPTY_ANALYSIS, bible, words.length) as unknown as DocumentData, ...extra };
};
const put = (id: string, n: number, bible: 'rst' | 'kjv' = 'rst', extra: DocumentData = {}): ResourceSnapshot => {
  const snapshot: ResourceSnapshot = { resource: { collection: 'studyNotes', id }, value: passageValue(n, bible, extra),
    metadata: { protocol: 1, generation: `gen-${id}`, revision: 1, deleted: false } };
  records.set(key('studyNotes', id), snapshot); return snapshot;
};
const reader: RelationReader = {
  get: async resource => records.get(key(resource.collection, resource.id)) ?? { resource, value: null, metadata: null },
  list: async (collection, limit, filter, select) => [...records.values()]
    .filter(snapshot => snapshot.resource.collection === collection)
    .filter(snapshot => snapshot.value?.[collection === 'studyNoteShareLinks' ? 'ownerId' : 'userId'] === owner)
    .filter(snapshot => !filter || (filter.operator === 'array-contains'
      ? Array.isArray(snapshot.value?.[filter.field]) && (snapshot.value![filter.field] as string[]).includes(filter.value)
      : snapshot.value?.[filter.field] === filter.value))
    .filter(snapshot => !select || select(snapshot)).slice(0, limit),
};
const change = (field: string, before: unknown, after: unknown): FieldChange => ({ path: [field],
  before: { exists: true, value: before as never }, after: { exists: true, value: after as never } });
const base = (snapshot: ResourceSnapshot, operationId = 'operation') => ({ protocol: 1 as const, operationId, owner,
  resource: snapshot.resource, generation: snapshot.metadata?.generation ?? null, dependsOn: [] as string[] });
const update = (snapshot: ResourceSnapshot, changes: FieldChange[], operationId = 'update'): DataCommand =>
  ({ ...base(snapshot, operationId), kind: 'update', changes });
const reshaped = (snapshot: ResourceSnapshot, n: number, title?: string): DocumentData => {
  const prior = snapshot.value!;
  const words = passageWords(corpus((prior.analysis as DocumentData).bible as 'rst' | 'kjv'), { chapter: 1, fromVerse: n, toChapter: 1, toVerse: n });
  const mapped = words.length > 2 ? (cutAt(EMPTY_ANALYSIS, 1, words.length) ?? EMPTY_ANALYSIS) : EMPTY_ANALYSIS;
  return { ...prior, ...(title === undefined ? {} : { title }), content: analysisMarkdown(words, mapped), scriptureRefs: [verse(n, (prior.analysis as DocumentData).bible as 'rst' | 'kjv')],
    analysis: storedAnalysis(mapped, (prior.analysis as DocumentData).bible as 'rst' | 'kjv', words.length) as unknown as DocumentData };
};
const frameEdit = (snapshot: ResourceSnapshot, n: number, title?: string) => {
  const next = reshaped(snapshot, n, title); const before = snapshot.value!;
  return { resource: snapshot.resource, generation: snapshot.metadata?.generation ?? null, changes: [
    change('analysis', before.analysis, next.analysis), change('content', before.content, next.content),
    change('scriptureRefs', before.scriptureRefs, next.scriptureRefs), ...(title ? [change('title', before.title, title)] : []),
  ] };
};
const reshape = (source: ResourceSnapshot, edits: unknown[], operationId = 'reshape'): DataCommand => validateCommand({
  ...base(source, operationId), kind: 'relation', relation: 'analysis-reshape', edits,
});
const created = (n: number, bible: 'rst' | 'kjv' = 'rst') => passageValue(n, bible, { title: `New ${n}` });
const writesAreEmpty = (plan: { writes: ResourceSnapshot[] }) => expect(plan.writes).toEqual([]);

beforeEach(() => records.clear());

describe('analysis passage uniqueness across accepted writes', () => {
  it('refuses an ordinary source-only update that changes an analysis passage onto an existing identity', async () => {
    const source = put('source', 1), occupied = put('occupied', 2);
    const next = reshaped(source, 2);
    const command = update(source, [change('content', source.value!.content, next.content), change('scriptureRefs', source.value!.scriptureRefs, next.scriptureRefs), change('analysis', source.value!.analysis, next.analysis)]);
    const validated = validateCommand(command);
    const plan = await planDataCommand(validated, source, reader);
    expect(plan.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(plan);
    expect(source.value).toMatchObject({ scriptureRefs: [verse(1)] });
    expect(occupied.value).toMatchObject({ scriptureRefs: [verse(2)] });
  });

  it('classifies ordinary note-to-analysis conversion through the actual public validator', async () => {
    const note = put('note', 1); note.value!.type = 'note'; delete note.value!.analysis;
    put('occupied', 2); const value = passageValue(2);
    const command = { ...base(note, 'convert'), kind: 'update', changes: [
      change('type', 'note', 'analysis'), { path: ['analysis'], before: { exists: false }, after: { exists: true, value: value.analysis as never } },
      change('scriptureRefs', note.value!.scriptureRefs, value.scriptureRefs), change('content', note.value!.content, value.content),
    ] };
    const validated = validateCommand(command); const plan = await planDataCommand(validated, note, reader);
    expect(plan.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(plan);
  });

  it('refuses a source final identity colliding with an unseen analysis while recipient ends elsewhere', async () => {
    const source = put('source', 1), recipient = put('recipient', 3); put('unseen', 2);
    const command = reshape(source, [frameEdit(source, 2), frameEdit(recipient, 4)]);
    const planned = await planDataCommand(command, source, reader);
    expect(planned.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(planned);
  });

  it('refuses an existing recipient final identity colliding with an unseen analysis while source ends elsewhere', async () => {
    const source = put('source', 1), recipient = put('recipient', 3); put('unseen', 2);
    const command = reshape(source, [frameEdit(source, 4), frameEdit(recipient, 2)]);
    const planned = await planDataCommand(command, source, reader);
    expect(planned.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(planned);
  });

  it('refuses a newly created recipient colliding with an unseen analysis while source ends elsewhere', async () => {
    const source = put('source', 1); put('unseen', 2);
    const fresh: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'new-recipient' }, value: null, metadata: null };
    const command = reshape(source, [frameEdit(source, 4), { resource: fresh.resource, generation: null, changes: [], create: created(2) }]);
    const planned = await planDataCommand(command, source, reader);
    expect(planned.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(planned);
    expect(records.has(key('studyNotes', 'new-recipient'))).toBe(false);
  });

  it('refuses two participants proposing the same final passage without an external duplicate', async () => {
    const source = put('source', 1), recipient = put('recipient', 3);
    const command = reshape(source, [frameEdit(source, 2), frameEdit(recipient, 2)]);
    const planned = await planDataCommand(command, source, reader);
    expect(planned.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(planned);
  });

  it('allows a final-overlay move when a participant vacates the desired passage in the same action', async () => {
    const source = put('source', 1), recipient = put('recipient', 2);
    const command = reshape(source, [frameEdit(source, 2), frameEdit(recipient, 1)]);
    expect(studyAnalysisPassageIdentity(reshaped(source, 2))).toEqual(studyAnalysisPassageIdentity(recipient.value));
    const planned = await planDataCommand(command, source, reader);
    expect(planned.result.kind).toBe('acknowledged');
    expect(planned.writes).toHaveLength(2);
  });

  it.each([
    ['another owner', (unseen: ResourceSnapshot) => { unseen.value!.userId = 'other-owner'; }],
    ['another Bible', (unseen: ResourceSnapshot) => { unseen.value!.analysis = { ...(unseen.value!.analysis as DocumentData), bible: 'kjv' }; }],
    ['another passage', (unseen: ResourceSnapshot) => { unseen.value!.scriptureRefs = [verse(3)]; }],
    ['an ordinary note', (unseen: ResourceSnapshot) => { unseen.value!.type = 'note'; }],
    ['a tombstone', (unseen: ResourceSnapshot) => { unseen.value = null; unseen.metadata = { protocol: 1, generation: 'deleted', revision: 2, deleted: true }; }],
  ])('allows an atomic source move when the same-passage row is %s', async (_label, alter) => {
    const source = put('source', 1), recipient = put('recipient', 3), unseen = put('unseen', 2); alter(unseen);
    const command = reshape(source, [frameEdit(source, 2), frameEdit(recipient, 4)]);
    const planned = await planDataCommand(command, source, reader);
    expect(planned.result.kind).toBe('acknowledged');
    expect(planned.writes).toHaveLength(2);
  });

  it('normalizes a legacy toChapter ending to the same exact range as endChapter', async () => {
    const legacy = put('legacy', 1);
    const words = passageWords(corpus(), { chapter: 1, fromVerse: 1, toChapter: 2, toVerse: 1 });
    legacy.value!.scriptureRefs = [{ id: 'legacy-range', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toChapter: 2, toVerse: 1 }];
    legacy.value!.content = analysisMarkdown(words, EMPTY_ANALYSIS);
    legacy.value!.analysis = storedAnalysis(EMPTY_ANALYSIS, 'rst', words.length) as unknown as DocumentData;
    const candidate = passageValue(1, 'rst', { scriptureRefs: [{ id: 'canonical-range', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, endChapter: 2, toVerse: 1 }],
      content: analysisMarkdown(words, EMPTY_ANALYSIS), analysis: storedAnalysis(EMPTY_ANALYSIS, 'rst', words.length) as unknown as DocumentData });
    expect(studyAnalysisPassageIdentity(legacy.value)).toEqual(studyAnalysisPassageIdentity(candidate));
    const fresh: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'canonical' }, value: null, metadata: null };
    const command = validateCommand({ ...base(fresh, 'canonical-create'), kind: 'create', value: candidate });
    const plan = await planDataCommand(command, fresh, reader);
    expect(plan.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(plan);
  });

  it('retains the existing ordinary-create uniqueness guard for a duplicate live passage', async () => {
    put('existing', 2); const fresh: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'new' }, value: null, metadata: null };
    const command = validateCommand({ ...base(fresh, 'create'), kind: 'create', value: created(2) });
    const plan = await planDataCommand(command, fresh, reader);
    expect(plan.result).toMatchObject({ kind: 'refused', code: 'analysis-exists' }); writesAreEmpty(plan);
  });

  it('keeps title and tags editable when historical duplicates already exist', async () => {
    const first = put('first', 2), second = put('second', 2);
    const command = update(first, [change('title', first.value!.title, 'Edited historical title'), change('tags', first.value!.tags, ['kept', 'edited'])]);
    const plan = await planDataCommand(validateCommand(command), first, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes[0].value).toMatchObject({ title: 'Edited historical title', tags: ['kept', 'edited'] });
    expect(second.value).toMatchObject({ title: 'Analysis 2', tags: [] });
  });
});
