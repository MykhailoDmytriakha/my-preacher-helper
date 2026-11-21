/** @jest-environment node */
import { createHash } from 'node:crypto';

import { adminDb } from '@/config/firebaseAdminConfig';
import { isCollectionServed } from '@/data-engine/activation';
import { prepareDomainCommand } from '@/data-engine/domainPolicy';
import { readField, writeField } from '@/data-engine/fieldValues';
import { DataEngineServerError, listAccountPreferenceHistory, listBibleMarkHistory, listCommentKindHistory, listExegeticalPointHistory, listCouncilMetadataHistory, listCouncilOutcomeHistory, listDocumentTagHistory, listDocuments, listGroupMeetingFieldHistory, listGroupStatusHistory, listGroupTitleHistory, listHomileticPlanHistory, listMeetingDateHistory, listOutlinePointPlacementHistory, listOutlineTitleHistory, listPlanTemplateNameHistory, listPlanTemplatePointPlacementHistory, listPreachDateFieldHistory, listPreachDateHistory, listPreachStatusHistory, listPrayerStatusHistory, listPrayerTitleHistory, listSermonChurchHistory, listSermonGoalTypeHistory, listSermonPlanModeHistory, listSermonPreparationConfirmationHistory, listSermonSourceNoteLinkHistory, listSermonTitleHistory, listSermonVerseHistory, listSeriesMembershipHistory, listSeriesMetadataHistory, listServiceOrderFlagHistory, listServiceOrderPlacementHistory, listServiceOrderStepPlacementHistory, listServiceOrderStepTitleHistory, listServiceOrderTitleHistory, listStudyNoteReferenceHistory, listStudyNoteTitleHistory, listTagColorHistory, listThoughtLockHistory, listThoughtPlacementHistory, listThoughtTagHistory, MAX_COMMAND_BYTES, processCommand, readCollectionChanges, readCommandBody, readDocument, recordSharedNoteView, serverErrorResponse } from '@/data-engine/server';
import { collectionHeadId, HEADS_COLLECTION, sequenceId } from '@/data-engine/serverFeed';
import { replaySeriesReorder, type SeriesReorderStep } from '@/data-engine/seriesReorder';
import { readSermonConflict } from '@/data-engine/rowConflictDetails';
import { keepUncontestedSermonFields } from '@/data-engine/sermonFieldChoice';
import { DataSession } from '@/data-engine/session';
import { keepUncontestedOutlineTitle, readOutlineTitleComparison } from '@/data-engine/outlineTitleEdit';
import { outlinePointGap, outlinePointOrder } from '@/utils/outlineDnd';
import { stepGap } from '@/utils/serviceOrderStepPlacement';

import type { DataCommand, FieldValue, Json, ResourceSnapshot } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: jest.fn(() => true) }));

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn(), runTransaction: jest.fn() },
  FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) },
}));

jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  Filter: {
    where: (field: string, operator: string, value: unknown) => ({ kind: 'field', field, operator, value }),
    or: (...filters: unknown[]) => ({ kind: 'or', filters }),
  },
}));

type Raw = Record<string, unknown>;
type QueryFilter = { kind: 'field'; field: string; operator: string; value: unknown }
  | { kind: 'or'; filters: QueryFilter[] };
function matchesFilter(data: Raw, filter: QueryFilter): boolean {
  if (filter.kind === 'or') return filter.filters.some(part => matchesFilter(data, part));
  return filter.operator === 'array-contains'
    ? Array.isArray(data[filter.field]) && (data[filter.field] as unknown[]).includes(filter.value)
    : data[filter.field] === filter.value;
}
const documents = new Map<string, Raw>();
let transactionTail: Promise<unknown>;
let failCommit = false;
const snapshot = (path: string) => ({ readTime: { toMillis: () => 1_800_000_000_123 }, exists: documents.has(path), data: () => documents.get(path), id: path.split('/').at(-1)! });
function queryFor(collection: string) {
  let maximum = 50;
  let cursor = '';
  const conditions: QueryFilter[] = [];
  const query = {
    doc: (id: string) => ref(`${collection}/${id}`),
    where: jest.fn().mockImplementation((field: string | QueryFilter, operator: string, value: unknown) => { conditions.push(typeof field === 'string' ? { kind: 'field', field, operator, value } : field); return query; }),
    orderBy: jest.fn().mockImplementation(() => query),
    limit: jest.fn().mockImplementation((value: number) => { maximum = value; return query; }),
    startAfter: jest.fn().mockImplementation((value: string) => { cursor = value; return query; }),
    get: async () => ({ readTime: { toMillis: () => 1_800_000_000_123.456 }, docs: [...documents.entries()].filter(([key, data]) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/') && conditions.every(condition => matchesFilter(data, condition)) && key.slice(collection.length + 1) > cursor).sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum).map(([key]) => snapshot(key)) }),
  };
  return query;
}
function ref(path: string): { path: string; get: () => Promise<ReturnType<typeof snapshot>>; collection: (name: string) => ReturnType<typeof queryFor> } {
  return { path, get: async () => snapshot(path), collection: name => queryFor(`${path}/${name}`) };
}
const resource = { collection: 'sermons', id: 'sermon-1' };
const create = (operationId = 'create-1'): DataCommand => ({ protocol: 1, operationId, owner: 'owner-1', resource, generation: null, dependsOn: [], kind: 'create', value: { userId: 'owner-1', title: 'First', verse: 'John 1:1', date: '2026-01-01', thoughts: [] } });
const update = (operationId = 'update-1', generation: string | null = 'create-1'): DataCommand => ({ protocol: 1, operationId, owner: 'owner-1', resource, generation, dependsOn: [], kind: 'update', changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Second' } }] });
const receiptPath = (owner: string, operationId: string) => `_dataEngineReceipts/${createHash('sha256').update(JSON.stringify([owner, operationId])).digest('hex')}`;
const receipts = () => [...documents.entries()].filter(([key]) => key.startsWith('_dataEngineReceipts/'));
const transactionReads: string[] = [];
const transactionReadBatches: string[][] = [];
const transactionWrites: string[] = [];
// Document operation model, not a cloud billing report: include empty-query minimums.
let documentReadUnits = 0;

beforeEach(() => {
  jest.mocked(isCollectionServed).mockReturnValue(true);
  documents.clear();
  transactionReads.length = 0;
  transactionReadBatches.length = 0;
  transactionWrites.length = 0;
  documentReadUnits = 0;
  failCommit = false;
  transactionTail = Promise.resolve();
  (adminDb.collection as jest.Mock).mockImplementation(queryFor);
  (adminDb.runTransaction as jest.Mock).mockImplementation((callback: (tx: unknown) => Promise<unknown>) => {
    const run = transactionTail.then(async () => {
      const writes = new Map<string, Raw>();
      const reads: string[] = [];
      transactionReadBatches.push(reads);
      const result = await callback({
        get: async (reference: { path?: string; get: () => Promise<unknown> }) => {
          if (writes.size) throw new Error('Firestore requires all reads before writes');
          if (reference.path) { reads.push(reference.path); transactionReads.push(reference.path); documentReadUnits += 1; return snapshot(reference.path); }
          const result = await reference.get() as { docs: unknown[] };
          documentReadUnits += Math.max(1, result.docs.length);
          return result;
        },
        set: (reference: { path: string }, value: Raw, options?: { merge?: boolean }) => {
          transactionWrites.push(reference.path);
          if (!options?.merge) { writes.set(reference.path, value); return; }
          const merged = { ...(writes.get(reference.path) ?? documents.get(reference.path) ?? {}) };
          for (const [field, incoming] of Object.entries(value)) {
            const amount = incoming && typeof incoming === 'object' && '__testIncrement' in incoming
              ? Number((incoming as { __testIncrement: unknown }).__testIncrement) : null;
            merged[field] = amount === null ? incoming : Number(merged[field] ?? 0) + amount;
          }
          writes.set(reference.path, merged);
        },
      });
      if (failCommit) throw new Error('Commit failed');
      for (const [key, value] of writes) documents.set(key, value);
      return result;
    });
    transactionTail = run.catch(() => undefined);
    return run;
  });
});

describe('meeting-plan copies delivered after source removal', () => {
  const ref = { collection: 'groups', id: 'meeting-plan' };
  const owner = 'owner-1';
  const block = (id: string) => ({
    id, type: 'custom', title: id, content: `Words in ${id}`, status: 'filled', createdAt: 'created', updatedAt: 'updated',
  });
  const rows = (ids: string[]) => ids.map((id, index) => ({
    id, templateId: id === 'copy' ? 'source' : id, order: index + 1,
  }));

  it.each([true, false])('restores the shown shared text when the source was removed first (source first in list: %s)', async sourceFirst => {
    const source = block('source'), neighbor = block('neighbor');
    const value = { userId: owner, title: 'Meeting', status: 'draft', createdAt: 'created', updatedAt: 'updated',
      description: 'Keep notes', templates: [source, neighbor], flow: rows(sourceFirst ? ['source', 'neighbor'] : ['neighbor', 'source']) };
    const generation = 'meeting-create';
    const created = await processCommand(owner, { protocol: 1, owner, operationId: generation, resource: ref, generation: null,
      dependsOn: [], kind: 'create', value });
    if (created.kind !== 'acknowledged') throw new Error(JSON.stringify(created));
    const opening = created.snapshot;
    const duplicate = prepareDomainCommand(owner, 'duplicate-step', opening, {
      ...opening.value, flow: rows(sourceFirst ? ['source', 'copy', 'neighbor'] : ['neighbor', 'source', 'copy']),
    }).command;
    const deletion = prepareDomainCommand(owner, 'delete-source', opening, {
      ...opening.value, flow: rows(['neighbor']), templates: [neighbor],
    }).command;

    expect(await processCommand(owner, deletion)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { templates: [neighbor], flow: rows(['neighbor']) } } });
    // An unrelated save after deletion must not erase the proof of which template was removed.
    const deleted = await readDocument(owner, ref);
    const unrelated = prepareDomainCommand(owner, 'update-description', deleted, { ...deleted.value, description: 'New notes' }).command;
    expect((await processCommand(owner, unrelated)).kind).toBe('acknowledged');
    const accepted = await processCommand(owner, duplicate);
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
      description: 'New notes', flow: rows(sourceFirst ? ['copy', 'neighbor'] : ['neighbor', 'copy']),
      templates: expect.arrayContaining([source, neighbor]),
    } } });
    expect(await processCommand(owner, duplicate)).toMatchObject({ kind: 'acknowledged', snapshot: {
      metadata: { revision: 4 }, value: { flow: rows(sourceFirst ? ['copy', 'neighbor'] : ['neighbor', 'copy']) },
    } });
  });

  it('retires a shared template only after both independently removed copies are gone', async () => {
    const source = block('source');
    const value = { userId: owner, title: 'Meeting', status: 'draft', createdAt: 'created', updatedAt: 'updated',
      templates: [source, block('unplaced')], flow: rows(['source', 'copy']) };
    const created = await processCommand(owner, { protocol: 1, owner, operationId: 'meeting-create', resource: ref, generation: null,
      dependsOn: [], kind: 'create', value });
    if (created.kind !== 'acknowledged') throw new Error(JSON.stringify(created));
    const opening = created.snapshot;
    const remove = (id: string, survivor: string) => prepareDomainCommand(owner, id, opening, {
      ...opening.value, flow: rows([survivor]),
    }).command;
    expect(await processCommand(owner, remove('remove-original', 'copy'))).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { templates: value.templates, flow: rows(['copy']) } } });
    expect(await processCommand(owner, remove('remove-copy', 'source'))).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { templates: [block('unplaced')], flow: [] } } });
  });

  it.each([true, false])('preserves changed shared text or asks before restoring an older snapshot (template still live: %s)', async live => {
    const source = block('source');
    const value = { userId: owner, title: 'Meeting', status: 'draft', createdAt: 'created', updatedAt: 'updated',
      templates: [source], flow: rows(['source']) };
    const created = await processCommand(owner, { protocol: 1, owner, operationId: 'meeting-create', resource: ref, generation: null,
      dependsOn: [], kind: 'create', value });
    if (created.kind !== 'acknowledged') throw new Error(JSON.stringify(created));
    const opening = created.snapshot;
    const duplicate = prepareDomainCommand(owner, 'duplicate-step', opening, { ...opening.value, flow: rows(['source', 'copy']) }).command;
    const latest = { ...source, content: 'New words' };
    const edited = await processCommand(owner, prepareDomainCommand(owner, 'edit-words', opening,
      { ...opening.value, templates: [latest] }).command);
    if (edited.kind !== 'acknowledged') throw new Error(JSON.stringify(edited));
    const deletion = prepareDomainCommand(owner, 'delete-source', edited.snapshot, { ...edited.snapshot.value, flow: [], templates: [] }).command;
    if (!live) expect((await processCommand(owner, deletion)).kind).toBe('acknowledged');
    const result = await processCommand(owner, duplicate);
    if (live) {
      expect(result.kind).toBe('acknowledged');
      expect(await processCommand(owner, deletion)).toMatchObject({ kind: 'acknowledged',
        snapshot: { value: { flow: rows(['copy']), templates: [latest] } } });
    } else {
      expect(result).toMatchObject({ kind: 'conflict', conflicts: [{
        path: ['templates', 'id:source'], mine: { exists: true, value: source }, theirs: { exists: false },
      }] });
      expect((await readDocument(owner, ref)).value).toMatchObject({ flow: [], templates: [] });
    }
  });

});


describe('custom tag name ownership', () => {
  const owner = 'owner-1';
  const tag = (name: string, color = '#001122', userId = owner) => ({ userId, name, color, required: false });
  const resourceFor = (id: string) => ({ collection: 'tags', id });
  const add = (id: string, name: string, userId = owner): DataCommand => ({
    protocol: 1, kind: 'create', owner: userId, resource: resourceFor(id), operationId: 'create-' + id,
    generation: null, dependsOn: [], value: tag(name, '#445566', userId),
  });
  const remove = (id: string, baseline: ReturnType<typeof tag>): DataCommand => ({
    protocol: 1, kind: 'delete', owner, resource: resourceFor(id), operationId: 'remove-' + id,
    generation: null, dependsOn: [], baseline,
  });

  it('refuses a new ID for an already stored name, including a retry of the same queued action', async () => {
    const stored = tag('Prayer');
    documents.set('tags/existing-tag', stored);
    const duplicate = add('late-device-tag', 'Prayer');

    expect(await processCommand(owner, duplicate)).toMatchObject({ kind: 'refused', code: 'tag-name-exists' });
    expect(await processCommand(owner, duplicate)).toMatchObject({ kind: 'refused', code: 'tag-name-exists' });
    expect(documents.get('tags/existing-tag')).toEqual(stored);
    expect(documents.has('tags/late-device-tag')).toBe(false);
    expect(await processCommand(owner, add('new-tag', 'Mercy'))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand('another-owner', add('another-tag', 'Prayer', 'another-owner')))
      .toMatchObject({ kind: 'acknowledged' });
  });

  it('compares full names when Firestore cannot index the complete UTF-8 value', async () => {
    const longPrefix = 'я'.repeat(751);
    documents.set('tags/legacy-long', tag(longPrefix + 'a'));
    const tagQueries: ReturnType<typeof queryFor>[] = [];
    jest.mocked(adminDb.collection).mockImplementation(collection => {
      const query = queryFor(collection);
      if (collection === 'tags') tagQueries.push(query);
      return query as never;
    });

    expect(await processCommand(owner, add('duplicate-long', longPrefix + 'a'))).toMatchObject({ code: 'tag-name-exists' });
    expect(await processCommand(owner, add('different-long', longPrefix + 'b'))).toMatchObject({ kind: 'acknowledged' });
    expect(tagQueries.flatMap(query => query.where.mock.calls).some(([field]) => field === 'name')).toBe(false);
  });

  it('keeps the label when the name is recreated after delete commits and before cleanup writes', async () => {
    const blue = tag('Prayer');
    const thought = { id: 'saved-thought', text: 'Keep the words', date: '2026-11-10', tags: ['Prayer'] };
    documents.set('tags/blue', blue);
    const sermon = create();
    if (sermon.kind !== 'create') throw new Error('Expected a create command');
    await processCommand(owner, { ...sermon, value: { ...sermon.value, thoughts: [thought] } });
    let listStarted!: () => void, resumeList!: () => void;
    const listing = new Promise<void>(resolve => { listStarted = resolve; });
    const held = new Promise<void>(resolve => { resumeList = resolve; });
    let holdOnce = true;
    jest.mocked(adminDb.collection).mockImplementation(collection => {
      const query = queryFor(collection);
      const get = query.get;
      query.get = async () => {
        if (collection === 'sermons' && holdOnce) {
          holdOnce = false;
          listStarted();
          await held;
        }
        return get();
      };
      return query as never;
    });

    const deleting = processCommand(owner, remove('blue', blue));
    try {
      await listing;
      expect(documents.get('tags/blue')?._dataEngine).toMatchObject({ deleted: true });
      expect(await processCommand(owner, add('replacement', 'Prayer'))).toMatchObject({ kind: 'acknowledged' });
    } finally {
      resumeList();
      await deleting;
    }
    expect(documents.get('sermons/sermon-1')?.thoughts).toEqual([thought]);
    expect(documents.get('tags/replacement')).toMatchObject({ name: 'Prayer', color: '#445566' });
    const tagsHead = `${HEADS_COLLECTION}/${collectionHeadId(owner, 'tags')}`;
    expect(transactionReadBatches.some(reads => reads.includes('sermons/sermon-1') && reads.includes(tagsHead))).toBe(true);
  });

  it('keeps sermon thoughts tagged until the last owned card with the exact name is removed', async () => {
    const blue = tag('Prayer'), green = tag('Prayer', '#226655');
    const thought = { id: 'saved-thought', text: 'Keep the written words', date: '2026-11-10', tags: ['Prayer', 'Keep'] };
    documents.set('tags/blue', blue);
    documents.set('tags/green', green);
    documents.set('tags/foreign', tag('Prayer', '#ffffff', 'another-owner'));
    const sermon = create();
    if (sermon.kind !== 'create') throw new Error('Expected a create command');
    expect(await processCommand(owner, { ...sermon, value: { ...sermon.value, thoughts: [thought] } }))
      .toMatchObject({ kind: 'acknowledged' });

    expect(await processCommand(owner, remove('blue', blue))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('tags/blue')?._dataEngine).toMatchObject({ deleted: true });
    expect(documents.get('tags/green')).toEqual(green);
    expect(documents.get('sermons/sermon-1')?.thoughts).toEqual([thought]);

    expect(await processCommand(owner, remove('green', green))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.thoughts).toEqual([{ ...thought, tags: ['Keep'] }]);
    expect(documents.get('tags/foreign')?.name).toBe('Prayer');
  });

  it('resumes a partially completed deletion on exact replay before acknowledging it', async () => {
    const name = 'Prayer';
    const card = tag(name);
    const thought = { id: 'saved-thought', text: 'Keep the written words', date: '2026-11-10', tags: [name, 'Keep'] };
    const saved = create('first-sermon');
    if (saved.kind !== 'create') throw new Error('Expected a create command');
    documents.set('tags/blue', card);
    for (const id of ['a-story', 'b-story']) {
      expect(await processCommand(owner, { ...saved, operationId: id, resource: { collection: 'sermons', id },
        value: { ...saved.value, thoughts: [thought] } })).toMatchObject({ kind: 'acknowledged' });
    }
    const transactions = jest.mocked(adminDb.runTransaction).getMockImplementation()!;
    let failing = true;
    jest.mocked(adminDb.runTransaction).mockImplementation((run, options) => transactions(transaction => {
      const get = transaction.get.bind(transaction);
      Object.defineProperty(transaction, 'get', { value: (reference: { path?: string }) => {
        if (failing && reference.path === 'sermons/b-story') throw new Error('Transient write failure');
        return get(reference as never);
      } });
      return run(transaction);
    }, options));
    const deletion = remove('blue', card);
    const original = await processCommand(owner, deletion).then(result => ({ result: result.kind }),
      (error: unknown) => error instanceof DataEngineServerError ? { status: error.status, code: error.code } : { error });
    expect(documents.get('tags/blue')?._dataEngine).toMatchObject({ deleted: true, revision: 1 });
    expect(documents.get('sermons/a-story')?.thoughts).toEqual([{ ...thought, tags: ['Keep'] }]);
    expect(documents.get('sermons/b-story')?.thoughts).toEqual([thought]);
    failing = false;
    if (deletion.kind !== 'delete') throw new Error('Expected a delete command');
    expect(await processCommand(owner, { ...deletion, baseline: { ...deletion.baseline, color: '#ffffff' } }))
      .toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    expect(documents.get('sermons/b-story')?.thoughts).toEqual([thought]);
    expect(await processCommand(owner, deletion)).toMatchObject({ kind: 'acknowledged', operationId: deletion.operationId });
    expect(documents.get('sermons/b-story')?.thoughts).toEqual([{ ...thought, tags: ['Keep'] }]);
    expect(original).toEqual({ status: 503, code: 'tag-cleanup-pending' });
    for (const id of ['a-story', 'b-story']) expect(documents.get('sermons/' + id)?._dataEngine).toMatchObject({ revision: 2 });
  });

  it('checkpoints completed pages without scanning them again or leaving another owner’s tags', async () => {
    const name = 'Prayer', card = tag(name);
    documents.set('tags/blue', card);
    const thought = { id: 'saved-thought', text: 'Keep my words', date: '2026-11-10', tags: [name, 'Keep'] };
    for (let index = 0; index <= 32; index += 1) {
      const id = 'page-' + String(index).padStart(2, '0');
      documents.set('sermons/' + id, { userId: owner, title: id, verse: 'John 1:1', date: '2026-01-01',
        thoughts: index === 32 ? [thought] : [], _dataEngine: { protocol: 1, generation: id, revision: 1, deleted: false } });
    }
    documents.set('sermons/foreign', { userId: 'another-owner', thoughts: [thought] });
    const pages: string[][] = [];
    let failing = true;
    jest.mocked(adminDb.collection).mockImplementation(collection => {
      const query = queryFor(collection), get = query.get;
      query.get = async () => {
        const result = await get();
        if (collection === 'sermons') {
          pages.push(result.docs.map(document => document.id));
          if (failing && result.docs.some(document => document.id === 'page-32')) throw new Error('Page temporarily unavailable');
        }
        return result;
      };
      return query as never;
    });
    const deletion = remove('blue', card);
    await expect(processCommand(owner, deletion)).rejects.toMatchObject({ status: 503, code: 'tag-cleanup-pending' });
    const stored = () => documents.get(receiptPath(owner, deletion.operationId));
    expect(stored()?.tagCleanup).toEqual({ name, after: 'page-31', completed: false });
    failing = false;
    await expect(processCommand(owner, deletion)).resolves.toMatchObject({ kind: 'acknowledged' });
    expect(pages.map(page => page.length)).toEqual([32, 1, 1]);
    expect(documents.get('sermons/page-32')?.thoughts).toEqual([{ ...thought, tags: ['Keep'] }]);
    expect(documents.get('sermons/foreign')?.thoughts).toEqual([thought]);
    expect(stored()?.tagCleanup).toEqual({ name, after: 'page-32', completed: true });
    await expect(processCommand(owner, deletion)).resolves.toMatchObject({ kind: 'acknowledged' });
    expect(pages).toHaveLength(3);
  });

  it('never resumes a cleanup for a name that does not match the original delete', async () => {
    const original = tag('Prayer');
    documents.set('tags/blue', original);
    const deletion = remove('blue', original);
    await expect(processCommand(owner, deletion)).resolves.toMatchObject({ kind: 'acknowledged' });
    const receipt = documents.get(receiptPath(owner, deletion.operationId))!;
    receipt.tagCleanup = { name: 'Keep', after: null, completed: false };
    const unrelated = { id: 'thought', text: 'Keep the original text', date: '2026-11-10', tags: ['Keep'] };
    const saved = create('unrelated-tag');
    if (saved.kind !== 'create') throw new Error('Expected a create command');
    await expect(processCommand(owner, { ...saved, value: { ...saved.value, thoughts: [unrelated] } }))
      .resolves.toMatchObject({ kind: 'acknowledged' });
    const before = documents.get('sermons/sermon-1');
    await expect(processCommand(owner, deletion)).rejects.toMatchObject({ status: 503, code: 'tag-cleanup-pending' });
    expect(documents.get('sermons/sermon-1')).toEqual(before);
  });

  it('finishes an older delete receipt whose server never recorded cleanup progress', async () => {
    const original = tag('Prayer');
    documents.set('tags/blue', original);
    const deletion = remove('blue', original);
    await expect(processCommand(owner, deletion)).resolves.toMatchObject({ kind: 'acknowledged' });
    const receiptPathForDelete = receiptPath(owner, deletion.operationId);
    delete documents.get(receiptPathForDelete)?.tagCleanup;
    const saved = create('legacy-lingering-tag');
    if (saved.kind !== 'create') throw new Error('Expected a create command');
    const thought = { id: 'thought', text: 'Keep these words', date: '2026-11-10', tags: ['Prayer', 'Other'] };
    await expect(processCommand(owner, { ...saved, value: { ...saved.value, thoughts: [thought] } }))
      .resolves.toMatchObject({ kind: 'acknowledged' });
    await expect(processCommand(owner, deletion)).resolves.toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.thoughts).toEqual([{ ...thought, tags: ['Other'] }]);
    expect(documents.get(receiptPathForDelete)?.tagCleanup).toMatchObject({ name: 'Prayer', completed: true });
  });
});

describe('saved sermon source-note selection chronology', () => {
  const owner = 'owner-1';
  const source = 'sermon-source-a';
  const other = 'sermon-source-b';
  const clock = (offset: number) => ({ earliestMs: 1_799_999_980_000 + offset, latestMs: 1_799_999_980_005 + offset });

  async function seed(initial: string[]) {
    for (const id of [source, other]) {
      const note = await processCommand(owner, { protocol: 1, kind: 'create', owner, operationId: 'create-' + id,
        resource: { collection: 'studyNotes', id }, generation: null, dependsOn: [],
        value: { userId: owner, title: id, content: 'Keep the note words', type: 'note', isDraft: false,
          scriptureRefs: [], tags: [], createdAt: '2026-11-09', updatedAt: '2026-11-09' } });
      expect(note).toMatchObject({ kind: 'acknowledged' });
    }
    const opening = create();
    if (opening.kind !== 'create') throw new Error('Expected a sermon creation');
    expect(await processCommand(owner, { ...opening, value: { ...opening.value, sourceNoteIds: initial } })).toMatchObject({ kind: 'acknowledged' });
  }

  function select(operationId: string, before: string[], after: string[], noteId: string, observedRevision: number, time: number | null,
    proof: { queueId?: string; predecessorOperationId?: string; reviewed?: true } = {}) {
    return processCommand(owner, { protocol: 1, kind: 'update', owner, operationId, resource, generation: 'create-1', dependsOn: [],
      changes: [{ path: ['sourceNoteIds'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      sourceNoteLinkAction: { observedRevision, time: time === null ? null : clock(time),
        ...(proof.reviewed && { reviewed: proof.reviewed }),
        changes: [{ noteId, linked: after.includes(noteId), ...(proof.queueId && { queueId: proof.queueId }),
          ...(proof.predecessorOperationId && { predecessorOperationId: proof.predecessorOperationId }) }] } });
  }

  it.each([false, true])('keeps the later choice after a round trip (originally linked: %s)', async linked => {
    const initial = linked ? [source] : [];
    const changed = linked ? [] : [source];
    await seed(initial);
    expect(await select('desktop-first', initial, changed, source, 1, 1000)).toMatchObject({ kind: 'acknowledged' });
    expect(await select('desktop-return', changed, initial, source, 2, 2000)).toMatchObject({ kind: 'acknowledged' });
    expect(await select('phone-early', initial, changed, source, 1, 0)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual(initial);
  });

  it('applies a later selection from an old opening and retains the displaced action', async () => {
    await seed([]);
    await select('desktop-link', [], [source], source, 1, 1000);
    await select('desktop-unlink', [source], [], source, 2, 2000);
    expect(await select('phone-late', [], [source], source, 1, 3000)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([source]);
    await expect(listSermonSourceNoteLinkHistory(owner, resource.id, 'create-1')).resolves.toMatchObject({
      owner, sermonId: resource.id, entries: [{ entries: [{ noteId: source, linked: false, keptLinked: true,
        actionTime: clock(2000), keptActionTime: clock(3000) }] }],
    });
  });

  it.each([false, true])('keeps a question when the incoming selection has no usable clock (legacy: %s)', async legacy => {
    await seed([]);
    await select('desktop-link', [], [source], source, 1, 1000);
    await select('desktop-unlink', [source], [], source, 2, 2000);
    const result = legacy ? await processCommand(owner, { protocol: 1, kind: 'update', owner,
      operationId: 'phone-old-bundle', resource, generation: 'create-1', dependsOn: [],
      changes: [{ path: ['sourceNoteIds'], before: { exists: true, value: [] }, after: { exists: true, value: [source] } }],
    }) : await select('phone-unclocked', [], [source], source, 1, null);
    expect(result).toMatchObject({ kind: 'conflict', conflicts: [{
      path: ['sourceNoteIds', 'string:' + source], mine: { exists: true, value: true }, theirs: { exists: true, value: false },
    }] });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([]);
  });

  it.each([true, false])('accepts only its exact pending predecessor without a clock (same queue: %s)', async sameQueue => {
    await seed([]);
    await select('phone-first-link', [], [source], source, 1, null, { queueId: 'phone-link-queue' });
    await select('desktop-independent-link', [source], [source, other], other, 2, 1000);
    const result = await select('phone-next-unlink', [source], [], source, 1, null,
      { queueId: sameQueue ? 'phone-link-queue' : 'other-link-queue', predecessorOperationId: 'phone-first-link' });
    expect(result.kind).toBe(sameQueue ? 'acknowledged' : 'conflict');
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual(sameQueue ? [other] : [source, other]);
  });

  it('asks again if the same note changed and returned after the shown comparison', async () => {
    await seed([]);
    await select('desktop-link', [], [source], source, 1, 1000);
    await select('desktop-return', [source], [], source, 2, 2000);
    expect(await select('phone-unclocked', [], [source], source, 1, null)).toMatchObject({ kind: 'conflict' });
    await select('desktop-link-again', [], [source], source, 3, 3000);
    await select('desktop-unlink-again', [source], [], source, 4, 4000);
    expect(await select('reviewed-stale', [], [source], source, 3, 5000, { reviewed: true })).toMatchObject({ kind: 'conflict' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([]);
    expect(await select('reviewed-fresh', [], [source], source, 5, 6000, { reviewed: true })).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([source]);
  });

  it.each([false, true])('does not refresh the action time of an earlier loser when resolving another note (keep my link: %s)', async keepMine => {
    await seed([]);
    await select('desktop-a-link', [], [source], source, 1, null);
    await select('desktop-a-unlink', [source], [], source, 2, null);
    await select('desktop-b-link', [], [other], other, 3, 2500);
    await select('desktop-b-unlink', [other], [], other, 4, 3000);
    const disputed = await processCommand(owner, { protocol: 1, kind: 'update', owner, operationId: 'phone-add-both', resource,
      generation: 'create-1', dependsOn: [],
      changes: [{ path: ['sourceNoteIds'], before: { exists: true, value: [] }, after: { exists: true, value: [source, other] } }],
      sourceNoteLinkAction: { observedRevision: 1, time: clock(2000), changes: [
        { noteId: source, linked: true }, { noteId: other, linked: true },
      ] } });
    expect(disputed).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['sourceNoteIds', 'string:' + source] }] });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([]);
    const wanted = keepMine ? [source, other] : [other];
    expect(await processCommand(owner, { protocol: 1, kind: 'update', owner, operationId: 'phone-review-a', resource,
      generation: 'create-1', dependsOn: [],
      changes: [{ path: ['sourceNoteIds'], before: { exists: true, value: [] }, after: { exists: true, value: wanted } }],
      sourceNoteLinkAction: { observedRevision: 5, time: clock(4000), reviewed: true, changes: [
        ...(keepMine ? [{ noteId: source, linked: true }] : []),
        { noteId: other, linked: true, prior: { before: false, observedRevision: 1, time: clock(2000) } },
      ] } })).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual(keepMine ? [source] : []);
  });

  it('does not let an old unsigned client undo a tracked no-op with ambiguous timing', async () => {
    await seed([]);
    await select('desktop-link', [], [source], source, 1, 1000);
    await select('desktop-return', [source], [], source, 2, 2000);
    await select('phone-returns-off', [], [], source, 1, null);
    expect(await processCommand(owner, { protocol: 1, kind: 'update', owner,
      operationId: 'old-unsigned-add', resource, generation: 'create-1', dependsOn: [],
      changes: [{ path: ['sourceNoteIds'], before: { exists: true, value: [] }, after: { exists: true, value: [source] } }],
    })).toMatchObject({ kind: 'conflict' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([]);
  });

  it('records a touched selection returned before its one Save', async () => {
    await seed([]);
    expect(await select('desktop-explicit-return', [], [], source, 1, 2000)).toMatchObject({ kind: 'acknowledged' });
    expect(await select('phone-early', [], [source], source, 1, 1000)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([]);
  });

  it('does not re-link a source deleted before the incoming Save arrives', async () => {
    await seed([]);
    const removed = await processCommand(owner, { protocol: 1, kind: 'delete', owner, operationId: 'remove-source',
      resource: { collection: 'studyNotes', id: source }, generation: 'create-' + source, dependsOn: [],
      baseline: (await readDocument(owner, { collection: 'studyNotes', id: source })).value });
    expect(removed).toMatchObject({ kind: 'acknowledged' });
    expect(await select('phone-late', [], [source], source, 1, 3000)).toMatchObject({ kind: 'refused' });
    expect(documents.get('sermons/' + resource.id)?.sourceNoteIds).toEqual([]);
  });

  it('keeps source-note selections made independently on both devices', async () => {
    await seed([]);
    expect(await select('desktop-other', [], [other], other, 1, 1000)).toMatchObject({ kind: 'acknowledged' });
    expect(await select('phone-source', [], [source], source, 1, 0)).toMatchObject({ kind: 'acknowledged' });
    const saved = documents.get('sermons/' + resource.id)?.sourceNoteIds as string[];
    expect([...saved].sort()).toEqual([source, other]);
    expect(documents.get('sermons/' + resource.id)?.title).toBe('First');
  });
});

describe('relation scope with unrelated owner documents', () => {
  const owner = 'owner-1';
  const member = (id: string, type = 'sermon') => ({ id: `item-${id}`, type, refId: id, position: 1 });
  const putSeries = (id: string, items: Raw[] = []) => documents.set(`series/${id}`, {
    userId: owner, title: 'Keep series', items, sermonIds: items.filter(item => item.type === 'sermon').map(item => item.refId),
  });
  const unrelated = (collection: string, count = 305) => {
    for (let index = 0; index < count; index++) {
      const id = `a-${String(index).padStart(4, '0')}`;
      if (collection === 'series') putSeries(id);
      else documents.set(`${collection}/${id}`, { userId: owner, title: 'Unrelated', noteIds: [], sections: [] });
    }
  };
  const remove = (collection: string, id: string, baseline: Raw): DataCommand => ({
    protocol: 1, owner, operationId: `remove-${collection}`, resource: { collection, id }, generation: null,
    dependsOn: [], kind: 'delete', baseline: baseline as never,
  });
  const attach = (): DataCommand => ({
    protocol: 1, owner, operationId: 'attach-after-unrelated', resource: { collection: 'series', id: 'z-target' },
    generation: null, dependsOn: [], kind: 'relation', relation: 'series-membership', edits: [
      { resource: { collection: 'series', id: 'z-target' }, generation: null, beforeItems: [], afterItems: [member('g', 'group') as never] },
    ],
  });

  it.each(['sermons', 'groups'])('deletes %s and cleans a late related series beyond three unrelated pages', async collection => {
    unrelated('series');
    const baseline = { userId: owner, title: 'Delete target' };
    documents.set(`${collection}/target`, baseline);
    putSeries('z-related', [member('target', collection === 'groups' ? 'group' : 'sermon'), { ...member('keep'), position: 2 }]);
    documents.set('series/z-foreign', { userId: 'victim', items: [member('target')] });
    const untouched = structuredClone(documents.get('series/a-0000'));
    expect(await processCommand(owner, remove(collection, 'target', baseline))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get(`${collection}/target`)?._dataEngine).toMatchObject({ deleted: true });
    expect(documents.get('series/z-related')).toMatchObject({ items: [{ refId: 'keep', position: 1 }], sermonIds: ['keep'] });
    expect(documents.get('series/a-0000')).toEqual(untouched);
    expect(documents.get('series/z-foreign')?.userId).toBe('victim');
  });

  it('deletes a note and a late legacy section-only link without rewriting unrelated materials', async () => {
    unrelated('studyMaterials');
    const baseline = { userId: owner, content: 'Delete target', materialIds: [] };
    documents.set('studyNotes/n', baseline);
    documents.set('studyMaterials/z-related', { userId: owner, title: 'Keep title', noteIds: [],
      sections: [{ id: 'section', title: 'Keep section', connector: 'Keep words', noteIds: ['n'] }] });
    const untouched = structuredClone(documents.get('studyMaterials/a-0000'));
    expect(await processCommand(owner, remove('studyNotes', 'n', baseline))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('studyMaterials/z-related')).toMatchObject({ title: 'Keep title', noteIds: [],
      sections: [{ title: 'Keep section', connector: 'Keep words', noteIds: [] }] });
    expect(documents.get('studyMaterials/a-0000')).toEqual(untouched);
  });

  it('attaches a group after unrelated series without weakening exclusive membership', async () => {
    unrelated('series'); documents.set('groups/g', { userId: owner, title: 'Group' }); putSeries('z-target');
    expect(await processCommand(owner, attach())).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('series/z-target')).toMatchObject({ items: [member('g', 'group')], sermonIds: [] });
  });

  it('finds a real duplicate beyond the unrelated prefix and refuses every proposed write', async () => {
    unrelated('series'); documents.set('groups/g', { userId: owner }); putSeries('z-target');
    putSeries('z-assigned', [member('g', 'group')]);
    expect(await processCommand(owner, attach())).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
    expect(documents.get('series/z-target')?.items).toEqual([]);
    expect(documents.get('series/z-assigned')?.items).toEqual([member('g', 'group')]);
  });

  describe('saved series item reorder chronology', () => {
    const series = { collection: 'series', id: 'reorder-series' };
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const rows = (order: readonly string[]) => order.map((id, index) => ({ ...member(id), position: index + 1 }));
    const clock = (offset: number) => ({ earliestMs: 1_799_999_980_000 + offset, latestMs: 1_799_999_980_005 + offset });
    const stored = () => documents.get('series/' + series.id)?.sermonIds;
    function command(id: string, revision: number, before: string[], steps: SeriesReorderStep[], time: ReturnType<typeof clock> | null,
      signed = true): Extract<DataCommand, { relation: 'series-membership' }> {
      const after = replaySeriesReorder(before.map(refId => 'item-' + refId), steps)!.map(itemId => itemId.slice(5));
      return { protocol: 1, kind: 'relation', relation: 'series-membership', owner, operationId: id, resource: series,
        generation: 'opening-series', dependsOn: [], edits: [{ resource: series, generation: 'opening-series',
          beforeItems: rows(before), afterItems: rows(after),
          ...(signed && { membership: { added: [], removed: [], observedRevision: revision, time, reorder: steps, reorderQueueId: id } }),
        }] };
    }
    const move = (item: string, index: number) => ({ itemId: 'item-' + item, index });
    const apply = (packet: ReturnType<typeof command>) => processCommand(owner, packet);
    beforeEach(async () => {
      for (const id of ids) documents.set('sermons/' + id, { userId: owner, title: 'Words for ' + id });
      const result = await processCommand(owner, { protocol: 1, kind: 'create', owner, operationId: 'opening-series',
        resource: series, generation: null, dependsOn: [], value: { userId: owner, title: 'Series',
          theme: 'Series', bookOrTopic: '', status: 'draft', createdAt: '2026-11-09', updatedAt: '2026-11-09', items: rows(ids), sermonIds: ids } });
      expect(result).toMatchObject({ kind: 'acknowledged' });
    });

    it('does not let an older reorder undo the later return to the same position', async () => {
      const early = command('offline-down', 1, ids, [move('b', 2)], clock(0));
      const up = ['b', 'a', 'c', 'd', 'e'];
      expect(await apply(command('up', 1, ids, [move('b', 0)], clock(1000)))).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(command('return', 2, up, [move('b', 1)], clock(2000)))).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(ids);
      expect(await apply(early)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(ids);
      const history = [...documents.entries()].filter(([path]) => path.startsWith('series/' + series.id + '/_seriesItemPlacementHistory/'));
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ owner, generation: 'opening-series', changes: [{ stepId: 'item-b',
        actionTime: clock(0), winnerActionTime: clock(2000) }] });
    });

    it('applies the later move arriving from an older opening and leaves untouched words alone', async () => {
      expect(await apply(command('up', 1, ids, [move('b', 0)], clock(0)))).toMatchObject({ kind: 'acknowledged' });
      const later = command('down', 1, ids, [move('b', 2)], clock(1000));
      expect(await apply(later)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(['a', 'c', 'b', 'd', 'e']);
      expect(documents.get('sermons/b')?.title).toBe('Words for b');
    });

    it('applies a staged sequence while retaining a different moved item', async () => {
      expect(await apply(command('independent-e', 1, ids, [move('e', 0)], clock(1000)))).toMatchObject({ kind: 'acknowledged' });
      const sequence = command('two-steps', 1, ids, [move('b', 2), move('a', 1)], clock(0));
      expect(await apply(sequence)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(['e', 'c', 'a', 'b', 'd']);
    });

    it.each([false, true])('recognizes the same final placement after several staged moves (clocked: %s)', async clocked => {
      const time = (offset: number) => clocked ? clock(offset) : null;
      expect(await apply(command('desktop-c-before-b', 1, ids, [move('c', 1)], time(0)))).toMatchObject({ kind: 'acknowledged' });
      const sameFinalOrder = command('phone-staged-same-place', 1, ids, [move('b', 2), move('c', 0), move('c', 1)], time(1000));
      expect(await apply(sameFinalOrder)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(['a', 'c', 'b', 'd', 'e']);
      expect([...documents.keys()].filter(path => path.includes('/_seriesItemPlacementHistory/'))).toEqual([]);
    });

    it('does not let a previous reorder certify a destination anchor replaced before that reorder', async () => {
      const remove = command('desktop-remove-d', 1, ids, [], null, false);
      remove.edits[0].afterItems = rows(['a', 'b', 'c', 'e']);
      expect(await apply(remove)).toMatchObject({ kind: 'acknowledged' });
      const restore = command('desktop-readd-d', 2, ['a', 'b', 'c', 'e'], [], null, false);
      restore.edits[0].afterItems = rows(['a', 'b', 'c', 'e', 'd']);
      expect(await apply(restore)).toMatchObject({ kind: 'acknowledged' });

      const first = command('phone-first', 1, ids, [move('b', 0)], null);
      first.edits[0].membership!.reorderQueueId = 'same-phone';
      expect(await apply(first)).toMatchObject({ kind: 'acknowledged' });
      const second = command('phone-second', 1, ['b', 'a', 'c', 'd', 'e'], [move('b', 2)], null);
      second.edits[0].membership = { ...second.edits[0].membership!, reorderQueueId: 'same-phone', predecessorOperationId: 'phone-first' };
      expect(await apply(second)).toMatchObject({ kind: 'conflict' });
      expect(stored()).toEqual(['b', 'a', 'c', 'e', 'd']);
    });

    it('does not require a deleted anchor from a transient unsaved position', async () => {
      const sequence = command('two-positions', 1, ids, [move('b', 3), move('b', 0)], clock(1000));
      const surviving = ['a', 'b', 'c', 'e'];
      const remove = command('remove-anchor', 1, ids, [move('d', 4)], clock(0), false);
      remove.edits[0].afterItems = rows(surviving);
      expect(await apply(remove)).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(sequence)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(['b', 'a', 'c', 'e']);
    });

    it('records the confirmed return even when the dialog ends in the opening order', async () => {
      const early = command('pending-down', 1, ids, [move('b', 2)], clock(0));
      const returned = command('same-order-save', 1, ids, [move('b', 2), move('b', 1)], clock(1000));
      expect(await apply(returned)).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(early)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(ids);
    });

    it('does not turn an acknowledgement of an added member into proof of a remote move', async () => {
      const extra = 'f';
      documents.set('sermons/' + extra, { userId: owner, title: 'An added member' });
      const withExtra = [...ids, extra];
      const early = command('offline-reorder-after-add', 1, withExtra, [move('b', 0)], clock(0));
      early.edits[0].membership!.predecessorOperationId = 'offline-add';
      const remoteDown = ['a', 'c', 'b', 'd', 'e'];
      expect(await apply(command('desktop-down', 1, ids, [move('b', 2)], clock(1000)))).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(command('desktop-return', 2, remoteDown, [move('b', 1)], clock(2000)))).toMatchObject({ kind: 'acknowledged' });
      const add = command('offline-add', 1, ids, [move('b', 2)], null, false);
      add.edits[0].afterItems = rows(withExtra);
      expect(await apply(add)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(withExtra);
      expect(await apply(early)).toMatchObject({ kind: 'acknowledged' });
      expect(stored()).toEqual(withExtra);
    });

    it.each([true, false])('accepts an exact preceding reorder through an unrelated metadata save (same queue: %s)', async sameQueue => {
      const up = ['b', 'a', 'c', 'd', 'e'];
      const first = command('first-queued', 1, ids, [move('b', 0)], null);
      first.edits[0].membership = { ...first.edits[0].membership!, reorderQueueId: 'phone-queue' };
      expect(await apply(first)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { protocol: 1, kind: 'update', owner, operationId: 'independent-description',
        resource: series, generation: 'opening-series', dependsOn: [],
        changes: [{ path: ['description'], before: { exists: false }, after: { exists: true, value: 'Keep these words' } }],
      })).toMatchObject({ kind: 'acknowledged' });
      const second = command('second-queued', 1, up, [move('b', 2)], null);
      second.edits[0].membership = { ...second.edits[0].membership!, predecessorOperationId: 'first-queued',
        reorderQueueId: sameQueue ? 'phone-queue' : 'other-queue' };
      expect(await apply(second)).toMatchObject({ kind: sameQueue ? 'acknowledged' : 'conflict' });
      expect(stored()).toEqual(sameQueue ? ['a', 'c', 'b', 'd', 'e'] : up);
      expect(documents.get('series/' + series.id)?.description).toBe('Keep these words');
    });

    it('does not let an old multi-series packet replay a tracked item reorder alongside an assignment', async () => {
      expect(await apply(command('desktop-up', 1, ids, [move('b', 0)], clock(0)))).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(command('desktop-return', 2, ['b','a','c','d','e'], [move('b', 1)], clock(1000)))).toMatchObject({ kind: 'acknowledged' });
      const target = { collection: 'series', id: 'old-target' };
      const f = 'f';
      putSeries(target.id);
      documents.set('sermons/' + f, { userId: owner, title: 'Another member' });
      const stale = command('mixed-old-packet', 1, ids, [move('b', 2)], null, false);
      const combined = { ...stale, resource: target, generation: null,
        edits: [{ resource: target, generation: null, beforeItems: [], afterItems: rows([f]) }, ...stale.edits] };
      expect(await processCommand(owner, combined)).toMatchObject({ kind: 'refused', code: 'series-reorder-needs-review' });
      expect(stored()).toEqual(ids);
      expect(documents.get('series/' + target.id)?.items).toEqual([]);
    });

    it('keeps the saved order when times overlap or an old client cannot prove a move', async () => {
      expect(await apply(command('up', 1, ids, [move('b', 0)], clock(0)))).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(command('return', 2, ['b','a','c','d','e'], [move('b', 1)], clock(1000)))).toMatchObject({ kind: 'acknowledged' });
      expect(await apply(command('unknown', 1, ids, [move('b', 2)], null))).toMatchObject({ kind: 'conflict' });
      expect(await apply(command('old', 1, ids, [move('b', 2)], null, false))).toMatchObject({
        kind: 'conflict', snapshot: { resource: series, value: { sermonIds: ids } },
        conflicts: [{ path: ['items'], base: { value: rows(ids) }, mine: { value: rows(['a', 'c', 'b', 'd', 'e']) }, theirs: { value: rows(ids) } }],
      });
      expect(stored()).toEqual(ids);
    });
  });

  describe('same-owner series assignment chronology', () => {
    const sermon = member('g');
    const unrelated = member('keep');
    const seriesA = { collection: 'series', id: 'alpha' };
    const seriesB = { collection: 'series', id: 'beta' };
    const earlier = { earliestMs: 1_799_999_995_000, latestMs: 1_799_999_995_005 };
    const later = { earliestMs: 1_799_999_998_000, latestMs: 1_799_999_998_005 };
    const membership = (time: typeof earlier) => ({ time, observedRevision: 0, added: [{ type: 'sermon', refId: 'g' }], removed: [] });
    const alpha = (time: typeof earlier) => ({
      ...attach(), operationId: 'phone-save-alpha', resource: seriesA,
      edits: [{ resource: seriesA, generation: null, beforeItems: [], afterItems: [sermon], membership: membership(time) }],
    });
    const beta = (time: typeof earlier) => ({
      ...attach(), operationId: 'desktop-save-beta', resource: seriesB,
      edits: [{ resource: seriesB, generation: null, beforeItems: [unrelated],
        afterItems: [unrelated, { ...sermon, position: 2 }], membership: membership(time) }],
    });

    beforeEach(() => {
      documents.set('sermons/g', { userId: owner, title: 'Keep sermon words' });
      documents.set('sermons/keep', { userId: owner, title: 'Keep the other sermon' });
      putSeries(seriesA.id);
      putSeries(seriesB.id, [unrelated]);
    });

    it.each([
      { phone: later, desktop: earlier, expectedAlpha: true },
      { phone: earlier, desktop: later, expectedAlpha: false },
    ])('keeps the later choice through a delayed phone save and receipt replay ($expectedAlpha)', async ({ phone, desktop, expectedAlpha }) => {
      expect(await processCommand(owner, beta(desktop))).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(owner, alpha(phone));
      expect(result).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual(expectedAlpha ? [sermon] : []);
      expect(documents.get('series/beta')).toMatchObject({
        title: 'Keep series', items: expectedAlpha ? [unrelated] : [unrelated, { ...sermon, position: 2 }],
      });
      expect(documents.get('sermons/g')?.title).toBe('Keep sermon words');
      const history = [...documents.entries()].filter(([path]) => path.startsWith('sermons/g/_seriesMembershipHistory/'));
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({
        owner, generation: null,
        former: { id: expectedAlpha ? 'beta' : 'alpha', label: 'Keep series' },
        current: { id: expectedAlpha ? 'alpha' : 'beta', label: 'Keep series' },
        actionTime: earlier, winnerTime: later,
      });
      expect(await listSeriesMembershipHistory(owner, 'sermons', 'g', null)).toMatchObject({
        collection: 'sermons', memberId: 'g', generation: null, entries: [{ former: { label: 'Keep series' } }],
      });
      await expect(listSeriesMembershipHistory('other-owner', 'sermons', 'g')).rejects.toMatchObject({ status: 403 });
      const accepted = structuredClone([...documents.entries()]);
      expect(await processCommand(owner, alpha(phone))).toMatchObject({ kind: 'acknowledged' });
      expect([...documents.entries()]).toEqual(accepted);
    });

    it('keeps legacy history through the first member metadata write and rejects a stale generation', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, alpha(later))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { protocol: 1, owner, resource: { collection: 'sermons', id: 'g' }, generation: null,
        operationId: 'member-first-marker', kind: 'update', dependsOn: [],
        changes: [{ path: ['title'], before: { exists: true, value: 'Keep sermon words' }, after: { exists: true, value: 'New title' } }],
      })).toMatchObject({ kind: 'acknowledged' });
      await expect(listSeriesMembershipHistory(owner, 'sermons', 'g', null)).rejects.toMatchObject({ status: 404 });
      expect(await listSeriesMembershipHistory(owner, 'sermons', 'g', 'member-first-marker')).toMatchObject({
        generation: 'member-first-marker', entries: [{ former: { id: 'beta' }, current: { id: 'alpha' } }],
      });
    });

    it.each(['tracked', 'legacy', 'stale head'] as const)('removes a %s sermon from its series with the expected read cost', async tracking => {
      for (let index = 0; index < 305; index++) putSeries(`unrelated-${index}`);
      const headPath = 'sermons/g/_seriesMembershipOrder/head';
      const assigned = await processCommand(owner, alpha(earlier));
      if (assigned.kind !== 'acknowledged') throw new Error('Fixture series assignment failed');
      const opening = assigned.snapshot.metadata!;
      if (tracking === 'legacy') documents.delete(headPath);
      if (tracking === 'stale head') documents.set(headPath, { ...documents.get(headPath)!,
        location: { id: 'beta', generation: null, revision: 0, label: 'Other series' },
      });
      const readsBefore = documentReadUnits;
      expect(await processCommand(owner, { ...alpha(later), operationId: 'remove-one-member', generation: opening.generation,
        edits: [{ resource: seriesA, generation: opening.generation, beforeItems: [sermon], afterItems: [],
          membership: { time: later, observedRevision: opening.revision, removed: membership(later).added, added: [] } }],
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { items: [], sermonIds: [] } } });
      const reads = documentReadUnits - readsBefore;
      if (tracking === 'tracked') expect(reads).toBe(5);
      else expect(reads).toBeGreaterThanOrEqual(305);
      expect(documents.get(headPath)).toMatchObject({ location: null, operationId: 'remove-one-member' });
      expect(documents.get('sermons/g')?.title).toBe('Keep sermon words');
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
    });

    it('applies a later removal to the actual current series and keeps an older assignment from restoring it', async () => {
      const initial = await processCommand(owner, alpha(earlier));
      expect(initial.kind).toBe('acknowledged');
      const sourceGeneration = 'phone-save-alpha';
      const remove = (time: typeof earlier) => ({ resource: seriesA, generation: sourceGeneration, beforeItems: [sermon], afterItems: [],
        membership: { time, observedRevision: 1, removed: membership(time).added, added: [] } });
      const move = beta(later);
      expect(await processCommand(owner, { ...move, edits: [move.edits[0], remove(later)] })).toMatchObject({ kind: 'acknowledged' });
      const latest = { earliestMs: 1_799_999_999_000, latestMs: 1_799_999_999_005 };
      expect(await processCommand(owner, { ...alpha(latest), operationId: 'later-unassign', generation: sourceGeneration,
        edits: [remove(latest)] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
      const gamma = { collection: 'series', id: 'gamma' };
      putSeries('gamma');
      expect(await processCommand(owner, { ...alpha(earlier), operationId: 'earlier-gamma', resource: gamma,
        edits: [{ ...alpha(earlier).edits[0], resource: gamma }] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/gamma')?.items).toEqual([]);
    });

    it('does not retain a prior timed destination across an untimed move away and back', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      const untimedBeta = { resource: seriesB, generation: 'desktop-save-beta', beforeItems: [unrelated, { ...sermon, position: 2 }], afterItems: [unrelated] };
      const untimedAlpha = { resource: seriesA, generation: null, beforeItems: [], afterItems: [sermon] };
      expect(await processCommand(owner, { ...alpha(later), operationId: 'legacy-to-alpha',
        edits: [untimedAlpha, untimedBeta] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...beta(later), operationId: 'legacy-to-beta', generation: 'desktop-save-beta',
        edits: [{ ...untimedBeta, beforeItems: untimedBeta.afterItems, afterItems: untimedBeta.beforeItems },
          { ...untimedAlpha, generation: 'legacy-to-alpha', beforeItems: [sermon], afterItems: [] }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...alpha(later), operationId: 'delayed-after-legacy', generation: 'legacy-to-alpha',
        edits: [{ ...alpha(later).edits[0], generation: 'legacy-to-alpha' }] })).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
      expect(documents.get('series/beta')?.items).toEqual([unrelated, { ...sermon, position: 2 }]);
    });

    it('accepts an assignment causally following its exact unclocked Clear on another series', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      const betaItems = [unrelated, { ...sermon, position: 2 }];
      const betaGeneration = 'desktop-save-beta';
      const clear = { ...beta(later), operationId: 'clear-beta', generation: betaGeneration,
        edits: [{ resource: seriesB, generation: betaGeneration, beforeItems: betaItems, afterItems: [unrelated],
          membership: { time: null, observedRevision: 1, added: [], removed: membership(later).added } }] };
      expect(await processCommand(owner, clear)).toMatchObject({ kind: 'acknowledged' });
      const next = alpha(later);
      expect(await processCommand(owner, { ...next, edits: [
        { ...next.edits[0], membership: { ...next.edits[0].membership, time: null } },
        { resource: seriesB, generation: betaGeneration, beforeItems: [unrelated], afterItems: [unrelated],
          membership: { time: null, observedRevision: 1, added: [], removed: [], predecessorOperationId: clear.operationId } },
      ] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([sermon]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
    });

    it('holds a delayed assignment after an unclocked assign and clear', async () => {
      const betaOpening = { resource: seriesB, generation: null, beforeItems: [unrelated], afterItems: [unrelated, { ...sermon, position: 2 }] };
      expect(await processCommand(owner, { ...beta(earlier), edits: [betaOpening] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...beta(later), operationId: 'legacy-clear', generation: 'desktop-save-beta',
        edits: [{ ...betaOpening, generation: 'desktop-save-beta', beforeItems: betaOpening.afterItems, afterItems: [unrelated] }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, alpha(earlier))).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated]);
      const command = alpha(later);
      const version = documents.get(`${HEADS_COLLECTION}/${collectionHeadId(owner, 'series')}`)!.version;
      expect(await processCommand(owner, { ...command, operationId: 'fresh-alpha',
        edits: [{ ...command.edits[0], membership: { ...command.edits[0].membership, observedCatalogVersion: version } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([sermon]);
    });

    it('keeps a stale assignment from reviving membership after a whole series is deleted', async () => {
      const assigned = await processCommand(owner, beta(earlier));
      if (assigned.kind !== 'acknowledged') throw new Error('Fixture series assignment failed');
      const snapshot = assigned.snapshot;
      expect(await processCommand(owner, { protocol: 1, owner, operationId: 'delete-beta', kind: 'delete',
        resource: seriesB, generation: snapshot.metadata!.generation, dependsOn: [], baseline: snapshot.value!,
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
      expect(await processCommand(owner, alpha(earlier))).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      const command = alpha(later);
      const version = documents.get(`${HEADS_COLLECTION}/${collectionHeadId(owner, 'series')}`)!.version;
      expect(await processCommand(owner, { ...command, operationId: 'alpha-after-delete',
        edits: [{ ...command.edits[0], membership: { ...command.edits[0].membership, observedCatalogVersion: version } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([sermon]);
    });

    it('repairs a historical double assignment when the selected series already holds the sermon', async () => {
      putSeries('alpha', [sermon]);
      const alreadyInBeta = [unrelated, { ...sermon, position: 2 }];
      putSeries('beta', alreadyInBeta);
      expect(await processCommand(owner, { ...beta(later), edits: [
        { resource: seriesB, generation: null, beforeItems: alreadyInBeta, afterItems: alreadyInBeta,
          membership: { ...membership(later), added: [] } },
        { resource: seriesA, generation: null, beforeItems: [sermon], afterItems: [],
          membership: { ...membership(later), added: [], removed: membership(later).added } },
      ] })).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual(alreadyInBeta);
    });

    it.each([true, false])('reconciles a legacy retained destination before trusting the head (third membership: %s)', async thirdMembership => {
      for (let index = 0; index < 105; index++) putSeries(`unrelated-${index}`);
      const alreadyInBeta = [unrelated, { ...sermon, position: 2 }];
      putSeries('alpha', [sermon]);
      putSeries('beta', alreadyInBeta);
      putSeries('gamma', thirdMembership ? [sermon] : []);
      const legacy = { ...beta(earlier), operationId: 'legacy-retains-beta', edits: [
        { resource: seriesB, generation: null, beforeItems: alreadyInBeta, afterItems: alreadyInBeta },
        { resource: seriesA, generation: null, beforeItems: [sermon], afterItems: [] },
      ] };
      expect((await processCommand(owner, legacy)).kind).toBe('acknowledged');
      const headPath = 'sermons/g/_seriesMembershipOrder/head';
      expect(documents.get(headPath)).toMatchObject({ location: { id: 'beta' }, time: null });
      expect(documents.get(headPath)).not.toHaveProperty('catalogVerified');
      const before = documentReadUnits;
      const ordered = await processCommand(owner, { ...beta(later), operationId: 'ordered-removal', generation: legacy.operationId,
        edits: [{ resource: seriesB, generation: legacy.operationId, beforeItems: alreadyInBeta, afterItems: [unrelated],
          membership: { time: later, observedRevision: 1, added: [], removed: membership(later).added } }],
      });
      if (thirdMembership) {
        expect(ordered).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
        expect(documents.get('series/beta')?.items).toEqual(alreadyInBeta);
        expect(documents.get('series/gamma')?.items).toEqual([sermon]);
        expect(documents.get(headPath)).toMatchObject({ location: { id: 'beta' } });
        return;
      }
      expect(ordered).toMatchObject({ kind: 'acknowledged' });
      expect(documentReadUnits - before).toBeGreaterThanOrEqual(105);
      expect(documents.get(headPath)).toMatchObject({ location: null, catalogVerified: true });
      const verified = documentReadUnits;
      const gamma = { collection: 'series', id: 'gamma' };
      expect((await processCommand(owner, { ...alpha(later), operationId: 'assign-after-reconciliation', resource: gamma,
        edits: [{ ...alpha(later).edits[0], resource: gamma, membership: { ...membership(later), time: null,
          observedCatalogVersion: documents.get(`${HEADS_COLLECTION}/${collectionHeadId(owner, 'series')}`)!.version as number } }],
      })).kind).toBe('acknowledged');
      expect(documentReadUnits - verified).toBe(5);
      expect(documents.get('series/gamma')?.items).toEqual([sermon]);
    });

    it('retains the old guard when the actions have no provable order', async () => {
      expect(await processCommand(owner, beta(earlier))).toMatchObject({ kind: 'acknowledged' });
      const refusal = await processCommand(owner, alpha(earlier));
      expect(refusal).toMatchObject({ kind: 'refused', code: 'membership-already-assigned',
        seriesMembershipComparisons: [{ ref: { type: 'sermon', refId: 'g' }, label: 'Keep sermon words',
          proposed: { id: 'alpha', label: 'Keep series' }, stored: { id: 'beta', label: 'Keep series' } }],
      });
      expect(await processCommand(owner, alpha(earlier))).toEqual(refusal);
      expect(documents.get('series/alpha')?.items).toEqual([]);
      expect(documents.get('series/beta')?.items).toEqual([unrelated, { ...sermon, position: 2 }]);
    });
  });

  it.each([99, 100])('enforces the exact participant boundary for %s related series', async count => {
    const baseline = { userId: owner, title: 'Target' };
    documents.set('groups/g', baseline);
    for (let index = 0; index < count; index++) putSeries(`related-${index}`, [member('g', 'group')]);
    const result = await processCommand(owner, remove('groups', 'g', baseline));
    expect(result.kind).toBe(count === 99 ? 'acknowledged' : 'refused');
    if (count === 100) expect(documents.get('groups/g')).toEqual(baseline);
    else expect(documents.get('series/related-98')?.items).toEqual([]);
  });

  it('keeps the atomic refusal for too many genuinely related records', async () => {
    const baseline = { userId: owner, title: 'Keep target' };
    documents.set('groups/g', baseline);
    for (let index = 0; index < 101; index++) putSeries(`related-${index}`, [member('g', 'group')]);
    expect(await processCommand(owner, remove('groups', 'g', baseline))).toMatchObject({ kind: 'refused', code: 'relation-scope-too-large' });
    expect(documents.get('groups/g')).toEqual(baseline);
    expect(documents.get('series/related-100')?.items).toEqual([member('g', 'group')]);
  });
});

describe('accepted resource recency', () => {
  const first = '2026-10-15T10:00:00.000Z';
  const later = '2026-10-15T11:00:00.000Z';
  beforeEach(() => { jest.useFakeTimers({ now: new Date(first) }); });
  afterEach(() => { jest.useRealTimers(); });

  it('stamps creates and field-only saves consistently in ACK, storage and collection reads', async () => {
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', snapshot: { value: { updatedAt: first } } });
    jest.setSystemTime(new Date(later));
    const accepted = await processCommand('owner-1', update());
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: later } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(later);
    expect(await readDocument('owner-1', resource)).toEqual(accepted.kind === 'acknowledged' ? accepted.snapshot : null);
    expect(await readCollectionChanges('owner-1', 'sermons', 0)).toMatchObject({ snapshots: [{ value: { updatedAt: later } }] });
  });

  it('preserves native timestamp storage on a no-op and stamps content changes consistently', async () => {
    const nativeTime = { toDate: () => new Date(first) };
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', updatedAt: nativeTime });
    jest.setSystemTime(new Date(later));
    const noChange = await processCommand('owner-1', { ...update('native-no-op', null), changes: [
      { path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'First' } },
    ] });
    expect(noChange).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'First', updatedAt: first } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(nativeTime);
    const edited = await processCommand('owner-1', update('native-edit', 'native-no-op'));
    expect(edited).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: later } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(later);
    if (edited.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    expect(await readDocument('owner-1', resource)).toEqual(edited.snapshot);
  });

  it('accepts a normal legacy edit that supplies missing required recency metadata', async () => {
    const note = { collection: 'studyNotes', id: 'legacy-note' };
    documents.set('studyNotes/legacy-note', { userId: 'owner-1', content: 'Before', tags: [], isDraft: false, createdAt: first });
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', { protocol: 1, operationId: 'legacy-edit', owner: 'owner-1', resource: note,
      generation: null, dependsOn: [], kind: 'update', changes: [
        { path: ['content'], before: { exists: true, value: 'Before' }, after: { exists: true, value: 'After' } },
        { path: ['updatedAt'], before: { exists: false }, after: { exists: true, value: '2026-10-15T10:30:00.000Z' } },
      ] })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { content: 'After', updatedAt: later } } });
  });

  it('uses one server time for every changed participant of a relation', async () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [], updatedAt: first });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [], updatedAt: first });
    jest.setSystemTime(new Date(later));
    const accepted = await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'attach',
      resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
      beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] });
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { updatedAt: later } }, relatedSnapshots: [{ value: { updatedAt: later } }] });
    expect(documents.get('studyMaterials/m')?.updatedAt).toBe(later);
    expect(documents.get('studyNotes/n')?.updatedAt).toBe(later);
    expect(documentReadUnits).toBe(5);
    expect(transactionWrites).toHaveLength(7);
  });

  it('acknowledges duplicate content and timestamp-only saves without moving recency', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update('title-edit'));
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: first } } });
    // Another device submits the same authored change with a stale ancestor.
    expect(await processCommand('owner-1', update('same-edit'))).toMatchObject({ kind: 'acknowledged', committed: { revision: 3 }, snapshot: { value: { title: 'Second', updatedAt: first } } });
    const revisionBeforeTimestamp = documents.get('sermons/sermon-1')?.rev;
    expect(await processCommand('owner-1', { ...update('timestamp-only'), changes: [{ path: ['updatedAt'], before: { exists: true, value: first }, after: { exists: true, value: '2099-01-01T00:00:00.000Z' } }] })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: first } } });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(first);
    expect(documents.get('sermons/sermon-1')?.rev).toEqual(revisionBeforeTimestamp);
  });

  it('retains the existing refusal of creation metadata changes', async () => {
    await processCommand('owner-1', create());
    jest.setSystemTime(new Date(later));
    const result = await processCommand('owner-1', { ...update('creation-metadata'), changes: [{ path: ['createdAt'], before: { exists: false }, after: { exists: true, value: '2026-10-01T00:00:00.000Z' } }] });
    expect(result).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(first);
    expect(documents.get('sermons/sermon-1')).not.toHaveProperty('createdAt');
  });

  it('does not move either participant for an already-satisfied relation', async () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
    const command: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'attach',
      resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
      beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] };
    await processCommand('owner-1', command);
    jest.setSystemTime(new Date(later));
    const result = await processCommand('owner-1', { ...command, operationId: 'already-attached', generation: 'attach', beforeNoteIds: ['n'], targets: [{ id: 'n', generation: 'attach' }] });
    expect(result).toMatchObject({ kind: 'acknowledged', committed: { revision: 2, operationId: 'already-attached' }, snapshot: { value: { updatedAt: first } } });
    expect(documents.get('studyMaterials/m')?.updatedAt).toBe(first);
    expect(documents.get('studyNotes/n')?.updatedAt).toBe(first);
  });

  it('does not let an old device timestamp refuse an independent content edit', async () => {
    await processCommand('owner-1', create());
    jest.setSystemTime(new Date(later));
    const command = update();
    if (command.kind !== 'update') throw new Error('Expected update');
    const accepted = await processCommand('owner-1', { ...command, changes: [...command.changes,
      { path: ['updatedAt'], before: { exists: true, value: '2026-10-01T00:00:00.000Z' }, after: { exists: true, value: '2026-10-02T00:00:00.000Z' } }] });
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Second', updatedAt: later } } });
  });

  it('keeps refusal, blocked delivery, conflict and failed commit from moving recency', async () => {
    await processCommand('owner-1', create());
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', update('wrong-generation', 'wrong'))).toMatchObject({ kind: 'refused' });
    expect(await processCommand('owner-1', { ...update('blocked'), dependsOn: ['missing'] })).toMatchObject({ kind: 'blocked' });
    expect(await processCommand('owner-1', { ...update('conflict'), changes: [{ path: ['title'], before: { exists: true, value: 'Unseen' }, after: { exists: true, value: 'Other' } }] })).toMatchObject({ kind: 'conflict' });
    failCommit = true;
    await expect(processCommand('owner-1', update('failed'))).rejects.toThrow('Commit failed');
    expect(documents.get('sermons/sermon-1')?.updatedAt).toBe(first);
  });

  it('leaves tombstones without authored fields or a new recency time', async () => {
    const saved = await processCommand('owner-1', create());
    if (saved.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    jest.setSystemTime(new Date(later));
    expect(await processCommand('owner-1', { ...update('delete'), kind: 'delete', baseline: saved.snapshot.value! })).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    expect(documents.get('sermons/sermon-1')).not.toHaveProperty('updatedAt');
  });
});

describe('document operation budgets', () => {
  const reset = () => { documentReadUnits = 0; transactionWrites.length = 0; };
  const measured = () => ({ reads: documentReadUnits, writes: transactionWrites.length });

  it('bounds an atomic two-document relation across two collections', async () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
    expect(await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'attach',
      resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
      beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] })).toMatchObject({ kind: 'acknowledged' });
    expect(measured()).toEqual({ reads: 5, writes: 7 });
  });

  it('bounds create/update and duplicate/refused delivery without multiplying effect writes', async () => {
    await processCommand('owner-1', create());
    expect(measured()).toEqual({ reads: 3, writes: 4 }); // Resource, receipt, head; resource, receipt, head, pointer.
    reset(); await processCommand('owner-1', update());
    expect(measured()).toEqual({ reads: 3, writes: 4 });
    reset(); await processCommand('owner-1', update());
    expect(measured()).toEqual({ reads: 2, writes: 0 });
    reset(); expect(await processCommand('owner-1', { ...update('conflict'), changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Competing' } }] })).toMatchObject({ kind: 'conflict' });
    expect(measured()).toEqual({ reads: 2, writes: 1 });
  });

  describe('cold owner-list read budgets', () => {
    it('checks an empty owner list without a second empty query', async () => {
      const page = await listDocuments('owner-1', 'sermons', { limit: 2 });
      expect(page.snapshots).toEqual([]);
      expect(page.nextCursor).toBeNull();
      expect(measured()).toEqual({ reads: 2, writes: 0 });
    });

    it.each(['live', 'mixed'] as const)('does not repeatedly fetch unreturned %s page tails', async mode => {
      const expected = Array.from({ length: 9 }, (_, index) => `row-${index}`);
      expected.forEach((id, index) => {
        const deleted = mode === 'mixed' && index % 2 === 1;
        documents.set(`sermons/${id}`, deleted
          ? { _dataEngineOwner: 'owner-1', _dataEngine: { protocol: 1, generation: id, revision: 1, deleted: true },
            ...(index === 3 ? { userId: 'owner-1' } : {}) }
          : { userId: 'owner-1', title: id });
        documents.set(`sermons/foreign-${index}`, { userId: 'attacker', title: 'Never this owner' });
      });
      const seen: ResourceSnapshot[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const page = await listDocuments('owner-1', 'sermons', { limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.snapshots);
        pages += 1;
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen.map(item => item.resource.id)).toEqual(expected);
      expect(seen.map(item => item.value === null)).toEqual(expected.map((_, index) => mode === 'mixed' && index % 2 === 1));
      expect(pages).toBe(5);
      // These small rows fit the byte budget: each page needs its head and at most one lookahead row.
      // This is the existing SDK document-operation model, not a cloud billing assertion.
      expect(measured().reads).toBeLessThanOrEqual(expected.length + pages + (pages - 1));
      expect(measured().writes).toBe(0);
    });
  });

  it('counts empty queries, live and tombstone lists, and deduplicated feed document reads', async () => {
    await listDocuments('owner-1', 'sermons');
    expect(measured()).toEqual({ reads: 2, writes: 0 }); // Head plus one empty ownership-union query.
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    reset(); await listDocuments('owner-1', 'sermons');
    expect(measured()).toEqual({ reads: 2, writes: 0 }); // One live row and head; no extra empty tombstone query.
    reset(); await readCollectionChanges('owner-1', 'sermons', 0);
    expect(measured()).toEqual({ reads: 4, writes: 0 }); // Two pointers, one distinct document, one head.
    reset(); await readCollectionChanges('owner-1', 'sermons', 2);
    expect(measured()).toEqual({ reads: 2, writes: 0 });
  });

  it('retains compact acknowledgement proofs across a thousand saves and replays an old operation', async () => {
    await processCommand('owner-1', create());
    reset();
    for (let index = 0; index < 1_000; index += 1) {
      const before = index === 0 ? 'First' : `Title ${index - 1}`;
      const after = `Title ${index}`;
      const saved = await processCommand('owner-1', { ...update(`save-${index}`),
        changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        sermonTitleAction: { before, after, observedRevision: index + 1, time: null } });
      expect(saved.kind).toBe('acknowledged');
    }
    expect(measured()).toEqual({ reads: 3_000, writes: 4_000 });
    const savedReceipts = receipts();
    expect(savedReceipts).toHaveLength(1_001);
    expect(Math.max(...savedReceipts.map(([, value]) => Buffer.byteLength(JSON.stringify(value))))).toBeLessThan(1_000);
    expect([...documents.keys()].filter(key => key.includes('/changes/'))).toHaveLength(1_001);
    reset(); expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', committed: { revision: 1 }, snapshot: { value: { title: 'Title 999' } } });
    expect(measured()).toEqual({ reads: 2, writes: 0 });
  });

  it('does not reapply an old saved operation when later edits return to its original ancestor', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    await processCommand('owner-1', { ...update('back-to-first'), changes: [{ path: ['title'], before: { exists: true, value: 'Second' }, after: { exists: true, value: 'First' } }] });
    reset();
    expect(await processCommand('owner-1', update())).toMatchObject({ kind: 'acknowledged', committed: { revision: 2 }, snapshot: { value: { title: 'First' } } });
    expect(measured()).toEqual({ reads: 2, writes: 0 });
  });
});

describe('atomic acknowledgement participants', () => {
  const attach: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'attach',
    resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
    beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] };
  const seed = () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
  };

  it('returns secondary accepted content without storing it in compact history or adding initial reads', async () => {
    seed();
    const result = await processCommand('owner-1', attach);
    expect(result).toMatchObject({ kind: 'acknowledged', relatedSnapshots: [{ resource: { collection: 'studyNotes', id: 'n' },
      value: { content: 'Keep text', materialIds: ['m'] }, metadata: { generation: 'attach', revision: 1 } }] });
    expect(documentReadUnits).toBe(5);
    const stored = JSON.parse(documents.get(receiptPath('owner-1', 'attach'))!.resultJson as string);
    expect(stored.relatedSnapshots).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('Keep text');
    expect(stored.affected).toHaveLength(1);
  });
  it('acknowledges a new already-satisfied relation with its own replayable proof', async () => {
    seed(); await processCommand('owner-1', attach);
    const noChange: DataCommand = { ...attach, operationId: 'already-satisfied', generation: 'attach', beforeNoteIds: ['n'], targets: [{ id: 'n', generation: 'attach' }] };
    const accepted = await processCommand('owner-1', noChange);
    expect(accepted).toMatchObject({ kind: 'acknowledged', committed: { operationId: 'already-satisfied', revision: 2 },
      snapshot: { value: { noteIds: ['n'] }, metadata: { operationId: 'already-satisfied' } } });
    const writes = [...transactionWrites];
    expect(await processCommand('owner-1', noChange)).toEqual(accepted);
    expect(transactionWrites).toEqual(writes);
    expect((await readDocument('owner-1', { collection: 'studyNotes', id: 'n' })).metadata?.revision).toBe(1);
  });

  it('replays current related content with proof of the earlier effect and zero new writes', async () => {
    seed(); await processCommand('owner-1', attach);
    await processCommand('owner-1', { ...update('edit-note', 'attach'), resource: { collection: 'studyNotes', id: 'n' },
      changes: [{ path: ['content'], before: { exists: true, value: 'Keep text' }, after: { exists: true, value: 'Later remote text' } }] });
    const writes = [...transactionWrites]; documentReadUnits = 0;
    expect(await processCommand('owner-1', attach)).toMatchObject({ kind: 'acknowledged',
      affected: [{ metadata: { revision: 1 } }], relatedSnapshots: [{ value: { content: 'Later remote text' }, metadata: { revision: 2 } }] });
    expect(transactionWrites).toEqual(writes);
    expect(documentReadUnits).toBe(3);
  });

  it.each(['missing', 'owner', 'generation', 'revision', 'corrupt'])('keeps related %s evidence retryable without replaying writes or exposing data', async reason => {
    seed(); await processCommand('owner-1', attach);
    const stored = documents.get('studyNotes/n')!;
    if (reason === 'missing') documents.delete('studyNotes/n');
    else if (reason === 'owner') documents.set('studyNotes/n', { ...stored, userId: 'other' });
    else documents.set('studyNotes/n', { ...stored, _dataEngine: { ...(stored._dataEngine as Raw),
      ...(reason === 'generation' ? { generation: 'replacement' } : reason === 'revision' ? { revision: 0 } : { protocol: 2 }) } });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', attach)).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
  });
  it('replays a later related deletion without resurrecting it', async () => {
    seed(); await processCommand('owner-1', attach);
    const note = await readDocument('owner-1', { collection: 'studyNotes', id: 'n' });
    await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'delete-related', resource: note.resource,
      generation: note.metadata!.generation, dependsOn: [], kind: 'delete', baseline: note.value! });
    expect(await processCommand('owner-1', attach)).toMatchObject({ kind: 'acknowledged',
      affected: [{ metadata: { deleted: false } }], relatedSnapshots: [{ value: null, metadata: { deleted: true } }] });
  });
  it('keeps compact ACK proof available when later related content exceeds the response budget', async () => {
    seed(); await processCommand('owner-1', attach);
    // Synthetic oversized storage probes the response bound without a cloud write.
    const stored = documents.get('studyNotes/n')!;
    documents.set('studyNotes/n', { ...stored, content: 'x'.repeat(8 * 1024 * 1024) });
    const result = await processCommand('owner-1', attach);
    expect(result).toMatchObject({ kind: 'acknowledged', affected: [{ resource: { collection: 'studyNotes', id: 'n' } }] });
    expect(result).not.toHaveProperty('relatedSnapshots');
  });
});

describe('transactional relation execution', () => {
  const relation = (operationId = 'attach'): DataCommand => ({ protocol: 1, owner: 'owner-1', operationId,
    resource: { collection: 'studyMaterials', id: 'm' }, generation: null, dependsOn: [], kind: 'relation', relation: 'material-notes',
    beforeNoteIds: [], afterNoteIds: ['n'], targets: [{ id: 'n', generation: null }] });
  const seed = () => {
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [] });
    documents.set('studyNotes/n', { userId: 'owner-1', content: 'Keep text', materialIds: [] });
  };

  it('commits both directions with one receipt and replays concurrent duplicates without another revision', async () => {
    seed();
    const [first, replay] = await Promise.all([processCommand('owner-1', relation()), processCommand('owner-1', relation())]);
    expect(first).toMatchObject({ kind: 'acknowledged', affected: [{ resource: { collection: 'studyNotes', id: 'n' }, metadata: { revision: 1, operationId: 'attach' } }] });
    expect(replay).toEqual(first);
    expect(documents.get('studyMaterials/m')).toMatchObject({ noteIds: ['n'], _dataEngine: { revision: 1, operationId: 'attach' } });
    expect(documents.get('studyNotes/n')).toMatchObject({ content: 'Keep text', materialIds: ['m'], _dataEngine: { revision: 1 } });
    expect(receipts()).toHaveLength(1);
    expect(transactionReads).toContain('studyNotes/n');
    expect(await readDocument('owner-1', { collection: 'studyNotes', id: 'n' })).toMatchObject({ metadata: { operationId: 'attach' } });
  });

  it('rolls back all relation participants and receipt together after commit failure', async () => {
    seed();
    failCommit = true;
    await expect(processCommand('owner-1', relation())).rejects.toThrow('Commit failed');
    expect(documents.get('studyMaterials/m')?.noteIds).toEqual([]);
    expect(documents.get('studyNotes/n')?.materialIds).toEqual([]);
    expect(receipts()).toHaveLength(0);
  });

  it('refuses a foreign related document without leaking its value or applying the primary patch', async () => {
    seed();
    documents.set('studyNotes/n', { userId: 'victim', content: 'Private text', materialIds: [] });
    const result = await processCommand('owner-1', relation());
    expect(result).toEqual({ kind: 'refused', operationId: 'attach', code: 'permission-denied' });
    expect(documents.get('studyMaterials/m')?.noteIds).toEqual([]);
    expect(JSON.stringify(receipts())).not.toContain('Private text');
  });

  it.each([true, false])('serializes series attachment against target deletion (delete first: %s)', async deleteFirst => {
    documents.set('sermons/s', { userId: 'owner-1', title: 'Delete target' });
    documents.set('series/a', { userId: 'owner-1', items: [], sermonIds: [] });
    const attach: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'attach-series',
      resource: { collection: 'series', id: 'a' }, generation: null, dependsOn: [], kind: 'relation', relation: 'series-membership',
      edits: [{ resource: { id: 'a', collection: 'series' }, generation: null, beforeItems: [], afterItems: [{ id: 'item', type: 'sermon', refId: 's', position: 1 }] }] };
    const remove: DataCommand = { protocol: 1, owner: 'owner-1', operationId: 'delete-sermon', resource: { collection: 'sermons', id: 's' },
      generation: null, dependsOn: [], kind: 'delete', baseline: { userId: 'owner-1', title: 'Delete target' } };
    const ordered = deleteFirst ? [remove, attach] : [attach, remove];
    const result = await Promise.all(ordered.map(command => processCommand('owner-1', command)));
    expect(result[0].kind).toBe('acknowledged');
    expect(result[1].kind).toBe(deleteFirst ? 'refused' : 'acknowledged');
    expect(documents.get('sermons/s')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    expect(documents.get('series/a')?.items).toEqual([]);
    expect(transactionReads).toContain('sermons/s');
    expect(receipts()).toHaveLength(2);
  });

  it('deletes a note and legacy section-only references atomically, preserving unrelated material', async () => {
    seed();
    documents.set('studyMaterials/m', { userId: 'owner-1', noteIds: [], sections: [{ id: 'section', title: 'Keep title', noteIds: ['n'] }] });
    documents.set('studyMaterials/other', { userId: 'owner-1', title: 'Unrelated' });
    const command: DataCommand = { ...relation('delete-note'), resource: { collection: 'studyNotes', id: 'n' }, kind: 'delete', baseline: { userId: 'owner-1', content: 'Keep text', materialIds: [] } };
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('studyMaterials/m')).toMatchObject({ sections: [{ id: 'section', title: 'Keep title', noteIds: [] }], _dataEngine: { operationId: 'delete-note' } });
    expect(documents.get('studyMaterials/other')).toEqual({ userId: 'owner-1', title: 'Unrelated' });
  });

  it('retires a note and all owned public links atomically with a separate ownerId-scoped feed', async () => {
    seed();
    documents.set('studyNoteShareLinks/link', { ownerId: 'owner-1', noteId: 'n', token: 'secret-token', viewCount: 5 });
    documents.set('studyNoteShareLinks/foreign', { ownerId: 'victim', noteId: 'n', token: 'foreign-token' });
    const command: DataCommand = { ...relation('retire'), resource: { collection: 'studyNotes', id: 'n' }, kind: 'delete', baseline: { userId: 'owner-1', content: 'Keep text', materialIds: [] } };
    failCommit = true;
    await expect(processCommand('owner-1', command)).rejects.toThrow('Commit failed');
    expect(documents.get('studyNoteShareLinks/link')?.token).toBe('secret-token');
    failCommit = false;
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('studyNoteShareLinks/link')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true, operationId: 'retire' }) });
    expect(documents.get('studyNoteShareLinks/foreign')?.token).toBe('foreign-token');
    expect(await readCollectionChanges('owner-1', 'studyNoteShareLinks', 0)).toMatchObject({ version: 1, snapshots: [{ value: null, metadata: { deleted: true } }] });
    expect((await listDocuments('owner-1', 'studyNoteShareLinks')).snapshots).toHaveLength(1);
  });

  it('retires a shared note on a deployment whose switches add nothing to the engine-owned collections', async () => {
    seed();
    documents.set('studyNoteShareLinks/link', { ownerId: 'owner-1', noteId: 'n', token: 'secret-token', viewCount: 5 });
    const switches = ['DATA_ENGINE_ENABLED', 'DATA_ENGINE_COLLECTIONS', 'DATA_ENGINE_CLOSED_COLLECTIONS'] as const;
    const saved = switches.map(name => process.env[name]);
    switches.forEach(name => { delete process.env[name]; });
    jest.mocked(isCollectionServed).mockImplementation(jest.requireActual('@/data-engine/activation').isCollectionServed);
    try {
      const command: DataCommand = { ...relation('retire-shared'), resource: { collection: 'studyNotes', id: 'n' }, kind: 'delete', baseline: { userId: 'owner-1', content: 'Keep text', materialIds: [] } };
      expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
      expect(documents.get('studyNoteShareLinks/link')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    } finally {
      switches.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
    }
  });

  it('refuses a multi-document payload beyond its byte budget before any effect is written', async () => {
    seed();
    const command = relation('large') as Extract<DataCommand, { relation: 'material-notes' }>;
    command.afterNoteIds = Array.from({ length: 9 }, (_, index) => `large-${index}`);
    command.targets = command.afterNoteIds.map(id => ({ id, generation: null }));
    for (const id of command.afterNoteIds) documents.set(`studyNotes/${id}`, { userId: 'owner-1', content: 'x'.repeat(950_000), materialIds: [] });
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'refused', code: 'relation-effects-too-large' });
    expect(documents.get('studyMaterials/m')?.noteIds).toEqual([]);
    expect(documents.get('studyNotes/large-0')?.materialIds).toEqual([]);
  });
});

describe('sermon preparation text action chronology', () => {
  const owner = 'owner-1';
  const openingText = 'Opening words';
  const sibling = ['preparation', 'textContext', 'passage'] as const;
  const authorIntent = ['preparation', 'authorIntent'] as const;
  const truth = ['preparation', 'timelessTruth'] as const;
  const fields = [
    authorIntent, truth, ['preparation', 'christConnection'], ['preparation', 'preachingGoal', 'statement'],
    ['preparation', 'mainIdea', 'contextIdea'], ['preparation', 'mainIdea', 'textIdea'], ['preparation', 'mainIdea', 'argumentation'],
    ['preparation', 'thesis', 'exegetical'], ['preparation', 'thesis', 'homiletical'], ['preparation', 'thesis', 'transitionSentence'],
    ['preparation', 'thesis', 'oneSentence'], ['preparation', 'thesis', 'sermonInOneSentence'],
    ['preparation', 'thesis', 'homileticalAnswers', 'whyPreach'], ['preparation', 'thesis', 'homileticalAnswers', 'impactOnChurch'],
    ['preparation', 'thesis', 'homileticalAnswers', 'practicalQuestions'], ['preparation', 'homileticPlan', 'modernTranslation'],
    ['preparation', 'textContext', 'passageSummary'], ['preparation', 'textContext', 'contextNotes'],
  ] as const;
  const word = (value: string) => ({ exists: true, value });

  const setup = async (path: readonly string[], openingValue: FieldValue = word(openingText)) => {
    const seed = create();
    if (seed.kind !== 'create') throw Error('Expected creation');
    const value = writeField(writeField(seed.value, sibling, word('Passage context')), path, openingValue);
    const result = await processCommand(owner, { ...seed, value });
    if (result.kind !== 'acknowledged') throw Error('Expected the sermon to exist');
    return result.snapshot;
  };
  const save = (basis: ResourceSnapshot, id: string, path: readonly string[], value: FieldValue,
    timeMs?: number | null, independent?: { path: readonly string[]; text: string }) => {
    const choice = writeField(basis.value!, path, value);
    const draft = independent ? writeField(choice, independent.path, word(independent.text)) : choice;
    const { command } = prepareDomainCommand(owner, id, basis, draft);
    if (command.kind !== 'update') throw Error('Expected a text update');
    if (timeMs === undefined) return command;
    return { ...command, sermonPreparationTextActions: {
      [path.at(-1)!]: { observedRevision: basis.metadata!.revision,
        time: timeMs === null ? null : { earliestMs: timeMs, latestMs: timeMs + 20 } },
    } };
  };
  const accepted = async (command: DataCommand) => {
    const result = await processCommand(owner, command);
    if (result.kind !== 'acknowledged') throw Error(`Expected acknowledgement, got ${result.kind}`);
    return result.snapshot;
  };
  const read = async (path: readonly string[]) => readField((await readDocument(owner, resource)).value!, path);
  const history = (field: string) => [...documents.entries()].flatMap(([path, value]) => path.startsWith('sermons/sermon-1/_metadataHistory/')
    ? (value.fields as { field: string; value: string }[]).filter(entry => entry.field === field).map(entry => entry.value) : []);

  it.each(fields.map(path => [path.join('.'), path] as const))(
    'holds an old unproved packet after a deliberate return in %s', async (_name, path) => {
      const opening = await setup(path);
      const delayed = save(opening, 'old-phone', path, word('Earlier offline words'));
      const moved = await accepted(save(opening, 'desktop-edit', path, word('Intermediate words')));
      await accepted(save(moved, 'desktop-return', path, word(openingText)));

      const result = await processCommand(owner, delayed);
      expect(await read(path)).toEqual(word(openingText));
      expect(result).toMatchObject({ kind: 'conflict', conflicts: [
        { path, base: word(openingText), mine: word('Earlier offline words'), theirs: word(openingText) },
      ] });
      expect(await read(sibling)).toEqual(word('Passage context'));
    },
  );

  it.each([false, true])('orders a timed first delivery with exact displaced text (incoming newer: %s)', async incomingNewer => {
    const opening = await setup(authorIntent);
    const delayed = save(opening, 'offline-phone', authorIntent, word('Phone words'), incomingNewer ? 4000 : 1000,
      { path: truth, text: 'Independent truth' });
    const moved = await accepted(save(opening, 'desktop-edit', authorIntent, word('Intermediate words'), 2000));
    await accepted(save(moved, 'desktop-return', authorIntent, word(openingText), 3000));

    await accepted(delayed);
    expect(await read(authorIntent)).toEqual(word(incomingNewer ? 'Phone words' : openingText));
    expect(await read(truth)).toEqual(word('Independent truth'));
    expect(history('authorIntent')).toEqual([incomingNewer ? openingText : 'Phone words']);
    await accepted(delayed);
    expect(history('authorIntent')).toHaveLength(1);
  });

  it.each([false, true])('keeps a same-result action as the newest evidence (timed: %s)', async timed => {
    const opening = await setup(authorIntent);
    const confirmed = await accepted(save(opening, 'first-save', authorIntent, word('Same words'), 2000));
    const delayed = save(confirmed, 'delayed-different', authorIntent, word('Different earlier words'), 3000);
    const reaffirmed = await accepted(save(opening, 'same-words', authorIntent, word('Same words'), timed ? 4000 : null));
    expect(reaffirmed.metadata?.revision).toBeGreaterThan(confirmed.metadata!.revision);

    const result = await processCommand(owner, delayed);
    expect(result.kind).toBe(timed ? 'acknowledged' : 'conflict');
    expect(await read(authorIntent)).toEqual(word('Same words'));
    expect(history('authorIntent')).toEqual(timed ? ['Different earlier words'] : []);
  });

  it('asks about a legacy change after the matching opening was reaffirmed', async () => {
    const opening = await setup(authorIntent);
    const first = await accepted(save(opening, 'first-save', authorIntent, word('Same words'), 2000));
    const delayed = save(first, 'legacy-different', authorIntent, word('Different legacy words'));
    const reaffirmed = await accepted(save(opening, 'later-same-words', authorIntent, word('Same words'), 4000));

    expect(await processCommand(owner, delayed)).toMatchObject({ kind: 'conflict', conflicts: [
      { path: authorIntent, base: word('Same words'), mine: word('Different legacy words'), theirs: word('Same words') },
    ] });
    expect(await read(authorIntent)).toEqual(word('Same words'));
    await accepted(save(reaffirmed, 'fresh-choice', authorIntent, word('Fresh words'), null));
    expect(await read(authorIntent)).toEqual(word('Fresh words'));
  });

  it('merges a legacy change based on a field that has not returned', async () => {
    const opening = await setup(authorIntent);
    const delayed = save(opening, 'legacy-without-proof', authorIntent, word('Uncontested intent'));
    await accepted(save(opening, 'desktop-truth', truth, word('Independent truth'), 2000));

    await accepted(delayed);
    expect(await read(authorIntent)).toEqual(word('Uncontested intent'));
    expect(await read(truth)).toEqual(word('Independent truth'));
  });

  it('preserves the later timed clear of an initially missing sibling text', async () => {
    const opening = await setup(authorIntent, { exists: false });
    const delayed = save(opening, 'old-phone', authorIntent, word('Offline words'), 1000);
    const moved = await accepted(save(opening, 'desktop-edit', authorIntent, word('Intermediate words'), 2000));
    await accepted(save(moved, 'desktop-clear', authorIntent, { exists: false }, 3000));

    await accepted(delayed);
    expect(await read(authorIntent)).toEqual({ exists: false });
    expect(history('authorIntent')).toEqual(['Offline words']);
  });

  it('keeps both versions for a genuinely unclocked return, then accepts a new choice', async () => {
    const opening = await setup(authorIntent);
    const delayed = save(opening, 'old-phone', authorIntent, word('Phone candidate'), null);
    const moved = await accepted(save(opening, 'desktop-edit', authorIntent, word('Intermediate words'), null));
    const current = await accepted(save(moved, 'desktop-return', authorIntent, word(openingText), null));

    expect(await processCommand(owner, delayed)).toMatchObject({ kind: 'conflict', conflicts: [
      { path: authorIntent, base: word(openingText), mine: word('Phone candidate'), theirs: word(openingText) },
    ] });
    expect(await read(authorIntent)).toEqual(word(openingText));
    await accepted(save(current, 'make-new-choice', authorIntent, word('Phone candidate'), null));
    expect(await read(authorIntent)).toEqual(word('Phone candidate'));
  });
});

describe('council topic text action chronology', () => {
  const owner = 'owner-1';
  const resource = { collection: 'councils', id: 'council-return' };
  const openingWords = 'Opening council words';
  const summary = 'Keep the separate explanation';
  const at = '2026-11-20T17:00:00.000Z';
  const questionPath = ['topics', 'id:topic', 'questions', 'id:child', 'question'];
  const fields = [
    { field: 'question', list: 'questions', leaf: 'question', path: questionPath },
    { field: 'answer', list: 'questions', leaf: 'answer', path: ['topics', 'id:topic', 'questions', 'id:child', 'answer'] },
    { field: 'option', list: 'options', leaf: 'text', path: ['topics', 'id:topic', 'options', 'id:child', 'text'] },
  ] as const;
  type Target = typeof fields[number];

  const seed = async (hasAnswer = true) => {
    const topic = { id: 'topic', title: 'Other title', kind: 'decision', summary,
      questions: [{ id: 'child', question: openingWords, ...(hasAnswer && { answer: openingWords }) }],
      options: [{ id: 'child', text: openingWords }] };
    return accepted({ protocol: 1, owner, resource, generation: null, dependsOn: [], kind: 'create', operationId: 'seed-council',
      value: { userId: owner, title: 'Council chronology QA', status: 'preparing', createdAt: at, updatedAt: at, topics: [topic] } });
  };
  const accepted = async (command: DataCommand) => {
    const answer = await processCommand(owner, command);
    if (answer.kind !== 'acknowledged') throw Error(`Expected acknowledgement, got ${answer.kind}`);
    return answer.snapshot;
  };
  const snapshot = () => readDocument(owner, resource);
  const topic = (value: ResourceSnapshot) => (value.value!.topics as Record<string, Json>[])[0];
  const read = (value: ResourceSnapshot, target: Target) => (topic(value)[target.list] as Record<string, Json>[])[0][target.leaf];
  const save = (basis: ResourceSnapshot, operationId: string, target: Target, words: string | null,
    time?: number | null, related?: { field: Target; words: string }) => {
    const rewrite = (current: Record<string, Json>, at: Target, value: string | null) => ({ ...current,
      [at.list]: (current[at.list] as Record<string, Json>[]).map(item => writeField(item, [at.leaf],
        value === null ? { exists: false } : { exists: true, value })) });
    const selected = rewrite(topic(basis), target, words);
    const { command } = prepareDomainCommand(owner, operationId, basis,
      { ...basis.value, topics: [related ? rewrite(selected, related.field, related.words) : selected] });
    if (time === undefined || command.kind !== 'update') return command;
    const rowId = JSON.stringify(['topic', 'child', target.field]);
    return { ...command, councilTopicTextActions: [{ rowId, rowCreatedAt: rowId, observedRevision: basis.metadata!.revision,
      time: time === null ? null : { earliestMs: time, latestMs: time + 10 } }] };
  };
  const history = () => [...documents.entries()].flatMap(([key, value]) =>
    key.startsWith('councils/council-return/_topicTextHistory/') ? value.fields as unknown[] : []);

  it.each(fields)('holds a stale $field when stored words return to the opening', async target => {
    const initial = await seed();
    const delayed = save(initial, 'earlier-offline', target, 'Earlier offline council words');
    const changed = await accepted(save(initial, 'desktop-edit', target, 'Intermediate council words'));
    await accepted(save(changed, 'desktop-return', target, openingWords));

    const result = await processCommand(owner, delayed);
    const current = await snapshot();
    expect(read(current, target)).toBe(openingWords);
    expect(topic(current).summary).toBe(summary);
    expect(result).toMatchObject({ kind: 'conflict',
      conflicts: [{ path: target.path, mine: { exists: true, value: 'Earlier offline council words' },
        theirs: { exists: true, value: openingWords } }] });
  });

  it.each([true, false])('retains the exact displaced text and a sibling change (phone later: %s)', async phoneLater => {
    const [question, answer] = fields;
    const opened = await seed();
    const delayed = save(opened, 'earlier-offline', question, 'Phone words', phoneLater ? 4000 : 1000,
      { field: answer, words: 'Independent answer' });
    const changed = await accepted(save(opened, 'desktop-edit', question, 'Intermediate council words', 2000));
    await accepted(save(changed, 'desktop-return', question, openingWords, 3000));

    await accepted(delayed);
    await accepted(delayed);
    const current = await snapshot();
    expect(read(current, question)).toBe(phoneLater ? 'Phone words' : openingWords);
    expect(read(current, answer)).toBe('Independent answer');
    expect(history()).toEqual([expect.objectContaining({ value: phoneLater ? openingWords : 'Phone words' })]);
  });

  it('keeps an initially absent answer absent after a later clear', async () => {
    const answer = fields[1];
    const opened = await seed(false);
    const old = save(opened, 'earlier-offline', answer, 'Offline answer', 1000);
    const changed = await accepted(save(opened, 'desktop-answer', answer, 'Intermediate answer', 2000));
    await accepted(save(changed, 'desktop-clear', answer, null, 3000));
    await accepted(old);
    expect(read(await snapshot(), answer)).toBeUndefined();
    expect(history()).toEqual([expect.objectContaining({ value: 'Offline answer' })]);
  });

  it('retains both settled outcomes while one nested text still needs a choice', async () => {
    const [question, answer, option] = fields;
    const opening = await seed();
    for (const target of fields) {
      const changed = await accepted(save(await snapshot(), 'desktop-change-' + target.field, target, 'Intermediate ' + target.field, 2000));
      await accepted(save(changed, 'desktop-return-' + target.field, target, openingWords, 3000));
    }
    const oldQuestion = save(opening, 'old-question', question, 'Earlier question', 1000);
    const laterAnswer = save(opening, 'late-answer', answer, 'Later answer', 4000);
    const unknownOption = save(opening, 'unknown-option', option, 'Unclocked option', null);
    if (!('councilTopicTextActions' in oldQuestion && 'councilTopicTextActions' in laterAnswer && 'councilTopicTextActions' in unknownOption)) {
      throw Error('Expected three captured actions');
    }
    const selected = { ...topic(opening), summary: 'Independent explanation',
      questions: [{ id: 'child', question: 'Earlier question', answer: 'Later answer' }],
      options: [{ id: 'child', text: 'Unclocked option' }] };
    const { command } = prepareDomainCommand(owner, 'mixed-delivery', opening, { ...opening.value, topics: [selected] });
    if (command.kind !== 'update') throw Error('Expected the compound text edit');
    const mixed = { ...command, councilTopicTextActions: [
      ...oldQuestion.councilTopicTextActions!, ...laterAnswer.councilTopicTextActions!, ...unknownOption.councilTopicTextActions!,
    ] };
    const result = await processCommand(owner, mixed);
    expect(result).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([
      expect.objectContaining({ path: question.path, code: 'council-topic-text-settled' }),
      expect.objectContaining({ path: answer.path, code: 'council-topic-text-queued' }),
      expect.objectContaining({ path: option.path }),
    ]) });
    expect(history()).toEqual([expect.objectContaining({ value: 'Earlier question' })]);
    expect(topic(await snapshot())).toEqual(topic(opening));
    const optionReview = result.kind === 'conflict' && result.conflicts.find(conflict => conflict.path[2] === 'options');
    expect(optionReview).not.toHaveProperty('code');
  });

  it.each(['desktop outcome', 'phone outcome'])('can retry the later question alongside the reviewed %s', async outcome => {
    const [question] = fields;
    const opening = await seed();
    const phone = save(opening, 'phone-question', question, 'Later phone question', 4000);
    const desktop = save(opening, 'desktop-question', question, 'Earlier desktop question', 2000);
    if (phone.kind !== 'update' || desktop.kind !== 'update') throw Error('Expected text edits');
    const withOutcome = (command: typeof phone, words: string, revision: number, reviewed = false) => ({
      ...command, changes: command.changes.map(change => change.path[0] === 'topics' && Array.isArray(change.after.value)
        ? { ...change, after: { exists: true as const, value: change.after.value.map(row => ({ ...(row as Record<string, Json>), decision: words })) } }
        : change),
      councilOutcomeActions: [{ rowId: 'topic', rowCreatedAt: 'topic', observedRevision: revision,
        time: reviewed ? { earliestMs: 5000, latestMs: 5010 } : null }],
    });
    const live = await accepted(withOutcome(desktop, 'desktop outcome', opening.metadata!.revision));
    const delayed = withOutcome(phone, 'phone outcome', opening.metadata!.revision);
    expect(await processCommand(owner, delayed)).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([
      expect.objectContaining({ path: question.path, code: 'council-topic-text-queued' }),
      expect.objectContaining({ path: ['topics', 'id:topic', 'outcome'] }),
    ]) });
    expect(read(await snapshot(), question)).toBe('Earlier desktop question');
    const retry = { ...phone, operationId: 'reviewed-outcome', changes: phone.changes.map(change => change.path[0] === 'topics'
      ? { ...change, before: { exists: true as const, value: [{ ...topic(opening), decision: 'desktop outcome' }] } }
      : change) };
    const result = await accepted(withOutcome(retry, outcome, live.metadata!.revision, true));
    expect(read(result, question)).toBe('Later phone question');
    expect(topic(result)).toMatchObject({ decision: outcome, options: topic(opening).options });
    expect(history()).toEqual([expect.objectContaining({ value: 'Earlier desktop question' })]);
  });

  it('protects the same words after a competing reaffirmation when the old packet has no time', async () => {
    const [question] = fields;
    const opening = await seed();
    const first = await accepted(save(opening, 'first-question', question, 'Same question', 1000));
    const old = save(first, 'old-unstamped', question, 'Contrary old text');
    await accepted(save(opening, 'later-same-question', question, 'Same question', 3000));
    expect(await processCommand(owner, old)).toMatchObject({ kind: 'conflict', conflicts: [
      expect.objectContaining({ path: question.path }),
    ] });
    expect(read(await snapshot(), question)).toBe('Same question');
  });

  it.each([false, true])('keeps the ordered assembly mark when only the answer needs review (phone later: %s)', async phoneLater => {
    const answer = fields[1];
    const opened = await seed();
    const mark = (basis: ResourceSnapshot, id: string, before: boolean, after: boolean, millis: number, answerText?: string) => {
      const current = topic(basis);
      const answers = (current.questions as Record<string, Json>[]).map(item => answerText ? { ...item, answer: answerText } : item);
      const { command } = prepareDomainCommand(owner, id, basis,
        { ...basis.value, topics: [{ ...current, forAssembly: after, questions: answers }] });
      if (command.kind !== 'update') throw Error('Expected a section edit');
      return { ...command, councilAssemblyActions: { forAssembly: { rowId: 'topic', rowCreatedAt: 'topic', before, after,
        observedRevision: basis.metadata!.revision, time: { earliestMs: millis, latestMs: millis + 10 } } } };
    };
    const delayed = mark(opened, 'phone-mark-and-answer', false, true, phoneLater ? 4000 : 1000, 'Phone answer');
    const raised = await accepted(mark(opened, 'desktop-mark', false, true, 2000));
    const lowered = await accepted(mark(raised, 'desktop-unmark', true, false, 3000, 'Desktop answer'));
    expect(await processCommand(owner, delayed)).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([
      expect.objectContaining({ path: answer.path }),
      expect.objectContaining({ path: ['topics', 'id:topic', 'forAssembly'],
        code: phoneLater ? 'council-topic-text-queued' : 'council-topic-text-settled' }),
    ]) });
    expect(topic(await snapshot())).toEqual(topic(lowered));
  });

  it('replays a large nested answer comparison with both copies intact', async () => {
    const answer = fields[1];
    const opened = await seed();
    const saved = 'a'.repeat(350_000);
    const phone = 'b'.repeat(350_000);
    const first = await accepted(save(opened, 'large-council-answer', answer, saved));
    const delayed = save(first, 'unclocked-long-answer', answer, phone);
    const changed = await accepted(save(first, 'edited-the-long-answer', answer, 'Intermediate answer'));
    await accepted(save(changed, 'restored-the-long-answer', answer, saved));
    const comparison = await processCommand(owner, delayed);
    expect(comparison.kind).toBe('conflict');
    if (comparison.kind !== 'conflict') return;
    const [field] = comparison.conflicts;
    expect(field.path).toEqual(answer.path);
    expect(field.mine.value).toBe(phone);
    expect(field.theirs.value).toBe(saved);
    expect(await processCommand(owner, delayed)).toEqual(comparison);
  });

  it('returns the exact nested question versions when timing is unknown', async () => {
    const [question] = fields;
    const opened = await seed();
    const old = save(opened, 'earlier-offline', question, 'Unclocked question', null);
    const changed = await accepted(save(opened, 'desktop-question', question, 'Intermediate question', null));
    const live = await accepted(save(changed, 'desktop-return', question, openingWords, null));
    expect(await processCommand(owner, old)).toMatchObject({ kind: 'conflict',
      conflicts: [{ path: question.path, mine: { exists: true, value: 'Unclocked question' } }] });
    expect(read(await snapshot(), question)).toBe(openingWords);
    await accepted(save(live, 'reviewed-question', question, 'Unclocked question', null));
    expect(read(await snapshot(), question)).toBe('Unclocked question');
  });
});

describe('transactional DataEngine server', () => {
  it('commits one effect and returns the same durable receipt to concurrent duplicate senders', async () => {
    const [first, second] = await Promise.all([processCommand('owner-1', create()), processCommand('owner-1', create())]);
    expect(first.kind).toBe('acknowledged');
    expect(second).toEqual(first);
    expect(receipts()).toHaveLength(1);
    expect(documents.get('sermons/sermon-1')?._dataEngine).toMatchObject({ revision: 1, generation: 'create-1' });
  });

  it('replays a note-reference coalescence with the current stored identity after unrelated writes', async () => {
    const resource = { collection: 'studyNotes', id: 'shared-reference-note' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const note = { userId: base.owner, type: 'note', content: 'Original words', scriptureRefs: [], tags: [],
      isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed-reference-note', value: note })).kind)
      .toBe('acknowledged');
    const phone = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const desktop = { ...phone, id: 'desktop-ref' };
    const other = { ...phone, id: 'other-ref', book: 'Romans', chapter: 8, fromVerse: 28 };
    const append = (operationId: string, refs: Array<typeof phone>) => ({
      ...base, kind: 'update', generation: 'seed-reference-note', operationId,
      changes: [{ path: ['scriptureRefs'], before: { exists: true, value: [] }, after: { exists: true, value: refs } }],
    });
    expect((await processCommand(base.owner, append('desktop-reference-save', [desktop, other]))).kind).toBe('acknowledged');
    const command = append('phone-reference-save', [phone]);
    const aliases = [{ from: phone.id, to: desktop.id }];
    const accepted = await processCommand(base.owner, command);
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { scriptureRefs: [desktop, other] },
      metadata: { studyNoteReferenceAliases: aliases } } });
    expect((await processCommand(base.owner, { ...base, kind: 'update', generation: 'seed-reference-note', operationId: 'later-words',
      changes: [{ path: ['content'], before: { exists: true, value: note.content }, after: { exists: true, value: 'Later words' } }],
    })).kind).toBe('acknowledged');

    const current = await readDocument(base.owner, resource);
    const replay = await processCommand(base.owner, command);
    expect(current).toMatchObject({ value: { scriptureRefs: [desktop, other], content: 'Later words' },
      metadata: { studyNoteReferenceAliases: aliases, revision: 4 } });
    expect(replay).toMatchObject({ kind: 'acknowledged', snapshot: current, committed: { revision: 3, operationId: command.operationId } });
    if (replay.kind === 'acknowledged') expect(replay.committed).not.toHaveProperty('studyNoteReferenceAliases');
  });

  it.each([
    ['later edit', 110, 112, 17, [17, 28]],
    ['later removal', 110, 112, null, [28]],
    ['earlier removal', 75, 79, null, [16, 28]],
    ['overlapping removal', 89, 101, null, undefined],
  ] as const)('uses proven action order for a coalesced reference: %s', async (_case, start, end, verse, expected) => {
    const resource = { collection: 'studyNotes', id: 'timed-reference-note' };
    const base = { protocol: 1 as const, owner: 'owner-1', resource, dependsOn: [] };
    const clock = (start: number, end: number) => ({ earliestMs: 1_800_000_000_000 + start, latestMs: 1_800_000_000_000 + end });
    const note = { userId: base.owner, type: 'note', content: 'Original words', scriptureRefs: [], tags: [],
      isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    const phone = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const desktop = { ...phone, id: 'desktop-ref' };
    const other = { ...phone, id: 'other-ref', book: 'Romans', chapter: 8, fromVerse: 28 };
    const list = (value: typeof phone[]) => ({ exists: true, value });
    const update = (operationId: string, before: typeof phone[], after: typeof phone[], studyNoteReferenceTimes: Record<string, ReturnType<typeof clock>>) =>
      ({ ...base, kind: 'update' as const, generation: 'seed-timed-reference-note', operationId, studyNoteReferenceTimes,
        changes: [{ path: ['scriptureRefs'], before: list(before), after: list(after) }] });
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed-timed-reference-note', value: note })).kind)
      .toBe('acknowledged');
    expect((await processCommand(base.owner, update('desktop-reference-save', [], [desktop, other], { [desktop.id]: clock(90, 95) }))).kind)
      .toBe('acknowledged');
    expect((await processCommand(base.owner, update('phone-reference-save', [], [phone], { [phone.id]: clock(30, 35) }))).kind)
      .toBe('acknowledged');
    const result = await processCommand(base.owner,
      update('offline-reference-change', [phone], verse === null ? [] : [{ ...phone, fromVerse: verse }], { [phone.id]: clock(start, end) }));
    const saved = await readDocument(base.owner, resource);
    if (expected) {
      expect(result.kind).toBe('acknowledged');
      expect((saved.value?.scriptureRefs as typeof phone[]).map(ref => ref.fromVerse)).toEqual(expected);
    } else {
      expect(result.kind).toBe('conflict');
      expect(saved.value?.scriptureRefs).toEqual([desktop, other]);
    }
  });

  it.each([
    ['desktop-phone-delete', 50, true],
    ['phone-desktop-delete', 50, true],
    ['phone-delete-desktop', 50, true],
    ['desktop-phone-delete', 110, false],
    ['phone-desktop-delete', 110, false],
    ['phone-delete-desktop', 110, false],
  ] as const)('retains the latest timed reference intent across %s at %s', async (delivery, at, keepJohn) => {
    const resource = { collection: 'studyNotes', id: 'ordered-reference-note' };
    const base = { protocol: 1 as const, owner: 'owner-1', resource, dependsOn: [] };
    const clock = (start: number) => ({ earliestMs: 1_800_000_000_000 + start, latestMs: 1_800_000_000_001 + start });
    const note = { userId: base.owner, type: 'note', content: 'Original words', scriptureRefs: [], tags: [],
      isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    const phone = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const desktop = { ...phone, id: 'desktop-ref' };
    const romans = { ...phone, id: 'romans-ref', book: 'Romans', chapter: 8, fromVerse: 28 };
    const luke = { ...phone, id: 'luke-ref', book: 'Luke', chapter: 1, fromVerse: 1 };
    const list = (value: typeof phone[]) => ({ exists: true, value });
    const update = (operationId: string, before: typeof phone[], after: typeof phone[], studyNoteReferenceTimes: Record<string, ReturnType<typeof clock>>) =>
      ({ ...base, kind: 'update' as const, generation: 'seed-ordered-reference-note', operationId, studyNoteReferenceTimes,
        changes: [{ path: ['scriptureRefs'], before: list(before), after: list(after) }] });
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed-ordered-reference-note', value: note })).kind)
      .toBe('acknowledged');
    const commands = {
      desktop: update('desktop-reference-save', [], [desktop, romans], { [desktop.id]: clock(90) }),
      phone: update('phone-reference-save', [], [phone], { [phone.id]: clock(30) }),
      delete: update('phone-reference-delete', [phone], [luke], { [phone.id]: clock(at), [luke.id]: clock(at + 1) }),
    };
    for (const name of delivery.split('-') as Array<keyof typeof commands>) {
      expect((await processCommand(base.owner, commands[name])).kind).toBe('acknowledged');
    }
    const saved = await readDocument(base.owner, resource);
    expect((saved.value?.scriptureRefs as typeof phone[]).map(ref => ref.book).sort())
      .toEqual(keepJohn ? ['John', 'Luke', 'Romans'] : ['Luke', 'Romans']);
    const history = await listStudyNoteReferenceHistory(base.owner, resource.id, 'seed-ordered-reference-note');
    const displaced = history.entries.flatMap(record => record.entries);
    expect(displaced).toHaveLength(1);
    const entry = displaced[0];
    expect(entry).toMatchObject({
      value: keepJohn ? null : expect.objectContaining({ book: 'John', fromVerse: 16 }),
      winner: keepJohn ? expect.objectContaining({ book: 'John', fromVerse: 16 }) : null,
      actionTime: clock(Math.min(at, 90)), winnerActionTime: clock(Math.max(at, 90)),
    });
    if (!keepJohn) {
      const newId = { ...phone, id: 'fresh-addition' };
      const existing = saved.value?.scriptureRefs as typeof phone[];
      expect((await processCommand(base.owner, update('later-re-add', existing, [...existing, newId], { [newId.id]: clock(116) }))).kind)
        .toBe('acknowledged');
      expect((await readDocument(base.owner, resource)).value?.scriptureRefs).toEqual([...existing, newId]);
    }
  });

  it.each([
    ['desktop-phone-edit', 110, 17], ['phone-desktop-edit', 110, 17], ['phone-edit-desktop', 110, 17],
    ['desktop-phone-edit', 50, 16], ['phone-desktop-edit', 50, 16], ['phone-edit-desktop', 50, 16],
  ] as const)('applies only the later reference intent after an edit across %s at %s', async (delivery, at, verse) => {
    const resource = { collection: 'studyNotes', id: 'edited-reference-note' };
    const base = { protocol: 1 as const, owner: 'owner-1', resource, dependsOn: [] };
    const clock = (start: number) => ({ earliestMs: 1_800_000_000_000 + start, latestMs: 1_800_000_000_001 + start });
    const note = { userId: base.owner, type: 'note', content: 'Original words', scriptureRefs: [], tags: [],
      isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    const phone = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const desktop = { ...phone, id: 'desktop-ref' };
    const romans = { ...phone, id: 'romans-ref', book: 'Romans', chapter: 8, fromVerse: 28 };
    const list = (value: typeof phone[]) => ({ exists: true, value });
    const update = (operationId: string, before: typeof phone[], after: typeof phone[], studyNoteReferenceTimes: Record<string, ReturnType<typeof clock>>) =>
      ({ ...base, kind: 'update' as const, generation: 'seed-edited-reference-note', operationId, studyNoteReferenceTimes,
        changes: [{ path: ['scriptureRefs'], before: list(before), after: list(after) }] });
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed-edited-reference-note', value: note })).kind)
      .toBe('acknowledged');
    const commands = {
      desktop: update('desktop-reference-save', [], [desktop, romans], { [desktop.id]: clock(90) }),
      phone: update('phone-reference-save', [], [phone], { [phone.id]: clock(30) }),
      edit: update('phone-reference-edit', [phone], [{ ...phone, fromVerse: 17 }], { [phone.id]: clock(at) }),
    };
    for (const name of delivery.split('-') as Array<keyof typeof commands>) {
      expect((await processCommand(base.owner, commands[name])).kind).toBe('acknowledged');
    }
    const saved = await readDocument(base.owner, resource);
    const references = saved.value?.scriptureRefs as typeof phone[];
    expect(references).toHaveLength(2);
    expect(references.find(ref => ref.book === 'John')?.fromVerse).toBe(verse);
    expect(references).toContainEqual(romans);
    const history = () => [...documents.entries()]
      .filter(([path]) => path.startsWith('studyNotes/' + resource.id + '/_studyNoteReferenceHistory/'))
      .map(([, entry]) => entry);
    const retained = references.find(ref => ref.book === 'John')!;
    expect(history()).toEqual([{ generation: 'seed-edited-reference-note', entries: [expect.objectContaining({
      rowId: retained.id, value: { ...retained, fromVerse: verse === 17 ? 16 : 17 }, winner: retained,
      actionTime: clock(Math.min(at, 90)), winnerActionTime: clock(Math.max(at, 90)),
    })] }]);
    const last = delivery.split('-').at(-1) as keyof typeof commands;
    expect((await processCommand(base.owner, commands[last])).kind).toBe('acknowledged');
    expect(history()).toHaveLength(1);
    await expect(listStudyNoteReferenceHistory(base.owner, resource.id, 'seed-edited-reference-note')).resolves.toMatchObject({
      owner: base.owner, noteId: resource.id, generation: 'seed-edited-reference-note', entries: history().map(entry => ({ entries: entry.entries })), nextCursor: null,
    });
    await expect(listStudyNoteReferenceHistory('other-owner', resource.id, 'seed-edited-reference-note')).rejects.toMatchObject({ status: 403 });
    await expect(listStudyNoteReferenceHistory(base.owner, resource.id, 'different-note-generation')).rejects.toMatchObject({ status: 404 });

    if (verse === 17) {
      const independentlyAdded = { ...desktop, id: 'new-john' };
      expect((await processCommand(base.owner, update('new-reference', references, [...references, independentlyAdded],
        { [independentlyAdded.id]: clock(118) }))).kind).toBe('acknowledged');
      expect((await readDocument(base.owner, resource)).value?.scriptureRefs).toEqual([...references, independentlyAdded]);
    }
  });

  it.each([false, true])('retains timed reference choices when a text conflict blocks the save (incoming later: %s)', async later => {
    const owner = 'owner-1', generation = 'seed-reference-text-conflict';
    const resource = { collection: 'studyNotes', id: 'reference-text-conflict' };
    const base = { protocol: 1 as const, owner, resource, dependsOn: [] };
    const clock = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_001 + at });
    const original = { id: 'desktop-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const phone = { ...original, id: 'phone-ref' };
    const edited = { ...phone, fromVerse: 17 };
    const list = (value: typeof phone[]) => ({ exists: true, value });
    const content = (before: string, after: string) => ({ path: ['content'],
      before: { exists: true, value: before }, after: { exists: true, value: after } });
    const update = (operationId: string, before: typeof phone[], after: typeof phone[], id: string, at: number) =>
      ({ ...base, kind: 'update' as const, generation, operationId, studyNoteReferenceTimes: { [id]: clock(at) },
        changes: [{ path: ['scriptureRefs'], before: list(before), after: list(after) }] });
    const note = { userId: owner, type: 'note', content: 'Opening', scriptureRefs: [], tags: [], isDraft: false,
      createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    expect((await processCommand(owner, { ...base, kind: 'create', generation: null, operationId: generation, value: note })).kind)
      .toBe('acknowledged');
    const desktop = update('desktop-change', [], [original], original.id, 90);
    expect((await processCommand(owner, { ...desktop, changes: [...desktop.changes, content('Opening', 'Desktop words')] })).kind)
      .toBe('acknowledged');
    expect((await processCommand(owner, update('phone-add', [], [phone], phone.id, 30))).kind).toBe('acknowledged');
    const change = update('phone-change', [phone], [edited], phone.id, later ? 110 : 50);
    const blocked = { ...change, changes: [...change.changes, content('Opening', 'Phone words')] };
    const exactEdit = { ...edited, id: original.id };
    const history = () => listStudyNoteReferenceHistory(owner, resource.id, generation);
    expect(await processCommand(owner, blocked)).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['content'] }] });
    expect((await readDocument(owner, resource)).value).toMatchObject({ content: 'Desktop words', scriptureRefs: [original] });
    await expect(history()).resolves.toMatchObject({ entries: [{ entries: [{
      rowId: original.id, value: later ? original : exactEdit, winner: later ? exactEdit : original,
      actionTime: clock(later ? 90 : 50), winnerActionTime: clock(later ? 110 : 90), ...(later && { origin: 'comparison' }),
    }] }] });
    expect((await processCommand(owner, blocked)).kind).toBe('conflict');
    expect((await history()).entries).toHaveLength(1);
    const accepted = await readDocument(owner, resource);
    expect((await processCommand(owner, { ...base, kind: 'update', generation, operationId: 'resolve-text',
      studyNoteReferenceObservedRevisions: { [original.id]: accepted.metadata!.revision },
      changes: [content('Desktop words', 'Phone words'), ...(later ? [
        { path: ['scriptureRefs'], before: list([original]), after: list([exactEdit]) },
      ] : [])] })).kind).toBe('acknowledged');
    expect((await readDocument(owner, resource)).value).toMatchObject({ content: 'Phone words', scriptureRefs: [later ? exactEdit : original] });
    expect((await history()).entries).toHaveLength(1);
  });

  it('keeps both long quotes when together they exceed one Firestore history document', async () => {
    const owner = 'owner-1', generation = 'seed-long-reference';
    const resource = { collection: 'studyNotes', id: 'long-reference' };
    const base = { protocol: 1 as const, owner, resource, dependsOn: [] };
    const clock = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_001 + at });
    const original = { id: 'john', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const first = { ...original, text: 'а'.repeat(310_000) };
    const quote = '𐌀'.repeat(155_000);
    const later = [0, 1, 2, 3].map(index => ({ ...original, text: quote + index }));
    const list = (value: typeof original[]) => ({ exists: true, value });
    const save = (operationId: string, after: typeof original, at: number) => processCommand(owner, {
      ...base, kind: 'update', generation, operationId, studyNoteReferenceTimes: { [original.id]: clock(at) },
      studyNoteReferenceObservedRevisions: { [original.id]: 1 },
      changes: [{ path: ['scriptureRefs'], before: list([original]), after: list([after]) }],
    });
    const note = { userId: owner, type: 'note', content: 'Opening', scriptureRefs: [original], tags: [], isDraft: false,
      createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    expect((await processCommand(owner, { ...base, kind: 'create', generation: null, operationId: generation, value: note })).kind)
      .toBe('acknowledged');
    expect((await save('earlier-quote', first, 50)).kind).toBe('acknowledged');
    for (const [index, version] of later.entries()) {
      expect((await save('later-quote-' + index, version, 90 + index * 5)).kind).toBe('acknowledged');
    }
    expect((await readDocument(owner, resource)).value?.scriptureRefs).toEqual([later.at(-1)]);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('studyNotes/' + resource.id + '/_studyNoteReferenceHistory/'));
    expect(history.filter(([path]) => path.includes('/_parts/')).length).toBeGreaterThan(4);
    expect(history.every(([, record]) => Buffer.byteLength(JSON.stringify(record)) < 1_000_000)).toBe(true);
    const page = await listStudyNoteReferenceHistory(owner, resource.id, generation);
    expect(page.entries).toHaveLength(3);
    expect(page.nextCursor).toBe(page.entries.at(-1)!.id);
    const next = await listStudyNoteReferenceHistory(owner, resource.id, generation, page.nextCursor!);
    expect(next.entries).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect([...page.entries, ...next.entries].flatMap(item => item.entries)).toEqual(later.map((winner, index) => ({
      rowId: original.id, value: index === 0 ? first : later[index - 1], winner,
      actionTime: clock(index === 0 ? 50 : 85 + index * 5), winnerActionTime: clock(90 + index * 5),
    })).reverse());
    const change = (before: string, after: string) => ({ path: ['content'],
      before: { exists: true, value: before }, after: { exists: true, value: after } });
    expect((await processCommand(owner, { ...base, kind: 'update', generation, operationId: 'accepted-text',
      changes: [change('Opening', 'Current')] })).kind).toBe('acknowledged');
    const [long, short] = [first, { ...original, fromVerse: 17 }];
    for (const [operationId, reference] of [['a', long], [JSON.stringify(['a', 'reference', 0]), short]] as const) {
      const command = { ...base, kind: 'update' as const, generation, operationId,
        studyNoteReferenceTimes: { [original.id]: clock(120) }, studyNoteReferenceObservedRevisions: { [original.id]: 1 },
        changes: [{ path: ['scriptureRefs'], before: list([original]), after: list([reference]) }, change('Opening', 'Proposed')] };
      expect(await processCommand(owner, command)).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['content'] }] });
    }
    const comparisons = (await listStudyNoteReferenceHistory(owner, resource.id, generation)).entries.flatMap(record => record.entries)
      .filter(entry => entry.origin === 'comparison');
    expect(comparisons.map(entry => entry.winner)).toEqual(expect.arrayContaining([long, short]));
    expect(comparisons).toHaveLength(2);
  });

  it('preserves the exact text comparison and timed reference history when the receipt is large', async () => {
    const owner = 'owner-1', generation = 'seed-large-note-comparison';
    const resource = { collection: 'studyNotes', id: 'large-note-comparison' };
    const base = { protocol: 1 as const, owner, resource, dependsOn: [] };
    const clock = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_001 + at });
    const original = { id: 'john', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const stored = { ...original, text: 'x'.repeat(620_000) };
    const incoming = { ...original, text: 'y'.repeat(620_000) };
    const opening = 'a'.repeat(150_000), current = 'b'.repeat(150_000), proposed = 'c'.repeat(150_000);
    const list = (value: typeof original[]) => ({ exists: true, value });
    const note = { userId: owner, type: 'note', content: opening, scriptureRefs: [original], tags: [], isDraft: false,
      createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    const update = (operationId: string, after: typeof original, content: string, at: number) => ({
      ...base, kind: 'update' as const, generation, operationId, studyNoteReferenceTimes: { [original.id]: clock(at) },
      studyNoteReferenceObservedRevisions: { [original.id]: 1 },
      changes: [{ path: ['scriptureRefs'], before: list([original]), after: list([after]) },
        { path: ['content'], before: { exists: true, value: opening }, after: { exists: true, value: content } }],
    });
    expect((await processCommand(owner, { ...base, kind: 'create', generation: null, operationId: generation, value: note })).kind)
      .toBe('acknowledged');
    expect((await processCommand(owner, update('stored', stored, current, 50))).kind).toBe('acknowledged');
    const command = update('incoming', incoming, proposed, 90);
    const conflict = await processCommand(owner, command);
    expect(conflict).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['content'] }] });
    expect(await processCommand(owner, command)).toEqual(conflict);
    await expect(listStudyNoteReferenceHistory(owner, resource.id, generation)).resolves.toMatchObject({ entries: [{ entries: [{
      rowId: original.id, value: stored, winner: incoming, actionTime: clock(50), winnerActionTime: clock(90), origin: 'comparison',
    }] }] });
  });

  it.each([false, true])('holds an unordered duplicate-lineage removal by the canonical or absorbed ID: %s', async reverse => {
    const resource = { collection: 'studyNotes', id: 'ambiguous-reference-note' };
    const base = { protocol: 1 as const, owner: 'owner-1', resource, dependsOn: [] };
    const clock = (start: number, end: number) => ({ earliestMs: 1_800_000_000_000 + start, latestMs: 1_800_000_000_000 + end });
    const note = { userId: base.owner, type: 'note', content: 'Original words', scriptureRefs: [], tags: [],
      isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    const phone = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const desktop = { ...phone, id: 'desktop-ref' };
    const neighbor = { ...phone, id: 'romans-ref', book: 'Romans', chapter: 8, fromVerse: 28 };
    const list = (value: typeof phone[]) => ({ exists: true, value });
    const update = (operationId: string, before: typeof phone[], after: typeof phone[],
      studyNoteReferenceTimes: Record<string, ReturnType<typeof clock>>, observed = 1) =>
      ({ ...base, kind: 'update' as const, generation: 'seed-ambiguous-reference-note', operationId, studyNoteReferenceTimes,
        studyNoteReferenceObservedRevisions: Object.fromEntries([...before, ...after].map(row => [row.id, observed])), changes: [{ path: ['scriptureRefs'], before: list(before), after: list(after) }] });
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed-ambiguous-reference-note', value: note })).kind)
      .toBe('acknowledged');
    const births = [update('phone-reference-save', [], [phone], { [phone.id]: clock(30, 35) }),
      update('desktop-reference-save', [], [desktop, neighbor], { [desktop.id]: clock(20, 100) })];
    for (const birth of reverse ? births.reverse() : births) expect((await processCommand(base.owner, birth)).kind).toBe('acknowledged');
    const saved = await readDocument(base.owner, resource);
    expect((await processCommand(base.owner, update('unordered-removal', [phone], [], { [phone.id]: clock(50, 55) }))).kind).toBe('conflict');
    expect(await readDocument(base.owner, resource)).toEqual(saved);
    expect((await listStudyNoteReferenceHistory(base.owner, resource.id, 'seed-ambiguous-reference-note')).entries).toEqual([]);

    const current = saved.value?.scriptureRefs as typeof phone[];
    expect((await processCommand(base.owner, update('observed-removal', current, [neighbor], {}, saved.metadata!.revision))).kind).toBe('acknowledged');
    const removed = await readDocument(base.owner, resource);
    expect(removed.value?.scriptureRefs).toEqual([neighbor]);
    const fresh = { ...phone, id: 'fresh-ref' };
    expect((await processCommand(base.owner, update('unproved-addition', [], [fresh], {}, 1))).kind).toBe('conflict');
    expect(await readDocument(base.owner, resource)).toEqual(removed);
    expect((await processCommand(base.owner, update('observed-addition', [neighbor], [neighbor, fresh], {}, removed.metadata!.revision))).kind)
      .toBe('acknowledged');
    expect((await readDocument(base.owner, resource)).value?.scriptureRefs).toEqual([neighbor, fresh]);
  });

  it('coalesces the exact live reference before considering a different row that used to have the same words', async () => {
    const resource = { collection: 'studyNotes', id: 'exact-reference-match' };
    const base = { protocol: 1 as const, owner: 'owner-1', resource, dependsOn: [] };
    const note = { userId: base.owner, type: 'note', content: 'Words to keep', scriptureRefs: [], tags: [],
      isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
    const original = { id: 'original-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const edited = { ...original, fromVerse: 17 };
    const deliberate = { ...original, id: 'deliberate-ref' };
    const delayed = { ...original, id: 'delayed-ref' };
    const romans = { ...original, id: 'neighbor-ref', book: 'Romans', chapter: 8, fromVerse: 28 };
    const list = (value: typeof original[]) => ({ exists: true, value });
    const update = (operationId: string, before: typeof original[], after: typeof original[], id: string, time: number) => ({
      ...base, kind: 'update' as const, generation: 'seed-exact-reference', operationId,
      studyNoteReferenceTimes: { [id]: { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_001 + time } },
      studyNoteReferenceObservedRevisions: { [id]: 1 },
      changes: [{ path: ['scriptureRefs'], before: list(before), after: list(after) }],
    });
    const commands = [
      { ...base, kind: 'create' as const, generation: null, operationId: 'seed-exact-reference', value: note },
      update('first-add', [], [original, romans], original.id, 30),
      update('first-edit', [original, romans], [edited, romans], original.id, 60),
      update('independent-add', [edited, romans], [edited, romans, deliberate], deliberate.id, 90),
      update('delayed-add', [], [delayed], delayed.id, 120),
    ];
    for (const command of commands) expect((await processCommand(base.owner, command)).kind).toBe('acknowledged');
    expect(await readDocument(base.owner, resource)).toMatchObject({
      value: { scriptureRefs: [edited, romans, deliberate], content: note.content },
      metadata: { studyNoteReferenceAliases: [{ from: delayed.id, to: deliberate.id }] },
    });
    expect((await listStudyNoteReferenceHistory(base.owner, resource.id, 'seed-exact-reference')).entries).toEqual([]);
  });

  it('replays original committed evidence with the current snapshot after later edits and a lost acknowledgement', async () => {
    const original = await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    if (original.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    const writes = [...transactionWrites];
    const before = [...documents];
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged', operationId: original.operationId,
      committed: original.snapshot.metadata, snapshot: { value: { title: 'Second' }, metadata: { revision: 2, operationId: 'update-1' } } });
    expect(transactionWrites).toEqual(writes);
    expect([...documents]).toEqual(before);
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('stores snapshots as JSON so receipt nesting cannot exceed the document depth', async () => {
    let legacy: Raw = { text: 'Leaf' };
    for (let depth = 0; depth < 19; depth++) legacy = { nested: legacy };
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', legacy });
    const result = await processCommand('owner-1', update('deep', null));
    expect(result.kind).toBe('acknowledged');
    const stored = documents.get(receiptPath('owner-1', 'deep'))!;
    expect(stored.result).toBeUndefined();
    expect(JSON.parse(stored.resultJson as string)).toMatchObject({ receiptVersion: 2, kind: 'acknowledged', resource });
    expect(stored.resultJson).not.toContain('Leaf');
    expect(await processCommand('owner-1', update('deep', null))).toEqual(result);
  });

  it('can still replay receipts written using the previous embedded result format', async () => {
    const result = await processCommand('owner-1', create());
    const path = receiptPath('owner-1', 'create-1');
    const stored = documents.get(path)!;
    documents.set(path, { owner: stored.owner, operationId: stored.operationId, commandHash: stored.commandHash, result });
    expect(await processCommand('owner-1', create())).toEqual(result);
  });

  it('retains exact legacy JSON acknowledgements even when the current document is newer', async () => {
    const result = await processCommand('owner-1', create());
    const path = receiptPath('owner-1', 'create-1');
    documents.set(path, { ...documents.get(path), resultJson: JSON.stringify(result) });
    await processCommand('owner-1', update());
    expect(await processCommand('owner-1', create())).toEqual(result);
  });

  it.each(['missing', 'legacy', 'generation', 'revision', 'corrupt'])('keeps compact replay retryable when current snapshot is %s', async reason => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const stored = documents.get('sermons/sermon-1')!;
    if (reason === 'missing') documents.delete('sermons/sermon-1');
    else if (reason === 'legacy') documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First' });
    else documents.set('sermons/sermon-1', { ...stored, _dataEngine: { ...(stored._dataEngine as Raw),
      ...(reason === 'generation' ? { generation: 'replacement' } : reason === 'revision' ? { revision: 1 } : { protocol: 2 }) } });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', update())).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
    expect(receipts()).toHaveLength(2);
  });

  it('does not replay an acknowledged delete as a live document even after an out-of-protocol resurrection', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    const remove: DataCommand = { ...create('delete'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! };
    await processCommand('owner-1', remove);
    expect(await processCommand('owner-1', remove)).toMatchObject({ committed: { deleted: true }, snapshot: { value: null } });
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'Unexpected live value',
      _dataEngine: { ...created.snapshot.metadata, revision: 3, deleted: false } });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', remove)).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
  });

  it.each([{ receiptVersion: 3 }, { resource: { collection: 'sermons', id: '/' } }, { committed: undefined },
    { affected: 'invalid' }, { affected: [{}] }, { affected: Array.from({ length: 100 }, () => ({})) }])
  ('refuses damaged compact receipt evidence without executing the command again: %j', async invalid => {
    await processCommand('owner-1', create());
    const path = receiptPath('owner-1', 'create-1');
    const stored = documents.get(path)!;
    documents.set(path, { ...stored, resultJson: JSON.stringify({ ...JSON.parse(stored.resultJson as string), ...invalid }) });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', create())).rejects.toMatchObject({ code: 'invalid-stored-receipt' });
    expect(transactionWrites).toEqual(writes);
  });

  it.each([false, true])('rebases later local typing onto a compact replay after another device changes the same field: %s', async sameField => {
    await processCommand('owner-1', create());
    const session = new DataSession(await readDocument('owner-1', resource));
    session.edit({ ...session.getState().draft, title: 'Second' });
    const command = session.prepare('lost-ack', 'owner-1')!;
    await processCommand('owner-1', command); // Its HTTP answer is lost.
    session.edit({ ...session.getState().draft, title: 'Newer local typing' });
    const field = sameField ? 'title' : 'verse';
    const before = sameField ? 'Second' : 'John 1:1';
    await processCommand('owner-1', { ...update('another-device'), changes: [{ path: [field],
      before: { exists: true, value: before }, after: { exists: true, value: sameField ? 'Remote title' : 'John 2:1' } }] });
    const replay = await processCommand('owner-1', command);
    session.accept(replay);
    const state = session.getState();
    expect(state).toMatchObject({ draft: { title: 'Newer local typing', verse: sameField ? 'John 1:1' : 'John 2:1' }, dirty: true, pending: {} });
    expect(state.conflicts).toHaveLength(sameField ? 1 : 0);
    expect(replay).toMatchObject({ committed: { revision: 2, operationId: 'lost-ack' }, snapshot: { metadata: { revision: 3 } } });
  });

  it.each([false, true])('replays a deleted current snapshot while preserving subsequent local typing: %s', async newerDraft => {
    await processCommand('owner-1', create());
    const session = new DataSession(await readDocument('owner-1', resource));
    session.edit({ ...session.getState().draft, title: 'Second' });
    const command = session.prepare('lost-ack', 'owner-1')!;
    const accepted = await processCommand('owner-1', command);
    if (accepted.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    if (newerDraft) session.edit({ ...session.getState().draft, title: 'Preserve local draft' });
    await processCommand('owner-1', { ...create('later-delete'), kind: 'delete', generation: 'create-1', baseline: accepted.snapshot.value! });
    const writes = [...transactionWrites];
    const replay = await processCommand('owner-1', command);
    expect(transactionWrites).toEqual(writes);
    expect(replay).toMatchObject({ kind: 'acknowledged', committed: { revision: 2, deleted: false }, snapshot: { value: null, metadata: { revision: 3, deleted: true } } });
    session.accept(replay);
    expect(session.getState().pending).toEqual({});
    expect(session.getState().confirmed.value).toBeNull();
    if (newerDraft) {
      expect(session.getState().draft?.title).toBe('Preserve local draft');
      expect(session.getState().conflicts.length).toBeGreaterThan(0);
    } else expect(session.getState()).toMatchObject({ draft: null, dirty: false, conflicts: [] });
  });

  it('retains exact conflict results after later writes instead of recalculating a terminal outcome', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const conflictCommand = { ...update('conflicted'), changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Mine' } }] };
    const conflict = await processCommand('owner-1', conflictCommand);
    await processCommand('owner-1', { ...update('later'), changes: [{ path: ['title'], before: { exists: true, value: 'Second' }, after: { exists: true, value: 'Later' } }] });
    expect(conflict.kind).toBe('conflict');
    expect(await processCommand('owner-1', conflictCommand)).toEqual(conflict);
    expect(JSON.parse(documents.get(receiptPath('owner-1', 'conflicted'))!.resultJson as string)).toEqual(conflict);
  });

  it('does not apply a command when its persisted receipt is corrupt', async () => {
    documents.set(receiptPath('owner-1', 'create-1'), { owner: 'owner-1', operationId: 'create-1', resultJson: '{invalid' });
    await expect(processCommand('owner-1', create())).rejects.toMatchObject({ code: 'invalid-stored-receipt' });
    expect(documents.has('sermons/sermon-1')).toBe(false);
  });

  it('rejects malformed envelopes whose operation identity cannot safely be echoed', async () => {
    await expect(processCommand('owner-1', { ...create(), operationId: '/' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('refuses changed payloads and does not replace the original receipt', async () => {
    const original = await processCommand('owner-1', create());
    const modified = { ...create(), value: { userId: 'owner-1', title: 'Changed' } };
    expect(await processCommand('owner-1', modified)).toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    expect(await processCommand('owner-1', create())).toEqual(original);
  });

  it('rolls back both receipt and document when transaction commit fails', async () => {
    failCommit = true;
    await expect(processCommand('owner-1', create())).rejects.toThrow('Commit failed');
    expect(documents.size).toBe(0);
    failCommit = false;
    expect(await processCommand('owner-1', create())).toMatchObject({ kind: 'acknowledged' });
  });

  it('scopes identity to the authenticated owner and refuses foreign documents without leaking data', async () => {
    await expect(processCommand('attacker', create())).rejects.toMatchObject({ code: 'permission-denied' });
    documents.set('sermons/sermon-1', { userId: 'victim', title: 'Private text' });
    const result = await processCommand('owner-1', update('update-1', null));
    expect(result).toEqual({ kind: 'refused', code: 'permission-denied', operationId: 'update-1' });
    expect(JSON.stringify(result)).not.toContain('Private text');
    expect(receipts()).toHaveLength(0);
  });

  it('keeps acknowledged delivery retryable without exposing a new owner after ownership is revoked', async () => {
    await processCommand('owner-1', create());
    documents.set('sermons/sermon-1', { userId: 'new-owner', title: 'Private' });
    const writes = [...transactionWrites];
    await expect(processCommand('owner-1', create())).rejects.toMatchObject({ code: 'receipt-snapshot-unavailable', status: 503 });
    expect(transactionWrites).toEqual(writes);
  });

  it('refuses caller-selected collection and document paths before reading Firestore', async () => {
    await expect(readDocument('owner-1', { collection: 'ai_prompt_telemetry', id: 'one' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(readDocument('owner-1', { collection: 'sermons', id: '../private' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(adminDb.collection).not.toHaveBeenCalled();
  });

  it('rejects ownership forgery and protected field updates', async () => {
    const forged = { ...create(), value: { userId: 'victim', title: 'First' } };
    expect(await processCommand('owner-1', forged)).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    expect(await processCommand('owner-1', { ...update(), changes: [{ path: ['userId'], before: { exists: true, value: 'owner-1' }, after: { exists: true, value: 'attacker' } }] })).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    expect(documents.has('sermons/sermon-1')).toBe(false);
  });

  it('records a blocked identity and resumes only after its same-owner dependency acknowledges', async () => {
    const dependent = { ...update(), dependsOn: ['create-1'] };
    expect(await processCommand('owner-1', dependent)).toMatchObject({ kind: 'blocked', dependencies: ['create-1'] });
    expect(await processCommand('owner-1', { ...dependent, dependsOn: [] })).toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    await processCommand('owner-1', create());
    expect(await processCommand('owner-1', dependent)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('never treats another owner receipt or a failed dependency as an acknowledgement', async () => {
    documents.set(receiptPath('owner-1', 'dependency'), { owner: 'attacker', operationId: 'dependency', result: { kind: 'acknowledged' } });
    expect(await processCommand('owner-1', { ...create(), dependsOn: ['dependency'] })).toMatchObject({ kind: 'blocked' });
    documents.set(receiptPath('owner-1', 'dependency'), { owner: 'owner-1', operationId: 'dependency', result: { kind: 'refused' } });
    expect(await processCommand('owner-1', { ...create(), dependsOn: ['dependency'] })).toMatchObject({ kind: 'blocked' });
  });

  it('retains only owner metadata after deletion and refuses stale resurrection', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Expected initial acknowledgement');
    const deleted = await processCommand('owner-1', { ...create('delete-1'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! });
    expect(deleted).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });
    expect(documents.get('sermons/sermon-1')).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    expect(await readDocument('owner-1', resource)).toMatchObject({ value: null, metadata: { deleted: true } });
    await expect(readDocument('attacker', resource)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await processCommand('owner-1', update())).kind).not.toBe('acknowledged');
    expect((await processCommand('owner-1', create('recreate'))).kind).not.toBe('acknowledged');
    expect(documents.get('sermons/sermon-1')?.title).toBeUndefined();
  });

  it('preserves independent writes and returns stable conflicts for the same field', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const other = { ...update('other'), changes: [{ path: ['title'], before: { exists: true, value: 'First' }, after: { exists: true, value: 'Other' } }] };
    const result = await processCommand('owner-1', other);
    expect(result.kind).toBe('conflict');
    expect(await processCommand('owner-1', other)).toEqual(result);
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('normalizes timestamps on reads but preserves unchanged Firestore field types on legacy updates', async () => {
    const createdAt = { toDate: () => new Date('2026-01-01T00:00:00.000Z') };
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', createdAt, nested: { values: [1, true, null] } });
    expect(await readDocument('owner-1', resource)).toMatchObject({ metadata: null, value: { createdAt: '2026-01-01T00:00:00.000Z' } });
    expect(await processCommand('owner-1', update('legacy', null))).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.createdAt).toBe(createdAt);
  });

  it('fails closed on corrupt metadata instead of treating it as a legacy document', async () => {
    documents.set('sermons/sermon-1', { userId: 'owner-1', _dataEngine: { protocol: 2 } });
    await expect(readDocument('owner-1', resource)).rejects.toMatchObject({ code: 'unsupported-protocol' });
    await expect(processCommand('owner-1', update('legacy', null))).rejects.toMatchObject({ code: 'unsupported-protocol' });
    expect(receipts()).toHaveLength(0);
  });

  it('stores a compact ACK whose size is independent of unchanged large document content', async () => {
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', description: 'short' });
    expect(await processCommand('owner-1', update('small', null))).toMatchObject({ kind: 'acknowledged' });
    const small = JSON.stringify(documents.get(receiptPath('owner-1', 'small')));
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'First', description: 'x'.repeat(1_000_000) });
    expect(await processCommand('owner-1', update('large', null))).toMatchObject({ kind: 'acknowledged' });
    const large = JSON.stringify(documents.get(receiptPath('owner-1', 'large')));
    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThan(1_000);
    expect(documents.get('sermons/sermon-1')?.title).toBe('Second');
  });

  it('still refuses an oversized exact conflict receipt without modifying the document', async () => {
    documents.set('sermons/sermon-1', { userId: 'owner-1', title: 'Other', description: 'x'.repeat(1_000_000) });
    expect(await processCommand('owner-1', update('large-conflict', null))).toMatchObject({ kind: 'refused', code: 'receipt-too-large' });
    expect(documents.get('sermons/sermon-1')?.title).toBe('Other');
  });

  it('lists only owned documents, includes tombstones, and paginates by document identity', async () => {
    documents.set('sermons/a', { userId: 'owner-1', title: 'A' });
    documents.set('sermons/b', { userId: 'owner-1', _dataEngine: { protocol: 1, generation: 'b', revision: 2, deleted: true } });
    documents.set('sermons/c', { userId: 'attacker', title: 'Private' });
    const first = await listDocuments('owner-1', 'sermons', { limit: 1 });
    expect(first.snapshots.map(item => item.resource.id)).toEqual(['a']);
    expect(first.nextCursor).toBe('a');
    expect(await listDocuments('owner-1', 'sermons', { limit: 1, cursor: 'a' })).toEqual({ snapshots: [expect.objectContaining({ resource: { collection: 'sermons', id: 'b' }, value: null })], nextCursor: null, version: 0 });
  });

  describe('the first meeting slot', () => {
    const resource = { collection: 'groups', id: 'first-slot' };
    const owner = 'owner-1';
    const base = { protocol: 1 as const, owner, resource, dependsOn: [] };
    const createdAt = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'first-meeting-0', date: '', createdAt };
    const present = (value: unknown) => ({ exists: true, value });
    const seed = (withEmptyList = false) => processCommand(owner, {
      ...base, kind: 'create', operationId: 'group-born', generation: null,
      value: { userId: owner, title: 'Group', status: 'draft', flow: [], templates: [], createdAt, updatedAt: createdAt,
        ...(withEmptyList && { meetingDates: [] }) },
    });
    const save = (operationId: string, before: unknown, after: unknown) => ({
      ...base, kind: 'update' as const, operationId, generation: 'group-born',
      changes: [{ path: ['meetingDates'], before: before === undefined ? { exists: false } : present(before), after: present(after) }],
    });
    const action = (operationId: string, field: 'date' | 'location' | 'audience', after: string, offset: number) => {
      const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset };
      const proof = { rowId: opening.id, before: field === 'date' ? '' : null, after, observedRevision: 1, time };
      return { ...save(operationId, [], [{ ...opening, [field]: after }]),
        ...(field === 'date' ? { meetingDateAction: proof }
          : { groupMeetingFieldActions: { [field]: { ...proof, rowCreatedAt: createdAt } } }) };
    };

    it.each([
      ['date', '2026-12-13', '2026-12-20'],
      ['location', 'Main room', 'Side room'],
      ['audience', 'Leaders', 'All'],
    ] as const)('uses the proven latest initial %s in both delivery orders and asks on overlap', async (field, early, late) => {
      for (const scenario of ['early-first', 'late-first', 'overlap'] as const) {
        const ownResource = { ...resource, id: scenario };
        const createSlot = (operation: string, value: string, at: number) => ({
          ...action(operation + '-' + scenario, field, value, at), resource: ownResource, generation: 'born-' + scenario,
        });
        expect(await processCommand(owner, { ...base, resource: ownResource, kind: 'create', operationId: 'born-' + scenario,
          generation: null, value: { userId: owner, title: 'Group', status: 'draft', flow: [], templates: [],
            createdAt, updatedAt: createdAt } })).toMatchObject({ kind: 'acknowledged' });
        const earlier = createSlot('earlier', early, scenario === 'overlap' ? 45 : 10);
        const later = createSlot('later', late, 40);
        const [first, second] = scenario === 'early-first' ? [earlier, later] : [later, earlier];
        expect(await processCommand(owner, first)).toMatchObject({ kind: 'acknowledged' });
        const answer = await processCommand(owner, second);
        expect(answer).toMatchObject({ kind: scenario === 'overlap' ? 'conflict' : 'acknowledged',
          snapshot: { value: { meetingDates: [{ ...opening, [field]: late }] } } });
        if (scenario === 'overlap') expect(answer).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates', 'id:' + opening.id, field] })]) });
      }
    });

    it('accepts a first place and date separately and orders the next competing date', async () => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'rename', generation: 'group-born',
        changes: [{ path: ['title'], before: present('Group'), after: present('Renamed group') }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('place', 'location', 'Main room', 10))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('date', 'date', '2026-12-20', 40))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('earlier-date', 'date', '2026-12-13', 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: 'Renamed group', meetingDates: [{ ...opening, location: 'Main room', date: '2026-12-20' }] } },
      });
    });

    it.each([false, true])('uses the affected row for an unclocked first date after eviction (evicted first slot: %s)', async affected => {
      expect(await seed(true)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('first-place', 'location', 'Main room', 10))).toMatchObject({ kind: 'acknowledged' });
      const raw = documents.get('groups/first-slot')!;
      raw._dataEngine = { ...raw._dataEngine as object, revision: 40, meetingDateProofFloor: 8,
        meetingDateProofEvictions: { floor: 8, older: 0, rows: [{ rowId: affected ? opening.id : 'different-row', revision: 8 }] } };
      const answer = await processCommand(owner, save('unclocked-first-date', [], [{ ...opening, date: '2026-12-20' }]));
      expect(answer).toMatchObject({ kind: affected ? 'conflict' : 'acknowledged',
        snapshot: { value: { meetingDates: [{ ...opening, location: 'Main room', date: affected ? '' : '2026-12-20' }] } } });
    });

    it('does not infer the order of a third date from two equal dates whose action times overlapped', async () => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      const date = '2026-12-13';
      expect(await processCommand(owner, action('earlier-window', 'date', date, 10))).toMatchObject({ kind: 'acknowledged' });
      const overlapping = action('overlapping-window', 'date', date, 15);
      if (!('meetingDateAction' in overlapping)) throw new Error('Missing date evidence');
      expect(await processCommand(owner, { ...overlapping, meetingDateAction: { ...overlapping.meetingDateAction,
        time: { earliestMs: 1_800_000_000_015, latestMs: 1_800_000_000_055 } } })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('inside-window', 'date', '2026-12-20', 30))).toMatchObject({
        kind: 'conflict', snapshot: { value: { meetingDates: [{ ...opening, date }] } },
      });
      expect(await processCommand(owner, action('after-both-windows', 'date', '2026-12-27', 60))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { meetingDates: [{ ...opening, date: '2026-12-27' }] } },
      });
    });

    it.each([
      ['date', '2026-12-13', '2026-12-20'],
      ['location', 'Main room', 'Side room'],
      ['audience', 'Leaders', 'All'],
    ] as const)('does not infer the order of another initial %s after an unclocked reaffirmation', async (field, value, laterValue) => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('first', field, value, 10))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('same-without-clock', [], [{ ...opening, [field]: value }]))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('different-with-clock', field, laterValue, 30))).toMatchObject({
        kind: 'conflict', snapshot: { value: { meetingDates: [{ ...opening, [field]: value }] } },
      });
    });

    it('offers the two audience choices with the same independent date and proven location', async () => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      const saved = { ...opening, location: 'Saved later room', audience: 'Leaders' };
      const incoming = { ...opening, date: '2026-12-13', location: 'Earlier room', audience: 'All' };
      const stamp = (after: string, at: number) => ({
        rowId: opening.id, rowCreatedAt: createdAt, before: null, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      });
      expect(await processCommand(owner, { ...save('stored', [], [saved]), groupMeetingFieldActions: {
        location: stamp(saved.location, 40), audience: stamp(saved.audience, 60),
      } })).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(owner, { ...save('mine', [], [incoming]), groupMeetingFieldActions: {
        location: stamp(incoming.location, 10), audience: stamp(incoming.audience, 65),
      } });
      expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { meetingDates: [saved] } },
        conflicts: expect.arrayContaining([
          expect.objectContaining({ path: ['meetingDates', 'id:' + opening.id, 'audience'] }),
          expect.objectContaining({ code: 'first-group-meeting-comparison', base: present(saved),
            mine: present({ ...saved, date: incoming.date, audience: incoming.audience }),
            theirs: present({ ...saved, date: incoming.date }),
          }),
        ]) });
    });

    it.each(['date', 'location'] as const)('keeps the explicit clear of initial %s visible when a delayed fill lacks time', async field => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      const first = { ...opening, [field]: field === 'date' ? '2026-12-20' : 'Main room' };
      expect(await processCommand(owner, save('first', [], [first]))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('clear', [first], [opening]))).toMatchObject({ kind: 'acknowledged' });
      const stale = { ...opening, [field]: field === 'date' ? '2026-12-13' : 'Side room' };
      expect(await processCommand(owner, save('earlier-without-clock', [], [stale]))).toMatchObject({
        kind: 'conflict', snapshot: { value: { meetingDates: [opening] } },
        conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates', 'id:' + opening.id, field] })]),
      });
    });

    it.each([true, false])('asks about an old initial Save with its own ID (legacy arrives first: %s)', async legacyFirst => {
      expect(await seed(true)).toMatchObject({ kind: 'acknowledged' });
      const modern = { ...opening, date: '2026-12-20' };
      const legacy = { ...opening, id: 'legacy-meeting', location: 'Side room' };
      const [first, second] = legacyFirst ? [legacy, modern] : [modern, legacy];
      expect(await processCommand(owner, save('first', [], [first]))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('second', [], [second]))).toMatchObject({
        kind: 'conflict', snapshot: { value: { meetingDates: [first] } },
        conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates'] })]),
      });
      const another = { ...legacy, id: 'another-meeting' };
      expect(await processCommand(owner, save('explicit-add', [first], [first, another]))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { meetingDates: [first, another] } },
      });
    });

    it.each([true, false])('keeps both initial fields when the first Save adopts a versionless group (date first: %s)', async dateFirst => {
      documents.set('groups/first-slot', { userId: owner, title: 'Old group', status: 'draft', flow: [], templates: [],
        meetingDates: [], createdAt, updatedAt: createdAt });
      const place = { ...opening, location: 'Side room' };
      const date = { ...opening, date: '2026-12-13' };
      const [first, second] = dateFirst ? [date, place] : [place, date];
      expect(await processCommand(owner, { ...save('first', [], [first]), generation: null })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'rename', generation: 'first',
        changes: [{ path: ['title'], before: present('Old group'), after: present('Renamed') }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...save('second', [], [second]), generation: null })).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: 'Renamed', meetingDates: [{ ...date, location: place.location }] } },
      });
      expect(await processCommand(owner, { ...save('remove', [{ ...date, location: place.location }], []), generation: 'first' })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...save('late-after-removal', [], [second]), generation: null })).toMatchObject({
        kind: 'refused', code: 'generation-mismatch',
      });
    });

    it('keeps the first meeting opening when a title Save adopts a versionless group', async () => {
      documents.set('groups/first-slot', { userId: owner, title: 'Old group', status: 'draft', flow: [], templates: [],
        meetingDates: [], createdAt, updatedAt: createdAt });
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'rename', generation: null,
        changes: [{ path: ['title'], before: present('Old group'), after: present('Renamed') }] })).toMatchObject({ kind: 'acknowledged' });
      const place = { ...opening, location: 'Side room' };
      const date = { ...opening, date: '2026-12-13' };
      expect(await processCommand(owner, { ...save('place', [], [place]), generation: null })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...save('date', [], [date]), generation: null })).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: 'Renamed', meetingDates: [{ ...date, location: place.location }] } },
      });
    });

    it('does not allow a generationless Save into a group born with a version', async () => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      const first = { ...opening, date: '2026-12-13' };
      expect(await processCommand(owner, save('date', [], [first]))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...save('old-generation', [], [{ ...opening, location: 'Side room' }]), generation: null })).toMatchObject({
        kind: 'refused', code: 'generation-mismatch',
      });
    });

    it('does not recreate a removed first meeting or join an unproven row', async () => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      const first = { ...opening, location: 'Main room' };
      expect(await processCommand(owner, save('place', [], [first]))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('remove', [first], []))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('old-date', 'date', '2026-12-13', 10))).toMatchObject({
        kind: 'conflict', snapshot: { value: { meetingDates: [] } },
      });
      const newMeeting = { ...first, id: 'first-meeting-2' };
      expect(await processCommand(owner, save('different-slot', [], [newMeeting]))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, action('still-old-date', 'date', '2026-12-13', 20))).toMatchObject({
        kind: 'conflict', snapshot: { value: { meetingDates: [newMeeting] } },
      });
    });
  });

  it.each([
    { scenario: 'earlier date', offset: 20, phone: '2026-12-20', winner: '2026-12-27', archived: '2026-12-20', kind: 'acknowledged' },
    { scenario: 'legacy starting date', offset: 60, phone: '2026-12-20', winner: '2026-12-20', archived: '2026-12-27', kind: 'acknowledged' },
    { scenario: 'later removal of the date', offset: 60, phone: '', winner: '', archived: '2026-12-27', kind: 'acknowledged' },
    { scenario: 'overlapping times', offset: 43, phone: '', winner: '2026-12-27', archived: null, kind: 'conflict' },
    { scenario: 'another field in the same meeting', offset: 20, phone: '', winner: '', archived: null, kind: 'acknowledged' },
  ])('applies group meeting chronology only to the existing date: $scenario', async ({ scenario, offset, phone, winner, archived, kind }) => {
    const resource = { collection: 'groups', id: 'group-chronology' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first-meeting', date: scenario === 'legacy starting date' ? '2026-12-13T00:00:00.000Z' : '2026-12-13', location: 'Main room', audience: 'Leaders', createdAt: now };
    const second = { id: 'follow-up', date: '2027-01-03', location: 'Annex', createdAt: now };
    const meetings = [first, second];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'group-seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: meetings, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const update = (operationId: string, patch: Partial<typeof first>) => ({
      ...base, kind: 'update', operationId, generation: 'group-seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: meetings }, after: { exists: true, value: [{ ...first, ...patch }, second] } }],
    });
    const date = (operationId: string, value: string, offsetMs: number) => ({
      ...update(operationId, { date: value }),
      meetingDateAction: { rowId: first.id, before: first.date, after: value, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offsetMs, latestMs: 1_800_000_000_010 + offsetMs } },
    });
    const differentField = scenario === 'another field in the same meeting';
    expect((await processCommand(base.owner, differentField ? update('computer', { location: 'Side room' }) : date('computer', '2026-12-27', 40))).kind).toBe('acknowledged');
    const answer = await processCommand(base.owner, date('phone', phone, offset));
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Group',
      meetingDates: [{ ...first, date: winner, location: differentField ? 'Side room' : first.location }, second],
    } } });
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-chronology/_meetingDateHistory/'));
    expect(history).toHaveLength(archived === null ? 0 : 1);
    if (archived !== null) {
      expect(history[0][1]).toMatchObject({ rowId: first.id, date: archived, winnerDate: winner, generation: 'group-seed' });
      expect(await listMeetingDateHistory(base.owner, resource.id, 'group-seed')).toMatchObject({
        owner: base.owner, groupId: resource.id, generation: 'group-seed',
        entries: [{ rowId: first.id, date: archived, winnerDate: winner }],
      });
      await expect(listMeetingDateHistory('another-owner', resource.id, 'group-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listMeetingDateHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    }
    if (kind === 'conflict') expect(answer).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates', 'id:first-meeting', 'date'] })]) });
  });

  it.each([
    { scenario: 'the exact previous date edit', intervening: false, predecessor: 'first-date', kind: 'acknowledged' },
    { scenario: 'a different operation', intervening: false, predecessor: 'different-date', kind: 'conflict' },
    { scenario: 'a different writer returning to the same date', intervening: true, predecessor: 'first-date', kind: 'conflict' },
  ])('orders a second queued meeting date with $scenario', async ({ intervening, predecessor, kind }) => {
    const resource = { collection: 'groups', id: 'queued-meeting' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const row = { id: 'meeting', date: '2026-12-13', location: 'Main room', audience: 'Leaders', createdAt: now };
    const first = { ...row, date: '2026-12-20' };
    const other = { ...row, id: 'follow-up', date: '2027-01-03' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: [row, other], createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const save = (operationId: string, before: typeof row, after: typeof row, revision: number, offset: number, predecessorOperationId?: string) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['meetingDates'], before: { exists: true, value: [before, other] }, after: { exists: true, value: [after, other] } }],
        meetingDateAction: { rowId: row.id, before: before.date, after: after.date, observedRevision: revision,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset },
          ...(predecessorOperationId && { predecessorOperationId }) },
      });
    expect((await save('first-date', row, first, 1, 40)).kind).toBe('acknowledged');
    if (intervening) {
      expect((await save('different-date', first, row, 2, 42)).kind).toBe('acknowledged');
      expect((await save('return-date', row, first, 3, 44)).kind).toBe('acknowledged');
    }
    const answer = await save('second-date', first, { ...first, date: '' }, 1, 45, predecessor);
    expect(answer).toMatchObject({ kind, snapshot: { value: {
      meetingDates: [{ ...first, date: kind === 'acknowledged' ? '' : first.date }, other],
    } } });
    expect((await listMeetingDateHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([
    { field: 'location', offset: 20, initial: 'Main room', desk: 'Side room', phone: '', winner: 'Side room', kind: 'acknowledged' },
    { field: 'location', offset: 60, initial: 'Main room', desk: 'Side room', phone: '', winner: '', kind: 'acknowledged' },
    { field: 'audience', offset: 20, initial: undefined, desk: 'Leaders', phone: 'All', winner: 'Leaders', kind: 'acknowledged' },
    { field: 'audience', offset: 60, initial: undefined, desk: 'Leaders', phone: 'All', winner: 'All', kind: 'acknowledged' },
    { field: 'location', offset: 45, initial: 'Main room', desk: 'Side room', phone: '', winner: 'Side room', kind: 'conflict' },
  ] as const)('orders the exact meeting $field at offset $offset', async ({ field, offset, initial, desk, phone, winner, kind }) => {
    const resource = { collection: 'groups', id: 'group-meeting-field' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first-meeting', date: '2026-12-13', createdAt: now,
      ...(field === 'location' ? { location: initial, audience: 'Leaders' } : { location: 'Main room' }) };
    const second = { id: 'second-meeting', date: '2027-01-03', location: 'Annex', createdAt: now };
    const value = { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first, second], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, after: string, at: number, changeSecond: boolean) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: value.meetingDates }, after: {
        exists: true, value: [{ ...first, [field]: after }, changeSecond ? { ...second, location: 'Library' } : second],
      } }],
      groupMeetingFieldActions: { [field]: { rowId: first.id, rowCreatedAt: first.createdAt, before: initial ?? null, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } } },
    });
    expect((await processCommand(base.owner, change('computer', desk, 40, true))).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, change('phone', phone, offset, false));
    expect(result).toMatchObject({ kind, snapshot: { value: {
      title: 'Group', meetingDates: [{ ...first, [field]: winner }, { ...second, location: 'Library' }],
    } } });
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates', 'id:first-meeting', field] })]) });
  });

  it.each([
    { field: 'location', earlier: 'Phone room', intermediate: 'Temporary room' },
    { field: 'audience', earlier: 'Leaders', intermediate: 'Adults' },
    { field: 'date', earlier: '2026-12-27', intermediate: '' },
  ] as const)('preserves the restored meeting $field when a first delivery has no clock', async ({ field, earlier, intermediate }) => {
    const owner = 'owner-1';
    const resource = { collection: 'groups', id: 'meeting-return' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first', date: '2026-12-13', location: 'Main hall', audience: 'Youth', notes: 'Opening notes', createdAt: now };
    const sibling = { ...first, id: 'second', date: '2027-01-03', location: 'Annex' };
    const value = { userId: owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first, sibling], createdAt: now, updatedAt: now };
    expect((await processCommand(owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const save = (operationId: string, before: typeof value.meetingDates, after: typeof value.meetingDates) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const phone = save('unclocked-offline-edit', value.meetingDates, [{ ...first, [field]: earlier }, sibling]);
    const temporary = [{ ...first, [field]: intermediate }, { ...sibling, notes: 'Independent notes' }];
    expect((await processCommand(owner, save('desktop-edit', value.meetingDates, temporary))).kind).toBe('acknowledged');
    const restored = [first, temporary[1]];
    expect((await processCommand(owner, save('desktop-restore', temporary, restored))).kind).toBe('acknowledged');
    const result = await processCommand(owner, phone);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { meetingDates: restored } },
      conflicts: expect.arrayContaining([
        expect.objectContaining({ path: ['meetingDates', 'id:first', field],
          mine: { exists: true, value: earlier }, theirs: { exists: true, value: first[field] } }),
        expect.objectContaining({ path: ['meetingDates', 'id:first'], code: 'first-group-meeting-comparison' }),
      ]) });
    expect(await processCommand(owner, phone)).toEqual(result);
  });

  it.each([
    { field: 'date', first: '2026-12-20', delayed: '2026-12-27' },
    { field: 'location', first: 'Library', delayed: 'Annex' },
    { field: 'audience', first: 'Adults', delayed: 'Leaders' },
  ] as const)('retains a newer reaffirmation of a meeting $field against a legacy queued change', async ({ field, first, delayed }) => {
    const resource = { collection: 'groups', id: 'meeting-reaffirmed' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const createdAt = '2026-11-08T00:00:00.000Z';
    const row = { id: 'meeting', date: '2026-12-13', location: 'Hall', audience: 'Youth', createdAt };
    const accepted = { ...row, [field]: first };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [row], createdAt, updatedAt: createdAt },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof row, after: typeof row) => ({ ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
    });
    const reaffirm = (operationId: string, at: number) => {
      const proof = { rowId: row.id, rowCreatedAt: createdAt, before: row[field], after: first, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at } };
      return { ...edit(operationId, row, accepted), ...(field === 'date' ? { meetingDateAction: proof }
        : { groupMeetingFieldActions: { [field]: proof } }) };
    };
    expect((await processCommand(base.owner, reaffirm('first', 20))).kind).toBe('acknowledged');
    const offline = edit('legacy-offline', accepted, { ...accepted, [field]: delayed });
    expect((await processCommand(base.owner, reaffirm('newer-same-value', 65))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, offline)).toMatchObject({ kind: 'conflict', snapshot: { value: { meetingDates: [accepted] } } });
  });

  it.each([20, 80])('keeps the ordered location at offset %s in both existing meeting audience choices', async offset => {
    const resource = { collection: 'groups', id: 'existing-meeting-mixed' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const createdAt = '2026-11-08T00:00:00.000Z';
    const row = { id: 'meeting', date: '2026-12-13', location: 'Hall', audience: 'Youth', createdAt };
    const current = { ...row, location: 'Desktop room', audience: 'Adults' };
    const phone = { ...row, location: 'Library', audience: 'Leaders' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [row], createdAt, updatedAt: createdAt },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof row, at: number) => ({ ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [after] } }],
      groupMeetingFieldActions: { location: { rowId: row.id, rowCreatedAt: createdAt, before: row.location, after: after.location,
        observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at } } },
    });
    expect((await processCommand(base.owner, edit('desktop', current, 45))).kind).toBe('acknowledged');
    const command = edit('phone', phone, offset);
    const answer = await processCommand(base.owner, command);
    const location = offset < 45 ? current.location : phone.location;
    expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { meetingDates: [current] } }, conflicts: expect.arrayContaining([
      expect.objectContaining({ path: ['meetingDates', 'id:meeting', 'audience'] }),
      expect.objectContaining({ code: 'first-group-meeting-comparison', mine: { exists: true, value: { ...phone, location } },
        theirs: { exists: true, value: { ...current, location } } }),
    ]) });
    const history = await listGroupMeetingFieldHistory(base.owner, resource.id, 'seed');
    expect(history.entries).toEqual(offset < 45 ? [expect.objectContaining({ fields: [expect.objectContaining({
      field: 'location', value: phone.location, winnerValue: current.location,
    })] })] : []);
    expect(await processCommand(base.owner, command)).toEqual(answer);
  });

  it('orders both meeting fields independently in the same update and archives each displaced value once', async () => {
    const resource = { collection: 'groups', id: 'group-meeting-fields' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first-meeting', date: '2026-12-13', location: 'Main room', audience: 'Leaders', createdAt: now };
    const value = { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, location: string, audience: string, locationAt: number, audienceAt: number) => {
      const stamp = (before: string, after: string, at: number) => ({ rowId: first.id, rowCreatedAt: first.createdAt, before, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at } });
      return { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['meetingDates'], before: { exists: true, value: [first] }, after: { exists: true, value: [{ ...first, location, audience }] } }],
        groupMeetingFieldActions: { location: stamp(first.location, location, locationAt), audience: stamp(first.audience, audience, audienceAt) } };
    };
    expect((await processCommand(base.owner, change('desk', 'Side room', 'Youth', 40, 45))).kind).toBe('acknowledged');
    const phone = change('phone', '', 'All', 65, 20);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { meetingDates: [{ ...first, location: '', audience: 'Youth' }] } } });
    expect(await processCommand(base.owner, phone)).toEqual(result);
    expect(await listGroupMeetingFieldHistory(base.owner, resource.id, 'seed')).toMatchObject({ entries: [{ fields: [
      { field: 'location', value: 'Side room', winnerValue: '', rowId: first.id },
      { field: 'audience', value: 'All', winnerValue: 'Youth', rowId: first.id },
    ] }] });
    await expect(listGroupMeetingFieldHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
    await expect(listGroupMeetingFieldHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
  });

  it.each(['known predecessor', 'unrelated overlapping action', 'same-value predecessor without order', 'replacement meeting'])('protects meeting text ancestry: %s', async (scenario) => {
    const resource = { collection: 'groups', id: 'group-meeting-ancestry' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'meeting', date: '', location: 'Hall', createdAt: now };
    const value = { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [],
      meetingDates: [first], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof first[], after: typeof first[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const action = (before: typeof first, after: string, at: number, observedRevision: number, predecessorOperationId?: string) => ({
      rowId: first.id, rowCreatedAt: before.createdAt, before: before.location, after, observedRevision,
      time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      ...(predecessorOperationId && { predecessorOperationId }),
    });
    const replace = scenario === 'replacement meeting';
    const previous = replace ? { ...first, createdAt: '2026-11-08T00:00:30.000Z' } : first;
    if (replace) {
      expect((await processCommand(base.owner, update('remove', [first], []))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, update('recreate', [], [previous]))).kind).toBe('acknowledged');
    }
    const accepted = { ...previous, location: 'Side room' };
    if (scenario === 'same-value predecessor without order') {
      expect((await processCommand(base.owner, { ...update('competing-edit', [first], [accepted]),
        groupMeetingFieldActions: { location: action(first, accepted.location, 31, 1) },
      })).kind).toBe('acknowledged');
    }
    expect((await processCommand(base.owner, { ...update('first-edit', [previous], [accepted]),
      groupMeetingFieldActions: { location: action(previous, accepted.location, 30, replace ? 3 : 1) },
    })).kind).toBe('acknowledged');
    const observed = replace ? first : { ...first, location: accepted.location };
    const next = await processCommand(base.owner, { ...update('later-edit', [observed], [{ ...observed, location: 'Library' }]),
      groupMeetingFieldActions: { location: action(observed, 'Library', replace ? 60 : 35, 1,
        ['known predecessor', 'same-value predecessor without order'].includes(scenario) ? 'first-edit' : undefined) },
    });
    if (scenario === 'known predecessor') {
      expect(next).toMatchObject({ kind: 'acknowledged', snapshot: { value: { meetingDates: [{ ...first, location: 'Library' }] } } });
      expect((await listGroupMeetingFieldHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
    } else {
      expect(next).toMatchObject({ kind: 'conflict', snapshot: { value: { meetingDates: [accepted] } } });
    }
  });

  it.each([
    { field: 'audience', offset: 20, kind: 'acknowledged' },
    { field: 'audience', offset: 60, kind: 'acknowledged' },
    { field: 'churchCity', offset: 20, kind: 'acknowledged' },
    { field: 'churchCity', offset: 60, kind: 'acknowledged' },
    { field: 'churchIdentity', offset: 20, kind: 'acknowledged' },
    { field: 'churchIdentity', offset: 60, kind: 'acknowledged' },
    { field: 'churchSelection', offset: 20, kind: 'acknowledged' },
    { field: 'churchSelection', offset: 60, kind: 'acknowledged' },
    { field: 'audience', offset: 45, kind: 'conflict' },
    { field: 'notes', offset: 60, kind: 'conflict' },
  ] as const)('orders the exact preaching detail $field at offset $offset', async ({ field, offset, kind }) => {
    const resource = { collection: 'sermons', id: 'sermon-preaching-detail' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const meeting = { id: 'event', date: '2026-12-13', status: 'planned', createdAt: now,
      church: { id: 'original-church', name: 'Original chapel', city: 'Original city' }, notes: 'Original note' };
    const other = { ...meeting, id: 'follow-up', date: '2027-01-03' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: false, preachDates: [meeting, other] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');

    const change = (operationId: string, who: 'phone' | 'desktop', at: number) => {
      const next = { ...meeting, church: { ...meeting.church } } as typeof meeting & { audience?: string };
      type DetailValue = string | null | { id: string; name: string; city?: string };
      let before: DetailValue = null;
      let after: DetailValue;
      if (field === 'audience') after = next.audience = who === 'phone' ? '' : 'Leaders';
      else if (field === 'churchCity') {
        before = meeting.church.city;
        after = next.church.city = who + ' city';
      } else if (field === 'churchIdentity') {
        before = meeting.church;
        after = next.church = { ...meeting.church, id: who + '-church', name: who + ' chapel' };
      } else if (field === 'churchSelection') {
        before = meeting.church;
        after = next.church = { id: who + '-church', name: who + ' chapel', city: who + ' city' };
      } else after = next.notes = who + ' note';
      return { next, command: { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['preachDates'], before: { exists: true, value: value.preachDates },
          after: { exists: true, value: [next, other] } }],
        ...(field === 'notes' ? {} : { preachDateFieldActions: { [field === 'churchIdentity' || field === 'churchSelection' ? 'church' : field]: {
          rowId: meeting.id, rowCreatedAt: meeting.createdAt, before, after, observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
        } } }),
      } };
    };
    const desktop = change('desktop', 'desktop', 40);
    const phone = change('phone', 'phone', offset);
    expect((await processCommand(base.owner, desktop.command)).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, phone.command);
    const winner = kind === 'acknowledged' && offset > 40 ? phone.next : desktop.next;
    expect(result).toMatchObject({ kind, snapshot: { value: { isPreached: false, preachDates: [winner, other] } } });
    if (kind === 'conflict') {
      expect(result).toMatchObject({ conflicts: [{ path: ['preachDates', 'id:event', field] }] });
    } else {
      const history = await listPreachDateFieldHistory(base.owner, resource.id, 'seed');
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].fields).toHaveLength(1);
      expect(history.entries[0].fields[0]).toMatchObject({
        rowId: meeting.id, rowCreatedAt: now, field: field === 'churchIdentity' || field === 'churchSelection' ? 'church' : field,
        ...(field === 'churchCity' && { scope: { id: meeting.church.id, name: meeting.church.name } }),
      });
      await expect(listPreachDateFieldHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listPreachDateFieldHistory(base.owner, resource.id, 'other')).rejects.toMatchObject({ status: 404 });
    }
  });

  it.each([
    { scenario: 'earlier action', offset: 20, delayed: 'Earlier offline notes', kind: 'acknowledged', winner: 'Original notes' },
    { scenario: 'later action', offset: 80, delayed: 'Later offline notes', kind: 'acknowledged', winner: 'Later offline notes' },
    { scenario: 'overlapping clocks', offset: 65, delayed: 'Earlier offline notes', kind: 'conflict', winner: 'Original notes' },
    { scenario: 'legacy first delivery', offset: null, delayed: 'Earlier offline notes', kind: 'conflict', winner: 'Original notes' },
    { scenario: 'legacy first delivery clearing notes', offset: null, delayed: '', kind: 'conflict', winner: 'Original notes' },
  ])('protects returned preaching date notes on $scenario', async ({ offset, delayed, kind, winner }) => {
    const owner = 'owner-1';
    const row = { id: 'preaching-row', date: '2026-11-20', church: { id: 'church-id', name: 'Grace Church' },
      notes: 'Original notes', createdAt: '2026-11-18T12:00:00.000Z' };
    const creation = create('preach-notes-generation');
    if (creation.kind !== 'create') throw Error('Expected creation');
    const opened = await processCommand(owner, { ...creation, value: { ...creation.value, preachDates: [row] } });
    if (opened.kind !== 'acknowledged') throw Error('Could not create the sermon');

    const write = (basis: typeof opened.snapshot, operationId: string, after: string, at: number | null) => {
      const { command } = prepareDomainCommand(owner, operationId, basis, {
        ...basis.value, preachDates: [{ ...row, notes: after }],
      });
      if (command?.kind !== 'update') throw Error('Expected a preaching date update');
      if (at === null) {
        const { sermonTextObservedRevision: _proof, ...legacy } = command;
        return legacy;
      }
      return { ...command, preachDateFieldActions: { notes: {
        rowId: row.id, rowCreatedAt: row.createdAt, observedRevision: basis.metadata!.revision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      } } };
    };
    const latePhone = write(opened.snapshot, 'phone-offline-notes', delayed, offset);
    const laptopEdit = await processCommand(owner, write(opened.snapshot, 'laptop-later-notes', 'Edited notes', 40));
    if (laptopEdit.kind !== 'acknowledged') throw Error('Expected the later edit to be accepted');
    const returned = await processCommand(owner, write(laptopEdit.snapshot, 'laptop-returns-notes', row.notes, 60));
    expect(returned.kind).toBe('acknowledged');

    const delivered = await processCommand(owner, latePhone);
    expect(delivered).toMatchObject({ kind, snapshot: { value: { preachDates: [{ ...row, notes: winner }] } } });
    expect((await readDocument(owner, resource)).value?.preachDates).toMatchObject([{ ...row, notes: winner }]);
    if (kind === 'conflict') {
      expect(delivered).toMatchObject({ conflicts: [{ path: ['preachDates', 'id:preaching-row', 'notes'],
        mine: { exists: true, value: delayed }, theirs: { exists: true, value: row.notes } }] });
    } else {
      const displaced = winner === delayed ? row.notes : delayed;
      const history = await listPreachDateFieldHistory(owner, resource.id, 'preach-notes-generation');
      expect(history.entries).toEqual([expect.objectContaining({ fields: [expect.objectContaining({
        field: 'notes', rowId: row.id, value: displaced,
      })] })]);
    }
  });

  it.each([
    { field: 'audience', path: ['audience'], evidence: 'observed field' },
    { field: 'audience', path: ['audience'], evidence: 'revision only' },
    { field: 'audience', path: ['audience'], evidence: 'older client' },
    { field: 'churchCity', path: ['church', 'city'], evidence: 'observed field' },
    { field: 'church', path: ['church'], evidence: 'observed field' },
  ] as const)('preserves the returned $field when a $evidence save reaches the server without a clock', async ({ field, path, evidence }) => {
    const owner = 'owner-1';
    const row = { id: 'date', date: '2026-11-20', createdAt: '2026-11-18T12:00:00.000Z',
      church: { id: 'grace', name: 'Grace Church', city: 'Opening city' }, audience: 'Youth', notes: 'Opening notes' };
    const phoneChurch = { id: 'phone-church', name: 'Phone Church', city: 'Phone city' };
    const desktopChurch = { id: 'desktop-church', name: 'Desktop Church', city: 'Desktop city' };
    const versions = {
      audience: [row.audience, 'Leaders', 'Adults'],
      churchCity: [row.church.city, phoneChurch.city, desktopChurch.city],
      church: [row.church, phoneChurch, desktopChurch],
    } as const;
    const [before, mine, interim] = versions[field];
    const creation = create('preaching-detail-return');
    if (creation.kind !== 'create') throw Error('Expected creation');
    const opening = await processCommand(owner, { ...creation, value: { ...creation.value, preachDates: [row] } });
    if (opening.kind !== 'acknowledged') throw Error('Could not create the sermon');
    const revisedRow = (value: typeof before, notes = row.notes) => ({
      ...row, notes, audience: field === 'audience' ? value as string : row.audience,
      church: field === 'church' ? value as typeof row.church
        : { ...row.church, city: field === 'churchCity' ? value as string : row.church.city },
    });
    const write = (basis: typeof opening.snapshot, operationId: string, value: typeof before, notes?: string) => {
      const { command } = prepareDomainCommand(owner, operationId, basis, { ...basis.value, preachDates: [revisedRow(value, notes)] });
      if (command?.kind !== 'update') throw Error('Expected a preaching date update');
      return command;
    };
    const delayed = write(opening.snapshot, 'delayed-detail', mine);
    if (evidence === 'older client') delete delayed.sermonTextObservedRevision;
    if (evidence === 'observed field') delayed.preachDateFieldActions = { [field]: { rowId: row.id, rowCreatedAt: row.createdAt,
      before, after: mine, observedRevision: opening.snapshot.metadata!.revision, time: null } };
    const changed = await processCommand(owner, write(opening.snapshot, 'desktop-change', interim));
    if (changed.kind !== 'acknowledged') throw Error('Could not update the preaching date');
    const restored = await processCommand(owner, write(changed.snapshot, 'desktop-return', before, 'Desktop sibling notes'));
    if (restored.kind !== 'acknowledged') throw Error('Could not restore the opening value');

    const result = await processCommand(owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { preachDates: [revisedRow(before, 'Desktop sibling notes')] } },
      conflicts: [{ path: ['preachDates', 'id:date', ...path], mine: { value: mine }, theirs: { value: before } }],
    });
    expect(await processCommand(owner, delayed)).toEqual(result);
    const afterReview = write(restored.snapshot, 'new-save-after-return', mine, 'Desktop sibling notes');
    expect(await processCommand(owner, afterReview)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { preachDates: [revisedRow(mine, 'Desktop sibling notes')] } } });
  });

  it.each([
    { offset: 20, expected: 'preach-date-detail-settled' },
    { offset: 80, expected: 'preach-date-detail-queued' },
  ])('retains the $expected audience when notes need a choice', async ({ offset, expected }) => {
    const owner = 'owner-1';
    const row = { id: 'date', date: '2026-11-20', createdAt: '2026-11-18T12:00:00.000Z',
      church: { id: 'chapel', name: 'Chapel' }, audience: 'Youth', notes: 'Opening notes' };
    const creation = create('mixed-preaching-detail');
    if (creation.kind !== 'create') throw Error('Expected creation');
    const opening = await processCommand(owner, { ...creation, value: { ...creation.value, preachDates: [row] } });
    if (opening.kind !== 'acknowledged') throw Error('Could not create the sermon');
    const write = (basis: typeof opening.snapshot, operationId: string, previous: typeof row, next: typeof row, at: number) => {
      const { command } = prepareDomainCommand(owner, operationId, basis, { ...basis.value, preachDates: [next] });
      if (command.kind !== 'update') throw Error('Expected a preaching date update');
      return { ...command, preachDateFieldActions: { audience: { rowId: row.id, rowCreatedAt: row.createdAt,
        before: previous.audience, after: next.audience, observedRevision: basis.metadata!.revision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } } } };
    };
    const desktopEdit = { ...row, audience: 'Adults', notes: 'Desktop notes' };
    const changed = await processCommand(owner, write(opening.snapshot, 'desktop-edit', row, desktopEdit, 40));
    if (changed.kind !== 'acknowledged') throw Error('Could not make the intermediate edit');
    const desktopReturn = { ...desktopEdit, audience: row.audience };
    expect((await processCommand(owner, write(changed.snapshot, 'desktop-return', desktopEdit, desktopReturn, 60))).kind).toBe('acknowledged');

    const phone = write(opening.snapshot, 'delayed-calendar-save', row, { ...row, audience: 'Leaders', notes: 'Phone notes' }, offset);
    const result = await processCommand(owner, phone);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { preachDates: [desktopReturn] } },
      conflicts: expect.arrayContaining([
        expect.objectContaining({ path: ['preachDates', 'id:date', 'notes'] }),
        expect.objectContaining({ path: ['preachDates', 'id:date', 'audience'], code: expected,
          mine: { exists: true, value: 'Leaders' }, theirs: { exists: true, value: 'Youth' } }),
      ]) });
    const history = await listPreachDateFieldHistory(owner, resource.id, 'mixed-preaching-detail');
    expect(history.entries).toEqual(offset < 40
      ? [expect.objectContaining({ fields: [expect.objectContaining({ field: 'audience', value: 'Leaders', winnerValue: 'Youth' })] })]
      : []);
    expect(await processCommand(owner, phone)).toEqual(result);
  });

  it('replays a large preaching date notes comparison with both versions intact', async () => {
    const owner = 'owner-1';
    const notes = 'a'.repeat(350_000);
    const phoneNotes = 'b'.repeat(350_000);
    const row = { id: 'date', date: '2026-11-20', church: { id: 'church', name: 'Church' },
      notes, createdAt: '2026-11-18T12:00:00.000Z' };
    const creation = create('large-preach-notes');
    if (creation.kind !== 'create') throw Error('Expected creation');
    const opening = await processCommand(owner, { ...creation, value: { ...creation.value, preachDates: [row] } });
    if (opening.kind !== 'acknowledged') throw Error('Could not create the sermon');
    const write = (basis: typeof opening.snapshot, operationId: string, after: string) => prepareDomainCommand(owner, operationId, basis, {
      ...basis.value, preachDates: [{ ...row, notes: after }],
    }).command;
    const delayed = write(opening.snapshot, 'delayed-large-notes', phoneNotes);
    const interim = await processCommand(owner, write(opening.snapshot, 'edit-after-phone', 'Intermediate words'));
    if (interim.kind !== 'acknowledged') throw Error('Could not write the intermediate words');
    expect((await processCommand(owner, write(interim.snapshot, 'return-after-phone', notes))).kind).toBe('acknowledged');

    const comparison = await processCommand(owner, delayed);
    expect(comparison.kind).toBe('conflict');
    if (comparison.kind !== 'conflict') return;
    const [conflict] = comparison.conflicts;
    expect(conflict.path).toEqual(['preachDates', 'id:date', 'notes']);
    expect(conflict.mine.value).toBe(phoneNotes);
    expect(conflict.theirs.value).toBe(notes);
    expect(await processCommand(owner, delayed)).toEqual(comparison);
  });

  it.each([
    { offset: 20, decision: 'preach-date-note-settled' },
    { offset: 80, decision: 'preach-date-note-queued' },
  ])('retains the $decision result when the audience edit needs a choice', async ({ offset, decision }) => {
    const owner = 'owner-1';
    const row = { id: 'date', date: '2026-11-20', church: { id: 'church', name: 'Church' },
      notes: 'Opening notes', audience: 'Opening audience', createdAt: '2026-11-18T12:00:00.000Z' };
    const creation = create('mixed-preach-notes');
    if (creation.kind !== 'create') throw Error('Expected creation');
    const opening = await processCommand(owner, { ...creation, value: { ...creation.value, preachDates: [row] } });
    if (opening.kind !== 'acknowledged') throw Error('Could not create the sermon');
    const write = (basis: typeof opening.snapshot, operationId: string, next: typeof row, at: number) => {
      const { command } = prepareDomainCommand(owner, operationId, basis, { ...basis.value, preachDates: [next] });
      if (command.kind !== 'update') throw Error('Expected a preaching date update');
      return { ...command, preachDateFieldActions: { notes: {
        rowId: row.id, rowCreatedAt: row.createdAt, observedRevision: basis.metadata!.revision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      } } };
    };
    const phone = write(opening.snapshot, 'mixed-phone', { ...row, notes: 'Phone notes', audience: 'Phone audience' }, offset);
    const desktop = { ...row, audience: 'Desktop audience' };
    const interim = await processCommand(owner, write(opening.snapshot, 'mixed-desktop-edit', { ...desktop, notes: 'Edited notes' }, 40));
    if (interim.kind !== 'acknowledged') throw Error('Could not write the intermediate words');
    expect((await processCommand(owner, write(interim.snapshot, 'mixed-desktop-return', desktop, 60))).kind).toBe('acknowledged');

    const reply = await processCommand(owner, phone);
    expect(reply).toMatchObject({ kind: 'conflict', snapshot: { value: { preachDates: [desktop] } },
      conflicts: expect.arrayContaining([
        expect.objectContaining({ path: ['preachDates', 'id:date', 'audience'] }),
        expect.objectContaining({ path: ['preachDates', 'id:date', 'notes'], code: decision,
          mine: { exists: true, value: 'Phone notes' }, theirs: { exists: true, value: row.notes } }),
      ]),
    });
    const history = await listPreachDateFieldHistory(owner, resource.id, 'mixed-preach-notes');
    if (decision === 'preach-date-note-settled') {
      expect(history.entries).toEqual([expect.objectContaining({ fields: [expect.objectContaining({ field: 'notes', value: 'Phone notes' })] })]);
    } else {
      expect(history.entries).toEqual([]);
    }
    expect(await processCommand(owner, phone)).toEqual(reply);
    if (reply.kind !== 'conflict' || decision !== 'preach-date-note-queued') return;

    const laterDesktop = { ...desktop, notes: 'New words while reviewing' };
    expect((await processCommand(owner, write(reply.snapshot, 'newer-desktop-notes', laterDesktop, 120))).kind).toBe('acknowledged');
    const retried = write(reply.snapshot, 'resolve-audience-with-separate-note', { ...desktop, notes: 'Phone notes' }, 80);
    retried.preachDateFieldActions.notes = phone.preachDateFieldActions.notes;
    const accepted = await processCommand(owner, retried);
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preachDates: [laterDesktop] } } });
    expect((await listPreachDateFieldHistory(owner, resource.id, 'mixed-preach-notes')).entries)
      .toEqual([expect.objectContaining({ fields: [expect.objectContaining({ field: 'notes', value: 'Phone notes' })] })]);
  });

  it.each([true, false])('keeps competing church identities together with clock evidence: %s', async timed => {
    const resource = { collection: 'sermons', id: 'sermon-church-choice' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const church = { id: '', name: 'Chapel', city: 'Town' };
    const date = { id: 'date', date: '2026-12-13', createdAt: now, status: 'planned', church };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now, updatedAt: now, thoughts: [], preachDates: [date] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, after: typeof church, offset: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['preachDates'], before: { exists: true, value: [date] }, after: { exists: true, value: [{ ...date, church: after }] } }],
      ...(timed && { preachDateFieldActions: { church: { rowId: date.id, rowCreatedAt: now, before: church, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } } } }),
    });
    const selected = { ...church, id: 'history-church' };
    const typed = { ...church, name: 'Different chapel' };
    expect((await processCommand(base.owner, update('desktop', selected, 40))).kind).toBe('acknowledged');
    const conflict = await processCommand(base.owner, update('phone', typed, 45));
    expect(conflict).toMatchObject({ kind: 'conflict', snapshot: { value: { preachDates: [{ ...date, church: selected }] } },
      conflicts: expect.arrayContaining([expect.objectContaining({ path: ['preachDates', 'id:date', 'church'] })]) });
    expect((await listPreachDateFieldHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each(['changed church', 'reused row'] as const)('does not move unclocked details across a %s', async scenario => {
    const resource = { collection: 'sermons', id: 'sermon-preaching-identity' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const date = { id: 'date', date: '2026-12-13', createdAt: now, status: 'planned', audience: 'Leaders',
      church: { id: 'original', name: 'Original chapel', city: 'Town' } };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], preachDates: [date] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof date[], after: typeof date[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const church = { id: 'new', name: 'New chapel', city: date.church.city };
    const replacement = scenario === 'changed church' ? { ...date, church } : { ...date, createdAt: '2026-11-08T00:05:00.000Z' };
    if (scenario === 'reused row') {
      expect((await processCommand(base.owner, update('delete', [date], []))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, update('replace', [], [replacement]))).kind).toBe('acknowledged');
    } else expect((await processCommand(base.owner, update('church', [date], [replacement]))).kind).toBe('acknowledged');
    const stale = scenario === 'changed church' ? { ...date, church: { ...date.church, city: 'Different town' } } : { ...date, audience: 'Guests' };
    const path = scenario === 'changed church' ? ['preachDates', 'id:date', 'church'] : ['preachDates', 'id:date'];
    expect(await processCommand(base.owner, update('late', [date], [stale]))).toMatchObject({
      kind: 'conflict', conflicts: [{ path }], snapshot: { value: { preachDates: [replacement] } },
    });
    expect((await listPreachDateFieldHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([
    { start: 'planned', offset: 20, expected: 'planned', kind: 'acknowledged' },
    { start: 'planned', offset: 85, expected: 'preached', kind: 'acknowledged' },
    { start: 'preached', offset: 20, expected: 'preached', kind: 'acknowledged' },
    { start: 'preached', offset: 85, expected: 'planned', kind: 'acknowledged' },
    { start: 'preached', offset: 65, expected: 'preached', kind: 'conflict' },
    { start: 'preached', offset: null, expected: 'preached', kind: 'conflict' },
  ] as const)('keeps the intended preaching status after a round trip from $start at $offset', async ({ start, offset, expected, kind }) => {
    const resource = { collection: 'sermons', id: 'sermon-preach-status' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const row = { id: 'date', date: '2026-12-13', status: start, createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: 'First date notes' };
    const other = { ...row, id: 'second', date: '2027-01-03', status: 'planned', notes: 'Second date notes' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: start === 'preached', preachDates: [row, other] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const opposite = start === 'planned' ? 'preached' : 'planned';
    const change = (operationId: string, before: string, after: string, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [
        { path: ['preachDates'], before: { exists: true, value: [{ ...row, status: before }, other] },
          after: { exists: true, value: [{ ...row, status: after }, other] } },
        { path: ['isPreached'], before: { exists: true, value: before === 'preached' }, after: { exists: true, value: after === 'preached' } },
      ],
      preachStatusActions: [{ rowId: row.id, rowCreatedAt: now, before, after, observedRevision,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } }],
    });
    expect((await processCommand(base.owner, change('desk-first', start, opposite, 40, 1))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, change('desk-return', opposite, start, 60, 2))).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, change('phone', start, opposite, offset, 1));
    expect(result).toMatchObject({ kind, snapshot: { value: { isPreached: expected === 'preached', preachDates: [{ ...row, status: expected }, other] } } });
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['preachDates', 'id:date', 'status'] }] });
  });

  it.each(['changed', 'created', 'same-value'] as const)('orders an unclocked reversal only after its exact %s predecessor', async origin => {
    const resource = { collection: 'sermons', id: 'sermon-preach-unchronometric' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const planned = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: now, church: { id: 'c', name: 'Church' } };
    const preached = { ...planned, status: 'preached' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: false, preachDates: origin === 'created' ? [] : [planned] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof planned[], after: typeof planned[], prior?: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed', dependsOn: prior ? [prior] : [],
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      preachStatusActions: before.length ? [{ rowId: planned.id, rowCreatedAt: now, before: before[0].status, after: after[0].status,
        observedRevision: 1, time: null, ...(prior && { predecessorOperationId: prior }) }] : [],
    });
    if (origin === 'same-value') {
      expect((await processCommand(base.owner, update('other-writer', [planned], [preached]))).kind).toBe('acknowledged');
    }
    const added = origin === 'created' ? planned : preached;
    const first = update('first', origin === 'created' ? [] : [planned], [added]);
    expect((await processCommand(base.owner, first)).kind).toBe('acknowledged');
    const after = origin === 'created' ? preached : planned;
    const second = update('second', [added], [after], 'first');
    const conflicts = origin === 'same-value';
    expect(await processCommand(base.owner, second)).toMatchObject({
      kind: conflicts ? 'conflict' : 'acknowledged', snapshot: { value: { preachDates: [conflicts ? preached : after] } },
    });
  });

  it.each(['changed', 'untouched'] as const)('preserves a %s legacy sibling while marking another date', async sibling => {
    const resource = { collection: 'sermons', id: 'sermon-preach-legacy-sibling' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first', date: '2026-12-13', createdAt: now, church: { id: 'c', name: 'Church' }, status: 'planned' };
    const legacy = { id: 'second', date: '2027-01-03', createdAt: now, church: { id: 'c', name: 'Church' } };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: false, preachDates: [first, legacy] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, after: object[], rowId: string, before: string | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: [first, legacy] }, after: { exists: true, value: after } }],
      preachStatusActions: [{ rowId, rowCreatedAt: now, before, after: 'preached', observedRevision: 1, time: null }],
    });
    const accepted = { ...legacy, status: 'preached', notes: 'New notes on another device' };
    if (sibling === 'changed') {
      expect((await processCommand(base.owner, update('second', [first, accepted], legacy.id, null))).kind).toBe('acknowledged');
    }
    const marked = { ...first, status: 'preached' };
    const materialized = { ...legacy, status: 'planned' };
    expect(await processCommand(base.owner, update('first', [marked, materialized], first.id, 'planned'))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { isPreached: true, preachDates: [marked, sibling === 'changed' ? accepted : materialized] } },
    });
  });

  it('keeps the sermon marked when an unmark touches only the opening dates and a newly added date is preached', async () => {
    const resource = { collection: 'sermons', id: 'sermon-new-preached-date' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const row = { id: 'opening', date: '2026-12-13', status: 'preached', createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: 'Opening date' };
    const later = { ...row, id: 'new', date: '2027-01-03', notes: 'New date' };
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: true, preachDates: [row] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, rows: typeof row[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: rows } }],
    });
    expect((await processCommand(base.owner, change('add', [row, later]))).kind).toBe('acknowledged');
    const unmark = change('unmark', [{ ...row, status: 'planned' }]);
    expect(await processCommand(base.owner, { ...unmark, changes: [...unmark.changes,
      { path: ['isPreached'], before: { exists: true, value: true }, after: { exists: true, value: false } }],
    })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { isPreached: true, preachDates: [{ ...row, status: 'planned' }, later] } } });
  });

  it('keeps and archives exact statuses for each date in one delayed unmark', async () => {
    const resource = { collection: 'sermons', id: 'sermon-bulk-unmark' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const rows = ['first', 'second'].map(id => ({ id, date: '2026-12-13', status: 'preached', createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: id }));
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: true, preachDates: rows };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const planned = rows.map(row => ({ ...row, status: 'planned' }));
    const change = (operationId: string, before: typeof rows, after: typeof rows, at: number, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      preachStatusActions: after.flatMap((row, index) => {
        const old = before[index];
        return old && old.status !== row.status ? [{ rowId: row.id, rowCreatedAt: now, before: old.status, after: row.status, observedRevision,
          time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } }] : [];
      }),
    });
    expect((await processCommand(base.owner, change('desktop-unmark', rows, planned, 35, 1))).kind).toBe('acknowledged');
    const newRow = { ...rows[0], id: 'remote', date: '2027-01-03', notes: 'Remote date' };
    expect((await processCommand(base.owner, change('desktop-restored', planned, [...rows, newRow], 60, 2))).kind).toBe('acknowledged');
    const phone = change('offline-unmark', rows, planned, 15, 1);
    const accepted = await processCommand(base.owner, phone);
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { isPreached: true, preachDates: [...rows, newRow] } } });
    expect(await processCommand(base.owner, phone)).toEqual(accepted);
    const history = await listPreachStatusHistory(base.owner, resource.id, 'seed');
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].fields).toMatchObject(rows.map(row => ({ rowId: row.id, rowCreatedAt: now, field: 'status', value: 'planned', winnerValue: 'preached' })));
    await expect(listPreachStatusHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
    await expect(listPreachStatusHistory(base.owner, resource.id, 'old')).rejects.toMatchObject({ status: 404 });
  });

  it.each([20, 85])('orders an unchanged planned date within a bulk unmark at %s', async offset => {
    const resource = { collection: 'sermons', id: 'sermon-unmark-planned-scope' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const first = { id: 'first', date: '2026-12-13', status: 'preached', createdAt: now,
      church: { id: 'chapel', name: 'Chapel' }, notes: 'First' };
    const second = { ...first, id: 'second', date: '2027-01-03', status: 'planned', notes: 'Second' };
    const initial = [first, second];
    const value = { userId: base.owner, title: 'Sermon', verse: 'John 3:16', date: now, createdAt: now,
      updatedAt: now, thoughts: [], isPreached: true, preachDates: initial };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, before: typeof initial, after: typeof initial, at: number, revision: number, bulk = false) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['preachDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      preachStatusActions: after.flatMap((row, index) => bulk || before[index].status !== row.status ? [{
        rowId: row.id, rowCreatedAt: now, before: before[index].status, after: row.status, observedRevision: revision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at },
      }] : []),
    });
    const allPlanned = [{ ...first, status: 'planned' }, second];
    expect((await processCommand(base.owner, change('clear', initial, allPlanned, 35, 1, true))).kind).toBe('acknowledged');
    const marked = [allPlanned[0], { ...second, status: 'preached' }];
    expect((await processCommand(base.owner, change('mark', allPlanned, marked, 60, 2))).kind).toBe('acknowledged');
    const result = await processCommand(base.owner, change('late-delivery', initial, allPlanned, offset, 1, true));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
      isPreached: offset < 60, preachDates: offset < 60 ? marked : allPlanned,
    } } });
  });

  it('keeps a choice when unstamped meeting edits return to the old date', async () => {
    const resource = { collection: 'groups', id: 'group-date-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const meeting = { id: 'meeting', date: '2026-12-13', location: 'Main room', createdAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: [meeting], createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: string, after: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: [{ ...meeting, date: before }] },
        after: { exists: true, value: [{ ...meeting, date: after }] } }],
    });
    expect((await processCommand(base.owner, edit('unset', meeting.date, ''))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('return', '', meeting.date))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, { ...edit('offline', meeting.date, '2026-12-20'),
      meetingDateAction: { rowId: meeting.id, before: meeting.date, after: '2026-12-20', observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } },
    })).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates', 'id:meeting', 'date'] })]),
      snapshot: { value: { meetingDates: [meeting] } } });
    expect((await listMeetingDateHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([true, false])('recognizes an explicit outcome clear before the queued type choice (clock: %s)', async clocked => {
    const resource = { collection: 'councils', id: 'topic-clear-and-convert' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const open = { id: 'opening', title: 'Opening', kind: 'decision', questions: [], options: [] };
    const recorded = { ...open, decision: 'Recorded decision', discussed: true };
    const selected = { ...open, kind: 'info' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [recorded] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof open, after: typeof open) => ({
      ...base, kind: 'update', operationId, generation: 'seed', councilTopicQueue: 'same-local-queue-000',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
    });
    expect((await processCommand(base.owner, edit('clear', recorded, open))).kind).toBe('acknowledged');
    const command = { ...edit('choose-type', open, selected), dependsOn: ['clear'],
      councilTopicKindActions: { kind: { rowId: open.id, rowCreatedAt: open.id, before: 'decision', after: 'info', observedRevision: 1,
        predecessorOperationId: 'clear', time: clocked ? { earliestMs: 1_800_000_000_040, latestMs: 1_800_000_000_044 } : null } },
    };
    expect(await processCommand(base.owner, command)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: [selected] } } });
  });

  it.each([
    { label: 'phone first', mobileAt: 15, winner: 'decision', kind: 'acknowledged', legacy: false },
    { label: 'phone last', mobileAt: 100, winner: 'info', kind: 'acknowledged', legacy: false },
    { label: 'no clock', mobileAt: null, winner: 'decision', kind: 'conflict', legacy: false },
    { label: 'legacy default', mobileAt: 15, winner: 'decision', kind: 'acknowledged', legacy: true },
  ])('orders the exact council topic type while it has no outcome: $label', async ({ mobileAt, winner, kind, legacy }) => {
    const resource = { collection: 'councils', id: 'topic-kind-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const topic = { id: 'opening', title: 'Opening', ...(!legacy && { kind: 'decision' }), summary: 'Original words', questions: [], options: [] };
    const other = { ...topic, id: 'other', title: 'Other section' };
    const topics = [topic, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof topics, after: typeof topics, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      councilTopicKindActions: { kind: { rowId: topic.id, rowCreatedAt: topic.id, before: before[0].kind ?? 'decision',
        after: after[0].kind ?? 'decision', observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const info = [{ ...topic, kind: 'info' }, other];
    const decision = [{ ...topic, kind: 'decision', summary: 'Later explanation' }, other];
    expect((await processCommand(base.owner, edit('desktop-info', topics, info, 45, 1))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('desktop-decision', info, decision, 65, 2))).kind).toBe('acknowledged');
    const phone = edit('phone', topics, info, mobileAt, 1);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { topics: [{ ...decision[0], kind: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/topic-kind-order/_topicKindHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['topics', 'id:opening', 'kind'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: topic.id, field: 'kind',
        value: winner === 'decision' ? 'info' : 'decision', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'earlier phone', phoneAt: 15, winner: false, legacy: false, moved: false },
    { label: 'later phone', phoneAt: 90, winner: true, legacy: false, moved: false },
    { label: 'unknown order', phoneAt: null, winner: false, legacy: false, moved: false },
    { label: 'legacy comment', phoneAt: 15, winner: false, legacy: true, moved: false },
    { label: 'changed passage', phoneAt: 90, winner: false, legacy: false, moved: true },
    { label: 'older move checked for a different kind', phoneAt: 15, winner: false, legacy: false, moved: false, phoneMoves: true },
  ])('orders the explicit comment kind only at its reviewed place: $label', async ({ phoneAt, winner, legacy, moved, phoneMoves }) => {
    const resource = { collection: 'studyNotes', id: 'comment-kind-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const place = { id: 'place', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const refs = [place], relocated = [{ ...place, fromVerse: 17 }];
    const comment = { userId: base.owner, title: '', content: 'Original words', type: 'comment',
      scriptureRefs: refs, tags: [], isDraft: false, createdAt: now, updatedAt: now };
    const ordinary = { exists: true, value: false }, paragraph = { exists: true, value: true };
    const opening = legacy ? { exists: false } : ordinary;
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed',
      value: { ...comment, ...(!legacy && { paragraph: false }) } })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof opening, after: typeof ordinary, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId, changes: [{ path: ['paragraph'], before, after }],
      commentKindAction: { observedRevision, reference: { exists: true, value: refs },
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } },
    });
    expect((await processCommand(base.owner, edit('computer-paragraph', opening, paragraph, 40, 1))).kind).toBe('acknowledged');
    const back = edit('computer-comment', paragraph, ordinary, 60, 2);
    expect((await processCommand(base.owner, { ...back, changes: [...back.changes,
      { path: ['content'], before: { exists: true, value: comment.content }, after: { exists: true, value: 'Independent words' } },
    ] })).kind).toBe('acknowledged');
    if (moved) expect((await processCommand(base.owner, { ...base, kind: 'update', generation: 'seed', operationId: 'relocate',
      changes: [{ path: ['scriptureRefs'], before: { exists: true, value: refs }, after: { exists: true, value: relocated } }],
      commentPlaceAction: { observedRevision: 3, paragraph: ordinary, time: null },
    })).kind).toBe('acknowledged');
    const selection = edit('phone', opening, paragraph, phoneAt, 1);
    const phone = phoneMoves ? { ...selection, changes: [...selection.changes,
      { path: ['scriptureRefs'], before: { exists: true, value: refs }, after: { exists: true, value: relocated } },
    ] } : selection;
    const result = await processCommand(base.owner, phone);
    expect(result.kind).toBe(moved ? 'refused' : phoneAt === null || phoneMoves ? 'conflict' : 'acknowledged');
    if (moved) expect(result).toMatchObject({ code: 'comment-kind-place-changed' });
    expect((await readDocument(base.owner, resource)).value).toMatchObject({ type: 'comment', paragraph: winner,
      content: 'Independent words', scriptureRefs: moved ? relocated : refs });
    expect(await processCommand(base.owner, phone)).toEqual(result);
    const history = await listCommentKindHistory(base.owner, resource.id, 'seed');
    expect(history.entries).toEqual(result.kind === 'acknowledged'
      ? [expect.objectContaining({ paragraph: !winner, winnerParagraph: winner })] : []);
  });

  it.each([
    { label: 'an earlier offline move', phoneAt: 15, winner: 18 },
    { label: 'a later offline move', phoneAt: 90, winner: 17 },
    { label: 'an earlier offline move after a return to the original verse', phoneAt: 15, winner: 16, returned: true },
    { label: 'an offline move with no clock proof', phoneAt: null, winner: 18 },
    { label: 'a legacy offline move after a return', phoneAt: null, winner: 16, returned: true, legacy: true },
    { label: 'a legacy move after the returned comment became a paragraph', phoneAt: null, winner: 16, returned: true, legacy: true, flipped: true },
    { label: 'a legacy move and tail edit after a return', phoneAt: null, winner: 16, returned: true, legacy: true, tail: true },
    { label: 'an exact choice after the displayed place has since been left and restored', phoneAt: 90, winner: 16, returned: true, reviewed: true },
    { label: 'a combined move and kind change after the opening place was left and restored', phoneAt: 90, winner: 16, returned: true, compound: true },
    { label: 'an earlier move after a newer action chose the same destination', phoneAt: 60, winner: 18, sameDestination: true },
  ])('orders only the comment place for $label', async ({ phoneAt, winner, returned, legacy, flipped, tail, reviewed, compound, sameDestination }) => {
    const resource = { collection: 'studyNotes', id: 'comment-place-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const reference = { id: 'place', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
    const secondReference = { id: 'extra', bible: 'kjv', book: 'John', chapter: 5, fromVerse: 3 };
    const storedExtra = { ...secondReference, fromVerse: 4 };
    const refs = (verse: number) => [{ ...reference, fromVerse: verse }, secondReference];
    const field = <Value,>(value: Value) => ({ exists: true as const, value });
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed',
      value: { userId: base.owner, title: '', content: 'Original words', type: 'comment', paragraph: false,
        scriptureRefs: refs(16), tags: [], isDraft: false, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');

    const move = (operationId: string, before: number, after: number, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['scriptureRefs'], before: field(refs(before)), after: field(refs(after)) }],
      commentPlaceAction: { observedRevision, paragraph: field(false),
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } },
    });
    expect((await processCommand(base.owner, move('computer', 16, 18, 40, 1))).kind).toBe('acknowledged');
    if (returned) expect((await processCommand(base.owner, move('return', 18, 16, 60, 2))).kind).toBe('acknowledged');
    if (sameDestination) expect((await processCommand(base.owner, move('same-destination', 16, 18, 90, 1))).kind).toBe('acknowledged');

    const current = returned ? 16 : 18;
    expect((await processCommand(base.owner, { ...base, kind: 'update', generation: 'seed', operationId: 'independent-edit',
      changes: [
        { path: ['content'], before: field('Original words'), after: field('Independent words') },
        { path: ['scriptureRefs'], before: field(refs(current)), after: field([refs(current)[0], storedExtra]) },
      ],
    })).kind).toBe('acknowledged');

    if (flipped) expect((await processCommand(base.owner, { ...base, kind: 'update', generation: 'seed', operationId: 'kind',
      changes: [{ path: ['paragraph'], before: field(false), after: field(true) }],
    })).kind).toBe('acknowledged');

    const delayed = move('phone', 16, 17, phoneAt, 1);
    const input = legacy ? { ...delayed, commentPlaceAction: undefined } : reviewed || compound
      ? { ...delayed, commentPlaceAction: { ...delayed.commentPlaceAction, ...(reviewed && { reviewed: true }), ...(compound && { compound: true }) } }
      : delayed;
    if (legacy) delete input.commentPlaceAction;
    if (tail) input.changes = [{ path: ['scriptureRefs'], before: field(refs(16)), after: field([refs(17)[0], { ...secondReference, fromVerse: 6 }]) }];
    if (compound) {
      const mixed = { ...input, changes: [...input.changes, { path: ['paragraph'], before: field(false), after: field(true) }] };
      expect(await processCommand(base.owner, mixed)).toMatchObject({ kind: 'conflict' });
      expect((await readDocument(base.owner, resource)).value).toMatchObject({ paragraph: false, scriptureRefs: [{ ...reference, fromVerse: 16 }, storedExtra] });
      return;
    }
    const reply = await processCommand(base.owner, input);
    expect((await readDocument(base.owner, resource)).value).toMatchObject({
      content: 'Independent words', type: 'comment', paragraph: Boolean(flipped),
      scriptureRefs: [{ ...reference, fromVerse: winner }, storedExtra],
    });
    expect(reply.kind).toBe(phoneAt === null || reviewed ? 'conflict' : 'acknowledged');
    expect(await processCommand(base.owner, input)).toEqual(reply);
  });

  it.each([
    { label: 'earlier phone', phoneAt: 15, winner: 'note', legacy: false },
    { label: 'later phone', phoneAt: 90, winner: 'question', legacy: false },
    { label: 'unknown order', phoneAt: null, winner: 'note', legacy: false },
    { label: 'ordinary legacy note', phoneAt: 15, winner: 'note', legacy: true },
  ])('orders ordinary note type without changing its words: $label', async ({ phoneAt, winner, legacy }) => {
    const resource = { collection: 'studyNotes', id: 'type-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const note = { userId: base.owner, title: 'Note title', content: 'Original words', tags: ['Keep'], scriptureRefs: [], isDraft: true, createdAt: now, updatedAt: now };
    const absent = { exists: false }, plain = { exists: true, value: 'note' }, question = { exists: true, value: 'question' };
    const opening = legacy ? absent : plain;
    expect((await processCommand(base.owner, { ...base, kind: 'create', generation: null, operationId: 'seed',
      value: { ...note, ...(!legacy && { type: 'note' }) } })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof opening, after: typeof plain, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', generation: 'seed', operationId, changes: [{ path: ['type'], before, after }],
      studyNoteTypeAction: { observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } },
    });
    expect((await processCommand(base.owner, edit('computer-question', opening, question, 40, 1))).kind).toBe('acknowledged');
    const returnToNote = edit('computer-note', question, plain, 60, 2);
    expect((await processCommand(base.owner, { ...returnToNote, changes: [...returnToNote.changes,
      { path: ['content'], before: { exists: true, value: note.content }, after: { exists: true, value: 'Independent words' } },
    ] })).kind).toBe('acknowledged');
    const phone = edit('phone', opening, question, phoneAt, 1);
    const result = await processCommand(base.owner, phone);
    expect(result.kind).toBe(phoneAt === null ? 'conflict' : 'acknowledged');
    expect((await readDocument(base.owner, resource)).value).toMatchObject({ title: note.title, type: winner, content: 'Independent words', tags: note.tags });
    expect(await processCommand(base.owner, phone)).toEqual(result);
  });

  describe.each(['option round trip', 'text round trip', 'independent action times'] as const)('conservative council outcome: %s', scenario => {
    it.each([false, true])('preserves the committed outcome and asks about competing changes (reverse: %s)', async reverse => {
      const resource = { collection: 'councils', id: 'outcome-stale-opening' };
      const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
      const now = '2026-11-09T00:00:00.000Z';
      const section = { id: 'section', title: 'Section', kind: 'decision', questions: [],
        options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
      const opening = scenario === 'text round trip' ? { ...section, discussed: true, decision: 'X' } : section;
      const a = { ...section, discussed: true, acceptedOptionId: 'a' };
      const b = { ...section, discussed: true, acceptedOptionId: 'b' };
      const words = { ...section, discussed: true, decision: 'X' };
      const first = scenario === 'text round trip' ? { ...words, decision: 'Y' } : a;
      const competing = scenario === 'text round trip' ? section : { ...b, decision: 'X' };
      expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
        value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [opening] },
      })).kind).toBe('acknowledged');
      const save = (operationId: string, before: typeof section, after: typeof section, observedRevision: number, offset: number) =>
        processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
          councilOutcomeActions: [{ rowId: section.id, rowCreatedAt: section.id, observedRevision,
            time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } }],
        });
      const conflict = { kind: 'conflict', conflicts: [{ path: ['topics', 'id:section', 'outcome'] }] };
      if (scenario === 'independent action times') {
        expect((await save('first-option', opening, a, 1, 10)).kind).toBe('acknowledged');
        const editText = () => save('words', opening, words, 1, 30);
        const editOption = () => save('other-option', opening, b, 1, 20);
        for (const edit of reverse ? [editOption, editText] : [editText, editOption]) expect(await edit()).toMatchObject(conflict);
        expect((await readDocument(base.owner, resource)).value?.topics).toEqual([a]);
      } else if (reverse) {
        expect((await save('competing', opening, competing, 1, 50)).kind).toBe('acknowledged');
        expect(await save('first-phone', opening, first, 1, 20)).toMatchObject(conflict);
        expect((await readDocument(base.owner, resource)).value?.topics).toEqual([competing]);
      } else {
        expect((await save('first-phone', opening, first, 1, 20)).kind).toBe('acknowledged');
        expect((await save('back-to-opening', first, opening, 2, 90)).kind).toBe('acknowledged');
        expect(await save('competing', opening, competing, 1, 50)).toMatchObject(conflict);
        expect((await readDocument(base.owner, resource)).value?.topics).toEqual([opening]);
      }
    });
  });

  it.each([
    { label: 'earlier phone', phoneAt: 15, held: false },
    { label: 'later phone', phoneAt: 90, held: false },
    { label: 'earlier phone in held council', phoneAt: 15, held: true },
    { label: 'later phone in held council', phoneAt: 90, held: true },
    { label: 'no clock', phoneAt: null, held: false },
  ])('asks about the complete outcome instead of ordering it: $label', async ({ phoneAt, held }) => {
    const resource = { collection: 'councils', id: 'timed-topic-outcome' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const other = { ...opening, id: 'neighbor', title: 'Keep the neighbor' };
    const topics = [opening, other];
    const deferred = { ...opening, resolution: 'postponed', ...(held && { changes: [{ at: now, from: '', to: 'postponed' }] }) };
    const decided = { ...opening, discussed: true, acceptedOptionId: 'plan',
      ...(held && { changes: [{ at: now, from: '', to: 'Care plan' }] }) };
    const laterTitle = { ...other, title: 'Independent edit' };
    const empty = { discussed: false, decision: null, acceptedOptionId: null, resolution: null };
    const draftOutcome = { ...empty, discussed: true, acceptedOptionId: 'plan' };
    const storedOutcome = { ...empty, resolution: 'postponed' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: held ? 'held' : 'preparing', ...(held && { heldAt: now }), createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof topics, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: topics }, after: { exists: true, value: after } }],
      councilOutcomeActions: [{ rowId: opening.id, rowCreatedAt: opening.id, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    expect((await processCommand(base.owner, edit('desktop', [deferred, laterTitle], 50))).kind).toBe('acknowledged');
    const phone = edit('phone', [decided, other], phoneAt);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['topics', 'id:section', 'outcome'],
      base: { value: empty }, mine: { value: draftOutcome }, theirs: { value: storedOutcome },
    }] });
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([deferred, laterTitle]);
    expect((await listCouncilOutcomeHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
    expect(await processCommand(base.owner, phone)).toEqual(result);
  });

  it('asks before removing an option when another device wrote independent words', async () => {
    const resource = { collection: 'councils', id: 'independent-outcome-clear' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const section = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const opening = { ...section, discussed: true, acceptedOptionId: 'plan' };
    const text = 'The decision was written independently';
    const written = { ...opening, decision: text };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [opening] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof section, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [opening] }, after: { exists: true, value: [after] } }],
      councilOutcomeActions: [{ rowId: section.id, rowCreatedAt: section.id, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    expect((await processCommand(base.owner, edit('write', written, 80))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, edit('clear-option', section, 40))).toMatchObject({
      kind: 'conflict', conflicts: [{ path: ['topics', 'id:section', 'outcome'] }],
    });
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([written]);
  });

  it.each([
    { optionLast: true, laterOption: 'a' },
    { optionLast: false, laterOption: 'a' },
    { optionLast: true, laterOption: 'b' },
    { optionLast: false, laterOption: 'b' },
  ])('asks before replacing independently written council words (later option: $laterOption, option arrives last: $optionLast)', async ({ optionLast, laterOption }) => {
    const resource = { collection: 'councils', id: 'independent-outcome-options' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind: 'decision', questions: [],
      options: [{ id: 'a', text: 'First' }, { id: 'b', text: 'Second' }] };
    const text = 'Keep the independently written decision';
    const optionA = { ...opening, discussed: true, acceptedOptionId: 'a' };
    const words = { ...optionA, decision: text };
    const laterSelection = { ...opening, discussed: true, acceptedOptionId: laterOption };
    const edit = (operationId: string, before: typeof opening, after: typeof opening, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
      councilOutcomeActions: [{ rowId: opening.id, rowCreatedAt: opening.id, observedRevision: before === opening ? 1 : 2,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [opening] },
    })).kind).toBe('acknowledged');
    const phone = optionLast ? [edit('option-a', opening, optionA, 20), edit('write', optionA, words, 50)]
      : [edit('phone-both', opening, words, 50)];
    const laptop = edit('later-option', opening, laterSelection, 90);
    for (const command of optionLast ? phone : [laptop]) expect((await processCommand(base.owner, command)).kind).toBe('acknowledged');
    const delayed = optionLast ? laptop : phone[0];
    expect(await processCommand(base.owner, delayed)).toMatchObject({ kind: 'conflict',
      conflicts: [{ path: ['topics', 'id:section', 'outcome'] }],
    });
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([optionLast ? words : laterSelection]);
    expect((await listCouncilOutcomeHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each(['removed-option', 'reviewed-outcome', 'distinct-words'])('preserves the complete council outcome contract: %s', async scenario => {
    const resource = { collection: 'councils', id: 'outcome-contract' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const topic = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const words = { ...topic, discussed: true, decision: 'Keep these independently written words' };
    const option = { ...topic, discussed: true, acceptedOptionId: 'plan' };
    const deferred = { ...topic, resolution: 'postponed' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [topic] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof topic, at?: number, before = topic, observedRevision = 1) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
      ...(at !== undefined && { councilOutcomeActions: [{ rowId: topic.id, rowCreatedAt: topic.id, observedRevision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }] }),
    });
    if (scenario === 'removed-option') {
      expect((await processCommand(base.owner, edit('remove', { ...topic, options: [] }))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('select', option, 90))).toMatchObject({ kind: 'refused', code: 'council-option-gone' });
      expect((await readDocument(base.owner, resource)).value?.topics).toEqual([{ ...topic, options: [] }]);
      return;
    }
    expect((await processCommand(base.owner, edit('words', words, 80))).kind).toBe('acknowledged');
    if (scenario === 'distinct-words') {
      const other = { ...words, decision: 'Different written words from the phone' };
      expect(await processCommand(base.owner, edit('other-words', other, 100))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['topics', 'id:section', 'outcome'],
          mine: { value: expect.objectContaining({ decision: other.decision }) },
          theirs: { value: expect.objectContaining({ decision: words.decision }) },
        }],
      });
      return;
    }
    const pending = edit('select', option, 40);
    expect(await processCommand(base.owner, pending)).toMatchObject({ kind: 'conflict',
      conflicts: [{ path: ['topics', 'id:section', 'outcome'] }],
    });
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([words]);
    expect((await processCommand(base.owner, edit('reviewed-deferral', deferred, 100, words, 2))).kind).toBe('acknowledged');
    expect((await readDocument(base.owner, resource)).value?.topics).toEqual([deferred]);
  });

  it.each(['neighboring change', 'exact predecessor', 'legacy without a stamp', 'evicted proof'] as const)('checks an outcome basis independently of time: %s', async scenario => {
    const resource = { collection: 'councils', id: 'outcome-basis' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const topic = { id: 'section', title: 'Section', kind: 'decision', questions: [], options: [{ id: 'a', text: 'A' }] };
    const neighbor = { ...topic, id: 'neighbor', title: 'Neighbor' };
    const selected = { ...topic, discussed: true, acceptedOptionId: 'a' };
    const words = { ...selected, decision: 'X' };
    const reviewed = { ...topic, discussed: true, decision: 'X' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [topic, neighbor] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof topic[], after: typeof topic[], stamp?: { predecessorOperationId?: string }) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed', councilTopicQueue: 'same-local-queue-000',
        changes: [{ path: ['topics'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        ...(stamp && { councilOutcomeActions: [{ rowId: topic.id, rowCreatedAt: topic.id, observedRevision: 1, time: null, ...stamp }] }),
      });
    const other = { ...neighbor, title: 'New neighboring title' };
    const first = scenario === 'neighboring change' || scenario === 'evicted proof' ? [topic, other]
      : scenario === 'exact predecessor' ? [selected, neighbor] : [reviewed, neighbor];
    expect((await edit('first', [topic, neighbor], first, {})).kind).toBe('acknowledged');
    if (scenario === 'evicted proof') {
      const raw = documents.get('councils/outcome-basis')!;
      const meta = raw._dataEngine as Raw;
      raw._dataEngine = { ...meta, councilOutcomeProofs: { outcome: { floor: 2, proofs: [] } } };
    }
    const follows = scenario === 'exact predecessor';
    const result = await edit('second', [follows ? selected : topic, neighbor], [follows ? words : selected, neighbor],
      scenario === 'legacy without a stamp' ? undefined : follows ? { predecessorOperationId: 'first' } : {});
    if (scenario === 'legacy without a stamp' || scenario === 'evicted proof') {
      expect(result).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['topics', 'id:section', 'outcome'] }] });
      expect((await readDocument(base.owner, resource)).value?.topics).toEqual(first);
    } else {
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: follows ? [words, neighbor] : [selected, other] } } });
    }
  });

  it.each([
    { scenario: 'missing legacy outcome history', missing: true, mode: 'outcome', queue: 'phone-queue-00000', kind: 'conflict' },
    { scenario: 'changing type and outcome together', missing: true, mode: 'combined', queue: 'phone-queue-00000', kind: 'conflict' },
    { scenario: 'an old client sees a value that has not returned', missing: false, mode: 'legacy-fresh', queue: undefined, kind: 'acknowledged' },
    { scenario: 'an old outcome command without an observed revision', missing: false, mode: 'legacy-outcome', queue: undefined, kind: 'conflict' },
    { scenario: 'an old result command after the original kind returned', missing: false, mode: 'legacy-outcome-round-trip', queue: undefined, kind: 'conflict' },
    { scenario: 'an old kind command after the original kind returned', missing: false, mode: 'legacy-kind-round-trip', queue: undefined, kind: 'conflict' },
    { scenario: 'an old kind command without an observed revision', missing: false, mode: 'legacy-type', queue: undefined, kind: 'conflict' },
    { scenario: 'a pure type change after a different outcome was cleared', missing: false, mode: 'type', queue: 'phone-queue-00000', kind: 'conflict' },
    { scenario: 'a copied ID from another queue', missing: false, mode: 'spoof', queue: 'phone-queue-00000', kind: 'conflict' },
    { scenario: 'the actual preceding action of the queue', missing: false, mode: 'spoof', queue: 'desktop-queue-000', kind: 'acknowledged' },
    { scenario: 'a freshly observed legacy outcome', missing: true, mode: 'fresh', queue: 'phone-queue-00000', kind: 'acknowledged' },
    { scenario: 'reviewing a kind change whose outcome remains empty', missing: true, mode: 'reviewed-type', queue: 'phone-queue-00000', kind: 'acknowledged' },
  ])('checks council outcome revision and provenance: $scenario', async ({ missing, mode, queue, kind }) => {
    const resource = { collection: 'councils', id: 'council-outcome-legacy-basis' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const opening = { id: 'section', title: 'Decision', kind: 'decision', questions: [],
      options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
    const chosen = { ...opening, discussed: true, acceptedOptionId: 'a' };
    const neighbor = { ...opening, id: 'neighbor', title: 'Keep the other topic' };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [opening, neighbor] },
    })).kind).toBe('acknowledged');
    const save = (operationId: string, before: typeof opening, after: typeof opening, observedRevision: number,
      councilTopicQueue: string | undefined, usePredecessor = false, includeOutcome = true, includeKind = false) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed', ...(councilTopicQueue && { councilTopicQueue }),
        changes: [{ path: ['topics'], before: { exists: true, value: [before, neighbor] }, after: { exists: true, value: [after, neighbor] } }],
        ...(includeOutcome && { councilOutcomeActions: [{ rowId: opening.id, rowCreatedAt: opening.id, observedRevision,
          ...(usePredecessor && { predecessorOperationId: 'clear' }) }] }),
        ...(includeKind && { councilTopicKindActions: { kind: { rowId: opening.id, rowCreatedAt: opening.id,
          before: before.kind, after: after.kind, observedRevision, time: null } } }),
      });
    const legacyFresh = mode === 'legacy-fresh';
    const current = legacyFresh ? { ...opening, discussed: true, decision: 'An outcome never used before' } : opening;
    if (mode.endsWith('-round-trip')) {
      const info = { ...opening, kind: 'info' };
      expect((await save('switch-info', opening, info, 1, 'desktop-queue-000', false, false, true)).kind).toBe('acknowledged');
      expect((await save('switch-back', info, opening, 2, 'desktop-queue-000', false, false, true)).kind).toBe('acknowledged');
    } else {
      expect((await save('choose-a', opening, chosen, 1, 'desktop-queue-000')).kind).toBe('acknowledged');
      expect((await save('clear', chosen, current, 2, 'desktop-queue-000')).kind).toBe('acknowledged');
    }
    if (missing) {
      const raw = documents.get('councils/' + resource.id)!;
      const metadata = raw._dataEngine as Raw;
      delete metadata.councilOutcomeProofs;
    }
    const typeChanged = mode === 'combined' || mode.endsWith('type') || mode === 'legacy-kind-round-trip';
    const wanted = typeChanged ? { ...opening, kind: 'info', ...(mode === 'combined' && { discussed: true }) }
      : { ...opening, discussed: true, acceptedOptionId: 'b' };
    const modern = !mode.startsWith('legacy-');
    const reviewed = mode === 'fresh' || mode === 'reviewed-type';
    const result = await save('late', current, wanted, reviewed ? 3 : 1, queue, mode === 'spoof',
      modern && mode !== 'type', modern && typeChanged && mode !== 'reviewed-type');
    expect(result).toMatchObject({ kind, snapshot: { value: { topics: [kind === 'acknowledged' ? wanted : current, neighbor] } } });
    if (kind === 'conflict') expect(result).toMatchObject({
      conflicts: [{ path: ['topics', 'id:section', typeChanged ? 'kind' : 'outcome'] }],
    });
  });

  it.each(['decision', 'info'])('keeps incompatible %s outcomes distinct when order is unknown', async kind => {
    const resource = { collection: 'councils', id: 'topic-outcome-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-09T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind, questions: [], options: [{ id: 'plan', text: 'Care plan' }] };
    const other = { ...opening, id: 'neighbor', title: 'Neighbor' };
    const initial = [opening, other];
    const deferred = { ...opening, resolution: 'postponed' };
    const handled = { ...opening, discussed: true, ...(kind === 'decision' && { acceptedOptionId: 'plan' }) };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: initial },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof initial) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: initial }, after: { exists: true, value: after } }],
    });
    expect((await processCommand(base.owner, edit('desktop', [deferred, other]))).kind).toBe('acknowledged');
    const phone = edit('phone', [handled, other]);
    expect(await processCommand(base.owner, phone)).toMatchObject({ kind: 'conflict', conflicts: [{
      path: ['topics', 'id:section', 'outcome'], mine: { value: expect.objectContaining({ discussed: true }) },
      theirs: { value: expect.objectContaining({ resolution: 'postponed' }) },
    }] });
    expect(await readDocument(base.owner, resource)).toMatchObject({ value: { topics: [deferred, other] } });
  });

  it.each([
    { label: 'direct type conversion would clear a recorded result', recorded: true, deviceSeesOutcome: true, typeSwitch: true, code: 'council-topic-outcome-first' },
    { label: 'late type conversion missed a newly recorded result', recorded: true, deviceSeesOutcome: false, typeSwitch: true, code: 'council-topic-outcome-first' },
    { label: 'late outcome was recorded under the older type', recorded: false, deviceSeesOutcome: false, typeSwitch: false, code: 'council-topic-kind-changed' },
  ])('protects a council topic outcome: $label', async ({ recorded, deviceSeesOutcome, typeSwitch, code }) => {
    const resource = { collection: 'councils', id: 'topic-outcome-fence' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'section', title: 'Section', kind: 'decision', summary: 'Keep this note',
      questions: [], options: [{ id: 'first', text: 'First option' }] };
    const decided = { ...opening, discussed: true, decision: 'Keep this recorded decision', acceptedOptionId: 'first' };
    const info = { ...opening, kind: 'info' };
    const stored = recorded ? decided : info;
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [stored] },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof opening, after: typeof opening) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
    });
    const command = edit('late', deviceSeesOutcome ? decided : opening, typeSwitch ? info : decided);
    expect(await processCommand(base.owner, command)).toMatchObject({ kind: 'refused', code });
    expect(await readDocument(base.owner, resource)).toMatchObject({ value: { topics: [stored] } });
    if (!recorded) {
      const manualRebase = edit('retry-on-info', info, { ...decided, kind: 'info' });
      expect(await processCommand(base.owner, manualRebase)).toMatchObject({ kind: 'refused', code: 'council-topic-kind-changed' });
      expect(await readDocument(base.owner, resource)).toMatchObject({ value: { topics: [info] } });
    }
    if (recorded) {
      expect((await processCommand(base.owner, edit('explicit-clear', decided, opening))).kind).toBe('acknowledged');
      const current = await readDocument(base.owner, resource);
      expect(await processCommand(base.owner, { ...edit('new-type', opening, info), councilTopicKindActions: {
        kind: { rowId: opening.id, rowCreatedAt: opening.id, before: 'decision', after: 'info',
          observedRevision: current.metadata!.revision, time: null },
      } })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: [info] } } });
    }
  });

  it.each([
    { label: 'phone first', mobileAt: 15, winner: false, kind: 'acknowledged' },
    { label: 'phone last', mobileAt: 100, winner: true, kind: 'acknowledged' },
    { label: 'no clock', mobileAt: null, winner: false, kind: 'conflict' },
  ])('orders the exact assembly flag after the computer clears it: $label', async ({ mobileAt, winner, kind }) => {
    const resource = { collection: 'councils', id: 'assembly-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const topic = { id: 'opening', title: 'Opening', summary: 'Original words', forAssembly: false, questions: [], options: [] };
    const other = { ...topic, id: 'other', title: 'Other section', forAssembly: true };
    const topics = [topic, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof topics, after: typeof topics, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      councilAssemblyActions: { forAssembly: { rowId: topic.id, rowCreatedAt: topic.id, before: before[0].forAssembly,
        after: after[0].forAssembly, observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const marked = [{ ...topic, forAssembly: true }, other];
    const cleared = [{ ...topic, summary: 'Later explanation' }, other];
    expect((await processCommand(base.owner, edit('desktop-mark', topics, marked, 45, 1))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('desktop-clear', marked, cleared, 65, 2))).kind).toBe('acknowledged');
    const phone = edit('phone', topics, marked, mobileAt, 1);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { topics: [{ ...cleared[0], forAssembly: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/assembly-order/_assemblyHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['topics', 'id:opening', 'forAssembly'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: topic.id, field: 'forAssembly', value: !winner, winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'phone first', mobileAt: 15, winner: 'Computer section', kind: 'acknowledged' },
    { label: 'phone last', mobileAt: 100, winner: 'Phone section', kind: 'acknowledged' },
    { label: 'no clock', mobileAt: null, winner: 'Computer section', kind: 'conflict' },
  ])('orders one council section title without replacing its explanation: $label', async ({ mobileAt, winner, kind }) => {
    const resource = { collection: 'councils', id: 'topic-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const topic = { id: 'opening', title: 'Opening', summary: 'Original words', questions: [], options: [] };
    const other = { ...topic, id: 'other', title: 'Other section' };
    const topics = [topic, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof topics, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: topics }, after: { exists: true, value: after } }],
      councilTopicTitleActions: [{ rowId: topic.id, rowCreatedAt: topic.id, before: topic.title,
        after: after[0].title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    const desktop = [{ ...topic, title: 'Computer section', summary: 'Later explanation' }, other];
    expect((await processCommand(base.owner, edit('desktop', desktop, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', [{ ...topic, title: 'Phone section' }, other], mobileAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Council', topics: [{ ...desktop[0], title: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/topic-title-order/_topicTitleHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['topics', 'id:opening', 'title'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: topic.id, field: 'title',
        value: winner === 'Computer section' ? 'Phone section' : 'Computer section', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'legacy', time: undefined },
    { label: 'without an action clock', time: null },
  ])('retains the returned council section title for a delayed rename $label', async ({ time }) => {
    const resource = { collection: 'councils', id: 'topic-title-return' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const section = { id: 'opening', title: 'Opening title', summary: 'Opening explanation', questions: [], options: [] };
    const other = { ...section, id: 'closing', title: 'Closing section' };
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [section, other] },
    })).toMatchObject({ kind: 'acknowledged' });
    const rename = (operationId: string, before: typeof section, after: typeof section, observedRevision: number, clock?: null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before, other] }, after: { exists: true, value: [after, other] } }],
      ...(clock !== undefined && { councilTopicTitleActions: [{ rowId: section.id, rowCreatedAt: section.id,
        before: before.title, after: after.title, observedRevision, time: clock }] }),
    });
    const temporary = { ...section, title: 'Temporary title' };
    const restored = { ...section, summary: 'Independent later explanation' };
    expect(await processCommand(base.owner, rename('change', section, temporary, 1, null))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, rename('return', temporary, restored, 2, null))).toMatchObject({ kind: 'acknowledged' });
    const delayed = rename('delayed', section, { ...section, title: 'Phone title' }, 1, time);
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { topics: [restored, other] } },
      conflicts: [{ path: ['topics', 'id:opening', 'title'], mine: { value: 'Phone title' }, theirs: { value: section.title } }],
    });
    expect(await processCommand(base.owner, delayed)).toEqual(result);
    const currentRevision = result.kind === 'conflict' ? result.snapshot.metadata!.revision : 0;
    const chosen = { ...restored, title: 'Phone title' };
    expect(await processCommand(base.owner, rename('choice', restored, chosen, currentRevision, null)))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: [chosen, other] } } });
  });

  it.each([
    { at: 20, expected: 'council-topic-text-settled' },
    { at: 80, expected: 'council-topic-text-queued' },
  ])('reports a proved council title separately when summary still needs a choice at $at', async ({ at, expected }) => {
    const resource = { collection: 'councils', id: 'topic-title-and-summary' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const section = { id: 'opening', title: 'Opening title', summary: 'Opening words', questions: [], options: [] };
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Council', status: 'preparing', createdAt: now, updatedAt: now, topics: [section] },
    })).toMatchObject({ kind: 'acknowledged' });
    const edit = (operationId: string, before: typeof section, after: typeof section, observedRevision: number, offset: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['topics'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
      councilTopicTitleActions: [{ rowId: section.id, rowCreatedAt: section.id, before: before.title, after: after.title,
        observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } }],
    });
    const temporary = { ...section, title: 'Temporary title', summary: 'Desktop words' };
    const restored = { ...temporary, title: section.title };
    expect(await processCommand(base.owner, edit('desktop', section, temporary, 1, 40))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, edit('restore', temporary, restored, 2, 60))).toMatchObject({ kind: 'acknowledged' });
    const delayed = edit('phone', section, { ...section, title: 'Phone title', summary: 'Phone words' }, 1, at);
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { topics: [restored] } } });
    expect(result.kind === 'conflict' ? result.conflicts : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['topics', 'id:opening', 'summary'] }),
      expect.objectContaining({ path: ['topics', 'id:opening', 'title'], code: expected,
        mine: { exists: true, value: 'Phone title' }, theirs: { exists: true, value: section.title } }),
    ]));
    const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/topic-title-and-summary/_topicTitleHistory/'));
    expect(history).toHaveLength(at < 60 ? 1 : 0);
  });

  it.each([
    { label: 'phone first', at: 15, winner: 'filled', kind: 'acknowledged' },
    { label: 'phone last', at: 100, winner: 'empty', kind: 'acknowledged' },
    { label: 'unknown order', at: null, winner: 'filled', kind: 'conflict' },
    { label: 'later explicit return', at: 100, winner: 'draft', kind: 'acknowledged', phoneStatus: 'draft' },
  ])('orders one group block status without replacing its separate text: $label', async ({ at, winner, kind, phoneStatus = 'empty' }) => {
    const resource = { collection: 'groups', id: 'block-status-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'opening', type: 'custom', title: 'Opening', content: 'Original words', status: 'draft', createdAt: now, updatedAt: now };
    const other = { ...block, id: 'other', title: 'Other block' };
    const templates = [block, other];
    const flow = [{ id: 'step', templateId: block.id, order: 1 }, { id: 'other-step', templateId: other.id, order: 2 }];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates, flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, next: typeof block, time: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['templates'], before: { exists: true, value: templates }, after: { exists: true, value: [next, other] } }],
      groupBlockStatusActions: [{ rowId: block.id, rowCreatedAt: block.createdAt, before: block.status,
        after: next.status, observedRevision: 1,
        time: time === null ? null : { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_004 + time } }],
    });
    const computer = { ...block, status: 'filled', content: 'Keep these later words' };
    expect((await processCommand(base.owner, edit('computer', computer, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', { ...block, status: phoneStatus }, at);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Group', flow, templates: [{ ...computer, status: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/block-status-order/_blockStatusHistory/'));
    if (at === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['templates', 'id:opening', 'status'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: block.id, field: 'status',
        value: winner === 'filled' ? phoneStatus : 'filled', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'phone first', phoneAt: 15, winner: 'Computer block', kind: 'acknowledged' },
    { label: 'phone last', phoneAt: 100, winner: 'Phone block', kind: 'acknowledged' },
    { label: 'unknown order', phoneAt: null, winner: 'Computer block', kind: 'conflict' },
    { label: 'legacy empty creation date', phoneAt: 100, winner: 'Phone block', kind: 'acknowledged', birth: '' },
  ])('orders one group block title and preserves its separate text: $label', async ({ phoneAt, winner, kind, birth }) => {
    const resource = { collection: 'groups', id: 'block-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'opening', type: 'custom', title: 'Opening', content: 'Original words', status: 'draft', createdAt: birth ?? now, updatedAt: now };
    const other = { ...block, id: 'other', title: 'Other block' };
    const templates = [block, other];
    const flow = [{ id: 'step', templateId: block.id, order: 1 }, { id: 'other-step', templateId: other.id, order: 2 }];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates, flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof templates, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['templates'], before: { exists: true, value: templates }, after: { exists: true, value: after } }],
      groupBlockTitleActions: [{ rowId: block.id, rowCreatedAt: block.createdAt, before: block.title,
        after: after[0].title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    const computer = [{ ...block, title: 'Computer block', content: 'Keep these later words' }, other];
    expect((await processCommand(base.owner, edit('computer', computer, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', [{ ...block, title: 'Phone block' }, other], phoneAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Group', flow, templates: [{ ...computer[0], title: winner }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/block-title-order/_blockTitleHistory/'));
    if (phoneAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['templates', 'id:opening', 'title'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: block.id, field: 'title',
        value: winner === 'Computer block' ? 'Phone block' : 'Computer block', winnerValue: winner }] });
    }
  });

  it.each([
    { label: 'earlier name', phoneAt: 15, phoneTitle: 'Phone step', expected: 'Computer step', kind: 'acknowledged' },
    { label: 'later name', phoneAt: 100, phoneTitle: 'Phone step', expected: 'Phone step', kind: 'acknowledged' },
    { label: 'later clear', phoneAt: 100, phoneTitle: null, expected: undefined, kind: 'acknowledged' },
    { label: 'unknown clear', phoneAt: null, phoneTitle: null, expected: 'Computer step', kind: 'conflict' },
  ])('orders a group step title separately from the block title: $label', async ({ phoneAt, phoneTitle, expected, kind }) => {
    const resource = { collection: 'groups', id: 'step-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'block', type: 'custom', title: 'Block name', content: 'Keep words', status: 'draft', createdAt: now, updatedAt: now };
    const step = { id: 'step', templateId: block.id, order: 1 };
    const other = { ...step, id: 'other', order: 2 };
    const opening = { ...step, instanceTitle: 'Original step' };
    const flow = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates: [block], flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof step & { instanceTitle?: string; durationMin?: number }, title: string | null, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['flow'], before: { exists: true, value: flow }, after: { exists: true, value: [after, other] } }],
      groupStepTitleActions: [{ rowId: step.id, rowCreatedAt: step.templateId, before: opening.instanceTitle,
        after: title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
    });
    const computer = { ...step, instanceTitle: 'Computer step', durationMin: 15 };
    expect((await processCommand(base.owner, edit('computer', computer, computer.instanceTitle, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', phoneTitle === null ? step : { ...step, instanceTitle: phoneTitle }, phoneTitle, phoneAt);
    const answer = await processCommand(base.owner, phone);
    const final = { ...step, durationMin: 15, ...(expected !== undefined && { instanceTitle: expected }) };
    expect(answer).toMatchObject({ kind, snapshot: { value: { templates: [block], flow: [final, other] } } });
    if ('snapshot' in answer) expect((answer.snapshot.value?.flow as Array<Record<string, unknown>>)[0]).toEqual(final);
    if (phoneAt === null) expect(answer).toMatchObject({ conflicts: [{ path: ['flow', 'id:step', 'instanceTitle'] }] });
  });

  it.each(['block', 'step'] as const)('protects the returned group %s title from an old request', async scope => {
    const resource = { collection: 'groups', id: 'returned-group-title' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'block', type: 'custom', title: 'Block title', content: 'Original words', status: 'draft', createdAt: now, updatedAt: now };
    const step = { id: 'step', templateId: block.id, order: 1, instanceTitle: 'Step title', instanceNotes: 'Original notes' };
    const neighbor = { ...step, id: 'neighbor', order: 2, instanceTitle: 'Neighboring step' };
    const field = scope === 'block' ? 'templates' : 'flow';
    const leaf = scope === 'block' ? 'title' : 'instanceTitle';
    const key = scope === 'block' ? 'groupBlockTitleActions' : 'groupStepTitleActions';
    const first = scope === 'block' ? block : step;
    const openingTitle = scope === 'block' ? block.title : step.instanceTitle;
    const birth = scope === 'block' ? block.createdAt : step.templateId;
    const changes = scope === 'block' ? { content: 'Independent saved words' } : { instanceNotes: 'Independent saved notes' };
    const rows = (value: typeof first) => scope === 'block' ? [value] : [value, neighbor];
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now,
        templates: [block], flow: [step, neighbor] },
    })).toMatchObject({ kind: 'acknowledged' });

    const edit = (operationId: string, before: typeof first, after: typeof first, action?: { before: string; after: string; observedRevision: number }) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: [field], before: { exists: true, value: rows(before) }, after: { exists: true, value: rows(after) } }],
      ...(action && { [key]: [{ rowId: first.id, rowCreatedAt: birth, ...action, time: null }] }),
    });
    const temporaryTitle = 'Temporary title';
    const changed = { ...first, [leaf]: temporaryTitle };
    const restored = { ...first, ...changes };
    expect(await processCommand(base.owner, edit('change', first, changed, { before: openingTitle, after: temporaryTitle, observedRevision: 1 })))
      .toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, edit('return', changed, restored, { before: temporaryTitle, after: openingTitle, observedRevision: 2 })))
      .toMatchObject({ kind: 'acknowledged' });
    const delayedTitle = 'Delayed title';
    const delayed = edit('delayed', first, { ...first, [leaf]: delayedTitle });
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({
      kind: 'conflict', snapshot: { value: { [field]: rows(restored) } },
      conflicts: [{ path: [field, 'id:' + first.id, leaf], mine: { value: delayedTitle }, theirs: { value: openingTitle } }],
    });
    expect(await processCommand(base.owner, delayed)).toEqual(result);
    const observedRevision = result.kind === 'conflict' ? result.snapshot.metadata!.revision : 0;
    const chosen = { ...restored, [leaf]: delayedTitle };
    expect(await processCommand(base.owner, edit('choice', restored, chosen, { before: openingTitle, after: delayedTitle, observedRevision })))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { [field]: rows(chosen) } } });
  });

  it.each([
    { at: 20, order: 'earlier', marker: 'group-flow-text-settled' },
    { at: 80, order: 'later', marker: 'group-flow-text-queued' },
  ])('reports $order text separately when a group block name needs comparison', async ({ at, marker }) => {
    const resource = { collection: 'groups', id: 'group-title-and-content' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'block', type: 'custom', title: 'Opening title', content: 'Opening words', status: 'draft', createdAt: now, updatedAt: now };
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now,
        templates: [opening], flow: [{ id: 'step', templateId: opening.id, order: 1 }] },
    })).toMatchObject({ kind: 'acknowledged' });
    const edit = (operationId: string, before: typeof opening, after: typeof opening, changedAt?: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['templates'], before: { exists: true, value: [before] }, after: { exists: true, value: [after] } }],
      ...(changedAt !== undefined && { groupBlockContentActions: [{ rowId: opening.id, rowCreatedAt: opening.createdAt, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + changedAt, latestMs: 1_800_000_000_010 + changedAt } }] }),
    });
    const temporary = { ...opening, title: 'Temporary title', content: 'Desktop words' };
    const restored = { ...temporary, title: opening.title };
    expect(await processCommand(base.owner, edit('desktop', opening, temporary, 40))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, edit('return-title', temporary, restored))).toMatchObject({ kind: 'acknowledged' });
    const delayed = edit('phone', opening, { ...opening, title: 'Phone title', content: 'Phone words' }, at);
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { templates: [restored] } } });
    expect(result.kind === 'conflict' ? result.conflicts : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['templates', 'id:block', 'title'] }),
      expect.objectContaining({ path: ['templates', 'id:block', 'content'], code: marker,
        mine: { exists: true, value: 'Phone words' }, theirs: { exists: true, value: 'Desktop words' } }),
    ]));
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-title-and-content/_blockContentHistory/'));
    expect(history).toHaveLength(at < 40 ? 1 : 0);
    expect(await processCommand(base.owner, delayed)).toEqual(result);
  });

  it.each([
    { label: 'earlier number', at: 15, phoneMinutes: 24, expected: 40, kind: 'acknowledged' },
    { label: 'later number', at: 100, phoneMinutes: 24, expected: 24, kind: 'acknowledged' },
    { label: 'later clear', at: 100, phoneMinutes: null, expected: null, kind: 'acknowledged' },
    { label: 'explicit return to the opening duration', at: 100, phoneMinutes: 15, expected: 15, kind: 'acknowledged' },
    { label: 'unknown clear', at: null, phoneMinutes: null, expected: 40, kind: 'conflict' },
    { label: 'later zero over a missing legacy duration', at: 100, phoneMinutes: 0, expected: 0, kind: 'acknowledged', legacyMissing: true },
  ])('orders one group step duration while keeping adjacent work: $label', async ({ at, phoneMinutes, expected, kind, legacyMissing }) => {
    const resource = { collection: 'groups', id: 'step-duration-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const block = { id: 'block', type: 'custom', title: 'Block name', content: 'Keep words', status: 'draft', createdAt: now, updatedAt: now };
    const step = { id: 'step', templateId: block.id, order: 1, durationMin: 15 };
    const other = { ...step, id: 'other', order: 2, durationMin: 7 };
    const flow = [step, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', createdAt: now, updatedAt: now, templates: [block], flow },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: Omit<typeof step, 'durationMin'> & { durationMin?: number | null; instanceTitle?: string }, time: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['flow'], before: { exists: true, value: flow }, after: { exists: true, value: [after, other] } }],
      groupStepDurationActions: [{ rowId: step.id, rowCreatedAt: step.templateId, before: step.durationMin,
        after: after.durationMin ?? null, observedRevision: 1,
        time: time === null ? null : { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_004 + time } }],
    });
    const { durationMin: _duration, ...stepWithoutDuration } = step;
    const computer = { ...stepWithoutDuration, ...(!legacyMissing && { durationMin: 40 }), instanceTitle: 'Keep this label' };
    expect((await processCommand(base.owner, edit('computer', computer, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', { ...step, durationMin: phoneMinutes }, at);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { templates: [block], flow: [{ ...computer, durationMin: expected }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/step-duration-order/_stepDurationHistory/'));
    if (at === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['flow', 'id:step', 'durationMin'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: step.id, field: 'durationMin',
        value: expected === 40 ? phoneMinutes : computer.durationMin ?? null, winnerValue: expected }] });
    }
  });

  it.each([
    { label: 'earlier', at: 15, kind: 'acknowledged', winner: 'Opening words' },
    { label: 'later', at: 100, kind: 'acknowledged', winner: 'Offline words' },
    { label: 'uncertain', at: null, kind: 'conflict', winner: 'Opening words' },
    { label: 'legacy request', at: undefined, kind: 'conflict', winner: 'Opening words' },
    { label: 'earlier with an empty legacy opening', at: 15, kind: 'acknowledged', winner: '', missing: true },
  ])('orders a service step body after a return to its opening: $label', async ({ at, kind, winner, missing }) => {
    const resource = { collection: 'serviceOrders', id: 'step-body-return' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: 'Opening', scriptureRefs: [], ...(missing ? {} : { body: 'Opening words' }) };
    const other = { id: 'other', title: 'Prayer', body: 'Other step words', flagged: true };
    const initial = [opening, other];
    const computerEdit = [{ ...opening, body: 'Computer words', title: 'Independent title' }, other];
    const restored = [{ ...computerEdit[0], body: opening.body ?? '' }, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof initial, after: typeof initial, observedRevision: number, time: number | null | undefined) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      ...(time !== undefined && { serviceOrderStepBodyActions: [{ rowId: opening.id, rowCreatedAt: opening.id, observedRevision,
        time: time === null ? null : { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_004 + time } }] }),
    });
    expect((await processCommand(base.owner, edit('computer', initial, computerEdit, 1, 55))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('restore', computerEdit, restored, 2, 75))).kind).toBe('acknowledged');
    const command = edit('offline', initial, [{ ...opening, body: 'Offline words' }, other], 1, at);
    const answer = await processCommand(base.owner, command);
    expect(answer).toMatchObject({ kind, snapshot: { value: { steps: [{ ...restored[0], body: winner }, other] } } });
    if (kind === 'conflict') expect(answer).toMatchObject({ conflicts: [{ path: ['steps', 'id:opening', 'body'] }] });
    expect(await processCommand(base.owner, command)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/step-body-return/_stepBodyHistory/'));
    if (kind === 'conflict') {
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{
        rowId: opening.id, field: 'body', value: at === 100 ? 'Opening words' : 'Offline words', winnerDigest: expect.any(String),
      }] });
    }
  });

  it.each([
    { label: 'earlier', mobileAt: 15, title: 'Computer opening', kind: 'acknowledged' },
    { label: 'later', mobileAt: 100, title: 'Phone opening', kind: 'acknowledged' },
    { label: 'unclocked', mobileAt: null, title: 'Computer opening', kind: 'conflict' },
    { label: 'earlier before clear', mobileAt: 15, title: '', kind: 'acknowledged', computerTitle: '' },
    { label: 'later with a legacy long title', mobileAt: 100, title: 'Phone opening', kind: 'acknowledged', openingTitle: 'X'.repeat(501) },
  ])('orders the exact service step title and keeps the body: $label', async ({
    mobileAt, title, kind, computerTitle = 'Computer opening', openingTitle = 'Opening',
  }) => {
    const resource = { collection: 'serviceOrders', id: 'step-title-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: openingTitle, body: 'Original words', scriptureRefs: [], flagged: false };
    const other = { ...opening, id: 'other', title: 'Prayer', flagged: true };
    const initial = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof initial, at: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: initial }, after: { exists: true, value: after } }],
      serviceOrderStepTitleActions: { title: { rowId: opening.id, rowCreatedAt: opening.id, before: opening.title,
        after: after[0].title, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const desktop = [{ ...opening, title: computerTitle, body: 'Later words on desktop' }, other];
    expect((await processCommand(base.owner, edit('desktop', desktop, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', [{ ...opening, title: 'Phone opening' }, other], mobileAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { title: 'Sunday', steps: [{ ...desktop[0], title }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/step-title-order/_stepTitleHistory/'));
    if (mobileAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['steps', 'id:opening', 'title'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      const displaced = { rowId: opening.id, field: 'title', value: title === computerTitle ? 'Phone opening' : computerTitle, winnerValue: title };
      expect(history[0][1]).toMatchObject({ fields: [displaced] });
      await expect(listServiceOrderStepTitleHistory(base.owner, resource.id, 'seed')).resolves.toMatchObject({
        owner: base.owner, orderId: resource.id, generation: 'seed', entries: [{ fields: [displaced] }],
      });
      await expect(listServiceOrderStepTitleHistory('other-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderStepTitleHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    }
  });

  it.each([
    { label: 'legacy', time: undefined },
    { label: 'without an action clock', time: null },
  ])('keeps the returned service step title for a delayed rename $label', async ({ time }) => {
    const resource = { collection: 'serviceOrders', id: 'step-title-return' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: 'Opening', body: 'Old words', scriptureRefs: [] };
    const other = { ...opening, id: 'closing', title: 'Closing', body: 'Another step' };
    const temporary = { ...opening, title: 'Temporary name' };
    const restored = { ...opening, body: 'Independent saved words' };
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: [opening, other] },
    })).toMatchObject({ kind: 'acknowledged' });
    const rename = (operationId: string, before: typeof opening, after: typeof opening, observedRevision: number, time?: null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: [before, other] }, after: { exists: true, value: [after, other] } }],
      ...(time !== undefined && { serviceOrderStepTitleActions: { title: { rowId: opening.id, rowCreatedAt: opening.id,
        before: before.title, after: after.title, observedRevision, time } } }),
    });
    expect(await processCommand(base.owner, rename('computer', opening, temporary, 1, null))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, rename('return', temporary, restored, 2, null))).toMatchObject({ kind: 'acknowledged' });
    const delayed = rename('phone', opening, { ...opening, title: 'Old offline title' }, 1, time);
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { steps: [restored, other] } },
      conflicts: [{ path: ['steps', 'id:opening', 'title'], mine: { value: 'Old offline title' }, theirs: { value: opening.title } }],
    });
    expect(await processCommand(base.owner, delayed)).toEqual(result);
    const currentRevision = result.kind === 'conflict' ? result.snapshot.metadata!.revision : 0;
    const chosen = { ...restored, title: 'Old offline title' };
    expect(await processCommand(base.owner, rename('explicit-choice', restored, chosen, currentRevision, null)))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [chosen, other] } } });
  });

  it.each([
    { order: 'an earlier', time: 20, expected: 'acknowledged' },
    { order: 'a later', time: 60, expected: 'conflict' },
    { order: 'an unclocked', time: null, expected: 'conflict' },
    { order: 'a legacy', time: undefined, expected: 'conflict' },
  ])('protects a service step title from a legacy rename after $order same-title edit', async ({ time, expected }) => {
    const resource = { collection: 'serviceOrders', id: 'step-title-reaffirmed' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: 'Original', body: 'Opening prayer', scriptureRefs: [] };
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: [opening] },
    })).toMatchObject({ kind: 'acknowledged' });
    const rename = (operationId: string, before: string, after: string, time?: number | null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: [{ ...opening, title: before }] },
        after: { exists: true, value: [{ ...opening, title: after }] } }],
      ...(time !== undefined && { serviceOrderStepTitleActions: { title: {
        rowId: opening.id, rowCreatedAt: opening.id, before, after, observedRevision: 1,
        time: time === null ? null : { earliestMs: 1_800_000_000_000 + time, latestMs: 1_800_000_000_010 + time },
      } } }),
    });
    expect(await processCommand(base.owner, rename('first', opening.title, 'Same title', 40))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, rename('same-title', opening.title, 'Same title', time))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, rename('legacy', 'Same title', 'Queued title'))).toMatchObject({
      kind: expected, snapshot: { value: { steps: [{ ...opening, title: expected === 'conflict' ? 'Same title' : 'Queued title' }] } },
    });
  });

  describe.each(['sermons', 'serviceOrders'] as const)('delayed addition from an empty list in %s', collection => {
    it.each([
      { label: 'earlier addition of the replaced item', phoneAt: 12, replace: true, expected: 'saved', kind: 'acknowledged' },
      { label: 'addition of the replaced item without an action clock', phoneAt: null, replace: true, expected: 'saved', kind: 'conflict' },
      { label: 'later addition of the replaced item', phoneAt: 100, replace: true, expected: 'both', kind: 'acknowledged' },
      { label: 'independent additions from the same empty opening', phoneAt: 12, replace: false, expected: 'both', kind: 'acknowledged' },
      { label: 'an earlier addition after another item was added', phoneAt: 12, replace: true, extra: true, expected: 'saved', kind: 'acknowledged' },
      { label: 'an unknown addition after another item was added', phoneAt: null, replace: true, extra: true, expected: 'saved', kind: 'conflict' },
      { label: 'later re-addition before the removal of a different item', phoneAt: 100, replace: true, clear: true, expected: 'both', kind: 'acknowledged' },
      { label: 'an unclocked reaffirmation after a timed removal', phoneAt: 100, replace: true, reaffirm: true, expected: 'saved', kind: 'conflict' },
      { label: 'an explicit review from an old opening with a long row ID', phoneAt: null, replace: true, clear: true, longId: true, expected: 'saved', kind: 'conflict' },
      { label: 'one known re-addition cannot bypass evicted evidence for another', phoneAt: 50, replace: true, overflow: true, expected: 'saved', kind: 'conflict' },
      { label: 'a separate conflict exposes the safely projected independent addition', phoneAt: 12, replace: true, partial: true, expected: 'saved', kind: 'conflict' },
    ])('retains the right words for $label', async ({ phoneAt, replace, extra, clear, reaffirm, longId, overflow, partial, expected, kind }) => {
      const sermon = collection === 'sermons';
      const resource = { collection, id: 'delayed-list-addition' };
      const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
      const now = '2026-11-10T00:00:00.000Z';
      const rowId = longId ? 'r'.repeat(129) : 'reading';
      const [added, replacement] = sermon ? ['mercy', 'peace'] : ['John 3:17', 'John 3:18'];
      const path = sermon ? 'preparation' : 'steps';
      const content = (items: string[]) => sermon
        ? { textContext: { repeatedWords: items, contextNotes: 'Independent context' } }
        : [{ id: rowId, title: 'Reading', body: 'Independent words', scriptureRefs: items }];
      const seed = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
        value: { userId: base.owner, title: 'Delayed list addition', createdAt: now, updatedAt: now, [path]: content([]),
          ...(sermon ? { verse: 'John 3:16', date: now, thoughts: [] } : { rank: 100 }) },
      });
      expect(seed.kind).toBe('acknowledged');
      const update = (operationId: string, before: string[], after: string[], observedRevision: number, offset: number | null) => {
        const action = { observedRevision, time: offset === null ? null
          : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } };
        return { ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: [path], before: { exists: true, value: content(before) }, after: { exists: true, value: content(after) } }],
          ...(sermon ? { sermonRepeatedWordsAction: action }
            : { serviceOrderStepScriptureActions: { scriptureRefs: { ...action, rowId, rowCreatedAt: rowId, before, after } } }),
        };
      };
      expect(await processCommand(base.owner, update('computer-first', [], [replace ? added : replacement], 1, 40)))
        .toMatchObject({ kind: 'acknowledged' });
      if (replace) {
        expect(await processCommand(base.owner, update('computer-replaces', [added], [replacement], 2, 70)))
          .toMatchObject({ kind: 'acknowledged', snapshot: { value: { [path]: content([replacement]) } } });
      }
      if (reaffirm) {
        expect(await processCommand(base.owner, update('computer-reaffirms', [added], [replacement], 2, null)))
          .toMatchObject({ kind: 'acknowledged' });
      }
      const independent = sermon ? 'hope' : 'John 3:19';
      const saved = clear || overflow ? [] : extra ? [replacement, independent] : [replacement];
      if (overflow) {
        const many = [replacement, ...Array.from({ length: 33 }, (_, index) => 'Other item ' + index)];
        for (const request of [update('add-many', [replacement], many, 3, null),
          update('remove-many', many, [replacement], 4, null), update('clear-replacement', [replacement], [], 5, 40)]) {
          expect(await processCommand(base.owner, request)).toMatchObject({ kind: 'acknowledged' });
        }
      }
      if (clear) {
        expect(await processCommand(base.owner, update('computer-clears-replacement', [replacement], [], 3, 110)))
          .toMatchObject({ kind: 'acknowledged' });
      }
      if (extra) {
        expect(await processCommand(base.owner, update('computer-adds-other', [replacement], saved, 3, null)))
          .toMatchObject({ kind: 'acknowledged' });
      }
      const proposed = overflow ? [added, replacement] : partial ? [added, independent] : [added];
      const phone = update('delayed-phone', [], proposed, 1, phoneAt);
      const titleChange = (after: string) => ({ path: ['title'], before: { exists: true, value: 'Delayed list addition' },
        after: { exists: true, value: after } });
      if (partial) {
        const title = update('computer-title', [replacement], [replacement], 3, null);
        expect(await processCommand(base.owner, { ...title, changes: [titleChange('Stored title')] })).toMatchObject({ kind: 'acknowledged' });
      }
      const delayed = partial ? { ...phone, changes: [...phone.changes, titleChange('Own title')] } : phone;
      const reply = await processCommand(base.owner, delayed);
      expect(reply.kind).toBe(kind);
      expect(await readDocument(base.owner, resource)).toMatchObject({
        value: { [path]: content(expected === 'both' ? [...saved, added] : saved) },
      });
      if (kind === 'conflict') expect(reply).toMatchObject({ conflicts: expect.arrayContaining([{
        path: sermon ? ['preparation', 'textContext', 'repeatedWords'] : ['steps', 'id:' + rowId, 'scriptureRefs'],
        code: partial ? 'authored-list-projection' : 'authored-list-review', base: { exists: true, value: [] },
        mine: { exists: true, value: partial ? [replacement, independent] : proposed }, theirs: { exists: true, value: saved },
      }]) });
      expect(await processCommand(base.owner, delayed)).toEqual(reply);
      if (longId) {
        expect(await processCommand(base.owner, update('reviewed-choice', [], [added], 4, null)))
          .toMatchObject({ kind: 'acknowledged', snapshot: { value: { [path]: content([added]) } } });
      }
    });
  });

  it.each(['empty', 'nonempty', 'intervening update'] as const)('accepts an explicit comparison covering two replaced Scripture lists (%s)', async scenario => {
    const nonempty = scenario !== 'empty';
    const resource = { collection: 'serviceOrders', id: 'review-two-scripture-lists' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const opening = [{ id: 'reading', title: 'Reading', body: 'Read aloud', scriptureRefs: [] as string[] },
      { id: 'closing', title: 'Closing', body: 'Pray together', scriptureRefs: [] as string[] }];
    const added = opening.map((row, index) => ({ ...row, scriptureRefs: [index === 0 ? 'John 3:17' : 'Psalm 23:1'] }));
    const stored = opening.map((row, index) => ({ ...row, body: row.body + ' slowly',
      scriptureRefs: nonempty ? [index === 0 ? 'John 3:18' : 'Psalm 23:2'] : [] }));
    const update = (operationId: string, before: typeof opening, after: typeof opening) => ({
      ...base, kind: 'update', operationId, generation: 'seed', changes: [{ path: ['steps'],
        before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Service', rank: 100, createdAt: now, updatedAt: now, steps: opening },
    })).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, update('add', opening, added))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, update('replace', added, stored))).toMatchObject({ kind: 'acknowledged' });
    if (nonempty) {
      const other = stored.map(row => ({ ...row, scriptureRefs: ['Mark 1:1'] }));
      expect(await processCommand(base.owner, update('other', stored, other))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(base.owner, update('return', other, stored))).toMatchObject({ kind: 'acknowledged' });
    }
    const revision = nonempty ? 5 : 3;
    expect(await processCommand(base.owner, update('delayed', opening, added))).toMatchObject({ kind: 'conflict',
      snapshot: { metadata: { revision }, value: { steps: stored } },
      conflicts: opening.map(row => ({ code: 'authored-list-review', path: ['steps', 'id:' + row.id, 'scriptureRefs'] })),
    });
    const chosen = stored.map((row, index) => ({ ...row, scriptureRefs: added[index].scriptureRefs }));
    const reviewed = stored.map((row, index) => ({ rowId: row.id, rowCreatedAt: row.id, observedRevision: revision,
      before: row.scriptureRefs, after: chosen[index].scriptureRefs, time: null }));
    if (scenario === 'intervening update') {
      const latest = [{ ...stored[0], scriptureRefs: ['Luke 4:1'] }, stored[1]];
      expect(await processCommand(base.owner, { ...update('newer-reading', stored, latest), serviceOrderStepScriptureActions: {
        scriptureRefs: { rowId: stored[0].id, rowCreatedAt: stored[0].id, before: stored[0].scriptureRefs, after: latest[0].scriptureRefs,
          observedRevision: revision, time: null },
      } })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(base.owner, { ...update('stale-review', stored, chosen), serviceOrderStepScriptureActions: { reviewed } }))
        .toMatchObject({ kind: 'conflict', snapshot: { value: { steps: latest } },
          conflicts: latest.map(row => ({ code: 'authored-list-review', path: ['steps', 'id:' + row.id, 'scriptureRefs'],
            theirs: { exists: true, value: row.scriptureRefs } })),
        });
      expect(await processCommand(base.owner, { ...update('fresh-review', latest, chosen), serviceOrderStepScriptureActions: {
        reviewed: reviewed.map((action, index) => ({ ...action, before: latest[index].scriptureRefs, observedRevision: revision + 1 })),
      } })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: chosen } } });
      return;
    }
    expect(await processCommand(base.owner, { ...update('reviewed', stored, chosen), serviceOrderStepScriptureActions: { reviewed } }))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: chosen } } });
  });

  it.each([
    { label: 'two replacements', stored: ['John 3:18'], incoming: ['John 3:17'], kind: 'conflict', expected: ['John 3:18'] },
    { label: 'a replacement and a clear', stored: ['John 3:18'], incoming: [], kind: 'conflict', expected: ['John 3:18'] },
    { label: 'two replacements on a legacy long step ID', stored: ['John 3:18'], incoming: ['John 3:17'],
      kind: 'conflict', expected: ['John 3:18'], rowId: 'x'.repeat(129) },
    { label: 'a clear and a replacement', stored: [], incoming: ['John 3:17'], kind: 'conflict', expected: [] },
    { label: 'two additions', stored: ['John 3:16', 'John 3:18'], incoming: ['John 3:16', 'John 3:17'],
      kind: 'acknowledged', expected: ['John 3:16', 'John 3:18', 'John 3:17'] },
  ])('does not invent a service step Scripture list without action order: $label', async ({ stored, incoming, kind, expected, rowId = 'opening' }) => {
    const resource = { collection: 'serviceOrders', id: 'step-scripture-order' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const opening = { id: rowId, title: 'Scripture', body: 'Original words', scriptureRefs: ['John 3:16'], flagged: true };
    const other = { id: 'closing', title: 'Closing', scriptureRefs: ['Psalm 23:1'] };
    const before = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Service', rank: 100, createdAt: now, updatedAt: now, steps: before },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, first: typeof opening) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: before }, after: { exists: true, value: [first, other] } }],
    });
    const desktop = { ...opening, body: 'Independent words', scriptureRefs: stored };
    expect((await processCommand(base.owner, edit('computer', desktop))).kind).toBe('acknowledged');
    const answer = await processCommand(base.owner, edit('phone', { ...opening, scriptureRefs: incoming }));
    expect(answer.kind).toBe(kind);
    expect((await readDocument(base.owner, resource)).value?.steps).toEqual([{ ...desktop, scriptureRefs: expected }, other]);
    if (kind === 'conflict') expect(answer).toMatchObject({ conflicts: [{ path: ['steps', 'id:' + rowId, 'scriptureRefs'],
      base: { exists: true, value: opening.scriptureRefs }, mine: { exists: true, value: incoming },
      theirs: { exists: true, value: stored },
    }] });
  });

  it.each([
    { label: 'phone earlier', phoneAt: 20, stored: ['John 3:18'], incoming: ['John 3:17'], expected: ['John 3:18'] },
    { label: 'phone later', phoneAt: 90, stored: ['John 3:18'], incoming: ['John 3:17'], expected: ['John 3:17'] },
    { label: 'phone clears later', phoneAt: 90, stored: ['John 3:18'], incoming: [], expected: [] },
    { label: 'computer clears later', phoneAt: 20, stored: [], incoming: ['John 3:17'], expected: [] },
  ])('orders a service step Scripture replacement by action time: $label', async ({ phoneAt, stored, incoming, expected }) => {
    const resource = { collection: 'serviceOrders', id: 'step-scripture-timed' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const opening = { id: 'reading', title: 'Scripture', body: 'Original words', scriptureRefs: ['John 3:16'] };
    const other = { id: 'closing', title: 'Closing', scriptureRefs: ['Psalm 23:1'] };
    const initial = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Service', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, after: typeof opening, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: initial }, after: { exists: true, value: [after, other] } }],
      serviceOrderStepScriptureActions: { scriptureRefs: { rowId: opening.id, rowCreatedAt: opening.id, before: opening.scriptureRefs,
        after: after.scriptureRefs, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const desktop = { ...opening, body: 'Independent words', scriptureRefs: stored };
    expect((await processCommand(base.owner, edit('computer', desktop, 65))).kind).toBe('acknowledged');
    const phone = edit('phone', { ...opening, scriptureRefs: incoming }, phoneAt);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [{ ...desktop, scriptureRefs: expected }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/step-scripture-timed/_stepScriptureHistory/'));
    const displaced = phoneAt < 65 ? incoming : stored;
    expect(history).toHaveLength(1);
    expect(history[0][1]).toMatchObject({ fields: [{ rowId: opening.id, field: 'scriptureRefs', value: displaced, winnerValue: expected }] });
  });

  it.each([false, true])('merges two service step Scripture additions on an older omitted field (clocked: %s)', async clocked => {
    const resource = { collection: 'serviceOrders', id: 'step-scripture-legacy-empty' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const opening = { id: 'reading', title: 'Scripture' };
    await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Service', rank: 100, createdAt: now, updatedAt: now, steps: [opening] },
    });
    const add = (operationId: string, reference: string, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: [opening] }, after: { exists: true, value: [{ ...opening, scriptureRefs: [reference] }] } }],
      ...(clocked && { serviceOrderStepScriptureActions: { scriptureRefs: { rowId: opening.id, rowCreatedAt: opening.id, before: [],
        after: [reference], observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } } }),
    });
    expect((await processCommand(base.owner, add('computer', 'John 3:16', 65))).kind).toBe('acknowledged');
    const phone = await processCommand(base.owner, add('phone', 'Psalm 23:1', 90));
    expect(phone).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { steps: [{ ...opening, scriptureRefs: ['John 3:16', 'Psalm 23:1'] }] } } });
  });

  it.each([{ different: ['John 3:18'] }, { different: ['John 3:16', 'John 3:18'] }])('does not revive an old service step Scripture edit after a return through %j', async ({ different }) => {
    const resource = { collection: 'serviceOrders', id: 'step-scripture-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const opening = { id: 'reading', title: 'Scripture', scriptureRefs: ['John 3:16'] };
    await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Service', rank: 100, createdAt: now, updatedAt: now, steps: [opening] },
    });
    const edit = (operationId: string, before: string[], after: string[]) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: [{ ...opening, scriptureRefs: before }] },
        after: { exists: true, value: [{ ...opening, scriptureRefs: after }] } }],
    });
    const initial = opening.scriptureRefs;
    expect((await processCommand(base.owner, edit('replace', initial, different))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('return', different, initial))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, edit('late-old-copy', initial, ['John 3:17']))).toMatchObject({ kind: 'conflict',
      conflicts: [{ path: ['steps', 'id:reading', 'scriptureRefs'], theirs: { exists: true, value: initial } }] });
    expect((await readDocument(base.owner, resource)).value?.steps).toEqual([opening]);
  });

  it('reviews an old service step Scripture replacement after its return evidence was evicted', async () => {
    const resource = { collection: 'serviceOrders', id: 'step-scripture-eviction' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const legacy = { id: 'x'.repeat(129), title: 'Older step', scriptureRefs: ['John 3:16'] };
    const initial = [...Array.from({ length: 33 }, (_, index) => ({ id: 'step-' + index, title: 'Reading', scriptureRefs: ['John 3:16'] })), legacy];
    await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Service', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    });
    const edit = (operationId: string, before: typeof initial, after: typeof initial) => processCommand(base.owner, {
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const changeFirst = (reference: string) => [{ ...initial[0], scriptureRefs: [reference] }, ...initial.slice(1)];
    const replaced = changeFirst('John 3:18');
    expect((await edit('replace', initial, replaced)).kind).toBe('acknowledged');
    expect((await edit('return', replaced, initial)).kind).toBe('acknowledged');
    const newer = initial.map((row, index) => index > 0 && index < 33 ? { ...row, scriptureRefs: ['Psalm 23:1'] } : row);
    expect((await edit('edit-other-steps', initial, newer)).kind).toBe('acknowledged');
    const late = await edit('late-old-copy', initial, changeFirst('John 3:17'));
    expect(late).toMatchObject({ kind: 'conflict',
      conflicts: [{ path: ['steps', 'id:step-0', 'scriptureRefs'], theirs: { exists: true, value: ['John 3:16'] } }] });
    expect((await readDocument(base.owner, resource)).value?.steps).toEqual(newer);
    const longerIdEdit = [...newer.slice(0, -1), { ...legacy, scriptureRefs: ['John 3:17'] }];
    expect(await edit('old-format-long-id', newer, longerIdEdit)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { steps: longerIdEdit } } });
  });

  it('accepts the first explicit flag on an older step that omitted the optional flag', async () => {
    const resource = { collection: 'serviceOrders', id: 'missing-flag' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const opening = { id: 'opening', title: 'Opening' };
    const now = '2026-11-08T00:00:00.000Z';
    await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: [opening] },
    });
    const answer = await processCommand(base.owner, { ...base, kind: 'update', operationId: 'mark', generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: [{ ...opening, flagged: false }] },
        after: { exists: true, value: [{ ...opening, flagged: true }] } }],
      serviceOrderFlagActions: { flagged: { rowId: opening.id, rowCreatedAt: opening.id, before: false, after: true, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_024 } } },
    });
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [{ ...opening, flagged: true }] } } });
  });

  it.each([
    { label: 'earlier', phoneAt: 15, flag: false, kind: 'acknowledged' },
    { label: 'later', phoneAt: 100, flag: true, kind: 'acknowledged' },
    { label: 'unclocked', phoneAt: null, flag: false, kind: 'conflict' },
  ])('orders a service step flag after the other device returns to the opening value: $label', async ({ phoneAt, flag, kind }) => {
    const resource = { collection: 'serviceOrders', id: 'flag-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { id: 'opening', title: 'Opening', body: 'Original words', scriptureRefs: [], flagged: false };
    const other = { ...opening, id: 'other', title: 'Prayer', flagged: true };
    const initial = [opening, other];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Sunday', rank: 100, createdAt: now, updatedAt: now, steps: initial },
    })).kind).toBe('acknowledged');
    const change = (operationId: string, before: typeof initial, after: typeof initial, at: number | null, observedRevision: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['steps'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      serviceOrderFlagActions: { flagged: { rowId: opening.id, rowCreatedAt: opening.id, before: before[0].flagged,
        after: after[0].flagged, observedRevision, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } },
    });
    const marked = [{ ...opening, flagged: true }, other];
    expect((await processCommand(base.owner, change('desktop-on', initial, marked, 40, 1))).kind).toBe('acknowledged');
    const unmarked = [{ ...opening, body: 'Later words on desktop' }, other];
    expect((await processCommand(base.owner, change('desktop-off', marked, unmarked, 65, 2))).kind).toBe('acknowledged');
    const phone = change('phone-on', initial, marked, phoneAt, 1);
    const answer = await processCommand(base.owner, phone);
    expect(answer).toMatchObject({ kind, snapshot: { value: { steps: [{ ...unmarked[0], flagged: flag }, other] } } });
    expect(await processCommand(base.owner, phone)).toEqual(answer);
    const history = [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/flag-round-trip/_stepFlagHistory/'));
    if (phoneAt === null) {
      expect(answer).toMatchObject({ conflicts: [{ path: ['steps', 'id:opening', 'flagged'] }] });
      expect(history).toHaveLength(0);
    } else {
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ fields: [{ rowId: opening.id, field: 'flagged', value: !flag, winnerValue: flag }] });
      await expect(listServiceOrderFlagHistory(base.owner, resource.id, 'seed')).resolves.toMatchObject({
        owner: base.owner, orderId: resource.id, generation: 'seed', entries: [{ fields: [{ rowId: opening.id, value: !flag, winnerValue: flag }] }],
      });
      await expect(listServiceOrderFlagHistory('other-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderFlagHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    }
  });

  it('does not guess when a meeting date proof was evicted after a return to the same date', async () => {
    const resource = { collection: 'groups', id: 'evicted-meeting-proof' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const rows = Array.from({ length: 34 }, (_, index) => ({ id: 'meeting-' + index, date: '2026-12-13', createdAt: now }));
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', flow: [], templates: [], meetingDates: rows, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, before: typeof rows, after: typeof rows) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['meetingDates'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const unset = [{ ...rows[0], date: '' }, ...rows.slice(1)];
    expect((await processCommand(base.owner, edit('unset', rows, unset))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, edit('return', unset, rows))).kind).toBe('acknowledged');
    const changed = [rows[0], ...rows.slice(1).map(row => ({ ...row, date: '2026-12-27' }))];
    expect((await processCommand(base.owner, edit('other-rows', rows, changed))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, { ...edit('offline', rows, [{ ...rows[0], date: '2026-12-20' }, ...rows.slice(1)]),
      meetingDateAction: { rowId: rows[0].id, before: rows[0].date, after: '2026-12-20', observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } },
    })).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([expect.objectContaining({ path: ['meetingDates', 'id:meeting-0', 'date'] })]),
      snapshot: { value: { meetingDates: changed } } });
  });

  it.each([
    { offset: 20, expected: 'completed', lost: 'active', kind: 'acknowledged' },
    { offset: 60, expected: 'active', lost: 'completed', kind: 'acknowledged' },
    { offset: 45, expected: 'completed', lost: null, kind: 'conflict' },
  ])('orders only the exact group status at offset $offset', async ({ offset, expected, lost, kind }) => {
    const resource = { collection: 'groups', id: 'group-status' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original title', description: 'Original notes', status: 'draft',
      templates: [], flow: [], meetingDates: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const change = (operationId: string, after: string, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['status'], before: { exists: true, value: 'draft' }, after: { exists: true, value: after } }],
      groupStatusAction: { before: 'draft', after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
    });
    const desk = change('desk', 'completed', 40);
    expect((await processCommand(base.owner, { ...desk, changes: [...desk.changes,
      { path: ['description'], before: { exists: true, value: value.description }, after: { exists: true, value: 'Independent notes' } }],
    })).kind).toBe('acknowledged');
    const phone = change('phone', 'active', offset);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind, snapshot: { value: { status: expected, title: value.title, description: 'Independent notes', meetingDates: [] } } });
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-status/_statusHistory/'));
    expect(history).toHaveLength(lost === null ? 0 : 1);
    if (lost !== null) {
      expect(history[0][1]).toMatchObject({ status: lost, winnerStatus: expected, generation: 'seed' });
      expect(await listGroupStatusHistory(base.owner, resource.id, 'seed')).toMatchObject({
        owner: base.owner, groupId: resource.id, generation: 'seed', entries: [{ status: lost, winnerStatus: expected }],
      });
      await expect(listGroupStatusHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listGroupStatusHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, phone)).toEqual(result);
      expect([...documents.keys()].filter(path => path.startsWith('groups/group-status/_statusHistory/'))).toHaveLength(1);
    }
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['status'] }] });
  });

  it.each([false, true])('holds a legacy group status after returning to Draft (reaffirm=%s)', async reaffirm => {
    const resource = { collection: 'groups', id: 'group-status-return' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original title', description: 'Original notes', status: 'draft',
      templates: [], flow: [], meetingDates: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const field = (value: string) => ({ exists: true, value });
    const change = (operationId: string, before: string, after: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['status'], before: field(before), after: field(after) }],
    });
    if (!reaffirm) expect((await processCommand(base.owner, change('activate', 'draft', 'active'))).kind).toBe('acknowledged');
    const returned = change('return', 'active', 'draft');
    expect((await processCommand(base.owner, { ...returned, changes: [...returned.changes,
      { path: ['description'], before: field(value.description), after: field('Desktop notes') },
    ] })).kind).toBe('acknowledged');
    const delayed = change('old-phone', 'draft', 'completed');
    const outcome = await processCommand(base.owner, delayed);
    expect(outcome).toMatchObject({
      kind: 'conflict', conflicts: [{ path: ['status'], base: field('draft'), mine: field('completed'), theirs: field('draft') }],
      snapshot: { value: { status: 'draft', description: 'Desktop notes', title: value.title } },
    });
    expect(documents.get('groups/group-status-return')).toMatchObject({ status: 'draft', description: 'Desktop notes' });
    expect(await processCommand(base.owner, delayed)).toEqual(outcome);
  });

  it('can compare a conflicting step removal separately from an already ordered group status', async () => {
    const resource = { collection: 'groups', id: 'group-status-and-flow' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const template = { id: 'block', type: 'custom', title: 'Block', content: 'Notes', status: 'draft', createdAt: now, updatedAt: now };
    const flow = (ids: string[]) => ids.map((id, index) => ({ id, templateId: template.id, order: index + 1 }));
    const opening = flow(['a', 'b', 'c', 'd']);
    const field = <T,>(value: T) => ({ exists: true, value });
    const seed = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Group', status: 'draft', templates: [template], flow: opening,
        meetingDates: [], createdAt: now, updatedAt: now } });
    expect(seed).toMatchObject({ kind: 'acknowledged' });
    const change = (operationId: string, after: string, rows: typeof opening, at: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['status'], before: field('draft'), after: field(after) },
        { path: ['flow'], before: field(opening), after: field(rows) }],
      groupStatusAction: { before: 'draft', after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
    });
    const revised = opening.map(row => row.id === 'a' ? { ...row, durationMin: 5 } : row);
    expect((await processCommand(base.owner, change('desktop', 'active', revised, 80))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, change('phone', 'completed', flow(['b', 'c', 'd']), 20))).toMatchObject({
      kind: 'conflict',
      conflicts: [{ path: ['flow', 'id:a'] }],
      snapshot: { value: { status: 'active' } },
    });
  });

  it('orders the status and title in one group command by their different action times', async () => {
    const resource = { collection: 'groups', id: 'group-fields' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original title', status: 'draft', templates: [], flow: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const stamp = (before: string, after: string, at: number) => ({
      before, after, observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at },
    });
    const change = (operationId: string, title: string, status: string, titleAt: number, statusAt: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [
        { path: ['title'], before: { exists: true, value: value.title }, after: { exists: true, value: title } },
        { path: ['status'], before: { exists: true, value: value.status }, after: { exists: true, value: status } },
      ],
      groupTitleAction: stamp(value.title, title, titleAt),
      groupStatusAction: stamp(value.status, status, statusAt),
    });
    expect((await processCommand(base.owner, change('desk', 'Desk title', 'completed', 40, 45))).kind).toBe('acknowledged');
    expect(await processCommand(base.owner, change('phone', 'Phone title', 'active', 70, 20))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { title: 'Phone title', status: 'completed' } },
    });
    expect(await listGroupStatusHistory(base.owner, resource.id, 'seed')).toMatchObject({ entries: [{ status: 'active', winnerStatus: 'completed' }] });
    expect(await listGroupTitleHistory(base.owner, resource.id, 'seed')).toMatchObject({ entries: [{ title: 'Desk title', winnerTitle: 'Phone title' }] });
  });

  it.each([
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: 20, expected: 'Ephesians 2:8', archived: 'Romans 8:1' },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: 80, expected: 'Romans 8:1', archived: 'Ephesians 2:8' },
    { desk: 'Еф 2:8', phone: 'Рим 8:1–4', offset: 80, expected: 'Рим 8:1–4', archived: 'Еф 2:8' },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: 45, expected: 'Ephesians 2:8', archived: null },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1', offset: null, expected: 'Ephesians 2:8', archived: null },
    { desk: 'Ephesians 2:8 — Keep this note', phone: 'Romans 8:1', offset: 80, expected: 'Ephesians 2:8 — Keep this note', archived: null },
    { desk: 'Ephesians 2:8', phone: 'Romans 8:1; John 3:16', offset: 80, expected: 'Ephesians 2:8', archived: null },
    { desk: 'Ephesians 2:8', phone: 'John 3-2', offset: 80, expected: 'Ephesians 2:8', archived: null },
  ] as const)('orders a sermon passage only when the exact alternatives are standalone references ($desk / $phone / $offset)',
    async ({ desk, phone, offset, expected, archived }) => {
      const seed = create('sermon-verse-seed') as Extract<DataCommand, { kind: 'create' }>;
      const original = { ...seed.value, title: 'Opening title', verse: 'John 3:16' };
      expect((await processCommand('owner-1', { ...seed, value: original })).kind).toBe('acknowledged');
      const edit = (id: string, verse: string, at: number | null) => ({
        ...update(id, 'sermon-verse-seed'),
        changes: [{ path: ['verse'], before: { exists: true, value: original.verse }, after: { exists: true, value: verse } }],
        sermonVerseAction: { observedRevision: 1, time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
      });
      expect((await processCommand('owner-1', edit('desk', desk, 40))).kind).toBe('acknowledged');
      const request = edit('phone', phone, offset);
      const answer = await processCommand('owner-1', request);
      expect(answer).toMatchObject({ kind: archived ? 'acknowledged' : 'conflict',
        snapshot: { value: { verse: expected, title: original.title } } });
      if (!archived) expect(answer).toMatchObject({ conflicts: [{ path: ['verse'] }] });
      const history = () => [...documents.entries()].filter(([path]) => path.startsWith('sermons/sermon-1/_verseHistory/'));
      expect(history()).toHaveLength(archived ? 1 : 0);
      if (archived) {
        expect(history()[0][1]).toMatchObject({ verse: archived, winnerVerse: expected, generation: 'sermon-verse-seed' });
        expect(await listSermonVerseHistory('owner-1', resource.id, 'sermon-verse-seed')).toMatchObject({
          owner: 'owner-1', sermonId: resource.id, entries: [{ verse: archived, winnerVerse: expected }],
        });
        await expect(listSermonVerseHistory('other-owner', resource.id, 'sermon-verse-seed')).rejects.toMatchObject({ status: 403 });
        await expect(listSermonVerseHistory('owner-1', resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
        expect(await processCommand('owner-1', request)).toEqual(answer);
        expect(history()).toHaveLength(1);
      }
    });

  it.each([
    { opening: 'John 3:16', proposal: 'Romans 8:1' },
    { opening: 'John 3:16 — Kept explanation', proposal: 'Romans 8:1 — Earlier note' },
    { opening: 'John 3:16', proposal: 'Romans 8:1', reaffirm: true },
  ])('holds a legacy sermon passage after returning to $opening (reaffirm=$reaffirm)', async ({ opening, proposal, reaffirm }) => {
    const seed = create('sermon-verse-return') as Extract<DataCommand, { kind: 'create' }>;
    const value = { ...seed.value, title: 'Keep the title', verse: opening };
    expect((await processCommand('owner-1', { ...seed, value })).kind).toBe('acknowledged');
    const field = (value: string) => ({ exists: true, value });
    const edit = (id: string, from: string, to: string) => ({
      ...update(id, seed.operationId),
      changes: [{ path: ['verse'], before: field(from), after: field(to) }],
    });
    const temporary = 'Ephesians 2:8';
    if (!reaffirm) expect((await processCommand('owner-1', edit('intermediate', opening, temporary))).kind).toBe('acknowledged');
    expect((await processCommand('owner-1', edit('returned', temporary, opening))).kind).toBe('acknowledged');

    const delayed = edit('late-phone', opening, proposal);
    const result = await processCommand('owner-1', delayed);
    expect(result).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['verse'], base: field(opening), mine: field(proposal), theirs: field(opening) }],
      snapshot: { value: { title: value.title, verse: opening } } });
    expect(documents.get('sermons/sermon-1')?.verse).toBe(opening);
    expect(await processCommand('owner-1', delayed)).toEqual(result);
  });

  it.each([20, 80])('keeps ordered titles separate from a returned passage choice (%s)', async at => {
    const seed = create('sermon-verse-return') as Extract<DataCommand, { kind: 'create' }>;
    const opening = { ...seed.value, title: 'Original title', verse: 'John 3:16' };
    expect((await processCommand('owner-1', { ...seed, value: opening })).kind).toBe('acknowledged');
    const field = (value: string) => ({ exists: true, value });
    const title = (value: string) => ({ path: ['title'], before: field(opening.title), after: field(value) });
    const passage = (from: string, to: string) => ({ path: ['verse'], before: field(from), after: field(to) });
    const time = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at });
    const titleAction = (after: string, at: number) => ({ before: opening.title, after, observedRevision: 1, time: time(at) });
    expect((await processCommand('owner-1', { ...update('desk', seed.operationId), changes: [
      title('Desktop title'), passage(opening.verse, 'Mark 1:2'),
    ], sermonTitleAction: titleAction('Desktop title', 40) })).kind).toBe('acknowledged');
    expect((await processCommand('owner-1', { ...update('return', seed.operationId),
      changes: [passage('Mark 1:2', opening.verse)] })).kind).toBe('acknowledged');
    const delayed = { ...update('phone', seed.operationId), changes: [title('Phone title'), passage(opening.verse, 'Romans 8:1')],
      sermonTitleAction: titleAction('Phone title', at) };
    const answer = await processCommand('owner-1', delayed);
    expect(answer).toMatchObject({
      kind: 'conflict', conflicts: expect.arrayContaining([
        { path: ['verse'], base: field(opening.verse), mine: field('Romans 8:1'), theirs: field(opening.verse) },
        { path: ['title'], code: at < 40 ? 'sermon-metadata-settled' : 'sermon-metadata-queued',
          base: field(opening.title), mine: field('Phone title'), theirs: field('Desktop title') },
      ]), snapshot: { value: { title: 'Desktop title', verse: opening.verse } },
    });
  });

  it.each([false, true])('keeps a newer sermon passage safe after comparison (returns again: %s)', async returns => {
    const seed = create('sermon-verse-review') as Extract<DataCommand, { kind: 'create' }>;
    const opening = 'John 3:16', mine = 'Romans 8:1', newer = 'Mark 1:2';
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, verse: opening } })).kind).toBe('acknowledged');
    const field = (value: string) => ({ exists: true, value });
    const edit = (id: string, before: string, after: string, revision: number, at: number, reviewed?: true) => ({
      ...update(id, seed.operationId), changes: [{ path: ['verse'], before: field(before), after: field(after) }],
      sermonVerseAction: { observedRevision: revision, time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at },
        ...(reviewed && { reviewed }) },
    });
    expect((await processCommand('owner-1', edit('newer', opening, newer, 1, 20))).kind).toBe('acknowledged');
    if (returns) expect((await processCommand('owner-1', edit('returned', newer, opening, 2, 40))).kind).toBe('acknowledged');
    const saved = returns ? opening : newer;
    expect(await processCommand('owner-1', edit('outdated-review', opening, mine, 1, 80, true))).toMatchObject({
      kind: 'conflict', conflicts: [{ path: ['verse'], code: 'sermon-verse-review-changed', base: field(opening), mine: field(mine), theirs: field(saved) }],
      snapshot: { value: { verse: saved } },
    });
    expect(await processCommand('owner-1', edit('review-current', saved, mine, returns ? 3 : 2, 90, true))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { verse: mine } },
    });
    expect(await processCommand('owner-1', edit('already-saved', opening, mine, 1, 95, true))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { verse: mine } },
    });
  });

  describe('council metadata chronology', () => {
    const resource = { collection: 'councils', id: 'timed-council' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const date = '2099-04-10T00:00:00.000Z';
    const title = 'Opening council';
    const topics = [{ id: 'section', title: 'Keep the section', kind: 'info', questions: [], options: [], discussed: true }];
    const seed = (openingDate: string | null = date) => processCommand(base.owner, { ...base, operationId: 'council-seed', kind: 'create', generation: null,
      value: { userId: base.owner, title, ...(openingDate !== null && { date: openingDate }), status: 'preparing', topics,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const day = (value: string | null) => value === null ? { exists: false } : { exists: true, value };
    const change = (operationId: string, nextTitle: string, nextDate: string | null, offset: number) => {
      const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return { ...base, operationId, kind: 'update', generation: 'council-seed',
        changes: [{ path: ['title'], before: day(title), after: day(nextTitle) },
          { path: ['date'], before: day(date), after: day(nextDate) }],
        councilTitleAction: { before: title, after: nextTitle, observedRevision: 1, time },
        councilDateAction: { observedRevision: 1, time } };
    };

    it.each([
      { offset: 20, nextDate: '2099-04-27', expectedTitle: 'Desk council', expectedDate: '2099-04-20' },
      { offset: 80, nextDate: '2099-04-27', expectedTitle: 'Phone council', expectedDate: '2099-04-27' },
      { offset: 80, nextDate: null, expectedTitle: 'Phone council', expectedDate: undefined },
    ])('orders name and date from separate autosave observations ($offset / $nextDate)', async scenario => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, change('council-desk', 'Desk council', '2099-04-20', 40))).kind).toBe('acknowledged');
      const request = change('council-phone', 'Phone council', scenario.nextDate, scenario.offset);
      const result = await processCommand(base.owner, request);
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: scenario.expectedTitle, status: 'preparing', topics } } });
      expect(documents.get('councils/timed-council')?.date).toBe(scenario.expectedDate);
      const losingTitle = scenario.offset < 40 ? 'Phone council' : 'Desk council';
      const losingDate = scenario.offset < 40 ? scenario.nextDate : '2099-04-20';
      const list = () => listCouncilMetadataHistory(base.owner, resource.id, 'council-seed');
      expect(await list()).toMatchObject({ entries: [{ fields: [
        { field: 'title', value: losingTitle, winner: scenario.expectedTitle },
        { field: 'date', value: losingDate, winner: scenario.expectedDate ?? null },
      ] }] });
      await expect(listCouncilMetadataHistory('another-owner', resource.id, 'council-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listCouncilMetadataHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, request)).toEqual(result);
      expect((await list()).entries).toHaveLength(1);
    });

    it('can restore an earlier cleared date without changing the council title or sections', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = change('council-desk', title, null, 40);
      const phone = change('council-phone', title, '2099-04-27', 80);
      expect((await processCommand(base.owner, { ...desk, changes: [desk.changes[1]] })).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, { ...phone, changes: [phone.changes[1]] })).kind).toBe('acknowledged');
      const history = await listCouncilMetadataHistory(base.owner, resource.id, 'council-seed');
      expect(history.entries).toMatchObject([{ fields: [{ field: 'date', value: null, winner: '2099-04-27' }] }]);
      expect(await processCommand(base.owner, { ...change('restore-clear', title, null, 120),
        changes: [{ path: ['date'], before: day('2099-04-27'), after: day(null) }],
        councilDateAction: { observedRevision: 3, time: { earliestMs: 1_800_000_000_120, latestMs: 1_800_000_000_125 } },
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title, topics } } });
      expect(documents.get('councils/timed-council')).not.toHaveProperty('date');
    });

    it('asks before replacing a restored name or date when the offline action had no clock', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const deskTitle = 'Desk council', deskDate = '2099-04-20';
      expect((await processCommand(base.owner, change('council-desk', deskTitle, deskDate, 40))).kind).toBe('acknowledged');
      const restore = change('council-desk-restore', title, date, 80);
      expect((await processCommand(base.owner, { ...restore,
        changes: [{ path: ['title'], before: day(deskTitle), after: day(title) },
          { path: ['date'], before: day(deskDate), after: day(date) }],
        councilTitleAction: { ...restore.councilTitleAction, before: deskTitle, observedRevision: 2 },
        councilDateAction: { ...restore.councilDateAction, observedRevision: 2 },
      })).kind).toBe('acknowledged');
      const phone = change('council-phone', 'Offline council', null, 20);
      expect(await processCommand(base.owner, { ...phone,
        councilTitleAction: { ...phone.councilTitleAction, time: null },
        councilDateAction: { ...phone.councilDateAction, time: null },
      })).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'] }, { path: ['date'] }],
        snapshot: { value: { title, date, topics } },
      });
      expect((await listCouncilMetadataHistory(base.owner, resource.id, 'council-seed')).entries).toHaveLength(0);
    });

    it.each(['return', 'reaffirm'])('holds a legacy council title after a deliberate %s', async kind => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = change('council-desk', 'Temporary council', '2099-04-20', 40);
      if (kind === 'return') expect((await processCommand(base.owner, desk)).kind).toBe('acknowledged');
      const { councilTitleAction: _title, councilDateAction: _date, ...legacy } = desk;
      expect((await processCommand(base.owner, { ...legacy, operationId: 'council-return',
        changes: [{ path: ['title'], before: day('Temporary council'), after: day(title) }] })).kind).toBe('acknowledged');
      const delayed = { ...legacy, operationId: 'council-delayed',
        changes: [{ path: ['title'], before: day(title), after: day('Phone council') }] };
      const result = await processCommand(base.owner, delayed);
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'], mine: day('Phone council'), theirs: day(title) }],
        snapshot: { value: { title, date: kind === 'return' ? '2099-04-20' : date, topics } },
      });
      expect(await processCommand(base.owner, delayed)).toEqual(result);
    });

    it.each([
      { opening: null, proposal: '2099-04-27', reaffirm: false },
      { opening: null, proposal: '2099-04-27', reaffirm: true },
      { opening: date, proposal: null, reaffirm: false },
    ])('holds a legacy standalone council date after a return ($opening; reaffirm=$reaffirm)', async ({ opening, proposal, reaffirm }) => {
      expect((await seed(opening)).kind).toBe('acknowledged');
      const temp = '2099-04-20';
      const editDate = (operationId: string, before: string | null, after: string | null) => ({
        ...base, operationId, kind: 'update', generation: 'council-seed',
        changes: [{ path: ['date'], before: day(before), after: day(after) }],
      });
      if (!reaffirm) expect((await processCommand(base.owner, editDate('council-date-temp', opening, temp))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, editDate('council-date-return', temp, opening))).kind).toBe('acknowledged');
      const delayed = editDate('council-date-late', opening, proposal);
      const result = await processCommand(base.owner, delayed);
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['date'], base: day(opening), mine: day(proposal), theirs: day(opening) }],
        snapshot: { value: { title, status: 'preparing', topics } },
      });
      expect(documents.get('councils/timed-council')?.date).toBe(opening ?? undefined);
      expect(await processCommand(base.owner, delayed)).toEqual(result);
    });

    it.each([{ stored: date, mine: '2099-04-10' }, { stored: null, mine: '' }])(
      'does not ask about two representations of the same council date ($stored)', async ({ stored, mine }) => {
        const opening = '2099-04-01';
        expect((await seed(opening)).kind).toBe('acknowledged');
        const update = (operationId: string, after: string | null) => ({
          ...base, operationId, kind: 'update', generation: 'council-seed',
          changes: [{ path: ['date'], before: day(opening), after: day(after) }],
        });
        expect((await processCommand(base.owner, update('council-date-desk', stored))).kind).toBe('acknowledged');
        const result = await processCommand(base.owner, update('council-date-phone', mine));
        expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title, topics } } });
        expect(documents.get('councils/timed-council')?.date).toBe(stored ?? undefined);
      });

    it.each([20, 80])('reports the proved title order while a restored council date needs review (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = change('council-desk', 'Desk council', '2099-04-20', 40);
      expect((await processCommand(base.owner, desk)).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, { ...desk, operationId: 'council-date-return', changes: [
        { path: ['date'], before: day('2099-04-20'), after: day(date) },
      ], councilDateAction: { observedRevision: 2, time: {
        earliestMs: 1_800_000_000_120, latestMs: 1_800_000_000_125,
      } } })).kind).toBe('acknowledged');
      const { councilDateAction: _date, ...delayed } = change('council-delayed', 'Phone council', null, offset);
      const result = await processCommand(base.owner, delayed);
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: [
          { path: ['date'], mine: day(null), theirs: day(date) },
          { path: ['title'], code: offset < 40 ? 'council-topic-text-settled' : 'council-topic-text-queued',
            base: day(title), mine: day('Phone council'), theirs: day('Desk council') },
        ], snapshot: { value: { title: 'Desk council', date, topics } },
      });
    });

    it.each([20, 80])('reports the proved date order while a returned council title needs review (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = change('council-desk', 'Temporary council', '2099-04-20', 40);
      expect((await processCommand(base.owner, desk)).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, { ...desk, operationId: 'council-return', changes: [
        { path: ['title'], before: day('Temporary council'), after: day(title) },
      ], councilTitleAction: { ...desk.councilTitleAction, before: 'Temporary council', after: title, observedRevision: 2 } })).kind).toBe('acknowledged');
      const { councilTitleAction: _title, ...delayed } = change('council-delayed', 'Phone council', null, offset);
      const result = await processCommand(base.owner, delayed);
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: [
          { path: ['title'], mine: day('Phone council'), theirs: day(title) },
          { path: ['date'], code: offset < 40 ? 'council-topic-text-settled' : 'council-topic-text-queued',
            base: day(date), mine: day(null), theirs: day('2099-04-20') },
        ],
        snapshot: { value: { title, date: '2099-04-20', topics } },
      });
      const history = await listCouncilMetadataHistory(base.owner, resource.id, 'council-seed');
      if (offset < 40) expect(history.entries).toMatchObject([{ fields: [{ field: 'date', value: null, winner: '2099-04-20' }] }]);
      else expect(history.entries).toHaveLength(0);
    });

    it('preserves ordinary choices if the two council action intervals overlap', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, change('council-desk', 'Desk council', '2099-04-20', 40))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, change('council-phone', 'Phone council', '2099-04-27', 43))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'] }, { path: ['date'] }],
        snapshot: { value: { title: 'Desk council', date: '2099-04-20', topics } },
      });
    });
  });

  describe('council lifecycle chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'councils', id: 'lifecycle-council' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Council with sections', date = '2099-04-13';
    const topics = [{ id: 'section', title: 'Keep the section', kind: 'info', questions: [], options: [], discussed: true }];
    const seed = (heldAt: string | null = null) => processCommand(owner, { ...base, operationId: 'council-create', kind: 'create', generation: null,
      value: { userId: owner, title, date, status: heldAt ? 'held' : 'preparing', ...(heldAt && { heldAt }), topics,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const value = (text: string | null) => text === null ? { exists: false } : { exists: true, value: text };
    const change = (operationId: string, before: string | null, after: string | null, observedRevision: number, offset: number) => ({
      ...base, operationId, kind: 'update', generation: 'council-create',
      changes: [
        { path: ['status'], before: value(before === null ? 'preparing' : 'held'), after: value(after === null ? 'preparing' : 'held') },
        { path: ['heldAt'], before: value(before), after: value(after) },
      ],
      councilLifecycleAction: { observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });
    const desktopHeld = '2026-11-08T00:00:01.000Z', phoneHeld = '2026-11-08T00:00:02.000Z';

    it.each([20, 80])('orders two finishes by action time and preserves the complete held state (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-finish', null, desktopHeld, 1, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, change('phone-finish', null, phoneHeld, 1, offset))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { status: 'held', heldAt: offset < 40 ? desktopHeld : phoneHeld, title, date, topics } },
      });
    });

    it('keeps a later Undo when an old offline Finish is delivered afterwards', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-finish', null, desktopHeld, 1, 40))).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-undo', desktopHeld, null, 2, 80))).kind).toBe('acknowledged');
      expect(await processCommand(owner, change('phone-finish', null, phoneHeld, 1, 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { status: 'preparing', title, date, topics } },
      });
      expect(documents.get('councils/lifecycle-council')).not.toHaveProperty('heldAt');
      expect(await listCouncilMetadataHistory(owner, resource.id, 'council-create')).toMatchObject({
        entries: [{ fields: [{ field: 'heldAt', value: phoneHeld, winner: null }] }],
      });
      const restored = await processCommand(owner, change('restore-old-finish', null, phoneHeld, 3, 120));
      expect(restored).toMatchObject({ kind: 'acknowledged', snapshot: { value: { status: 'held', heldAt: phoneHeld, title, date, topics } } });
    });

    it.each([
      { opening: null, incoming: phoneHeld, reaffirm: false },
      { opening: null, incoming: phoneHeld, reaffirm: true },
      { opening: phoneHeld, incoming: null, reaffirm: false },
    ])('holds a legacy lifecycle change after a return ($opening; reaffirm=$reaffirm)', async ({ opening, incoming, reaffirm }) => {
      expect((await seed(opening)).kind).toBe('acknowledged');
      const temporary = opening ? null : desktopHeld;
      const old = (id: string, before: string | null, after: string | null) => {
        const { councilLifecycleAction: _action, ...legacy } = change(id, before, after, 1, 20);
        return legacy;
      };
      if (!reaffirm) expect((await processCommand(owner, old('desktop-changes-status', opening, temporary))).kind).toBe('acknowledged');
      expect((await processCommand(owner, old('desktop-returns-status', temporary, opening))).kind).toBe('acknowledged');
      const delayed = old('phone-first-delivery', opening, incoming);
      const result = await processCommand(owner, delayed);
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['heldAt'], base: value(opening), mine: value(incoming), theirs: value(opening) }],
        snapshot: { value: { status: opening ? 'held' : 'preparing', title, date, topics } },
      });
      expect(documents.get('councils/lifecycle-council')?.heldAt).toBe(opening ?? undefined);
      expect(await processCommand(owner, delayed)).toEqual(result);
    });

    it('preserves a manual choice when a delayed Finish has no reliable clock', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-finish', null, desktopHeld, 1, 40))).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desktop-undo', desktopHeld, null, 2, 80))).kind).toBe('acknowledged');
      const phone = change('phone-finish', null, phoneHeld, 1, 20);
      expect(await processCommand(owner, { ...phone, councilLifecycleAction: { observedRevision: 1, time: null } })).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['heldAt'] }], snapshot: { value: { status: 'preparing', title, date, topics } },
      });
      expect(documents.get('councils/lifecycle-council')).not.toHaveProperty('heldAt');
      expect((await listCouncilMetadataHistory(owner, resource.id, 'council-create')).entries).toHaveLength(0);
    });
  });

  describe('tag color chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'tags', id: 'timed-tag' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const name = 'Keep the tag name';
    const color = '#808E9B';
    const desk = '#54A0FF';
    const phone = '#FF6B6B';
    const field = (value: string) => ({ exists: true, value });
    const seed = () => processCommand(owner, { ...base, operationId: 'tag-create', kind: 'create', generation: null,
      value: { userId: owner, name, color, required: false, createdAt: '2026-11-08' } });
    const recolor = (operationId: string, nextColor: string, offset: number | null) => ({
      ...base, operationId, kind: 'update', generation: 'tag-create',
      changes: [{ path: ['color'], before: field(color), after: field(nextColor) }],
      tagColorAction: { observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([[20, desk], [80, phone]] as const)('orders a delayed recolor and preserves tag identity (%s)', async (offset, winner) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, recolor('desk-color', desk, 40))).kind).toBe('acknowledged');
      const delayed = recolor('phone-color', phone, offset);
      const reply = await processCommand(owner, delayed);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { name, color: winner, required: false } } });
      expect(await processCommand(owner, delayed)).toEqual(reply);
      expect(await listTagColorHistory(owner, resource.id, 'tag-create')).toMatchObject({
        tagId: resource.id, entries: [{ fields: [{ field: 'color', value: winner === desk ? phone : desk, winner }] }],
      });
      await expect(listTagColorHistory('other-owner', resource.id, 'tag-create')).rejects.toMatchObject({ status: 403 });
      await expect(listTagColorHistory(owner, resource.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it.each([null, 43])('keeps the saved color when ordering cannot be proven (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, recolor('desk-color', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, recolor('phone-color', phone, offset))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['color'] }], snapshot: { value: { name, color: desk } },
      });
    });

    it.each(['return', 'reaffirm'])('holds a legacy recolor after a %s to the saved tag color', async kind => {
      expect((await seed()).kind).toBe('acknowledged');
      const { tagColorAction: _action, ...legacy } = recolor('phone-legacy', phone, null);
      if (kind === 'return') expect((await processCommand(owner, recolor('desk-color', desk, 40))).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...legacy, operationId: 'desk-returns-color',
        changes: [{ path: ['color'], before: field(desk), after: field(color) }],
      })).kind).toBe('acknowledged');
      const result = await processCommand(owner, legacy);
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['color'], base: field(color), mine: field(phone), theirs: field(color) }],
        snapshot: { value: { name, color, required: false } },
      });
      expect(await processCommand(owner, legacy)).toEqual(result);
    });

    it('keeps a deleted tag deleted when a recolor later arrives', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...base, operationId: 'tag-delete', kind: 'delete', generation: 'tag-create',
        baseline: { userId: owner, name, color, required: false, createdAt: '2026-11-08' } })).kind).toBe('acknowledged');
      const reply = await processCommand(owner, recolor('phone-color', phone, 80));
      expect(reply).toMatchObject({ kind: 'deleted', snapshot: { value: null, metadata: { deleted: true } } });
    });
  });

  describe('plan template name chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'planTemplates', id: 'timed-plan-template' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const name = 'Opening template name';
    const desk = 'Computer template name';
    const phone = 'Phone template name';
    const structure = { introduction: [{ id: 'first', text: 'Keep the first point' }], main: [], conclusion: [] };
    const field = <T,>(value: T) => ({ exists: true, value });
    const seed = () => processCommand(owner, { ...base, operationId: 'template-create', kind: 'create', generation: null,
      value: { userId: owner, name, structure, createdAt: '2026-11-08', updatedAt: '2026-11-08' } });
    const rename = (operationId: string, nextName: string, offset: number | null) => ({
      ...base, operationId, kind: 'update', generation: 'template-create',
      changes: [{ path: ['name'], before: field(name), after: field(nextName) }],
      planTemplateNameAction: { observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([[20, desk], [80, phone]] as const)('orders a delayed rename and keeps the outline (%s)', async (offset, winner) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-name', desk, 40))).kind).toBe('acknowledged');
      const delayed = rename('phone-name', phone, offset);
      const reply = await processCommand(owner, delayed);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { name: winner, structure } } });
      expect(await processCommand(owner, delayed)).toEqual(reply);
      expect(await listPlanTemplateNameHistory(owner, resource.id, 'template-create')).toMatchObject({
        templateId: resource.id, entries: [{ title: winner === desk ? phone : desk, winnerTitle: winner }],
      });
      await expect(listPlanTemplateNameHistory('other-owner', resource.id, 'template-create')).rejects.toMatchObject({ status: 403 });
      await expect(listPlanTemplateNameHistory(owner, resource.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it.each([null, 43])('keeps a comparison when rename timing is uncertain (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-name', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-name', phone, offset))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['name'] }], snapshot: { value: { name: desk, structure } },
      });
    });

    it.each(['restored', 'repeated'] as const)('protects a %s template name from a legacy rename without ordering evidence', async scenario => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-name', desk, 40))).kind).toBe('acknowledged');
      const currentName = scenario === 'restored' ? name : desk;
      const before = scenario === 'restored' ? desk : name;
      const legacy = (operationId: string, opening: string, nextName: string) => ({
        ...base, operationId, kind: 'update', generation: 'template-create',
        changes: [{ path: ['name'], before: field(opening), after: field(nextName) }],
      });
      const next = { ...structure, main: [{ id: 'remote', text: 'Keep the separately saved point' }] };
      expect(await processCommand(owner, { ...legacy('desktop-confirmation', before, currentName),
        changes: [...legacy('desktop-confirmation', before, currentName).changes,
          { path: ['structure'], before: field(structure), after: field(next) }],
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { name: currentName, structure: next } } });

      const delayed = legacy('delayed-phone-name', currentName, phone);
      const answer = await processCommand(owner, delayed);
      expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { name: currentName, structure: next } },
        conflicts: [{ path: ['name'], mine: { value: phone }, theirs: { value: currentName } }] });
      expect(await processCommand(owner, delayed)).toEqual(answer);

      if (answer.kind !== 'conflict') throw new Error('Missing template choice');
      expect(await processCommand(owner, { ...legacy('explicit-choice', currentName, phone),
        planTemplateNameAction: { observedRevision: answer.snapshot.metadata!.revision, time: null },
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { name: phone, structure: next } } });
    });

    it('saves an offline rename alongside a separately edited outline', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const next = { ...structure, main: [{ id: 'second', text: 'Keep the new point' }] };
      expect((await processCommand(owner, { ...base, operationId: 'outline-edit', kind: 'update', generation: 'template-create',
        changes: [{ path: ['structure'], before: field(structure), after: field(next) }],
      })).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-name', phone, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { name: phone, structure: next } },
      });
    });
  });

  describe('plan template point placement chronology', () => {
    const owner = 'owner-1';
    const template = { collection: 'planTemplates', id: 'template-placement' };
    const base = { protocol: 1 as const, owner, resource: template, dependsOn: [] };
    const generation = 'template-placement-create';
    const point = { id: 'point', text: 'Original words', subPoints: [{ id: 'child', text: 'Keep the child', position: 0 }] };
    const other = { id: 'other', text: 'Independent point' };
    const opening: SermonOutline = { introduction: [], main: [point, other], conclusion: [] };
    const phone: SermonOutline = { introduction: [point], main: [other], conclusion: [] };
    const desktop: SermonOutline = { introduction: [], main: [other], conclusion: [point] };
    const seed = () => processCommand(owner, { ...base, operationId: generation, generation: null, kind: 'create',
      value: { userId: owner, name: 'Template', structure: opening, createdAt: '2026-11-09', updatedAt: '2026-11-09' } });
    const move = (operationId: string, before: SermonOutline, after: SermonOutline, observedRevision: number, offset: number | null) => ({
      ...base, operationId, generation, kind: 'update', changes: [{ path: ['structure'],
        before: { exists: true, value: outlinePointOrder(before) }, after: { exists: true, value: outlinePointOrder(after) } }],
      outlinePointPlacement: { pointId: point.id, opening: outlinePointGap(before, point.id)!,
        destination: outlinePointGap(after, point.id)!, observedRevision,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([false, true])('keeps the later gesture, not the last delivery (phone later: %s)', async phoneLater => {
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('desktop-move', opening, desktop, 1, phoneLater ? 20 : 60)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { structure: desktop } } });
      const desktopFinal = phoneLater ? desktop : opening;
      if (!phoneLater) expect(await processCommand(owner, move('desktop-return', desktop, opening, 2, 100)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { structure: opening } } });
      const updated = { ...other, text: 'Independently updated words' };
      const updatedStructure = { ...desktopFinal, main: desktopFinal.main.map(row => row.id === other.id ? updated : row) };
      expect(await processCommand(owner, { ...base, operationId: 'independent-text', generation, kind: 'update', changes: [{
        path: ['structure'], before: { exists: true, value: desktopFinal }, after: { exists: true, value: updatedStructure },
      }] })).toMatchObject({ kind: 'acknowledged' });
      const expected = phoneLater ? { ...phone, main: [updated] } : updatedStructure;
      const queued = move('delayed-phone', opening, phone, 1, phoneLater ? 100 : 20);
      expect(await processCommand(owner, queued)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { structure: expected } } });
      expect((await readDocument(owner, template))?.value?.structure).toEqual(expected);
      expect(await processCommand(owner, queued)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { structure: expected } } });
      const displaced = phoneLater ? desktop : phone;
      expect(await listPlanTemplatePointPlacementHistory(owner, template.id, generation)).toMatchObject({ templateId: template.id,
        entries: [{ pointId: point.id, earlier: outlinePointGap(displaced, point.id), kept: outlinePointGap(expected, point.id) }] });
      await expect(listPlanTemplatePointPlacementHistory('other-owner', template.id, generation)).rejects.toMatchObject({ status: 403 });
      await expect(listPlanTemplatePointPlacementHistory(owner, template.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it.each([false, true])('keeps point and child words across a separate move (move delivered first: %s)', async moveFirst => {
      const edited = { ...point, text: 'Offline point words', subPoints: [{ ...point.subPoints[0], text: 'Offline child words' }] };
      const edit = { ...base, generation, operationId: 'edit-words', kind: 'update', changes: [{ path: ['structure'],
        before: { exists: true, value: opening }, after: { exists: true, value: { ...opening, main: [edited, other] } },
      }] };
      const placement = move('desktop-move', opening, desktop, 1, 60);
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      for (const command of moveFirst ? [placement, edit] : [edit, placement]) {
        expect(await processCommand(owner, command)).toMatchObject({ kind: 'acknowledged' });
      }
      expect((await readDocument(owner, template))?.value?.structure).toEqual({ ...desktop, conclusion: [edited] });
    });

    it('preserves the server text and the removed point when an offline text edit needs its own comparison', async () => {
      const edit = { ...base, generation, operationId: 'offline-edit', kind: 'update', changes: [{ path: ['structure'],
        before: { exists: true, value: opening }, after: { exists: true, value: { ...opening, main: [{ ...point, text: 'Local text' }, other] } },
      }] };
      expect(await seed()).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('desktop-move', opening, desktop, 1, 60))).toMatchObject({ kind: 'acknowledged' });
      const saved = { ...desktop, conclusion: [{ ...point, text: 'Different saved text' }] };
      const replace = (operationId: string, before: SermonOutline, after: SermonOutline) => processCommand(owner, {
        ...base, generation, operationId, kind: 'update', changes: [{ path: ['structure'],
          before: { exists: true, value: before }, after: { exists: true, value: after },
        }],
      });
      expect(await replace('remote-text', desktop, saved)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, edit)).toMatchObject({ kind: 'conflict', snapshot: { value: { structure: saved } } });
      const removed = { ...saved, conclusion: [] };
      expect(await replace('remote-delete', saved, removed)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, { ...edit, operationId: 'after-delete' })).toMatchObject({
        kind: 'conflict', snapshot: { value: { structure: removed } },
      });
      expect((await readDocument(owner, template))?.value?.structure).toEqual(removed);
    });

    it.each(['point', 'anchor'] as const)('refuses to move across a deleted and recreated %s', async replaced => {
      const anchor = { id: 'anchor', text: 'Opening anchor' };
      const first = { ...opening, introduction: [anchor] };
      const destination = { ...phone, introduction: [anchor, point] };
      const section = replaced === 'point' ? 'main' : 'introduction';
      const id = replaced === 'point' ? point.id : anchor.id;
      const without = { ...first, [section]: first[section].filter(row => row.id !== id) };
      const replacement = { ...first, [section]: first[section].map(row => row.id === id ? { ...row, text: 'New lifetime' } : row) };
      const replace = (operationId: string, before: SermonOutline, after: SermonOutline) => processCommand(owner, {
        ...base, generation, operationId, kind: 'update', changes: [{ path: ['structure'],
          before: { exists: true, value: before }, after: { exists: true, value: after },
        }],
      });
      expect(await processCommand(owner, { ...base, operationId: generation, generation: null, kind: 'create',
        value: { userId: owner, name: 'Template', structure: first, createdAt: '2026-11-09', updatedAt: '2026-11-09' } }))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await replace('remove-old-node', first, without)).toMatchObject({ kind: 'acknowledged' });
      expect(await replace('add-new-node', without, replacement)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('old-move', first, destination, 1, 20))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['structure', 'id:' + point.id, 'position'] }],
        snapshot: { value: { structure: replacement } },
      });
      expect((await readDocument(owner, template))?.value?.structure).toEqual(replacement);
    });

    it.each([
      { removed: false, extended: false }, { removed: true, extended: false }, { removed: false, extended: true },
    ])('refuses an unsigned reorder after tracking (removed $removed, extended $extended)', async ({ removed, extended }) => {
      const first = extended ? { ...opening, extension: 'Keep this value' } : opening;
      const later = extended ? { ...desktop, extension: 'Keep this value' } : desktop;
      const proposed = extended ? { ...phone, extension: 'Keep this value' } : phone;
      const old = { ...base, generation, operationId: 'unsigned-phone', kind: 'update', changes: [{ path: ['structure'],
        before: { exists: true, value: first }, after: { exists: true, value: proposed },
      }] };
      expect(await processCommand(owner, { ...base, operationId: generation, generation: null, kind: 'create',
        value: { userId: owner, name: 'Template', structure: first, createdAt: '2026-11-09', updatedAt: '2026-11-09' } }))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('desktop-move', first, later, 1, 60))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('desktop-return', later, first, 2, 100))).toMatchObject({ kind: 'acknowledged' });
      const stored = removed ? { ...first, main: [other] } : first;
      if (removed) expect(await processCommand(owner, { ...old, operationId: 'delete-point', changes: [{ path: ['structure'],
        before: { exists: true, value: first }, after: { exists: true, value: stored },
      }] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, old)).toMatchObject({ kind: 'refused', code: 'template-point-placement-needs-review' });
      expect((await readDocument(owner, template))?.value?.structure).toEqual(stored);
    });

    it('compares only the point position when its clock cannot order the moves', async () => {
      await seed();
      expect(await processCommand(owner, move('desktop-move', opening, desktop, 1, 20))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('unclocked-phone', opening, phone, 1, null))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['structure', 'id:' + point.id, 'position'],
          mine: { value: { section: 'introduction' } }, theirs: { value: { section: 'conclusion' } } }],
        snapshot: { value: { structure: desktop } },
      });
      expect((await readDocument(owner, template))?.value?.structure).toEqual(desktop);
    });
  });

  describe('study note tag membership chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'studyNotes', id: 'timed-note-tag' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const tag = 'Alpha tag', independent = 'Independent tag';
    const words = 'The original note words';
    const value = (tags: string[]) => ({ exists: true, value: tags });
    const seed = (tags: string[]) => processCommand(owner, { ...base, operationId: 'tag-note-generation', kind: 'create', generation: null,
      value: { userId: owner, title: 'Note with tags', content: words, type: 'note', tags, scriptureRefs: [], materialIds: [], isDraft: true,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const tagEdit = (operationId: string, name: string, before: boolean, after: boolean, offset: number | null, predecessorOperationId?: string) => ({
      ...base, operationId, kind: 'update', generation: 'tag-note-generation', dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
      changes: [{ path: ['tags'], before: value(before ? [name] : []), after: value(after ? [name] : []) }],
      tagMembershipActions: [{ tag: name, before, after, observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        ...(predecessorOperationId && { predecessorOperationId }) }],
    });

    it.each([
      { opening: false, deskAt: 80, winner: true },
      { opening: true, deskAt: 80, winner: false },
      { opening: false, deskAt: 30, winner: false },
      { opening: true, deskAt: 30, winner: true },
    ])('uses action time for tag membership $opening with the connected edit at $deskAt', async ({ opening, deskAt, winner }) => {
      expect((await seed(opening ? [tag] : [])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', tag, opening, !opening, deskAt))).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, opening, !opening, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, !opening, opening, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: winner ? [tag] : [], content: words } },
      });
    });

    it('orders exact long note tags without duplicating their names in proof metadata', async () => {
      const prefix = 'Shared prefix ' + 'x'.repeat(4096);
      const first = prefix + ' A', second = prefix + ' B';
      expect((await seed([])).kind).toBe('acknowledged');
      const desk = tagEdit('desk-long', first, false, true, 80);
      await expect(processCommand(owner, { ...desk, changes: [{ path: ['tags'], before: value([]), after: value([first, second]) }],
        tagMembershipActions: [...desk.tagMembershipActions, { ...desk.tagMembershipActions[0], tag: second }],
      })).resolves.toMatchObject({ kind: 'acknowledged' });
      await processCommand(owner, tagEdit('phone-first', first, false, true, 15));
      await expect(processCommand(owner, tagEdit('phone-second', first, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [first, second], content: words } },
      });
      expect(JSON.stringify(documents.get('studyNotes/timed-note-tag')?._dataEngine)).not.toContain(prefix);
      await expect(listDocumentTagHistory(owner, resource.collection, resource.id, 'tag-note-generation')).resolves.toMatchObject({
        entries: [{ tags: [{ tag: first, value: false, winnerValue: true }] }],
      });
    });

    it('orders the indexed name of a long document tag without growing the command', async () => {
      const name = 'x'.repeat(550 * 1024);
      const indexedEdit = (...args: Parameters<typeof tagEdit>) => {
        const command = tagEdit(...args);
        const [{ tag: _name, ...action }] = command.tagMembershipActions;
        return { ...command, tagMembershipActions: [{ ...action, tagIndex: 0 }] };
      };
      expect((await seed([])).kind).toBe('acknowledged');
      const desk = indexedEdit('desk-indexed', name, false, true, 80);
      expect(Buffer.byteLength(JSON.stringify(desk))).toBeLessThan(MAX_COMMAND_BYTES);
      await expect(processCommand(owner, desk)).resolves.toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, indexedEdit('phone-indexed-add', name, false, true, 15))).resolves.toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(owner, indexedEdit('phone-indexed-remove', name, true, false, 50, 'phone-indexed-add'));
      expect(result.kind).toBe('acknowledged');
      expect(result.kind === 'acknowledged' && result.snapshot.value?.tags instanceof Array && result.snapshot.value.tags[0] === name).toBe(true);
    });

    it.each([64, 65, 512])('keeps the later note-tag choice and all siblings in a %s-change batch with the contested tag last', async count => {
      const tags = [...Array.from({ length: count - 1 }, (_, index) => 'QA Batch ' + index), tag];
      const desk = tagEdit('desk', tag, false, true, 80);
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...desk, changes: [{ path: ['tags'], before: value([]), after: value(tags) }],
        tagMembershipActions: tags.map(name => ({ ...desk.tagMembershipActions[0], tag: name })) })).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags, content: words } },
      });
    });

    it('replays every exact comparison in a large tag conflict receipt', async () => {
      const names = Array.from({ length: 1500 }, (_, index) => 'Tag ' + index + ' ' + 'x'.repeat(350));
      expect((await seed(names)).kind).toBe('acknowledged');
      const updateTags = (operationId: string, before: string[], after: string[]) => ({
        ...base, operationId, kind: 'update', generation: 'tag-note-generation',
        changes: [{ path: ['tags'], before: value(before), after: value(after) }],
      });
      expect((await processCommand(owner, updateTags('desk-clears', names, []))).kind).toBe('acknowledged');
      expect((await processCommand(owner, updateTags('desk-restores', [], names))).kind).toBe('acknowledged');
      const older = { ...updateTags('phone-removes-batch', names, []), tagMembershipActions: names.map((_name, tagIndex) => ({
        tagIndex, before: true, after: false, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_050, latestMs: 1_800_000_000_055 },
      })) };
      expect(Buffer.byteLength(JSON.stringify(older))).toBeLessThan(MAX_COMMAND_BYTES);
      const result = await processCommand(owner, older);
      expect(result.kind).toBe('conflict');
      if (result.kind !== 'conflict') return;
      expect(result.conflicts).toHaveLength(names.length);
      expect(result.conflicts.at(-1)?.path).toEqual(['tags', 'string:' + names.at(-1)]);
      expect(result.snapshot.value?.tags).toEqual(names);
      await expect(processCommand(owner, older)).resolves.toEqual(result);
    });

    it('replays a tag comparison when the full snapshot and compact choices need separate storage', async () => {
      const names = Array.from({ length: 6000 }, (_, index) => 'N' + index);
      const body = 'x'.repeat(930_000);
      const opened = await processCommand(owner, { ...base, operationId: 'tag-note-generation', kind: 'create', generation: null,
        value: { userId: owner, title: 'A nearly full note', content: body, type: 'note', tags: names, scriptureRefs: [],
          materialIds: [], isDraft: true, createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' },
      });
      expect(opened.kind).toBe('acknowledged');
      const edit = (operationId: string, before: string[], after: string[]) => ({ ...base, operationId, kind: 'update', generation: 'tag-note-generation',
        changes: [{ path: ['tags'], before: value(before), after: value(after) }] });
      expect((await processCommand(owner, edit('desk-clears-nearly-full-note', names, []))).kind).toBe('acknowledged');
      expect((await processCommand(owner, edit('desk-restores-nearly-full-note', [], names))).kind).toBe('acknowledged');
      const older = { ...edit('phone-clears-nearly-full-note', names, []), tagMembershipActions: names.map((_name, tagIndex) => ({
        tagIndex, before: true, after: false, observedRevision: 1, time: { earliestMs: 1_800_000_000_050, latestMs: 1_800_000_000_055 },
      })) };
      expect(Buffer.byteLength(JSON.stringify(older))).toBeLessThan(MAX_COMMAND_BYTES);
      const result = await processCommand(owner, older);
      expect(result.kind).toBe('conflict');
      if (result.kind !== 'conflict') return;
      expect(result.conflicts).toHaveLength(names.length);
      expect(result.snapshot.value?.content === body).toBe(true);
      await expect(processCommand(owner, older)).resolves.toEqual(result);
      const storedParts = [...documents.keys()].filter(key => key.includes('/_tagParts/')).sort();
      expect(storedParts.length).toBeGreaterThan(1);
      storedParts.forEach((key, index) => documents.set(key, { json: index ? '' : JSON.stringify({
        kind: 'conflict', operationId: older.operationId, tagPathRefs: true, conflicts: [],
      }) }));
      await expect(processCommand(owner, older)).rejects.toMatchObject({ code: 'invalid-stored-receipt', status: 409 });
    });

    it('retains all displaced names in a large tag history across bounded entries', async () => {
      const names = ['A', 'B', 'C'].map(prefix => prefix + 'x'.repeat(270_000));
      expect((await seed([])).kind).toBe('acknowledged');
      const updateTags = (operationId: string, before: string[], after: string[], adding: boolean, offset: number) => ({
        ...base, operationId, kind: 'update', generation: 'tag-note-generation',
        changes: [{ path: ['tags'], before: value(before), after: value(after) }],
        tagMembershipActions: names.map((_name, tagIndex) => ({ tagIndex, before: !adding, after: adding, observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        })),
      });
      expect((await processCommand(owner, updateTags('desk-adds-long-tags', [], names, true, 80))).kind).toBe('acknowledged');
      expect((await processCommand(owner, updateTags('phone-removes-long-tags', names, [], false, 50))).kind).toBe('acknowledged');
      const history = await listDocumentTagHistory(owner, resource.collection, resource.id, 'tag-note-generation');
      expect(history.entries.length).toBeGreaterThan(1);
      expect(history.entries.flatMap(entry => entry.tags.map(action => action.tag)).sort()).toEqual(names);
    });

    it('keeps displaced tag decisions visible only to the current document owner and generation', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      await processCommand(owner, tagEdit('desk', tag, false, true, 80));
      await processCommand(owner, tagEdit('phone-first', tag, false, true, 15));
      await processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'));
      await expect(listDocumentTagHistory(owner, resource.collection, resource.id, 'tag-note-generation')).resolves.toMatchObject({
        documentId: resource.id, entries: [{ tags: [{ tag, value: false, winnerValue: true }] }],
      });
      await expect(listDocumentTagHistory('other-owner', resource.collection, resource.id, 'tag-note-generation')).rejects.toMatchObject({ status: 403 });
      await expect(listDocumentTagHistory(owner, resource.collection, resource.id, 'replaced')).rejects.toMatchObject({ status: 404 });
    });

    it('keeps an exact tag choice when the connected decision is unclocked', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', tag, false, true, null))).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['tags', 'string:' + tag] }], snapshot: { value: { tags: [tag], content: words } },
      });
    });

    it('merges independent additions to a legacy note without a stored tag list', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      const key = 'studyNotes/timed-note-tag';
      const { tags: _tags, ...legacy } = documents.get(key)!;
      documents.set(key, legacy);
      const add = (id: string, name: string, offset: number) => ({
        ...tagEdit(id, name, false, true, offset),
        changes: [{ path: ['tags'], before: { exists: false }, after: value([name]) }],
      });
      expect((await processCommand(owner, add('desk', independent, 80))).kind).toBe('acknowledged');
      await expect(processCommand(owner, add('phone-first', tag, 15))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [independent, tag], content: words } },
      });
    });

    it('merges two different ordinary tags', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', independent, false, true, 80))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [independent, tag], content: words } },
      });
    });
  });

  describe('study note title chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'studyNotes', id: 'timed-study-note' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Opening note title';
    const content = 'Retain the original paragraph.';
    const desk = 'Computer title';
    const phone = 'Phone title';
    const field = (value: string) => ({ exists: true, value });
    const seed = () => processCommand(owner, { ...base, operationId: 'note-create', kind: 'create', generation: null,
      value: { userId: owner, title, content, type: 'note', tags: [], scriptureRefs: [], materialIds: [], isDraft: true,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const rename = (operationId: string, nextTitle: string, offset: number | null) => ({
      ...base, operationId, kind: 'update', generation: 'note-create',
      changes: [{ path: ['title'], before: field(title), after: field(nextTitle) }],
      studyNoteTitleAction: { before: field(title), after: field(nextTitle), observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([[20, desk], [80, phone]] as const)('orders a delayed title while retaining note prose (%s)', async (offset, winner) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-title', desk, 40))).kind).toBe('acknowledged');
      const command = rename('phone-title', phone, offset);
      const reply = await processCommand(owner, command);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: winner, content } } });
      expect(await processCommand(owner, command)).toEqual(reply);
      expect(await listStudyNoteTitleHistory(owner, resource.id, 'note-create')).toMatchObject({
        entries: [{ title: winner === desk ? phone : desk, winnerTitle: winner }],
      });
      await expect(listStudyNoteTitleHistory('other-owner', resource.id, 'note-create')).rejects.toMatchObject({ status: 403 });
      await expect(listStudyNoteTitleHistory(owner, resource.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('orders clearing a long title without changing the existing input contract', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const longTitle = 'A'.repeat(2048);
      expect((await processCommand(owner, rename('desk-long', longTitle, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-clear', '', 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: '', content } },
      });
      expect(await listStudyNoteTitleHistory(owner, resource.id, 'note-create')).toMatchObject({
        entries: [{ title: longTitle, winnerTitle: '' }],
      });
    });

    it('orders the title of a legacy note whose original title field was absent', async () => {
      expect((await processCommand(owner, { ...base, operationId: 'note-create', kind: 'create', generation: null,
        value: { userId: owner, content, type: 'note', tags: [], scriptureRefs: [], materialIds: [], isDraft: true,
          createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' },
      })).kind).toBe('acknowledged');
      const firstTitle = (operationId: string, next: string, at: number) => ({
        ...rename(operationId, next, at), changes: [{ path: ['title'], before: { exists: false }, after: field(next) }],
      });
      expect((await processCommand(owner, firstTitle('desk-title', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, firstTitle('phone-title', phone, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: phone, content } },
      });
    });

    it.each([null, 43])('keeps a title choice when the order is unknown (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, rename('desk-title', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-title', phone, offset))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'] }], snapshot: { value: { title: desk, content } },
      });
    });

    it('combines a title with independent new prose without dropping either', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const nextContent = 'Retain the new paragraph.';
      expect((await processCommand(owner, { ...base, operationId: 'desk-prose', kind: 'update', generation: 'note-create',
        changes: [{ path: ['content'], before: field(content), after: field(nextContent) }],
      })).kind).toBe('acknowledged');
      expect(await processCommand(owner, rename('phone-title', phone, 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: phone, content: nextContent } },
      });
    });
  });

  describe('prayer tag membership chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'timed-prayer-tag' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const tag = 'Alpha tag', independent = 'Independent tag', description = 'The prayer description remains';
    const update = { id: 'one', text: 'Keep the prayer update', createdAt: '2026-11-08T00:00:00.000Z' };
    const value = (tags: string[]) => ({ exists: true, value: tags });
    const seed = (tags: string[]) => processCommand(owner, { ...base, operationId: 'prayer-tag-generation', kind: 'create', generation: null,
      value: { userId: owner, title: 'Prayer with tags', description, tags, status: 'active', updates: [update],
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const tagEdit = (operationId: string, name: string, before: boolean, after: boolean, offset: number | null, predecessorOperationId?: string) => ({
      ...base, operationId, kind: 'update', generation: 'prayer-tag-generation', dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
      changes: [{ path: ['tags'], before: before ? value([name]) : value([]), after: after ? value([name]) : { exists: false } }],
      tagMembershipActions: [{ tag: name, before, after, observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        ...(predecessorOperationId && { predecessorOperationId }) }],
    });

    it.each([
      { startsPresent: false, deskAt: 80, winner: true },
      { startsPresent: true, deskAt: 80, winner: false },
      { startsPresent: false, deskAt: 30, winner: false },
      { startsPresent: true, deskAt: 30, winner: true },
    ])('uses the later known tag choice when the starting membership is $startsPresent and the computer acts at $deskAt',
      async ({ startsPresent, deskAt, winner }) => {
        expect((await seed(startsPresent ? [tag] : [])).kind).toBe('acknowledged');
        expect((await processCommand(owner, tagEdit('desk', tag, startsPresent, !startsPresent, deskAt))).kind).toBe('acknowledged');
        expect((await processCommand(owner, tagEdit('phone-first', tag, startsPresent, !startsPresent, 15))).kind).toBe('acknowledged');
        const reply = await processCommand(owner, tagEdit('phone-second', tag, !startsPresent, startsPresent, 50, 'phone-first'));
        expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { description, updates: [update], status: 'active' } } });
        expect(reply.kind === 'acknowledged' && (reply.snapshot.value?.tags ?? [])).toEqual(winner ? [tag] : []);
      });

    it('keeps an exact prayer tag choice when the clock cannot establish order', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      await processCommand(owner, tagEdit('desk', tag, false, true, null));
      await processCommand(owner, tagEdit('phone-first', tag, false, true, 15));
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['tags', 'string:' + tag] }], snapshot: { value: { tags: [tag], description } },
      });
    });

    it.each([256, 257])('keeps the later prayer-tag choice when the tag name has %s characters', async length => {
      const name = 'QA ' + 'x'.repeat(length - 3);
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('desk', name, false, true, 80))).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', name, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', name, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [name], description, updates: [update] } },
      });
    });

    it.each([64, 65, 512])('keeps the later prayer-tag choice and all siblings in a %s-change batch with the contested tag last', async count => {
      const tags = [...Array.from({ length: count - 1 }, (_, index) => 'QA Batch ' + index), tag];
      const desk = tagEdit('desk', tag, false, true, 80);
      expect((await seed([])).kind).toBe('acknowledged');
      expect((await processCommand(owner, { ...desk, changes: [{ path: ['tags'], before: value([]), after: value(tags) }],
        tagMembershipActions: tags.map(name => ({ ...desk.tagMembershipActions[0], tag: name })) })).kind).toBe('acknowledged');
      expect((await processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).kind).toBe('acknowledged');
      await expect(processCommand(owner, tagEdit('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags, description, updates: [update] } },
      });
    });

    it('still merges independent prayer tags', async () => {
      expect((await seed([])).kind).toBe('acknowledged');
      await processCommand(owner, tagEdit('desk', independent, false, true, 80));
      await expect(processCommand(owner, tagEdit('phone-first', tag, false, true, 15))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { tags: [independent, tag], description } },
      });
    });
  });

  describe('prayer title chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'timed-prayer' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Opening prayer';
    const description = 'Keep the description';
    const updates = [{ id: 'update-1', text: 'Keep the update', createdAt: '2026-11-08T00:00:00.000Z' }];
    const seed = () => processCommand(owner, { ...base, operationId: 'prayer-create', kind: 'create', generation: null,
      value: { userId: owner, title, description, status: 'active', updates,
        createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const change = (operationId: string, nextTitle: string, offset: number) => ({
      ...base, operationId, kind: 'update', generation: 'prayer-create',
      changes: [{ path: ['title'], before: { exists: true, value: title }, after: { exists: true, value: nextTitle } }],
      prayerTitleAction: { before: title, after: nextTitle, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
    });

    it.each([20, 80])('orders a delayed prayer rename without touching its other fields (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = 'Computer prayer', phone = 'Phone prayer';
      expect((await processCommand(owner, change('desktop-rename', desk, 40))).kind).toBe('acknowledged');
      const command = change('phone-rename', phone, offset);
      const result = await processCommand(owner, command);
      expect(result).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: offset < 40 ? desk : phone, description, updates, status: 'active' } },
      });
      const list = () => listPrayerTitleHistory(owner, resource.id, 'prayer-create');
      expect(await list()).toMatchObject({
        entries: [{ title: offset < 40 ? phone : desk, winnerTitle: offset < 40 ? desk : phone }],
      });
      expect(await processCommand(owner, command)).toEqual(result);
      expect((await list()).entries).toHaveLength(1);
      await expect(listPrayerTitleHistory('another-owner', resource.id, 'prayer-create')).rejects.toMatchObject({ status: 403 });
      await expect(listPrayerTitleHistory(owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
    });

    it.each(['restored', 'repeated'] as const)('protects a %s prayer title from a legacy rename without ordering evidence', async scenario => {
      expect((await seed()).kind).toBe('acknowledged');
      const middle = 'Computer prayer';
      expect((await processCommand(owner, change('desktop-rename', middle, 40))).kind).toBe('acknowledged');
      const currentTitle = scenario === 'restored' ? title : middle;
      const opening = scenario === 'restored' ? middle : title;
      const words = (before: string, after: string) => [{ path: ['title'], before: { exists: true, value: before },
        after: { exists: true, value: after } }];
      const legacy = (operationId: string, before: string, after: string) => ({
        ...base, operationId, kind: 'update', generation: 'prayer-create', changes: words(before, after),
      });
      expect((await processCommand(owner, legacy('desktop-confirmation', opening, currentTitle))).kind).toBe('acknowledged');

      const offline = legacy('phone-rename', currentTitle, 'Phone prayer');
      const result = await processCommand(owner, offline);
      expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { title: currentTitle, description, updates } },
        conflicts: [{ path: ['title'], mine: { value: 'Phone prayer' }, theirs: { value: currentTitle } }] });
      expect(await processCommand(owner, offline)).toEqual(result);

      if (result.kind !== 'conflict') throw new Error('Missing reviewed prayer');
      const explicit = { ...legacy('choose-title', currentTitle, 'Phone prayer'),
        prayerTitleAction: { before: currentTitle, after: 'Phone prayer', time: null, observedRevision: result.snapshot.metadata!.revision } };
      expect(await processCommand(owner, explicit)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Phone prayer', description, updates } } });
    });

    it.each([
      { phoneAt: 20, code: 'prayer-text-settled' }, { phoneAt: 80, code: 'prayer-text-queued' },
    ])('reports an independently ordered description during a returned prayer title choice ($code)', async ({ phoneAt, code }) => {
      expect((await seed()).kind).toBe('acknowledged');
      const field = (name: string, before: string, after: string) => ({ path: [name],
        before: { exists: true, value: before }, after: { exists: true, value: after } });
      const timedText = (at: number, revision = 1) => ({ description: { observedRevision: revision,
        time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } } });
      const desktopText = 'Computer description', phoneText = 'Phone description';
      const desk = change('desktop-rename', 'Computer title', 40);
      expect((await processCommand(owner, { ...desk, changes: [...desk.changes, field('description', description, desktopText)],
        prayerTextActions: timedText(40) })).kind).toBe('acknowledged');
      const restore = change('desktop-restore', title, 55);
      expect((await processCommand(owner, { ...restore, changes: [field('title', 'Computer title', title)],
        prayerTitleAction: { ...restore.prayerTitleAction, before: 'Computer title', observedRevision: 2 } })).kind).toBe('acknowledged');

      const { prayerTitleAction, ...legacy } = change('phone-rename', 'Phone title', phoneAt);
      const phone = { ...legacy, changes: [...legacy.changes, field('description', description, phoneText)], prayerTextActions: timedText(phoneAt) };
      const answer = await processCommand(owner, phone);
      expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { title, description: desktopText, updates } },
        conflicts: [{ path: ['title'] }, { path: ['description'], code, mine: { value: phoneText }, theirs: { value: desktopText } }] });

      if (code === 'prayer-text-queued') {
        const editedDescription = (operationId: string, before: string, after: string, at: number, revision: number) =>
          processCommand(owner, { ...legacy, operationId, changes: [field('description', before, after)], prayerTextActions: timedText(at, revision) });
        expect((await editedDescription('desktop-text-new', desktopText, 'Temporary description', 95, 3)).kind).toBe('acknowledged');
        expect((await editedDescription('desktop-text-return', 'Temporary description', desktopText, 105, 4)).kind).toBe('acknowledged');
        const saved = await processCommand(owner, { ...phone, operationId: 'choose-phone-title',
          prayerTitleAction: { ...prayerTitleAction, observedRevision: 5 } });
        expect(saved).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Phone title', description: desktopText, updates } } });
      }
    });

    it('keeps a later tag removal when choosing the title from an older combined prayer edit', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const tag = 'Temporary tag';
      const value = (input: string | string[]) => ({ exists: true, value: input });
      const clock = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at });
      const membership = (before: boolean, at: number, observedRevision: number) => ({
        tag, before, after: !before, observedRevision, time: clock(at),
      });
      const add = { path: ['tags'], before: { exists: false }, after: value([tag]) };
      const remove = { path: ['tags'], before: value([tag]), after: { exists: false } };
      const desk = change('desk-title-and-tag', 'Temporary title', 40);
      expect((await processCommand(owner, { ...desk, changes: [...desk.changes, add],
        tagMembershipActions: [membership(false, 40, 1)] })).kind).toBe('acknowledged');
      const restore = change('desk-restore', title, 65);
      expect((await processCommand(owner, { ...restore,
        changes: [{ path: ['title'], before: value('Temporary title'), after: value(title) }, remove],
        prayerTitleAction: { ...restore.prayerTitleAction, before: 'Temporary title', observedRevision: 2 },
        tagMembershipActions: [membership(true, 65, 2)],
      })).kind).toBe('acknowledged');
      const { prayerTitleAction, ...legacy } = change('phone-title-and-tag', 'Phone prayer', 20);
      const original = { ...legacy, changes: [...legacy.changes, add], tagMembershipActions: [membership(false, 20, 1)] };
      expect(await processCommand(owner, original)).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['title'] }] });
      const chosen = await processCommand(owner, { ...original, operationId: 'choose-phone-title',
        prayerTitleAction: { ...prayerTitleAction, observedRevision: 3, time: clock(80) } });
      expect(chosen).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Phone prayer', description, updates } } });
      if (chosen.kind !== 'acknowledged') throw new Error('Missing prayer choice receipt');
      expect(chosen.snapshot.value?.tags ?? []).toEqual([]);
    });

    it('offers a choice for an unseen title after the opening text was restored elsewhere', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const desk = 'Computer prayer';
      expect((await processCommand(owner, change('desktop-rename', desk, 40))).kind).toBe('acknowledged');
      const restore = change('desktop-restore', title, 70);
      expect((await processCommand(owner, { ...restore,
        changes: [{ path: ['title'], before: { exists: true, value: desk }, after: { exists: true, value: title } }],
        prayerTitleAction: { ...restore.prayerTitleAction, before: desk, observedRevision: 2 },
      })).kind).toBe('acknowledged');
      const phone = change('phone-rename', 'Phone prayer', 20);
      expect(await processCommand(owner, { ...phone, prayerTitleAction: { ...phone.prayerTitleAction, time: null } }))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['title'] }], snapshot: { value: { title, description, updates } } });
    });
  });

  describe('prayer text returned to the original', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'restored-prayer-text' };
    const title = 'Keep the prayer title';
    const added = '2026-11-08T00:00:00.000Z';
    const updates = [{ id: 'update-1', text: 'Keep the update', createdAt: added }];

    it.each([
      { field: 'description', openingText: 'The current prayer description' },
      { field: 'description', openingText: undefined },
      { field: 'answerText', openingText: 'The current answer' },
    ] as const)('keeps a later return in $field with opening $openingText when the earlier legacy packet first arrives', async ({ field, openingText }) => {
      const seed = await processCommand(owner, {
        protocol: 1, owner, resource, operationId: 'prayer-text-created', kind: 'create', generation: null, dependsOn: [],
        value: {
          userId: owner, title, status: 'answered', answeredAt: added, createdAt: added, updatedAt: added, updates,
          ...(openingText === undefined ? {} : { [field]: openingText }),
        },
      });
      if (seed.kind !== 'acknowledged') throw new Error(JSON.stringify(seed));
      const edit = (from: typeof seed.snapshot, next: string | undefined, id: string) => {
        const draft = { ...from.value };
        if (next === undefined) delete draft[field];
        else draft[field] = next;
        return prepareDomainCommand(owner, id, from, draft).command;
      };
      const queued = edit(seed.snapshot, 'Earlier offline words', 'prayer-phone-early');
      const changed = await processCommand(owner, edit(seed.snapshot, 'Temporary computer words', 'prayer-computer-change'));
      if (changed.kind !== 'acknowledged') throw new Error(JSON.stringify(changed));
      const restored = await processCommand(owner, edit(changed.snapshot, openingText, 'prayer-computer-return'));
      if (restored.kind !== 'acknowledged') throw new Error(JSON.stringify(restored));

      expect(restored.snapshot.value?.[field]).toBe(openingText);
      const late = await processCommand(owner, queued);
      expect(late).toMatchObject({ kind: 'conflict', conflicts: [{ path: [field] }], snapshot: { value: { title, updates, answeredAt: added } } });
      if (late.kind !== 'conflict') throw new Error(JSON.stringify(late));
      expect(late.snapshot.value?.[field]).toBe(openingText);
      expect(await processCommand(owner, queued)).toEqual(late);
    });
  });

  describe('prayer status chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'prayerRequests', id: 'prayer-status' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const title = 'Prayer with an earlier answer';
    const answerText = 'Keep this earlier answer exactly.';
    const historicalAt = '2026-10-03T09:00:00.000Z', deskAt = '2026-11-08T08:00:00.000Z', phoneAt = '2026-11-08T10:00:00.000Z';
    const seed = () => processCommand(owner, { ...base, operationId: 'status-seed', kind: 'create', generation: null,
      value: { userId: owner, title, answerText, answeredAt: historicalAt, status: 'active', updates: [],
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' } });
    const field = (value: string) => ({ exists: true, value });
    const change = (operationId: string, status: 'answered' | 'not_answered', offset: number, answeredAt?: string) => {
      const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return { ...base, operationId, kind: 'update', generation: 'status-seed',
        changes: [{ path: ['status'], before: field('active'), after: field(status) },
          ...(answeredAt ? [{ path: ['answeredAt'], before: field(historicalAt), after: field(answeredAt) }] : [])],
        prayerStatusAction: { before: 'active', after: status, observedRevision: 1, time },
        ...(answeredAt && { prayerAnsweredAtAction: { observedRevision: 1, time } }) };
    };

    it.each([20, 80])('orders opposing marks while keeping written words and answer history (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desk-mark', 'not_answered', 40))).kind).toBe('acknowledged');
      expect(await processCommand(owner, change('phone-mark', 'answered', offset, phoneAt))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title, answerText, answeredAt: phoneAt,
          status: offset < 40 ? 'not_answered' : 'answered' } },
      });
      const winner = offset < 40 ? 'not_answered' : 'answered';
      const earlier = offset < 40 ? 'answered' : 'not_answered';
      expect(await listPrayerStatusHistory(owner, resource.id, 'status-seed')).toMatchObject({
        entries: [{ fields: [{ field: 'status', value: earlier, winner }] }],
      });
      await expect(listPrayerStatusHistory('another-owner', resource.id, 'status-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listPrayerStatusHistory(owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
      const restore = change('restore-status', earlier, 120);
      expect(await processCommand(owner, { ...restore,
        changes: [{ path: ['status'], before: field(winner), after: field(earlier) }],
        prayerStatusAction: { ...restore.prayerStatusAction, before: winner, observedRevision: 3 },
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title, answerText, answeredAt: phoneAt, status: earlier } } });
    });

    it.each([20, 80])('orders the answer date when two marks choose the same status (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(owner, change('desk-answer', 'answered', 40, deskAt))).kind).toBe('acknowledged');
      const command = change('phone-answer', 'answered', offset, phoneAt);
      const result = await processCommand(owner, command);
      expect(result).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title, answerText, status: 'answered', answeredAt: offset < 40 ? deskAt : phoneAt } },
      });
      expect(await processCommand(owner, command)).toEqual(result);
      expect(await listPrayerStatusHistory(owner, resource.id, 'status-seed')).toMatchObject({
        entries: [{ fields: [{ field: 'answeredAt', value: offset < 40 ? phoneAt : deskAt, winner: offset < 40 ? deskAt : phoneAt }] }],
      });
    });

    it('retains the manual choice for distinct words even when the status and date can be ordered', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const answer = (id: string, text: string, offset: number, date: string) => {
        const mark = change(id, 'answered', offset, date);
        return { ...mark, changes: [...mark.changes, { path: ['answerText'], before: field(answerText), after: field(text) }] };
      };
      expect((await processCommand(owner, answer('desk-words', 'Computer answer', 40, deskAt))).kind).toBe('acknowledged');
      expect(await processCommand(owner, answer('phone-words', 'Phone answer', 80, phoneAt))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['answerText'] }],
        snapshot: { value: { title, status: 'answered', answerText: 'Computer answer', answeredAt: deskAt } },
      });
      expect((await listPrayerStatusHistory(owner, resource.id, 'status-seed')).entries).toHaveLength(0);
    });
  });

  describe('series metadata chronology', () => {
    const resource = { collection: 'series', id: 'timed-series' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const original = { userId: base.owner, title: 'Opening title', theme: 'Legacy theme', bookOrTopic: 'Opening book',
      status: 'draft', color: '#3B82F6', description: 'Keep the full description', sermonIds: [], items: [], seriesKind: 'sermon',
      createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' };
    const desk = { title: 'Desk title', theme: 'Desk title', bookOrTopic: 'Desk book', status: 'active', color: '#10B981' };
    const phone = { title: 'Phone title', theme: 'Phone title', bookOrTopic: 'Phone book', status: 'completed', color: '#F59E0B' };
    const edit = (id: string, value: Partial<typeof desk>, offset: number | null) => ({
      ...base, kind: 'update', operationId: id, generation: 'series-seed',
      changes: Object.entries(value).map(([key, next]) => ({
        path: [key], before: { exists: true, value: original[key as keyof typeof desk] }, after: { exists: true, value: next },
      })),
      seriesFieldActions: Object.fromEntries(Object.keys(value).filter(field => field !== 'theme').map(field => [field, {
        observedRevision: 1, time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
      }])),
    });
    const seed = () => processCommand(base.owner, { ...base, operationId: 'series-seed', kind: 'create', generation: null, value: original });

    it.each([
      { offset: 20, winning: desk },
      { offset: 80, winning: phone },
    ])('keeps short fields and the title mirror from the last action when delivery is delayed ($offset)', async ({ offset, winning }) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', desk, 40))).kind).toBe('acknowledged');
      const command = edit('series-phone', phone, offset);
      const result = await processCommand(base.owner, command);
      expect(result).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { ...winning, description: original.description, items: [], sermonIds: [] } },
      });
      const lost = winning === desk ? phone : desk;
      const expected = (['title', 'bookOrTopic', 'status', 'color'] as const).map(field => ({ field, value: lost[field], winner: winning[field] }));
      const history = () => listSeriesMetadataHistory(base.owner, resource.id, 'series-seed');
      expect(await history()).toMatchObject({ entries: [{ fields: expected }] });
      await expect(listSeriesMetadataHistory('other-owner', resource.id, 'series-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSeriesMetadataHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, command)).toEqual(result);
      expect((await history()).entries).toHaveLength(1);
    });

    it.each([
      { label: 'earlier phone action', opening: original.description, offset: 20, proof: true, expected: original.description },
      { label: 'later phone action', opening: original.description, offset: 80, proof: true, expected: 'Phone description' },
      { label: 'unknown phone time', opening: original.description, offset: null, proof: true, expected: null },
      { label: 'older client and absent opening', opening: undefined, offset: null, proof: false, expected: null },
    ])('protects a return to the original description with $label', async ({ opening, offset, proof, expected }) => {
      const { description: _description, ...unchanged } = original;
      const created = await processCommand(base.owner, { ...base, operationId: 'series-seed', kind: 'create', generation: null,
        value: { ...unchanged, ...(opening !== undefined && { description: opening }) } });
      if (created.kind !== 'acknowledged') throw new Error(JSON.stringify(created));
      const field = (value: string | undefined) => value === undefined ? { exists: false } : { exists: true, value };
      const descriptionEdit = (operationId: string, from: string | undefined, to: string | undefined, revision: number, at: number | null) => ({
        ...base, kind: 'update', operationId, generation: 'series-seed',
        changes: [{ path: ['description'], before: field(from), after: field(to) }],
        ...(proof && { seriesFieldActions: { description: { observedRevision: revision,
          time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at } } } }),
      });
      expect((await processCommand(base.owner, descriptionEdit('series-desk', opening, 'Temporary words', 1, 40))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, descriptionEdit('series-return', 'Temporary words', opening, 2, 60))).kind).toBe('acknowledged');
      const command = descriptionEdit('series-phone', opening, 'Phone description', 1, offset);
      const result = await processCommand(base.owner, command);
      expect(result).toMatchObject({ kind: expected === null ? 'conflict' : 'acknowledged',
        snapshot: { value: { title: original.title, bookOrTopic: original.bookOrTopic, status: original.status } } });
      if (result.kind !== 'conflict' && result.kind !== 'acknowledged') throw new Error(JSON.stringify(result));
      expect(result.snapshot.value?.description).toBe(expected ?? opening);
      if (result.kind === 'conflict') {
        expect(result.conflicts).toMatchObject([{ path: ['description'], mine: field('Phone description'), theirs: field(opening) }]);
      }
      expect(await processCommand(base.owner, command)).toEqual(result);
    });

    it.each(['return', 'reaffirm'])('protects a series title with a legacy %s before the first delayed save', async kind => {
      expect((await seed()).kind).toBe('acknowledged');
      const { seriesFieldActions: _proof, ...rename } = edit('series-phone', { title: phone.title, theme: phone.theme }, null);
      const field = (value: string) => ({ exists: true, value });
      const restore = {
        ...rename, operationId: 'series-return',
        changes: [
          { path: ['title'], before: field(desk.title), after: field(original.title) },
          { path: ['theme'], before: field(desk.theme), after: field(original.theme) },
        ],
      };
      if (kind === 'return') {
        expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      }
      expect((await processCommand(base.owner, restore)).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-independent', { bookOrTopic: desk.bookOrTopic }, 80))).kind).toBe('acknowledged');

      const answer = await processCommand(base.owner, rename);
      expect(answer).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['title'], mine: field(phone.title), theirs: field(original.title) }],
        snapshot: { value: { title: original.title, theme: original.theme, bookOrTopic: desk.bookOrTopic } },
      });
      expect(await processCommand(base.owner, rename)).toEqual(answer);
    });

    it.each([
      { key: 'bookOrTopic', opening: original.bookOrTopic, temporary: desk.bookOrTopic, delayed: phone.bookOrTopic },
      { key: 'status', opening: original.status, temporary: desk.status, delayed: phone.status },
      { key: 'color', opening: original.color, temporary: desk.color, delayed: phone.color },
      { key: 'color', opening: undefined, temporary: desk.color, delayed: phone.color },
      { key: 'bookOrTopic', opening: original.bookOrTopic, temporary: desk.bookOrTopic, delayed: phone.bookOrTopic, reaffirm: true },
    ])('holds a legacy series $key save after restoring $opening (reaffirm=$reaffirm)', async ({ key, opening, temporary, delayed, reaffirm }) => {
      const value: Record<string, string | string[]> = { ...original, ...(opening !== undefined && { [key]: opening }) };
      if (opening === undefined) delete value[key];
      expect((await processCommand(base.owner, { ...base, operationId: 'series-seed', kind: 'create', generation: null, value })).kind).toBe('acknowledged');
      const field = (value?: string) => value === undefined ? { exists: false } : { exists: true, value };
      const change = (operationId: string, from: string | undefined, to: string | undefined) => ({
        ...base, kind: 'update', operationId, generation: 'series-seed',
        changes: [{ path: [key], before: field(from), after: field(to) }],
      });
      if (!reaffirm) expect((await processCommand(base.owner, change('series-temp', opening, temporary))).kind).toBe('acknowledged');
      const undo = change('series-return', temporary, opening);
      expect((await processCommand(base.owner, { ...undo, changes: [...undo.changes,
        { path: ['description'], before: field(original.description), after: field('Independent description') },
      ] })).kind).toBe('acknowledged');

      const command = change('series-late-legacy', opening, delayed);
      const result = await processCommand(base.owner, command);
      expect(result).toMatchObject({ kind: 'conflict', conflicts: [{ path: [key], base: field(opening), mine: field(delayed), theirs: field(opening) }],
        snapshot: { value: { title: original.title, theme: original.theme, description: 'Independent description' } } });
      expect(documents.get('series/timed-series')?.[key]).toBe(opening);
      expect(await processCommand(base.owner, command)).toEqual(result);
    });

    it.each([20, 80])('includes the proven description order when the series title needs review (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const field = (value: string) => ({ exists: true, value });
      const description = (value: string) => ({ path: ['description'], before: field(original.description), after: field(value) });
      const time = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at });
      const first = edit('series-desk', { title: desk.title, theme: desk.theme }, 40);
      expect((await processCommand(base.owner, { ...first, changes: [...first.changes, description('Desktop description')],
        seriesFieldActions: { ...first.seriesFieldActions, description: { observedRevision: 1, time: time(40) } } })).kind).toBe('acknowledged');
      const returned = {
        ...edit('series-return', {}, null),
        changes: [{ path: ['title'], before: field(desk.title), after: field(original.title) },
          { path: ['theme'], before: field(desk.theme), after: field(original.theme) }],
      };
      expect((await processCommand(base.owner, returned)).kind).toBe('acknowledged');
      const phoneUpdate = edit('series-phone', { title: phone.title, theme: phone.theme }, null);
      const result = await processCommand(base.owner, { ...phoneUpdate, changes: [...phoneUpdate.changes, description('Phone description')],
        seriesFieldActions: { description: { observedRevision: 1, time: time(offset) } } });
      expect(result).toMatchObject({
        kind: 'conflict', conflicts: expect.arrayContaining([
          { path: ['title'], base: field(original.title), mine: field(phone.title), theirs: field(original.title) },
          { path: ['description'], code: offset < 40 ? 'series-metadata-settled' : 'series-metadata-queued',
            base: field(original.description), mine: field('Phone description'), theirs: field('Desktop description') },
        ]),
        snapshot: { value: { title: original.title, description: 'Desktop description' } },
      });
    });

    it.each([
      { offset: 20, code: 'series-metadata-settled', separateTheme: false },
      { offset: 80, code: 'series-metadata-queued', separateTheme: false },
      { offset: 20, code: 'series-metadata-settled', separateTheme: true },
    ])('identifies ordered title siblings while a book choice is pending ($offset, separate=$separateTheme)', async ({ offset, code, separateTheme }) => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.title, bookOrTopic: desk.bookOrTopic }, 40))).kind)
        .toBe('acknowledged');
      const field = (value: string) => ({ exists: true, value });
      const undo = { ...edit('series-return', {}, null),
        changes: [{ path: ['bookOrTopic'], before: field(desk.bookOrTopic), after: field(original.bookOrTopic) },
          ...(separateTheme ? [{ path: ['theme'], before: field(desk.title), after: field('Independent theme') }] : [])] };
      expect((await processCommand(base.owner, undo)).kind).toBe('acknowledged');
      const delayed = edit('series-phone', { title: phone.title, theme: phone.title, bookOrTopic: phone.bookOrTopic }, offset);
      const { bookOrTopic: _book, ...seriesFieldActions } = delayed.seriesFieldActions;
      const answer = await processCommand(base.owner, { ...delayed, seriesFieldActions });
      const theme = separateTheme ? { path: ['theme'], theirs: field('Independent theme') }
        : { path: ['theme'], theirs: field(desk.title), code };
      expect(answer).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([
        expect.objectContaining({ path: ['bookOrTopic'], mine: field(phone.bookOrTopic), theirs: field(original.bookOrTopic) }),
        expect.objectContaining({ path: ['title'], mine: field(phone.title), theirs: field(desk.title), code }),
        expect.objectContaining(theme),
      ]) });
      if (separateTheme && answer.kind === 'conflict') {
        expect(answer.conflicts.find(({ path }) => path[0] === 'theme')?.code).toBeUndefined();
      }
      const history = await listSeriesMetadataHistory(base.owner, resource.id, 'series-seed');
      if (offset < 40) expect(history).toMatchObject({ entries: [{ fields: [{ field: 'title', value: phone.title, winner: desk.title }] }] });
      else expect(history.entries).toEqual([]);
    });

    it('orders a later custom CSS color and retains a displaced absence for restoration', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      const deskColor = edit('series-desk', { color: desk.color }, 40);
      expect((await processCommand(base.owner, { ...deskColor, changes: [{
        path: ['color'], before: { exists: true, value: original.color }, after: { exists: false },
      }] })).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { color: 'rebeccapurple' }, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { color: 'rebeccapurple' } },
      });
      expect(await listSeriesMetadataHistory(base.owner, resource.id, 'series-seed')).toMatchObject({
        entries: [{ fields: [{ field: 'color', value: null, winner: 'rebeccapurple' }] }],
      });
    });

    it('preserves the title mirror when the later rename originally matched the legacy theme', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      const rename = edit('series-phone', { title: original.theme }, 80);
      const time = { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_085 };
      expect(await processCommand(base.owner, { ...rename, seriesFieldActions: {
        title: { observedRevision: 1, time, openingTheme: original.theme },
      } })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: original.theme, theme: original.theme } } });
    });

    it('does not order a separate legacy theme edit by the time of a title rename', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, { ...edit('series-old-theme', { theme: 'Independent legacy theme' }, null),
        changes: [{ path: ['theme'], before: { exists: true, value: desk.theme }, after: { exists: true, value: 'Independent legacy theme' } }],
      })).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { title: phone.title, theme: phone.theme }, 80))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['theme'] }],
        snapshot: { value: { title: desk.title, theme: 'Independent legacy theme' } },
      });
      expect((await listSeriesMetadataHistory(base.owner, resource.id, 'series-seed')).entries).toEqual([]);
    });

    it.each([45, null])('keeps the original status conflict when the action order is uncertain (%s)', async offset => {
      expect((await seed()).kind).toBe('acknowledged');
      const earlier = edit('series-desk', { status: desk.status }, 40);
      expect((await processCommand(base.owner, earlier)).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { status: phone.status }, offset))).toMatchObject({
        kind: 'conflict', snapshot: { value: { status: desk.status, theme: original.theme } }, conflicts: [{ path: ['status'] }],
      });
    });

    it('keeps independent metadata edits from different devices', async () => {
      expect((await seed()).kind).toBe('acknowledged');
      expect((await processCommand(base.owner, edit('series-desk', { title: desk.title, theme: desk.theme }, 40))).kind).toBe('acknowledged');
      expect(await processCommand(base.owner, edit('series-phone', { status: phone.status }, 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { title: desk.title, theme: desk.theme, status: phone.status } },
      });
    });
  });

  describe('sermon plan mode chronology', () => {
    const time = (offset: number) => ({ earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset });
    const missing = { exists: false };
    const field = (value: string) => ({ exists: true, value });
    function select(id: string, before: { exists: boolean; value?: string }, mode: string, at: number | null, initialize?: true) {
      return { ...update(id, 'plan-mode-seed'), changes: [{ path: ['planMode'], before, after: field(mode) }],
        sermonPlanModeAction: { observedRevision: 1, time: at === null ? null : time(at), ...(initialize && { initialize }) } };
    }
    async function seedMode() {
      const seed = create('plan-mode-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(seed.owner, seed)).toMatchObject({ kind: 'acknowledged' });
      return seed.owner;
    }

    it.each([
      { phoneAt: 20, winner: 'ai', outcome: 'acknowledged' },
      { phoneAt: 80, winner: 'note', outcome: 'acknowledged' },
      { phoneAt: null, winner: 'ai', outcome: 'conflict' },
    ] as const)('keeps the latest explicit plan mode at $phoneAt without changing plan words', async ({ phoneAt, winner, outcome }) => {
      const seed = create('plan-mode-seed') as Extract<DataCommand, { kind: 'create' }>;
      const original = {
        ...seed.value, planMode: 'manual', planText: { 'point-1': 'The saved plan words' },
        outline: { introduction: [{ id: 'point-1', text: 'Opening' }], main: [], conclusion: [] },
      };
      expect(await processCommand(seed.owner, { ...seed, value: original })).toMatchObject({ kind: 'acknowledged' });
      const switchMode = (id: string, mode: 'ai' | 'note', at: number | null) => ({
        ...update(id, 'plan-mode-seed'),
        changes: [{ path: ['planMode'], before: { exists: true, value: 'manual' }, after: { exists: true, value: mode } }],
        sermonPlanModeAction: { observedRevision: 1, time: at === null ? null : {
          earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at,
        } },
      });
      expect(await processCommand(seed.owner, switchMode('plan-desktop', 'ai', 40))).toMatchObject({ kind: 'acknowledged' });
      const answer = await processCommand(seed.owner, switchMode('plan-phone', 'note', phoneAt));
      expect(answer).toMatchObject({ kind: outcome, snapshot: {
        value: { planMode: winner, planText: original.planText, outline: original.outline },
      } });
      if (outcome === 'conflict') expect(answer).toMatchObject({ conflicts: [{ path: ['planMode'] }] });
      else {
        const history = await listSermonPlanModeHistory(seed.owner, seed.resource.id, 'plan-mode-seed');
        expect(history.entries).toEqual([expect.objectContaining({ planMode: winner === 'ai' ? 'note' : 'ai', winnerPlanMode: winner })]);
        await expect(listSermonPlanModeHistory('another-owner', seed.resource.id, 'plan-mode-seed')).rejects.toMatchObject({ status: 403 });
        await expect(listSermonPlanModeHistory(seed.owner, seed.resource.id, 'older-generation')).rejects.toMatchObject({ status: 404 });
      }
    });

    it.each([false, true])('only uses the automatic default if no explicit mode has arrived (default first: %s)', async defaultFirst => {
      const owner = await seedMode();
      const fallback = select('plan-default', missing, 'ai', null, true);
      const explicit = select('plan-explicit', missing, 'note', 60);
      expect(await processCommand(owner, defaultFirst ? fallback : explicit)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, defaultFirst ? explicit : fallback))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { planMode: 'note' } } });
      const history = await listSermonPlanModeHistory(owner, fallback.resource.id, 'plan-mode-seed');
      expect(history.entries).toEqual([]);
    });

    it('records an explicit choice of the same mode as a provisional default', async () => {
      const owner = await seedMode();
      await processCommand(owner, select('plan-default', missing, 'note', null, true));
      const explicit = select('plan-explicit', field('note'), 'note', 60);
      explicit.sermonPlanModeAction.observedRevision = 2;
      expect(await processCommand(owner, explicit)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, select('plan-earlier', missing, 'ai', 20)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { planMode: 'note' } } });
    });

    it.each([false, true])('keeps a restored plan mode when an older unproved choice arrives (reaffirmed: %s)', async reaffirmed => {
      const owner = await seedMode();
      const legacy = (id: string, from: typeof missing | ReturnType<typeof field>, to: string) => ({
        ...update(id, 'plan-mode-seed'), changes: [{ path: ['planMode'], before: from, after: field(to) }],
      });
      const words = { opening: 'Independently saved plan text' };
      expect((await processCommand(owner, { ...legacy('opening-plan-mode', missing, 'manual'),
        changes: [...legacy('opening-plan-mode', missing, 'manual').changes,
          { path: ['planText'], before: missing, after: { exists: true, value: words } }] })).kind).toBe('acknowledged');
      if (!reaffirmed) expect((await processCommand(owner, legacy('temporary-mode', field('manual'), 'ai'))).kind).toBe('acknowledged');
      expect((await processCommand(owner, legacy('return-mode', field('ai'), 'manual'))).kind).toBe('acknowledged');
      const late = legacy('old-note-entry', field('manual'), 'note');
      const answer = await processCommand(owner, late);
      expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { planMode: 'manual', planText: words } },
        conflicts: [{ path: ['planMode'], base: field('manual'), mine: field('note'), theirs: field('manual') }] });
      expect(await processCommand(owner, late)).toEqual(answer);
    });

    it('keeps the provisional proof when a legacy copy only repeats the same default', async () => {
      const owner = await seedMode();
      const fallback = select('plan-default', missing, 'ai', null, true);
      expect((await processCommand(owner, fallback)).kind).toBe('acknowledged');
      const legacy = { ...update('legacy-fallback', 'plan-mode-seed'), changes: fallback.changes };
      expect((await processCommand(owner, legacy)).kind).toBe('acknowledged');
      expect(await processCommand(owner, select('real-note-choice', missing, 'note', 60)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { planMode: 'note' } } });
      expect((await listSermonPlanModeHistory(owner, fallback.resource.id, 'plan-mode-seed')).entries).toEqual([]);
    });

    it('compares again if a newer plan mode arrives between review and save', async () => {
      const owner = await seedMode();
      expect((await processCommand(owner, select('manual-mode', missing, 'manual', 20))).kind).toBe('acknowledged');
      const next = select('thoughts-mode', field('manual'), 'ai', 40);
      next.sermonPlanModeAction.observedRevision = 2;
      expect((await processCommand(owner, next)).kind).toBe('acknowledged');
      const reviewed = (id: string, from: string, revision: number) => {
        const command = select(id, field(from), 'note', 80);
        return { ...command, sermonPlanModeAction: { ...command.sermonPlanModeAction, observedRevision: revision, reviewed: true as const } };
      };
      expect(await processCommand(owner, reviewed('stale-choice', 'manual', 2))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['planMode'], code: 'sermon-plan-mode-review-changed', theirs: field('ai') }],
      });
      expect(await processCommand(owner, reviewed('fresh-choice', 'ai', 3))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { planMode: 'note' } },
      });
    });
  });

  describe('sermon preparation goal type chronology', () => {
    const opening = { preachingGoal: { type: 'informative', statement: 'Keep this goal sentence' } };
    const preparation = (type: string, statement = opening.preachingGoal.statement) => ({
      ...opening, preachingGoal: { type, statement },
    });
    function savePreparation(operationId: string, after: typeof opening, offset?: number) {
      return {
        ...update(operationId, 'prep-goal-seed'),
        changes: [{ path: ['preparation'], before: { exists: true, value: opening }, after: { exists: true, value: after } }],
        ...(offset === undefined ? {} : {
          sermonGoalTypeAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
        }),
      };
    }
    async function seed() {
      const command = create('prep-goal-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: opening } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    it.each([
      { phoneAt: 20, winner: 'exhortative' },
      { phoneAt: 80, winner: 'didactic' },
    ])('keeps the known later choice when the offline choice was saved at $phoneAt', async ({ phoneAt, winner }) => {
      const owner = await seed();
      expect(await processCommand(owner, savePreparation('desk', preparation('exhortative'), 40)))
        .toMatchObject({ kind: 'acknowledged' });
      const phone = savePreparation('phone', preparation('didactic'), phoneAt);
      const result = await processCommand(owner, phone);
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation(winner) } } });
      const history = () => listSermonGoalTypeHistory(owner, resource.id, 'prep-goal-seed');
      const previous = winner === 'didactic' ? 'exhortative' : 'didactic';
      expect(await history()).toMatchObject({ entries: [{ type: previous, winnerType: winner }], nextCursor: null });
      expect(await processCommand(owner, phone)).toEqual(result);
      expect((await history()).entries).toHaveLength(1);
    });

    it('retains the clock across a separate sentence save and keeps that sentence', async () => {
      const owner = await seed();
      const first = preparation('exhortative');
      const words = 'A later independently edited goal sentence';
      expect(await processCommand(owner, savePreparation('desk', first, 40))).toMatchObject({ kind: 'acknowledged' });
      const sentence = savePreparation('sentence', preparation('exhortative', words));
      sentence.changes[0].before.value = first;
      expect(await processCommand(owner, sentence)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePreparation('phone', preparation('didactic'), 80)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation('didactic', words) } } });
      await expect(listSermonGoalTypeHistory('another-owner', resource.id, 'prep-goal-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSermonGoalTypeHistory(owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('keeps the ordinary conflict when the order cannot be proven', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePreparation('desk', preparation('exhortative'), 40)))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePreparation('phone', preparation('didactic')))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'preachingGoal', 'type'] }],
      });
    });

    it('merges the separate goal sentence with the selected type', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePreparation('desk', preparation('informative', 'A separately edited sentence'))))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePreparation('phone', preparation('didactic'), 20)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation('didactic', 'A separately edited sentence') } } });
    });

    it.each([false, true])('holds a delayed goal type after returning to its opening (reaffirmed: %s)', async reaffirmed => {
      const owner = await seed();
      const words = 'A later independent goal sentence';
      const temporary = preparation('exhortative');
      if (!reaffirmed) expect((await processCommand(owner, savePreparation('temporary', temporary))).kind).toBe('acknowledged');
      const restored = savePreparation('restored', preparation('informative', words));
      restored.changes[0].before.value = reaffirmed ? preparation('exhortative', words) : temporary;
      if (reaffirmed) {
        expect((await processCommand(owner, savePreparation('statement', preparation('informative', words)))).kind).toBe('acknowledged');
      }
      expect((await processCommand(owner, restored)).kind).toBe('acknowledged');
      const delayed = savePreparation('late-phone', preparation('didactic'));
      const answer = await processCommand(owner, delayed);
      const field = (value: string) => ({ exists: true, value });
      expect(answer).toMatchObject({
        kind: 'conflict', snapshot: { value: { preparation: preparation('informative', words) } },
        conflicts: [{ path: ['preparation', 'preachingGoal', 'type'], base: field('informative'),
          mine: field('didactic'), theirs: field('informative') }],
      });
      expect(await processCommand(owner, delayed)).toEqual(answer);
    });

    it('checks the reviewed goal type revision while preserving a separately saved statement', async () => {
      const owner = await seed();
      const newer = preparation('proclamation');
      const words = 'A still newer goal statement';
      expect((await processCommand(owner, savePreparation('new-type', newer, 40))).kind).toBe('acknowledged');
      const statement = savePreparation('new-words', preparation('proclamation', words));
      statement.changes[0].before.value = newer;
      expect((await processCommand(owner, statement)).kind).toBe('acknowledged');
      const choice = (id: string, before: typeof opening, revision: number) => {
        const command = savePreparation(id, preparation('didactic'), 80);
        command.changes[0].before.value = before;
        command.changes[0].after.value.preachingGoal.statement = before.preachingGoal.statement;
        return { ...command, sermonGoalTypeAction: { time: command.sermonGoalTypeAction!.time, observedRevision: revision, reviewed: true as const } };
      };
      expect(await processCommand(owner, choice('stale-choice', opening, 1))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'preachingGoal', 'type'], code: 'sermon-goal-type-review-changed' }],
      });
      expect(await processCommand(owner, choice('fresh-goal-choice', newer, 2))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: preparation('didactic', words) } },
      });
    });
  });

  describe('sermon Preparation repeated words', () => {
    const words = (repeatedWords: string[] | undefined, contextNotes = 'Original context') => ({
      textContext: { ...(repeatedWords !== undefined && { repeatedWords }), contextNotes,
        passageSummary: 'Independent summary', readWholeBookOnceConfirmed: true },
    });

    it.each([
      { label: 'two replacements', base: ['grace'], stored: ['peace'], incoming: ['mercy'], conflict: true },
      { label: 'a replacement and a clear', base: ['grace'], stored: ['peace'], incoming: [], conflict: true },
      { label: 'a clear and a replacement', base: ['grace'], stored: [], incoming: ['mercy'], conflict: true },
      { label: 'one disputed word in a longer list', base: ['grace', 'faith'], stored: ['peace', 'faith'], incoming: ['mercy', 'faith'], conflict: true },
      { label: 'two independent additions', base: ['grace'], stored: ['grace', 'peace'], incoming: ['grace', 'mercy'], expected: ['grace', 'peace', 'mercy'] },
      { label: 'two independent additions with an omitted list', base: undefined, stored: ['peace'], incoming: ['mercy'], expected: ['peace', 'mercy'] },
      { label: 'replacements of different words', base: ['grace', 'faith'], stored: ['grace', 'peace'], incoming: ['mercy', 'faith'], expected: ['peace', 'mercy'] },
    ])('keeps the exact saved meaning for $label', async ({ base, stored, incoming, expected, conflict }) => {
      const generation = 'repeated-words-seed';
      const initial = words(base);
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: initial } }))
        .toMatchObject({ kind: 'acknowledged' });
      const edit = (id: string, preparation: ReturnType<typeof words>) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: initial }, after: { exists: true, value: preparation } }],
      });
      const desktop = words(stored, 'An independent desktop paragraph');
      expect(await processCommand(command.owner, edit('computer', desktop))).toMatchObject({ kind: 'acknowledged' });
      const reply = await processCommand(command.owner, edit('phone', words(incoming)));
      if (conflict) {
        expect(reply).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'textContext', 'repeatedWords'],
          base: { exists: true, value: base }, mine: { exists: true, value: incoming }, theirs: { exists: true, value: stored },
        }], snapshot: { value: { preparation: desktop } } });
      } else {
        expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: {
          textContext: { ...desktop.textContext, repeatedWords: expected },
        } } } });
      }
    });

    it.each([
      { label: 'older phone', base: ['grace'], stored: ['peace'], incoming: ['mercy'], at: 20, expected: ['peace'] },
      { label: 'newer phone', base: ['grace'], stored: ['peace'], incoming: ['mercy'], at: 80, expected: ['mercy'] },
      { label: 'later phone clear', base: ['grace'], stored: ['peace'], incoming: [], at: 80, expected: [] },
      { label: 'later desktop clear', base: ['grace'], stored: [], incoming: ['mercy'], at: 20, expected: [] },
      { label: 'same word in a longer list', base: ['grace', 'faith'], stored: ['peace', 'faith'], incoming: ['mercy', 'faith'], at: 80, expected: ['mercy', 'faith'] },
      { label: 'different words in a longer list', base: ['grace', 'faith'], stored: ['grace', 'peace'], incoming: ['mercy', 'faith'], at: 80, expected: ['peace', 'mercy'] },
      { label: 'two additions to a previously omitted list', base: undefined, stored: ['peace'], incoming: ['mercy'], at: 80, expected: ['peace', 'mercy'] },
    ])('uses action time only for a competing repeated word: $label', async ({ base, stored, incoming, at, expected }) => {
      const generation = 'repeated-words-timed';
      const initial = words(base);
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: initial } }))
        .toMatchObject({ kind: 'acknowledged' });
      const edit = (id: string, preparation: ReturnType<typeof words>, offset: number) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: initial }, after: { exists: true, value: preparation } }],
        sermonRepeatedWordsAction: { observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } },
      });
      const note = 'Separately saved desktop paragraph';
      expect(await processCommand(command.owner, edit('computer', words(stored, note), 40))).toMatchObject({ kind: 'acknowledged' });
      const delayed = edit('phone', words(incoming), at);
      const reply = await processCommand(command.owner, delayed);
      expect(reply).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: words(expected, note) } } });
      expect(await processCommand(command.owner, delayed)).toEqual(reply);
    });

    it.each([100, null])('retains a same-result decision from a different opening (time: %s)', async laterTime => {
      const generation = 'repeated-words-same-result';
      const original = ['grace'], middle = ['peace'], saved = ['faith'];
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      await processCommand(command.owner, { ...command, value: { ...command.value, preparation: words(original) } });
      const edit = (id: string, before: string[], after: string[], offset: number | null, revision: number) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: words(before) }, after: { exists: true, value: words(after) } }],
        sermonRepeatedWordsAction: { observedRevision: revision,
          time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } },
      });
      for (const action of [edit('first', original, middle, 10, 1), edit('second', middle, saved, 20, 2),
        edit('different-opening-same-result', original, saved, laterTime, 1)]) {
        expect(await processCommand(command.owner, action)).toMatchObject({ kind: 'acknowledged' });
      }
      expect(await processCommand(command.owner, edit('delayed-other-word', middle, ['mercy'], 60, 2))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'textContext', 'repeatedWords'] }],
        snapshot: { value: { preparation: words(saved) } },
      });
    });

    it.each([false, true])('keeps an explicit clear when an older addition saw no repeated-words field (stamped: %s)', async stamped => {
      const generation = 'repeated-words-missing-clear';
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      await processCommand(command.owner, { ...command, value: { ...command.value, preparation: words(undefined) } });
      const edit = (id: string, before: string[] | undefined, after: string[], offset: number, revision: number, hasStamp = true) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: words(before) }, after: { exists: true, value: words(after) } }],
        ...(hasStamp && { sermonRepeatedWordsAction: { observedRevision: revision,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } } }),
      });
      expect(await processCommand(command.owner, edit('added', undefined, ['grace'], 20, 1))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(command.owner, edit('cleared', ['grace'], [], 90, 2))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(command.owner, edit('delayed-add', undefined, ['grace'], 50, 1, stamped))).toMatchObject({
        kind: stamped ? 'acknowledged' : 'conflict', snapshot: { value: { preparation: words([]) } },
      });
    });

    it('replays the exact repeated-words comparison when it does not fit in one receipt', async () => {
      const generation = 'repeated-words-large-receipt';
      const opening = ['g'.repeat(300_000)], stored = ['p'.repeat(300_000)], incoming = ['m'.repeat(300_000)];
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: words(opening) } }))
        .toMatchObject({ kind: 'acknowledged' });
      const edit = (id: string, before: string[], after: string[], contextNotes?: string) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: words(before) }, after: { exists: true, value: words(after, contextNotes) } }],
      });
      expect(await processCommand(command.owner, edit('computer', opening, stored))).toMatchObject({ kind: 'acknowledged' });
      const delayed = edit('phone', opening, incoming);
      const answer = await processCommand(command.owner, delayed);
      expect(answer.kind).toBe('conflict');
      if (answer.kind !== 'conflict') return;
      expect(answer.conflicts).toEqual([{ path: ['preparation', 'textContext', 'repeatedWords'],
        base: { exists: true, value: opening }, mine: { exists: true, value: incoming }, theirs: { exists: true, value: stored },
      }]);
      expect(await processCommand(command.owner, edit('later-context', stored, stored, 'Later context'))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(command.owner, delayed)).toEqual(answer);
    });

    it('does not lend an unrelated list edit clock to an earlier replacement', async () => {
      const generation = 'repeated-words-unrelated-clock';
      const original = ['grace', 'faith'], stored = ['peace', 'faith'], extra = [...stored, 'hope'];
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      await processCommand(command.owner, { ...command, value: { ...command.value, preparation: words(original) } });
      const edit = (id: string, before: string[], after: string[], offset: number, revision: number) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: words(before) }, after: { exists: true, value: words(after) } }],
        sermonRepeatedWordsAction: { observedRevision: revision,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } },
      });
      for (const action of [edit('first', original, stored, 20, 1), edit('add', stored, extra, 60, 2), edit('remove', extra, stored, 90, 3)]) {
        expect(await processCommand(command.owner, action)).toMatchObject({ kind: 'acknowledged' });
      }
      expect(await processCommand(command.owner, edit('old-phone', original, ['mercy', 'faith'], 50, 1))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'textContext', 'repeatedWords'] }],
        snapshot: { value: { preparation: words(stored) } },
      });
    });

    it.each([false, true])('preserves a restored repeated word against a delayed old change (stamped: %s)', async stamped => {
      const generation = 'repeated-words-return';
      const command = create(generation) as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: words(['grace', 'faith']) } }))
        .toMatchObject({ kind: 'acknowledged' });
      const edit = (id: string, before: string[], after: string[], offset: number, revision: number, includeStamp = true) => ({
        ...update(id, generation),
        changes: [{ path: ['preparation'], before: { exists: true, value: words(before) }, after: { exists: true, value: words(after) } }],
        ...(includeStamp && { sermonRepeatedWordsAction: { observedRevision: revision,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } } }),
      });
      const original = ['grace', 'faith'], changed = ['mercy', 'faith'];
      expect(await processCommand(command.owner, edit('desktop-first', original, changed, 20, 1))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(command.owner, edit('desktop-return', changed, original, 90, 2))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(command.owner, edit('old-phone', original, ['peace', 'faith'], 50, 1, stamped))).toMatchObject({
        kind: stamped ? 'acknowledged' : 'conflict', snapshot: { value: { preparation: words(original) } },
      });
    });
  });

  describe('sermon thesis short field chronology', () => {
    const opening = { questionWord: 'why', pluralKey: 'reasons', transitionSentence: 'The original transition words' };
    const thesis = (field: 'questionWord' | 'pluralKey', words: string, transition = opening.transitionSentence) =>
      ({ ...opening, [field]: words, transitionSentence: transition });
    const stamp = (offset: number | null, revision = 1) => ({
      observedRevision: revision,
      time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
    });
    const save = (operationId: string, field: 'questionWord' | 'pluralKey', after: typeof opening, offset: number | null,
      before = opening, revision = 1) => ({
      ...update(operationId, 'thesis-short-seed'),
      changes: [{ path: ['preparation'], before: { exists: true, value: { thesis: before } }, after: { exists: true, value: { thesis: after } } }],
      sermonThesisFieldActions: { [field]: stamp(offset, revision) },
    });
    async function seed() {
      const command = create('thesis-short-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: { thesis: opening } } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    it.each([
      { field: 'questionWord', desktop: 'when', phone: 'how', at: 20, order: 'earlier' },
      { field: 'questionWord', desktop: 'when', phone: 'how', at: 80, order: 'later' },
      { field: 'pluralKey', desktop: 'steps', phone: 'promises', at: 20, order: 'earlier' },
      { field: 'pluralKey', desktop: 'steps', phone: 'promises', at: 80, order: 'later' },
    ] as const)('keeps the later $field action when the delayed save was $order', async ({ field, desktop, phone, at }) => {
      const owner = await seed();
      const transition = 'Independently written transition';
      expect(await processCommand(owner, save('desktop', field, thesis(field, desktop, transition), 40)))
        .toMatchObject({ kind: 'acknowledged' });
      const delayed = save('phone', field, thesis(field, phone), at);
      const expected = { kind: 'acknowledged', snapshot: { value: { preparation: { thesis: thesis(field, at > 40 ? phone : desktop, transition) } } } };
      const result = await processCommand(owner, delayed);
      expect(result).toMatchObject(expected);
      expect(await processCommand(owner, delayed)).toEqual(result);
    });

    it('keeps a later return to the original question even when an earlier clear is delivered last', async () => {
      const owner = await seed();
      const field = 'questionWord';
      const first = thesis(field, 'when');
      expect(await processCommand(owner, save('desktop-first', field, first, 30))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('desktop-back', field, opening, 80, first, 2))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('offline-clear', field, thesis(field, ''), 50)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: { thesis: opening } } } });
    });

    it('orders two actions from a record that has no thesis yet', async () => {
      const command = create('thesis-short-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, command)).toMatchObject({ kind: 'acknowledged' });
      const field = 'questionWord';
      const createWord = (id: string, value: string, offset: number) => {
        const next = save(id, field, { ...opening, [field]: value }, offset);
        return { ...next, changes: [{ path: ['preparation'], before: { exists: false },
          after: { exists: true, value: { thesis: { [field]: value } } } }] };
      };
      expect(await processCommand(command.owner, createWord('desktop', 'when', 40))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(command.owner, createWord('phone', 'how', 80))).toMatchObject({ kind: 'acknowledged',
        snapshot: { value: { preparation: { thesis: { questionWord: 'how' } } } } });
    });

    it('keeps an older unsigned thesis packet from erasing a returned word', async () => {
      const owner = await seed();
      const field = 'questionWord';
      const first = thesis(field, 'when');
      expect(await processCommand(owner, save('desktop-first', field, first, 30))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('desktop-back', field, opening, 80, first, 2))).toMatchObject({ kind: 'acknowledged' });
      const clear = save('old-offline-clear', field, thesis(field, ''), null);
      expect(await processCommand(owner, { ...update(clear.operationId, 'thesis-short-seed'), changes: clear.changes }))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'thesis', field] }], snapshot: { value: { preparation: { thesis: opening } } } });
    });

    it.each(['questionWord', 'pluralKey'] as const)('keeps the explicitly reaffirmed %s after an older packet', async field => {
      const owner = await seed();
      const transition = 'Separately saved transition';
      const reaffirm = save('reaffirmed-word', field, thesis(field, opening[field], transition), null, thesis(field, 'intermediate word'));
      expect((await processCommand(owner, { ...update(reaffirm.operationId, 'thesis-short-seed'), changes: reaffirm.changes })).kind)
        .toBe('acknowledged');
      const old = save('old-word', field, thesis(field, ''), null);
      const delayed = { ...update(old.operationId, 'thesis-short-seed'), changes: old.changes };
      const answer = await processCommand(owner, delayed);
      expect(answer).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'thesis', field] }],
        snapshot: { value: { preparation: { thesis: thesis(field, opening[field], transition) } } } });
      expect(await processCommand(owner, delayed)).toEqual(answer);
    });

    it('recognizes the exact thesis predecessor after a proven later save chose the same value', async () => {
      const owner = await seed();
      const field = 'pluralKey';
      const both = thesis(field, 'steps');
      expect(await processCommand(owner, save('desktop', field, both, 40))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('phone-first', field, both, 60))).toMatchObject({ kind: 'acknowledged' });
      const sentence = 'A sentence saved after the same-word choice';
      const withSentence = thesis(field, 'steps', sentence);
      const middle = save('sentence', field, withSentence, null, both, 3);
      expect(await processCommand(owner, { ...update(middle.operationId, 'thesis-short-seed'), changes: middle.changes }))
        .toMatchObject({ kind: 'acknowledged' });
      const last = save('phone-next', field, thesis(field, 'promises'), null, both);
      expect(await processCommand(owner, { ...last, dependsOn: ['phone-first', 'sentence'],
        sermonThesisFieldActions: { [field]: { ...stamp(null), predecessorOperationId: 'phone-first' } } }))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: { thesis: thesis(field, 'promises', sentence) } } } });
    });

    it('asks only about the selected word when its action order is unknown', async () => {
      const owner = await seed();
      const field = 'pluralKey';
      expect(await processCommand(owner, save('desktop', field, thesis(field, 'steps'), 40))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, save('phone', field, thesis(field, 'promises'), null)))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'thesis', field] }] });
    });

    it('requires a fresh reviewed thesis word and retains the separately written transition', async () => {
      const owner = await seed();
      const field = 'questionWord';
      const newer = thesis(field, 'when', 'A later transition');
      expect((await processCommand(owner, save('latest', field, newer, 40))).kind).toBe('acknowledged');
      const reviewed = (id: string, before: typeof opening, revision: number) => {
        const command = save(id, field, thesis(field, '', before.transitionSentence), 80, before, revision);
        return { ...command, sermonThesisFieldActions: { [field]: { ...stamp(80, revision), reviewed: true as const } } };
      };
      expect(await processCommand(owner, reviewed('stale-choice', opening, 1))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'thesis', field], code: 'sermon-thesis-review-changed' }],
      });
      expect(await processCommand(owner, reviewed('fresh-choice', newer, 2))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: { thesis: { ...newer, [field]: '' } } } },
      });
    });
  });

  it.each([['sermons', 'outline'], ['planTemplates', 'structure']] as const)(
    'retains independent title chronology alongside the competing subpoint positions in %s', async (collection, field) => {
      const now = Date.now();
      const base = { protocol: 1, owner: 'owner-1', resource: { collection, id: 'mixed-outline' }, dependsOn: [] } as const;
      const outline = (parent: string, title: string) => ({ introduction: [], conclusion: [], main: ['a', 'b', 'c'].map(id => ({ id,
        text: id === 'c' ? title : id, subPoints: id === parent ? [{ id: 'subpoint', text: 'Subpoint', position: 0 }] : [] })) });
      const opening = outline('a', 'Original title');
      const value = { userId: base.owner, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), [field]: opening,
        ...(collection === 'sermons' ? { title: 'Sermon', verse: 'John 3:16', date: '2026-11-13', thoughts: [] } : { name: 'Template' }) };
      expect(await processCommand(base.owner, { ...base, dependsOn: [], kind: 'create', operationId: 'seed', generation: null, value }))
        .toMatchObject({ kind: 'acknowledged' });
      const update = (id: string, parent: string, title: string, offset: number) => processCommand(base.owner, {
        ...base, dependsOn: [], kind: 'update', operationId: id, generation: 'seed',
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value: outline(parent, title) } }],
        outlineTitleActions: [{ rowId: 'c', rowCreatedAt: 'c', before: 'Original title', after: title, observedRevision: 1,
          time: { earliestMs: now + offset - 10, latestMs: now + offset } }],
      });
      expect(await update('desktop', 'c', 'Later desktop title', -1000)).toMatchObject({ kind: 'acknowledged' });
      expect(await update('phone', 'b', 'Earlier offline title', -5000)).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([
        { path: [field], base: expect.any(Object), mine: expect.any(Object), theirs: expect.any(Object) },
        { path: [field, 'main', 'id:c', 'text'], code: 'outline-title-settled', base: { exists: true, value: 'Original title' },
          mine: { exists: true, value: 'Earlier offline title' }, theirs: { exists: true, value: 'Later desktop title' } },
      ]) });
    });

  describe.each([['sermons', 'outline'], ['planTemplates', 'structure']] as const)('subpoint placement chronology in %s', (collection, field) => {
    async function fixture() {
      const owner = 'owner-1';
      const base = { protocol: 1 as const, owner, resource: { collection, id: 'subpoint-placement' }, dependsOn: [] };
      const date = '2026-11-13T00:00:00.000Z';
      const outline = (parent: string, childText = 'Opening words') => ({
        introduction: [], conclusion: [],
        main: ['a', 'b', 'c'].map(id => ({ id, text: id, subPoints: [
          { id: id + '-anchor', text: 'Existing neighbor', position: 0 },
          ...(id === parent ? [{ id: 'child', text: childText, note: 'Keep the reminder', position: 1 }] : []),
        ] })),
      });
      const opening = outline('a');
      const value = { userId: owner, createdAt: date, updatedAt: date, [field]: opening, ...(collection === 'sermons'
        ? { title: 'Sermon', verse: 'John 3:16', date, thoughts: [] } : { name: 'Template' }) };
      expect(await processCommand(owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value }))
        .toMatchObject({ kind: 'acknowledged' });
      const gap = (parentId: string) => ({ parentId, previous: parentId + '-anchor', next: null });
      const move = (operationId: string, parent: string, at: number | null, words?: string) => ({
        ...base, kind: 'update' as const, operationId, generation: 'seed',
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value: outline(parent, words) } }],
        outlineSubpointMoves: [{ subPointId: 'child', opening: gap('a'), destination: gap(parent), observedRevision: 1,
          time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_005 + at } }],
      });
      return { base, outline, move };
    }

    it.each([false, true])('uses the later gesture and retains independent words (offline gesture later: %s)', async phoneLater => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('desktop', 'c', 60))).toMatchObject({ kind: 'acknowledged' });
      const queued = move('phone', 'b', phoneLater ? 100 : 20, 'Words saved independently with the move');
      const expected = outline(phoneLater ? 'b' : 'c', 'Words saved independently with the move');
      const accepted = await processCommand(base.owner, queued);
      expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { value: { [field]: expected } } });
      expect((await readDocument(base.owner, base.resource))?.value?.[field]).toEqual(expected);
      expect(await processCommand(base.owner, queued)).toEqual(accepted);
      const history = collection === 'sermons'
        ? await listOutlinePointPlacementHistory(base.owner, base.resource.id, 'seed')
        : await listPlanTemplatePointPlacementHistory(base.owner, base.resource.id, 'seed');
      expect(history.entries).toMatchObject([{ subpoint: true, pointId: 'child',
        earlier: { parentId: phoneLater ? 'c' : 'b' }, kept: { parentId: phoneLater ? 'b' : 'c' } }]);
    });

    it('counts a later return to the original parent as an action even with no net outline edit', async () => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('desktop', 'c', 60))).toMatchObject({ kind: 'acknowledged' });
      const away = move('phone', 'b', 70);
      const back = move('phone', 'a', 100);
      const delivered = { ...back, changes: [{ ...back.changes[0], after: back.changes[0].before }],
        outlineSubpointMoves: [away.outlineSubpointMoves[0], { ...back.outlineSubpointMoves[0], opening: away.outlineSubpointMoves[0].destination }] };
      expect(await processCommand(base.owner, delivered)).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { [field]: outline('a') } },
      });
    });

    it('asks about an explicit offline return with no comparable time', async () => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('desktop', 'c', 60))).toMatchObject({ kind: 'acknowledged' });
      const away = move('phone', 'b', 70);
      const back = move('phone', 'a', null);
      const delivered = { ...back, changes: [{ ...back.changes[0], after: back.changes[0].before }],
        outlineSubpointMoves: [away.outlineSubpointMoves[0], { ...back.outlineSubpointMoves[0], opening: away.outlineSubpointMoves[0].destination }] };
      expect(await processCommand(base.owner, delivered)).toMatchObject({
        kind: 'conflict', conflicts: [{ path: [field], code: 'outline-subpoint-review' }],
        snapshot: { value: { [field]: outline('c') } },
      });
    });

    it('replays two gestures into the same parent within one Save', async () => {
      const { base, move, outline } = await fixture();
      const first = move('batch', 'b', 60);
      const local = outline('b');
      const [a, b, c] = local.main;
      const sibling = { ...a.subPoints[0], position: 2 };
      const next = { ...local, main: [{ ...a, subPoints: [] }, { ...b, subPoints: [...b.subPoints, sibling] }, c] };
      const second = { subPointId: 'a-anchor', opening: { parentId: 'a', previous: null, next: null },
        destination: { parentId: 'b', previous: 'child', next: null }, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_080, latestMs: 1_800_000_000_085 } };
      expect(await processCommand(base.owner, { ...first, outlineSubpointMoves: [...first.outlineSubpointMoves, second],
        changes: [{ ...first.changes[0], after: { exists: true, value: next } }],
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { [field]: next } } });
    });

    it('does not use an older proof after an uncertain action chose the same place', async () => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('desktop', 'c', 20))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(base.owner, move('same-place', 'c', null))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(base.owner, move('other-place', 'b', 100))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: [field], outlineSubpointIds: ['child'] }], snapshot: { value: { [field]: outline('c') } },
      });
    });

    it('recognizes exactly which prior gesture the second offline move followed', async () => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('first', 'b', null))).toMatchObject({ kind: 'acknowledged' });
      const second = move('second', 'c', null);
      const staged = { ...second, dependsOn: ['first'], changes: [{ ...second.changes[0], before: { exists: true, value: outline('b') } }],
        outlineSubpointMoves: [{ ...second.outlineSubpointMoves[0], opening: { parentId: 'b', previous: 'b-anchor', next: null },
          predecessorOperationId: 'first' }] };
      expect(await processCommand(base.owner, staged)).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { [field]: outline('c') } },
      });
    });

    it('preserves the placement comparison during a separate dispute about the note', async () => {
      const { base, move } = await fixture();
      const desktop = move('desktop', 'c', 60);
      const withNote = (root: ReturnType<typeof move>['changes'][number]['after'], note: string) => ({
        ...root, value: { ...root.value, main: root.value.main.map(point => ({
          ...point, subPoints: point.subPoints.map(child => child.id === 'child' ? { ...child, note } : child),
        })) },
      });
      expect(await processCommand(base.owner, { ...desktop, changes: [{ ...desktop.changes[0], after: withNote(desktop.changes[0].after, 'Desktop notes') }] }))
        .toMatchObject({ kind: 'acknowledged' });
      const away = move('phone', 'b', 70);
      const back = move('phone', 'a', 100);
      expect(await processCommand(base.owner, {
        ...back, changes: [{ ...back.changes[0], after: withNote(back.changes[0].before, 'Phone notes') }],
        outlineSubpointMoves: [away.outlineSubpointMoves[0], { ...back.outlineSubpointMoves[0], opening: away.outlineSubpointMoves[0].destination }],
      })).toMatchObject({ kind: 'conflict', conflicts: expect.arrayContaining([expect.objectContaining({ path: [field],
        code: 'outline-subpoint-review', outlineSubpointIds: ['child'], orderedOutlineSubpoints: [{ id: 'child', side: 'local' }] })]) });
    });

    it('does not recreate a removed destination when a timed gesture arrives', async () => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('desktop', 'c', 60))).toMatchObject({ kind: 'acknowledged' });
      const stored = outline('c');
      const withoutParent = { ...stored, main: stored.main.filter(point => point.id !== 'b') };
      expect(await processCommand(base.owner, { ...base, operationId: 'delete-destination', kind: 'update', generation: 'seed',
        changes: [{ path: [field], before: { exists: true, value: stored }, after: { exists: true, value: withoutParent } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(base.owner, move('phone', 'b', 100))).toMatchObject({
        kind: 'conflict', snapshot: { value: { [field]: withoutParent } },
      });
      expect((await readDocument(base.owner, base.resource))?.value?.[field]).toEqual(withoutParent);
    });

    it('keeps a real choice when the offline gesture has no comparable time', async () => {
      const { base, outline, move } = await fixture();
      expect(await processCommand(base.owner, move('desktop', 'c', 60))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(base.owner, move('phone', 'b', null))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: [field] }], snapshot: { value: { [field]: outline('c') } },
      });
    });
  });

  describe.each([['sermons', 'outline'], ['planTemplates', 'structure']] as const)('title returns in %s', (collection, field) => {
    async function seed(kind: 'point' | 'subpoint', rowId: string = kind) {
      const resource = { collection, id: 'outline-title-return' };
      const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
      const now = '2026-11-10T00:00:00.000Z';
      const outline = (words: string) => ({ introduction: [], main: [
        { id: kind === 'point' ? rowId : 'point', text: kind === 'point' ? words : 'Independent parent', note: 'Preserved reminder',
          subPoints: [{ id: kind === 'subpoint' ? rowId : 'subpoint', text: kind === 'subpoint' ? words : 'Independent subpoint', position: 1 }] },
        { id: 'neighbor', text: 'Independent point' },
      ], conclusion: [] });
      const opening = outline('Original title'), later = outline('Later desktop title'), offline = outline('Earlier offline title');
      const common = { userId: base.owner, createdAt: now, updatedAt: now, [field]: opening };
      const value = collection === 'sermons'
        ? { ...common, title: 'Sermon', verse: 'John 3:16', date: now, thoughts: [] }
        : { ...common, name: 'Template' };
      expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value }))
        .toMatchObject({ kind: 'acknowledged' });
      const stamp = (offset: number | null) => offset === null ? null
        : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      const words = (value: typeof opening) => {
        const point = value.main.find(row => row.id === (kind === 'point' ? rowId : 'point'))!;
        return kind === 'point' ? point.text : point.subPoints![0].text;
      };
      const save = (operationId: string, before: typeof opening, after: typeof opening,
        observation?: { offset: number | null; revision: number }) =>
        processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: [field], before: { exists: true, value: before }, after: { exists: true, value: after } }],
          ...(observation && { outlineTitleActions: [{ rowId, rowCreatedAt: rowId, before: words(before), after: words(after),
            observedRevision: observation.revision, time: stamp(observation.offset) }] }),
        });
      const path = kind === 'point' ? [field, 'main', 'id:' + rowId, 'text']
        : [field, 'main', 'id:point', 'subPoints', 'id:' + rowId, 'text'];
      return { owner: base.owner, resource, opening, later, offline, save, path };
    }

    it.each(['point', 'subpoint'] as const)('retains the later explicit return of the %s title after a delayed legacy save', async kind => {
      const { owner, resource, opening, later, offline, save, path } = await seed(kind);
      expect(await save('later-desktop-change', opening, later)).toMatchObject({ kind: 'acknowledged' });
      expect(await save('later-desktop-return', later, opening)).toMatchObject({ kind: 'acknowledged' });
      const reply = await save('earlier-delayed-title', opening, offline);
      expect((await readDocument(owner, resource)).value?.[field]).toEqual(opening);
      expect(reply).toMatchObject({ kind: 'conflict', conflicts: [{ path, code: 'outline-title-review' }] });
    });

    it.each([false, true])('does not offer a proven earlier title again when another title needs a choice (advancing server: %s)', async advancing => {
      const { owner, resource, opening, later, offline, save } = await seed('point');
      const baseline = await readDocument(owner, resource);
      expect(await save('desktop-change', opening, later, { offset: 60, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
      const changed = (outline: typeof opening, text: string) => ({
        ...outline, main: outline.main.map(row => row.id === 'neighbor' ? { ...row, text } : row),
      });
      const desktop = changed(later, 'Later desktop neighbor');
      expect(await save('desktop-neighbor', later, desktop)).toMatchObject({ kind: 'acknowledged' });
      const combined = changed(offline, 'Earlier phone neighbor');
      const action = { rowId: 'point', rowCreatedAt: 'point', before: 'Original title', after: 'Earlier offline title',
        observedRevision: 1, time: { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_015 } };
      const value = { ...baseline.value, [field]: combined as unknown as Json };
      const delayed = await processCommand(owner, { ...update('phone-together', 'seed'), resource,
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value: combined } }],
        outlineTitleActions: [action],
      });
      expect(delayed.kind).toBe('conflict');
      const session = new DataSession(baseline);
      session.edit(value);
      session.registerCommit(delayed.operationId, 1, value);
      session.accept(delayed);
      session.release(delayed.operationId);
      const next = advancing ? { ...later, main: later.main.map(row => row.id === 'point' ? { ...row, text: 'Newest desktop title' } : row) } : later;
      if (advancing) {
        const current = changed(next, 'Later desktop neighbor');
        expect(await save('desktop-newest', desktop, current, { offset: 90, revision: 3 })).toMatchObject({ kind: 'acknowledged' });
        session.observe(await readDocument(owner, resource), { source: 'server' });
      }
      session.keepLocal();
      expect(session.checkpoint().draft?.[field]).toEqual(changed(next, 'Earlier phone neighbor'));
      const history = await listOutlineTitleHistory(owner, collection, resource.id, 'seed');
      expect(history.entries).toEqual([expect.objectContaining({ fields: [expect.objectContaining({
        rowId: 'point', value: 'Earlier offline title', winnerValue: 'Later desktop title',
      })] })]);
    });

    it.each([{ order: 'older', extra: 'none' }, { order: 'newer', extra: 'none' }, { order: 'older', extra: 'note' },
      { order: 'older', extra: 'later title' }])
      ('keeps a resolved $order title removed while choosing another title (extra: $extra)', async ({ order, extra }) => {
      const { owner, resource, opening, later, offline, save } = await seed('point');
      const baseline = await readDocument(owner, resource);
      expect(await save('desktop-change', opening, later, { offset: 50, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
      const desktop = { ...later, main: later.main.map(row => row.id === 'neighbor' ? { ...row, text: 'Saved neighbor' } : row) };
      expect(await save('desktop-neighbor', later, desktop)).toMatchObject({ kind: 'acknowledged' });
      const added = { id: 'additional', text: 'Independent addition' };
      const combined = { ...offline, main: [...offline.main.map(row =>
        row.id === 'neighbor' ? { ...row, text: 'My neighbor' }
          : row.subPoints && extra === 'note' ? { ...row, note: 'My separate reminder on the removed point' } : row), added] };
      const at = 1_800_000_000_000 + (order === 'older' ? 15 : 90);
      const sent = await processCommand(owner, { ...update('phone-together', 'seed'), resource,
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value: combined } }],
        outlineTitleActions: [{ rowId: 'point', rowCreatedAt: 'point', before: 'Original title', after: 'Earlier offline title',
          observedRevision: 1, time: { earliestMs: at, latestMs: at + 5 } }],
      });
      if (sent.kind !== 'conflict') throw new Error('The neighbor should need a comparison');
      const session = new DataSession(baseline);
      const value = { ...baseline.value, [field]: combined as unknown as Json };
      session.edit(value);
      session.registerCommit(sent.operationId, 1, value);
      session.accept(sent);
      session.release(sent.operationId);
      const current = extra === 'later title' ? { ...combined, main: combined.main.map(row =>
        row.id === 'point' ? { ...row, text: 'An additional title typed while reviewing' } : row) } : combined;
      if (current !== combined) session.edit({ ...baseline.value, [field]: current as unknown as Json });
      const removed = { ...desktop, main: desktop.main.filter(row => row.id !== 'point') };
      expect(await save('remove-point', desktop, removed)).toMatchObject({ kind: 'acknowledged' });
      session.observe(await readDocument(owner, resource), { source: 'server' });
      if (extra !== 'none') {
        expect(() => session.keepLocal()).toThrow('The removed point contains other changes');
        expect(session.checkpoint().draft?.[field]).toEqual(current);
      } else {
        session.keepLocal();
        expect(session.checkpoint().draft?.[field]).toEqual({ ...removed, main: [{ id: 'neighbor', text: 'My neighbor' }, added] });
      }
    });

    it('retains a proven later title when choosing the saved version of another title', async () => {
      const { owner, resource, opening, later, offline, save } = await seed('point');
      const baseline = await readDocument(owner, resource);
      expect(await save('desktop-change', opening, later, { offset: 30, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
      const changed = (outline: typeof opening, text: string) => ({
        ...outline, main: outline.main.map(row => row.id === 'neighbor' ? { ...row, text } : row),
      });
      const desktop = changed(later, 'Saved neighbor');
      expect(await save('desktop-neighbor', later, desktop)).toMatchObject({ kind: 'acknowledged' });
      const local = changed(offline, 'Unordered phone neighbor');
      const action = { rowId: 'point', rowCreatedAt: 'point', before: 'Original title', after: 'Earlier offline title',
        observedRevision: 1, time: { earliestMs: 1_800_000_000_085, latestMs: 1_800_000_000_090 } };
      const command = await processCommand(owner, { ...update('phone-together', 'seed'), resource,
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value: local } }],
        outlineTitleActions: [action],
      });
      if (command.kind !== 'conflict') throw new Error('The neighbor should need a comparison');
      const value = { ...baseline.value, [field]: local as unknown as Json };
      const retained = keepUncontestedOutlineTitle(baseline, value, command.snapshot, command.conflicts);
      expect(retained?.[field]).toEqual(changed(offline, 'Saved neighbor'));
      const session = new DataSession(baseline);
      session.edit(value);
      session.registerCommit(command.operationId, 1, value, undefined, { outlineTitleActions: [action] });
      session.accept(command);
      const compared = session.checkpoint();
      session.release(command.operationId);
      session.acceptRemote();
      session.edit(retained!);
      session.retainOutlineTitleActions(compared);
      expect(session.checkpoint().outlineTitleDrafts?.point.action).toEqual(action);
    });

    it('keeps an independent reminder when both compared titles are replaced by the saved ones', async () => {
      const { owner, resource, opening } = await seed('point');
      const baseline = await readDocument(owner, resource);
      const withTitles = (prefix: string) => ({ ...opening, main: opening.main.map(row => ({ ...row, text: prefix + ' ' + row.id })) });
      const updateTitles = (operationId: string, after: typeof opening) => processCommand(owner, { ...update(operationId, 'seed'), resource,
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value: after } }] });
      const saved = withTitles('Saved');
      expect(await updateTitles('desktop', saved)).toMatchObject({ kind: 'acknowledged' });
      const local = withTitles('Mine');
      local.main = local.main.map(row => row.subPoints ? { ...row, note: 'Unrelated private reminder' } : row);
      const value = { ...baseline.value, [field]: local as unknown as Json };
      const refused = await updateTitles('phone', local);
      expect(refused.kind).toBe('conflict');
      const session = new DataSession(baseline);
      session.edit(value);
      session.registerCommit(refused.operationId, 1, value);
      session.accept(refused);
      const checkpoint = session.checkpoint();
      expect(readOutlineTitleComparison(checkpoint)).toMatchObject({
        mine: expect.stringContaining('Mine neighbor'), stored: expect.stringContaining('Saved point'), removed: false,
      });
      const retained = keepUncontestedOutlineTitle(baseline, value, checkpoint.remoteCandidate, checkpoint.conflicts);
      expect(retained?.[field]).toEqual({ ...saved, main: saved.main.map(row =>
        row.subPoints ? { ...row, note: 'Unrelated private reminder' } : row) });
    });

    it.each([129, 2_000])('protects an existing outline ID of %i characters', async length => {
      const { owner, resource, opening, later, offline, save, path } = await seed('point', 'p'.repeat(length));
      expect(await save('desktop-change', opening, later, { offset: 30, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
      expect(await save('desktop-return', later, opening, { offset: 80, revision: 2 })).toMatchObject({ kind: 'acknowledged' });
      expect(await save('old-timed', opening, offline, { offset: 15, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
      expect(await save('old-legacy', opening, offline)).toMatchObject({ kind: 'conflict', conflicts: [{ path }] });
      expect((await readDocument(owner, resource)).value?.[field]).toEqual(opening);
    });

    it.each([null, 80])('protects a coalesced return against a legacy delivery when time is %s', async offset => {
      const { owner, resource, opening, offline, save, path } = await seed('point');
      expect(await save('coalesced-return', opening, opening, { offset, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
      expect(await save('old-legacy', opening, offline)).toMatchObject({ kind: 'conflict', conflicts: [{ path }] });
      expect((await readDocument(owner, resource)).value?.[field]).toEqual(opening);
    });

    describe.each(['point', 'subpoint'] as const)('%s title chronology', kind => {
      it.each([
        { order: 'earlier', offset: 50 },
        { order: 'later', offset: 95 },
        { order: 'overlapping', offset: 79 },
        { order: 'unknown', offset: null },
      ])('retains the right title and neighboring content when the delayed action is $order', async ({ order, offset }) => {
        const { owner, resource, opening, later, offline, save, path } = await seed(kind);
        expect(await save('desktop-change', opening, later, { offset: 30, revision: 1 })).toMatchObject({ kind: 'acknowledged' });
        const returned = { ...opening, main: [...opening.main].reverse().map(row =>
          row.subPoints ? { ...row, note: 'Updated desktop reminder' } : row) };
        expect(await save('desktop-return', later, returned, { offset: 80, revision: 2 })).toMatchObject({ kind: 'acknowledged' });
        const delayed = await save('phone-delayed', opening, offline, { offset, revision: 1 });
        const disputed = order === 'unknown' || order === 'overlapping';
        if (disputed) {
          expect(delayed).toMatchObject({ kind: 'conflict', conflicts: [{ path, code: 'outline-title-review',
            mine: { value: 'Earlier offline title' }, theirs: { value: 'Original title' } }] });
        } else {
          expect(delayed.kind).toBe('acknowledged');
        }
        const expected = order === 'later'
          ? { ...returned, main: [returned.main[0], { ...offline.main[0], note: 'Updated desktop reminder' }] }
          : returned;
        expect((await readDocument(owner, resource)).value?.[field]).toEqual(expected);
        const history = await listOutlineTitleHistory(owner, collection, resource.id, 'seed');
        expect(history.entries).toEqual(disputed ? [] : [expect.objectContaining({ fields: [expect.objectContaining({
          field: 'text', rowId: kind, value: order === 'later' ? 'Original title' : 'Earlier offline title',
          winnerValue: order === 'later' ? 'Earlier offline title' : 'Original title',
        })] })]);
      });

      it('does not expose title history outside the owner and generation', async () => {
        const { owner, resource } = await seed(kind);
        await expect(listOutlineTitleHistory('another-owner', collection, resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
        await expect(listOutlineTitleHistory(owner, collection, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
      });
    });
  });

  it('leaves room for ordinary writes in a large sermon and treats compacted homiletic proof as unknown', async () => {
    const resource = { collection: 'sermons', id: 'large-homiletic-plan' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-10T00:00:00.000Z';
    const a = { id: 'a', title: 'A' }, b = { id: 'b', title: 'B' }, c = { id: 'c', title: 'C' };
    const opening = [a, b, c], moved = [b, a, c];
    const preparation = (rows: typeof opening) => ({ homileticPlan: { updatedPlan: rows } });
    const bulk = 'x'.repeat(989_000);
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Large sermon', verse: 'John 3:16', thoughts: [], date: now, createdAt: now, updatedAt: now,
        preparation: preparation(opening), planText: { main: bulk } },
    })).toMatchObject({ kind: 'acknowledged' });
    const save = (operationId: string, before: typeof opening, after: typeof opening, observedRevision: number) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) }, after: { exists: true, value: preparation(after) } }],
        homileticMoveActions: { updatedPlan: [{ stepId: 'a', queueId: operationId,
          opening: stepGap(before, 'a')!, destination: stepGap(after, 'a')!, observedRevision, time: null }] },
      });
    expect(await save('current-move', opening, moved, 1)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/' + resource.id)?._dataEngine).toMatchObject({
      'homiletic-updatedPlan-placement': { floor: 2, moves: [], births: [] },
      'homiletic-updatedPlan-order': { order: { floor: 2, proofs: [] } },
    });
    expect(await save('delayed-move', moved, opening, 1)).toMatchObject({ kind: 'conflict' });
    expect((await readDocument(base.owner, resource)).value).toMatchObject({ preparation: preparation(moved), planText: { main: bulk } });
  });

  describe.each(['updatedPlan', 'sermonPlan'] as const)('a delayed save in homiletic %s', field => {
    it.each(['title return', 'position return', 'position return with evicted history', 'independent point titles', 'competing point titles',
      'earlier stamped title', 'later stamped title', 'earlier stamped position', 'later stamped position',
      'earlier stamped opposite-arrow position', 'later stamped opposite-arrow position'] as const)(
      'retains the intended points for %s', async scenario => {
        const resource = { collection: 'sermons', id: 'homiletic-point-return' };
        const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
        const now = '2026-11-10T00:00:00.000Z';
        const otherField = field === 'updatedPlan' ? 'sermonPlan' : 'updatedPlan';
        const opening = [{ id: 'a', title: 'Opening A' }, { id: 'b', title: 'Opening B' }, { id: 'c', title: 'Opening C' }];
        const title = (id: string, words: string) => opening.map(row => row.id === id ? { ...row, title: words } : row);
        const moved = [opening[1], opening[0], opening[2]];
        const independent = [{ id: 'sibling', title: 'Other plan' }];
        const preparation = (rows: typeof opening) => ({ homileticPlan: {
          modernTranslation: 'Independent translation', [otherField]: independent, [field]: rows,
        } });
        expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
          value: { userId: base.owner, title: 'Homiletic plan', verse: 'John 3:16', thoughts: [], date: now, createdAt: now, updatedAt: now,
            preparation: preparation(opening) },
        })).toMatchObject({ kind: 'acknowledged' });
        const stamped = scenario.includes('stamped');
        const position = scenario.includes('position');
        const save = (operationId: string, before: typeof opening, after: typeof opening, observedRevision: number, offset: number) => {
          const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset };
          const stepId = operationId === 'offline-phone' && scenario.includes('opposite-arrow') ? 'b' : 'a';
          const action = position ? { homileticMoveActions: { [field]: [{ stepId, queueId: operationId.startsWith('desktop') ? 'desktop' : 'phone',
            opening: stepGap(before, stepId)!, destination: stepGap(after, stepId)!, observedRevision, time }] } }
            : { homileticTitleActions: { [field]: [{ rowId: 'a', rowCreatedAt: 'a', before: before.find(row => row.id === 'a')!.title,
              after: after.find(row => row.id === 'a')!.title, observedRevision, time }] } };
          return processCommand(base.owner, {
          ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) },
            after: { exists: true, value: preparation(after) } }],
            ...(stamped && action),
          });
        };
        const separate = scenario === 'independent point titles';
        const overflow = scenario.includes('evicted history');
        const returns = scenario.includes('return') || stamped;
        const phoneLater = scenario.startsWith('later');
        const desktop = position ? moved : title(separate ? 'b' : 'a', 'Later desktop words');
        const phone = position ? moved : title('a', 'Earlier phone words');
        expect(await save('desktop-first', opening, desktop, 1, 38)).toMatchObject({ kind: 'acknowledged' });
        if (returns) expect(await save('desktop-return', desktop, opening, 2, 66)).toMatchObject({ kind: 'acknowledged' });
        const expanded = [...opening, { id: 'extra', title: 'Independent addition' }];
        if (overflow) {
          expect(await save('independent-addition', opening, expanded, 3, 80)).toMatchObject({ kind: 'acknowledged' });
          // Older frames are intentionally absent after the bounded layout history overflows.
          const raw = documents.get('sermons/' + resource.id)!;
          const layout = (raw._dataEngine as Raw)['homiletic-' + field + '-order'] as { order: { proofs: Raw[] } };
          expect(layout.order.proofs[0].priorFrames).toBeDefined();
          delete layout.order.proofs[0].priorFrames;
        }
        const reply = await save('offline-phone', opening, phone, 1, phoneLater ? 95 : 15);
        const expected = separate ? [phone[0], desktop[1], opening[2]] : overflow ? expanded : phoneLater ? phone : returns ? opening : desktop;
        expect((await readDocument(base.owner, resource)).value?.preparation).toEqual(preparation(expected));
        expect(reply.kind).toBe(separate || stamped ? 'acknowledged' : 'conflict');
        if (stamped) {
          const history = await listHomileticPlanHistory(base.owner, resource.id, 'seed', undefined, field);
          const rowId = scenario.includes('opposite-arrow') ? 'b' : 'a';
          const change = position ? { kind: 'position', rowId }
            : { kind: 'title', rowId, earlier: phoneLater ? 'Opening A' : 'Earlier phone words',
              kept: phoneLater ? 'Earlier phone words' : 'Opening A' };
          expect(history).toMatchObject({ owner: base.owner, sermonId: resource.id, generation: 'seed', list: field,
            entries: [{ changes: [change] }], nextCursor: null });
          expect((await listHomileticPlanHistory(base.owner, resource.id, 'seed', undefined, otherField)).entries).toEqual([]);
          await expect(listHomileticPlanHistory('other-owner', resource.id, 'seed', undefined, field)).rejects.toMatchObject({ status: 403 });
          await expect(listHomileticPlanHistory(base.owner, resource.id, 'wrong-generation', undefined, field)).rejects.toMatchObject({ status: 404 });
        }
      },
    );
    it('checks the layout revision of a reviewed move, even after a newer move returns the same order', async () => {
      const resource = { collection: 'sermons', id: 'reviewed-homiletic-position' };
      const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
      const now = '2026-11-10T00:00:00.000Z';
      const a = { id: 'a', title: 'A' }, b = { id: 'b', title: 'B' }, c = { id: 'c', title: 'C' };
      const opening = [a, b, c], swapped = [b, a, c];
      const preparation = (rows: typeof opening) => ({ homileticPlan: { [field]: rows } });
      expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
        value: { userId: base.owner, title: 'Homiletic plan', verse: 'John 3:16', thoughts: [], date: now, createdAt: now, updatedAt: now,
          preparation: preparation(opening) },
      })).toMatchObject({ kind: 'acknowledged' });
      function save(operationId: string, before: typeof opening, after: typeof opening, revision?: number) {
        return processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) }, after: { exists: true, value: preparation(after) } }],
          ...(revision !== undefined && { homileticPositionReviews: { [field]: revision } }),
        });
      }
      expect(await save('newer-change', opening, swapped)).toMatchObject({ kind: 'acknowledged' });
      expect(await save('newer-return', swapped, opening)).toMatchObject({ kind: 'acknowledged' });
      const stale = await save('old-choice', opening, swapped, 1);
      expect(stale).toMatchObject({ kind: 'conflict', snapshot: { metadata: { revision: 3 }, value: { preparation: preparation(opening) } },
        conflicts: [{ path: ['preparation', 'homileticPlan', field], code: 'homiletic-position-review' }] });
      const retitled = [a, b, { ...c, title: 'C changed independently' }];
      expect(await save('title-only', opening, retitled)).toMatchObject({ kind: 'acknowledged' });
      const accepted = await save('fresh-choice', opening, swapped, 3);
      expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { revision: 5 },
        value: { preparation: preparation([b, a, retitled[2]]) } } });
      expect(await save('fresh-choice', opening, swapped, 3)).toEqual(accepted);
    });

    it.each(['an older move to the same place', 'an older move across another moved point', 'a move across a point just inserted on another device'] as const)(
      'preserves a later crossing after %s', async scenario => {
      const resource = { collection: 'sermons', id: 'homiletic-crossing-reaffirmation' };
      const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
      const now = '2026-11-10T00:00:00.000Z';
      const a = { id: 'a', title: 'A' }, b = { id: 'b', title: 'B' }, c = { id: 'c', title: 'C' };
      const d = { id: 'd', title: 'D' };
      const samePlace = scenario === 'an older move to the same place';
      const newlyInserted = scenario === 'a move across a point just inserted on another device';
      const opening = samePlace || newlyInserted ? [a, b, c] : [d, a, b, c];
      const preparation = (rows: typeof opening) => ({ homileticPlan: { [field]: rows } });
      expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
        value: { userId: base.owner, title: 'Homiletic plan', verse: 'John 3:16', thoughts: [], date: now, createdAt: now, updatedAt: now,
          preparation: preparation(opening) },
      })).toMatchObject({ kind: 'acknowledged' });
      function save(operationId: string, stepId: string, before: typeof opening, after: typeof opening, revision: number, offset: number) {
        return processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) }, after: { exists: true, value: preparation(after) } }],
          homileticMoveActions: { [field]: [{ stepId, queueId: operationId.startsWith('desktop') ? 'desktop' : 'phone',
            opening: stepGap(before, stepId)!, destination: stepGap(after, stepId)!, observedRevision: revision,
            time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset } }] },
        });
      }
      if (newlyInserted) {
        const saved = [a, d, b, c];
        expect(await processCommand(base.owner, { ...base, kind: 'update', operationId: 'desktop-add', generation: 'seed',
          changes: [{ path: ['preparation'], before: { exists: true, value: preparation(opening) },
            after: { exists: true, value: preparation(saved) } }],
        })).toMatchObject({ kind: 'acknowledged' });
        expect(await save('phone-old', 'a', opening, [b, a, c], 1, 15)).toMatchObject({ kind: 'conflict',
          conflicts: [{ path: ['preparation', 'homileticPlan', field], code: 'homiletic-position-review' }] });
        expect((await readDocument(base.owner, resource)).value?.preparation).toEqual(preparation(saved));
      } else if (samePlace) {
        const swapped = [b, a, c];
        expect(await save('desktop-first', 'a', opening, swapped, 1, 20)).toMatchObject({ kind: 'acknowledged' });
        expect(await save('desktop-back', 'a', swapped, opening, 2, 50)).toMatchObject({ kind: 'acknowledged' });
        expect(await save('desktop-last', 'a', opening, swapped, 3, 66)).toMatchObject({ kind: 'acknowledged' });
        expect(await save('phone-same', 'b', opening, swapped, 1, 15)).toMatchObject({ kind: 'acknowledged' });
        expect(await save('phone-undo', 'b', swapped, opening, 2, 40)).toMatchObject({ kind: 'acknowledged' });
        expect((await readDocument(base.owner, resource)).value?.preparation).toEqual(preparation(swapped));
      } else {
        const saved = [a, d, b, c];
        expect(await save('desktop-last', 'd', opening, saved, 1, 66)).toMatchObject({ kind: 'acknowledged' });
        expect(await save('phone-old', 'a', opening, [d, b, a, c], 1, 15)).toMatchObject({ kind: 'acknowledged' });
        expect((await readDocument(base.owner, resource)).value?.preparation).toEqual(preparation(saved));
      }
    });

    it.each(['later saved order', 'later saved title', 'later incoming order', 'later incoming title'] as const)(
      'keeps the %s in the comparison for an independent change', async scenario => {
      const resource = { collection: 'sermons', id: 'mixed-homiletic-choice' };
      const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
      const now = '2026-11-10T00:00:00.000Z';
      const path = ['preparation', 'homileticPlan', field];
      const a = { id: 'a', title: 'Opening A' }, b = { id: 'b', title: 'Opening B' }, c = { id: 'c', title: 'Opening C' };
      const opening = [a, b, c];
      const preparation = (rows: typeof opening) => ({ homileticPlan: { [field]: rows } });
      expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
        value: { userId: base.owner, title: 'Homiletic plan', verse: 'John 3:16', thoughts: [], date: now, createdAt: now, updatedAt: now,
          preparation: preparation(opening) },
      })).toMatchObject({ kind: 'acknowledged' });
      const orderedPosition = scenario.endsWith('order');
      const incomingWins = scenario.includes('incoming');
      function save(operationId: string, before: typeof opening, after: typeof opening, revision: number, offset: number, desktop: boolean) {
        const time = { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_004 + offset };
        const from = before.find(row => row.id === 'c')!.title, to = after.find(row => row.id === 'c')!.title;
        const move = { stepId: 'a', queueId: desktop ? 'desktop' : 'phone',
          opening: stepGap(before, 'a')!, destination: stepGap(after, 'a')!, observedRevision: revision, time: orderedPosition ? time : null };
        return processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
          changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) }, after: { exists: true, value: preparation(after) } }],
          homileticMoveActions: { [field]: [move] },
          homileticTitleActions: { [field]: [{ rowId: 'c', rowCreatedAt: 'c', before: from, after: to, observedRevision: revision,
            time: orderedPosition ? null : time }] },
        });
      }
      const desktopTitle = { ...c, title: 'Saved C' };
      const desktop = [b, a, desktopTitle];
      const returned = [a, b, desktopTitle];
      expect(await save('desktop-first', opening, desktop, 1, 40, true)).toMatchObject({ kind: 'acknowledged' });
      expect(await save('desktop-return', desktop, returned, 2, 65, true)).toMatchObject({ kind: 'acknowledged' });
      const incoming = [b, a, { ...c, title: 'Offline C' }];
      const result = await save('offline-phone', opening, incoming, 1, incomingWins ? 95 : 10, false);
      const titlePath = [...path, 'id:c', 'title'];
      const projected = orderedPosition
        ? { path, code: 'homiletic-position-projection', mine: { exists: true, value: incomingWins ? desktop : returned } }
        : { path: titlePath, code: 'homiletic-title-projection', mine: { exists: true, value: incomingWins ? 'Offline C' : 'Saved C' } };
      const uncertain = orderedPosition
        ? { path: titlePath, code: 'homiletic-title-review' }
        : { path, code: 'homiletic-position-review' };
      expect(result).toMatchObject({ kind: 'conflict',
        conflicts: expect.arrayContaining([expect.objectContaining(projected), expect.objectContaining(uncertain)]) });
      expect((await readDocument(base.owner, resource)).value?.preparation).toEqual(preparation(returned));
      const history = await listHomileticPlanHistory(base.owner, resource.id, 'seed', undefined, field);
      const change = orderedPosition ? { kind: 'position', rowId: 'a' }
        : { kind: 'title', rowId: 'c', earlier: incomingWins ? 'Saved C' : 'Offline C', kept: incomingWins ? 'Offline C' : 'Saved C' };
      expect(history.entries).toMatchObject([{ changes: [{ ...change, ...(incomingWins && { origin: 'comparison' }) }] }]);
    });

  });

  describe('exegetical plan point removal and title chronology', () => {
    const point = { id: 'point', title: 'Original point' };
    const edited = { ...point, title: 'Revised point' };
    const neighbor = { id: 'neighbor', title: 'Independent point' };
    const revisedNeighbor = { ...neighbor, title: 'Revised independent point' };
    const preparation = (exegeticalPlan: typeof point[]) => ({ exegeticalPlan, authorIntent: 'Keep the author’s intent' });
    const opening = preparation([point, neighbor]);

    async function seed() {
      const command = create('exegetical-chronology-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: opening } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    function savePoint(kind: 'remove' | 'title' | 'sibling', offset: number | null) {
      const time = offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      const nodes = kind === 'remove' ? [neighbor] : kind === 'sibling' ? [point, revisedNeighbor] : [edited, neighbor];
      return {
        ...update('exegetical-' + kind, 'exegetical-chronology-seed'),
        changes: [{
          path: ['preparation'], before: { exists: true, value: opening },
          after: { exists: true, value: preparation(nodes) },
        }],
        exegeticalPlanActions: [{ nodeId: kind === 'sibling' ? neighbor.id : point.id,
          kind: kind === 'remove' ? 'remove' : 'title', observedRevision: 1, time }],
      };
    }

    it.each([
      { first: 'remove', second: 'title', firstAt: 25, secondAt: 80, expected: [edited, neighbor] },
      { first: 'title', second: 'remove', firstAt: 80, secondAt: 25, expected: [edited, neighbor] },
      { first: 'title', second: 'remove', firstAt: 25, secondAt: 80, expected: [neighbor] },
      { first: 'remove', second: 'title', firstAt: 80, secondAt: 25, expected: [neighbor] },
    ] as const)('keeps the later point intent when $first at $firstAt is delivered before $second at $secondAt',
      async ({ first, second, firstAt, secondAt, expected }) => {
        const owner = await seed();
        expect(await processCommand(owner, savePoint(first, firstAt))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, savePoint(second, secondAt))).toMatchObject({
          kind: 'acknowledged', snapshot: { value: { preparation: preparation([...expected]) } },
        });
      });

    it('keeps a later explicit return to the opening title over an older delayed removal', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('title', 40))).toMatchObject({ kind: 'acknowledged' });
      const returnToOpening = savePoint('title', 80);
      expect(await processCommand(owner, {
        ...returnToOpening, operationId: 'exegetical-title-return',
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: opening } }],
        exegeticalPlanActions: [{ ...returnToOpening.exegeticalPlanActions[0], observedRevision: 2 }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePoint('remove', 25))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: opening } },
      });
    });

    it.each([
      ['title', 2, 'conflict'], ['remove', 2, 'conflict'], ['title', 4, 'acknowledged'], ['remove', 4, 'acknowledged'],
      ['neighbor', 2, 'acknowledged'],
    ] as const)('checks %s at revision %s after a returned title leaves the proof window: %s', async (kind, observed, outcome) => {
      const owner = await seed();
      const others = Array.from({ length: 32 }, (_, index) => ({ id: 'other-' + index, title: 'Other point ' + index }));
      const initial = [point, neighbor, ...others];
      const editPlan = (operationId: string, before: typeof point[], after: typeof point[], ids: string[], revision: number) => processCommand(owner, {
        ...savePoint('title', null), operationId,
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) },
          after: { exists: true, value: preparation(after) } }],
        exegeticalPlanActions: ids.map(nodeId => ({ nodeId, kind: after.some(row => row.id === nodeId) ? 'title' as const : 'remove' as const,
          observedRevision: revision, time: null })),
      });
      expect(await editPlan('add-more-points', [point, neighbor], initial, [], 1)).toMatchObject({ kind: 'acknowledged' });
      const middle = [edited, neighbor, ...others];
      expect(await editPlan('title-away', initial, middle, [point.id], 2)).toMatchObject({ kind: 'acknowledged' });
      expect(await editPlan('title-back', middle, initial, [point.id], 3)).toMatchObject({ kind: 'acknowledged' });
      const final = [point, neighbor, ...others.map(row => ({ ...row, title: row.title + ' edited' }))];
      // Each separate point gets a newer receipt. One further independent update tests persistence of the cutoff.
      expect(await editPlan('other-points', initial, final, others.map(row => row.id), 4)).toMatchObject({ kind: 'acknowledged' });
      const last = { id: 'last', title: 'Last point' };
      expect(await editPlan('add-one-more-point', final, [...final, last], [], 5)).toMatchObject({ kind: 'acknowledged' });
      const target = kind === 'neighbor' ? neighbor : point;
      const proposed = kind === 'remove' ? initial.filter(row => row.id !== target.id)
        : initial.map(row => row.id === target.id ? { ...row, title: 'Earlier title' } : row);
      const delayed = await editPlan('phone-after-return', initial, proposed, [target.id], observed);
      if (outcome === 'conflict') expect(delayed).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'exegeticalPlan', 'id:point'],
        mine: kind === 'title' ? { exists: true, value: proposed[0] } : { exists: false }, theirs: { exists: true, value: point } }] });
      else expect(delayed).toMatchObject({ kind: 'acknowledged' });
      const accepted = outcome === 'conflict' ? final : [
        ...proposed.slice(0, kind === 'remove' ? 1 : 2), ...final.slice(2),
      ];
      expect((await readDocument(owner, resource)).value?.preparation).toEqual(preparation([...accepted, last]));
    });

    it.each([null, 25])('does not silently overwrite a later deliberate return with a delayed title at %s', async earlierAt => {
      const owner = await seed();
      await processCommand(owner, savePoint('title', 40));
      const returnToOpening = savePoint('title', 80);
      await processCommand(owner, {
        ...returnToOpening, operationId: 'exegetical-title-return',
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: opening } }],
        exegeticalPlanActions: [{ ...returnToOpening.exegeticalPlanActions[0], observedRevision: 2 }],
      });
      const older = { ...point, title: 'Earlier queued title' };
      const delayed = savePoint('title', earlierAt);
      const result = await processCommand(owner, {
        ...delayed, operationId: 'exegetical-delayed-title',
        changes: [{ path: ['preparation'], before: { exists: true, value: opening },
          after: { exists: true, value: preparation([older, neighbor]) } }],
      });
      if (earlierAt === null) {
        expect(result).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'exegeticalPlan', 'id:point'],
          mine: { exists: true, value: older }, theirs: { exists: true, value: point } }] });
      } else {
        expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: opening } } });
      }
      expect((await readDocument(owner, resource)).value?.preparation).toEqual(opening);
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        entries: [{ nodeId: point.id, value: { point: older } }],
      });
    });

    it('keeps both saved titles when one delayed Save carries two older point titles after returns', async () => {
      const owner = await seed();
      const changeBoth = (operationId: string, before: typeof point[], after: typeof point[], revision: number, offset: number | null) => ({
        ...savePoint('title', offset), operationId,
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation(before) },
          after: { exists: true, value: preparation(after) } }],
        exegeticalPlanActions: [point.id, neighbor.id].map(nodeId => ({
          nodeId, kind: 'title' as const, observedRevision: revision,
          time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
        })),
      });
      const initial = [point, neighbor], middle = [edited, revisedNeighbor];
      expect(await processCommand(owner, changeBoth('desk-first', initial, middle, 1, 45))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, changeBoth('desk-return', middle, initial, 2, 80))).toMatchObject({ kind: 'acknowledged' });
      const incoming = initial.map(row => ({ ...row, title: 'Older ' + row.title }));
      expect(await processCommand(owner, changeBoth('phone-both', initial, incoming, 1, null))).toMatchObject({
        kind: 'conflict', conflicts: expect.arrayContaining(initial.map(row => expect.objectContaining({
          path: ['preparation', 'exegeticalPlan', 'id:' + row.id], theirs: { exists: true, value: row },
        }))),
      });
      expect((await readDocument(owner, resource)).value?.preparation).toEqual(opening);
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        entries: expect.arrayContaining(incoming.map(row => expect.objectContaining({
          nodeId: row.id, value: expect.objectContaining({ point: row }), origin: 'comparison',
        }))),
      });
    });

    it('accepts removal of the exact point title saved by its own preceding request without a clock', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('title', null))).toMatchObject({ kind: 'acknowledged' });
      const remove = savePoint('remove', null);
      expect(await processCommand(owner, {
        ...remove, dependsOn: ['exegetical-title'],
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: preparation([neighbor]) } }],
        exegeticalPlanActions: [{ ...remove.exegeticalPlanActions[0], predecessorOperationId: 'exegetical-title' }],
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation([neighbor]) } } });
    });

    it('stores the displaced words for the same owner and generation when an older edit arrives after removal', async () => {
      const owner = await seed();
      await processCommand(owner, savePoint('remove', 80));
      await processCommand(owner, savePoint('title', 25));
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        owner, generation: 'exegetical-chronology-seed',
        entries: [{ nodeId: point.id, value: { point: edited, ancestors: [] }, winner: null }],
      });
      await expect(listExegeticalPointHistory('other-owner', resource.id, 'exegetical-chronology-seed')).rejects.toThrow();
      await expect(listExegeticalPointHistory(owner, resource.id, 'previous-generation')).rejects.toThrow();
    });

    it('compares only the affected point when the order of an edit and a removal is unknown', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('title', 80))).toMatchObject({ kind: 'acknowledged' });
      const remove = savePoint('remove', null);
      expect(await processCommand(owner, remove)).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['preparation', 'exegeticalPlan', 'id:point'] }],
      });
      const reviewedRemoval = { ...update('exegetical-reviewed-removal', 'exegetical-chronology-seed'),
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation([edited, neighbor]) },
          after: { exists: true, value: preparation([neighbor]) } }] };
      expect(await processCommand(owner, reviewedRemoval)).toMatchObject({ kind: 'acknowledged' });
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        entries: [{ nodeId: point.id, value: { point: edited }, origin: 'comparison' }],
      });
    });

    it('preserves the point text even when the same command has another conflicting field', async () => {
      const owner = await seed();
      const withSermonTitle = (kind: 'title' | 'remove', title: string) => {
        const command = savePoint(kind, null);
        return { ...command, changes: [...command.changes, { path: ['title'], before: { exists: true, value: 'First' },
          after: { exists: true, value: title } }] };
      };
      expect(await processCommand(owner, withSermonTitle('title', 'Desk sermon title'))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, withSermonTitle('remove', 'Phone sermon title'))).toMatchObject({
        kind: 'conflict', conflicts: expect.arrayContaining([
          expect.objectContaining({ path: ['preparation', 'exegeticalPlan', 'id:point'] }),
          expect.objectContaining({ path: ['title'] }),
        ]),
      });
      await expect(listExegeticalPointHistory(owner, resource.id, 'exegetical-chronology-seed')).resolves.toMatchObject({
        entries: [{ nodeId: point.id, value: { point: edited }, origin: 'comparison' }],
      });
    });

    it('merges a point removal and an independent sibling title edit', async () => {
      const owner = await seed();
      expect(await processCommand(owner, savePoint('sibling', 80))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, savePoint('remove', 25))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: preparation([revisedNeighbor]) } },
      });
    });
  });

  describe('ordinary thought tag membership chronology', () => {
    const date = '2026-11-08T00:00:00.000Z';
    const alpha = 'Alpha tag', beta = 'Beta tag';
    const words = 'The original thought stays';
    const thought = (tags: string[]) => ({ id: 'tagged', date, text: words, tags: ['main', ...tags] });
    const neighbor = { id: 'neighbor', date, text: 'The independent thought stays', tags: ['main'] };

    async function seed(present = false) {
      const command = create('thought-tag-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, thoughts: [thought(present ? [alpha] : []), neighbor] } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    function saveTag(operationId: string, tag: string, before: boolean, after: boolean, offset: number | null,
      predecessorOperationId?: string) {
      const time = offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return {
        ...update(operationId, 'thought-tag-seed'),
        dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['thoughts'], before: { exists: true, value: [thought(before ? [tag] : []), neighbor] },
          after: { exists: true, value: [thought(after ? [tag] : []), neighbor] } }],
        thoughtTagActions: [{ rowId: 'tagged', rowCreatedAt: date, tag, before, after, observedRevision: 1, time,
          ...(predecessorOperationId && { predecessorOperationId }) }],
      };
    }

    it.each([
      { startsPresent: false, deskAt: 80, winner: true },
      { startsPresent: true, deskAt: 80, winner: false },
      { startsPresent: false, deskAt: 30, winner: false },
      { startsPresent: true, deskAt: 30, winner: true },
    ])('uses the later same-tag choice when the starting membership is $startsPresent and the desk acts at $deskAt',
      async ({ startsPresent, deskAt, winner }) => {
        const owner = await seed(startsPresent);
        expect(await processCommand(owner, saveTag('desk', alpha, startsPresent, !startsPresent, deskAt))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveTag('phone-first', alpha, startsPresent, !startsPresent, 15))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveTag('phone-second', alpha, !startsPresent, startsPresent, 50, 'phone-first')))
          .toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: [thought(winner ? [alpha] : []), neighbor] } } });
      });

    it.each([256, 257])('keeps the latest ordinary thought tag and its history for a %s-character name', async length => {
      const tag = 'QA ' + 'x'.repeat(length - 3);
      const owner = await seed();
      expect(await processCommand(owner, saveTag('desk', tag, false, true, 80))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', tag, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, saveTag('phone-second', tag, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought([tag]), neighbor] } },
      });
      await expect(listThoughtTagHistory(owner, 'sermon-1', 'thought-tag-seed')).resolves.toMatchObject({
        entries: [{ fields: [{ rowId: 'tagged', field: tag, value: false, winnerValue: true }] }],
      });
    });

    it('orders the indexed name of a long thought tag on the exact thought row', async () => {
      const name = 'x'.repeat(2048);
      const owner = await seed();
      const indexedSave = (...args: Parameters<typeof saveTag>) => {
        const command = saveTag(...args);
        const [{ tag: _name, ...action }] = command.thoughtTagActions;
        return { ...command, thoughtTagActions: [{ ...action, tagIndex: 1 }] };
      };
      await expect(processCommand(owner, indexedSave('desk-indexed', name, false, true, 80))).resolves.toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, indexedSave('phone-indexed-add', name, false, true, 15))).resolves.toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, indexedSave('phone-indexed-remove', name, true, false, 50, 'phone-indexed-add'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought([name]), neighbor] } },
      });
    });

    it.each([64, 65, 512])('keeps the latest ordinary thought tag and its siblings after a %s-change batch with the contested tag last', async count => {
      const tags = [...Array.from({ length: count - 1 }, (_, index) => 'QA Batch ' + index), alpha];
      const owner = await seed();
      const desk = saveTag('desk', alpha, false, true, 80);
      expect(await processCommand(owner, { ...desk, changes: [{ path: ['thoughts'],
        before: { exists: true, value: [thought([]), neighbor] }, after: { exists: true, value: [thought(tags), neighbor] } }],
        thoughtTagActions: tags.map(tag => ({ ...desk.thoughtTagActions[0], tag })) })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', alpha, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, saveTag('phone-second', alpha, true, false, 50, 'phone-first'))).resolves.toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought(tags), neighbor] } },
      });
    });

    it('stores the displaced membership under its thought and tag for the owner only', async () => {
      const owner = await seed();
      await processCommand(owner, saveTag('desk', alpha, false, true, 80));
      await processCommand(owner, saveTag('phone-first', alpha, false, true, 15));
      await processCommand(owner, saveTag('phone-second', alpha, true, false, 50, 'phone-first'));
      await expect(listThoughtTagHistory(owner, 'sermon-1', 'thought-tag-seed')).resolves.toMatchObject({
        owner, generation: 'thought-tag-seed', entries: [{ fields: [{ rowId: 'tagged', rowCreatedAt: date,
          field: alpha, value: false, winnerValue: true }] }],
      });
      await expect(listThoughtTagHistory('another-owner', 'sermon-1', 'thought-tag-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listThoughtTagHistory(owner, 'sermon-1', 'other-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('does not let a replaced thought inherit the old tag action', async () => {
      const owner = await seed();
      const base = update('replacement', 'thought-tag-seed');
      const replaced = { ...thought([]), date: '2026-11-09T00:00:00.000Z' };
      expect(await processCommand(owner, { ...base, changes: [{ path: ['thoughts'],
        before: { exists: true, value: [thought([]), neighbor] }, after: { exists: true, value: [replaced, neighbor] },
      }] })).toMatchObject({ kind: 'acknowledged' });
      await expect(processCommand(owner, saveTag('phone-old', alpha, false, true, 50))).resolves.toMatchObject({
        kind: 'conflict', snapshot: { value: { thoughts: [replaced, neighbor] } },
      });
    });

    it('keeps the exact tag choice available when its competing saved action has no reliable time', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveTag('desk', alpha, false, true, null))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', alpha, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-second', alpha, true, false, 50, 'phone-first'))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['thoughts', 'id:tagged', 'tags', 'string:' + alpha] }],
      });
    });

    it('merges different ordinary tags and keeps the same thought text and section', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveTag('desk', beta, false, true, 80))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveTag('phone-first', alpha, false, true, 15))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { thoughts: [thought([beta, alpha]), neighbor] } },
      });
    });
  });

  describe('sermon preparation confirmation chronology', () => {
    const fields = {
      prayer: { section: 'spiritual', key: 'readAndPrayedConfirmed' },
      book: { section: 'textContext', key: 'readWholeBookOnceConfirmed' },
    } as const;
    const opening = { spiritual: { readAndPrayedConfirmed: false }, textContext: { readWholeBookOnceConfirmed: false },
      preachingGoal: { type: 'informative', statement: 'Keep these preparation words' } };
    const preparation = (field: keyof typeof fields, checked: boolean) => {
      const { section, key } = fields[field];
      return { ...opening, [section]: { [key]: checked } };
    };
    function saveConfirmation(operationId: string, field: keyof typeof fields, before: boolean, after: boolean,
      offset: number | null, predecessorOperationId?: string) {
      const time = offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset };
      return {
        ...update(operationId, 'prep-check-seed'),
        dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['preparation'], before: { exists: true, value: preparation(field, before) },
          after: { exists: true, value: preparation(field, after) } }],
        sermonPreparationCheckActions: { [fields[field].key]: {
          observedRevision: 1, time, ...(predecessorOperationId && { predecessorOperationId }),
        } },
      };
    }
    async function seed() {
      const command = create('prep-check-seed') as Extract<DataCommand, { kind: 'create' }>;
      expect(await processCommand(command.owner, { ...command, value: { ...command.value, preparation: opening } }))
        .toMatchObject({ kind: 'acknowledged' });
      return command.owner;
    }

    it.each([
      { field: 'prayer', deskAt: 80, winner: true },
      { field: 'book', deskAt: 80, winner: true },
      { field: 'prayer', deskAt: 30, winner: false },
      { field: 'book', deskAt: 30, winner: false },
    ] as const)('keeps the known last $field choice when two offline actions arrive after the desk action at $deskAt',
      async ({ field, deskAt, winner }) => {
        const owner = await seed();
        expect(await processCommand(owner, saveConfirmation('desk', field, false, true, deskAt))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveConfirmation('phone-on', field, false, true, 15))).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(owner, saveConfirmation('phone-off', field, true, false, 50, 'phone-on')))
          .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: preparation(field, winner) } } });
      });

    it('recovers the displaced setting only for its owner and sermon generation', async () => {
      const owner = await seed();
      await processCommand(owner, saveConfirmation('desk', 'book', false, true, 80));
      await processCommand(owner, saveConfirmation('phone-on', 'book', false, true, 15));
      await processCommand(owner, saveConfirmation('phone-off', 'book', true, false, 50, 'phone-on'));
      await expect(listSermonPreparationConfirmationHistory(owner, create('prep-check-seed').resource.id, 'prep-check-seed')).resolves.toMatchObject({
        owner, generation: 'prep-check-seed', entries: [{ fields: [{ field: 'readWholeBookOnceConfirmed', value: false, winner: true }] }],
      });
      await expect(listSermonPreparationConfirmationHistory('another-owner', create('prep-check-seed').resource.id, 'prep-check-seed')).rejects.toThrow();
      await expect(listSermonPreparationConfirmationHistory(owner, create('prep-check-seed').resource.id, 'previous-generation')).rejects.toThrow();
    });

    it('asks about the exact checkbox if the matching stored value has an unknown action time', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveConfirmation('desk', 'book', false, true, null))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveConfirmation('phone-on', 'book', false, true, 15))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveConfirmation('phone-off', 'book', true, false, 50, 'phone-on')))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preparation', 'textContext', 'readWholeBookOnceConfirmed'] }] });
    });

    it('merges different confirmations without disturbing the sentence', async () => {
      const owner = await seed();
      expect(await processCommand(owner, saveConfirmation('desk', 'book', false, true, 45))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, saveConfirmation('phone-on', 'prayer', false, true, 15)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { preparation: {
          ...opening, spiritual: { readAndPrayedConfirmed: true }, textContext: { readWholeBookOnceConfirmed: true },
        } } } });
    });

    it.each([
      { name: 'read and prayed', field: 'prayer', reaffirmed: false },
      { name: 'read the book', field: 'book', reaffirmed: false },
      { name: 'reaffirmed book unchecked', field: 'book', reaffirmed: true },
    ] as const)('keeps the returned preparation confirmation after an old $name request', async ({ field, reaffirmed }) => {
      const owner = await seed();
      const other = field === 'prayer' ? 'book' : 'prayer';
      const current = preparation(other, true);
      const legacy = (id: string, before: typeof opening, after: typeof opening) => ({
        ...update(id, 'prep-check-seed'),
        changes: [{ path: ['preparation'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      });
      const marked = preparation(field, true);
      if (!reaffirmed) expect((await processCommand(owner, legacy('mark', opening, marked))).kind).toBe('acknowledged');
      expect((await processCommand(owner, legacy('return', marked, current))).kind).toBe('acknowledged');
      const late = legacy('old-request', opening, marked);
      const answer = await processCommand(owner, late);
      const { section, key } = fields[field];
      expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { preparation: current } },
        conflicts: [{ path: ['preparation', section, key], base: { exists: true, value: false },
          mine: { exists: true, value: true }, theirs: { exists: true, value: false } }] });
      expect(await processCommand(owner, late)).toEqual(answer);
    });

    it('coalesces a reviewed removal with an explicitly unchecked preparation box', async () => {
      const owner = await seed();
      const checked = preparation('book', true);
      expect((await processCommand(owner, saveConfirmation('checked', 'book', false, true, 20))).kind).toBe('acknowledged');
      const markOff = saveConfirmation('unchecked', 'book', true, false, 40);
      markOff.sermonPreparationCheckActions.readWholeBookOnceConfirmed!.observedRevision = 2;
      expect((await processCommand(owner, markOff)).kind).toBe('acknowledged');
      const request = {
        ...saveConfirmation('reviewed-unchecked', 'book', true, false, 60),
        changes: [{ path: ['preparation'], before: { exists: true, value: checked },
          after: { exists: true, value: { ...opening, textContext: {} } } }],
        sermonPreparationCheckActions: { readWholeBookOnceConfirmed: { observedRevision: 2, time: null, reviewed: true as const } },
      };
      expect(await processCommand(owner, request)).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { preparation: opening } },
      });
      expect(documents.get('sermons/sermon-1')?.preparation).toEqual(opening);
    });
  });

  describe('sermon church chronology', () => {
    const originalChurch = { id: 'opening', name: 'Opening church', city: 'Opening city' };
    const deskChurch = { id: 'desk', name: 'Desk church', city: 'Desk city' };
    const phoneChurch = { id: 'phone', name: 'Phone church', city: 'Phone city' };
    const field = (church: typeof originalChurch | null): FieldValue => church
      ? { exists: true, value: church } : { exists: false };

    it.each([
      { name: 'restored church', opening: originalChurch, proposed: phoneChurch, reaffirm: false },
      { name: 'restored empty church', opening: null, proposed: phoneChurch, reaffirm: false },
      { name: 'delayed clear after reaffirmation', opening: originalChurch, proposed: null, reaffirm: true },
    ])('guards an old sermon church save after $name', async ({ opening, proposed, reaffirm }) => {
      const seed = create('sermon-church-return') as Extract<DataCommand, { kind: 'create' }>;
      const unnamed = { id: 'church-unspecified', name: 'Church not specified', city: '' };
      const calendarChurch = { id: 'calendar', name: 'Calendar only', city: 'Calendar city' };
      const row = { id: 'date', date: '2099-04-10', church: unnamed,
        status: 'planned', notes: 'Keep these notes', createdAt: '2099-01-01T00:00:00.000Z' };
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, ...(opening && { church: opening }),
        preachDates: [row] } })).kind).toBe('acknowledged');
      const church = (before: typeof originalChurch | null, after: typeof originalChurch | null) =>
        ({ path: ['church'], before: field(before), after: field(after) });
      const date = (updated: typeof row) => ({ path: ['preachDates'],
        before: { exists: true, value: [row] }, after: { exists: true, value: [updated] } });
      const dated = { ...row, church: calendarChurch };
      if (!reaffirm) expect((await processCommand(seed.owner, {
        ...update('desk', seed.operationId), changes: [church(opening, deskChurch)],
      })).kind).toBe('acknowledged');
      expect((await processCommand(seed.owner, {
        ...update('return', seed.operationId), changes: [church(deskChurch, opening), date(dated)],
      })).kind).toBe('acknowledged');
      const old = {
        ...update('late-phone', seed.operationId), changes: [church(opening, proposed),
          ...(proposed ? [date({ ...row, church: proposed })] : [])],
        ...(proposed && { sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: proposed } }),
      };
      const reply = await processCommand(seed.owner, old);
      expect(reply).toMatchObject({ kind: 'conflict', snapshot: { value: { preachDates: [dated] } },
        conflicts: [{ path: ['church'], base: field(opening), mine: field(proposed), theirs: field(opening) }] });
      expect(documents.get('sermons/sermon-1')?.church).toEqual(opening ?? undefined);
      expect(await processCommand(seed.owner, old)).toEqual(reply);
    });

    it.each([
      { opening: originalChurch, desk: deskChurch, phone: phoneChurch, offset: 20, winner: deskChurch, loser: phoneChurch },
      { opening: originalChurch, desk: deskChurch, phone: phoneChurch, offset: 80, winner: phoneChurch, loser: deskChurch },
      { opening: originalChurch, desk: deskChurch, phone: null, offset: 80, winner: null, loser: deskChurch },
      { opening: originalChurch, desk: null, phone: phoneChurch, offset: 80, winner: phoneChurch, loser: null },
      { opening: null, desk: deskChurch, phone: phoneChurch, offset: 80, winner: phoneChurch, loser: deskChurch },
    ])('keeps the complete winner after delayed delivery at $offset ($opening / $desk / $phone)', async scenario => {
      const seed = create('sermon-church-seed') as Extract<DataCommand, { kind: 'create' }>;
      const notes = 'Notes on a separately named date';
      const preachDates = [{ id: 'date', date: '2099-04-10', church: { id: 'calendar', name: 'Calendar only', city: 'Calendar city' },
        status: 'planned', notes, createdAt: '2099-01-01T00:00:00.000Z' }];
      const value = { ...seed.value, preachDates };
      if (scenario.opening) Object.assign(value, { church: scenario.opening });
      expect((await processCommand(seed.owner, { ...seed, value })).kind).toBe('acknowledged');
      const edit = (operationId: string, chosen: typeof originalChurch | null, offset: number) => ({
        ...update(operationId, 'sermon-church-seed'),
        changes: [{ path: ['church'], before: field(scenario.opening), after: field(chosen) }],
        sermonChurchAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
      });
      expect((await processCommand(seed.owner, edit('desk', scenario.desk, 40))).kind).toBe('acknowledged');
      const request = edit('phone', scenario.phone, scenario.offset);
      const result = await processCommand(seed.owner, request);
      expect(result.kind).toBe('acknowledged');
      const stored = documents.get('sermons/sermon-1');
      expect(stored?.church).toEqual(scenario.winner ?? undefined);
      expect(stored?.preachDates).toEqual(preachDates);
      const history = () => [...documents.entries()].filter(([path]) => path.startsWith('sermons/sermon-1/_churchHistory/'));
      expect(history()).toHaveLength(1);
      expect(history()[0][1]).toMatchObject({ church: scenario.loser, winnerChurch: scenario.winner, generation: 'sermon-church-seed' });
      expect(await listSermonChurchHistory(seed.owner, seed.resource.id, 'sermon-church-seed')).toMatchObject({
        entries: [{ church: scenario.loser, winnerChurch: scenario.winner }],
      });
      await expect(listSermonChurchHistory('another-owner', seed.resource.id, 'sermon-church-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSermonChurchHistory(seed.owner, seed.resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(seed.owner, request)).toEqual(result);
      expect(history()).toHaveLength(1);
    });

    it.each([
      { explicitChurch: false, phoneAt: 20, winner: deskChurch },
      { explicitChurch: true, phoneAt: 20, winner: deskChurch },
      { explicitChurch: true, phoneAt: 80, winner: phoneChurch },
    ])('applies a planned fill only while its date is unnamed and the church choice wins ($explicitChurch / $phoneAt)',
      async ({ explicitChurch, phoneAt, winner }) => {
        const seed = create('sermon-church-projection') as Extract<DataCommand, { kind: 'create' }>;
        const unnamed = { id: 'church-unspecified', name: 'Church not specified', city: '' };
        const calendarChurch = { id: 'calendar', name: 'Calendar only', city: 'Calendar city' };
        const row = { id: 'date', date: '2099-04-10', church: unnamed,
          status: 'planned', notes: 'Keep this note', createdAt: '2099-01-01T00:00:00.000Z' };
        const dateChurch = explicitChurch ? calendarChurch : unnamed;
        expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch, preachDates: [row] } })).kind)
          .toBe('acknowledged');
        const change = (operationId: string, chosen: typeof originalChurch, offset: number) => ({
          ...update(operationId, 'sermon-church-projection'),
          changes: [{ path: ['church'], before: field(originalChurch), after: field(chosen) }],
          sermonChurchAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
        });
        const dates = (after: typeof row) => ({ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [after] } });
        const desk = change('desk', deskChurch, 40);
        expect((await processCommand(seed.owner, { ...desk, changes: explicitChurch
          ? [...desk.changes, dates({ ...row, church: calendarChurch })] : desk.changes })).kind).toBe('acknowledged');
        const phone = change('phone', phoneChurch, phoneAt);
        expect(await processCommand(seed.owner, { ...phone,
          changes: [...phone.changes, dates({ ...row, church: phoneChurch })],
          sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: phoneChurch },
        })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { church: winner, preachDates: [{ ...row, church: dateChurch }] } } });
      });

    it.each([true, false])('moves a date even when its inferred church is stale ($explicitChurch)', async explicitChurch => {
      const seed = create('sermon-date-church-projection') as Extract<DataCommand, { kind: 'create' }>;
      const unnamed = { id: 'church-unspecified', name: 'Church not specified', city: '' };
      const row = { id: 'date', date: '2099-04-10', church: unnamed, status: 'planned', notes: 'Keep notes',
        createdAt: '2099-01-01T00:00:00.000Z' };
      const nextDate = '2099-04-20';
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch, preachDates: [row] } })).kind)
        .toBe('acknowledged');
      const dates = (after: typeof row) => ({ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [after] } });
      const deskChanges = explicitChurch ? [dates({ ...row, church: deskChurch })]
        : [{ path: ['church'], before: field(originalChurch), after: field(deskChurch) }];
      expect((await processCommand(seed.owner, { ...update('desk', 'sermon-date-church-projection'), changes: deskChanges })).kind).toBe('acknowledged');
      const phone = {
        ...update('phone', 'sermon-date-church-projection'), changes: [dates({ ...row, date: nextDate, church: originalChurch })],
        sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: originalChurch },
      };
      expect(await processCommand(seed.owner, phone)).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
        church: explicitChurch ? originalChurch : deskChurch,
        preachDates: [{ ...row, date: nextDate, church: explicitChurch ? deskChurch : unnamed }],
      } } });
    });

    it.each([deskChurch, null])('creates the new date with the current church when the observed sermon choice has since changed (%j)', async latest => {
      const seed = create('sermon-new-date-church') as Extract<DataCommand, { kind: 'create' }>;
      const row = { id: 'date', date: '2099-04-10', church: originalChurch, status: 'planned', createdAt: '2099-01-01T00:00:00.000Z' };
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch, preachDates: [] } })).kind)
        .toBe('acknowledged');
      expect((await processCommand(seed.owner, { ...update('desk', 'sermon-new-date-church'),
        changes: [{ path: ['church'], before: field(originalChurch), after: field(latest) }],
      })).kind).toBe('acknowledged');
      const phone = {
        ...update('phone', 'sermon-new-date-church'),
        changes: [{ path: ['preachDates'], before: { exists: true, value: [] }, after: { exists: true, value: [row] } }],
        sermonChurchFill: { rowId: row.id, rowCreatedAt: row.createdAt, church: originalChurch },
      };
      expect(await processCommand(seed.owner, phone)).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
        preachDates: [{ ...row, church: latest ?? { id: 'church-unspecified', name: 'Church not specified', city: '' } }],
      } } });
    });

    it('retains the two whole churches when the action intervals overlap', async () => {
      const seed = create('sermon-church-uncertain') as Extract<DataCommand, { kind: 'create' }>;
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch } })).kind).toBe('acknowledged');
      const edit = (operationId: string, chosen: typeof originalChurch, offset: number) => ({
        ...update(operationId, 'sermon-church-uncertain'),
        changes: [{ path: ['church'], before: field(originalChurch), after: field(chosen) }],
        sermonChurchAction: { observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_010_000 + offset } },
      });
      // Each changes different properties, but a different church must not inherit the other version's city.
      const desk = { ...originalChurch, city: 'Desk city' };
      const phone = { ...phoneChurch, city: originalChurch.city };
      expect((await processCommand(seed.owner, edit('desk', desk, 40))).kind).toBe('acknowledged');
      expect(await processCommand(seed.owner, edit('phone', phone, 45))).toMatchObject({
        kind: 'conflict', snapshot: { value: { church: desk } },
        conflicts: [{ path: ['church'], base: field(originalChurch), mine: field(phone), theirs: field(desk) }],
      });
      expect([...documents.keys()].filter(path => path.includes('/_churchHistory/'))).toEqual([]);
    });

    it('retains the known title order through an ordinary church conflict', async () => {
      const seed = create('sermon-church-with-title') as Extract<DataCommand, { kind: 'create' }>;
      const title = (value: string): FieldValue => ({ exists: true, value });
      const at = (offset: number) => ({ earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset });
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, title: 'Opening', church: originalChurch } })).kind).toBe('acknowledged');
      const edit = (operationId: string, name: string, church: typeof originalChurch, offset: number) => ({
        ...update(operationId, seed.operationId),
        changes: [{ path: ['title'], before: title('Opening'), after: title(name) },
          { path: ['church'], before: field(originalChurch), after: field(church) }],
        sermonTitleAction: { before: 'Opening', after: name, observedRevision: 1, time: at(offset) },
        sermonChurchAction: { observedRevision: 1, time: null },
      });
      expect((await processCommand(seed.owner, edit('desk', 'Desktop title', deskChurch, 40))).kind).toBe('acknowledged');
      expect(await processCommand(seed.owner, edit('phone', 'Phone title', phoneChurch, 20))).toMatchObject({
        kind: 'conflict', conflicts: expect.arrayContaining([
          { path: ['church'], base: field(originalChurch), mine: field(phoneChurch), theirs: field(deskChurch) },
          { path: ['title'], code: 'sermon-metadata-settled', base: title('Opening'), mine: title('Phone title'), theirs: title('Desktop title') },
        ]),
      });
    });

    it('refreshes a stale reviewed church and coalesces the same chosen value', async () => {
      const seed = create('sermon-church-reviewed') as Extract<DataCommand, { kind: 'create' }>;
      expect((await processCommand(seed.owner, { ...seed, value: { ...seed.value, church: originalChurch } })).kind).toBe('acknowledged');
      const edit = (operationId: string, before: typeof originalChurch, after: typeof originalChurch, revision: number, offset: number, reviewed?: true) => ({
        ...update(operationId, seed.operationId), changes: [{ path: ['church'], before: field(before), after: field(after) }],
        sermonChurchAction: { observedRevision: revision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
          ...(reviewed && { reviewed }) },
      });
      expect((await processCommand(seed.owner, edit('newer', originalChurch, deskChurch, 1, 20))).kind).toBe('acknowledged');
      expect(await processCommand(seed.owner, edit('stale-choice', originalChurch, phoneChurch, 1, 40, true))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['church'], code: 'sermon-church-review-changed',
          base: field(originalChurch), mine: field(phoneChurch), theirs: field(deskChurch) }],
      });
      expect(await processCommand(seed.owner, edit('fresh-choice', deskChurch, phoneChurch, 2, 50, true))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { church: phoneChurch } },
      });
      expect(await processCommand(seed.owner, edit('same-choice', originalChurch, phoneChurch, 1, 60, true))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { church: phoneChurch } },
      });
    });
  });

  it('retains competing free text after a remote return to the opening passage', async () => {
    const seed = create('sermon-verse-return') as Extract<DataCommand, { kind: 'create' }>;
    const verse = 'John 3:16';
    const quote = 'Ephesians 2:8 — ' + 'A note from preparation. '.repeat(300);
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, verse } })).kind).toBe('acknowledged');
    const edit = (id: string, before: string, after: string, observedRevision: number, offset: number) =>
      processCommand('owner-1', { ...update(id, 'sermon-verse-return'),
        changes: [{ path: ['verse'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        sermonVerseAction: { observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_001 + offset } },
      });
    expect((await edit('desk-first', verse, quote, 1, 40)).kind).toBe('acknowledged');
    const metadata = documents.get('sermons/sermon-1')?._dataEngine;
    expect(metadata).toMatchObject({ sermonVerse: { digest: expect.stringMatching(/^[a-zA-Z0-9_-]{43}$/) } });
    expect(JSON.stringify(metadata)).not.toContain(quote);
    expect((await edit('desk-return', quote, verse, 2, 60)).kind).toBe('acknowledged');
    const phone = 'Romans 8:1 — My other note';
    expect(await edit('late-phone', verse, phone, 1, 80)).toMatchObject({
      kind: 'conflict', snapshot: { value: { verse } },
      conflicts: [{ path: ['verse'], mine: { value: phone }, theirs: { value: verse } }],
    });
    expect((await listSermonVerseHistory('owner-1', resource.id, 'sermon-verse-return')).entries).toEqual([]);
  });

  it.each([
    { offset: 20, outcome: 'acknowledged', title: 'Desk title', displaced: 'Phone title' },
    { offset: 80, outcome: 'acknowledged', title: 'Phone title', displaced: 'Desk title' },
    { offset: 45, outcome: 'conflict', title: 'Desk title', displaced: null },
    { offset: null, outcome: 'conflict', title: 'Desk title', displaced: null },
  ] as const)('uses action order for a sermon title delivered later with offset $offset', async ({ offset, outcome, title, displaced }) => {
    const seed = create('sermon-title-seed') as Extract<DataCommand, { kind: 'create' }>;
    const original = { ...seed.value, title: 'Opening title', verse: 'John 1:1' };
    expect((await processCommand('owner-1', { ...seed, value: original })).kind).toBe('acknowledged');
    const rename = (id: string, next: string, at: number | null, verse?: string) => ({
      ...update(id, 'sermon-title-seed'),
      changes: [
        { path: ['title'], before: { exists: true, value: original.title }, after: { exists: true, value: next } },
        ...(verse ? [{ path: ['verse'], before: { exists: true, value: original.verse }, after: { exists: true, value: verse } }] : []),
      ],
      sermonTitleAction: { before: original.title, after: next, observedRevision: 1,
        time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_010 + at } },
    });
    expect((await processCommand('owner-1', rename('desk', 'Desk title', 40, 'John 3:16'))).kind).toBe('acknowledged');
    const incoming = rename('phone', 'Phone title', offset);
    const answer = await processCommand('owner-1', incoming);
    expect(answer).toMatchObject({ kind: outcome, snapshot: { value: { title, verse: 'John 3:16' } } });
    if (outcome === 'conflict') expect(answer).toMatchObject({ conflicts: [{ path: ['title'] }] });
    const history = () => [...documents.entries()].filter(([path]) => path.startsWith('sermons/sermon-1/_titleHistory/'));
    expect(history()).toHaveLength(displaced ? 1 : 0);
    if (displaced) {
      expect(history()[0][1]).toMatchObject({ title: displaced, winnerTitle: title, generation: 'sermon-title-seed' });
      expect(await listSermonTitleHistory('owner-1', resource.id, 'sermon-title-seed')).toMatchObject({
        owner: 'owner-1', sermonId: resource.id, entries: [{ title: displaced, winnerTitle: title }],
      });
      await expect(listSermonTitleHistory('other-owner', resource.id, 'sermon-title-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listSermonTitleHistory('owner-1', resource.id, 'older-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand('owner-1', incoming)).toEqual(answer);
      expect(history()).toHaveLength(1);
    }
  });

  it.each(['actual local change', 'same-value acknowledgement', 'remote round trip'] as const)(
    'keeps unclocked sermon title evidence scoped to the %s', async scenario => {
      const seed = create('title-chain') as Extract<DataCommand, { kind: 'create' }>;
      const value = { ...seed.value, title: 'Opening' };
      expect((await processCommand('owner-1', { ...seed, value })).kind).toBe('acknowledged');
      const change = (id: string, before: string, after: string, observedRevision = 1, predecessorOperationId?: string) =>
        processCommand('owner-1', {
          ...update(id, 'title-chain'), dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
          changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
          sermonTitleAction: { before, after, observedRevision, time: null, ...(predecessorOperationId && { predecessorOperationId }) },
        });
      if (scenario === 'remote round trip') {
        expect((await change('desk-first', 'Opening', 'Middle')).kind).toBe('acknowledged');
        expect((await change('desk-return', 'Middle', 'Opening', 2)).kind).toBe('acknowledged');
        expect(await change('late-phone', 'Opening', 'Phone')).toMatchObject({
          kind: 'conflict', conflicts: [{ path: ['title'] }], snapshot: { value: { title: 'Opening' } },
        });
      } else {
        const sameValue = scenario === 'same-value acknowledgement';
        if (sameValue) expect((await change('desk', 'Opening', 'Middle')).kind).toBe('acknowledged');
        expect((await change('phone-first', 'Opening', 'Middle')).kind).toBe('acknowledged');
        expect(await change('phone-second', 'Middle', 'Opening', 1, 'phone-first')).toMatchObject({
          kind: sameValue ? 'conflict' : 'acknowledged', snapshot: { value: { title: sameValue ? 'Middle' : 'Opening' } },
        });
      }
      expect((await listSermonTitleHistory('owner-1', resource.id, 'title-chain')).entries).toEqual([]);
    });

  it.each(['returned title', 'repeated title'] as const)('keeps a %s from a delayed legacy sermon rename', async scenario => {
    const seed = create('legacy-sermon-title') as Extract<DataCommand, { kind: 'create' }>;
    const opening = { ...seed.value, title: 'Opening title', verse: 'John 1:1' };
    expect(await processCommand('owner-1', { ...seed, value: opening })).toMatchObject({ kind: 'acknowledged' });
    const rename = (operationId: string, before: string, after: string, revision?: number, verse?: string) => ({
      ...update(operationId, 'legacy-sermon-title'),
      changes: [
        { path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } },
        ...(verse ? [{ path: ['verse'], before: { exists: true, value: opening.verse }, after: { exists: true, value: verse } }] : []),
      ],
      ...(revision !== undefined && { sermonTitleAction: { before, after, observedRevision: revision, time: null } }),
    });
    const middle = 'Changed title';
    const returned = scenario === 'returned title';
    const stored = returned ? opening.title : middle;
    const earlier = returned ? middle : opening.title;
    expect(await processCommand('owner-1', rename('change', opening.title, middle, 1))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand('owner-1', rename('confirm', earlier, stored, undefined, 'John 3:16')))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: stored, verse: 'John 3:16' } } });

    const late = rename('late', stored, 'Offline title');
    const answer = await processCommand('owner-1', late);
    expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { title: stored, verse: 'John 3:16' } },
      conflicts: [{ path: ['title'], mine: { value: 'Offline title' }, theirs: { value: stored } }],
    });
    expect(await processCommand('owner-1', late)).toEqual(answer);
    const revision = answer.kind === 'conflict' ? answer.snapshot.metadata!.revision : 0;
    expect(await processCommand('owner-1', rename('choose', stored, 'Offline title', revision)))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Offline title', verse: 'John 3:16' } } });
  });

  it.each([
    { phoneAt: 10, code: 'sermon-metadata-settled' }, { phoneAt: 80, code: 'sermon-metadata-queued' },
  ])('reports independently ordered scripture during returned title review ($code)', async ({ phoneAt, code }) => {
    const seed = create('legacy-sermon-title-review') as Extract<DataCommand, { kind: 'create' }>;
    const original = { ...seed.value, title: 'Opening title', verse: 'John 1:1' };
    const field = (name: string, before: string, after: string) => ({ path: [name],
      before: { exists: true, value: before }, after: { exists: true, value: after } });
    const time = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at });
    const save = (id: string) => update(id, 'legacy-sermon-title-review');
    expect((await processCommand('owner-1', { ...seed, value: original })).kind).toBe('acknowledged');
    expect((await processCommand('owner-1', { ...save('desk'), changes: [
      field('title', original.title, 'Middle title'), field('verse', original.verse, 'Mark 1:2'),
    ], sermonVerseAction: { observedRevision: 1, time: time(40) } })).kind).toBe('acknowledged');
    expect((await processCommand('owner-1', { ...save('restore'),
      changes: [field('title', 'Middle title', original.title)] })).kind).toBe('acknowledged');

    const incoming = { ...save('phone'), changes: [field('title', original.title, 'Phone title'), field('verse', original.verse, 'John 3:16')],
      sermonVerseAction: { observedRevision: 1, time: time(phoneAt) } };
    const answer = await processCommand('owner-1', incoming);
    expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { title: original.title, verse: 'Mark 1:2' } },
      conflicts: [{ path: ['title'] }, { path: ['verse'], code, mine: { value: 'John 3:16' }, theirs: { value: 'Mark 1:2' } }] });
    expect(await processCommand('owner-1', incoming)).toEqual(answer);

    if (code === 'sermon-metadata-queued') {
      expect((await processCommand('owner-1', { ...save('desk-verse-new'), changes: [field('verse', 'Mark 1:2', 'Luke 2:1')],
        sermonVerseAction: { observedRevision: 3, time: time(100) } })).kind).toBe('acknowledged');
      expect((await processCommand('owner-1', { ...save('desk-verse-return'), changes: [field('verse', 'Luke 2:1', 'Mark 1:2')],
        sermonVerseAction: { observedRevision: 4, time: time(110) } })).kind).toBe('acknowledged');
      const chosen = await processCommand('owner-1', { ...save('choose-title'), changes: [
        field('title', original.title, 'Phone title'), field('verse', 'Mark 1:2', 'John 3:16'),
      ], sermonTitleAction: { before: original.title, after: 'Phone title', observedRevision: 5, time: time(120) },
      sermonVerseAction: incoming.sermonVerseAction });
      expect(chosen).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Phone title', verse: 'Mark 1:2' } } });
    }
  });

  it.each([
    { phoneAt: 10, code: 'sermon-metadata-settled' }, { phoneAt: 80, code: 'sermon-metadata-queued' },
  ])('reports an independently ordered planned date during returned title review ($code)', async ({ phoneAt, code }) => {
    const seed = create('legacy-sermon-title-day') as Extract<DataCommand, { kind: 'create' }>;
    const row = { id: 'first', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Chapel', city: 'City' }, audience: 'Keep the audience' };
    const original = { ...seed.value, title: 'Opening title', preachDates: [row] };
    const present = (value: Json) => ({ exists: true, value });
    const time = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at });
    const title = (before: string, after: string) => ({ path: ['title'], before: present(before), after: present(after) });
    const save = (id: string, nextTitle: string, day: string, at: number, before = row.date, observedRevision = 1) => ({
      ...update(id, 'legacy-sermon-title-day'),
      changes: [title(original.title, nextTitle), { path: ['preachDates'], before: present([{ ...row, date: before }]),
        after: present([{ ...row, date: day }]) }],
      preachDateAction: { rowId: row.id, before, after: day, observedRevision, time: time(at) },
    });
    expect((await processCommand('owner-1', { ...seed, value: original })).kind).toBe('acknowledged');
    expect((await processCommand('owner-1', save('desk', 'Middle title', '2026-12-20', 40))).kind).toBe('acknowledged');
    expect((await processCommand('owner-1', { ...update('restore', 'legacy-sermon-title-day'),
      changes: [title('Middle title', original.title)] })).kind).toBe('acknowledged');

    const phone = save('phone', 'Phone title', '2026-12-27', phoneAt);
    const answer = await processCommand('owner-1', phone);
    expect(answer).toMatchObject({ kind: 'conflict', snapshot: { value: { title: original.title, preachDates: [{ ...row, date: '2026-12-20' }] } },
      conflicts: [{ path: ['title'] }, { path: ['preachDates', 'id:first', 'date'], code,
        mine: { value: '2026-12-27' }, theirs: { value: '2026-12-20' } }] });

    if (code === 'sermon-metadata-queued') {
      const editDay = (id: string, before: string, after: string, at: number, revision: number) =>
        processCommand('owner-1', save(id, original.title, after, at, before, revision));
      expect((await editDay('move', '2026-12-20', '2026-12-21', 100, 3)).kind).toBe('acknowledged');
      expect((await editDay('return', '2026-12-21', '2026-12-20', 110, 4)).kind).toBe('acknowledged');
      const chosen = await processCommand('owner-1', { ...save('choose', 'Phone title', '2026-12-27', phoneAt, '2026-12-20'),
        sermonTitleAction: { before: original.title, after: 'Phone title', observedRevision: 5, time: time(120) } });
      expect(chosen).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Phone title', preachDates: [{ ...row, date: '2026-12-20' }] } } });
    }
  });

  it('does not invent a title edit when removing a legacy series mirror from an older sermon', async () => {
    const now = '2026-11-08T00:00:00.000Z';
    const original = { userId: 'owner-1', title: 'Opening', verse: 'John 1:1', date: now, thoughts: [], seriesId: 'old-series', seriesPosition: 1 };
    documents.set('sermons/sermon-1', { ...original, _dataEngine: { protocol: 1, generation: 'old-sermon', revision: 3, deleted: false } });
    const series = { userId: 'owner-1', title: 'Old series', items: [] };
    documents.set('series/old-series', series);
    const deletion = await processCommand('owner-1', {
      protocol: 1, operationId: 'remove-series', owner: 'owner-1', resource: { collection: 'series', id: 'old-series' },
      kind: 'delete', generation: null, dependsOn: [], baseline: series,
    });
    expect(deletion).toMatchObject({ kind: 'acknowledged', relatedSnapshots: [{
      resource, metadata: { revision: 4 }, value: { title: original.title, seriesId: null },
    }] });
    const renamed = await processCommand('owner-1', { ...update('rename-old-sermon', 'old-sermon'),
      changes: [{ path: ['title'], before: { exists: true, value: original.title }, after: { exists: true, value: 'Revised' } }],
      sermonTitleAction: { before: original.title, after: 'Revised', observedRevision: 3, time: null },
    });
    expect(renamed).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Revised', seriesId: null } } });
  });

  it.each([
    { name: 'legacy rename', time: undefined },
    { name: 'rename without an action clock', time: null },
  ])('protects a restored group name from a delayed $name', async ({ time }) => {
    const resource = { collection: 'groups', id: 'returned-group-name' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const original = 'Original group', temporary = 'Temporary group', offline = 'Title entered offline';
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: original, description: 'Keep original description', status: 'draft',
        templates: [], flow: [], meetingDates: [], createdAt: now, updatedAt: now },
    })).toMatchObject({ kind: 'acknowledged' });
    const rename = (operationId: string, before: string, after: string, observedRevision: number, clock?: null) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      ...(clock !== undefined && { groupTitleAction: { before, after, observedRevision, time: clock } }),
    });
    expect(await processCommand(base.owner, rename('change', original, temporary, 1, null))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, rename('restore', temporary, original, 2, null))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, { ...base, kind: 'update', operationId: 'separate', generation: 'seed',
      changes: [{ path: ['description'], before: { exists: true, value: 'Keep original description' },
        after: { exists: true, value: 'Later independent description' } }],
    })).toMatchObject({ kind: 'acknowledged' });
    const delayed = rename('delayed', original, offline, 1, time);
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { title: original, description: 'Later independent description' } },
      conflicts: [{ path: ['title'], mine: { value: offline }, theirs: { value: original } }],
    });
    expect(await processCommand(base.owner, delayed)).toEqual(result);
    const revision = result.kind === 'conflict' ? result.snapshot.metadata!.revision : 0;
    expect(await processCommand(base.owner, rename('choice', original, offline, revision, null)))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: offline, description: 'Later independent description' } } });
  });

  it.each([
    { clock: 20, expected: 'group-flow-text-settled' },
    { clock: 80, expected: 'group-flow-text-queued' },
  ])('reports proved group description independently of a returned title at $clock', async ({ clock, expected }) => {
    const resource = { collection: 'groups', id: 'group-name-and-description' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const opening = { title: 'Opening title', description: 'Original description' };
    const changed = { title: 'Temporary title', description: 'Desktop description' };
    const returned = { ...changed, title: opening.title };
    const proposal = { title: 'Offline title', description: 'Phone description' };
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, status: 'draft', templates: [], flow: [], meetingDates: [], ...opening, createdAt: now, updatedAt: now },
    })).toMatchObject({ kind: 'acknowledged' });
    const save = (operationId: string, before: typeof opening, after: typeof opening, descriptionAt?: number) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: (['title', 'description'] as const).flatMap(field => before[field] === after[field] ? [] : [{
        path: [field], before: { exists: true, value: before[field] }, after: { exists: true, value: after[field] },
      }]),
      ...(descriptionAt !== undefined && { groupDescriptionAction: {
        observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + descriptionAt, latestMs: 1_800_000_000_010 + descriptionAt },
      } }),
    });
    expect(await processCommand(base.owner, save('desktop', opening, changed, 40))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, save('return-title', changed, returned))).toMatchObject({ kind: 'acknowledged' });
    const delayed = save('phone', opening, proposal, clock);
    const result = await processCommand(base.owner, delayed);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: returned } });
    expect(result.kind === 'conflict' ? result.conflicts : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['title'] }),
      expect.objectContaining({ path: ['description'], code: expected,
        mine: { exists: true, value: proposal.description }, theirs: { exists: true, value: returned.description } }),
    ]));
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-name-and-description/_metadataHistory/'));
    expect(history).toHaveLength(clock < 40 ? 1 : 0);
  });

  it.each([
    { scenario: 'earlier offline title', offset: 20, title: 'Phone', winner: 'Desk', archived: 'Phone', kind: 'acknowledged' },
    { scenario: 'later offline title', offset: 60, title: 'Phone', winner: 'Phone', archived: 'Desk', kind: 'acknowledged' },
    { scenario: 'overlapping time', offset: 45, title: 'Phone', winner: 'Desk', archived: null, kind: 'conflict' },
    { scenario: 'independent description', offset: 20, title: 'Phone', winner: 'Phone', archived: null, kind: 'acknowledged' },
  ])('orders only the exact group title: $scenario', async ({ scenario, offset, title, winner, archived, kind }) => {
    const resource = { collection: 'groups', id: 'group-title' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const value = { userId: base.owner, title: 'Original', description: 'Original description', status: 'draft',
      templates: [], flow: [], meetingDates: [], createdAt: now, updatedAt: now };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null, value })).kind).toBe('acknowledged');
    const update = (operationId: string, key: 'title' | 'description', after: string) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: [key], before: { exists: true, value: value[key] }, after: { exists: true, value: after } }],
    });
    const rename = (operationId: string, after: string, offsetMs: number) => ({
      ...update(operationId, 'title', after),
      groupTitleAction: { before: value.title, after, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offsetMs, latestMs: 1_800_000_000_010 + offsetMs } },
    });
    const adjacent = scenario === 'independent description';
    expect((await processCommand(base.owner, adjacent ? update('desk', 'description', 'Desk notes') : rename('desk', 'Desk', 40))).kind).toBe('acknowledged');
    const phone = rename('phone', title, offset);
    const result = await processCommand(base.owner, phone);
    expect(result).toMatchObject({ kind, snapshot: { value: { title: winner, description: adjacent ? 'Desk notes' : value.description,
      status: 'draft', meetingDates: [] } } });
    const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-title/_titleHistory/'));
    expect(history).toHaveLength(archived === null ? 0 : 1);
    if (archived !== null) {
      expect(history[0][1]).toMatchObject({ title: archived, winnerTitle: winner, generation: 'seed' });
      expect(await listGroupTitleHistory(base.owner, resource.id, 'seed')).toMatchObject({
        owner: base.owner, groupId: resource.id, generation: 'seed', entries: [{ title: archived, winnerTitle: winner }],
      });
      await expect(listGroupTitleHistory('another-owner', resource.id, 'seed')).rejects.toMatchObject({ status: 403 });
      await expect(listGroupTitleHistory(base.owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
      expect(await processCommand(base.owner, phone)).toEqual(result);
      expect([...documents.keys()].filter(path => path.startsWith('groups/group-title/_titleHistory/'))).toHaveLength(1);
    }
    if (kind === 'conflict') expect(result).toMatchObject({ conflicts: [{ path: ['title'] }] });
  });

  describe('account preference action order', () => {
    const owner = 'owner-1';
    const resource = { collection: 'users', id: owner };
    const generation = 'settings-seed';
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const preferences = [
      { field: 'firstDayOfWeek', original: 'monday', changed: 'sunday' },
      { field: 'showAppVersion', original: false, changed: true },
      { field: 'enableAudioGeneration', original: false, changed: true },
      { field: 'language', original: 'en', changed: 'ru' },
      { field: 'preferredText', original: { providerId: 'openai', modelId: 'model-a' }, changed: { providerId: 'gemini', modelId: 'model-b' } },
      { field: 'preferredTranscription', original: { providerId: 'openai', modelId: 'model-a' }, changed: { providerId: 'openai', modelId: 'model-b' } },
      { field: 'preferredTts', original: { providerId: 'openai', modelId: 'model-a' }, changed: { providerId: 'openai', modelId: 'model-b' } },
    ] as const;

    async function seed() {
      const value = Object.fromEntries(preferences.map(({ field, original }) => [field, original]));
      expect(await processCommand(owner, { ...base, kind: 'create', generation: null, operationId: generation, value }))
        .toMatchObject({ kind: 'acknowledged' });
    }

    function choose(operationId: string, field: string, before: Json, after: Json, observedRevision: number, offset: number | null) {
      return { ...base, kind: 'update', generation, operationId,
        changes: [{ path: [field], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        accountPreferenceActions: { [field]: { observedRevision, time: offset === null ? null : {
          earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset,
        } } },
      };
    }

    it.each(preferences)('keeps the newer deliberate return to the opening $field', async ({ field, original, changed }) => {
      await seed();
      expect(await processCommand(owner, choose('desktop-change', field, original, changed, 1, 40)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { [field]: changed } } });
      expect(await processCommand(owner, choose('desktop-return', field, changed, original, 2, 60)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { [field]: original } } });
      expect(await processCommand(owner, choose('phone-earlier', field, original, changed, 1, 20)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { [field]: original } } });
    });

    it('reviews the complete model when concurrent changes target different members of the selection', async () => {
      await seed();
      const old = { providerId: 'openai', modelId: 'model-a' };
      const saved = { providerId: 'openai', modelId: 'model-b' };
      const mine = { providerId: 'gemini', modelId: 'model-a' };
      await processCommand(owner, choose('desktop-model', 'preferredText', old, saved, 1, 40));
      expect(await processCommand(owner, choose('unknown-model', 'preferredText', old, mine, 1, null)))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['preferredText'], mine: { value: mine }, theirs: { value: saved } }],
          snapshot: { value: { preferredText: saved } } });
    });

    it('applies the later choice and preserves an independent preference', async () => {
      await seed();
      await processCommand(owner, choose('desktop-sunday', 'firstDayOfWeek', 'monday', 'sunday', 1, 40));
      await processCommand(owner, choose('desktop-monday', 'firstDayOfWeek', 'sunday', 'monday', 2, 60));
      await processCommand(owner, choose('desktop-audio', 'enableAudioGeneration', false, true, 3, 65));
      expect(await processCommand(owner, choose('phone-later', 'firstDayOfWeek', 'monday', 'sunday', 1, 80)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { firstDayOfWeek: 'sunday', enableAudioGeneration: true } } });
    });

    it.each([20, 80, null])('settles a reader switch with action time %s while preserving a sibling', async time => {
      await seed();
      const before = { crossReferences: { show: true, inWindow: false } };
      const off = { crossReferences: { show: false, inWindow: false } };
      const online = { crossReferences: { show: true, inWindow: true } };
      const readingCommand = (operationId: string, old: Json, next: Json, revision: number, offset: number | null) => {
        const command = choose(operationId, 'reading', old, next, revision, offset);
        return { ...command, accountPreferenceActions: {
          'reading.crossReferences.show': command.accountPreferenceActions.reading,
        } };
      };
      await processCommand(owner, { ...base, kind: 'update', generation, operationId: 'seed-reading',
        changes: [{ path: ['reading'], before: { exists: false }, after: { exists: true, value: before } }] });
      await processCommand(owner, readingCommand('reader-desktop-off', before, off, 2, 40));
      await processCommand(owner, readingCommand('reader-desktop-on', off, online, 3, 60));
      const answer = await processCommand(owner, readingCommand('reader-phone', before, off, 2, time));
      if (time === null) {
        expect(answer).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['reading', 'crossReferences', 'show'] }],
          snapshot: { value: { reading: online } } });
      } else {
        expect(answer).toMatchObject({ kind: 'acknowledged',
          snapshot: { value: { reading: { crossReferences: { show: time === 20, inWindow: true } } } } });
      }
    });

    it('keeps the displaced choice once in owner- and generation-bound history', async () => {
      await seed();
      await processCommand(owner, choose('desktop-sunday', 'firstDayOfWeek', 'monday', 'sunday', 1, 40));
      await processCommand(owner, choose('desktop-monday', 'firstDayOfWeek', 'sunday', 'monday', 2, 60));
      const phone = choose('phone-earlier', 'firstDayOfWeek', 'monday', 'sunday', 1, 20);
      const result = await processCommand(owner, phone);
      expect(await processCommand(owner, phone)).toEqual(result);
      const history = await listAccountPreferenceHistory(owner, resource.id, generation);
      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].fields).toEqual([expect.objectContaining({
        field: 'firstDayOfWeek', value: 'sunday', winner: 'monday',
      })]);
      await expect(listAccountPreferenceHistory('another-owner', resource.id, generation)).rejects.toMatchObject({ status: 403 });
      await expect(listAccountPreferenceHistory(owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('reviews the exact preference when an earlier-looking delivery has no action clock', async () => {
      await seed();
      await processCommand(owner, choose('desktop-sunday', 'firstDayOfWeek', 'monday', 'sunday', 1, 40));
      await processCommand(owner, choose('desktop-monday', 'firstDayOfWeek', 'sunday', 'monday', 2, 60));
      expect(await processCommand(owner, choose('unknown', 'firstDayOfWeek', 'monday', 'sunday', 1, null)))
        .toMatchObject({ kind: 'conflict', conflicts: [{ path: ['firstDayOfWeek'],
          mine: { exists: true, value: 'sunday' }, theirs: { exists: true, value: 'monday' } }],
          snapshot: { value: { firstDayOfWeek: 'monday' } } });
    });
  });

  describe('council section placement chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'councils', id: 'section-placement' };
    const generation = 'section-placement-seed';
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const at = '2026-11-09T00:00:00.000Z';
    const initial = ['a', 'b', 'c', 'd'];
    const up = ['b', 'a', 'c', 'd'];
    const down = ['a', 'c', 'b', 'd'];
    const topic = (id: string) => ({ id, title: 'Section ' + id, kind: 'decision', summary: 'Words for ' + id, questions: [], options: [] });
    const topics = (ids: string[]) => ids.map(topic);
    const witness = (ids: string[]) => ids.map(id => ({ id }));
    const clock = (ms: number) => ({ earliestMs: 1_800_000_000_000 + ms, latestMs: 1_800_000_000_004 + ms });
    const gap = (ids: string[]) => {
      const index = ids.indexOf('b');
      return { previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
    };
    const stored = () => documents.get('councils/section-placement');

    async function seed() {
      expect(await processCommand(owner, { ...base, kind: 'create', operationId: generation, generation: null,
        value: { userId: owner, title: 'Council', status: 'preparing', topics: topics(initial), createdAt: at, updatedAt: at },
      })).toMatchObject({ kind: 'acknowledged' });
    }

    function move(operationId: string, before: string[], after: string[], observedRevision: number,
      time: ReturnType<typeof clock> | null, councilTopicQueue = operationId, predecessorOperationId?: string) {
      return { ...base, kind: 'update', operationId, generation, councilTopicQueue,
        dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['topics'], before: { exists: true, value: witness(before) }, after: { exists: true, value: witness(after) } }],
        councilTopicPlacement: { stepId: 'b', observedRevision, time, opening: gap(before), destination: gap(after),
          ...(predecessorOperationId && { predecessorOperationId }) },
      };
    }

    async function replaceTopics(operationId: string, before: ReturnType<typeof topics>, after: ReturnType<typeof topics>) {
      return processCommand(owner, { ...base, kind: 'update', operationId, generation,
        changes: [{ path: ['topics'], before: { exists: true, value: before }, after: { exists: true, value: after } }] });
    }

    it('keeps the late return, stores the displaced spot once, and refuses an old unsigned permutation', async () => {
      await seed();
      expect(await processCommand(owner, move('desktop-down', initial, down, 1, clock(40)))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('desktop-back', down, initial, 2, clock(70)))).toMatchObject({ kind: 'acknowledged' });
      const stale = move('phone-old', initial, up, 1, clock(15));
      const result = await processCommand(owner, stale);
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { topics: topics(initial) } } });
      expect(await processCommand(owner, stale)).toEqual(result);
      const history = [...documents.entries()].filter(([path]) => path.startsWith('councils/section-placement/_topicPlacementHistory/'));
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ stepId: 'b', earlier: { previous: null, next: { id: 'a' } },
        kept: { previous: { id: 'a' }, next: { id: 'c' } } });
      expect(await replaceTopics('unsigned', topics(initial), topics(up))).toMatchObject({
        kind: 'refused', code: 'council-topic-placement-needs-review',
      });
      expect(stored()?.topics).toEqual(topics(initial));
    });

    it('moves only the later section and keeps independently saved words', async () => {
      await seed();
      await processCommand(owner, move('desktop-down', initial, down, 1, clock(25)));
      const edited = { ...topic('b'), summary: 'Words saved independently' };
      expect(await replaceTopics('summary', topics(down), topics(down).map(row => row.id === 'b' ? edited : row)))
        .toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('phone-late', initial, up, 1, clock(80)))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { topics: topics(up).map(row => row.id === 'b' ? edited : row) } },
      });
    });

    it('shows only the exact section when the action times cannot be ordered', async () => {
      await seed();
      await processCommand(owner, move('desktop-down', initial, down, 1, clock(25)));
      expect(await processCommand(owner, move('unknown', initial, up, 1, null))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['topics', 'id:b', 'position'] }],
        serviceOrderPlacementComparison: { step: { id: 'b', title: 'Section b' }, available: true },
      });
      expect(stored()?.topics).toEqual(topics(down));
    });

    it('cannot use a destination topic that was removed and recreated', async () => {
      await seed();
      const withoutA = initial.filter(id => id !== 'a');
      expect(await replaceTopics('remove-a', topics(initial), topics(withoutA))).toMatchObject({ kind: 'acknowledged' });
      expect(await replaceTopics('new-a', topics(withoutA), topics(initial))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('old-move', initial, up, 1, clock(40)))).toMatchObject({
        kind: 'conflict', serviceOrderPlacementComparison: { step: { id: 'b' }, available: false },
      });
      expect(stored()?.topics).toEqual(topics(initial));
    });

    it('keeps a held agenda unchanged when a signed or pre-upgrade reorder arrives late', async () => {
      await seed();
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'hold', generation,
        changes: [{ path: ['status'], before: { exists: true, value: 'preparing' }, after: { exists: true, value: 'held' } },
          { path: ['heldAt'], before: { exists: false }, after: { exists: true, value: at } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('signed-offline', initial, up, 1, clock(20)))).toMatchObject({
        kind: 'refused', code: 'council-topic-placement-needs-review',
      });
      expect(await replaceTopics('unsigned-offline', topics(initial), topics(up))).toMatchObject({
        kind: 'refused', code: 'council-topic-placement-needs-review',
      });
      expect(stored()).toMatchObject({ status: 'held', topics: topics(initial) });
    });

    it('needs the exact same queue for a continuation without clocks', async () => {
      await seed();
      await processCommand(owner, move('previous', initial, down, 1, null, 'actual-queue'));
      expect(await processCommand(owner, move('different', down, initial, 1, null, 'other-queue', 'previous'))).toMatchObject({ kind: 'conflict' });
      expect(await processCommand(owner, move('same', down, initial, 1, null, 'actual-queue', 'previous'))).toMatchObject({ kind: 'acknowledged' });
      expect(stored()?.topics).toEqual(topics(initial));
    });
  });

  describe('group meeting step placement chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'groups', id: 'group-step-placement' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const generation = 'group-step-placement-seed';
    const date = '2026-11-09T00:00:00.000Z';
    const initial = ['a', 'b', 'c', 'd'];
    const up = ['b', 'a', 'c', 'd'];
    const down = ['a', 'c', 'b', 'd'];
    const templates = initial.map(id => ({ id: 'template-' + id, type: 'custom', title: 'Step ' + id,
      content: 'Keep the text for ' + id, status: 'filled', createdAt: date, updatedAt: date }));
    const witness = (order: string[]) => order.map(id => ({ id, templateId: 'template-' + id }));
    const flow = (order: string[]) => witness(order).map((row, index) => ({ ...row, order: index + 1, durationMin: 12 }));
    const gap = (order: string[]) => {
      const index = order.indexOf('b');
      return { previous: order[index - 1] ?? null, next: order[index + 1] ?? null };
    };
    const clock = (start: number, end = start + 4) => ({ earliestMs: 1_800_000_000_000 + start, latestMs: 1_800_000_000_000 + end });

    async function seed() {
      expect(await processCommand(owner, { ...base, kind: 'create', operationId: generation, generation: null,
        value: { userId: owner, title: 'Group', status: 'active', templates, flow: flow(initial), createdAt: date, updatedAt: date },
      })).toMatchObject({ kind: 'acknowledged' });
    }

    function move(operationId: string, before: string[], after: string[], observedRevision: number,
      time: ReturnType<typeof clock> | null, queueId = operationId, predecessorOperationId?: string) {
      return { ...base, kind: 'update', operationId, generation,
        dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['flow'], before: { exists: true, value: witness(before) }, after: { exists: true, value: witness(after) } }],
        groupFlowStepPlacement: { stepId: 'b', queueId, observedRevision, time, opening: gap(before), destination: gap(after),
          ...(predecessorOperationId && { predecessorOperationId }) },
      };
    }

    it('keeps a later return to the opening position when the old move arrives last', async () => {
      await seed();
      await processCommand(owner, move('desk-down', initial, down, 1, clock(40)));
      await processCommand(owner, move('desk-back', down, initial, 2, clock(70)));
      const stale = move('phone-old', initial, up, 1, clock(15));
      const result = await processCommand(owner, stale);
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { flow: flow(initial), templates } } });
      expect(await processCommand(owner, stale)).toEqual(result);
      const history = [...documents.entries()].filter(([path]) => path.startsWith('groups/group-step-placement/_groupStepPlacementHistory/'));
      expect(history).toHaveLength(1);
      expect(history[0][1]).toMatchObject({ stepId: 'b', earlier: { previous: null, next: { id: 'a' } },
        kept: { previous: { id: 'a' }, next: { id: 'c' } } });
    });

    it('does not let a pre-upgrade queued array undo a proven return', async () => {
      await seed();
      await processCommand(owner, move('desk-down', initial, down, 1, clock(40)));
      await processCommand(owner, move('desk-back', down, initial, 2, clock(70)));
      await processCommand(owner, { ...base, kind: 'update', operationId: 'legacy-old', generation,
        changes: [{ path: ['flow'], before: { exists: true, value: flow(initial) }, after: { exists: true, value: flow(up) } }] });
      expect(documents.get('groups/group-step-placement')?.flow).toEqual(flow(initial));
    });

    it('applies the later move without discarding a duration saved on the other device', async () => {
      await seed();
      await processCommand(owner, move('desk', initial, down, 1, clock(20)));
      const stored = flow(down);
      const edited = stored.map(step => step.id === 'b' ? { ...step, durationMin: 35 } : step);
      await processCommand(owner, { ...base, kind: 'update', operationId: 'duration', generation,
        changes: [{ path: ['flow'], before: { exists: true, value: stored }, after: { exists: true, value: edited } }] });
      const result = await processCommand(owner, move('phone', initial, up, 1, clock(80)));
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { templates,
        flow: flow(up).map(step => step.id === 'b' ? { ...step, durationMin: 35 } : step) } } });
    });

    it('shows the exact positions when the action times cannot be ordered', async () => {
      await seed();
      await processCommand(owner, move('desk', initial, down, 1, clock(20)));
      expect(await processCommand(owner, move('phone', initial, up, 1, null))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['flow', 'id:b', 'position'] }],
        serviceOrderPlacementComparison: { available: true, step: { id: 'b', title: 'Step b' },
          mine: { previous: null, next: { id: 'a', title: 'Step a' } },
          saved: { previous: { id: 'c', title: 'Step c' }, next: { id: 'd', title: 'Step d' } } },
      });
    });

    it('does not narrow overlapping proof for the same destination', async () => {
      await seed();
      await processCommand(owner, move('first', initial, up, 1, clock(10, 30)));
      await processCommand(owner, move('same-place', initial, up, 1, clock(20, 25)));
      expect(await processCommand(owner, move('third', initial, down, 1, clock(26, 27))))
        .toMatchObject({ kind: 'conflict', snapshot: { value: { flow: flow(up) } } });
    });

    it('does not let a different editor claim an overlapping predecessor', async () => {
      await seed();
      await processCommand(owner, move('first', initial, up, 1, clock(15, 45), 'own-queue'));
      expect(await processCommand(owner, move('other', up, down, 1, clock(20, 35), 'other-queue', 'first')))
        .toMatchObject({ kind: 'conflict' });
      expect(await processCommand(owner, move('own-second', up, down, 1, clock(20, 35), 'own-queue', 'first')))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { flow: flow(down) } } });
    });

    it('does not move a step relative to a deleted and recreated anchor', async () => {
      await seed();
      const without = flow(initial.filter(id => id !== 'a'));
      await processCommand(owner, { ...base, kind: 'update', operationId: 'remove-anchor', generation,
        changes: [{ path: ['flow'], before: { exists: true, value: flow(initial) }, after: { exists: true, value: without } }] });
      await processCommand(owner, { ...base, kind: 'update', operationId: 'restore-anchor', generation,
        changes: [{ path: ['flow'], before: { exists: true, value: without }, after: { exists: true, value: flow(initial) } }] });
      expect(await processCommand(owner, move('phone', initial, up, 1, clock(85))))
        .toMatchObject({ kind: 'conflict', serviceOrderPlacementComparison: { available: false }, snapshot: { value: { flow: flow(initial) } } });
    });
  });

  describe('service step move chronology', () => {
    const owner = 'owner-1';
    const resource = { collection: 'serviceOrders', id: 'service-step-position' };
    const base = { protocol: 1, owner, resource, dependsOn: [] };
    const generation = 'service-step-position-seed';
    const steps = [
      { id: 'alpha', title: 'Alpha', body: 'Keep the opening words', scriptureRefs: ['John 1:1'] },
      { id: 'beta', title: 'Beta', body: 'Keep the middle words', flagged: true },
      { id: 'gamma', title: 'Gamma', body: 'Keep the last words' },
    ];
    const [alpha, beta, gamma] = steps;
    const now = '2026-11-09T00:00:00.000Z';

    async function seed() {
      expect(await processCommand(owner, { ...base, kind: 'create', operationId: generation, generation: null,
        value: { userId: owner, title: 'Test service', rank: 1000, steps, createdAt: now, updatedAt: now },
      })).toMatchObject({ kind: 'acknowledged' });
    }

    function move(id: string, to: 'top' | 'bottom', offset: number | null) {
      return { ...base, kind: 'update', operationId: id, generation,
        changes: [{ path: ['steps'], before: { exists: true, value: steps },
          after: { exists: true, value: to === 'top' ? [beta, alpha, gamma] : [alpha, gamma, beta] } }],
        serviceOrderStepPlacement: {
          stepId: 'beta', observedRevision: 1, time: offset === null ? null : {
            earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset,
          },
          opening: { previous: 'alpha', next: 'gamma' },
          destination: to === 'top' ? { previous: null, next: 'alpha' } : { previous: 'gamma', next: null },
        },
      };
    }

    it.each([
      { phoneAt: 20, expected: [beta, alpha, gamma], kind: 'acknowledged' },
      { phoneAt: 80, expected: [alpha, gamma, beta], kind: 'acknowledged' },
      { phoneAt: null, expected: [beta, alpha, gamma], kind: 'conflict' },
    ] as const)('keeps the correct step position for a phone move at $phoneAt', async ({ phoneAt, expected, kind }) => {
      await seed();
      expect(await processCommand(owner, move('desktop', 'top', 40))).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('phone', 'bottom', phoneAt)))
        .toMatchObject({ kind, snapshot: { value: { steps: expected } } });
    });

    it('preserves a separate step edit while applying a move', async () => {
      await seed();
      const editedAlpha = { ...alpha, body: 'Independent words saved on the computer' };
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'edit-words', generation,
        changes: [{ path: ['steps'], before: { exists: true, value: steps }, after: { exists: true, value: [editedAlpha, beta, gamma] } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('phone', 'bottom', 80)))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [editedAlpha, gamma, beta] } } });
    });

    it('archives the displaced gap once and scopes its history to the owner and generation', async () => {
      await seed();
      await processCommand(owner, move('desktop', 'top', 40));
      const phone = move('phone', 'bottom', 80);
      const accepted = await processCommand(owner, phone);
      expect(await processCommand(owner, phone)).toEqual(accepted);
      expect(await listServiceOrderStepPlacementHistory(owner, resource.id, generation)).toMatchObject({
        owner, orderId: resource.id, generation, nextCursor: null, entries: [{
          stepId: 'beta', stepTitle: 'Beta', earlier: { previous: null, next: { id: 'alpha', title: 'Alpha' } },
          kept: { previous: { id: 'gamma', title: 'Gamma' }, next: null },
        }],
      });
      expect((await listServiceOrderStepPlacementHistory(owner, resource.id, generation)).entries).toHaveLength(1);
      await expect(listServiceOrderStepPlacementHistory('another-owner', resource.id, generation)).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderStepPlacementHistory(owner, resource.id, 'old-generation')).rejects.toMatchObject({ status: 404 });
    });

    it('reviews a legacy reorder using current neighbor names', async () => {
      await seed();
      const { changes } = move('old-client', 'top', null);
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'old-client', generation, changes }))
        .toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [beta, alpha, gamma] } } });
      expect(await processCommand(owner, move('phone', 'bottom', 80))).toMatchObject({
        kind: 'conflict', conflicts: [{ path: ['steps', 'id:beta', 'position'] }],
        serviceOrderPlacementComparison: {
          step: { id: 'beta', title: 'Beta' }, available: true,
          mine: { previous: { id: 'gamma', title: 'Gamma' }, next: null },
          saved: { previous: null, next: { id: 'alpha', title: 'Alpha' } },
        },
      });
    });

    it('does not certify a pre-upgrade permutation during an independent words save', async () => {
      await seed();
      const key = 'serviceOrders/' + resource.id;
      const old = documents.get(key)!;
      documents.set(key, { ...old, steps: [beta, alpha, gamma],
        _dataEngine: { protocol: 1, generation, revision: 2, deleted: false, operationId: 'legacy-reorder' } });
      const edited = { ...alpha, body: 'Independent text after upgrade' };
      expect(await processCommand(owner, { ...base, kind: 'update', operationId: 'upgrade-words', generation,
        changes: [{ path: ['steps'], before: { exists: true, value: [beta, alpha, gamma] },
          after: { exists: true, value: [beta, edited, gamma] } }],
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('phone', 'bottom', 80))).toMatchObject({
        kind: 'conflict', serviceOrderPlacementComparison: { available: true },
        snapshot: { value: { steps: [beta, edited, gamma] } },
      });
    });

    it('accepts a provably later move across a pre-upgrade text-only edit', async () => {
      await seed();
      const key = 'serviceOrders/' + resource.id;
      const old = documents.get(key)!;
      const edited = { ...alpha, body: 'Words edited before the upgrade' };
      documents.set(key, { ...old, steps: [edited, beta, gamma],
        _dataEngine: { protocol: 1, generation, revision: 2, deleted: false, operationId: 'legacy-text' } });
      const desktop = move('desktop', 'top', 40);
      expect(await processCommand(owner, { ...desktop, serviceOrderStepPlacement: {
        ...desktop.serviceOrderStepPlacement, observedRevision: 2,
      } })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('phone', 'bottom', 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { steps: [edited, gamma, beta] } },
      });
    });

    it.each(['body', 'title', 'anchor'])('returns and replays the position choice with a large %s', async field => {
      await seed();
      const key = 'serviceOrders/' + resource.id;
      const words = 'x'.repeat(550_000);
      const longAlpha = field === 'anchor' ? { ...alpha, title: words }
        : field === 'body' ? { ...alpha, body: words } : alpha;
      const longBeta = field === 'title' ? { ...beta, title: words } : beta;
      const old = documents.get(key)!;
      documents.set(key, { ...old, steps: [longAlpha, longBeta, gamma] });
      const projected = (command: ReturnType<typeof move>) => ({ ...command,
        changes: command.changes.map(change => ({ ...change,
          before: { ...change.before, value: change.before.value.map(({ id }) => ({ id })) },
          after: { ...change.after, value: change.after.value.map(({ id }) => ({ id })) } })),
      });
      expect(await processCommand(owner, projected(move('desktop', 'top', 40)))).toMatchObject({ kind: 'acknowledged' });
      const offline = projected(move('phone', 'bottom', null));
      const result = await processCommand(owner, offline);
      expect(result).toMatchObject({ kind: 'conflict', serviceOrderPlacementComparison: { available: true },
        snapshot: { value: { steps: [longBeta, longAlpha, gamma] } } });
      expect(await processCommand(owner, offline)).toEqual(result);
    });

    it.each(['beta', 'gamma'])('does not recreate the removed step or its destination anchor (%s)', async removed => {
      await seed();
      const retained = steps.filter(step => step.id !== removed);
      await processCommand(owner, { ...base, kind: 'update', operationId: 'remove-step', generation,
        changes: [{ path: ['steps'], before: { exists: true, value: steps }, after: { exists: true, value: retained } }],
      });
      expect(await processCommand(owner, move('phone', 'bottom', 80))).toMatchObject({
        kind: 'conflict', serviceOrderPlacementComparison: { available: false }, snapshot: { value: { steps: retained } },
      });
    });

    it('acknowledges an earlier losing move after its old destination was removed', async () => {
      await seed();
      await processCommand(owner, move('desktop', 'top', 40));
      await processCommand(owner, { ...base, kind: 'update', operationId: 'remove-anchor', generation,
        changes: [{ path: ['steps'], before: { exists: true, value: [beta, alpha, gamma] }, after: { exists: true, value: [beta, alpha] } }],
      });
      expect(await processCommand(owner, move('phone', 'bottom', 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { steps: [beta, alpha] } },
      });
    });

    it('follows the exact prior move across a separate write without a clock', async () => {
      await seed();
      await processCommand(owner, move('first-move', 'top', null));
      const edited = { ...alpha, body: 'New opening words' };
      await processCommand(owner, { ...base, kind: 'update', operationId: 'edit-between', generation,
        changes: [{ path: ['steps'], before: { exists: true, value: [beta, alpha, gamma] }, after: { exists: true, value: [beta, edited, gamma] } }],
      });
      const successor = move('second-move', 'bottom', null);
      expect(await processCommand(owner, { ...successor,
        changes: [{ path: ['steps'], before: { exists: true, value: [{ id: 'beta' }, { id: 'alpha' }, { id: 'gamma' }] },
          after: { exists: true, value: [{ id: 'alpha' }, { id: 'gamma' }, { id: 'beta' }] } }],
        serviceOrderStepPlacement: { ...successor.serviceOrderStepPlacement,
          opening: { previous: null, next: 'alpha' }, predecessorOperationId: 'first-move' },
      })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { steps: [edited, gamma, beta] } } });
    });
  });

  describe('service order move chronology', () => {
    const owner = 'owner-1';
    const resource = (id: string) => ({ collection: 'serviceOrders', id });
    const anchor = (id: string) => ({ id, generation: 'seed-' + id });
    const time = (offset: number) => ({
      earliestMs: 1_800_000_000_000 + offset,
      latestMs: 1_800_000_000_005 + offset,
    });
    const words = [{ id: 'open', title: 'Opening', body: 'Words stay in the service' }];
    const now = '2026-11-09T00:00:00.000Z';

    async function seedOrder(id: string, rank: number, steps: typeof words = []) {
      const result = await processCommand(owner, { protocol: 1, owner, resource: resource(id), dependsOn: [],
        kind: 'create', operationId: 'seed-' + id, generation: null,
        value: { userId: owner, title: id, rank, steps, createdAt: now, updatedAt: now },
      });
      expect(result).toMatchObject({ kind: 'acknowledged' });
    }

    function move(id: string, where: 'top' | 'bottom', offset: number | null) {
      return {
        protocol: 1, owner, resource: resource('beta'), dependsOn: [], kind: 'update',
        operationId: id, generation: 'seed-beta',
        changes: [{ path: ['rank'], before: { exists: true, value: 2000 },
          after: { exists: true, value: where === 'top' ? 0 : 4000 } }],
        serviceOrderPlacement: {
          observedRevision: 1, time: offset === null ? null : time(offset),
          opening: { previous: anchor('alpha'), next: anchor('gamma') },
          destination: where === 'top' ? { previous: null, next: anchor('alpha') } : { previous: anchor('gamma'), next: null },
        },
      };
    }

    it('refuses malformed move evidence without writing a rank or accepting an unrelated edit', async () => {
      await seedOrder('beta', 2000, words);
      const good = move('invalid-move', 'top', 40);
      const placement = good.serviceOrderPlacement;
      const bad = [
        { ...good, serviceOrderPlacement: { ...placement, destination: { previous: null, next: anchor('beta') } } },
        { ...good, serviceOrderPlacement: { ...placement, destination: { previous: anchor('alpha'), next: anchor('alpha') } } },
        { ...good, serviceOrderPlacement: { ...placement, time: { earliestMs: 1, latestMs: 1_000_000 } } },
        { ...good, changes: [...good.changes, { path: ['title'], before: { exists: true, value: 'beta' },
          after: { exists: true, value: 'Not a move' } }] },
      ];
      for (const [index, invalid] of bad.entries()) {
        expect(await processCommand(owner, { ...invalid, operationId: 'invalid-move-' + index }))
          .toMatchObject({ kind: 'refused', code: 'invalid-argument' });
      }
      expect(await readDocument(owner, resource('beta'))).toMatchObject({ value: { rank: 2000, title: 'beta', steps: words } });
    });

    it('moves through a compressed gap atomically and preserves the action proof on a renumbered neighbor', async () => {
      await seedOrder('alpha', 1000);
      await seedOrder('beta', 2000, words);
      await seedOrder('delta', 3000);
      await seedOrder('gamma', 3000);
      expect(await processCommand(owner, move('desktop', 'top', 40))).toMatchObject({ kind: 'acknowledged' });

      const alphaMove = move('crowded', 'top', 50);
      const crowded = await processCommand(owner, {
        ...alphaMove, resource: resource('alpha'), generation: 'seed-alpha',
        changes: [{ path: ['rank'], before: { exists: true, value: 1000 }, after: { exists: true, value: 1000 } }],
        serviceOrderPlacement: { ...alphaMove.serviceOrderPlacement,
          opening: { previous: anchor('beta'), next: anchor('delta') },
          destination: { previous: anchor('delta'), next: anchor('gamma') },
        },
      });
      expect(crowded).toMatchObject({ kind: 'acknowledged', snapshot: { value: { rank: 3000 } },
        affected: expect.arrayContaining(['beta', 'delta', 'gamma'].map(id => expect.objectContaining({ resource: resource(id) }))) });

      expect(await processCommand(owner, move('earlier-phone', 'bottom', 20))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { rank: 1000, steps: words } },
      });
      expect(await processCommand(owner, move('later-phone', 'bottom', 80))).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { rank: 5000, steps: words } },
      });
      const history = await listServiceOrderPlacementHistory(owner, 'beta', 'seed-beta');
      await expect(listServiceOrderPlacementHistory('another-owner', 'beta', 'seed-beta')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderPlacementHistory(owner, 'beta', 'older')).rejects.toMatchObject({ status: 404 });
      expect(history.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ earlier: { previous: { ...anchor('gamma'), title: 'gamma' }, next: null } }),
        expect.objectContaining({ earlier: { previous: null, next: { ...anchor('alpha'), title: 'alpha' } } }),
      ]));
    });

    it('uses the current neighbors in comparison and accepts a proven local successor without a clock', async () => {
      await seedOrder('alpha', 1000);
      await seedOrder('beta', 2000, words);
      await seedOrder('gamma', 3000);
      expect(await processCommand(owner, move('first-beta', 'top', 40))).toMatchObject({ kind: 'acknowledged' });
      const alphaMove = move('alpha-before-beta', 'top', null);
      expect(await processCommand(owner, {
        ...alphaMove, resource: resource('alpha'), generation: 'seed-alpha',
        changes: [{ path: ['rank'], before: { exists: true, value: 1000 }, after: { exists: true, value: -1000 } }],
        serviceOrderPlacement: { ...alphaMove.serviceOrderPlacement, opening: { previous: anchor('beta'), next: anchor('gamma') },
          destination: { previous: null, next: anchor('beta') } },
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('uncalibrated-other-device', 'bottom', null))).toMatchObject({
        kind: 'conflict', serviceOrderPlacementComparison: { saved: {
          previous: { ...anchor('alpha'), title: 'alpha' }, next: { ...anchor('gamma'), title: 'gamma' },
        } },
      });
      const successor = move('successor-beta', 'bottom', null);
      expect(await processCommand(owner, { ...successor, serviceOrderPlacement: {
        ...successor.serviceOrderPlacement, predecessorOperationId: 'first-beta',
        opening: { previous: anchor('alpha'), next: anchor('gamma') },
      } })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { rank: 4000, steps: words } } });
    });

    it('repairs a crowded gap in a large service list without rewriting distant rows', async () => {
      await seedOrder('alpha', 1000);
      await seedOrder('beta', 4000, words);
      await seedOrder('gamma', 1000);
      for (let i = 0; i < 101; i += 1) {
        const id = 'distant-' + String(i).padStart(3, '0');
        documents.set('serviceOrders/' + id, { userId: owner, title: id, rank: 10000 + i * 100,
          steps: [], createdAt: now, updatedAt: now,
          _dataEngine: { protocol: 1, generation: 'seed-' + id, revision: 1, deleted: false } });
      }
      const crowded = move('large-list-move', 'top', 40);
      const result = await processCommand(owner, { ...crowded,
        changes: [{ path: ['rank'], before: { exists: true, value: 4000 }, after: { exists: true, value: 4000 } }],
        serviceOrderPlacement: { ...crowded.serviceOrderPlacement,
          opening: { previous: anchor('gamma'), next: null },
          destination: { previous: anchor('alpha'), next: anchor('gamma') },
        },
      });
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { rank: 1000, steps: words } } });
      const alpha = await readDocument(owner, resource('alpha'));
      const gamma = await readDocument(owner, resource('gamma'));
      expect(alpha.value?.rank).toBeLessThan(1000);
      expect(gamma.value?.rank).toBeGreaterThan(1000);
      expect(documents.get('serviceOrders/distant-000')).toMatchObject({ rank: 10000, _dataEngine: { revision: 1 } });
    });

    it('retains an action for review when a destination anchor disappeared', async () => {
      await seedOrder('alpha', 1000);
      await seedOrder('beta', 2000, words);
      const gamma = await processCommand(owner, { protocol: 1, owner, resource: resource('gamma'), dependsOn: [],
        kind: 'create', operationId: 'seed-gamma', generation: null,
        value: { userId: owner, title: 'gamma', rank: 3000, steps: [], createdAt: now, updatedAt: now },
      });
      if (gamma.kind !== 'acknowledged') throw new Error('Test anchor unavailable');
      expect(await processCommand(owner, { protocol: 1, owner, resource: resource('gamma'), dependsOn: [],
        kind: 'delete', operationId: 'remove-gamma', generation: 'seed-gamma', baseline: gamma.snapshot.value,
      })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(owner, move('phone', 'bottom', 80))).toMatchObject({
        kind: 'conflict', snapshot: { value: { rank: 2000, steps: words } },
      });
    });

    it.each([
      { phoneAt: 20, kind: 'acknowledged', rank: 0 },
      { phoneAt: 80, kind: 'acknowledged', rank: 4000 },
      { phoneAt: null, kind: 'conflict', rank: 0 },
    ] as const)('keeps the correct position for a phone move at $phoneAt', async ({ phoneAt, kind, rank }) => {
      await seedOrder('alpha', 1000);
      await seedOrder('beta', 2000, words);
      await seedOrder('gamma', 3000);
      expect(await processCommand(owner, move('desktop', 'top', 40))).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(owner, move('phone', 'bottom', phoneAt));
      expect(result).toMatchObject({ kind, snapshot: { value: { rank, steps: words } } });
      if (kind === 'conflict') expect(result).toMatchObject({ serviceOrderPlacementComparison: { available: true,
        mine: { previous: { ...anchor('gamma'), title: 'gamma' }, next: null },
        saved: { previous: null, next: { ...anchor('alpha'), title: 'alpha' } },
      } });
      await expect(readDocument(owner, resource('alpha'))).resolves.toMatchObject({ value: { rank: 1000, steps: [] } });
      await expect(readDocument(owner, resource('gamma'))).resolves.toMatchObject({ value: { rank: 3000, steps: [] } });
    });
  });

  it.each([
    { arrival: 'earlier', offset: 20, bodyOnly: false, winner: 'Computer title', kind: 'acknowledged', archived: 'Phone title' },
    { arrival: 'later', offset: 60, bodyOnly: false, winner: 'Phone title', kind: 'acknowledged', archived: 'Computer title' },
    { arrival: 'overlap', offset: 43, bodyOnly: false, winner: 'Computer title', kind: 'conflict', archived: null },
    { arrival: 'adjacent step', offset: 20, bodyOnly: true, winner: 'Phone title', kind: 'acknowledged', archived: null },
  ])('keeps the correct service order title when the queued action was $arrival', async ({ offset, bodyOnly, winner, kind, archived }) => {
    const order = { collection: 'serviceOrders', id: 'chronology-order' };
    const base = { protocol: 1, owner: 'owner-1', resource: order, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const original = { title: 'Starting title', rank: 100, steps: [{ id: 'open', title: 'Opening', body: 'Original words' }] };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'order-seed', generation: null,
      value: { userId: base.owner, ...original, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');

    const rename = (operationId: string, title: string, offsetMs: number) => ({
      ...base, kind: 'update', operationId, generation: 'order-seed',
      changes: [{ path: ['title'], before: { exists: true, value: original.title }, after: { exists: true, value: title } }],
      serviceOrderTitleAction: { before: original.title, after: title, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offsetMs, latestMs: 1_800_000_000_010 + offsetMs } },
    });
    const computer = bodyOnly ? { ...base, kind: 'update', operationId: 'computer', generation: 'order-seed',
      changes: [{ path: ['steps'], before: { exists: true, value: original.steps },
        after: { exists: true, value: [{ ...original.steps[0], body: 'Changed paragraph' }] } }],
    } : rename('computer', 'Computer title', 40);
    expect((await processCommand(base.owner, computer)).kind).toBe('acknowledged');
    const phone = rename('phone', 'Phone title', offset);
    expect(await processCommand(base.owner, phone)).toMatchObject({
      kind, snapshot: { value: { title: winner, steps: [{ body: bodyOnly ? 'Changed paragraph' : 'Original words' }] } },
    });
    const history = () => [...documents.entries()].filter(([path]) => path.startsWith('serviceOrders/chronology-order/_titleHistory/'));
    if (archived) {
      expect(history()).toHaveLength(1);
      expect(history()[0][1]).toMatchObject({ title: archived, winnerTitle: winner, generation: 'order-seed' });
      expect(await listServiceOrderTitleHistory(base.owner, order.id, 'order-seed')).toMatchObject({
        owner: base.owner, orderId: order.id, generation: 'order-seed',
        entries: [{ title: archived, winnerTitle: winner }],
      });
      await expect(listServiceOrderTitleHistory('another-owner', order.id, 'order-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listServiceOrderTitleHistory(base.owner, order.id, 'older-generation')).rejects.toMatchObject({ status: 404 });
      expect((await processCommand(base.owner, phone)).kind).toBe('acknowledged');
      expect(history()).toHaveLength(1);
    } else expect(history()).toHaveLength(0);
  });

  it.each(['timed', 'clock unavailable', 'legacy'] as const)('retains a delayed %s rename after the title was returned', async scenario => {
    const resource = { collection: 'serviceOrders', id: 'title-round-trip' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    const initialTitle = 'Original title';
    const changedTitle = 'Temporary title';
    const steps = [{ id: 'first', title: 'Opening', body: 'Words for the service' }];
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: initialTitle, rank: 100, steps, createdAt: now, updatedAt: now },
    })).kind).toBe('acknowledged');
    const rename = (operationId: string, before: string, after: string) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    expect((await processCommand(base.owner, rename('change', initialTitle, changedTitle))).kind).toBe('acknowledged');
    expect((await processCommand(base.owner, rename('return', changedTitle, initialTitle))).kind).toBe('acknowledged');
    const delayed = 'Delayed title';
    const command = { ...rename('delayed', initialTitle, delayed),
      ...(scenario !== 'legacy' && { serviceOrderTitleAction: {
        before: initialTitle, after: delayed, observedRevision: 1,
        time: scenario === 'timed' ? { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } : null,
      } }),
    };
    const result = await processCommand(base.owner, command);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: { value: { title: initialTitle, steps } },
      conflicts: [{ path: ['title'], base: { value: initialTitle }, mine: { value: delayed }, theirs: { value: initialTitle } }],
    });
    expect(await processCommand(base.owner, command)).toEqual(result);
    const observedRevision = result.kind === 'conflict' ? result.snapshot.metadata!.revision : 0;
    expect(await processCommand(base.owner, { ...rename('fresh-choice', initialTitle, delayed),
      serviceOrderTitleAction: { before: initialTitle, after: delayed, observedRevision, time: null },
    })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: delayed, steps } } });
    expect((await listServiceOrderTitleHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it.each([
    { order: 'an earlier', time: 20, expected: 'acknowledged' },
    { order: 'a later', time: 60, expected: 'conflict' },
    { order: 'an unclocked', time: null, expected: 'conflict' },
    { order: 'a legacy', time: undefined, expected: 'conflict' },
  ])('protects the title from a legacy rename after $order same-title edit', async ({ time, expected }) => {
    const resource = { collection: 'serviceOrders', id: 'title-reaffirmed' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const now = '2026-11-08T00:00:00.000Z';
    expect(await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, title: 'Original', rank: 100, steps: [], createdAt: now, updatedAt: now },
    })).toMatchObject({ kind: 'acknowledged' });
    const rename = (operationId: string, before: string, after: string) => ({
      ...base, kind: 'update', generation: 'seed', operationId,
      changes: [{ path: ['title'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    });
    const sameTitle = (operationId: string, offset: number | null | undefined) => ({
      ...rename(operationId, 'Original', 'My title'),
      ...(offset !== undefined && { serviceOrderTitleAction: { before: 'Original', after: 'My title', observedRevision: 1,
        time: offset === null ? null : { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } } }),
    });
    expect(await processCommand(base.owner, sameTitle('first', 40))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, sameTitle('also-my-title', time))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(base.owner, rename('legacy', 'My title', 'Queued title'))).toMatchObject({
      kind: expected, snapshot: { value: { title: expected === 'conflict' ? 'My title' : 'Queued title' } },
    });
  });

  describe.each([
    { collection: 'groups', field: 'title', action: 'groupTitleAction', before: 'Original', first: 'First', second: 'Second' },
    { collection: 'groups', field: 'status', action: 'groupStatusAction', before: 'draft', first: 'active', second: 'completed' },
    { collection: 'serviceOrders', field: 'title', action: 'serviceOrderTitleAction', before: 'Original', first: 'First', second: 'Second' },
    { collection: 'bibleMarks', field: 'verses', action: 'bibleMarkStroke',
      before: { v1_1: { m: '0-0-yellow' } }, first: { v1_1: { m: '0-0-blue' } }, second: { v1_1: { m: '0-0-red' } } },
  ])('overlapping clock estimates for $collection/$field', ({ collection, field, action, before, first, second }) => {
    it.each(['exact predecessor', 'different predecessor'] as const)('orders saves only with the %s', async scenario => {
      const owner = 'owner-1';
      const resource = { collection, id: collection === 'bibleMarks' ? owner + '_kjv_philemon' : 'successive-saves' };
      const base = { protocol: 1, owner, resource, dependsOn: [] };
      const now = '2026-11-08T00:00:00.000Z';
      const fields = collection === 'groups' ? { title: 'Original', description: '', status: 'draft', templates: [], flow: [], meetingDates: [] }
        : collection === 'serviceOrders' ? { title: 'Original', rank: 100, steps: [] } : { bible: 'kjv', book: 'philemon' };
      expect((await processCommand(owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
        value: { userId: owner, ...fields, [field]: before, createdAt: now, updatedAt: now },
      })).kind).toBe('acknowledged');
      const save = (operationId: string, opening: Json, value: Json, offset: number, predecessorOperationId?: string) => processCommand(owner, {
        ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: [field], before: { exists: true, value: opening }, after: { exists: true, value } }],
        [action]: { ...(field !== 'verses' && { before: opening, after: value }), observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset },
          ...(predecessorOperationId && { predecessorOperationId }) },
      });
      expect((await save('first', before, first, 40)).kind).toBe('acknowledged');
      const exact = scenario === 'exact predecessor';
      expect(await save('second', first, second, 45, exact ? 'first' : 'unrelated')).toMatchObject({
        kind: exact ? 'acknowledged' : 'conflict',
        snapshot: { value: { [field]: exact ? second : first } },
      });
      expect([...documents.keys()].filter(path => path.includes('History/'))).toHaveLength(0);
    });
  });

  it.each([
    { arrival: 'earlier', delayedOffset: 10, word: 2, winner: '0-0-yellow,2-2-blue' },
    { arrival: 'later', delayedOffset: 70, word: 2, winner: '0-0-yellow,2-2-red' },
    { arrival: 'overlap', delayedOffset: 43, word: 2, winner: '0-0-yellow,2-2-blue' },
    { arrival: 'different word', delayedOffset: 10, word: 3, winner: '0-0-yellow,2-2-blue,3-3-red' },
  ])('uses the action order for a delayed Bible mark: $arrival', async ({ arrival, delayedOffset, word, winner }) => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const start = { v1_1: { m: '0-0-yellow' } };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const stamp = '2026-11-08T00:00:00.000Z';
    const created = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'marks-seed', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: start, createdAt: stamp, updatedAt: stamp },
    });
    expect(created.kind).toBe('acknowledged');
    if (created.kind !== 'acknowledged') return;
    const save = (operationId: string, run: string, offset: number) => ({
      ...base, kind: 'update', operationId, generation: 'marks-seed',
      changes: [{ path: ['verses'], before: { exists: true, value: start }, after: { exists: true, value: { v1_1: { m: '0-0-yellow,' + run } } } }],
      bibleMarkStroke: { observedRevision: created.snapshot.metadata!.revision,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } },
    });
    expect((await processCommand(base.owner, save('blue-arrives-first', '2-2-blue', 40))).kind).toBe('acknowledged');
    const red = save('red-arrives-last', word + '-' + word + '-red', delayedOffset);
    const answer = await processCommand(base.owner, red);
    const history = () => [...documents.entries()].filter(([key]) => key.startsWith('bibleMarks/owner-1_kjv_philemon/_markHistory/'));
    expect(answer).toMatchObject({ kind: arrival === 'overlap' ? 'conflict' : 'acknowledged', snapshot: { value: { verses: { v1_1: { m: winner } } } } });
    const ordered = arrival === 'earlier' || arrival === 'later';
    expect(history()).toHaveLength(ordered ? 1 : 0);
    if (ordered) {
      const page = await listBibleMarkHistory(base.owner, book.id, 'marks-seed');
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0].marks).toEqual([expect.objectContaining({ verse: 'v1_1', layer: 'm', first: 2, last: 2,
        colour: arrival === 'later' ? 'blue' : 'red', winnerColour: arrival === 'later' ? 'red' : 'blue' })]);
      await expect(listBibleMarkHistory('another-owner', book.id, 'marks-seed')).rejects.toMatchObject({ status: 403 });
      await expect(listBibleMarkHistory(base.owner, book.id, 'wrong-generation')).rejects.toMatchObject({ status: 404 });
      expect((await processCommand(base.owner, red)).kind).toBe('acknowledged');
      expect(history()).toHaveLength(1);
    }
  });

  it.each([
    { scenario: 'two exact spans', proof: 'second', layer: 'm', kind: 'acknowledged' },
    { scenario: 'wrong operation on one span', proof: 'first', layer: 'm', kind: 'conflict' },
    { scenario: 'proof from the other tool', proof: 'second', layer: 'p', kind: 'conflict' },
  ])('orders a joined Bible mark with $scenario', async ({ proof, layer, kind }) => {
    const resource = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const stamp = '2026-11-08T00:00:00.000Z';
    const verses = (m: string) => ({ v1_1: { m, p: '2-4-gray' }, v1_2: { m: '0-0-yellow' } });
    const opening = verses('0-0-yellow');
    const first = verses('0-0-yellow,2-3-red');
    const both = verses('0-0-yellow,2-4-red');
    const recolored = verses('0-0-yellow,2-4-blue');
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: opening, createdAt: stamp, updatedAt: stamp },
    })).kind).toBe('acknowledged');
    const save = (operationId: string, before: typeof opening, after: typeof opening, offset: number,
      predecessors?: Array<{ verse: string; layer: string; first: number; last: number; operationId: string }>) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'seed',
        changes: [{ path: ['verses'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        bibleMarkStroke: { observedRevision: 1, time: {
          earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset,
        }, ...(predecessors && { predecessors }) },
      });
    expect((await save('first', opening, first, 40)).kind).toBe('acknowledged');
    expect((await save('second', first, both, 42)).kind).toBe('acknowledged');
    expect(await save('third', both, recolored, 44, [
      { verse: 'v1_1', layer: 'm', first: 2, last: 3, operationId: 'first' },
      { verse: 'v1_1', layer, first: 4, last: 4, operationId: proof },
    ])).toMatchObject({ kind, snapshot: { value: { verses: kind === 'acknowledged' ? recolored : both } } });
    expect((await listBibleMarkHistory(base.owner, resource.id, 'seed')).entries).toEqual([]);
  });

  it('ignores an overlapping Bible mark proof list instead of falling back to the unscoped ID', async () => {
    const resource = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource, dependsOn: [] };
    const stamp = '2026-11-08T00:00:00.000Z';
    const initial = { v1_1: { m: '0-0-yellow' } };
    const first = { v1_1: { m: '0-0-yellow,2-5-red' } };
    const last = { v1_1: { m: '0-0-yellow,2-5-blue' } };
    const time = { earliestMs: 1_800_000_000_040, latestMs: 1_800_000_000_050 };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'seed', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: initial, createdAt: stamp, updatedAt: stamp },
    })).kind).toBe('acknowledged');
    const update = (operationId: string, before: typeof initial, after: typeof initial) => ({
      ...base, kind: 'update', operationId, generation: 'seed',
      changes: [{ path: ['verses'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      bibleMarkStroke: { observedRevision: 1, time },
    });
    expect((await processCommand(base.owner, update('first', initial, first))).kind).toBe('acknowledged');
    const next = update('malformed', first, last);
    expect(await processCommand(base.owner, { ...next, bibleMarkStroke: { ...next.bibleMarkStroke, predecessorOperationId: 'first',
      predecessors: [{ verse: 'v1_1', layer: 'm', first: 2, last: 4, operationId: 'first' },
        { verse: 'v1_1', layer: 'm', first: 4, last: 5, operationId: 'different' }],
    } })).toMatchObject({ kind: 'conflict', snapshot: { value: { verses: first } } });
    const unrelated = { v1_1: { m: '0-0-yellow,1-1-green,2-5-red' } };
    const neighbor = update('neighbor', first, unrelated);
    expect((await processCommand(base.owner, { ...neighbor, bibleMarkStroke: { ...neighbor.bibleMarkStroke,
      predecessors: [{ verse: 'v1_1', layer: 'm', first: 3, last: 4, operationId: 'first' }],
    } })).kind).toBe('acknowledged');
    const stored = documents.get('bibleMarks/' + resource.id + '/_markProofs/v1_1');
    expect(stored?.proofs).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'm', first: 2, last: 5, colour: 'red', operationId: 'first' }),
    ]));
  });

  it.each(['earlier', 'later'] as const)('carries the %s first stroke through a logical empty ancestor', async order => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const time = (offset: number) => ({ observedRevision: 0, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } });
    const stamp = '2026-11-08T00:00:00.000Z';
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'first-stroke', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: { v1_1: { p: '2-2-blue' } }, createdAt: stamp, updatedAt: stamp },
      bibleMarkStroke: time(40),
    })).kind).toBe('acknowledged');
    const answer = await processCommand(base.owner, { ...base, kind: 'update', operationId: 'second-delivery', generation: 'first-stroke',
      changes: [{ path: ['verses'], before: { exists: true, value: { v1_1: {} } }, after: { exists: true, value: { v1_1: { p: '2-2-red' } } } }],
      bibleMarkStroke: time(order === 'earlier' ? 20 : 60),
    });
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { verses: { v1_1: { p: order === 'earlier' ? '2-2-blue' : '2-2-red' } } } } });
  });

  it('orders only the overlapping word of a delayed erasure and retains the pencil layer', async () => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const time = (offset: number) => ({ observedRevision: 1, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } });
    const stamp = '2026-11-08T00:00:00.000Z';
    const original = { v1_1: { m: '2-4-red', p: '2-4-gray' } };
    expect((await processCommand(base.owner, { ...base, kind: 'create', operationId: 'erase-book', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: original, createdAt: stamp, updatedAt: stamp },
    })).kind).toBe('acknowledged');
    const edit = (operationId: string, value: unknown, offset: number) => processCommand(base.owner, { ...base, kind: 'update',
      operationId, generation: 'erase-book', changes: [{ path: ['verses'], before: { exists: true, value: original }, after: { exists: true, value } }],
      bibleMarkStroke: time(offset),
    });
    expect((await edit('blue-word', { v1_1: { m: '2-2-red,3-3-blue,4-4-red', p: '2-4-gray' } }, 40)).kind).toBe('acknowledged');
    expect(await edit('older-erase', { v1_1: { p: '2-4-gray' } }, 20)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { verses: { v1_1: { m: '3-3-blue', p: '2-4-gray' } } } },
    });
    const page = await listBibleMarkHistory(base.owner, book.id, 'erase-book');
    expect(page.entries[0].marks).toEqual([expect.objectContaining({ first: 3, last: 3, colour: null, winnerColour: 'blue' })]);
  });

  it.each(['stamped', 'unstamped'] as const)('keeps a choice when unstamped edits returned a word to its old colour after a %s create', async initial => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const time = { earliestMs: 1_800_000_000_020, latestMs: 1_800_000_000_025 };
    const stamp = '2026-11-08T00:00:00.000Z';
    const original = { v1_1: { m: '2-2-blue' } };
    const created = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'legacy-aba', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: original, createdAt: stamp, updatedAt: stamp },
      ...(initial === 'stamped' && { bibleMarkStroke: { observedRevision: 0, time } }),
    });
    expect(created.kind).toBe('acknowledged');
    const edit = (operationId: string, before: unknown, after: unknown, bibleMarkStroke?: { observedRevision: number; time: typeof time }) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'legacy-aba',
        changes: [{ path: ['verses'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        ...(bibleMarkStroke && { bibleMarkStroke }),
      });
    const alternate = { v1_1: { m: '2-2-green' } };
    expect((await edit('legacy-alternate', original, alternate)).kind).toBe('acknowledged');
    const conflict = await edit('stale-during-alternate', original, { v1_1: { m: '2-2-red' } }, { observedRevision: 1, time });
    expect(conflict.kind).toBe('conflict');
    expect((await edit('legacy-return', alternate, original)).kind).toBe('acknowledged');
    const delayed = await edit('stale-after-return', original, { v1_1: { m: '2-2-red' } }, { observedRevision: 1, time });
    expect(delayed).toMatchObject({ kind: 'conflict', snapshot: { value: { verses: original } } });
    expect((await listBibleMarkHistory(base.owner, book.id, 'legacy-aba')).entries).toEqual([]);
  });

  it.each([
    { name: 'many strokes in other verses', bulk: false },
    { name: 'an oversized write resets proof coverage', bulk: true },
  ])('protects the newer mark after $name', async ({ bulk }) => {
    const book = { collection: 'bibleMarks', id: 'owner-1_kjv_philemon' };
    const base = { protocol: 1, owner: 'owner-1', resource: book, dependsOn: [] };
    const stamp = '2026-11-08T00:00:00.000Z';
    const original: Record<string, { m: string }> = { v1_1: { m: '2-2-blue' } };
    const created = await processCommand(base.owner, { ...base, kind: 'create', operationId: 'capacity-book', generation: null,
      value: { userId: base.owner, bible: 'kjv', book: 'philemon', verses: original, createdAt: stamp, updatedAt: stamp },
    });
    expect(created.kind).toBe('acknowledged');
    const edit = (operationId: string, before: unknown, after: unknown, observedRevision: number, offset: number) =>
      processCommand(base.owner, { ...base, kind: 'update', operationId, generation: 'capacity-book',
        changes: [{ path: ['verses'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        bibleMarkStroke: { observedRevision, time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_001 + offset } },
      });
    const alternate = { v1_1: { m: '2-2-green' } };
    expect((await edit('alternate', original, alternate, 1, 50)).kind).toBe('acknowledged');
    expect((await edit('return-blue', alternate, original, 2, 60)).kind).toBe('acknowledged');
    let verses = original;
    for (let batch = 0; batch < 3; batch++) {
      const added = Object.fromEntries(Array.from({ length: 44 }, (_, index) => ['v' + (batch + 2) + '_' + (index + 1), { m: '0-0-orange' }]));
      const next = { ...verses, ...added };
      expect((await edit('bulk-' + batch, verses, next, batch + 3, 70 + batch * 10)).kind).toBe('acknowledged');
      verses = next;
    }
    if (bulk) {
      const added = Object.fromEntries(Array.from({ length: 65 }, (_, index) => ['v10_' + (index + 1), { m: '0-0-yellow' }]));
      const next = { ...verses, ...added };
      expect((await edit('oversized', verses, next, 6, 105)).kind).toBe('acknowledged');
      verses = next;
    }
    const answer = await edit('old-red', original, { v1_1: { m: '2-2-red' } }, 1, 40);
    expect(answer).toMatchObject({ kind: bulk ? 'conflict' : 'acknowledged', snapshot: { value: { verses } } });
    const page = await listBibleMarkHistory(base.owner, book.id, 'capacity-book');
    if (bulk) expect(page.entries).toEqual([]);
    else expect(page.entries[0].marks).toEqual([expect.objectContaining({ verse: 'v1_1', colour: 'red', winnerColour: 'blue' })]);
  });

  it.each(['earlier', 'later', 'overlap', 'legacy'] as const)('handles a late-delivered %s date action and preserves the displaced date only when ordering is certain', async arrival => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church', city: 'City' }, audience: 'Original' };
    const seed = create('chronology-seed') as Extract<DataCommand, { kind: 'create' }>;
    const created = await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } });
    expect(created.kind).toBe('acknowledged');
    if (created.kind !== 'acknowledged') return;
    const save = (operationId: string, date: string, earliestMs: number) => ({
      protocol: 1, operationId, owner: 'owner-1', resource, generation: 'chronology-seed', dependsOn: [], kind: 'update',
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [{ ...row, date }] } }],
      preachDateAction: { rowId: 'date', before: row.date, after: date, observedRevision: created.snapshot.metadata!.revision,
        time: { earliestMs, latestMs: earliestMs + 10 } },
    });
    const baseMs = 1_800_000_000_000;
    const initialSave = save('first-arrival', '2026-12-20', baseMs - 50);
    const { preachDateAction: _action, ...legacySave } = initialSave;
    const first = await processCommand('owner-1', arrival === 'legacy' ? legacySave : initialSave);
    expect(first.kind).toBe('acknowledged');
    if (arrival === 'legacy') {
      expect((await processCommand('owner-1', save('already-satisfied', '2026-12-20', baseMs - 70))).kind).toBe('acknowledged');
    }
    const delayed = save('late-arrival', '2026-12-27', baseMs - { earlier: 90, later: 20, overlap: 45, legacy: 20 }[arrival]);
    const answer = await processCommand('owner-1', delayed);
    const history = () => [...documents.entries()].filter(([key]) => key.startsWith('sermons/sermon-1/_preachDateHistory/'));
    if (arrival === 'overlap' || arrival === 'legacy') {
      expect(answer.kind).toBe('conflict');
      expect(history()).toHaveLength(0);
      return;
    }
    const winner = arrival === 'earlier' ? '2026-12-20' : '2026-12-27';
    const loser = arrival === 'earlier' ? '2026-12-27' : '2026-12-20';
    expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { preachDates: [{ date: winner, audience: 'Original' }] } } });
    expect(history()).toHaveLength(1);
    expect(history()[0][1]).toMatchObject({ rowId: 'date', date: loser, winnerDate: winner, generation: 'chronology-seed' });
    expect(await listPreachDateHistory('owner-1', resource.id, 'chronology-seed')).toMatchObject({
      owner: 'owner-1', sermonId: resource.id, generation: 'chronology-seed', entries: [{ date: loser, winnerDate: winner }], nextCursor: null,
    });
    await expect(listPreachDateHistory('other-owner', resource.id, 'chronology-seed')).rejects.toMatchObject({ status: 403 });
    await expect(listPreachDateHistory('owner-1', resource.id, 'different-generation')).rejects.toMatchObject({ status: 404 });
    expect((await processCommand('owner-1', delayed)).kind).toBe('acknowledged');
    expect(history()).toHaveLength(1);
  });

  it.each([[20, '2026-12-13'], [80, '2026-12-13'], [80, '2026-12-13T00:00:00.000Z']] as const)(
    'orders clearing the planned day at offset %i from %s without losing the row or its notes', async (clearAt, originalDay) => {
    const row = { id: 'date', date: originalDay, status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church' }, notes: 'Keep my preparation' };
    const other = { ...row, id: 'another', date: '2027-01-01' };
    const seed = create('date-clear-seed') as Extract<DataCommand, { kind: 'create' }>;
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row, other] } })).kind).toBe('acknowledged');
    const edit = (operationId: string, date: string, offset: number) => processCommand('owner-1', {
      ...update(operationId, 'date-clear-seed'),
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row, other] },
        after: { exists: true, value: [{ ...row, date }, other] } }],
      preachDateAction: { rowId: row.id, before: row.date, after: date, observedRevision: 1,
        time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_010 + offset } },
    });
    expect((await edit('desktop', '2026-12-20', 50)).kind).toBe('acknowledged');
    const expected = clearAt > 50 ? '' : '2026-12-20';
    const earlier = clearAt > 50 ? '2026-12-20' : '';
    expect(await edit('phone', '', clearAt)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { preachDates: [{ ...row, date: expected }, other] } },
    });
    expect(await listPreachDateHistory('owner-1', resource.id, 'date-clear-seed')).toMatchObject({
      entries: [{ rowId: row.id, date: earlier, winnerDate: expected }],
    });
  });

  it('uses a proven local preaching date predecessor even when calibrated times appear reversed', async () => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church' }, notes: 'Keep my preparation' };
    const seed = create('queued-preach-date') as Extract<DataCommand, { kind: 'create' }>;
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } })).kind).toBe('acknowledged');
    const save = (operationId: string, before: string, after: string, offset: number, predecessorOperationId?: string) =>
      processCommand('owner-1', { ...update(operationId, seed.operationId),
        changes: [{ path: ['preachDates'], before: { exists: true, value: [{ ...row, date: before }] },
          after: { exists: true, value: [{ ...row, date: after }] } }],
        preachDateAction: { rowId: row.id, before, after, observedRevision: 1,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset },
          ...(predecessorOperationId && { predecessorOperationId }) },
      });
    expect((await save('first-date', row.date, '2026-12-20', 60)).kind).toBe('acknowledged');
    expect(await save('second-date', '2026-12-20', '', 40, 'first-date')).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { preachDates: [{ ...row, date: '' }] } },
    });
    expect((await listPreachDateHistory('owner-1', seed.resource.id, seed.operationId)).entries).toEqual([]);
  });

  it.each(['clear', 'mark'] as const)('reports the exact day conflict when a %s arrives after the other action', async late => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church' }, notes: 'Keep the note' };
    const seed = create('date-mark-race') as Extract<DataCommand, { kind: 'create' }>;
    expect((await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } })).kind).toBe('acknowledged');
    const cleared = { ...row, date: '' }, recorded = { ...row, status: 'preached' };
    const edit = (operationId: string, next: typeof row) => processCommand('owner-1', {
      ...update(operationId, 'date-mark-race'),
      changes: [{ path: ['preachDates'], before: { exists: true, value: [row] }, after: { exists: true, value: [next] } }],
    });
    const stored = late === 'clear' ? recorded : cleared;
    const mine = late === 'clear' ? cleared : recorded;
    expect((await edit('first', stored)).kind).toBe('acknowledged');
    expect(await edit('second', mine)).toMatchObject({ kind: 'conflict',
      snapshot: { value: { preachDates: [stored] } },
      conflicts: [{ path: ['preachDates', 'id:date', 'date'],
        base: { exists: true, value: row.date }, mine: { exists: true, value: mine.date }, theirs: { exists: true, value: stored.date } }],
    });
  });

  it('keeps a later explicit return to the original date over an older queued change from that original', async () => {
    const row = { id: 'date', date: '2026-12-13', status: 'planned', createdAt: '2026-11-01T00:00:00.000Z',
      church: { id: 'church', name: 'Church', city: 'City' } };
    const seed = create('chronology-aba') as Extract<DataCommand, { kind: 'create' }>;
    const created = await processCommand('owner-1', { ...seed, value: { ...seed.value, preachDates: [row] } });
    expect(created.kind).toBe('acknowledged');
    const save = (operationId: string, before: string, after: string, observedRevision: number, offset: number) =>
      processCommand('owner-1', { ...update(operationId, 'chronology-aba'),
        changes: [{ path: ['preachDates'], before: { exists: true, value: [{ ...row, date: before }] }, after: { exists: true, value: [{ ...row, date: after }] } }],
        preachDateAction: { rowId: row.id, before, after, observedRevision,
          time: { earliestMs: 1_800_000_000_000 + offset, latestMs: 1_800_000_000_005 + offset } },
      });
    expect((await save('change', row.date, '2026-12-20', 1, 20)).kind).toBe('acknowledged');
    expect((await save('return', '2026-12-20', row.date, 2, 40)).kind).toBe('acknowledged');
    expect(await save('late', row.date, '2026-12-27', 1, 10)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { preachDates: [{ date: row.date }] } },
    });
    expect(await listPreachDateHistory('owner-1', resource.id, 'chronology-aba')).toMatchObject({
      entries: [{ date: '2026-12-27', winnerDate: row.date }],
    });
  });

  it('pairs only a requested sermon list sample with the Firestore query read time', async () => {
    expect(await listDocuments('owner-1', 'sermons', { actionClockChallenge: 'fresh' })).toMatchObject({
      snapshots: [], actionClock: { challenge: 'fresh', serverMs: 1_800_000_000_123 },
    });
    expect(await listDocuments('owner-1', 'sermons')).not.toHaveProperty('actionClock');
    expect(await listDocuments('owner-1', 'studyNotes', { actionClockChallenge: 'fresh' })).toMatchObject({
      actionClock: { challenge: 'fresh', serverMs: 1_800_000_000_123 },
    });
  });

  it('writes a tombstone no legacy owner query can match, and still owns, replays and lists it', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    const remove: DataCommand = { ...create('delete-1'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! };
    expect(await processCommand('owner-1', remove)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });

    // Every legacy reader — the repository, /api/owner-list, the SDK query in an old bundle —
    // asks `where(userId == uid)`. A tombstone carrying userId answers that query and is drawn
    // as a blank, editable council: data on screen that is not in the database.
    const stored = documents.get('sermons/sermon-1')!;
    expect(stored).toEqual({ _dataEngineOwner: 'owner-1', _dataEngine: expect.objectContaining({ deleted: true }) });
    const legacy = await adminDb.collection('sermons').where('userId', '==', 'owner-1').get();
    expect(legacy.docs).toEqual([]);

    // The engine itself keeps full sight of it: ownership, replay and the listing.
    expect(await readDocument('owner-1', resource)).toMatchObject({ value: null, metadata: { deleted: true } });
    await expect(readDocument('attacker', resource)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await processCommand('owner-1', remove)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    expect(await processCommand('attacker', { ...update('steal', 'create-1'), owner: 'attacker' })).toMatchObject({ kind: 'refused', code: 'permission-denied' });
    expect((await listDocuments('owner-1', 'sermons')).snapshots).toEqual([expect.objectContaining({ resource, value: null })]);
    expect((await listDocuments('attacker', 'sermons')).snapshots).toEqual([]);
  });

  it('pages live documents and both generations of tombstones as one list in document order', async () => {
    documents.set('sermons/a', { userId: 'owner-1', title: 'A' });
    documents.set('sermons/b', { _dataEngineOwner: 'owner-1', _dataEngine: { protocol: 1, generation: 'b', revision: 2, deleted: true } });
    documents.set('sermons/c', { userId: 'owner-1', title: 'C' });
    // Written before 2026-09-18, when a tombstone still carried the legacy owner field.
    documents.set('sermons/d', { userId: 'owner-1', _dataEngine: { protocol: 1, generation: 'd', revision: 2, deleted: true } });
    documents.set('sermons/e', { _dataEngineOwner: 'attacker', _dataEngine: { protocol: 1, generation: 'e', revision: 2, deleted: true } });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listDocuments('owner-1', 'sermons', { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.snapshots.map(item => item.resource.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });

  describe('legacy writers beside the engine', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });
    it('tells a reader whether legacy writers may still change an optional collection unseen', async () => {
      // `prayerCategories` is registered but opt-in; users is engine-owned.
      documents.set('prayerCategories/category-1', { userId: 'owner-1', name: 'Mine' });
      // Served by the engine, legacy still open: a legacy write raises no feed event, so the
      // reader must be told the feed alone is not the whole truth.
      delete process.env.DATA_ENGINE_ENABLED;
      delete process.env.DATA_ENGINE_CLOSED_COLLECTIONS;
      process.env.DATA_ENGINE_COLLECTIONS = 'prayerCategories';
      expect(await listDocuments('owner-1', 'prayerCategories')).toMatchObject({ legacyOpen: true });
      expect(await readCollectionChanges('owner-1', 'prayerCategories', 0)).toMatchObject({ legacyOpen: true });
      // Closed — the LAST switch of a rollout: from here on the feed is the whole truth.
      process.env.DATA_ENGINE_CLOSED_COLLECTIONS = 'prayerCategories';
      expect(await listDocuments('owner-1', 'prayerCategories')).not.toHaveProperty('legacyOpen');
      expect(await readCollectionChanges('owner-1', 'prayerCategories', 0)).not.toHaveProperty('legacyOpen');
    });
  });

  it('uses document identity for private user profiles instead of caller-selected ownership fields', async () => {
    documents.set('users/owner-1', { displayName: 'Mine', premium: true });
    documents.set('users/victim', { displayName: 'Private' });
    const page = await listDocuments('owner-1', 'users');
    expect(page.snapshots).toEqual([expect.objectContaining({ resource: { collection: 'users', id: 'owner-1' }, value: { displayName: 'Mine', premium: true } })]);
    expect(await listDocuments('owner-1', 'users', { cursor: 'owner-1' })).toEqual({ snapshots: [], nextCursor: null, version: 0 });
    expect(await listDocuments('missing-owner', 'users')).toEqual({ snapshots: [], nextCursor: null, version: 0 });
    await expect(readDocument('owner-1', { collection: 'users', id: 'victim' })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('requires a real owner and bounded command bytes before starting a transaction', async () => {
    await expect(processCommand('', create())).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await processCommand('owner-1', { ...create(), value: { userId: 'owner-1', title: 'x'.repeat(MAX_COMMAND_BYTES) } })).toMatchObject({ kind: 'refused', code: 'resource-exhausted' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('injects the verified owner into creates when callers omit the redundant userId', async () => {
    expect(await processCommand('owner-1', { ...create(), value: { title: 'Missing owner', verse: 'John 1:1', date: '2026-01-01', thoughts: [] } })).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('sermons/sermon-1')?.userId).toBe('owner-1');
  });

  it.each([0, 101, 1.5, NaN])('rejects an unbounded list limit %s', async limit => {
    await expect(listDocuments('owner-1', 'sermons', { limit })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('limits a page byte size without skipping the first excluded document', async () => {
    for (let index = 0; index < 6; index++) documents.set(`sermons/${index}`, { userId: 'owner-1', title: 'x'.repeat(900_000) });
    const first = await listDocuments('owner-1', 'sermons');
    expect(first.snapshots).toHaveLength(4);
    const second = await listDocuments('owner-1', 'sermons', { cursor: first.nextCursor! });
    expect(second.snapshots.map((item: ResourceSnapshot) => item.resource.id)).toEqual(['4', '5']);
  });
});

describe('transactional collection feed', () => {
  const headPath = (collection = 'sermons') => `${HEADS_COLLECTION}/${collectionHeadId('owner-1', collection)}`;
  const changePath = (version: number) => `${headPath()}/changes/${sequenceId(version)}`;

  it('increments head and pointer with each committed effect while duplicate receipts preserve the counter', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', create());
    expect(documents.get(headPath())).toMatchObject({ version: 1, _dataEngine: { revision: 2, operationId: 'create-1' } });
    expect(documents.get(changePath(1))).toEqual({ resource, version: 1 });
    await processCommand('owner-1', update());
    await processCommand('owner-1', create());
    expect(documents.get(headPath())?.version).toBe(2);
    expect(await readDocument('owner-1', { collection: HEADS_COLLECTION, id: collectionHeadId('owner-1', 'sermons') })).toMatchObject({ value: { version: 2 }, metadata: { revision: 3 } });
    await expect(readDocument('attacker', { collection: HEADS_COLLECTION, id: collectionHeadId('owner-1', 'sermons') })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('anchors hydration at the same transactional version and pages current changed snapshots by sequence', async () => {
    await processCommand('owner-1', create());
    await processCommand('owner-1', update());
    const page = await listDocuments('owner-1', 'sermons');
    expect(page).toMatchObject({ version: 2, nextCursor: null, snapshots: [{ value: { title: 'Second' } }] });
    const first = await readCollectionChanges('owner-1', 'sermons', 0, { limit: 1 });
    expect(first).toMatchObject({ version: 2, cursor: 1, hasMore: true, snapshots: [{ value: { title: 'Second' } }] });
    expect(await readCollectionChanges('owner-1', 'sermons', first.cursor)).toMatchObject({ version: 2, cursor: 2, hasMore: false });
    expect(await readCollectionChanges('owner-1', 'sermons', 2)).toEqual({ version: 2, cursor: 2, hasMore: false, snapshots: [] });
  });

  it('advances every affected collection head in a relation and rolls back them all after commit failure', async () => {
    documents.set('studyNotes/n', { userId: 'owner-1', materialIds: [] });
    const command: DataCommand = { ...create('material'), resource: { collection: 'studyMaterials', id: 'm' }, kind: 'create', value: { title: 'Material', type: 'study', noteIds: ['n'], createdAt: 'now', updatedAt: 'now' } };
    failCommit = true;
    await expect(processCommand('owner-1', command)).rejects.toThrow('Commit failed');
    expect(documents.has(headPath('studyNotes'))).toBe(false);
    expect(documents.has(headPath('studyMaterials'))).toBe(false);
    failCommit = false;
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get(headPath('studyNotes'))?.version).toBe(1);
    expect(documents.get(headPath('studyMaterials'))?.version).toBe(1);
  });

  it('includes the tombstone event and never requires copying deleted private content into history', async () => {
    const created = await processCommand('owner-1', create());
    if (created.kind !== 'acknowledged') throw new Error('Missing create');
    await processCommand('owner-1', { ...create('delete'), kind: 'delete', generation: 'create-1', baseline: created.snapshot.value! });
    expect(await readCollectionChanges('owner-1', 'sermons', 1)).toMatchObject({ cursor: 2, snapshots: [{ value: null, metadata: { deleted: true } }] });
    expect(JSON.stringify(documents.get(changePath(2)))).not.toContain('First');
  });

  it('fails the whole command on a corrupt head and requests reset on missing pointer history', async () => {
    await processCommand('owner-1', create());
    const stored = documents.get(headPath())!;
    documents.set(headPath(), { ...stored, version: -1 });
    await expect(processCommand('owner-1', update())).rejects.toMatchObject({ code: 'invalid-change-feed' });
    expect(documents.get('sermons/sermon-1')?.title).toBe('First');
    expect(receipts()).toHaveLength(1);
    documents.set(headPath(), stored);
    await processCommand('owner-1', update());
    documents.delete(changePath(2));
    expect(await readCollectionChanges('owner-1', 'sermons', 0)).toMatchObject({ version: 2, cursor: 1, resetRequired: true });
    documents.delete(changePath(1));
    expect(await readCollectionChanges('owner-1', 'sermons', 0)).toMatchObject({ cursor: 0, resetRequired: true });
  });

  it('refuses foreign current values even if a corrupted pointer names them', async () => {
    await processCommand('owner-1', create());
    documents.set(changePath(1), { resource: { collection: 'sermons', id: 'victim' }, version: 1 });
    documents.set('sermons/victim', { userId: 'victim', title: 'Private' });
    await expect(readCollectionChanges('owner-1', 'sermons', 0)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it.each([[-1, 100], [1.5, 100], [Number.MAX_SAFE_INTEGER + 1, 100], [0, 0], [0, 101]])('rejects unbounded cursor/limit values %s/%s', async (after, limit) => {
    await expect(readCollectionChanges('owner-1', 'sermons', after, { limit })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects recursive head feeds and isolates an empty owner feed', async () => {
    await expect(readCollectionChanges('owner-1', HEADS_COLLECTION, 0)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(await readCollectionChanges('another-owner', 'sermons', 0)).toEqual({ version: 0, cursor: 0, snapshots: [], hasMore: false });
  });
});

describe('command request bounds', () => {
  const request = (body: string, announced?: string): Request => ({
    headers: new Headers(announced ? { 'content-length': announced } : {}),
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }),
  } as Request);

  it('reads JSON with no Content-Length', async () => {
    expect(await readCommandBody(request('{"protocol":1}'))).toEqual({ protocol: 1 });
  });
  it('assembles tiny and empty chunks without losing split UTF-8 characters', async () => {
    const payload = { text: '🙂'.repeat(1000) };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    let position = 0;
    let empty = true;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position === encoded.length) { controller.close(); return; }
        if (empty) controller.enqueue(new Uint8Array());
        else controller.enqueue(encoded.subarray(position, ++position));
        empty = !empty;
      },
    });
    expect(await readCommandBody({ headers: new Headers(), body } as Request)).toEqual(payload);
  });
  it('rejects oversized actual bytes even with a dishonest Content-Length', async () => {
    await expect(readCommandBody(request('x'.repeat(MAX_COMMAND_BYTES + 1), '1'))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects oversized announcements, missing bodies and malformed JSON', async () => {
    await expect(readCommandBody(request('{}', String(MAX_COMMAND_BYTES + 1)))).rejects.toMatchObject({ status: 413 });
    await expect(readCommandBody({ headers: new Headers(), body: null } as Request)).rejects.toMatchObject({ status: 400 });
    await expect(readCommandBody(request('{'))).rejects.toMatchObject({ status: 400 });
  });
  it('returns typed safe errors without publishing internal exceptions', async () => {
    const { Response: ActualResponse } = jest.requireActual('undici');
    const previous = global.Response;
    global.Response = ActualResponse;
    try {
      const error = serverErrorResponse(new DataEngineServerError('permission-denied', 403));
      expect(error.status).toBe(403);
      expect(await error.json()).toEqual({ code: 'permission-denied' });
      const unavailable = serverErrorResponse(new Error('Secret backend details'));
      expect(unavailable.status).toBe(503);
      expect(await unavailable.text()).not.toContain('Secret');
      expect(serverErrorResponse(Object.assign(new Error('Invalid'), { code: 'invalid-argument' })).status).toBe(400);
    } finally { global.Response = previous; }
  });
});


describe('complete write-set activation boundary', () => {
  const deleting = (collection: string, id: string, value: Raw, operationId = 'delete-cohort'): DataCommand => ({
    protocol: 1, owner: 'owner-1', operationId, resource: { collection, id }, generation: null, dependsOn: [], kind: 'delete', baseline: value as never,
  });
  it.each([
    { primary: 'groups', id: 'g', value: { userId: 'owner-1', title: 'Group', templates: [], flow: [] }, related: 'series/s',
      linked: { userId: 'owner-1', items: [{ id: 'group-g', type: 'group', refId: 'g', position: 1 }], sermonIds: [] } },
    { primary: 'series', id: 's', value: { userId: 'owner-1', title: 'Series', items: [], sermonIds: [] }, related: 'sermons/n',
      linked: { userId: 'owner-1', title: 'Legacy sermon', thoughts: [], seriesId: 's', seriesPosition: 1 } },
  ])('refuses $primary cascade into an unserved collection without touching either document', async ({ primary, id, value, related, linked }) => {
    documents.set(`${primary}/${id}`, value); documents.set(related, linked);
    jest.mocked(isCollectionServed).mockImplementation(collection => collection === primary);
    const command = deleting(primary, id, value);
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'refused', code: 'related-collection-not-enabled' });
    expect(documents.get(`${primary}/${id}`)).toEqual(value); expect(documents.get(related)).toEqual(linked);
    expect(transactionWrites.every(path => path.startsWith('_dataEngineReceipts/'))).toBe(true);
    jest.mocked(isCollectionServed).mockReturnValue(true);
    // A refusal is immutable. Enabling another collection cannot silently replay old refused intent.
    expect(await processCommand('owner-1', command)).toMatchObject({ kind: 'refused' });
    expect(await processCommand('owner-1', { ...command, operationId: 'explicit-retry' })).toMatchObject({ kind: 'acknowledged' });
    jest.mocked(isCollectionServed).mockImplementation(collection => collection === primary);
    transactionWrites.length = 0;
    // Already accepted work keeps its ACK proof despite a later rollout switch.
    expect(await processCommand('owner-1', { ...command, operationId: 'explicit-retry' })).toMatchObject({ kind: 'acknowledged' });
    expect(transactionWrites).toEqual([]);
  });
  it('allows read-only references to unserved domains while guarding all actual writes', async () => {
    documents.set('series/s', { userId: 'owner-1', items: [], sermonIds: [] });
    documents.set('groups/g', { userId: 'owner-1', title: 'Referenced group', templates: [], flow: [] });
    jest.mocked(isCollectionServed).mockImplementation(collection => collection === 'series');
    expect(await processCommand('owner-1', { protocol: 1, owner: 'owner-1', operationId: 'read-only-target',
      resource: { collection: 'series', id: 's' }, generation: null, dependsOn: [], kind: 'relation', relation: 'series-membership', edits: [
        { resource: { collection: 'series', id: 's' }, generation: null, beforeItems: [], afterItems: [{ id: 'group-g', type: 'group', refId: 'g', position: 1 }] },
      ] })).toMatchObject({ kind: 'acknowledged' });
    expect(documents.get('groups/g')).not.toHaveProperty('_dataEngine');
  });
});

describe('share capability receipt replay', () => {
  const owner = 'owner-1';
  const notePath = 'studyNotes/share-note';
  const createLink = (id: string): DataCommand => {
    const observed = documents.get(notePath)?._dataEngine as ResourceSnapshot['metadata'] | undefined;
    return { protocol: 1, owner, operationId: `share-create-${id}`,
    resource: { collection: 'studyNoteShareLinks', id }, generation: null, dependsOn: [], kind: 'relation',
      relation: 'share-link-create', note: { id: 'share-note', generation: observed?.generation ?? null,
        shareRevocation: observed?.shareRevocation ?? null }, authorLanguage: 'en',
    };
  };
  const revokeLink = (id: string, generation: string, operationId = `share-revoke-${id}`): DataCommand => ({ protocol: 1, owner, operationId,
    resource: { collection: 'studyNoteShareLinks', id }, generation, dependsOn: [], kind: 'relation', relation: 'share-link-revoke',
  } as unknown as DataCommand);
  const active = () => [...documents.entries()].filter(([path, value]) => path.startsWith('studyNoteShareLinks/') && value.ownerId === owner && !(value._dataEngine as { deleted?: boolean } | undefined)?.deleted);
  beforeEach(() => { documents.set(notePath, { userId: owner, content: 'Keep the authored note' }); });

  it('accepts the production client share command without a marker when the note was never revoked', async () => {
    const legacy: DataCommand = { protocol: 1, owner, operationId: 'old-client-create',
      resource: { collection: 'studyNoteShareLinks', id: 'old-client' }, generation: null, dependsOn: [],
      kind: 'relation', relation: 'share-link-create', note: { id: 'share-note', generation: null }, authorLanguage: 'en',
    };
    const result = await processCommand(owner, legacy);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { ownerId: owner, noteId: 'share-note', token: expect.any(String) } } });
    expect(await processCommand(owner, legacy)).toEqual(result);
    expect(active()).toHaveLength(1);
  });

  it('keeps a production client without a marker from reopening access to a revoked note', async () => {
    const first = createLink('first');
    expect((await processCommand(owner, first)).kind).toBe('acknowledged');
    const revocation = revokeLink('first', first.operationId);
    expect((await processCommand(owner, revocation)).kind).toBe('acknowledged');
    expect(await processCommand(owner, { protocol: 1, owner, operationId: 'old-client-after-revoke',
      resource: { collection: 'studyNoteShareLinks', id: 'old-client' }, generation: null, dependsOn: [],
      kind: 'relation', relation: 'share-link-create', note: { id: 'share-note', generation: revocation.operationId }, authorLanguage: 'en',
    })).toMatchObject({ kind: 'refused', code: 'share-link-review-required' });
    expect(active()).toEqual([]);
  });

  it('replays the original creation after revocation without issuing any new capability', async () => {
    const first = createLink('first');
    const before = structuredClone(documents.get(notePath));
    const created = await processCommand(owner, first);
    expect(created.kind).toBe('acknowledged');
    expect(active()).toHaveLength(1);
    expect(await processCommand(owner, revokeLink('first', first.operationId))).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    const replayed = await processCommand(owner, first);
    expect(replayed).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } }, committed: { operationId: first.operationId, deleted: false } });
    expect(active()).toEqual([]);
    expect(documents.get(notePath)).toMatchObject({ ...before, _dataEngine: { shareRevocation: 'share-revoke-first' } });
    expect(documents.get(notePath)).not.toHaveProperty('updatedAt');
    expect(receipts()).toHaveLength(2);
  });

  it('keeps an alias receipt revoked while allowing a new explicit create', async () => {
    const first = createLink('first');
    await processCommand(owner, first);
    const oldToken = active()[0][1].token;
    const alias = createLink('second');
    expect(await processCommand(owner, alias)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null },
      affected: [{ resource: first.resource, metadata: { operationId: alias.operationId } }] });
    expect(active()).toHaveLength(1);
    await processCommand(owner, revokeLink('first', first.operationId));
    expect(await processCommand(owner, alias)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null },
      relatedSnapshots: [{ resource: first.resource, value: null, metadata: { deleted: true } }] });
    expect(active()).toEqual([]);
    expect((await processCommand(owner, createLink('third'))).kind).toBe('acknowledged');
    expect(active()).toHaveLength(1);
    expect(active()[0][1].token).not.toBe(oldToken);
    await processCommand(owner, revokeLink('first', first.operationId, 'later-old-link-revoke'));
    expect(active()[0][0]).toBe('studyNoteShareLinks/third');
  });

  it('serializes two different create actions to one active capability and keeps both receipts', async () => {
    const results = await Promise.all([processCommand(owner, createLink('one')), processCommand(owner, createLink('two'))]);
    expect(results.map(result => result.kind)).toEqual(['acknowledged', 'acknowledged']);
    expect(active()).toHaveLength(1);
    expect(receipts()).toHaveLength(2);
  });

  it('rejects the older first delivery and keeps its refusal after the note is edited', async () => {
    const held = createLink('held');
    const current = createLink('current');
    expect((await processCommand(owner, current)).kind).toBe('acknowledged');
    expect((await processCommand(owner, revokeLink('current', current.operationId))).kind).toBe('acknowledged');
    const refusal = await processCommand(owner, held);
    expect(refusal).toMatchObject({ kind: 'refused', code: 'share-link-review-required' });
    expect(active()).toEqual([]);
    const stored = documents.get(notePath)!;
    const metadata = stored._dataEngine as NonNullable<ResourceSnapshot['metadata']>;
    expect(await processCommand(owner, { protocol: 1, owner, operationId: 'edit-shared-note',
      resource: { collection: 'studyNotes', id: 'share-note' }, generation: metadata.generation, dependsOn: [], kind: 'update',
      changes: [{ path: ['content'], before: { exists: true, value: stored.content }, after: { exists: true, value: 'Edited after revoke' } }],
    })).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { shareRevocation: 'share-revoke-current' } } });
    expect(await processCommand(owner, held)).toEqual(refusal);
    expect((await processCommand(owner, createLink('explicit'))).kind).toBe('acknowledged');
    expect(active()).toHaveLength(1);
  });

  it('retains both revocation effects in the canonical receipt', async () => {
    const create = createLink('first');
    await processCommand(owner, create);
    const revoke = revokeLink('first', create.operationId);
    const result = await processCommand(owner, revoke);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    expect(documents.get(notePath)?._dataEngine).toMatchObject({ shareRevocation: revoke.operationId });
    expect(active()).toEqual([]);
    for (const ack of [result, await processCommand(owner, revoke)]) expect(ack).toMatchObject({
      relatedSnapshots: [{ resource: { collection: 'studyNotes', id: 'share-note' }, metadata: { shareRevocation: revoke.operationId } }],
    });
  });

  it('keeps the same operation identity immutable across create and revoke', async () => {
    const create = createLink('first');
    await processCommand(owner, create);
    await expect(processCommand(owner, { ...revokeLink('first', create.operationId), operationId: create.operationId }))
      .resolves.toMatchObject({ kind: 'refused', code: 'operation-id-reused' });
    expect(active()).toHaveLength(1);
  });
});

describe('public share-link view counter projection', () => {
  it('advances the owned snapshot revision and change feed when a public view increments the counter', async () => {
    const owner = 'owner-1';
    const id = 'view-counter-link';
    const collection = 'studyNoteShareLinks';
    const resource = { collection, id };
    const headPath = `${HEADS_COLLECTION}/${collectionHeadId(owner, collection)}`;
    documents.set(`${collection}/${id}`, {
      ownerId: owner, noteId: 'note-1', token: 'public-view-token', createdAt: '2026-10-01T00:00:00.000Z', viewCount: 0,
      _dataEngine: { protocol: 1, generation: 'create-view-counter-link', revision: 1, deleted: false, operationId: 'create-view-counter-link' },
    });
    documents.set(headPath, {
      userId: owner, collection, version: 1,
      _dataEngine: { protocol: 1, generation: collectionHeadId(owner, collection), revision: 2, deleted: false, operationId: 'create-view-counter-link' },
    });
    documents.set(`${headPath}/changes/${sequenceId(1)}`, { resource, version: 1 });

    const before = await readDocument(owner, resource);
    const beforeFeed = await readCollectionChanges(owner, collection, 0);
    expect(before).toMatchObject({ value: { viewCount: 0 }, metadata: { revision: 1 } });
    expect(beforeFeed).toMatchObject({ version: 1, cursor: 1, snapshots: [{ value: { viewCount: 0 }, metadata: { revision: 1 } }] });

    await recordSharedNoteView(id, 'public-view-token');

    expect(await readDocument(owner, resource)).toMatchObject({ value: { viewCount: 1 }, metadata: { revision: 2 } });
    expect(await readCollectionChanges(owner, collection, beforeFeed.cursor)).toMatchObject({
      version: 2, cursor: 2, snapshots: [{ resource, value: { viewCount: 1 }, metadata: { revision: 2 } }],
    });
  });
  it.each(['missing', 'deleted', 'revoked', 'wrong-token'] as const)('does not count or publish a %s capability', async variant => {
    const raw = { ownerId: 'owner-1', noteId: 'note', token: 'token', createdAt: 'created', viewCount: 3,
      ...(variant === 'revoked' ? { revoked: true } : {}),
      _dataEngine: { protocol: 1, generation: 'creation', revision: 1, deleted: variant === 'deleted' } };
    if (variant !== 'missing') documents.set('studyNoteShareLinks/control', raw);
    const before = structuredClone([...documents.entries()]);
    await recordSharedNoteView('control', variant === 'wrong-token' ? 'another-token' : 'token');
    expect([...documents.entries()]).toEqual(before);
  });

  it('commits count and feed together, preserving the permanent token, note and generation', async () => {
    const owner = 'owner-1', collection = 'studyNoteShareLinks';
    documents.set(`${collection}/counter`, { ownerId: owner, noteId: 'note', token: 'token', createdAt: 'created', viewCount: 0,
      _dataEngine: { protocol: 1, generation: 'creation', revision: 1, deleted: false } });
    await Promise.all([recordSharedNoteView('counter', 'token'), recordSharedNoteView('counter', 'token')]);
    expect(await readDocument(owner, { collection, id: 'counter' })).toMatchObject({
      value: { viewCount: 2, token: 'token', noteId: 'note', createdAt: 'created' }, metadata: { generation: 'creation', revision: 3 } });
    expect(await readCollectionChanges(owner, collection, 0)).toMatchObject({ version: 2, snapshots: [{ value: { viewCount: 2 } }] });
    expect(receipts()).toHaveLength(0);
    const before = structuredClone([...documents.entries()]); failCommit = true;
    await expect(recordSharedNoteView('counter', 'token')).rejects.toThrow('Commit failed');
    expect([...documents.entries()]).toEqual(before);
  });

  it('keeps an exact legacy revocation valid after counting adds the first protocol marker', async () => {
    const owner = 'owner-1', resource = { collection: 'studyNoteShareLinks', id: 'legacy-counter' };
    documents.set('studyNoteShareLinks/legacy-counter', { ownerId: owner, noteId: 'note', token: 'token', createdAt: 'created', viewCount: 0 });
    await recordSharedNoteView(resource.id, 'token');
    expect(await processCommand(owner, { protocol: 1, owner, operationId: 'revoke-legacy-counter', resource, generation: null,
      dependsOn: [], kind: 'relation', relation: 'share-link-revoke' })).toMatchObject({ kind: 'acknowledged', snapshot: { value: null } });
    const before = structuredClone([...documents.entries()]);
    await recordSharedNoteView(resource.id, 'token');
    expect([...documents.entries()]).toEqual(before);
  });

});

it.each([
  { label: 'earlier offline lock', initiallyLocked: false, both: false, offlineAt: 15, expected: false },
  { label: 'earlier offline unlock', initiallyLocked: true, both: false, offlineAt: 15, expected: true },
  { label: 'earlier offline lock for two thoughts', initiallyLocked: false, both: true, offlineAt: 15, expected: false },
  { label: 'later offline lock', initiallyLocked: false, both: false, offlineAt: 110, expected: true },
])('keeps the latest deliberate thought lock action: $label', async ({ initiallyLocked, both, offlineAt, expected }) => {
  const generation = 'thought-lock-seed';
  const date = '2026-11-08T00:00:00.000Z';
  const selected = both ? ['one', 'two'] : ['one'];
  const initial = ['one', 'two', 'other'].map(id => ({
    id, date, tags: [], text: 'Original ' + id, isLocked: id === 'other' ? false : initiallyLocked,
  }));
  const create = {
    protocol: 1, kind: 'create', operationId: generation, owner: 'owner-1', resource, generation: null, dependsOn: [],
    value: { userId: 'owner-1', title: 'Sermon', verse: 'John 1:1', date, thoughts: initial },
  };
  expect((await processCommand(create.owner, create)).kind).toBe('acknowledged');
  const withLock = (rows: typeof initial, isLocked: boolean) =>
    rows.map(row => selected.includes(row.id) ? { ...row, isLocked } : row);
  const change = (operationId: string, before: typeof initial, after: typeof initial, at: number, observedRevision: number) => ({
    ...create, kind: 'update', operationId, generation,
    changes: [{ path: ['thoughts'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
    thoughtLockActions: before.flatMap((row, index) => selected.includes(row.id) ? [{
      rowId: row.id, rowCreatedAt: row.date, before: row.isLocked, after: after[index].isLocked, observedRevision,
      time: { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at },
    }] : []),
  });
  const desktop = withLock(initial, !initiallyLocked).map(row =>
    row.id === 'one' ? { ...row, text: 'Independent desktop edit' } : row);
  expect((await processCommand(create.owner, change('desktop-first', initial, desktop, 55, 1))).kind).toBe('acknowledged');
  const desktopLast = withLock(desktop, initiallyLocked);
  expect((await processCommand(create.owner, change('desktop-last', desktop, desktopLast, 85, 2))).kind).toBe('acknowledged');
  const delayed = change('offline-delayed', initial, withLock(initial, !initiallyLocked), offlineAt, 1);
  const answer = await processCommand(create.owner, delayed);
  expect(answer).toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: withLock(desktopLast, expected) } } });
  expect(await processCommand(create.owner, delayed)).toEqual(answer);
  expect(await readDocument(create.owner, resource)).toMatchObject({ value: { thoughts: withLock(desktopLast, expected) } });
  const history = await listThoughtLockHistory(create.owner, resource.id, generation);
  expect(history.entries).toHaveLength(1);
  expect(history.entries[0].fields).toEqual(selected.map(rowId => expect.objectContaining({
    field: 'isLocked', rowId, rowCreatedAt: date, value: !expected, winnerValue: expected,
  })));
  await expect(listThoughtLockHistory('another-owner', resource.id, generation)).rejects.toMatchObject({ status: 403 });
  await expect(listThoughtLockHistory(create.owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
});

it.each([
  { label: 'earlier offline move', offlineAt: 15, desktop: 'right', phone: 'left', winner: 'right', kind: 'acknowledged' },
  { label: 'later offline move', offlineAt: 110, desktop: 'left', phone: 'right', winner: 'right', kind: 'acknowledged' },
  { label: 'later return to the opening assignment', offlineAt: 15, desktop: 'right', phone: 'left', winner: 'opening', kind: 'acknowledged', returnToOpening: true },
  { label: 'two subpoints of the same destination', offlineAt: 110, desktop: 'left', phone: 'leftOther', winner: 'leftOther', kind: 'acknowledged' },
  { label: 'unknown order cannot form an invalid combination', offlineAt: null, desktop: 'sameParent', phone: 'otherParent', winner: 'sameParent', kind: 'conflict', parentOnly: true },
  { label: 'legacy move without a timing proof', offlineAt: 110, desktop: 'sameParent', phone: 'otherParent', winner: 'sameParent', kind: 'conflict', parentOnly: true, legacy: true },
  { label: 'unknown cross-section move has one comparison', offlineAt: null, desktop: 'left', phone: 'right', winner: 'left', kind: 'conflict', cross: true },
  { label: 'legacy board keeps a second move in the same Save', offlineAt: 110, desktop: 'left', phone: 'right', winner: 'right', kind: 'acknowledged', cross: true, legacyBoard: true },
  { label: 'unknown action order', offlineAt: null, desktop: 'left', phone: 'right', winner: 'left', kind: 'conflict' },
] as const)('orders the exact thought point and subpoint together: $label', async scenario => {
  const generation = 'thought-location-seed';
  const date = '2026-11-08T00:00:00.000Z';
  const locations: Record<'opening' | 'left' | 'leftOther' | 'right' | 'sameParent' | 'otherParent', { outlinePointId: string; subPointId: string | null }> = {
    opening: { outlinePointId: 'start', subPointId: 'sub-start' },
    left: { outlinePointId: 'left', subPointId: 'sub-left' },
    leftOther: { outlinePointId: 'left', subPointId: 'sub-left-other' },
    right: { outlinePointId: 'right', subPointId: 'sub-right' },
    sameParent: { outlinePointId: 'start', subPointId: 'sub-start' },
    otherParent: { outlinePointId: 'right', subPointId: null },
  };
  const thought = { id: 'one', date, tags: ['main'], text: 'Original thought', ...('parentOnly' in scenario ? { outlinePointId: 'start', subPointId: null } : locations.opening) };
  const neighbor = { id: 'two', date, tags: ['main'], text: 'Independent thought', ...locations.opening };
  const start = { id: 'start', text: 'Start', subPoints: [{ id: 'sub-start', text: 'Start child', position: 0 }] };
  const left = { id: 'left', text: 'Left', subPoints: [{ id: 'sub-left', text: 'Left child', position: 0 }, { id: 'sub-left-other', text: 'Other child', position: 1 }] };
  const right = { id: 'right', text: 'Right', subPoints: [{ id: 'sub-right', text: 'Right child', position: 0 }] };
  const cross = 'cross' in scenario;
  const outline = cross ? { introduction: [left], main: [start], conclusion: [right] }
    : { introduction: [], main: [start, left, right], conclusion: [] };
  const board = (...rows: typeof thought[]) => ({
    introduction: rows.filter(row => cross && row.outlinePointId === 'left').map(row => row.id),
    main: rows.filter(row => !cross || row.outlinePointId === 'start').map(row => row.id),
    conclusion: rows.filter(row => cross && row.outlinePointId === 'right').map(row => row.id), ambiguous: [],
  });
  const structure = board(thought, neighbor);
  const legacyBoard = 'legacyBoard' in scenario;
  const create = {
    protocol: 1, kind: 'create', operationId: generation, owner: 'owner-1', resource, generation: null, dependsOn: [],
    value: { userId: 'owner-1', title: 'Sermon', verse: 'John 1:1', date, thoughts: [thought, neighbor], outline, ...(!legacyBoard && { structure, thoughtsBySection: structure }) },
  };
  expect(await processCommand(create.owner, create)).toMatchObject({ kind: 'acknowledged' });
  const pick = (row: typeof thought) => ({ outlinePointId: row.outlinePointId, subPointId: row.subPointId });
  const change = (operationId: string, before: typeof thought, after: typeof thought, at: number | null,
    observedRevision: number, changedNeighbor = neighbor) => ({
    ...create, kind: 'update', operationId, generation,
    changes: [{ path: ['thoughts'], before: { exists: true, value: [before, neighbor] },
      after: { exists: true, value: [after, changedNeighbor] } },
    ...cross ? ['structure', 'thoughtsBySection'].map(key => ({
      path: [key], before: legacyBoard && observedRevision === 1 ? { exists: false } : { exists: true, value: board(before, neighbor) },
      after: { exists: true, value: board(after, changedNeighbor) },
    })) : []],
    thoughtPlacementActions: [{ rowId: thought.id, rowCreatedAt: date, before: pick(before), after: pick(after), observedRevision,
      time: at === null ? null : { earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at } }],
  });
  let desktop = { ...thought, ...locations[scenario.desktop], text: 'Independent text edited on desktop' };
  const desktopCommand = change('desktop-first', thought, desktop, 55, 1);
  expect((await processCommand(create.owner, 'legacy' in scenario ? { ...desktopCommand, thoughtPlacementActions: [] } : desktopCommand)).kind).toBe('acknowledged');
  if ('returnToOpening' in scenario) {
    const restored = { ...desktop, ...locations.opening };
    expect((await processCommand(create.owner, change('desktop-last', desktop, restored, 85, 2))).kind).toBe('acknowledged');
    desktop = restored;
  }
  const finalNeighbor = legacyBoard ? { ...neighbor, ...locations.left } : neighbor;
  const delayed = change('offline-delayed', thought, { ...thought, ...locations[scenario.phone] }, scenario.offlineAt, 1, finalNeighbor);
  const answer = await processCommand(create.owner, delayed);
  const wanted = { ...desktop, ...locations[scenario.winner] };
  expect(answer).toMatchObject({ kind: scenario.kind, snapshot: { value: { thoughts: [wanted, finalNeighbor] } } });
  if (scenario.kind === 'conflict') expect(answer).toMatchObject({ conflicts: [{
    path: ['thoughts', 'id:one', 'outlineLocation'], base: { exists: true, value: pick(thought) },
    mine: { exists: true, value: locations[scenario.phone] }, theirs: { exists: true, value: locations[scenario.winner] },
  }] });
  expect(await processCommand(create.owner, delayed)).toEqual(answer);
  const finalBoard = board(wanted, finalNeighbor);
  expect(await readDocument(create.owner, resource)).toMatchObject({ value: {
    thoughts: [wanted, finalNeighbor], outline, structure: finalBoard, thoughtsBySection: finalBoard,
  } });
  const history = await listThoughtPlacementHistory(create.owner, resource.id, generation);
  if (scenario.kind === 'conflict') expect(history.entries).toEqual([]);
  else expect(history.entries).toMatchObject([{ fields: [{
    field: 'outlineLocation', rowId: thought.id, rowCreatedAt: date, winnerValue: locations[scenario.winner],
  }] }]);
  await expect(listThoughtPlacementHistory('another-owner', resource.id, generation)).rejects.toMatchObject({ status: 403 });
  await expect(listThoughtPlacementHistory(create.owner, resource.id, 'other-generation')).rejects.toMatchObject({ status: 404 });
});


describe('deleting an outline node while a thought is linked to it', () => {
  function fixture(wholePoint: boolean) {
    const generation = 'outline-removal-seed';
    const date = '2026-11-08T00:00:00.000Z';
    const owner = 'owner-1';
    const original = { outlinePointId: 'opening', subPointId: 'old-sub' };
    const repaired = { outlinePointId: wholePoint ? null : 'opening', subPointId: null };
    const destination = { outlinePointId: 'destination', subPointId: 'next-sub' };
    const first = { id: 'one', date, text: 'Original words', tags: ['main'], ...original };
    const neighbor = { id: 'two', date, text: 'Independent words', tags: ['main'], outlinePointId: 'opening' };
    const initial = [first, neighbor];
    const repairedRows = [{ ...first, ...repaired }, wholePoint ? { ...neighbor, ...repaired } : neighbor];
    const movedRows = [{ ...first, ...destination, text: 'New independent words' }, neighbor];
    const opening = { id: 'opening', text: 'Opening point', subPoints: [{ id: 'old-sub', text: 'Old subpoint', position: 0 }] };
    const other = { id: 'destination', text: 'Destination point', subPoints: [{ id: 'next-sub', text: 'Next subpoint', position: 0 }] };
    const alternate = { id: 'alternate', text: 'Alternate point' };
    const outline = { introduction: [], main: [opening, other, alternate], conclusion: [] };
    const nextOutline = { ...outline, main: wholePoint ? [other, alternate] : [{ ...opening, subPoints: [] }, other, alternate] };
    const board = { introduction: [], main: ['one', 'two'], conclusion: [], ambiguous: [] };
    const create = { protocol: 1, kind: 'create', operationId: generation, owner, resource, generation: null, dependsOn: [],
      value: { userId: owner, title: 'Sermon', verse: 'John 1:1', date, thoughts: initial, outline, structure: board, thoughtsBySection: board } };
    const update = { protocol: 1, kind: 'update', owner, resource, generation, dependsOn: [] };
    const change = (field: string, before: unknown, after: unknown) => ({
      path: [field], before: { exists: true, value: before }, after: { exists: true, value: after },
    });
    const time = (at: number) => ({ earliestMs: 1_800_000_000_000 + at, latestMs: 1_800_000_000_004 + at });
    const remove = { ...update, operationId: 'remove-outline-node',
      changes: [change('outline', outline, nextOutline), change('thoughts', initial, repairedRows)] };
    const legacyBoardRemove = { ...remove,
      changes: [change('outline', outline, nextOutline), change('thoughts', repairedRows, repairedRows)],
      thoughtPlacementActions: repairedRows.slice(0, wholePoint ? 2 : 1).map(row => ({
        rowId: row.id, rowCreatedAt: date, before: repaired, after: repaired, observedRevision: 1, time: time(85),
      })),
    };
    const move = { ...update, operationId: 'move-thought', changes: [change('thoughts', initial, movedRows)],
      thoughtPlacementActions: [{ rowId: first.id, rowCreatedAt: date, before: original, after: destination, observedRevision: 1, time: time(15) }],
    };
    return { owner, create, remove, legacyBoardRemove, move, nextOutline, repairedRows, outline, opening, initial, change, time,
      expected: [movedRows[0], repairedRows[1]] };
  }

  it.each([false, true])('applies a deletion with the repaired location already shown on both command sides (%s is whole point)', async wholePoint => {
    const f = fixture(wholePoint);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.legacyBoardRemove)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.repairedRows } },
    });
  });

  it.each([
    { wholePoint: false, outlineFirst: true }, { wholePoint: false, outlineFirst: false },
    { wholePoint: true, outlineFirst: true }, { wholePoint: true, outlineFirst: false },
  ])('composes an automatic repair and a separate explicit move ($wholePoint whole point, $outlineFirst outline first)', async ({ wholePoint, outlineFirst }) => {
    const f = fixture(wholePoint);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, outlineFirst ? f.remove : f.move)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, outlineFirst ? f.move : f.remove)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.expected } },
    });
  });

  it('keeps the latest deliberate assignment proof even after its point was deleted', async () => {
    const f = fixture(true);
    const later = { ...f.move, operationId: 'later-explicit-assignment',
      thoughtPlacementActions: f.move.thoughtPlacementActions.map(action => ({ ...action, time: f.time(85) })) };
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, later)).toMatchObject({ kind: 'acknowledged' });
    const saved = (await readDocument(f.owner, resource)).value!;
    const detached = { ...f.expected[0], outlinePointId: null, subPointId: null };
    const after = { ...f.outline, main: f.outline.main.filter(point => point.id !== 'destination') };
    const removeChosen = { ...f.remove, operationId: 'delete-later-destination', changes: [
      f.change('outline', f.outline, after), f.change('thoughts', saved.thoughts, [detached, f.initial[1]]),
    ] };
    expect(await processCommand(f.owner, removeChosen)).toMatchObject({ kind: 'acknowledged' });
    const earlier = { ...f.move, operationId: 'delayed-earlier-assignment',
      changes: [f.change('thoughts', f.initial, [{ ...f.initial[0], outlinePointId: 'alternate', subPointId: null }, f.initial[1]])],
      thoughtPlacementActions: f.move.thoughtPlacementActions.map(action => ({ ...action, after: { outlinePointId: 'alternate', subPointId: null } })),
    };
    expect(await processCommand(f.owner, earlier)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { outline: after, thoughts: [detached, f.initial[1]] } } });
  });

  it('does not treat a deliberate clear as an automatic repair when the outline is later edited', async () => {
    const f = fixture(true);
    const cleared = { ...f.initial[0], outlinePointId: null, subPointId: null };
    const clear = { ...f.move, operationId: 'later-explicit-clear',
      changes: [f.change('thoughts', f.initial, [cleared, f.initial[1]])],
      thoughtPlacementActions: f.move.thoughtPlacementActions.map(action => ({
        ...action, after: { outlinePointId: null, subPointId: null }, time: f.time(85),
      })),
    };
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, clear)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.move)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { outline: f.nextOutline, thoughts: [{ ...cleared, text: 'New independent words' }, f.repairedRows[1]] } } });
  });

  it('repairs a linked thought added after the plan was opened without deleting it', async () => {
    const f = fixture(false);
    const added = { ...f.initial[0], id: 'added', text: 'Written after the plan opened' };
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    const addition = { ...f.move, operationId: 'add-thought', thoughtPlacementActions: [],
      changes: [f.change('thoughts', f.initial, [...f.initial, added])] };
    expect(await processCommand(f.owner, addition)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged',
      snapshot: { value: { outline: f.nextOutline, thoughts: [...f.repairedRows, { ...added, subPointId: null }] } } });
  });


  it('preserves a moved thought when a legacy deletion cannot prove the duplicated stamp was explicit', async () => {
    const f = fixture(true);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.move)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.legacyBoardRemove)).toMatchObject({ kind: 'conflict',
      snapshot: { value: { outline: f.outline, thoughts: [f.expected[0], f.initial[1]] } },
    });
  });

  it('checks a legacy cleanup stamp even when the same node was already deleted elsewhere', async () => {
    const f = fixture(true);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.move)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, { ...f.legacyBoardRemove, operationId: 'repeat-old-delete' })).toMatchObject({
      kind: 'conflict', snapshot: { value: { outline: f.nextOutline, thoughts: f.expected } },
    });
  });

  it('keeps a thought deleted elsewhere deleted while accepting the outline removal', async () => {
    const f = fixture(true);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    const deletion = { ...f.move, operationId: 'remove-linked-thought', thoughtPlacementActions: [], changes: [
      f.change('thoughts', f.initial, [f.initial[1]]),
      ...['structure', 'thoughtsBySection'].map(field =>
        f.change(field, f.create.value.structure, { ...f.create.value.structure, main: ['two'] })),
    ] };
    expect(await processCommand(f.owner, deletion)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, f.remove)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: [f.repairedRows[1]] } },
    });
  });


  describe('two deliberate moves of the same sermon outline point', () => {
    function moves(acrossSections: boolean) {
      const f = fixture(true);
      const [point, second, third] = f.outline.main;
      const phone = acrossSections
        ? { ...f.outline, introduction: [point], main: [second, third] }
        : { ...f.outline, main: [second, point, third] };
      const desktop = acrossSections
        ? { ...f.outline, conclusion: [point], main: [second, third] }
        : { ...f.outline, main: [second, third, point] };
      const ids = (outline: SermonOutline) => ({
        introduction: outline.introduction.map(({ id }) => ({ id })),
        main: outline.main.map(({ id }) => ({ id })),
        conclusion: outline.conclusion.map(({ id }) => ({ id })),
      });
      const action = (operationId: string, to: SermonOutline, at: number | null) => ({
        ...f.remove, operationId, changes: [f.change('outline', ids(f.outline), ids(to))],
        outlinePointPlacement: { pointId: point.id, opening: outlinePointGap(f.outline, point.id)!,
          destination: outlinePointGap(to, point.id)!, observedRevision: 1, time: at === null ? null : f.time(at) },
      });
      return { f, point, phone, desktop, action };
    }

    it.each([
      { phoneLater: false, acrossSections: false },
      { phoneLater: true, acrossSections: false },
      { phoneLater: false, acrossSections: true },
      { phoneLater: true, acrossSections: true },
    ])('keeps the later move (phone later $phoneLater, across sections $acrossSections)', async ({ phoneLater, acrossSections }) => {
      const { f, phone, desktop, action } = moves(acrossSections);
      const early = phoneLater ? desktop : phone, late = phoneLater ? phone : desktop;
      expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, action('desktop-outline-move', desktop, phoneLater ? 20 : 100)))
        .toMatchObject({ kind: 'acknowledged' });
      const phoneCommand = action('phone-outline-move', phone, phoneLater ? 100 : 20);
      expect(await processCommand(f.owner, phoneCommand)).toMatchObject({ kind: 'acknowledged', snapshot: { value: { outline: late } } });
      const stored = await readDocument(f.owner, resource);
      const section = acrossSections ? (phoneLater ? 'introduction' : 'conclusion') : 'main';
      expect(stored?.value).toMatchObject({
        outline: late,
        thoughts: f.initial.map(thought => ({ ...thought, tags: [section === 'introduction' ? 'intro' : section] })),
        structure: { [section]: ['one', 'two'] },
        thoughtsBySection: { [section]: ['one', 'two'] },
      });
      const history = await listOutlinePointPlacementHistory(f.owner, resource.id, f.create.operationId);
      expect(history.entries).toMatchObject([{
        pointId: f.opening.id, earlier: outlinePointGap(early, f.opening.id), kept: outlinePointGap(late, f.opening.id),
      }]);
      await expect(listOutlinePointPlacementHistory('another-owner', resource.id, f.create.operationId))
        .rejects.toMatchObject({ status: 403 });
      await expect(listOutlinePointPlacementHistory(f.owner, resource.id, 'different-generation'))
        .rejects.toMatchObject({ status: 404 });
      expect(await processCommand(f.owner, phoneCommand)).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { revision: 3 } } });
    });

    it('offers two placements when the phone clock is unknown and changes no saved words', async () => {
      const { f, point, phone, desktop, action } = moves(true);
      await processCommand(f.owner, f.create);
      await processCommand(f.owner, action('desktop-outline-move', desktop, 20));
      const before = await readDocument(f.owner, resource);
      expect(await processCommand(f.owner, action('unclocked-outline-move', phone, null))).toMatchObject({
        kind: 'conflict',
        conflicts: [{ path: ['outline', 'id:' + point.id, 'position'],
          mine: { value: { section: 'introduction' } }, theirs: { value: { section: 'conclusion' } } }],
      });
      expect(await readDocument(f.owner, resource)).toEqual(before);
    });

    it.each([false, true])('keeps uncertainty after a same-position action (unknown clock: %s)', async unknown => {
      const { f, phone, desktop, action } = moves(true);
      const first = action('first-to-introduction', phone, 20);
      const same = action('second-to-introduction', phone, null);
      const later = action('maybe-later-to-conclusion', desktop, 45);
      first.outlinePointPlacement.time = { earliestMs: f.time(20).earliestMs, latestMs: f.time(40).earliestMs };
      if (!unknown) same.outlinePointPlacement.time = { earliestMs: f.time(35).earliestMs, latestMs: f.time(70).earliestMs };
      await processCommand(f.owner, f.create);
      expect(await processCommand(f.owner, first)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, same)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, later)).toMatchObject({ kind: 'conflict' });
      expect((await readDocument(f.owner, resource))?.value?.outline).toEqual(phone);
    });

    it('does not apply an older gesture to a deleted point restored with the same ID', async () => {
      const { f, phone, action } = moves(true);
      await processCommand(f.owner, f.create);
      expect(await processCommand(f.owner, f.remove)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, { ...f.remove, operationId: 'restore-deleted-outline-point',
        changes: [f.change('outline', f.nextOutline, f.outline)] })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, action('pending-move-from-before-delete', phone, 20))).toMatchObject({ kind: 'conflict' });
      expect((await readDocument(f.owner, resource))?.value?.outline).toEqual(f.outline);
    });

    it('cannot disguise a second move as an exact change to one point', async () => {
      const { f, phone, action } = moves(true);
      await processCommand(f.owner, f.create);
      const command = action('two-outline-moves', phone, 20);
      const after = command.changes[0].after.value as { main: { id: string }[] };
      after.main.reverse();
      expect(await processCommand(f.owner, command)).toMatchObject({ kind: 'refused', code: 'invalid-argument' });
    });
  });

  describe('moving a plan node while another device assigns a thought', () => {
    const boardFields = ['structure', 'thoughtsBySection'] as const;
    function movingFixture(selectMovedNode: boolean, moveAcrossSections: boolean) {
      const f = fixture(true);
      const [opening, destination, alternate] = f.outline.main;
      const [sourceSub] = f.opening.subPoints;
      const oldTarget = { outlinePointId: opening.id, subPointId: sourceSub.id };
      const source = selectMovedNode ? f.move.thoughtPlacementActions[0].after : oldTarget;
      const target = selectMovedNode ? oldTarget : f.move.thoughtPlacementActions[0].after;
      const initial = [{ ...f.initial[0], ...source, tags: ['topic', 'main'] }, f.initial[1]];
      const main = moveAcrossSections ? [destination, alternate] : [
        { ...opening, subPoints: [] }, destination, { ...alternate, subPoints: [sourceSub] },
      ];
      const nextOutline = { ...f.outline, introduction: moveAcrossSections ? [opening] : [], main };
      const board = f.create.value.structure;
      const neighborMoved = { ...board, introduction: ['two'], main: ['one'] };
      const bothMoved = { ...board, introduction: ['one', 'two'], main: [] };
      const repairedBoard = moveAcrossSections ? (selectMovedNode ? neighborMoved : bothMoved) : board;
      const neighbor = moveAcrossSections ? { ...initial[1], tags: ['intro'] } : initial[1];
      const repairedRows = [selectMovedNode ? initial[0] : {
        ...initial[0], ...(moveAcrossSections ? { tags: ['topic', 'intro'] } : { outlinePointId: alternate.id }),
      }, neighbor];
      const assignedRows = [{ ...initial[0], ...target, text: 'New independent words' }, initial[1]];
      const assignedBoard = { ...board, main: ['two', 'one'] };
      const outlineSave = { ...f.remove, operationId: 'move-plan-node', changes: [
        f.change('outline', f.outline, nextOutline), f.change('thoughts', initial, repairedRows),
        ...boardFields.map(field => f.change(field, board, repairedBoard)),
      ] };
      const thoughtSave = { ...f.move, changes: [f.change('thoughts', initial, assignedRows),
        ...boardFields.map(field => f.change(field, board, assignedBoard))],
        thoughtPlacementActions: [{ ...f.move.thoughtPlacementActions[0], before: source, after: target }],
      };
      const expectedPoint = selectMovedNode && !moveAcrossSections ? alternate.id : target.outlinePointId;
      const expectedTag = selectMovedNode && moveAcrossSections ? 'intro' : 'main';
      const expected = [{ ...assignedRows[0], outlinePointId: expectedPoint, tags: ['topic', expectedTag] }, neighbor];
      const expectedBoard = moveAcrossSections ? (expectedTag === 'intro' ? bothMoved : neighborMoved) : assignedBoard;
      return { ...f, create: { ...f.create, value: { ...f.create.value, thoughts: initial } }, outlineSave, thoughtSave, nextOutline, expected, expectedBoard };
    }

    it('keeps the indexed long tag proof through a repaired thought placement', async () => {
      const f = movingFixture(true, true);
      const tag = 'A'.repeat(257);
      const original = f.thoughtSave.changes[0].after.value as typeof f.expected;
      const add = [{ ...original[0], tags: [...original[0].tags, tag] }, original[1]];
      const action = { rowId: original[0].id, rowCreatedAt: original[0].date, tagIndex: add[0].tags.length - 1,
        before: false, after: true, observedRevision: 1, time: f.time(80) };
      expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, f.outlineSave)).toMatchObject({ kind: 'acknowledged' });
      const later = await processCommand(f.owner, { ...f.thoughtSave,
        changes: [f.change('thoughts', f.create.value.thoughts, add), ...f.thoughtSave.changes.slice(1)], thoughtTagActions: [action],
      });
      expect(later).toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: [{ tags: ['topic', tag, 'intro'] }, f.expected[1]] } } });
      const accepted = (later as { snapshot: ResourceSnapshot }).snapshot.value!.thoughts as typeof f.expected;
      const withoutTag = [{ ...accepted[0], tags: accepted[0].tags.filter(name => name !== tag) }, accepted[1]];
      const settled = await processCommand(f.owner, { ...f.thoughtSave, operationId: 'older-tag-removal', thoughtPlacementActions: [],
        changes: [f.change('thoughts', accepted, withoutTag)],
        thoughtTagActions: [{ ...action, tagIndex: accepted[0].tags.indexOf(tag), before: true, after: false, time: f.time(50) }],
      });
      expect(settled.kind).toBe('acknowledged');
      const final = (settled as { snapshot: ResourceSnapshot }).snapshot.value!.thoughts as typeof accepted;
      const orderedTags = (rows: typeof accepted) => rows.map(row => ({ ...row, tags: [...row.tags].sort() }));
      expect(orderedTags(final)).toEqual(orderedTags(accepted));
    });

    it('preserves linked neighbors when the device adds legacy board aliases after the outline move', async () => {
      const f = movingFixture(true, true);
      const { structure: _structure, thoughtsBySection: _thoughtsBySection, ...value } = f.create.value;
      const fromAbsent = (change: (typeof f.outlineSave.changes)[number]) =>
        boardFields.some(field => change.path[0] === field) ? { ...change, before: { exists: false } } : change;
      expect(await processCommand(f.owner, { ...f.create, value })).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, { ...f.outlineSave, changes: f.outlineSave.changes.map(fromAbsent) })).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(f.owner, { ...f.thoughtSave, changes: f.thoughtSave.changes.map(fromAbsent) });
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
        outline: f.nextOutline, thoughts: f.expected,
        structure: { introduction: expect.arrayContaining(['one', 'two']), main: [] },
        thoughtsBySection: { introduction: expect.arrayContaining(['one', 'two']), main: [] },
      } } });
    });

    it('keeps rejecting a mismatched parent even after a real move of the selected subpoint', async () => {
      const f = movingFixture(true, false);
      const malformed = { outlinePointId: 'destination', subPointId: 'old-sub' };
      const initial = f.create.value.thoughts;
      const next = [{ ...initial[0], ...malformed }, initial[1]];
      expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
      expect(await processCommand(f.owner, f.outlineSave)).toMatchObject({ kind: 'acknowledged' });
      const result = await processCommand(f.owner, { ...f.thoughtSave,
        changes: [f.change('thoughts', initial, next)],
        thoughtPlacementActions: [{ ...f.thoughtSave.thoughtPlacementActions[0], after: malformed }],
      });
      expect(result).toMatchObject({ kind: 'refused', code: 'invalid-document' });
    });

    it.each([
      { selectMovedNode: false, moveAcrossSections: true, outlineFirst: false },
      { selectMovedNode: false, moveAcrossSections: true, outlineFirst: true },
      { selectMovedNode: true, moveAcrossSections: true, outlineFirst: true },
      { selectMovedNode: true, moveAcrossSections: false, outlineFirst: true },
      { selectMovedNode: false, moveAcrossSections: false, outlineFirst: true },
    ])('keeps the thought in the section of the chosen live node ($selectMovedNode moved target, $moveAcrossSections cross section, $outlineFirst outline first)',
      async ({ selectMovedNode, moveAcrossSections, outlineFirst }) => {
        const f = movingFixture(selectMovedNode, moveAcrossSections);
        const [first, second] = outlineFirst ? [f.outlineSave, f.thoughtSave] : [f.thoughtSave, f.outlineSave];
        expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
        expect(await processCommand(f.owner, first)).toMatchObject({ kind: 'acknowledged' });
        const result = await processCommand(f.owner, second);
        expect(result).toMatchObject({
          kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.expected } },
        });
        for (const field of boardFields) {
          const value = (result as { snapshot: ResourceSnapshot }).snapshot.value?.[field];
          const board = Object.fromEntries(Object.entries(value ?? {}).map(([section, ids]) => [section, Array.isArray(ids) ? [...ids].sort() : ids]));
          const expected = Object.fromEntries(Object.entries(f.expectedBoard).map(([section, ids]) => [section, [...ids].sort()]));
          expect(board).toEqual(expected);
        }
      });
  });

  it('ignores malformed placement evidence without blocking the automatic repair', async () => {
    const f = fixture(false);
    expect(await processCommand(f.owner, f.create)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(f.owner, { ...f.remove, thoughtPlacementActions: [null] })).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: f.nextOutline, thoughts: f.repairedRows } },
    });
  });

});

describe('an inline reminder queued across a sermon outline move', () => {
  const owner = 'owner';
  const resource = { collection: 'sermons', id: 'reminder-placement' };
  const openingNote = 'Opening reminder';
  const localNote = 'Words typed in the open reminder';
  const storedNote = 'Independently edited reminder';
  const reminder = { id: 'reminder', text: 'Main point', note: openingNote };
  const parent = { id: 'parent', text: 'Destination' };
  const sibling = { id: 'sibling', text: 'Keep this sibling', position: 4, note: 'Independent note' };
  const outline = (main: SermonOutline['main'], conclusion: SermonOutline['conclusion'] = []): SermonOutline =>
    ({ introduction: [], main, conclusion });
  const nested = (note: string) => outline([], [{ ...parent, text: 'Renamed destination', isReviewed: true,
    subPoints: [sibling, { ...reminder, position: 8, note }] }]);
  const create = (before: SermonOutline): DataCommand => ({ protocol: 1, owner, resource, operationId: 'create-reminder',
    generation: null, dependsOn: [], kind: 'create',
    value: { userId: owner, title: 'Reminder sermon', verse: 'John 3:16', date: '2026-11-09', thoughts: [], outline: before as unknown as Json } });
  const save = (id: string, before: SermonOutline, after: SermonOutline): DataCommand => ({
    protocol: 1, owner, resource, operationId: id, generation: 'create-reminder', dependsOn: [], kind: 'update',
    changes: [{ path: ['outline'], before: { exists: true, value: before as unknown as Json },
      after: { exists: true, value: after as unknown as Json } }],
  });

  it.each([true, false])('keeps both the move and the reminder words (placement delivered first: %s)', async placementFirst => {
    const before = outline([reminder, parent]);
    const [move, edit] = [save('move', before, nested(openingNote)), save('edit', before, outline([{ ...reminder, note: localNote }, parent]))];
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, placementFirst ? move : edit)).toMatchObject({ kind: 'acknowledged' });
    const result = await processCommand(owner, placementFirst ? edit : move);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { outline: nested(localNote) } } });
    expect((await readDocument(owner, resource))?.value?.outline).toEqual(nested(localNote));
    expect(await processCommand(owner, placementFirst ? edit : move)).toEqual(result);
  });

  it.each([true, false])('keeps the exact queued title with its moved row (placement delivered first: %s)', async placementFirst => {
    const title = 'Independent new title';
    const before = outline([reminder, parent]);
    const moved = nested(openingNote);
    const edited = outline([{ ...reminder, text: title }, parent]);
    const [move, edit] = [save('move-titled-point', before, moved), save('change-point-title', before, edited)];
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, placementFirst ? move : edit)).toMatchObject({ kind: 'acknowledged' });
    const result = await processCommand(owner, placementFirst ? edit : move);

    const expected = outline([], [{ ...moved.conclusion[0], subPoints: [sibling, { ...reminder, text: title, position: 8 }] }]);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { outline: expected } } });
    expect((await readDocument(owner, resource))?.value?.outline).toEqual(expected);
  });

  it('asks about the two words at the relocated note when both sides edit them', async () => {
    const before = outline([reminder, parent]);
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('move-and-edit', before, nested(storedNote)))).toMatchObject({ kind: 'acknowledged' });
    const result = await processCommand(owner, save('edit', before, outline([{ ...reminder, note: localNote }, parent])));
    expect(result).toMatchObject({ kind: 'conflict', conflicts: [{
      path: ['outline', 'conclusion', 'id:parent', 'subPoints', 'id:reminder', 'note'],
      base: { exists: true, value: openingNote }, mine: { exists: true, value: localNote }, theirs: { exists: true, value: storedNote },
    }] });
    expect((await readDocument(owner, resource))?.value?.outline).toEqual(nested(storedNote));
  });

  it.each(['local', 'saved'])('a %s note choice keeps the precise relocated outline and a separate local edit', async choice => {
    const before = outline([reminder, parent]);
    const created = await processCommand(owner, create(before));
    if (created.kind !== 'acknowledged') throw new Error('Expected sermon creation');
    const moved = await processCommand(owner, save('move-and-edit', before, nested(storedNote)));
    if (moved.kind !== 'acknowledged') throw new Error('Expected moved point');
    const command = save('edit', before, outline([{ ...reminder, note: localNote }, parent]));
    if (command.kind !== 'update') throw new Error('Expected update');
    const change = { path: ['title'], before: { exists: true, value: 'Reminder sermon' }, after: { exists: true, value: 'Local title' } };
    const result = await processCommand(owner, { ...command, changes: [...command.changes, change] });
    if (result.kind !== 'conflict') throw new Error('Expected reminder conflict');
    const session = new DataSession(created.snapshot);
    const proposed = { ...created.snapshot.value!, outline: command.changes[0].after.value!, title: 'Local title' };
    session.edit(proposed);
    session.prepare(command.operationId, owner);
    session.accept(result);
    const shown = session.checkpoint();
    expect(readSermonConflict(shown)).toMatchObject({ kind: 'note-text', mine: localNote, stored: storedNote });
    session.release(result.operationId);
    const accepted = choice === 'local' ? (session.keepLocal(), session.checkpoint().draft)
      : keepUncontestedSermonFields(shown.confirmed, shown.draft, shown.remoteCandidate, shown.conflicts);
    expect(accepted).toMatchObject({
      title: 'Local title', outline: nested(choice === 'local' ? localNote : storedNote),
    });
  });

  it('keeps a separate title edit bundled with the note when another device moves the point', async () => {
    const neighbor = { id: 'neighbor', text: 'Opening neighbor title' };
    const before = outline([reminder, parent, neighbor]);
    const moved = nested(openingNote);
    const saved = { ...moved, main: [neighbor] };
    const renamed = { ...neighbor, text: 'New neighbor title from the same Save' };
    const proposed = outline([{ ...reminder, note: localNote }, parent, renamed]);
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('move', before, saved))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('edit', before, proposed))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: { ...nested(localNote), main: [renamed] } } },
    });
  });

  it('keeps the text of a promoted subpoint when the later delivery clears its reminder', async () => {
    const opening = outline([{ ...parent, subPoints: [{ ...reminder, position: 4 }, sibling] }]);
    const promoted = outline([{ ...parent, subPoints: [sibling] }], [{ ...reminder, text: 'Renamed by the moving device' }]);
    const cleared = { id: reminder.id, text: reminder.text, position: 4 };
    const proposed = outline([{ ...parent, subPoints: [cleared, sibling] }]);
    expect(await processCommand(owner, create(opening))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('promote', opening, promoted))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('clear', opening, proposed))).toMatchObject({ kind: 'acknowledged' });
    const live = (await readDocument(owner, resource))?.value?.outline as unknown as SermonOutline;
    expect(live).toEqual({ ...promoted, conclusion: [{ id: reminder.id, text: 'Renamed by the moving device' }] });
  });

  it.each([true, false])('keeps a moved reminder and the removal of its unchanged child (move first: %s)', async placementFirst => {
    const removed = { id: 'old-child', text: 'Former child', position: 3, note: 'Child reminder' };
    const before = outline([{ ...reminder, subPoints: [removed] }, parent]);
    const edited = outline([{ ...reminder, subPoints: [removed], note: localNote }, parent]);
    const [move, edit] = [save('move-with-removal', before, nested(openingNote)), save('edit-parent-note', before, edited)];
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, placementFirst ? move : edit)).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, placementFirst ? edit : move)).toMatchObject({
      kind: 'acknowledged', snapshot: { value: { outline: nested(localNote) } },
    });
  });

  it('holds changed words of a child deleted as the parent is moved', async () => {
    const child = { id: 'old-child', text: 'Former child', position: 3, note: 'Child reminder' };
    const before = outline([{ ...reminder, subPoints: [child] }, parent]);
    const edited = outline([{ ...reminder, subPoints: [{ ...child, note: localNote }] }, parent]);
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('move-with-removal', before, nested(openingNote)))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('edit-child', before, edited))).toMatchObject({ kind: 'conflict' });
    expect((await readDocument(owner, resource))?.value?.outline).toEqual(nested(openingNote));
  });

  it('keeps the removal in the database when a reminder edit arrives later', async () => {
    const before = outline([reminder, parent]);
    const without = outline([parent]);
    expect(await processCommand(owner, create(before))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('remove', before, without))).toMatchObject({ kind: 'acknowledged' });
    expect(await processCommand(owner, save('edit', before, outline([{ ...reminder, note: localNote }, parent]))))
      .toMatchObject({ kind: 'conflict' });
    expect((await readDocument(owner, resource))?.value?.outline).toEqual(without);
  });
});

it('does not let a delayed old preaching date win after its newer proof is evicted by 32 other rows', async () => {
  const rows = Array.from({ length: 33 }, (_, index) => ({ id: 'row-' + index, date: '2026-01-01',
    church: { id: 'church', name: 'Church' }, createdAt: '2026-01-01T00:00:00.000Z' }));
  documents.set('sermons/sermon', { userId: 'owner-1', title: 'Sermon', verse: 'John 1:1', date: '2026-01-01',
    thoughts: [], preachDates: rows, _dataEngine: { protocol: 1, generation: 'sermon-g', revision: 1, deleted: false } });
  const command = (operationId: string, rowId: string, after: string, time: number): DataCommand => {
    const raw = documents.get('sermons/sermon')!;
    const beforeRows = JSON.parse(JSON.stringify(raw.preachDates));
    const before = beforeRows.find((row: { id: string }) => row.id === rowId).date;
    return { protocol: 1, operationId, owner: 'owner-1', resource: { collection: 'sermons', id: 'sermon' },
      generation: 'sermon-g', dependsOn: [], kind: 'update', changes: [{ path: ['preachDates'],
        before: { exists: true, value: beforeRows },
        after: { exists: true, value: beforeRows.map((row: { id: string }) => row.id === rowId ? { ...row, date: after } : row) } }],
      preachDateAction: { rowId, before, after, observedRevision: (raw._dataEngine as { revision: number }).revision,
        time: { earliestMs: time, latestMs: time + 1 } } };
  };
  const t = 1_799_999_900_000;
  const old = command('old-date', 'row-0', '2026-01-02', t + 10);
  expect((await processCommand('owner-1', command('new-date', 'row-0', '2026-01-03', t + 100))).kind).toBe('acknowledged');
  expect((await processCommand('owner-1', command('newer-undo', 'row-0', '2026-01-01', t + 200))).kind).toBe('acknowledged');
  for (let i = 1; i <= 32; i++) {
    expect((await processCommand('owner-1', command('other-' + i, 'row-' + i, '2026-01-04', t + 300 + i * 10))).kind).toBe('acknowledged');
  }
  expect(transactionReads).toHaveLength(34 * 3);
  expect(transactionWrites).toHaveLength(34 * 4);
  const proof = documents.get('sermons/sermon')!._dataEngine as { preachDateActions: Array<{ rowId: string }> };
  expect(proof.preachDateActions).toHaveLength(32);
  expect(proof.preachDateActions.some(row => row.rowId === 'row-0')).toBe(false);
  const result = await processCommand('owner-1', old);
  expect(result.kind).toBe('conflict');
  expect((documents.get('sermons/sermon')!.preachDates as Array<{ date: string }>)[0].date).toBe('2026-01-01');
});

it.each(['sermons', 'groups'] as const)('accepts 34 dated rows from one stale device in %s without reviewing untouched rows', async collection => {
  const owner = 'owner-1';
  const resource = { collection, id: 'offline-date-batch' };
  const field = collection === 'sermons' ? 'preachDates' : 'meetingDates';
  const evidence = collection === 'sermons' ? 'preachDateAction' : 'meetingDateAction';
  const stamp = '2026-11-08T00:00:00.000Z';
  const rows = Array.from({ length: 34 }, (_, index) => ({ id: 'row-' + index, date: '2026-12-13',
    church: { id: 'church', name: 'Church' }, status: 'planned', notes: 'Keep row ' + index, createdAt: stamp }));
  const value = collection === 'sermons' ? { verse: 'John 1:1', date: stamp, thoughts: [] } : { status: 'draft', flow: [], templates: [] };
  const base = { protocol: 1, owner, resource, dependsOn: [] };
  const created = await processCommand(owner, { ...base, operationId: 'date-batch-opening', kind: 'create', generation: null,
    value: { ...value, userId: owner, title: 'Dated rows', [field]: rows, createdAt: stamp, updatedAt: stamp } });
  expect(created.kind).toBe('acknowledged');
  const replies = [];
  for (const [index, row] of rows.entries()) {
    const after = '2026-12-20';
    const at = 1_799_999_900_000 + index * 20;
    const answer = await processCommand(owner, { ...base, operationId: 'date-' + index, kind: 'update', generation: 'date-batch-opening',
      changes: [{ path: [field], before: { exists: true, value: rows },
        after: { exists: true, value: rows.map(item => item.id === row.id ? { ...item, date: after } : item) } }],
      [evidence]: { rowId: row.id, before: row.date, after, observedRevision: 1, time: { earliestMs: at, latestMs: at + 1 } },
    });
    replies.push(answer.kind);
  }
  expect(replies).toEqual(Array(34).fill('acknowledged'));
  expect((await readDocument(owner, resource))?.value?.[field]).toEqual(rows.map(row => ({ ...row, date: '2026-12-20' })));
});

it.each(['legacy', 'malformed', 'unreadable', 'missing scalar', 'low scalar', 'overflow'] as const)('keeps conservative date review when eviction coverage is %s', async coverage => {
  const owner = 'owner-1', resource = { collection: 'sermons', id: 'dated-gap-fallback' };
  const stamp = '2026-11-08T00:00:00.000Z';
  const row = { id: 'untracked-row', date: '2026-12-13', church: { id: 'church', name: 'Church' }, notes: 'Keep words', createdAt: stamp };
  const proofRows = Array.from({ length: 32 }, (_, index) => ({ id: 'recent-' + index, date: row.date, church: row.church, createdAt: stamp }));
  const rows = [row, ...proofRows];
  const at = 1_799_999_900_000;
  const time = { earliestMs: at, latestMs: at + 1 };
  const evicted = Array.from({ length: 256 }, (_, index) => ({ rowId: 'evicted-' + index, revision: 257 - index }));
  const raw = {
    protocol: 1, generation: 'generation', revision: 300, deleted: false,
    ...((coverage !== 'missing scalar' && coverage !== 'unreadable') && { preachDateProofFloor: coverage === 'low scalar' ? 10 : 257 }),
    ...(coverage === 'malformed' && { preachDateProofEvictions: { floor: 256, older: 0, rows: evicted } }),
    ...(coverage === 'unreadable' && { preachDateProofEvictions: { floor: 'unreadable', older: 'unreadable', rows: [null] } }),
    ...((coverage === 'missing scalar' || coverage === 'low scalar') && {
      preachDateProofEvictions: { floor: 257, older: 0, rows: evicted },
    }),
    ...(coverage === 'overflow' && {
      preachDateProofEvictions: { floor: 257, older: 0, rows: evicted },
      preachDateActions: proofRows.map((item, index) => ({ rowId: item.id, date: item.date, time, revision: 300 - index })),
    }),
  };
  documents.set('sermons/dated-gap-fallback', { title: 'Sermon', userId: owner, verse: 'John 1:1', date: stamp, thoughts: [],
    preachDates: rows, _dataEngine: raw });
  const submit = (operationId: string, selected: typeof proofRows[number], observedRevision: number) => processCommand(owner, {
    protocol: 1, operationId, owner, resource, generation: 'generation', dependsOn: [], kind: 'update',
    changes: [{ path: ['preachDates'], before: { exists: true, value: rows },
      after: { exists: true, value: rows.map(item => item.id === selected.id ? { ...item, date: '2026-12-20' } : item) } }],
    preachDateAction: { rowId: selected.id, before: selected.date, after: '2026-12-20', observedRevision, time },
  });
  if (coverage === 'overflow') {
    expect(await submit('push-out-last-eviction', row, 300)).toMatchObject({ kind: 'acknowledged' });
    const latest = (await readDocument(owner, resource))!.value!.preachDates as unknown as typeof rows;
    rows.splice(0, rows.length, ...latest);
    const metadata = documents.get('sermons/dated-gap-fallback')!._dataEngine as {
      preachDateProofFloor: number; preachDateProofEvictions: { older: number; rows: unknown[] };
    };
    expect(metadata.preachDateProofFloor).toBe(269);
    expect(metadata.preachDateProofEvictions.older).toBe(2);
    expect(metadata.preachDateProofEvictions.rows).toHaveLength(256);
    // Emulate an untouched row whose ID falls outside the bounded recent eviction records.
    const unknown = { ...row, id: 'ancient-untouched-row' };
    const doc = documents.get('sermons/dated-gap-fallback')!;
    rows.push(unknown);
    doc.preachDates = rows;
    expect(await submit('old-after-overflow', unknown, 1)).toMatchObject({ kind: 'conflict' });
  } else {
    expect(await submit('old-without-row-coverage', row, 11)).toMatchObject({
      kind: 'conflict', conflicts: [{ path: ['preachDates', 'id:untracked-row', 'date'] }],
    });
  }
});
