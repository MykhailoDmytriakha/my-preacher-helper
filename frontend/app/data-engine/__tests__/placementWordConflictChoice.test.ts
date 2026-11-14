/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { outlinePointGap, outlinePointOrder, projectOutlinePoint } from '@/utils/outlineDnd';
import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { processCommand, readDocument } from '../server';
import { installStorageHarness } from './storageHarness';

import type { SnapshotStore } from '../engine';
import type { DataCommand, DocumentData, EditorCommitAction, JournalEntry, ResourceSnapshot } from '../types';
import type { SermonOutline, ServiceOrderStep } from '@/models/models';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));
jest.mock('firebase-admin/firestore', () => ({ ...jest.requireActual('firebase-admin/firestore'), Filter: {
  where: (field: string, operator: string, value: unknown) => ({ kind: 'field', field, operator, value }),
  or: (...filters: unknown[]) => ({ kind: 'or', filters }),
} }));

type Family = 'step' | 'rank' | 'outline';
const clone = <V,>(value: V): V => JSON.parse(JSON.stringify(value)) as V;
const rows = ['a', 'b', 'c'].map(id => ({ id, text: id, title: id, type: 'custom' as const, subPoints: [] }));
const words = 'Words typed beside the move';
const remoteWords = 'Remote title';
const settle = async () => {
  for (let round = 0; round < 30; round++) await new Promise<void>(resolve => setImmediate(resolve));
};

function fixture(family: Family) {
  const db = installWorldFirestore(() => 1_800_000_001_000);
  installStorageHarness();
  const resource = { collection: family === 'outline' ? 'sermons' : 'serviceOrders', id: 'doc' };
  const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };
  const value: DocumentData = { userId: 'owner', title: 'Opening', createdAt: 'now', updatedAt: 'now',
    date: '2026-11-12', rank: 1, steps: clone(rows), verse: 'John 1:1', thoughts: [],
    outline: { introduction: [], main: clone(rows), conclusion: [] } };
  db.documents.set(resource.collection + '/doc', { ...clone(value), _dataEngine: clone(metadata) });
  db.documents.set('serviceOrders/neighbor', { userId: 'owner', title: 'Neighbor', rank: 3, _dataEngine: clone(metadata) });
  const cache = new Map<string, ResourceSnapshot>();
  const snapshots: SnapshotStore = {
    read: async (owner, ref) => { const saved = cache.get(JSON.stringify([owner, ref])); return saved && clone(saved); },
    put: async (owner, snapshot) => { cache.set(JSON.stringify([owner, snapshot.resource]), clone(snapshot)); },
  };
  let sequence = 0;
  let beforeSend: (() => Promise<void>) | undefined;
  const sent: DataCommand[] = [];
  const answers: Awaited<ReturnType<typeof processCommand>>[] = [];
  const transport = {
    read: async (_owner: string, ref: typeof resource) => readDocument('owner', ref),
    send: async (command: DataCommand) => {
      if (!sent.length) await beforeSend?.();
      sent.push(clone(command));
      const answer = await processCommand('owner', command);
      answers.push(answer);
      return answer;
    },
  };
  const entries = new Map<string, JournalEntry>();
  const runtime = new DataEngineRuntime({ transport, journal: {
    list: async () => clone([...entries.values()]),
    put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
    remove: async (_owner, id) => { entries.delete(id); },
  } });
  const commits = createIndexedDbCommitStore();
  const errors: unknown[] = [];
  const engine = new DataEngine({ runtime, transport, commits, snapshots, checkpoints: createIndexedDbCheckpoints(),
    observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    manualScopes: { read: async () => undefined, list: async () => [], create: async () => undefined,
      put: async () => undefined, compact: async () => undefined },
    operationId: () => `choice-${++sequence}`, onError: error => { errors.push(error); } });
  engine.setOwner('owner'); engine.setOnline(true);
  const other = (field: string, next: DocumentData[string]) => processCommand('owner', {
    protocol: 1, kind: 'update', operationId: `other-${++sequence}`, owner: 'owner', resource,
    generation: 'g', dependsOn: [], changes: [{ path: [field],
      before: { exists: true, value: value[field] }, after: { exists: true, value: next } }],
  });
  const drain = async () => { await engine.retry(resource); await settle(); };
  return { engine, resource, value, commits, sent, answers, errors, other, drain,
    server: async () => (await readDocument('owner', resource)).value!,
    onFirstSend: (fn: () => Promise<void>) => { beforeSend = fn; } };
}

async function move(h: ReturnType<typeof fixture>, editor: Awaited<ReturnType<DataEngine['openEditor']>>, family: Family, withWords: boolean) {
  const destination = { previous: 'b', next: 'c' };
  const stepMove = { generation: 'g', shownIds: ['a', 'b', 'c'], placement: { stepId: 'a',
    opening: stepGap(rows, 'a')!, destination, observedRevision: 1, time: null } };
  const outline = h.value.outline as unknown as SermonOutline;
  const projected = projectOutlinePoint(outline, 'a', { section: 'main', ...destination })!;
  const action: EditorCommitAction = family === 'step' ? { kind: 'service-order-step-placement', move: stepMove }
    : family === 'rank' ? { kind: 'service-order-placement', move: { generation: 'g', before: { exists: true, value: 1 }, rank: 4,
      placement: { opening: { previous: null, next: { id: 'neighbor', generation: 'g' } },
        destination: { previous: { id: 'neighbor', generation: 'g' }, next: null }, observedRevision: 1, time: null } } }
      : { kind: 'outline-point-placement', move: { generation: 'g', before: outlinePointOrder(outline), after: outlinePointOrder(projected),
        placement: { pointId: 'a', opening: outlinePointGap(outline, 'a')!, destination: outlinePointGap(projected, 'a')!, observedRevision: 1, time: null } } };
  // Outline captures the words with the move, avoiding its separate opening-draft Save.
  if (withWords && family !== 'outline') await editor.edit({ ...editor.getState().checkpoint.draft!, title: words });
  await editor.commit(value => ({ ...value!, ...(withWords && { title: words }),
    ...(family === 'rank' ? { rank: 4 } : family === 'step'
      ? { steps: projectServiceOrderStep(value!.steps as unknown as ServiceOrderStep[], 'a', destination)! }
      : { outline: projected }) } as DocumentData), action);
  await h.drain();
}

describe.each(['step', 'rank', 'outline'] as const)('%s move acknowledged before a sibling-word conflict', family => {
  it.each(['keep mine', 'take the stored version'] as const)('%s resolves the words and allows the next ordinary save', async choice => {
    const h = fixture(family);
    try {
      const editor = await h.engine.openEditor(h.resource, 'screen-editor');
      h.onFirstSend(async () => { expect((await h.other('title', remoteWords)).kind).toBe('acknowledged'); });
      await move(h, editor, family, true);
      expect(h.answers.map(answer => answer.kind)).toEqual(['acknowledged']);
      const request = (await h.commits.list('owner')).find(request => request.state === 'conflict')!;
      // The move's ACK exposes the conflicting words before their follow-up can be sent.
      expect(request.result).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['title'] }] });
      expect(request.submitted?.title).toBe('Opening');
      expect(request.value?.title).toBe(words);
      expect(request.result).not.toHaveProperty('serviceOrderPlacementComparison');
      expect(editor.getState().checkpoint).toMatchObject({ dirty: true, draft: { title: words }, conflicts: [{ path: ['title'] }] });

      if (choice === 'keep mine') await editor.keepLocal();
      else await editor.acceptRemote();
      await settle();
      const chosenTitle = choice === 'keep mine' ? words : remoteWords;
      expect(editor.getState().checkpoint).toMatchObject({ draft: { title: chosenTitle }, conflicts: [] });
      expect((await h.commits.list('owner')).filter(saved => saved.id === request.id && saved.state !== 'cancelled')).toEqual([]);
      await editor.save(); await h.drain();
      expect((await h.server()).title).toBe(chosenTitle);
      expect(editor.getState().checkpoint).toMatchObject({ dirty: false, pending: {}, conflicts: [] });

      await editor.edit({ ...editor.getState().checkpoint.draft!, title: 'Next ordinary save' });
      await editor.save(); await h.drain();
      expect((await h.server()).title).toBe('Next ordinary save');
      expect(h.sent.at(-1)).toMatchObject({ kind: 'update', changes: [{ path: ['title'] }] });
      expect(h.answers.at(-1)?.kind).toBe('acknowledged');
      expect(editor.getState().checkpoint).toMatchObject({ dirty: false, pending: {}, conflicts: [] });
      expect(h.errors).toEqual([]);
    } finally { h.engine.dispose(); }
  });
});

describe('a real step-placement comparison keeps the placement-choice contract', () => {
  it.each(['keep mine', 'take the stored version', 'keep mine after typing', 'take stored after typing', 'keep mine with missing step'] as const)(
    '%s preserves the thrown code or staged retry', async choice => {
      const h = fixture('step');
      try {
        const editor = await h.engine.openEditor(h.resource, 'screen-editor');
        const storedRows = choice === 'keep mine with missing step' ? [rows[1], rows[2]] : [rows[1], rows[2], rows[0]];
        h.onFirstSend(async () => { expect((await h.other('steps', storedRows)).kind).toBe('acknowledged'); });
        await move(h, editor, 'step', false);
        expect(h.answers.map(answer => answer.kind)).toEqual(['conflict']);
        expect(h.answers[0]).toMatchObject({ serviceOrderPlacementComparison: {
          step: { id: 'a' }, available: choice !== 'keep mine with missing step',
        } });
        if (choice.endsWith('after typing')) {
          await editor.edit({ ...editor.getState().checkpoint.draft!, title: 'Later words' });
          const choose = choice.startsWith('keep mine') ? () => editor.keepLocal() : () => editor.acceptRemote();
          await expect(choose()).rejects.toMatchObject({ code: 'other-changes-first' });
        } else if (choice === 'keep mine with missing step') {
          await expect(editor.keepLocal()).rejects.toMatchObject({ code: 'decision-changed' });
        } else {
          if (choice === 'keep mine') await editor.keepLocal();
          else await editor.acceptRemote();
          const state = editor.getState().checkpoint;
          if (choice === 'keep mine') {
            expect(state.serviceOrderStepPlacementRetry).toMatchObject({ generation: 'g', shownIds: ['b', 'c', 'a'],
              placement: { stepId: 'a', opening: { previous: 'c', next: null }, destination: { previous: 'b', next: 'c' }, observedRevision: 2, time: null } });
            expect(state.dirty).toBe(true);
            // A step choice stages its retry; delivery still belongs to the next Save.
            expect(h.sent).toHaveLength(1);
            await editor.save(); await h.drain();
            expect(h.sent[1]).toHaveProperty('serviceOrderStepPlacement');
            expect(h.answers.at(-1)?.kind).toBe('acknowledged');
          } else {
            expect(state.serviceOrderStepPlacementRetry).toBeUndefined();
            expect(state.dirty).toBe(false);
          }
          expect((await h.server()).steps).toEqual(choice === 'keep mine' ? [rows[1], rows[0], rows[2]] : storedRows);
        }
        expect(h.errors).toEqual([]);
      } finally { h.engine.dispose(); }
    });
});
