import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { collectionDocumentViews } from '../collectionView';
import { CommitQueue, createMemoryCommitStore } from '../commits';
import { EditorController } from '../controller';
import { ACTION_SLOT } from '../editorIdentity';
import { isEngineOwned } from '../engineOwnedCollections';
import { applyCommand, getResourcePolicy } from '../protocol';
import { validateResourceDocument } from '../resourceSchemas';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { submittedWorkCheckpoint } from '../submittedWork';

import type { BrowserDataEngine } from '../browser.client';
import type { JournalEntry, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/**
 * The pastor's own places in a topic of the word for the occasion (`hooks/useOccasionPlaces.ts`):
 * one document per place, written only through the engine, made and removed, never edited.
 */
const place = (overrides: Record<string, unknown> = {}) => ({
  userId: 'owner',
  occasionId: 'assurance',
  ref: { bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 16 },
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  ...overrides,
});

const resource = { collection: 'occasionPlaces', id: 'offline-place' };
const absent = { resource, value: null, metadata: null };

async function addPlace(browser: BrowserDataEngine) {
  const creator = await browser.engine.createEditor(resource, browser.editorId(resource, ACTION_SLOT));
  await creator.commit(() => place());
  await creator.close({ flush: false });
}

describe('occasionPlaces — the pastor\'s own places', () => {
  it('is a collection the engine owns, its person writing the topic and the place and removing them', () => {
    expect(isEngineOwned('occasionPlaces')).toBe(true);
    const policy = getResourcePolicy('occasionPlaces');
    expect(policy.ownerField).toBe('userId');
    expect(policy.allowDelete).toBe(true);
    expect(policy.writableFields).toEqual(expect.arrayContaining(['occasionId', 'ref']));
  });

  it('keeps a place with its Bible, a chapter and optional verses', () => {
    expect(() => validateResourceDocument('occasionPlaces', place(), { kind: 'create' })).not.toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'kjv', book: 'Psalms', chapter: 23 } }), { kind: 'create' })).not.toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'ubio', book: 'John', chapter: 14, fromVerse: 1, toVerse: 3 } }), { kind: 'create' })).not.toThrow();
    // A run of whole chapters ("Мф 5-7") keeps its end.
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'rst', book: 'Matthew', chapter: 5, toChapter: 7 } }), { kind: 'create' })).not.toThrow();
  });

  it('refuses a place that does not say where it stands: no Bible, an unknown Bible, no chapter, no topic', () => {
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { book: 'Romans', chapter: 8 } }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'nrsv', book: 'Romans', chapter: 8 } }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ ref: { bible: 'rst', book: 'Romans' } }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ occasionId: '' }), { kind: 'create' })).toThrow();
    expect(() => validateResourceDocument('occasionPlaces', place({ note: 'words' }), { kind: 'create' })).toThrow('Unknown field in new document');
  });

  it('removes a locally added place before delivery and keeps it removed after reopening', async () => {
    const h = documentEngineHarness(absent);
    let browser = h.createBrowser();
    browser.engine.setOnline(false);
    browser.engine.setOwner('owner');
    try {
      await addPlace(browser);
      const remover = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
      expect(remover.getState().checkpoint.draft).toEqual(place());
      await expect(remover.remove()).resolves.toBeUndefined();
      expect(remover.getState().checkpoint.draft).toBeNull();
      await remover.close({ flush: false });
      expect(h.transport.send).not.toHaveBeenCalled();

      browser.dispose();
      await settleEngine();
      browser = h.createBrowser();
      browser.engine.setOnline(false);
      browser.engine.setOwner('owner');
      const reopened = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
      expect(reopened.getState().checkpoint.draft).toBeNull();
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();

      expect(h.server.value).toBeNull();
      expect((await h.commits.list('owner')).every(request => ['acknowledged', 'cancelled'].includes(request.state))).toBe(true);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });

  it('waits for the exact creation response before delivering a removal', async () => {
    let started!: () => void;
    let release!: () => void;
    const sent = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const h = documentEngineHarness(absent, { apply: async (command, current) => {
      if (command.kind === 'create') {
        started();
        await held;
      }
      return applyCommand(command, current);
    } });
    const browser = h.createBrowser();
    browser.engine.setOnline(false);
    browser.engine.setOwner('owner');
    try {
      await addPlace(browser);
      browser.engine.setOnline(true);
      const delivery = browser.engine.retry();
      await sent;
      const remover = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
      await remover.remove();
      expect(remover.getState().checkpoint.draft).toBeNull();
      expect(h.transport.send).toHaveBeenCalledTimes(1);
      release();
      await delivery;
      await browser.engine.retry();
      await settleEngine();
      const commands = jest.mocked(h.transport.send).mock.calls.map(([command]) => command);
      expect(commands.map(command => command.kind)).toEqual(['create', 'delete']);
      expect(commands[1].generation).toBe(h.server.metadata?.generation);
      expect(h.server.metadata?.deleted).toBe(true);
    } finally {
      release();
      browser.dispose();
      await settleEngine();
    }
  });

  it('ends the removal without a delete command if the earlier creation was refused', async () => {
    const h = documentEngineHarness(absent, { apply: (command, current) => command.kind === 'create'
      ? { kind: 'refused', operationId: command.operationId, code: 'already-exists' }
      : applyCommand(command, current) });
    const browser = h.createBrowser();
    browser.engine.setOnline(false);
    browser.engine.setOwner('owner');
    try {
      await addPlace(browser);
      const remover = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
      await remover.remove();
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();

      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create']);
      const records = await h.commits.list('owner');
      expect(records.find(request => request.value === null)).toMatchObject({ state: 'refused', result: { kind: 'refused' } });
      const independent = { ...absent, value: place({ occasionId: 'another-topic' }),
        metadata: { protocol: 1 as const, generation: 'another-generation', revision: 1, deleted: false, operationId: 'another-generation' } };
      expect(collectionDocumentViews('owner', resource.collection, [independent], records)).toEqual([
        expect.objectContaining({ value: independent.value, needsAttention: true, deleting: false }),
      ]);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });

  it.each([false, true])('sends no delete if a creation response names an independent generation (receipt proof %s)', async withProof => {
    const h = documentEngineHarness(absent, { apply: (command, current) => {
      const result = applyCommand(command, current);
      if (command.kind !== 'create' || result.kind !== 'acknowledged' || !result.snapshot.metadata) return result;
      const committed = result.snapshot.metadata;
      return {
        ...result,
        ...(withProof && { committed }),
        snapshot: { ...result.snapshot, metadata: { ...committed, generation: 'another-generation', operationId: 'another-generation' } },
      };
    } });
    const browser = h.createBrowser();
    browser.engine.setOnline(false);
    browser.engine.setOwner('owner');
    try {
      await addPlace(browser);
      const remover = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
      await remover.remove();
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();

      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create']);
      expect(h.server.value).toMatchObject({ occasionId: 'assurance' });
      expect((await h.commits.list('owner')).find(request => request.value === null))
        .toMatchObject({ state: 'refused', result: { kind: 'refused' } });
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });

  it('settles an already deleted place on replay of the same creation receipt', async () => {
    const h = documentEngineHarness(absent, { apply: (command, current) => {
      const result = applyCommand(command, current);
      if (command.kind !== 'create' || result.kind !== 'acknowledged' || !result.snapshot.metadata) return result;
      const committed = result.snapshot.metadata;
      return { ...result, committed, snapshot: { ...result.snapshot, value: null,
        metadata: { ...committed, revision: 2, operationId: 'previous-removal', deleted: true } } };
    } });
    const browser = h.createBrowser();
    browser.engine.setOnline(false);
    browser.engine.setOwner('owner');
    try {
      await addPlace(browser);
      const remover = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
      const receipt = await remover.removeWithReceipt();
      expect(receipt).toMatchObject({ kind: 'submitted' });
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();

      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create']);
      expect(h.server.metadata?.deleted).toBe(true);
      await expect(receipt.persistence).resolves.toEqual(h.server);
      const unsettled = (await h.commits.list('owner')).filter(request => !['acknowledged', 'cancelled'].includes(request.state));
      expect(unsettled).toEqual([]);
      expect(remover.getState().checkpoint).toMatchObject({ confirmed: h.server, draft: null, pending: {} });
      expect(Object.keys(remover.getState().checkpoint.pending)).toEqual([]);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });

  it('keeps the observed create as predecessor when its ACK reaches a different editor before remove capture', async () => {
    let server: ResourceSnapshot = absent;
    let sequence = 0;
    const journal = new Map<string, JournalEntry>();
    const runtime = new DataEngineRuntime({
      journal: {
        list: async () => [...journal.values()],
        put: async entry => { journal.set(entry.command.operationId, entry); },
        remove: async (_owner, operation) => { journal.delete(operation); },
      },
      transport: { read: async () => server, send: async command => {
        const result = applyCommand(command, server);
        if (result.kind === 'acknowledged') server = result.snapshot;
        return result;
      } },
    });
    const queue = new CommitQueue({ store: createMemoryCommitStore(), runtime, operationId: () => 'place-' + ++sequence,
      readConfirmed: async () => server });
    runtime.setOwner('owner');
    queue.setOwner('owner');
    const creation = new DataSession(absent);
    creation.edit(place());
    const parent = (await queue.save('creator', creation.checkpoint()))!;
    const remover = await EditorController.open({ owner: 'owner', editorId: 'remover', snapshot: absent, runtime, commits: queue,
      submittedCheckpoint: submittedWorkCheckpoint('owner', resource, [parent])!,
      store: { read: async () => undefined, put: async () => undefined }, operationId: () => 'unused', isCurrentOwner: () => true });
    let removal: Promise<void> | undefined;
    let pendingAtPress: string[] = [];
    const stop = queue.subscribe(({ request }) => {
      if (request.id !== parent.id || request.state !== 'acknowledged' || removal) return;
      pendingAtPress = Object.keys(remover.getState().checkpoint.pending);
      removal = remover.remove();
    });
    try {
      await queue.drain(true);
      expect(pendingAtPress).toEqual([parent.id]);
      expect(removal).toBeDefined();
      await removal;
      const captured = (await queue.list()).find(request => request.editorId === 'remover');
      expect(captured).toMatchObject({ predecessor: parent.id, value: null });
      await queue.drain(true);
      expect(server.metadata).toMatchObject({ generation: parent.id, deleted: true });
    } finally {
      stop();
      remover.dispose();
      queue.setOwner(null);
      runtime.setOwner(null);
    }
  });
});
