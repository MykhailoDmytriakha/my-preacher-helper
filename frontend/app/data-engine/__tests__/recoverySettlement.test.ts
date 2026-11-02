import { DataEngine } from '../engine';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { ResourceObserver, type SnapshotEvent } from '../observer';
import { applyCommand } from '../protocol';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { DataEngineRuntime } from '../runtime';
import { installStorageHarness } from './storageHarness';
import type { CommandResult, DataCommand, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const owner = 'owner';
const resource: ResourceRef = { collection: 'studyNotes', id: 'settlement-note' };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const keyOf = (uid: string, ref: ResourceRef) => JSON.stringify([uid, ref.collection, ref.id]);
const sourceCheckpointId = (editorId: string) => JSON.stringify([owner, editorId]);
const initial = (revision = 1, content = 'base'): ResourceSnapshot => ({
    resource,
    value: { userId: owner, title: 'Settlement note', content, tags: [], scriptureRefs: [], isDraft: false, createdAt: '2026-11-01', updatedAt: '2026-11-01' },
    metadata: { protocol: 1, generation: 'settlement-generation', revision, deleted: false },
});
const absent = (ref: ResourceRef): ResourceSnapshot => ({ resource: ref, value: null, metadata: null });
function acknowledgedSnapshot(result: CommandResult | undefined): ResourceSnapshot {
    if (result?.kind !== 'acknowledged')
        throw new Error('Expected the observed Save acknowledgement');
    return result.snapshot;
}
const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async <T,>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> => {
    const end = Date.now() + 3000;
    while (Date.now() < end) {
        const value = await read();
        if (ready(value))
            return value;
        await pause(5);
    }
    throw new Error(`Timed out waiting for ${label}`);
};
function setup() {
    installStorageHarness();
    const stores = () => ({ checkpoints: createIndexedDbCheckpoints(), manualScopes: createIndexedDbManualScopes(), commits: createIndexedDbCommitStore() });
    const snapshots = new Map<string, ResourceSnapshot>([[keyOf(owner, resource), initial()]]);
    const journalRows = new Map<string, JournalEntry>();
    const transportResults: Array<{
        command: DataCommand;
        result: ReturnType<typeof applyCommand>;
    }> = [];
    const listeners: Array<{
        owner: string;
        resource: ResourceRef;
        next(event: SnapshotEvent): void;
    }> = [];
    let operation = 0;
    const transport = {
        read: jest.fn(async (uid: string, ref: ResourceRef) => clone(snapshots.get(keyOf(uid, ref)) ?? absent(ref))),
        send: jest.fn(async (command: DataCommand) => {
            const current = snapshots.get(keyOf(command.owner, command.resource)) ?? absent(command.resource);
            const result = applyCommand(command, clone(current));
            if (result.kind === 'acknowledged')
                snapshots.set(keyOf(command.owner, command.resource), clone(result.snapshot));
            transportResults.push({ command: clone(command), result: clone(result) });
            return result;
        }),
    };
    const source = { listen: jest.fn((uid: string, ref: ResourceRef, next: (event: SnapshotEvent) => void) => {
            const entry = { owner: uid, resource: clone(ref), next };
            listeners.push(entry);
            return () => {
                const index = listeners.indexOf(entry);
                if (index >= 0)
                    listeners.splice(index, 1);
            };
        }) };
    const createEngine = (online = false) => {
        const nativeStores = stores();
        const runtime = new DataEngineRuntime({ transport, journal: {
                list: async (uid) => clone([...journalRows.values()].filter(row => row.command.owner === uid)),
                put: async (row) => { journalRows.set(JSON.stringify([row.command.owner, row.command.operationId]), clone(row)); },
                remove: async (uid, id) => { journalRows.delete(JSON.stringify([uid, id])); },
            } });
        const engine = new DataEngine({ runtime, observer: new ResourceObserver({ transport, source }), transport,
            checkpoints: nativeStores.checkpoints, manualScopes: nativeStores.manualScopes, commits: nativeStores.commits,
            snapshots: {
                read: async (uid, ref) => { const value = snapshots.get(keyOf(uid, ref)); return value && clone(value); },
                put: async (uid, value) => { snapshots.set(keyOf(uid, value.resource), clone(value)); },
            }, operationId: () => `settlement-operation-${++operation}` });
        engine.setOnline(online);
        engine.setOwner(owner);
        return engine;
    };
    const publish = (snapshot: ResourceSnapshot) => {
        snapshots.set(keyOf(owner, snapshot.resource), clone(snapshot));
        for (const listener of [...listeners]) {
            if (listener.owner === owner && listener.resource.collection === snapshot.resource.collection && listener.resource.id === snapshot.resource.id) {
                listener.next({ snapshot: clone(snapshot), source: 'server' });
            }
        }
    };
    return { stores, snapshots, transport, transportResults, createEngine, publish };
}
async function seedConflictedCheckpoint(s: ReturnType<typeof setup>, editorId: string) {
    const engine = s.createEngine(false);
    const editor = await engine.openEditor(resource, editorId);
    await editor.edit({ ...initial().value!, content: `local words from ${editorId}` });
    const remote = initial(2, `server words for ${editorId}`);
    s.publish(remote);
    await waitFor(async () => editor.getState(), state => state.checkpoint.remoteCandidate?.value?.content === remote.value?.content, 'remote conflict observation');
    editor.close({ flush: false });
    await engine.retry();
    const stored = await s.stores().checkpoints.read(owner, editorId);
    if (!stored?.checkpoint.remoteCandidate)
        throw new Error('Conflicted source checkpoint was not durably stored');
    engine.dispose();
    return { remote, stored };
}
async function seedManualSource(s: ReturnType<typeof setup>, editorId: string, title: string) {
    const engine = s.createEngine(false);
    const parent = await engine.openEditor(resource, editorId);
    const form = parent.form('title', [['title']]);
    await form.begin();
    await form.update(value => ({ ...value, title }));
    const state = form.getState();
    if (!state?.record.active || state.value.title !== title)
        throw new Error('Manual source did not retain its staged title');
    const scopeId = state.record.scopeId;
    parent.dispose();
    await engine.retry();
    const stored = await s.stores().manualScopes.read(owner, scopeId);
    if (!stored?.record || stored.record.stage[0]?.exists !== true || stored.record.stage[0].value !== title)
        throw new Error('Manual source did not retain its durable staged title');
    engine.dispose();
    return { scopeId, stored };
}
async function freshCheckpointChoices(s: ReturnType<typeof setup>, editorId: string) {
    const engine = s.createEngine(false);
    try {
        const choices = await engine.listRecoveryChoices(resource);
        return { engine, choices, sourceId: sourceCheckpointId(editorId) };
    }
    catch (error) {
        engine.dispose();
        throw error;
    }
}
async function freshManualChoices(s: ReturnType<typeof setup>, editorId: string) {
    const engine = s.createEngine(false);
    try {
        const parent = await engine.openEditor(resource, editorId);
        const form = parent.form('title', [['title']]);
        const choices = await form.listRecoverable();
        return { engine, parent, form, choices };
    }
    catch (error) {
        engine.dispose();
        throw error;
    }
}
describe('Recovered source settlement through native IndexedDB storage factories', () => {
    beforeEach(() => { jest.clearAllMocks(); });
    it('does not retire an ordinary conflicted checkpoint when a recovered copy is closed without a choice', async () => {
        const s = setup();
        const { stored } = await seedConflictedCheckpoint(s, 'checkpoint-no-choice-source');
        const target = s.createEngine(false);
        try {
            const sourceId = sourceCheckpointId('checkpoint-no-choice-source');
            const fork = await target.recoverEditor(resource, 'checkpoint-no-choice-fork', sourceId);
            expect(fork.getState().checkpoint.remoteCandidate?.value?.content).toBe(stored.checkpoint.remoteCandidate?.value?.content);
            fork.dispose();
            await target.retry();
            const sourceAfterNoChoice = await s.stores().checkpoints.read(owner, 'checkpoint-no-choice-source');
            expect(sourceAfterNoChoice?.checkpoint).toEqual(stored.checkpoint);
            target.dispose();
            const fresh = await freshCheckpointChoices(s, 'checkpoint-no-choice-source');
            try {
                expect(fresh.choices.map(row => row.id)).toContain(sourceId);
            }
            finally {
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
    it('retires the original conflict source after the recovered editor accepts remote and a fresh engine reads it', async () => {
        const s = setup();
        await seedConflictedCheckpoint(s, 'checkpoint-accept-remote-source');
        const sourceId = sourceCheckpointId('checkpoint-accept-remote-source');
        const target = s.createEngine(false);
        try {
            const fork = await target.recoverEditor(resource, 'checkpoint-accept-remote-fork', sourceId);
            expect(fork.getState().checkpoint.remoteCandidate?.value?.content).toBe('server words for checkpoint-accept-remote-source');
            await fork.acceptRemote();
            expect(fork.getState().checkpoint.draft?.content).toBe('server words for checkpoint-accept-remote-source');
            expect(fork.getState().checkpoint.dirty).toBe(false);
            fork.dispose();
            await target.retry();
            await s.stores().checkpoints.read(owner, 'checkpoint-accept-remote-fork');
            await s.stores().commits.list(owner);
            target.dispose();
            const fresh = await freshCheckpointChoices(s, 'checkpoint-accept-remote-source');
            try {
                expect(fresh.choices.map(row => row.id)).not.toContain(sourceId);
            }
            finally {
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
    it('preserves later independently edited source words when the recovered fork accepts remote', async () => {
        const s = setup();
        await seedConflictedCheckpoint(s, 'checkpoint-later-source');
        const sourceId = sourceCheckpointId('checkpoint-later-source');
        const target = s.createEngine(false), later = s.createEngine(false);
        try {
            const fork = await target.recoverEditor(resource, 'checkpoint-later-fork', sourceId);
            const source = await later.openEditor(resource, 'checkpoint-later-source');
            await source.edit({ ...source.getState().checkpoint.draft!, content: 'later independent source words' });
            source.close({ flush: false });
            await later.retry();
            expect((await s.stores().checkpoints.read(owner, 'checkpoint-later-source'))?.checkpoint.draft?.content).toBe('later independent source words');
            await fork.acceptRemote();
            expect(fork.getState().checkpoint.draft?.content).toBe('server words for checkpoint-later-source');
            fork.dispose();
            await target.retry();
            await s.stores().checkpoints.read(owner, 'checkpoint-later-fork');
            target.dispose();
            later.dispose();
            const fresh = await freshCheckpointChoices(s, 'checkpoint-later-source');
            try {
                const sourceChoice = fresh.choices.find(row => row.id === sourceId);
                expect(sourceChoice?.record.checkpoint.draft?.content).toBe('later independent source words');
            }
            finally {
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
            later.dispose();
        }
    });
    it('retires the original manual source after a real Save ACK and a fresh engine reads it', async () => {
        const s = setup();
        const { scopeId } = await seedManualSource(s, 'manual-ack-source', 'Manual words to carry');
        const target = s.createEngine(false);
        try {
            const parent = await target.openEditor(resource, 'manual-ack-target');
            const recovered = parent.form('title', [['title']]);
            await recovered.recover(scopeId);
            expect(recovered.getState()?.value.title).toBe('Manual words to carry');
            await recovered.save();
            const queued = (await s.stores().commits.list(owner)).find(request => request.value?.title === 'Manual words to carry');
            expect(['queued', 'prepared']).toContain(queued?.state);
            target.setOnline(true);
            const retryPromise = target.retry();
            await retryPromise;
            const acknowledged = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === queued?.id && row.result.kind === 'acknowledged'), 'actual manual Save ACK from applyCommand');
            const actualAck = acknowledged.find(row => row.command.operationId === queued?.id);
            expect(actualAck?.result.kind).toBe('acknowledged');
            expect(actualAck?.command.operationId).toBe(queued?.id);
            expect(actualAck?.result.operationId).toBe(queued?.id);
            expect(actualAck?.command.owner).toBe(owner);
            expect(actualAck?.command.resource).toEqual(resource);
            expect(actualAck?.command.generation).toBe('settlement-generation');
            expect(acknowledgedSnapshot(actualAck?.result).metadata).toMatchObject({ protocol: 1, generation: 'settlement-generation', revision: 2, deleted: false });
            expect(acknowledgedSnapshot(actualAck?.result).value?.title).toBe('Manual words to carry');
            expect(s.transport.send).toHaveBeenCalledTimes(1);
            expect(s.snapshots.get(keyOf(owner, resource))?.value?.title).toBe('Manual words to carry');
            parent.dispose();
            await target.retry();
            await s.stores().manualScopes.read(owner, scopeId);
            await s.stores().commits.list(owner);
            target.dispose();
            const fresh = await freshManualChoices(s, 'manual-ack-observer');
            try {
                expect(fresh.choices.map(row => row.scopeId)).not.toContain(scopeId);
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
    it('keeps the original manual source offered while its recovered Save is queued without an ACK', async () => {
        const s = setup();
        const { scopeId, stored } = await seedManualSource(s, 'manual-queued-source', 'Manual words still awaiting ACK');
        const target = s.createEngine(false);
        try {
            const parent = await target.openEditor(resource, 'manual-queued-target');
            const recovered = parent.form('title', [['title']]);
            await recovered.recover(scopeId);
            await recovered.save();
            const queued = (await s.stores().commits.list(owner)).find(request => request.value?.title === 'Manual words still awaiting ACK');
            expect(['queued', 'prepared']).toContain(queued?.state);
            expect(s.transport.send).not.toHaveBeenCalled();
            parent.dispose();
            await target.retry();
            await s.stores().manualScopes.read(owner, scopeId);
            await s.stores().commits.list(owner);
            target.dispose();
            const fresh = await freshManualChoices(s, 'manual-queued-observer');
            try {
                expect(fresh.choices.map(row => row.scopeId)).toContain(scopeId);
                const sourceAfterNoAck = await s.stores().manualScopes.read(owner, scopeId);
                expect(sourceAfterNoAck?.record?.stage).toEqual(stored.record?.stage);
                expect(sourceAfterNoAck?.record?.baseline).toEqual(stored.record?.baseline);
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
    it('does not retire a recovered manual source when the target is cancelled before Save', async () => {
        const s = setup();
        const sourceEngine = s.createEngine(false);
        const sourceParent = await sourceEngine.openEditor(resource, 'manual-cancel-source');
        const sourceForm = sourceParent.form('title', [['title']]);
        await sourceForm.begin();
        await sourceForm.update(value => ({ ...value, title: 'Saved inherited predecessor' }));
        await sourceForm.save();
        const predecessor = (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Saved inherited predecessor');
        expect(predecessor).toBeDefined();
        await sourceForm.begin();
        await sourceForm.update(value => ({ ...value, title: 'Cancelled source words' }));
        sourceEngine.setOnline(true);
        await sourceEngine.retry();
        const sourceAck = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === predecessor!.id && row.result.kind === 'acknowledged'), 'source predecessor ACK');
        expect(acknowledgedSnapshot(sourceAck.find(row => row.command.operationId === predecessor!.id)?.result).value?.title).toBe('Saved inherited predecessor');
        const scopeId = sourceForm.getState()!.record.scopeId;
        const stored = await s.stores().manualScopes.read(owner, scopeId);
        if (!stored?.record)
            throw new Error('Inherited source stage is missing');
        expect(stored.record.predecessor?.id).toBe(predecessor?.id);
        sourceParent.dispose();
        await sourceEngine.retry();
        sourceEngine.dispose();
        const target = s.createEngine(false);
        try {
            const parent = await target.openEditor(resource, 'manual-cancel-target');
            const form = parent.form('title', [['title']]);
            await form.recover(scopeId);
            await form.update(value => ({ ...value, title: 'Unsubmitted target words' }));
            await form.cancel();
            parent.dispose();
            await target.retry();
            target.dispose();
            const fresh = await freshManualChoices(s, 'manual-cancel-observer');
            try {
                expect(fresh.choices.map(row => row.scopeId)).toContain(scopeId);
                const sourceAfter = await s.stores().manualScopes.read(owner, scopeId);
                expect(sourceAfter?.record?.stage).toEqual(stored.record?.stage);
                expect(sourceAfter?.record?.baseline).toEqual(stored.record?.baseline);
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
        sourceParent.dispose();
        sourceEngine.dispose();
    });
    it('settles the original manual source when a queued Save is ACKed after the parent closes', async () => {
        const s = setup();
        const { scopeId } = await seedManualSource(s, 'manual-close-before-ack-source', 'Close before ACK words');
        const target = s.createEngine(false);
        try {
            const parent = await target.openEditor(resource, 'manual-close-before-ack-target');
            const form = parent.form('title', [['title']]);
            await form.recover(scopeId);
            await form.save();
            const queued = (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Close before ACK words');
            expect(['queued', 'prepared']).toContain(queued?.state);
            expect(s.transportResults).toHaveLength(0);
            parent.dispose();
            await target.retry();
            expect(s.transportResults).toHaveLength(0);
            target.setOnline(true);
            await target.retry();
            const acked = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === queued?.id && row.result.kind === 'acknowledged'), 'closed-parent Save ACK');
            const actualAck = acked.find(row => row.command.operationId === queued?.id)!;
            expect(actualAck.result.operationId).toBe(queued?.id);
            expect(actualAck.command.owner).toBe(owner);
            expect(actualAck.command.resource).toEqual(resource);
            expect(acknowledgedSnapshot(actualAck.result).value?.title).toBe('Close before ACK words');
            await s.stores().manualScopes.read(owner, scopeId);
            target.dispose();
            const fresh = await freshManualChoices(s, 'manual-close-before-ack-observer');
            try {
                expect(fresh.choices.map(row => row.scopeId)).not.toContain(scopeId);
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
    it('keeps a later source edit when a recovered target Save ACKs the older pinned version', async () => {
        const s = setup();
        const sourceEngine = s.createEngine(false);
        const sourceParent = await sourceEngine.openEditor(resource, 'manual-later-source');
        const sourceForm = sourceParent.form('title', [['title']]);
        await sourceForm.begin();
        await sourceForm.update(value => ({ ...value, title: 'Source version one' }));
        const scopeId = sourceForm.getState()!.record.scopeId;
        const target = s.createEngine(false);
        try {
            const targetParent = await target.openEditor(resource, 'manual-later-target');
            const targetForm = targetParent.form('title', [['title']]);
            await targetForm.recover(scopeId);
            await sourceForm.update(value => ({ ...value, title: 'Source version two' }));
            await targetForm.update(value => ({ ...value, title: 'Recovered target accepted' }));
            const queued = await targetForm.save().then(async () => (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Recovered target accepted'));
            expect(queued).toBeDefined();
            target.setOnline(true);
            await target.retry();
            const acked = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === queued!.id && row.result.kind === 'acknowledged'), 'pinned-version Save ACK');
            expect(acknowledgedSnapshot(acked.find(row => row.command.operationId === queued!.id)?.result).value?.title).toBe('Recovered target accepted');
            targetParent.dispose();
            await target.retry();
            target.dispose();
            sourceParent.dispose();
            await sourceEngine.retry();
            sourceEngine.dispose();
            const fresh = await freshManualChoices(s, 'manual-later-observer');
            try {
                const sourceChoice = fresh.choices.find(row => row.scopeId === scopeId);
                expect(sourceChoice?.record.stage[0]).toEqual({ exists: true, value: 'Source version two' });
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
            sourceParent.dispose();
            sourceEngine.dispose();
        }
    });
    it('keeps post-Save target typing after the captured Save ACK settles the original source', async () => {
        const s = setup();
        const { scopeId } = await seedManualSource(s, 'manual-after-save-source', 'Original before queued Save');
        const target = s.createEngine(false);
        try {
            const parent = await target.openEditor(resource, 'manual-after-save-target');
            const form = parent.form('title', [['title']]);
            await form.recover(scopeId);
            await form.update(value => ({ ...value, title: 'Captured Save words' }));
            await form.save();
            const queued = (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Captured Save words');
            expect(queued).toBeDefined();
            await form.begin();
            await form.update(value => ({ ...value, title: 'Later unsaved target words' }));
            const targetScopeId = form.getState()!.record.scopeId;
            parent.dispose();
            await target.retry();
            target.setOnline(true);
            await target.retry();
            const acked = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === queued!.id && row.result.kind === 'acknowledged'), 'captured Save ACK after later typing');
            expect(acknowledgedSnapshot(acked.find(row => row.command.operationId === queued!.id)?.result).value?.title).toBe('Captured Save words');
            target.dispose();
            const fresh = await freshManualChoices(s, 'manual-after-save-observer');
            try {
                expect(fresh.choices.map(row => row.scopeId)).not.toContain(scopeId);
                const later = fresh.choices.find(row => row.scopeId === targetScopeId);
                expect(later?.record.stage[0]).toEqual({ exists: true, value: 'Later unsaved target words' });
                expect(later?.record.savedSelection[0]).toEqual({ exists: true, value: 'Captured Save words' });
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
    it('settles the exact original chain across a saved intermediate fork and a second recovered Save', async () => {
        const s = setup();
        const { scopeId: originalScopeId } = await seedManualSource(s, 'manual-multihop-source', 'Multi-hop original words');
        const first = s.createEngine(false);
        let firstParent: Awaited<ReturnType<typeof first.openEditor>> | null = null;
        let firstScopeId = '';
        try {
            firstParent = await first.openEditor(resource, 'manual-multihop-first');
            const form = firstParent.form('title', [['title']]);
            await form.recover(originalScopeId);
            await form.update(value => ({ ...value, title: 'Intermediate saved words' }));
            const captured = await form.save().then(async () => (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Intermediate saved words'));
            expect(captured).toBeDefined();
            firstScopeId = form.getState()!.record.scopeId;
            first.setOnline(true);
            await first.retry();
            const acked = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === captured!.id && row.result.kind === 'acknowledged'), 'intermediate Save ACK');
            expect(acknowledgedSnapshot(acked.find(row => row.command.operationId === captured!.id)?.result).value?.title).toBe('Intermediate saved words');
            await form.begin();
            await form.update(value => ({ ...value, title: 'Intermediate later words' }));
            firstParent.dispose();
            await first.retry();
            first.dispose();
            const second = s.createEngine(false);
            try {
                const secondParent = await second.openEditor(resource, 'manual-multihop-second');
                const secondForm = secondParent.form('title', [['title']]);
                await secondForm.recover(firstScopeId);
                await secondForm.update(value => ({ ...value, title: 'Final multi-hop words' }));
                const finalRequest = await secondForm.save().then(async () => (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Final multi-hop words'));
                expect(finalRequest).toBeDefined();
                second.setOnline(true);
                await second.retry();
                const finalAck = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === finalRequest!.id && row.result.kind === 'acknowledged'), 'final multi-hop Save ACK');
                expect(acknowledgedSnapshot(finalAck.find(row => row.command.operationId === finalRequest!.id)?.result).value?.title).toBe('Final multi-hop words');
                secondParent.dispose();
                await second.retry();
                second.dispose();
                const fresh = await freshManualChoices(s, 'manual-multihop-observer');
                try {
                    expect(fresh.choices.map(row => row.scopeId)).not.toContain(originalScopeId);
                    expect(fresh.choices.map(row => row.scopeId)).not.toContain(firstScopeId);
                }
                finally {
                    fresh.parent.dispose();
                    fresh.engine.dispose();
                }
            }
            finally {
                second.dispose();
            }
        }
        finally {
            firstParent?.dispose();
            first.dispose();
        }
    });
    it('preserves recovery origins when a recovered target is closed and reopened before its new Save', async () => {
        const s = setup();
        const { scopeId: originalScopeId } = await seedManualSource(s, 'manual-reopen-source', 'Reopen original words');
        const first = s.createEngine(false);
        let targetScopeId = '';
        try {
            const parent = await first.openEditor(resource, 'manual-reopen-first');
            const form = parent.form('title', [['title']]);
            await form.recover(originalScopeId);
            targetScopeId = form.getState()!.record.scopeId;
            parent.dispose();
            await first.retry();
            first.dispose();
            const sourceStored = await s.stores().manualScopes.read(owner, targetScopeId);
            expect(sourceStored?.record?.recoveryOrigins?.some(origin => origin.id === originalScopeId)).toBe(true);
            const restarted = s.createEngine(false);
            try {
                const restartedParent = await restarted.openEditor(resource, 'manual-reopen-second');
                const restartedForm = restartedParent.form('title', [['title']]);
                await restartedForm.recover(targetScopeId);
                expect(restartedForm.getState()?.value.title).toBe('Reopen original words');
                expect(restartedForm.getState()?.record.recoveryOrigins?.some(origin => origin.id === originalScopeId)).toBe(true);
                await restartedForm.update(value => ({ ...value, title: 'Reopened final words' }));
                const request = await restartedForm.save().then(async () => (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Reopened final words'));
                expect(request).toBeDefined();
                restarted.setOnline(true);
                await restarted.retry();
                const acked = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === request!.id && row.result.kind === 'acknowledged'), 'reopened recovered Save ACK');
                expect(acknowledgedSnapshot(acked.find(row => row.command.operationId === request!.id)?.result).value?.title).toBe('Reopened final words');
                restartedParent.dispose();
                await restarted.retry();
                restarted.dispose();
                const fresh = await freshManualChoices(s, 'manual-reopen-observer');
                try {
                    expect(fresh.choices.map(row => row.scopeId)).not.toContain(originalScopeId);
                    expect(fresh.choices.map(row => row.scopeId)).not.toContain(targetScopeId);
                }
                finally {
                    fresh.parent.dispose();
                    fresh.engine.dispose();
                }
            }
            finally {
                restarted.dispose();
            }
        }
        finally {
            first.dispose();
        }
    });
    it('settles the source after reopening and following the same pending Save before its ACK', async () => {
        const s = setup();
        const { scopeId } = await seedManualSource(s, 'manual-follow-source', 'Follow pending words');
        const target = s.createEngine(false);
        try {
            const parent = await target.openEditor(resource, 'manual-follow-target');
            const form = parent.form('title', [['title']]);
            await form.recover(scopeId);
            await form.save();
            const request = (await s.stores().commits.list(owner)).find(row => row.value?.title === 'Follow pending words');
            expect(request).toBeDefined();
            await form.begin();
            await form.follow();
            expect(form.getState()?.record.predecessor?.id).toBe(request!.id);
            target.setOnline(true);
            await target.retry();
            const acked = await waitFor(async () => s.transportResults, rows => rows.some(row => row.command.operationId === request!.id && row.result.kind === 'acknowledged'), 'followed Save ACK');
            expect(acknowledgedSnapshot(acked.find(row => row.command.operationId === request!.id)?.result).value?.title).toBe('Follow pending words');
            parent.dispose();
            await target.retry();
            target.dispose();
            const fresh = await freshManualChoices(s, 'manual-follow-observer');
            try {
                expect(fresh.choices.map(row => row.scopeId)).not.toContain(scopeId);
            }
            finally {
                fresh.parent.dispose();
                fresh.engine.dispose();
            }
        }
        finally {
            target.dispose();
        }
    });
});
