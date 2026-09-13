import { renderHook } from '@testing-library/react';

import { useDataDocument, useDataEngine, useDataForm } from '@/data-engine/react.client';
import { DataSession } from '@/data-engine/session';

import { useSermonCoreDataDocument } from '../useSermonCoreDataDocument';

import type { SermonCorePatch } from '../useSermonCoreDataDocument';
import type { DocumentData } from '@/data-engine/types';

jest.mock('@/data-engine/react.client', () => ({ useDataDocument: jest.fn(), useDataEngine: jest.fn(), useDataForm: jest.fn() }));
function setup(value: DocumentData | null = { userId: 'owner', title: 'Original', verse: 'John 1', thoughts: [], preparation: {
  authorIntent: 'Keep', textContext: { passage: 'Keep passage', contextNotes: 'Old notes' },
} }) {
  const session = new DataSession({ resource: { collection: 'sermons', id: 'sermon' }, value, metadata: null });
  let durable = Promise.resolve();
  const api = {
    data: value, confirmed: session.checkpoint().confirmed, remote: null,
    state: null, status: null, loading: false, error: null,
    commit: jest.fn(),
    update: jest.fn(async (updater: (current: DocumentData | null) => DocumentData | null) => {
      session.edit(updater(session.checkpoint().draft));
      api.data = session.checkpoint().draft;
      await durable;
    }),
    save: jest.fn(async () => undefined),
    keepLocal: jest.fn(), acceptRemote: jest.fn(), recover: jest.fn(), retry: jest.fn(), getManualForm: jest.fn(), listRecoverable: jest.fn(), edit: jest.fn(), remove: jest.fn(),
  } as ReturnType<typeof useDataDocument>;
  api.commit = jest.fn(async updater => {
    const staged = api.update(updater);
    await staged;
    await api.save();
  });
  jest.mocked(useDataDocument).mockImplementation(() => api);
  jest.mocked(useDataEngine).mockReturnValue({ owner: 'owner', browser: null, error: null });
  jest.mocked(useDataForm).mockImplementation(() => ({
    data: api.data, active: false, busy: false, loading: false, durable: true, dirty: false, status: null, error: null,
    begin: jest.fn(), update: jest.fn(), save: jest.fn(), cancel: jest.fn(), retry: jest.fn(), listRecoverable: jest.fn(), recover: jest.fn(),
  }));
  return { api, session, defer: (promise: Promise<void>) => { durable = promise; } };
}

describe('useSermonCoreDataDocument', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses the public core slot and exposes draft values plus canonical recovery actions', () => {
    const s = setup(); const { result, rerender } = renderHook(({ id }) => useSermonCoreDataDocument(id), { initialProps: { id: 'sermon' as string | null } });
    expect(useDataDocument).toHaveBeenCalledWith({ collection: 'sermons', id: 'sermon' }, { slot: 'core' });
    expect(result.current.coreValues).toEqual({ title: 'Original', verse: 'John 1' });
    expect(result.current.preparation.authorIntent).toBe('Keep');
    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.recover).toBe(s.api.recover);
    expect(result.current.keepLocal).toBe(s.api.keepLocal);
    rerender({ id: null }); expect(useDataDocument).toHaveBeenLastCalledWith(null, { slot: 'core' });
  });

  it('binds title and verse forms to selected fields and stages typing without a document commit', async () => {
    const s = setup(); const { result } = renderHook(() => useSermonCoreDataDocument('sermon'));
    expect(useDataForm).toHaveBeenCalledWith({ collection: 'sermons', id: 'sermon' }, 'title', [['title']]);
    expect(useDataForm).toHaveBeenCalledWith({ collection: 'sermons', id: 'sermon' }, 'verse', [['verse']]);
    for (const field of ['title', 'verse'] as const) {
      const binding = result.current[`${field}Binding`]; const form = result.current[`${field}Form`];
      await binding.begin(); await binding.update('Stage only');
      expect(form.begin).toHaveBeenCalledTimes(1);
      const updater = jest.mocked(form.update).mock.calls[0][0];
      expect(updater({ title: 'Other title', verse: 'Other verse', scratch: ['Unsaved sibling'] })).toEqual({
        title: 'Other title', verse: 'Other verse', scratch: ['Unsaved sibling'], [field]: 'Stage only',
      });
      expect(form.save).not.toHaveBeenCalled();
      await binding.save('Explicit save');
      expect(jest.mocked(form.save).mock.calls[0][0]!({ [field]: 'Stage only', scratch: ['Sibling'] })).toEqual({ [field]: 'Explicit save', scratch: ['Sibling'] });
      await binding.cancel(); expect(form.cancel).toHaveBeenCalledTimes(1);
    }
    expect(s.api.commit).not.toHaveBeenCalled();
  });

  it('applies rapid core patches from stale callbacks to the current draft without replacing siblings', async () => {
    const s = setup(); const { result, rerender } = renderHook(() => useSermonCoreDataDocument('sermon'));
    const patch = result.current.patchCore;
    const a = patch({ title: 'First' });
    const b = patch({ verse: 'John 2', isPreached: false, sourceNoteIds: [] });
    await expect(a).resolves.toEqual({ delivery: 'queued' });
    await expect(b).resolves.toEqual({ delivery: 'queued' });
    expect(s.session.checkpoint().draft).toMatchObject({ title: 'First', verse: 'John 2', isPreached: false, sourceNoteIds: [], preparation: { authorIntent: 'Keep' }, thoughts: [] });
    rerender(); expect(result.current.coreValues).toEqual({ title: 'First', verse: 'John 2' });
    expect(s.api.save).toHaveBeenCalledTimes(2);
  });

  it('patches individual nested preparation leaves and preserves newer sibling values', async () => {
    const s = setup(); const { result } = renderHook(() => useSermonCoreDataDocument('sermon'));
    const patch = result.current.patchPreparation;
    await patch({ textContext: { passageSummary: 'Summary', repeatedWords: ['word'] } });
    await patch({ textContext: { contextNotes: 'New notes' }, mainIdea: { textIdea: 'Idea' } });
    expect(s.session.checkpoint().draft?.preparation).toEqual({ authorIntent: 'Keep', textContext: {
      passage: 'Keep passage', contextNotes: 'New notes', passageSummary: 'Summary', repeatedWords: ['word'],
    }, mainIdea: { textIdea: 'Idea' } });
    await patch({ textContext: { passageSummary: undefined, repeatedWords: [] }, authorIntent: undefined });
    expect(s.session.checkpoint().draft?.preparation).toEqual({ textContext: {
      passage: 'Keep passage', contextNotes: 'New notes', repeatedWords: [],
    }, mainIdea: { textIdea: 'Idea' } });
  });

  it('deletes optional core fields and rejects ownership or unrelated field mutation', async () => {
    const s = setup({ userId: 'owner', title: 'Original', verse: '', church: { name: 'Church' } });
    const { result } = renderHook(() => useSermonCoreDataDocument('sermon'));
    await result.current.patchCore({ church: undefined, date: '2026-09-12' });
    expect(s.session.checkpoint().draft).toEqual({ userId: 'owner', title: 'Original', verse: '', date: '2026-09-12' });
    await expect(result.current.patchCore({ userId: 'other' } as SermonCorePatch)).rejects.toThrow('Unsupported');
    expect(s.session.checkpoint().draft?.userId).toBe('owner');
  });

  it('does not submit until the draft is durable and retains it when local persistence fails', async () => {
    const s = setup(); let resolve!: () => void; s.defer(new Promise<void>(done => { resolve = done; }));
    const { result } = renderHook(() => useSermonCoreDataDocument('sermon'));
    const saving = result.current.patchCore({ title: 'Queued title' });
    expect(s.api.save).not.toHaveBeenCalled();
    resolve(); await expect(saving).resolves.toEqual({ delivery: 'queued' });
    s.defer(Promise.reject(new Error('Disk full')));
    await expect(result.current.patchPreparation({ authorIntent: 'Retain locally' })).rejects.toThrow('Disk full');
    expect(s.api.save).toHaveBeenCalledTimes(1);
    expect(s.session.checkpoint().draft?.preparation).toMatchObject({ authorIntent: 'Retain locally' });
  });

  it('propagates submission refusal without rewriting or clearing the draft', async () => {
    const s = setup(); jest.mocked(s.api.save).mockRejectedValueOnce(new Error('Journal failed'));
    const { result } = renderHook(() => useSermonCoreDataDocument('sermon'));
    await expect(result.current.patchCore({ title: 'Still mine' })).rejects.toThrow('Journal failed');
    expect(s.session.checkpoint().draft?.title).toBe('Still mine');
  });

  it('locks absent, foreign-owner and confirmed or candidate deleted documents', async () => {
    const s = setup(); const { result, rerender } = renderHook(() => useSermonCoreDataDocument('sermon'));
    s.api.remote = { ...s.api.confirmed!, value: null }; rerender();
    expect(result.current.isReadOnly).toBe(true);
    await expect(result.current.patchCore({ title: 'Forbidden' })).rejects.toThrow('not available');
    s.api.remote = null; s.api.confirmed = { ...s.api.confirmed!, value: null }; rerender(); expect(result.current.isReadOnly).toBe(true);
    s.api.confirmed = { ...s.api.confirmed!, value: s.api.data, metadata: { protocol: 1, generation: 'g', revision: 2, deleted: true } };
    rerender(); expect(result.current.isReadOnly).toBe(true);
    s.api.confirmed = null; s.api.remote = { resource: { collection: 'sermons', id: 'sermon' }, value: s.api.data, metadata: { protocol: 1, generation: 'g', revision: 2, deleted: true } };
    rerender(); expect(result.current.isReadOnly).toBe(true);
    s.api.remote = null; jest.mocked(useDataEngine).mockReturnValue({ owner: 'other', browser: null, error: null });
    rerender(); expect(result.current.isReadOnly).toBe(true);
    jest.mocked(useDataEngine).mockReturnValue({ owner: null, browser: null, error: null });
    rerender(); expect(result.current.isReadOnly).toBe(true);
    expect(s.api.update).not.toHaveBeenCalled();
  });

  it('checks current draft ownership inside the updater even when a callback was captured earlier', async () => {
    const s = setup(); const { result } = renderHook(() => useSermonCoreDataDocument('sermon'));
    const patch = result.current.patchCore;
    s.session.edit({ userId: 'other' });
    await expect(patch({ title: 'Do not write' })).rejects.toThrow('not available');
    s.session.edit(null);
    await expect(patch({ title: 'Do not create' })).rejects.toThrow('not available');
    expect(s.api.save).not.toHaveBeenCalled();
  });

  it('reads empty defaults and adds preparation to a legacy document without that map', async () => {
    const s = setup(null); const { result, rerender } = renderHook(() => useSermonCoreDataDocument(null));
    expect(result.current.coreValues).toEqual({ title: '', verse: '' });
    expect(result.current.preparation).toEqual({}); expect(result.current.isReadOnly).toBe(true);
    s.api.data = { userId: 'owner' }; s.session.edit(s.api.data); s.api.confirmed = null; rerender();
    await result.current.patchPreparation({ spiritual: { readAndPrayedConfirmed: true } });
    expect(s.session.checkpoint().draft?.preparation).toEqual({ spiritual: { readAndPrayedConfirmed: true } });
  });
});
