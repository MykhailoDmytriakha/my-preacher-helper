import { act, renderHook } from '@testing-library/react';

import { useDataDocument, useDocumentActions } from '@/data-engine/react.client';
import { DataSession } from '@/data-engine/session';
import { newClientId } from '@/utils/clientId';

import { useScratchDataDocument } from '../useScratchDataDocument';

import type { EditorState } from '@/data-engine/controller';
import type { SyncStatus } from '@/data-engine/status';
import type { DocumentData, Json } from '@/data-engine/types';
import type { ScratchNote } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({ useDataDocument: jest.fn(), useDocumentActions: jest.fn() }));
jest.mock('@/utils/clientId', () => ({ newClientId: jest.fn() }));

const note = (id: string, text = id): ScratchNote => ({ id, text, createdAt: '2026-09-12' });
const json = (value: unknown) => value as Json;

function setup(initial: DocumentData | null = { userId: 'owner', title: 'Keep title', scratch: json([note('a'), note('b')]) }) {
  const session = new DataSession({ resource: { collection: 'sermons', id: 'sermon' }, value: initial, metadata: null });
  let state: EditorState | null = { checkpoint: session.checkpoint(), durable: true, error: null, result: null };
  let error: string | null = null;
  let phase: SyncStatus['phase'] = 'saved';
  let persistence = Promise.resolve();
  const update = jest.fn(async (updater: (current: DocumentData | null) => DocumentData | null) => {
    try {
      session.edit(updater(session.checkpoint().draft));
      state = { checkpoint: session.checkpoint(), durable: false, error: null, result: null };
      await persistence;
      state = { ...state, durable: true };
    } catch (failure) {
      error = (failure as Error).message;
      throw failure;
    }
  });
  const save = jest.fn(async () => undefined);
  const captured: (DocumentData | null)[] = [];
  const commit = jest.fn(async (updater: (current: DocumentData | null) => DocumentData | null) => {
    const staged = update(updater);
    captured.push(session.checkpoint().draft);
    await staged;
    await save();
  });
  jest.mocked(useDocumentActions).mockReturnValue({ commit: (_resource, updater) => commit(updater) } as ReturnType<typeof useDocumentActions>);
  const actions = { acceptRemote: jest.fn(), keepLocal: jest.fn(), getManualForm: jest.fn(), listRecoverable: jest.fn(), recover: jest.fn(), retry: jest.fn(), remove: jest.fn() };
  jest.mocked(useDataDocument).mockImplementation(() => ({
    actions: [], carryCouncilTopicToNew: jest.fn(), carryCouncilTopicToExisting: jest.fn(), discardAction: jest.fn(),
    recoveryIdentity: {}, readOnly: false, copySource: null, readOnlyReason: null,
    data: session.checkpoint().draft,
    confirmed: session.checkpoint().confirmed,
    remote: null, state, status: { phase } as SyncStatus,
    loading: false, error, edit: jest.fn(), update, save, commit, ...actions,
  }));
  let sequence = 0;
  jest.mocked(newClientId).mockImplementation(() => `new-${++sequence}`);
  return {
    update, save, commit, captured, actions, session,
    draft: () => session.checkpoint().draft!,
    notes: () => session.checkpoint().draft!.scratch as unknown as ScratchNote[],
    defer: (promise: Promise<void>) => { persistence = promise; },
    setState: (next: EditorState | null) => { state = next; },
    getState: () => state!,
    phase: (next: SyncStatus['phase']) => { phase = next; },
  };
}

describe('useScratchDataDocument', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses the shared sermon editor slot and forwards canonical state and recovery actions', () => {
    const s = setup();
    const { result, rerender } = renderHook(({ id }) => useScratchDataDocument(id), { initialProps: { id: 'sermon' as string | null } });
    expect(useDataDocument).toHaveBeenCalledWith({ collection: 'sermons', id: 'sermon' }, { slot: 'scratch' });
    expect(result.current.notes).toEqual([note('a'), note('b')]);
    expect(result.current.isWritePending).toBe(false);
    expect(result.current.scratchRevision).toBe(0);
    expect(result.current.keepLocal).toBe(s.actions.keepLocal);
    expect(result.current.acceptRemote).toBe(s.actions.acceptRemote);
    expect(result.current.listRecoverable).toBe(s.actions.listRecoverable);
    expect(result.current.recover).toBe(s.actions.recover);
    expect(result.current.retry).toBe(s.actions.retry);
    rerender({ id: null });
    expect(useDataDocument).toHaveBeenLastCalledWith(null, { slot: 'scratch' });
  });

  it('keeps rapid adds from a stale render callback and persists through public functional updates', async () => {
    const s = setup(); const { result, rerender } = renderHook(() => useScratchDataDocument('sermon'));
    const add = result.current.addScratchNote;
    let first!: ScratchNote | null;
    await act(async () => { first = add('  first  ', 'main'); add('second'); });
    expect(first).toMatchObject({ id: 'new-1', text: 'first', section: 'main' });
    expect(first?.createdAt).toEqual(expect.any(String));
    expect(s.notes().map(item => item.id)).toEqual(['new-2', 'new-1', 'a', 'b']);
    expect(s.draft().title).toBe('Keep title');
    expect(s.save).not.toHaveBeenCalled();
    rerender();
    expect(result.current.scratchRevision).toBe(2);
    expect(result.current.isWritePending).toBe(true);
  });

  it('rejects blank captures and restores the exact identity, words and provenance once', async () => {
    const s = setup({ userId: 'owner', title: 'Keep title', scratch: json([note('b')]) }); const { result } = renderHook(() => useScratchDataDocument('sermon'));
    expect(result.current.addScratchNote(' ')).toBeNull();
    expect(await result.current.restoreScratchNote(note('empty', '\n'))).toBeNull();
    expect(s.update).not.toHaveBeenCalled();
    expect(newClientId).not.toHaveBeenCalled();
    const restored = { ...note('a', '  restored  '), source: { noteId: 'source', heading: 'Heading' } };
    await act(async () => { await result.current.restoreScratchNote(restored); await result.current.restoreScratchNote(restored); });
    expect(s.notes()).toEqual([restored, note('b')]);
  });

  it('keeps newer words when the thought identity already exists', async () => {
    const s = setup(); const { result } = renderHook(() => useScratchDataDocument('sermon'));
    let restored: ScratchNote | null = null;
    await act(async () => { restored = await result.current.restoreScratchNote(note('a', 'Stale deleted words')); });
    expect(restored).toEqual(note('a'));
    expect(s.notes()).toEqual([note('a'), note('b')]);
  });

  it('edits text and optional sections, reorders and deletes without changing sibling notes', async () => {
    const s = setup(); const { result } = renderHook(() => useScratchDataDocument('sermon'));
    await act(async () => {
      result.current.updateScratchNote('a', { text: 'Edited' });
      result.current.setScratchNoteSection('a', 'conclusion');
      result.current.updateScratchNote('missing', { text: 'Do not insert' });
      result.current.moveScratchNote('a', ['b'], 1);
    });
    expect(s.notes()).toEqual([note('b'), { ...note('a', 'Edited'), section: 'conclusion' }]);
    await act(async () => { result.current.setScratchNoteSection('a', null); result.current.deleteScratchNote('b'); });
    expect(s.notes()).toEqual([note('a', 'Edited')]);
  });

  it('uses canonical durability, dirty, delivery and error state to block composing unconfirmed notes', () => {
    const s = setup(); const clean = s.getState();
    const { result, rerender } = renderHook(() => useScratchDataDocument('sermon'));
    s.setState({ ...clean, durable: false }); rerender(); expect(result.current.isWritePending).toBe(true);
    s.setState(clean);
    for (const phase of ['queued', 'sending', 'unknown', 'conflict', 'refused', 'remoteChanged', 'deleted'] as const) {
      s.phase(phase); rerender(); expect(result.current.isWritePending).toBe(true);
    }
    s.phase('saved'); rerender(); expect(result.current.isWritePending).toBe(false);
    s.setState(null); rerender(); expect(result.current.scratchRevision).toBe(0);
    expect(result.current.isWritePending).toBe(false);
  });

  it('supports legacy sermons without a scratch field', async () => {
    const s = setup({ userId: 'owner' }); const { result } = renderHook(() => useScratchDataDocument('sermon'));
    expect(result.current.notes).toEqual([]);
    await act(async () => { result.current.addScratchNote('first'); });
    expect(s.notes()).toEqual([expect.objectContaining({ text: 'first' })]);
  });
});

it('waits for the durable voice note and reuses its recording identity after retry', async () => {
  const s = setup();
  let accept!: () => void;
  s.defer(new Promise<void>(resolve => { accept = resolve; }));
  const view = renderHook(() => useScratchDataDocument('sermon'));
  const controller = view.result.current as typeof view.result.current & { addRecordedScratchNote?: (text: string, recordingId: string) => Promise<ScratchNote> };
  expect(typeof controller.addRecordedScratchNote).toBe('function');
  let finished = false;
  const pending = controller.addRecordedScratchNote!('Original voice text', 'source-1').then(() => { finished = true; });
  await act(async () => { await Promise.resolve(); });
  expect(finished).toBe(false);
  await act(async () => { accept(); await pending; });
  expect(s.notes().filter(note => note.id === 'audio:source-1')).toHaveLength(1);
  await act(async () => { await controller.addRecordedScratchNote!('Original voice text', 'source-1'); });
  expect(s.notes().filter(note => note.id === 'audio:source-1')).toHaveLength(1);
  view.unmount();
});
